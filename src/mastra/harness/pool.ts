import { Harness } from '@mastra/core/harness';
import type { HarnessEvent } from '@mastra/core/harness';
import { sharedConfig, BlinkHarness, CoworkerHarness } from './index';
import { classifyQuery, setCurrentClassification, classificationStorage } from '../agents/coworker/query-classifier';
import { resetInferenceCache } from '../agents/coworker/tool-call-cache';
import { Mutex } from 'async-mutex';
import AsyncLock from 'async-lock';
import { runWithCapabilityContext } from '../capabilities/resolver';
import { mergeWorkflowIntentWithPlanner } from '../agents/coworker/workflow-planner';

interface PendingState {
  question: Extract<HarnessEvent, { type: 'ask_question' }> | null;
  toolApproval: Extract<HarnessEvent, { type: 'tool_approval_required' }> | null;
  planApproval: Extract<HarnessEvent, { type: 'plan_approval_required' }> | null;
}

const EMPTY_PENDING: PendingState = { question: null, toolApproval: null, planApproval: null };

interface PoolEntry {
  harness: BlinkHarness;
  threadId: string;
  channel: string;
  lastActivityAt: number;
  unsub: () => void;
  pending: PendingState;
  runBuffer: HarnessEvent[];
  // BUG-003: Track all pending tool approvals by toolCallId
  toolApprovals: Map<string, Extract<HarnessEvent, { type: 'tool_approval_required' }>>;
  // BUG-003: Mutex for atomic tool approval operations
  approvalMutex: Mutex;
  heartbeatTimer?: ReturnType<typeof setInterval>;
}

function updatePending(entry: PoolEntry, event: HarnessEvent): void {
  // BUG-003: Use mutex for atomic tool approval state updates
  if (event.type === 'tool_approval_required' || event.type === 'tool_end') {
    entry.approvalMutex.runExclusive(() => {
      switch (event.type) {
        case 'tool_approval_required':
          entry.toolApprovals.set((event as any).toolCallId, event as any);
          entry.pending.toolApproval = event;
          break;
        case 'tool_end':
          entry.toolApprovals.delete((event as any).toolCallId);
          const nextApproval = entry.toolApprovals.values().next();
          entry.pending.toolApproval = nextApproval.done ? null : nextApproval.value;
          break;
      }
    });
    return;
  }

  switch (event.type) {
    case 'ask_question':
      entry.pending.question = event;
      break;
    case 'plan_approval_required':
      entry.pending.planApproval = event;
      break;
    case 'plan_approved':
      entry.pending.planApproval = null;
      break;
    case 'agent_end':
      entry.toolApprovals.clear();
      entry.pending = { ...EMPTY_PENDING };
      break;
  }
}

/** Buffer all events during an active run (user_message → agent_start → ... → agent_end). */
function bufferEvent(entry: PoolEntry, event: HarnessEvent): void {
  if ((event as any).type === 'user_message') {
    // User message starts the buffer — before agent_start
    entry.runBuffer = [event];
  } else if (event.type === 'agent_start') {
    // If buffer already has user_message, append; otherwise start fresh
    if (entry.runBuffer.length === 0) entry.runBuffer = [event];
    else entry.runBuffer.push(event);
  } else if (entry.runBuffer.length > 0) {
    entry.runBuffer.push(event);
    if (event.type === 'agent_end') {
      // Run finished — messages now persisted by Mastra, clear buffer
      entry.runBuffer = [];
    }
  }
}

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
const SWEEP_INTERVAL_MS = 60 * 1000;

type PoolListener = (threadId: string, event: HarnessEvent) => void;

class HarnessPool {
  private pool = new Map<string, PoolEntry>();
  private listeners: PoolListener[] = [];
  // BUG-001: Lock for thread-safe listener add/remove operations
  private listenerLock = new AsyncLock();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  // BUG-011: Prevent duplicate harness creation from concurrent getOrCreate calls
  private pendingCreates = new Map<string, Promise<PoolEntry>>();

  private startHeartbeat(entry: PoolEntry): void {
    entry.heartbeatTimer = setInterval(() => {
      this.notifyListeners(entry.threadId, { type: 'heartbeat' } as any);
    }, 30000);
  }

  private cleanupEntry(entry: PoolEntry): void {
    if (entry.heartbeatTimer) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = undefined;
    }
  }

  /** Get or create a harness for a thread */
  async getOrCreate(threadId: string, channel = 'app'): Promise<PoolEntry> {
    const existing = this.pool.get(threadId);
    if (existing) {
      existing.lastActivityAt = Date.now();
      return existing;
    }

    // BUG-011: Deduplicate concurrent creates for the same threadId
    const pending = this.pendingCreates.get(threadId);
    if (pending) return pending;

    const promise = this._createEntry(threadId, channel);
    this.pendingCreates.set(threadId, promise);
    try {
      return await promise;
    } finally {
      this.pendingCreates.delete(threadId);
    }
  }

  private async _createEntry(threadId: string, channel: string): Promise<PoolEntry> {
    const harness = new Harness({ id: `harness-${threadId}`, ...sharedConfig }) as BlinkHarness;
    await harness.init();

    // Point the harness at this thread
    await harness.switchThread({ threadId });

    const entry: PoolEntry = {
      harness,
      threadId,
      channel,
      lastActivityAt: Date.now(),
      unsub: () => {},
      pending: { ...EMPTY_PENDING },
      runBuffer: [],
      toolApprovals: new Map(),
      approvalMutex: new Mutex(),
    };

    // Subscribe to all events — track pending state, buffer run events, then forward
    const unsub = harness.subscribe((event: HarnessEvent) => {
      updatePending(entry, event);
      bufferEvent(entry, event);
      // BUG-001: Thread-safe listener notification
      this.notifyListeners(threadId, event);
    });
    entry.unsub = unsub;

    this.startHeartbeat(entry);

    this.pool.set(threadId, entry);
    return entry;
  }

  /** Get existing harness (returns undefined if not in pool) */
  get(threadId: string): PoolEntry | undefined {
    return this.pool.get(threadId);
  }

  /** Touch activity timestamp */
  touch(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.lastActivityAt = Date.now();
  }

  /** Send a message — classifies complexity, then delegates to harness (fire-and-forget) */
  send(threadId: string, content: string, images?: { data: string; mimeType: string }[]): void {
    const entry = this.pool.get(threadId);
    if (!entry) return;
    entry.lastActivityAt = Date.now();

    // Reset tool call dedup cache for this new inference chain
    resetInferenceCache();

    void (async () => {
      let classification = classifyQuery(content);
      try {
        const mergedIntent = await mergeWorkflowIntentWithPlanner(content, classification.workflowIntent);
        classification = { ...classification, workflowIntent: mergedIntent };
      } catch (e) {
        console.warn('[harness-pool] workflow planner skipped:', e);
      }
      setCurrentClassification(classification);
      console.log(
        `[harness-pool] Query classified: complexity=${classification.complexity} maxSteps=${classification.maxSteps} needsTools=${classification.needsTools} workflow=${classification.workflowIntent.mode}`,
      );

      const userEvent = { type: 'user_message', content, createdAt: new Date().toISOString() } as any;
      bufferEvent(entry, userEvent);
      this.notifyListeners(threadId, userEvent);
      this.notifyListeners(threadId, {
        type: 'workflow_intent',
        threadId,
        workflowIntent: classification.workflowIntent,
      } as any);

      // Wrap in AsyncLocalStorage.run() so all downstream code in this async chain
      // (tools, instructions, defaultOptions) sees the correct per-request classification
      classificationStorage.run(classification, () => {
        const yolo = !!(entry.harness.getState() as any)?.yolo;
        runWithCapabilityContext(
          {
            query: content,
            classification,
            yolo,
            workflowIntent: classification.workflowIntent,
          },
          () =>
            entry.harness
              .sendMessage({
                content,
                images,
              })
              .catch((err) => {
                console.error('[harness] sendMessage error:', err?.message ?? err);
                if (err?.cause) console.error('[harness] sendMessage cause:', err.cause);
                if (err?.responseBody) console.error('[harness] LLM response body:', err.responseBody);
              }),
        );
      });
    })();
  }

  /** Send a message and await completion — used by sendAndCapture utils */
  async sendAsync(threadId: string, content: string, images?: { data: string; mimeType: string }[]): Promise<void> {
    const entry = this.pool.get(threadId);
    if (!entry) throw new Error(`No pool entry for ${threadId}`);
    entry.lastActivityAt = Date.now();

    // Reset tool call dedup cache for this new inference chain
    resetInferenceCache();

    let classification = classifyQuery(content);
    try {
      const mergedIntent = await mergeWorkflowIntentWithPlanner(content, classification.workflowIntent);
      classification = { ...classification, workflowIntent: mergedIntent };
    } catch (e) {
      console.warn('[harness-pool] workflow planner skipped (async):', e);
    }
    setCurrentClassification(classification);
    console.log(
      `[harness-pool] Query classified (async): complexity=${classification.complexity} maxSteps=${classification.maxSteps} workflow=${classification.workflowIntent.mode}`,
    );

    const userEvent = { type: 'user_message', content, createdAt: new Date().toISOString() } as any;
    bufferEvent(entry, userEvent);
    this.notifyListeners(threadId, userEvent);
    this.notifyListeners(threadId, {
      type: 'workflow_intent',
      threadId,
      workflowIntent: classification.workflowIntent,
    } as any);

    // Wrap in AsyncLocalStorage.run() so all downstream code in this async chain
    // (tools, instructions, defaultOptions) sees the correct per-request classification
    await classificationStorage.run(classification, () => {
      const yolo = !!(entry.harness.getState() as any)?.yolo;
      return runWithCapabilityContext(
        {
          query: content,
          classification,
          yolo,
          workflowIntent: classification.workflowIntent,
        },
        () =>
          entry.harness.sendMessage({
            content,
            images,
          }),
      );
    });
  }

  addListener(listener: PoolListener): void {
    this.listenerLock.acquire('listeners', () => {
      this.listeners.push(listener);
    });
  }

  removeListener(listener: PoolListener): void {
    this.listenerLock.acquire('listeners', () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    });
  }

  notifyListeners(threadId: string, event: HarnessEvent): void {
    // Clone to avoid mutation during iteration
    const currentListeners = [...this.listeners];
    currentListeners.forEach(listener => {
      try {
        listener(threadId, event);
      } catch (err) {
        console.error('[HarnessPool] Listener error:', err);
      }
    });
  }

  /** Subscribe to events from ALL harnesses */
  subscribe(listener: PoolListener): () => void {
    this.addListener(listener);
    return () => {
      this.removeListener(listener);
    };
  }

  /** Remove and clean up a harness */
  async remove(threadId: string): Promise<void> {
    const entry = this.pool.get(threadId);
    if (!entry) return;

    this.cleanupEntry(entry);
    entry.unsub();
    try {
      await entry.harness.stopHeartbeats();
    } catch { /* ignore */ }
    try {
      await entry.harness.destroyWorkspace();
    } catch { /* ignore */ }
    this.pool.delete(threadId);
  }

  /** Start the idle sweeper */
  startSweeper(): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  /** Stop the sweeper */
  stopSweeper(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  /** Create a new thread and add its harness to the pool */
  async createThread(title?: string, channel = 'app'): Promise<{ threadId: string; entry: PoolEntry }> {
    const harness = new Harness({ id: `harness-tmp-${Date.now()}`, ...sharedConfig }) as BlinkHarness;
    await harness.init();
    const thread = await harness.createThread({ title });
    const threadId = thread.id;

    const entry: PoolEntry = {
      harness,
      threadId,
      channel,
      lastActivityAt: Date.now(),
      unsub: () => {},
      pending: { ...EMPTY_PENDING },
      runBuffer: [],
      toolApprovals: new Map(),
      approvalMutex: new Mutex(),
    };

    const unsub = harness.subscribe((event: HarnessEvent) => {
      updatePending(entry, event);
      bufferEvent(entry, event);
      // BUG-001: Thread-safe listener notification
      this.notifyListeners(threadId, event);
    });
    entry.unsub = unsub;

    this.startHeartbeat(entry);

    this.pool.set(threadId, entry);
    return { threadId, entry };
  }

  /** Get a harness for read-only operations (threads listing, etc.) — reuses first available or creates ephemeral */
  async getAnyHarness(): Promise<BlinkHarness> {
    const first = this.pool.values().next();
    if (!first.done) return first.value.harness;
    // No active harnesses — create a temporary one
    const harness = new Harness({ id: 'harness-ephemeral', ...sharedConfig }) as BlinkHarness;
    await harness.init();
    return harness;
  }

  /** Get thread status including pending interactive state and buffered run events */
  getStatus(threadId: string): { running: boolean; pending: PendingState; runBuffer: HarnessEvent[] } {
    const entry = this.pool.get(threadId);
    if (!entry) return { running: false, pending: { ...EMPTY_PENDING }, runBuffer: [] };
    return { running: entry.harness.isRunning(), pending: { ...entry.pending }, runBuffer: [...entry.runBuffer] };
  }

  /** Clear pending question (called when answer is submitted via route) */
  clearQuestion(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.pending.question = null;
  }

  /** Clear pending tool approval (optionally by toolCallId) */
  clearToolApproval(threadId: string, toolCallId?: string): void {
    const entry = this.pool.get(threadId);
    if (!entry) return;
    if (toolCallId) {
      entry.toolApprovals.delete(toolCallId);
      const next = entry.toolApprovals.values().next();
      entry.pending.toolApproval = next.done ? null : next.value;
    } else {
      entry.toolApprovals.clear();
      entry.pending.toolApproval = null;
    }
  }

  /** Clear pending plan approval */
  clearPlanApproval(threadId: string): void {
    const entry = this.pool.get(threadId);
    if (entry) entry.pending.planApproval = null;
  }

  /** List all active entries */
  list(): { threadId: string; channel: string; running: boolean; lastActivityAt: number }[] {
    return Array.from(this.pool.values()).map((e) => ({
      threadId: e.threadId,
      channel: e.channel,
      running: e.harness.isRunning(),
      lastActivityAt: e.lastActivityAt,
    }));
  }

  /** Update YOLO mode for all active harnesses */
  updateYoloMode(yolo: boolean): void {
    for (const entry of this.pool.values()) {
      entry.harness.setState({ yolo }).catch(err => {
        console.error(`[harness-pool] Failed to set YOLO mode for ${entry.threadId}:`, err);
      });
    }
  }

  private hasPending(entry: PoolEntry): boolean {
    return !!(entry.pending.question || entry.pending.toolApproval || entry.pending.planApproval);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [threadId, entry] of this.pool) {
      if (entry.harness.isRunning()) continue;
      if (this.hasPending(entry)) continue;
      if (now - entry.lastActivityAt < IDLE_TIMEOUT_MS) continue;
      console.log(`[harness-pool] sweeping idle harness for thread ${threadId}`);
      this.remove(threadId).catch((err) => {
        console.error(`[harness-pool] sweep error for ${threadId}:`, err);
      });
    }
  }
}

export const harnessPool = new HarnessPool();

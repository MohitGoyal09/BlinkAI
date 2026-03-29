import { ToolRouterConfig } from "./config";
import { SessionExpiredError, SessionLimitExceededError } from "./errors";

class Semaphore {
  private tasks: (() => void)[] = [];
  private count: number;

  constructor(count: number) {
    this.count = count;
  }

  async acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }

    return new Promise<void>(resolve => {
      this.tasks.push(() => {
        this.count--;
        resolve();
      });
    });
  }

  release(): void {
    this.count++;
    if (this.tasks.length > 0) {
      const nextTask = this.tasks.shift();
      if (nextTask) nextTask();
    }
  }
}

// ============================================================================
// Session ID Validation (SEC-003: Prevent SSRF via Session ID Injection)
// ============================================================================

function validateSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sessionId) && sessionId.length <= 128;
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

/**
 * Session data structure
 */
export interface ToolRouterSession {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  projectId: string;
  userId?: string;
  metadata: Record<string, unknown>;
}

/**
 * Session authentication state
 */
export interface SessionAuthState {
  sessionId: string;
  toolkitSlug: string;
  authScheme: string;
  status: "pending" | "link_required" | "authenticated" | "failed";
  linkUrl?: string;
  connectedAccountId?: string;
  linkedAt?: Date;
}

/**
 * Parameters for creating a new session
 */
export interface CreateSessionParams {
  projectId: string;
  userId?: string;
  metadata?: Record<string, unknown>;
  ttlSeconds?: number;
}

/**
 * Internal cache entry for session storage
 */
interface SessionCacheEntry {
  session: ToolRouterSession;
  lastAccessedAt: Date;
  authStates: Map<string, SessionAuthState>;
}

/**
 * Simple LRU (Least Recently Used) Cache implementation with TTL support
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * Get a value from the cache
   * Moves the key to the end (most recently used)
   */
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Set a value in the cache
   * Removes oldest entry if cache is at capacity
   */
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove oldest entry (first key)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Delete a key from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Check if a key exists in the cache
   */
  has(key: K): boolean {
    return this.cache.has(key);
  }

  /**
   * Get the current size of the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get all keys in the cache (in insertion order)
   */
  keys(): IterableIterator<K> {
    return this.cache.keys();
  }

  /**
   * Get all entries in the cache (in insertion order)
   */
  entries(): IterableIterator<[K, V]> {
    return this.cache.entries();
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }
}

/**
 * SessionManager handles caching and lifecycle of Tool Router sessions
 * Uses an LRU cache with TTL support and auto-cleanup
 */
export class SessionManager {
  private cache: LRUCache<string, SessionCacheEntry>;
  private config: ToolRouterConfig;
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private sessionCounts: Map<string, number> = new Map();
  private projectSemaphores: Map<string, Semaphore> = new Map();

  constructor(config: ToolRouterConfig) {
    this.config = config;
    this.cache = new LRUCache(config.cache.maxSize);

    if (config.cache.cleanupIntervalMinutes > 0) {
      this.startCleanupInterval();
    }
  }

  private async acquireSession(projectId: string): Promise<boolean> {
    let sem = this.projectSemaphores.get(projectId);
    if (!sem) {
      sem = new Semaphore(this.config.session.maxSessions);
      this.projectSemaphores.set(projectId, sem);
    }
    try {
      await sem.acquire();
      return true;
    } catch {
      return false;
    }
  }
  
  private releaseSession(projectId: string): void {
    const sem = this.projectSemaphores.get(projectId);
    if (sem) {
      sem.release();
    }
  }

  /**
   * Start the periodic cleanup interval for expired sessions
   */
  startCleanupInterval(): void {
    this.stopCleanupInterval();
    const intervalMs = this.config.cache.cleanupIntervalMinutes * 60 * 1000;
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, intervalMs);
  }

  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  /**
   * Generate a cache key for a session
   */
  private getSessionKey(projectId: string, userId?: string): string {
    return userId ? `${projectId}:${userId}` : projectId;
  }

  /**
   * Create a new session in the cache
   * @param sessionId - The unique session ID from Composio API
   * @param params - Session creation parameters
   * @returns The created session
   * @throws SessionLimitExceededError if project session limit is reached
   */
  async createSession(
    sessionId: string,
    params: CreateSessionParams
  ): Promise<ToolRouterSession> {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      throw new Error('Invalid session ID format');
    }

    const projectKey = this.getSessionKey(params.projectId, params.userId);

    const currentCount = this.sessionCounts.get(params.projectId) || 0;
    if (currentCount >= this.config.session.maxSessions) {
      throw new SessionLimitExceededError(
        params.projectId,
        this.config.session.maxSessions
      );
    }

    // Atomic capacity management
    const acquired = await this.acquireSession(params.projectId);
    if (!acquired) {
      throw new SessionLimitExceededError(
        params.projectId,
        this.config.session.maxSessions
      );
    }

    // Re-check after acquiring to ensure we haven't exceeded limit
    const postAcquireCount = this.sessionCounts.get(params.projectId) || 0;
    if (postAcquireCount >= this.config.session.maxSessions) {
      this.releaseSession(params.projectId);
      throw new SessionLimitExceededError(
        params.projectId,
        this.config.session.maxSessions
      );
    }

    const ttlSeconds = params.ttlSeconds !== undefined ? params.ttlSeconds : this.config.session.ttlSeconds;
    const now = new Date();
    const session: ToolRouterSession = {
      id: sessionId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
      projectId: params.projectId,
      userId: params.userId,
      metadata: params.metadata || {},
    };

    const entry: SessionCacheEntry = {
      session,
      lastAccessedAt: now,
      authStates: new Map(),
    };

    this.cache.set(projectKey, entry);
    this.sessionCounts.set(params.projectId, currentCount + 1);

    return session;
  }

  /**
   * Get a session from the cache
   * Automatically extends TTL on activity if configured
   * @param projectId - The project ID
   * @param userId - Optional user ID
   * @returns The session or null if not found
   * @throws SessionExpiredError if the session has expired
   */
  getSession(projectId: string, userId?: string): ToolRouterSession | null {
    const key = this.getSessionKey(projectId, userId);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check if expired
    if (new Date() > entry.session.expiresAt) {
      this.cache.delete(key);
      this.decrementSessionCount(entry.session.projectId);
      throw new SessionExpiredError(entry.session.id);
    }

    // Update last accessed
    entry.lastAccessedAt = new Date();

    // Auto-extend if enabled
    if (this.config.session.extendOnActivity) {
      this.extendSession(entry);
    }

    return entry.session;
  }

  /**
   * Update an existing session in the cache
   * BUG-014: Returns boolean indicating whether the update succeeded
   */
  updateSession(session: ToolRouterSession): boolean {
    const key = this.getSessionKey(session.projectId, session.userId);
    const entry = this.cache.get(key);

    if (entry) {
      entry.session = session;
      entry.lastAccessedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Delete a session from the cache
   * @param projectId - The project ID
   * @param userId - Optional user ID
   * @returns True if a session was deleted, false otherwise
   */
  deleteSession(projectId: string, userId?: string): boolean {
    const key = this.getSessionKey(projectId, userId);
    const entry = this.cache.get(key);

    if (entry) {
      this.cache.delete(key);
      this.decrementSessionCount(entry.session.projectId);
      return true;
    }

    return false;
  }

  /**
   * Extend the expiration time of a session
   */
  private extendSession(entry: SessionCacheEntry): void {
    const extensionSeconds = this.config.session.ttlSeconds;
    entry.session.expiresAt = new Date(
      Date.now() + extensionSeconds * 1000
    );
  }

  /**
   * Decrement the session count for a project
   */
  private decrementSessionCount(projectId: string): void {
    const count = this.sessionCounts.get(projectId) || 0;
    if (count > 0) {
      this.sessionCounts.set(projectId, count - 1);
      this.releaseSession(projectId);
    }
  }

  /**
   * Get authentication state for a toolkit
   */
  getAuthState(
    projectId: string,
    toolkitSlug: string,
    userId?: string
  ): SessionAuthState | undefined {
    const key = this.getSessionKey(projectId, userId);
    const entry = this.cache.get(key);
    return entry?.authStates.get(toolkitSlug);
  }

  /**
   * Set authentication state for a toolkit
   */
  setAuthState(
    projectId: string,
    toolkitSlug: string,
    authState: SessionAuthState,
    userId?: string
  ): void {
    const key = this.getSessionKey(projectId, userId);
    const entry = this.cache.get(key);

    if (entry) {
      entry.authStates.set(toolkitSlug, authState);
      entry.lastAccessedAt = new Date();
    }
  }

  /**
   * Find a session by its session ID
   * @param sessionId - The session ID to search for
   * @returns The session info if found, null otherwise
   */
  findSessionById(
    sessionId: string
  ): { projectId: string; userId?: string; session: ToolRouterSession } | null {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      return null;
    }

    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.session.id === sanitizedId) {
        return {
          projectId: entry.session.projectId,
          userId: entry.session.userId,
          session: entry.session,
        };
      }
    }
    return null;
  }

  /**
   * Set auth state to pending for a toolkit by session ID
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit slug
   * @param linkUrl - The OAuth link URL
   * @param authScheme - The auth scheme (default: "OAUTH2")
   * @returns True if state was set successfully
   */
  setAuthPending(
    sessionId: string,
    toolkitSlug: string,
    linkUrl: string,
    authScheme: string = "OAUTH2"
  ): boolean {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      return false;
    }

    const sessionInfo = this.findSessionById(sanitizedId);
    if (!sessionInfo) {
      return false;
    }

    const authState: SessionAuthState = {
      sessionId,
      toolkitSlug,
      authScheme,
      status: "link_required",
      linkUrl,
    };

    this.setAuthState(
      sessionInfo.projectId,
      toolkitSlug,
      authState,
      sessionInfo.userId
    );

    return true;
  }

  /**
   * Set auth state to complete for a toolkit by session ID
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit slug
   * @param connectedAccountId - Optional connected account ID
   * @returns True if state was set successfully
   */
  setAuthComplete(
    sessionId: string,
    toolkitSlug: string,
    connectedAccountId?: string
  ): boolean {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      return false;
    }

    const sessionInfo = this.findSessionById(sanitizedId);
    if (!sessionInfo) {
      return false;
    }

    const authState: SessionAuthState = {
      sessionId,
      toolkitSlug,
      authScheme:
        this.getAuthState(sessionInfo.projectId, toolkitSlug, sessionInfo.userId)
          ?.authScheme || "OAUTH2",
      status: "authenticated",
      connectedAccountId,
      linkedAt: new Date(),
    };

    this.setAuthState(
      sessionInfo.projectId,
      toolkitSlug,
      authState,
      sessionInfo.userId
    );

    return true;
  }

  /**
   * Set auth state to failed for a toolkit by session ID
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit slug
   * @param error - The error message or Error object
   * @returns True if state was set successfully
   */
  setAuthFailed(
    sessionId: string,
    toolkitSlug: string,
    error: string | Error
  ): boolean {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      return false;
    }

    const sessionInfo = this.findSessionById(sanitizedId);
    if (!sessionInfo) {
      return false;
    }

    const errorMessage = error instanceof Error ? error.message : error;

    const authState: SessionAuthState = {
      sessionId,
      toolkitSlug,
      authScheme:
        this.getAuthState(sessionInfo.projectId, toolkitSlug, sessionInfo.userId)
          ?.authScheme || "OAUTH2",
      status: "failed",
    };

    this.setAuthState(
      sessionInfo.projectId,
      toolkitSlug,
      authState,
      sessionInfo.userId
    );

    console.error(
      `[SessionManager] Auth failed for ${toolkitSlug} (session: ${sessionId}): ${errorMessage}`
    );

    return true;
  }

  /**
   * Get auth state for a toolkit by session ID
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit slug
   * @returns The auth state or undefined if not found
   */
  getAuthStateBySessionId(
    sessionId: string,
    toolkitSlug: string
  ): SessionAuthState | undefined {
    // SEC-003: Validate and sanitize session ID
    const sanitizedId = sanitizeSessionId(sessionId);
    if (!validateSessionId(sanitizedId)) {
      return undefined;
    }

    const sessionInfo = this.findSessionById(sanitizedId);
    if (!sessionInfo) {
      return undefined;
    }

    return this.getAuthState(
      sessionInfo.projectId,
      toolkitSlug,
      sessionInfo.userId
    );
  }

  /**
   * Clean up expired sessions
   * Called periodically by the cleanup interval
   */
  private cleanupExpiredSessions(): void {
    const now = new Date();
    let cleaned = 0;

    // Convert iterator to array for compatibility
    const keys = Array.from(this.cache.keys());
    for (const key of keys) {
      const entry = this.cache.get(key);
      if (entry && now > entry.session.expiresAt) {
        this.cache.delete(key);
        this.decrementSessionCount(entry.session.projectId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[SessionManager] Cleaned up ${cleaned} expired sessions`);
    }
  }

  /**
   * Get session statistics
   */
  getStats(): { totalSessions: number; sessionsByProject: Map<string, number> } {
    return {
      totalSessions: this.cache.size(),
      sessionsByProject: new Map(this.sessionCounts),
    };
  }

  /**
   * Clean up resources and stop the cleanup interval.
   */
  destroy(): void {
    this.stopCleanupInterval();
  }
}

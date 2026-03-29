import type { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { Memory } from '@mastra/memory';
import { fastembed } from '@mastra/fastembed';
import { LibSQLVector } from '@mastra/libsql';
import { DB_URL } from '../db';
import { getCurrentClassification } from '../agents/coworker/query-classifier';

// Implement TTL-based caching
class TTLCache<K, V> {
  private cache = new Map<K, { value: V; expires: number }>();
  private ttl: number;
  
  constructor(ttlMs: number) {
    this.ttl = ttlMs;
  }
  
  set(key: K, value: V): void {
    this.cache.set(key, { value, expires: Date.now() + this.ttl });
  }
  
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    // Update expiration time on read (sliding window TTL)
    entry.expires = Date.now() + this.ttl;
    return entry.value;
  }
  
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
}

export const memoryCache = new TTLCache<string, any>(30 * 60 * 1000); // 30 mins TTL

/**
 * Dynamic memory factory function.
 * Returns a lighter memory config for simple queries (no semantic recall).
 * Working memory and observational memory disabled — Groq/Llama models
 * output updateWorkingMemory as raw text instead of tool calls.
 */
export function getDynamicMemory(storage: MastraCompositeStore) {
  const vector = new LibSQLVector({ id: 'harness-vector', url: DB_URL });

  return ({ requestContext }: { requestContext: RequestContext }) => {
    const classification = getCurrentClassification();
    const needsMemory = classification?.needsMemory ?? true;

    // We can use a combination of properties or just fall back to type if we don't have a unique session ID
    const harnessCtx = requestContext?.get('harness') as any;
    const connectionId = harnessCtx?.connectionId || 'default';
    const id = `${connectionId}-${needsMemory ? 'full' : 'light'}`;

    let memory = memoryCache.get(id);
    if (memory) {
      return memory;
    }

    if (!needsMemory) {
      // Simple queries: no semantic recall, fewer messages
      console.log(`[memory] Using light memory config (no semantic recall)`);
      memory = new Memory({
        storage,
        options: {
          generateTitle: true,
          lastMessages: 4,
          semanticRecall: false,
          workingMemory: { enabled: false },
        },
        embedder: fastembed,
        vector,
      });
    } else {
      // Medium/complex queries: full memory with semantic recall
      memory = new Memory({
        storage,
        options: {
          generateTitle: true,
          lastMessages: 10,
          semanticRecall: {
            topK: 3,
            messageRange: 2,
          },
          workingMemory: { enabled: false },
        },
        embedder: fastembed,
        vector,
      });
    }

    memoryCache.set(id, memory);
    return memory;
  };
}

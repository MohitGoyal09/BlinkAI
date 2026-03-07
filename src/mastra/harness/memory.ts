import type { RequestContext } from '@mastra/core/request-context';
import type { MastraCompositeStore } from '@mastra/core/storage';
import { Memory } from '@mastra/memory';
import { fastembed } from '@mastra/fastembed';
import { LibSQLVector } from '@mastra/libsql';
import { DB_URL } from '../db';

let cachedMemory: Memory | null = null;

/**
 * Dynamic memory factory function.
 * Working memory and observational memory disabled — Groq/Llama models
 * output updateWorkingMemory as raw text instead of tool calls.
 */
export function getDynamicMemory(storage: MastraCompositeStore) {
  const vector = new LibSQLVector({ id: 'harness-vector', url: DB_URL });

  return ({ requestContext }: { requestContext: RequestContext }) => {
    if (cachedMemory) return cachedMemory;

    cachedMemory = new Memory({
      storage,
      options: {
        generateTitle: true,
        semanticRecall: true,
        workingMemory: {
          enabled: false,
        },
      },
      embedder: fastembed,
      vector,
    });

    return cachedMemory;
  };
}

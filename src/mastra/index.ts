import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { timing } from 'hono/timing';
import { coworkerAgent } from './agents/coworker/agent';
import { coworkerMemory } from './memory';
import { storage } from './db';
import { seedBuiltinSkills } from './config/seed-skills';
import { taskManager } from './scheduled-tasks';
import { agentConfig } from './config/agent-config';
import { WhatsAppManager } from './whatsapp/whatsapp-manager';
import { coworkerMcpServer } from './mcp/server';
import { harnessPool } from './harness/pool';
import { createAuthMiddleware } from './middleware/auth';
import { createRoutes } from './routes';
const whatsAppManager = new WhatsAppManager();

export const mastra = new Mastra({
  agents: { coworkerAgent },
  memory: { coworker: coworkerMemory },
  mcpServers: { coworkerMcpServer },
  server: {
    bodySizeLimit: 52_428_800, // 50 MB — needed for uploading large files (PPT, DOCX, etc.)
    middleware: [
      {
        handler: cors({
          origin: (origin) => {
            // Allow requests with no origin (server-to-server, curl, mobile apps)
            if (!origin) return origin;
            // Allow localhost/127.0.0.1 on any port (dev + production)
            try {
              const url = new URL(origin);
              const host = url.hostname;
              if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
                return origin;
              }
            } catch {}
            // Allow explicit override via CORS_ORIGIN env var (comma-separated)
            const allowed = process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? [];
            if (allowed.includes(origin)) return origin;
            return null; // Block all other origins
          },
        }),
        path: '/*',
      },
      { handler: createAuthMiddleware(), path: '/*' },
      { handler: logger(), path: '/*' },
      { handler: timing(), path: '/*' },
      { handler: compress(), path: '/*' },
    ],
    apiRoutes: createRoutes({ taskManager, whatsAppManager, agentConfig }),
  },
  storage,
  logger: new PinoLogger({
    name: 'Mastra',
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});

// Initialize custom tables, scheduled tasks, and WhatsApp
taskManager.setMastra(mastra);
whatsAppManager.setMastra(mastra);
seedBuiltinSkills()
  .then(() => harnessPool.startSweeper())
  .then(() => taskManager.init())
  .then(() => whatsAppManager.init())
  .then(() => console.log('[init] complete'))
  .catch((err) => console.error('[init] failed:', err));

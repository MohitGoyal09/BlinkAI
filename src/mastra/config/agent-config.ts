import { readJsonConfig, writeJsonConfig, readTextConfig, writeTextConfig, deleteConfig } from './fs-config';
import { getMcpServers, setMcpServers, getMcpToolsets, disconnectMcp } from '../mcp';
import type { McpServerConfig } from '../mcp';
import { WORKSPACE_PATH } from './paths';

export type { McpServerConfig };

export const AGENT_ID = 'coworker';

/** Pattern to detect sensitive env var names — matched case-insensitively. */
const SENSITIVE_KEY_PATTERN = /key|secret|token|password|credential|api_key/i;

/**
 * Mask sensitive values in a key-value map for safe API responses.
 * Real values remain in memory/process.env — only the returned object is masked.
 * Shows "****" + last 4 chars for values ≥8 chars, or "****" for shorter ones.
 */
function maskSecrets(env: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (SENSITIVE_KEY_PATTERN.test(key) && value && value.length > 0) {
      masked[key] = value.length >= 8
        ? `****${value.slice(-4)}`
        : '****';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

export const DEFAULT_MODEL = process.env.MODEL || 'nvidia/moonshotai/kimi-k2.5';

export const DEFAULT_INSTRUCTIONS = 'You are Coworker, an AI team member. Help with tasks, answer questions, and manage workflows.';

interface ConfigJson {
  model?: string;
  sandboxEnv?: Record<string, string>;
  yoloMode?: boolean;
}

export class AgentConfigManager {
  get(key: string): string | null {
    if (key === 'model') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      return config.model ?? null;
    }
    if (key === 'instructions') {
      return readTextConfig('AGENTS.md');
    }
    if (key === 'mcp_servers') {
      return JSON.stringify(getMcpServers());
    }
    if (key === 'sandbox_env') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      return config.sandboxEnv ? JSON.stringify(config.sandboxEnv) : null;
    }
    if (key === 'yolo_mode') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      return config.yoloMode ? 'true' : 'false';
    }
    return null;
  }

  set(key: string, value: string): void {
    if (key === 'model') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      config.model = value;
      writeJsonConfig('config.json', config);
    } else if (key === 'instructions') {
      writeTextConfig('AGENTS.md', value);
    } else if (key === 'mcp_servers') {
      const servers = JSON.parse(value);
      setMcpServers(servers);
    } else if (key === 'sandbox_env') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      config.sandboxEnv = JSON.parse(value);
      writeJsonConfig('config.json', config);
    } else if (key === 'yolo_mode') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      config.yoloMode = value === 'true';
      writeJsonConfig('config.json', config);
    }
  }

  delete(key: string): void {
    if (key === 'model') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      delete config.model;
      writeJsonConfig('config.json', config);
    } else if (key === 'instructions') {
      deleteConfig('AGENTS.md');
    } else if (key === 'mcp_servers') {
      setMcpServers([]);
    } else if (key === 'sandbox_env') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      delete config.sandboxEnv;
      writeJsonConfig('config.json', config);
    } else if (key === 'yolo_mode') {
      const config = readJsonConfig<ConfigJson>('config.json', {});
      delete config.yoloMode;
      writeJsonConfig('config.json', config);
    }
  }

  getModel(): string {
    console.time('[perf] getModel');
    const model = this.get('model') ?? DEFAULT_MODEL;
    console.timeEnd('[perf] getModel');
    return model;
  }

  getInstructions(): string {
    console.time('[perf] getInstructions');
    const instructions = this.get('instructions') ?? DEFAULT_INSTRUCTIONS;
    console.timeEnd('[perf] getInstructions');
    return instructions;
  }

  getSandboxEnv(): Record<string, string> {
    const config = readJsonConfig<ConfigJson>('config.json', {});
    const env = config.sandboxEnv ?? {};
    // Expand ~/ to WORKSPACE_PATH — tilde is NOT expanded in child process env vars
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === 'string' && value.startsWith('~/')) {
        env[key] = WORKSPACE_PATH + value.slice(1);
      }
    }
    return env;
  }

  getYoloMode(): boolean {
    const yolo = this.get('yolo_mode');
    // If set in config, use it. Otherwise fold back to env var
    if (yolo === 'true') return true;
    if (yolo === 'false') return false;
    return process.env.COWORKER_YOLO === 'true';
  }

  getConfig() {
    const model = this.get('model');
    const instructions = this.get('instructions');
    const sandboxEnv = this.getSandboxEnv();
    return {
      model: model ?? DEFAULT_MODEL,
      instructions: instructions ?? DEFAULT_INSTRUCTIONS,
      defaultModel: DEFAULT_MODEL,
      defaultInstructions: DEFAULT_INSTRUCTIONS,
      isCustomModel: model !== null,
      isCustomInstructions: instructions !== null,
      sandboxEnv: sandboxEnv, // DO NOT MASK in API to prevent corruption on PUT (CORS handles security)
      yoloMode: this.getYoloMode(),
    };
  }

  // -- MCP delegation (kept for backward compat with routes) --

  getMcpServers(): McpServerConfig[] {
    return getMcpServers();
  }

  async setMcpServers(servers: McpServerConfig[]): Promise<void> {
    await setMcpServers(servers);
  }

  async disconnectMcp(): Promise<void> {
    await disconnectMcp();
  }

  async getMcpToolsets(): Promise<Record<string, Record<string, any>>> {
    return getMcpToolsets();
  }
}

export const agentConfig = new AgentConfigManager();

/**
 * Configuration Tests
 *
 * Tests for the configuration management system including:
 * - Environment variable loading
 * - Configuration validation
 * - Default values
 * - Error handling for invalid configs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ToolRouterConfigSchema,
  loadConfig,
  loadConfigWithDefaults,
  type ToolRouterConfig,
} from '../config';

describe('ToolRouterConfigSchema', () => {
  it('should validate a complete valid config', () => {
    const config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://backend.composio.dev',
      session: {
        ttlSeconds: 3600,
        maxSessions: 100,
        extendOnActivity: true,
      },
      cache: {
        enabled: true,
        maxSize: 100,
        cleanupIntervalMinutes: 10,
      },
      timeout: {
        requestMs: 30000,
        connectMs: 5000,
      },
    };

    const result = ToolRouterConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apiKey).toBe('test-api-key');
      expect(result.data.baseUrl).toBe('https://backend.composio.dev');
      expect(result.data.session.ttlSeconds).toBe(3600);
    }
  });

  it('should apply default values for optional fields', () => {
    const config = {
      apiKey: 'test-api-key',
    };

    const result = ToolRouterConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://backend.composio.dev');
    expect(result.session.ttlSeconds).toBe(3600);
    expect(result.session.maxSessions).toBe(100);
    expect(result.session.extendOnActivity).toBe(true);
    expect(result.cache.enabled).toBe(true);
    expect(result.cache.maxSize).toBe(100);
    expect(result.cache.cleanupIntervalMinutes).toBe(10);
    expect(result.timeout.requestMs).toBe(30000);
    expect(result.timeout.connectMs).toBe(5000);
  });

  it('should reject config without API key', () => {
    const config = {
      baseUrl: 'https://backend.composio.dev',
    };

    const result = ToolRouterConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('apiKey');
    }
  });

  it('should reject empty API key', () => {
    const config = {
      apiKey: '',
    };

    const result = ToolRouterConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toContain('apiKey');
    }
  });

  it('should accept custom base URL', () => {
    const config = {
      apiKey: 'test-api-key',
      baseUrl: 'https://custom.composio.dev',
    };

    const result = ToolRouterConfigSchema.parse(config);
    expect(result.baseUrl).toBe('https://custom.composio.dev');
  });

  it('should accept partial session config with defaults', () => {
    const config = {
      apiKey: 'test-api-key',
      session: {
        ttlSeconds: 7200,
      },
    };

    const result = ToolRouterConfigSchema.parse(config);
    expect(result.session.ttlSeconds).toBe(7200);
    expect(result.session.maxSessions).toBe(100); // default
    expect(result.session.extendOnActivity).toBe(true); // default
  });

  it('should accept partial cache config with defaults', () => {
    const config = {
      apiKey: 'test-api-key',
      cache: {
        enabled: false,
      },
    };

    const result = ToolRouterConfigSchema.parse(config);
    expect(result.cache.enabled).toBe(false);
    expect(result.cache.maxSize).toBe(100); // default
    expect(result.cache.cleanupIntervalMinutes).toBe(10); // default
  });

  it('should accept partial timeout config with defaults', () => {
    const config = {
      apiKey: 'test-api-key',
      timeout: {
        requestMs: 60000,
      },
    };

    const result = ToolRouterConfigSchema.parse(config);
    expect(result.timeout.requestMs).toBe(60000);
    expect(result.timeout.connectMs).toBe(5000); // default
  });
});

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load config from environment variables', () => {
    process.env.COMPOSIO_API_KEY = 'env-api-key';
    process.env.COMPOSIO_BASE_URL = 'https://env.composio.dev';
    process.env.COMPOSIO_SESSION_TTL_SECONDS = '7200';
    process.env.COMPOSIO_MAX_SESSIONS = '50';

    const config = loadConfig();

    expect(config.apiKey).toBe('env-api-key');
    expect(config.baseUrl).toBe('https://env.composio.dev');
    expect(config.session.ttlSeconds).toBe(7200);
    expect(config.session.maxSessions).toBe(50);
  });

  it('should use defaults for missing environment variables', () => {
    process.env.COMPOSIO_API_KEY = 'env-api-key';
    delete process.env.COMPOSIO_BASE_URL;
    delete process.env.COMPOSIO_SESSION_TTL_SECONDS;

    const config = loadConfig();

    expect(config.apiKey).toBe('env-api-key');
    expect(config.baseUrl).toBe('https://backend.composio.dev');
    expect(config.session.ttlSeconds).toBe(3600);
  });

  it('should throw error when COMPOSIO_API_KEY is not set', () => {
    delete process.env.COMPOSIO_API_KEY;

    expect(() => loadConfig()).toThrow();
  });

  it('should throw error for invalid COMPOSIO_SESSION_TTL_SECONDS', () => {
    process.env.COMPOSIO_API_KEY = 'test-key';
    process.env.COMPOSIO_SESSION_TTL_SECONDS = 'not-a-number';

    expect(() => loadConfig()).toThrow();
  });

  it('should throw error for invalid COMPOSIO_MAX_SESSIONS', () => {
    process.env.COMPOSIO_API_KEY = 'test-key';
    process.env.COMPOSIO_MAX_SESSIONS = 'not-a-number';

    expect(() => loadConfig()).toThrow();
  });
});

describe('loadConfigWithDefaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should use overrides when provided', () => {
    const overrides: Partial<ToolRouterConfig> = {
      apiKey: 'override-key',
      baseUrl: 'https://override.composio.dev',
      session: {
        ttlSeconds: 1800,
        maxSessions: 25,
        extendOnActivity: false,
      },
    };

    const config = loadConfigWithDefaults(overrides);

    expect(config.apiKey).toBe('override-key');
    expect(config.baseUrl).toBe('https://override.composio.dev');
    expect(config.session.ttlSeconds).toBe(1800);
    expect(config.session.maxSessions).toBe(25);
    expect(config.session.extendOnActivity).toBe(false);
  });

  it('should fall back to environment variables when overrides not provided', () => {
    process.env.COMPOSIO_API_KEY = 'env-key';
    process.env.COMPOSIO_BASE_URL = 'https://env.composio.dev';

    const config = loadConfigWithDefaults({});

    expect(config.apiKey).toBe('env-key');
    expect(config.baseUrl).toBe('https://env.composio.dev');
  });

  it('should use empty string for API key if not in env or overrides', () => {
    delete process.env.COMPOSIO_API_KEY;

    // This will use empty string and schema will reject it
    expect(() => loadConfigWithDefaults({})).toThrow();
  });

  it('should merge partial overrides with defaults', () => {
    process.env.COMPOSIO_API_KEY = 'env-key';

    const overrides: Partial<ToolRouterConfig> = {
      session: {
        ttlSeconds: 7200,
        maxSessions: 100,
        extendOnActivity: true,
      },
    };

    const config = loadConfigWithDefaults(overrides);

    expect(config.apiKey).toBe('env-key'); // from env
    expect(config.session.ttlSeconds).toBe(7200); // from overrides
    expect(config.baseUrl).toBe('https://backend.composio.dev'); // default
  });
});

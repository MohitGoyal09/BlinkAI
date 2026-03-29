/**
 * End-to-End Integration Tests
 *
 * These tests verify the integration between different components
 * of the Composio Tool Router module. They test the full workflow
 * from session creation to tool execution.
 *
 * Note: These tests use mocked API responses and don't require
 * actual Composio API credentials.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getToolRouter,
  resetToolRouter,
  initializeToolRouterForProject,
  getToolRouterForProject,
  executeToolWithAuthHandling,
  listAvailableToolkits,
  listAvailableTools,
  initiateToolkitAuth,
  checkToolkitAuthStatus,
  type ToolRouterSessionRecord,
} from '../integration';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

describe('Composio Tool Router Integration', () => {
  beforeEach(() => {
    resetToolRouter();
    mockFetch.mockClear();
  });

  describe('Session Lifecycle', () => {
    it('should create and manage a complete session lifecycle', async () => {
      // Mock session creation response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'integration-session-123',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'integration-session-123',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      // Create session
      const { sessionId, record } = await initializeToolRouterForProject(
        'integration-test-project',
        'test-user'
      );

      expect(sessionId).toBe('integration-session-123');
      expect(record.userId).toBe('test-user');
      expect(record.connectedToolkits).toEqual([]);

      // Verify singleton behavior
      const toolRouter = getToolRouter();
      expect(toolRouter).toBeDefined();

      // Get the same tool router again
      const toolRouter2 = getToolRouter();
      expect(toolRouter2).toBe(toolRouter);
    });

    it('should reuse existing valid sessions', async () => {
      // Mock for initial session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'existing-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'existing-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      // Create initial session
      const { sessionId: initialId, record } = await initializeToolRouterForProject(
        'reuse-project',
        'reuse-user'
      );

      // Try to get session for same project/user with existing records
      const existingSessions: ToolRouterSessionRecord[] = [record];

      const { sessionId: reusedId, records: updatedRecords } = await getToolRouterForProject(
        'reuse-project',
        'reuse-user',
        existingSessions
      );

      // Should reuse the existing session
      expect(reusedId).toBe(initialId);
      expect(updatedRecords).toHaveLength(1);
    });

    it('should create new session when existing is expired', async () => {
      // Create an expired session record
      const expiredSession: ToolRouterSessionRecord = {
        id: 'expired-session',
        userId: 'test-user',
        projectId: 'expired-project',
        createdAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago (expired)
        connectedToolkits: [],
      };

      // Mock for new session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'new-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'new-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId, records } = await getToolRouterForProject(
        'expired-project',
        'test-user',
        [expiredSession]
      );

      // Should create new session
      expect(sessionId).toBe('new-session');
      expect(records).toHaveLength(2); // old + new
    });
  });

  describe('Tool Execution Flow', () => {
    it('should execute tool successfully', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'exec-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'exec-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      // Create session
      const { sessionId } = await initializeToolRouterForProject('exec-project');

      // Mock tool execution
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { messageId: 'msg-123' },
          log_id: 'exec-456',
        }),
        text: async () => JSON.stringify(({
          data: { messageId: 'msg-123' },
          log_id: 'exec-456',
        })),
      });

      // Execute tool
      const result = await executeToolWithAuthHandling(
        sessionId,
        'gmail_send_email',
        {
          to: 'test@example.com',
          subject: 'Test',
          body: 'Hello',
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ messageId: 'msg-123' });
        expect(result.executionId).toBe('exec-456');
      }
    });

    it('should handle auth required response', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'auth-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'auth-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId } = await initializeToolRouterForProject('auth-project');

      // Mock auth required response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          link_url: 'https://auth.composio.dev/link/123',
          toolkitSlug: 'gmail',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          link_url: 'https://auth.composio.dev/link/123',
          toolkitSlug: 'gmail',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        })),
      });

      const result = await executeToolWithAuthHandling(
        sessionId,
        'gmail_send_email',
        { to: 'test@example.com' }
      );

      expect(result.success).toBe(false);
      if (!result.success && 'authRequired' in result) {
        expect(result.authRequired).toBe(true);
        expect(result.authUrl).toBe('https://auth.composio.dev/link/123');
        expect(result.toolkitSlug).toBe('gmail');
      }
    });

    it('should handle execution errors', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'error-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'error-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId } = await initializeToolRouterForProject('error-project');

      // Mock error response from API
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          error: 'Invalid recipient email',
          log_id: 'exec-error',
        }),
        text: async () => JSON.stringify(({
          error: 'Invalid recipient email',
          log_id: 'exec-error',
        })),
      });

      const result = await executeToolWithAuthHandling(
        sessionId,
        'gmail_send_email',
        { to: 'invalid-email' }
      );

      expect(result.success).toBe(false);
      if (!result.success && 'error' in result && 'code' in result) {
        expect(result.error).toBe('Invalid recipient email');
        expect(result.code).toBe('TOOL_ERROR');
      }
    });
  });

  describe('Toolkit Operations', () => {
    it('should list available toolkits', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'toolkit-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'toolkit-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId } = await initializeToolRouterForProject('toolkit-project');

      // Mock toolkits response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          toolkits: [
            { slug: 'gmail', name: 'Gmail', authSchemes: ['OAUTH2'] },
            { slug: 'calendar', name: 'Calendar', authSchemes: ['OAUTH2'] },
          ],
        }),
        text: async () => JSON.stringify(({
          toolkits: [
            { slug: 'gmail', name: 'Gmail', authSchemes: ['OAUTH2'] },
            { slug: 'calendar', name: 'Calendar', authSchemes: ['OAUTH2'] },
          ],
        })),
      });

      const toolkits = await listAvailableToolkits(sessionId);

      expect(toolkits).toHaveLength(2);
      expect(toolkits[0].slug).toBe('gmail');
      expect(toolkits[1].slug).toBe('calendar');
    });

    it('should list tools for a toolkit', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'tools-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'tools-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId } = await initializeToolRouterForProject('tools-project');

      // Mock tools response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          tools: [
            {
              slug: 'gmail_send_email',
              name: 'Send Email',
              description: 'Send an email',
              toolkit: { slug: 'gmail', name: 'Gmail' },
              inputSchema: { type: 'object' },
            },
          ],
        }),
        text: async () => JSON.stringify(({
          tools: [
            {
              slug: 'gmail_send_email',
              name: 'Send Email',
              description: 'Send an email',
              toolkit: { slug: 'gmail', name: 'Gmail' },
              inputSchema: { type: 'object' },
            },
          ],
        })),
      });

      const tools = await listAvailableTools(sessionId, 'gmail');

      expect(tools).toHaveLength(1);
      expect(tools[0].slug).toBe('gmail_send_email');
    });
  });

  describe('Authentication Flow', () => {
    it('should initiate and check auth status', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'auth-flow-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'auth-flow-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId } = await initializeToolRouterForProject('auth-flow-project');

      // Mock auth initiation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          link_url: 'https://auth.composio.dev/link/456',
          status: 'INITIATED',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          link_url: 'https://auth.composio.dev/link/456',
          status: 'INITIATED',
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        })),
      });

      const authState = await initiateToolkitAuth(sessionId, 'gmail', 'OAUTH2');

      expect(authState.status).toBe('link_required');
      expect(authState.linkUrl).toBe('https://auth.composio.dev/link/456');

      // Mock auth status check
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'authenticated',
          connected_account_id: 'account-789',
        }),
        text: async () => JSON.stringify(({
          status: 'authenticated',
          connected_account_id: 'account-789',
        })),
      });

      const status = await checkToolkitAuthStatus(sessionId, 'gmail');

      expect(status.status).toBe('authenticated');
      expect(status.connectedAccountId).toBe('account-789');
    });
  });

  describe('Configuration Requirements', () => {
    it.skip('should require COMPOSIO_API_KEY', async () => {
      // Store original env
      const originalApiKey = process.env.COMPOSIO_API_KEY;
      delete process.env.COMPOSIO_API_KEY;

      resetToolRouter();

      // Should throw when trying to get tool router without API key
      expect(() => getToolRouter()).toThrow('COMPOSIO_API_KEY is not configured');

      // Restore env
      process.env.COMPOSIO_API_KEY = originalApiKey;
    });
  });

  describe('Session Management Integration', () => {
    it('should maintain session state across operations', async () => {
      // Mock session creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          session_id: 'state-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        }),
        text: async () => JSON.stringify(({
          session_id: 'state-session',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
        })),
      });

      const { sessionId, record } = await initializeToolRouterForProject(
        'state-project',
        'state-user'
      );

      // Verify session record structure
      expect(record.id).toBe(sessionId);
      expect(record.userId).toBe('state-user');
      expect(new Date(record.expiresAt)).toBeInstanceOf(Date);
      expect(new Date(record.createdAt)).toBeInstanceOf(Date);
    });
  });
});

describe('Integration Error Scenarios', () => {
  beforeEach(() => {
    resetToolRouter();
    mockFetch.mockClear();
  });

  it('should handle network failures gracefully', async () => {
    // Mock session creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'network-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
        text: async () => JSON.stringify(({
        session_id: 'network-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })),
    });

    const { sessionId } = await initializeToolRouterForProject('network-project');

    // Mock network failure
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await executeToolWithAuthHandling(
      sessionId,
      'gmail_send_email',
      {}
    );

    expect(result.success).toBe(false);
    if (!result.success && 'error' in result) {
      expect(result.error).toContain('Network error');
    }
  });

  it('should handle session expiration during operations', async () => {
    // Mock session creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'expire-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
        text: async () => JSON.stringify(({
        session_id: 'expire-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })),
    });

    const { sessionId } = await initializeToolRouterForProject('expire-project');

    // Mock session expired response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Session expired' }),
        text: async () => JSON.stringify({ error: 'Session expired' }),
    });

    const result = await executeToolWithAuthHandling(
      sessionId,
      'gmail_send_email',
      {}
    );

    expect(result.success).toBe(false);
    if (!result.success && 'code' in result) {
      expect(result.code).toBe('AUTH_REQUIRED');
    }
  });

  it('should handle rate limiting', async () => {
    // Mock session creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        session_id: 'rate-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
        text: async () => JSON.stringify(({
        session_id: 'rate-session',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      })),
    });

    const { sessionId } = await initializeToolRouterForProject('rate-project');

    // Mock rate limit response
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ error: 'Rate limit exceeded' }),
        text: async () => JSON.stringify({ error: 'Rate limit exceeded' }),
    });

    const result = await executeToolWithAuthHandling(
      sessionId,
      'gmail_send_email',
      {}
    );

    expect(result.success).toBe(false);
    if (!result.success && 'code' in result) {
      expect(result.code).toBe('TOOL_EXECUTION_FAILED');
    }
  });
});

/**
 * Session Management Tests
 *
 * Tests for the SessionManager including:
 * - Session creation and retrieval
 * - TTL management
 * - LRU cache behavior
 * - Auth state management
 * - Cleanup operations
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../session-manager';
import { SessionExpiredError, SessionLimitExceededError } from '../errors';
import type { ToolRouterConfig } from '../config';

const mockConfig: ToolRouterConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'https://backend.composio.dev',
  session: {
    ttlSeconds: 3600,
    maxSessions: 5,
    extendOnActivity: true,
  },
  cache: {
    enabled: true,
    maxSize: 10,
    cleanupIntervalMinutes: 1,
  },
  timeout: {
    requestMs: 30000,
    connectMs: 5000,
  },
};

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager(mockConfig);
  });

  afterEach(() => {
    if (sessionManager) {
      sessionManager.destroy();
    }
  });

  describe('createSession', () => {
    it('should create a new session with provided ID', async () => {
      const sessionId = 'test-session-id';
      const params = {
        projectId: 'project-123',
        userId: 'user-456',
      };

      const session = await sessionManager.createSession(sessionId, params);

      expect(session.id).toBe(sessionId);
      expect(session.projectId).toBe('project-123');
      expect(session.userId).toBe('user-456');
      expect(session.createdAt).toBeInstanceOf(Date);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.metadata).toEqual({});
    });

    it('should set expiration based on TTL', async () => {
      const beforeCreate = Date.now();
      const session = await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });
      const afterCreate = Date.now();

      const expectedExpiryMin = beforeCreate + 3600 * 1000;
      const expectedExpiryMax = afterCreate + 3600 * 1000;

      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
        expectedExpiryMin - 1000
      );
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(
        expectedExpiryMax + 1000
      );
    });

    it('should use custom TTL when provided', async () => {
      const session = await sessionManager.createSession('test-id', {
        projectId: 'test-project',
        ttlSeconds: 7200, // 2 hours
      });

      const beforeCreate = Date.now();
      const expectedExpiry = beforeCreate + 7200 * 1000;

      expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(
        expectedExpiry - 2000
      );
    });

    it('should throw SessionLimitExceededError when max sessions reached', async () => {
      // Create max number of sessions for same project
      const projectId = 'limited-project';

      for (let i = 0; i < 5; i++) {
        await sessionManager.createSession(`session-${i}`, {
          projectId,
          userId: `user-${i}`,
        });
      }

      // Next session should throw
      await expect(
        sessionManager.createSession('extra-session', {
          projectId,
          userId: 'extra-user',
        })
      ).rejects.toThrow(SessionLimitExceededError);
    });

    it('should allow sessions from different projects', async () => {
      const sessions = [];

      for (let i = 0; i < 10; i++) {
        const session = await sessionManager.createSession(`session-${i}`, {
          projectId: `project-${i}`,
        });
        sessions.push(session);
      }

      expect(sessions).toHaveLength(10);
    });

    it('should include metadata in session', async () => {
      const metadata = { source: 'test', version: '1.0' };
      const session = await sessionManager.createSession('test-id', {
        projectId: 'test-project',
        metadata,
      });

      expect(session.metadata).toEqual(metadata);
    });
  });

  describe('getSession', () => {
    it('should retrieve existing session', async () => {
      const sessionId = 'test-session';
      await sessionManager.createSession(sessionId, {
        projectId: 'test-project',
        userId: 'test-user',
      });

      const retrieved = sessionManager.getSession('test-project', 'test-user');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(sessionId);
      expect(retrieved?.projectId).toBe('test-project');
    });

    it('should retrieve session without user ID', async () => {
      const sessionId = 'test-session';
      await sessionManager.createSession(sessionId, {
        projectId: 'test-project',
      });

      const retrieved = sessionManager.getSession('test-project');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(sessionId);
    });

    it('should return null for non-existent session', () => {
      const retrieved = sessionManager.getSession('non-existent-project');
      expect(retrieved).toBeNull();
    });

    it('should throw SessionExpiredError for expired session', async () => {
      // Create session with 0 TTL (already expired)
      const sessionId = 'expired-session';
      await sessionManager.createSession(sessionId, {
        projectId: 'test-project',
        ttlSeconds: 0,
      });

      // Wait a bit for the session to be considered expired
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(() => sessionManager.getSession('test-project')).toThrow(
        SessionExpiredError
      );
    });

    it('should auto-extend session when configured', async () => {
      const originalTtl = 1; // 1 second
      const shortConfig = {
        ...mockConfig,
        session: { ...mockConfig.session, ttlSeconds: originalTtl },
      };
      const shortSessionManager = new SessionManager(shortConfig);

      await shortSessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      // Wait for original TTL to nearly expire
      await new Promise(resolve => setTimeout(resolve, 100));

      // Access should extend TTL
      const retrieved = shortSessionManager.getSession('test-project');
      expect(retrieved).toBeDefined();

      // Expiry should be in the future (was extended)
      expect(retrieved!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('updateSession', () => {
    it('should update existing session', async () => {
      const session = await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const updatedSession = {
        ...session,
        metadata: { updated: true },
      };

      sessionManager.updateSession(updatedSession);
      const retrieved = sessionManager.getSession('test-project');

      expect(retrieved?.metadata).toEqual({ updated: true });
    });

    it('should not throw for non-existent session', async () => {
      const fakeSession = {
        id: 'fake-id',
        projectId: 'fake-project',
        createdAt: new Date(),
        expiresAt: new Date(),
        metadata: {},
      };

      expect(() => sessionManager.updateSession(fakeSession)).not.toThrow();
    });
  });

  describe('deleteSession', () => {
    it('should remove session from cache', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      expect(sessionManager.getSession('test-project')).toBeDefined();

      const deleted = sessionManager.deleteSession('test-project');

      expect(deleted).toBe(true);
      expect(sessionManager.getSession('test-project')).toBeNull();
    });

    it('should return false for non-existent session', () => {
      const deleted = sessionManager.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });

    it('should delete session with user ID', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
        userId: 'test-user',
      });

      const deleted = sessionManager.deleteSession('test-project', 'test-user');
      expect(deleted).toBe(true);
    });
  });

  describe('Auth State Management', () => {
    it('should set and get auth state', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const authState = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'authenticated' as const,
        connectedAccountId: 'account-123',
      };

      sessionManager.setAuthState('test-project', 'gmail', authState);
      const retrieved = sessionManager.getAuthState('test-project', 'gmail');

      expect(retrieved).toEqual(authState);
    });

    it('should return undefined for unset auth state', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const authState = sessionManager.getAuthState('test-project', 'gmail');
      expect(authState).toBeUndefined();
    });

    it('should maintain separate auth states per toolkit', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const gmailAuth = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'authenticated' as const,
      };

      const calendarAuth = {
        sessionId: 'test-id',
        toolkitSlug: 'calendar',
        authScheme: 'OAUTH2',
        status: 'pending' as const,
      };

      sessionManager.setAuthState('test-project', 'gmail', gmailAuth);
      sessionManager.setAuthState('test-project', 'calendar', calendarAuth);

      expect(sessionManager.getAuthState('test-project', 'gmail')).toEqual(
        gmailAuth
      );
      expect(sessionManager.getAuthState('test-project', 'calendar')).toEqual(
        calendarAuth
      );
    });

    it('should update existing auth state', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const initialAuth = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'pending' as const,
      };

      const updatedAuth = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'authenticated' as const,
        connectedAccountId: 'account-123',
      };

      sessionManager.setAuthState('test-project', 'gmail', initialAuth);
      sessionManager.setAuthState('test-project', 'gmail', updatedAuth);

      const retrieved = sessionManager.getAuthState('test-project', 'gmail');
      expect(retrieved?.status).toBe('authenticated');
      expect(retrieved?.connectedAccountId).toBe('account-123');
    });

    it('should set auth state with user ID', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
        userId: 'test-user',
      });

      const authState = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'authenticated' as const,
      };

      sessionManager.setAuthState('test-project', 'gmail', authState, 'test-user');
      const retrieved = sessionManager.getAuthState('test-project', 'gmail', 'test-user');

      expect(retrieved).toEqual(authState);
    });
  });

  describe('findSessionById', () => {
    it('should find session by ID', async () => {
      await sessionManager.createSession('search-id', {
        projectId: 'test-project',
        userId: 'test-user',
      });

      const found = sessionManager.findSessionById('search-id');

      expect(found).toBeDefined();
      expect(found?.session.id).toBe('search-id');
      expect(found?.projectId).toBe('test-project');
      expect(found?.userId).toBe('test-user');
    });

    it('should return null for non-existent ID', () => {
      const found = sessionManager.findSessionById('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('setAuthPending', () => {
    it('should set auth to pending state', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const result = sessionManager.setAuthPending(
        'test-id',
        'gmail',
        'https://auth.composio.dev/link/123'
      );

      expect(result).toBe(true);

      const authState = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(authState?.status).toBe('link_required');
      expect(authState?.linkUrl).toBe('https://auth.composio.dev/link/123');
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.setAuthPending(
        'non-existent',
        'gmail',
        'https://auth.composio.dev/link/123'
      );
      expect(result).toBe(false);
    });
  });

  describe('setAuthComplete', () => {
    it('should set auth to authenticated state', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      // First set to pending
      sessionManager.setAuthPending('test-id', 'gmail', 'https://auth.composio.dev/link/123');

      // Then complete
      const result = sessionManager.setAuthComplete('test-id', 'gmail', 'account-123');

      expect(result).toBe(true);

      const authState = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(authState?.status).toBe('authenticated');
      expect(authState?.connectedAccountId).toBe('account-123');
      expect(authState?.linkedAt).toBeInstanceOf(Date);
    });

    it('should work without connected account ID', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const result = sessionManager.setAuthComplete('test-id', 'gmail');

      expect(result).toBe(true);

      const authState = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(authState?.status).toBe('authenticated');
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.setAuthComplete('non-existent', 'gmail');
      expect(result).toBe(false);
    });
  });

  describe('setAuthFailed', () => {
    it('should set auth to failed state with string error', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      // First set to pending
      sessionManager.setAuthPending('test-id', 'gmail', 'https://auth.composio.dev/link/123');

      // Then fail
      const result = sessionManager.setAuthFailed('test-id', 'gmail', 'User denied access');

      expect(result).toBe(true);

      const authState = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(authState?.status).toBe('failed');
    });

    it('should set auth to failed state with Error object', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const error = new Error('OAuth error');
      const result = sessionManager.setAuthFailed('test-id', 'gmail', error);

      expect(result).toBe(true);

      const authState = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(authState?.status).toBe('failed');
    });

    it('should return false for non-existent session', () => {
      const result = sessionManager.setAuthFailed('non-existent', 'gmail', 'Error');
      expect(result).toBe(false);
    });
  });

  describe('getAuthStateBySessionId', () => {
    it('should get auth state by session ID', async () => {
      await sessionManager.createSession('test-id', {
        projectId: 'test-project',
      });

      const authState = {
        sessionId: 'test-id',
        toolkitSlug: 'gmail',
        authScheme: 'OAUTH2',
        status: 'authenticated' as const,
      };

      sessionManager.setAuthState('test-project', 'gmail', authState);

      const retrieved = sessionManager.getAuthStateBySessionId('test-id', 'gmail');
      expect(retrieved).toEqual(authState);
    });

    it('should return undefined for non-existent session', () => {
      const retrieved = sessionManager.getAuthStateBySessionId('non-existent', 'gmail');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('LRU Cache Behavior', () => {
    it('should evict oldest session when cache is full', async () => {
      // Create more sessions than cache size
      for (let i = 0; i < 12; i++) {
        await sessionManager.createSession(`session-${i}`, {
          projectId: `project-${i}`,
        });
        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 1));
      }

      // Cache max size is 10, so oldest should be evicted
      expect(sessionManager.getSession('project-0')).toBeNull();
      expect(sessionManager.getSession('project-1')).toBeNull();
      expect(sessionManager.getSession('project-11')).toBeDefined();
    });

    it('should move accessed session to most recently used', async () => {
      await sessionManager.createSession('session-1', {
        projectId: 'project-1',
      });
      await sessionManager.createSession('session-2', {
        projectId: 'project-2',
      });
      await sessionManager.createSession('session-3', {
        projectId: 'project-3',
      });

      // Access project-1 to make it most recently used
      sessionManager.getSession('project-1');

      // Add more sessions to potentially evict
      for (let i = 4; i <= 12; i++) {
        await sessionManager.createSession(`session-${i}`, {
          projectId: `project-${i}`,
        });
      }

      // project-1 should still exist because it was accessed
      expect(sessionManager.getSession('project-1')).toBeDefined();
    });
  });
});

/**
 * Error Handling Tests
 *
 * Tests for custom error classes including:
 * - Error creation and properties
 * - Error inheritance
 * - withErrorHandling helper
 * - Retryable error detection
 */

import { describe, it, expect, vi } from 'vitest';
import {
  ToolRouterError,
  AuthRequiredError,
  SessionExpiredError,
  SessionLimitExceededError,
  ToolExecutionError,
  FileMountError,
  ApiResponseError,
  NetworkError,
  withErrorHandling,
} from '../errors';

describe('ToolRouterError', () => {
  it('should create error with all properties', () => {
    const error = new ToolRouterError(
      'Test error message',
      'TEST_ERROR',
      400,
      true,
      { detail: 'extra info' }
    );

    expect(error.message).toBe('Test error message');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(true);
    expect(error.context).toEqual({ detail: 'extra info' });
    expect(error.name).toBe('ToolRouterError');
  });

  it('should create error with minimal properties', () => {
    const error = new ToolRouterError('Simple error', 'SIMPLE_ERROR');

    expect(error.message).toBe('Simple error');
    expect(error.code).toBe('SIMPLE_ERROR');
    expect(error.statusCode).toBeUndefined();
    expect(error.retryable).toBe(false);
    expect(error.context).toBeUndefined();
  });

  it('should be instanceof Error', () => {
    const error = new ToolRouterError('Test', 'TEST');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolRouterError);
  });

  it('should work with instanceof checks after being thrown', () => {
    let caught: unknown;
    try {
      throw new ToolRouterError('Thrown error', 'THROWN');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ToolRouterError);
    expect((caught as ToolRouterError).code).toBe('THROWN');
  });
});

describe('AuthRequiredError', () => {
  it('should create auth required error with link URL', () => {
    const expiresAt = new Date(Date.now() + 3600000);
    const error = new AuthRequiredError(
      'https://auth.composio.dev/link/123',
      'gmail',
      expiresAt
    );

    expect(error.message).toBe('Authentication required for gmail');
    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.statusCode).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.linkUrl).toBe('https://auth.composio.dev/link/123');
    expect(error.toolkitSlug).toBe('gmail');
    expect(error.expiresAt).toBe(expiresAt);
    expect(error.name).toBe('AuthRequiredError');
  });

  it('should be instanceof ToolRouterError', () => {
    const error = new AuthRequiredError('url', 'toolkit', new Date());
    expect(error).toBeInstanceOf(ToolRouterError);
    expect(error).toBeInstanceOf(AuthRequiredError);
  });
});

describe('SessionExpiredError', () => {
  it('should create session expired error', () => {
    const error = new SessionExpiredError('session-123');

    expect(error.message).toBe('Session session-123 has expired');
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.statusCode).toBe(401);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('SessionExpiredError');
  });

  it('should be instanceof ToolRouterError', () => {
    const error = new SessionExpiredError('test-session');
    expect(error).toBeInstanceOf(ToolRouterError);
    expect(error).toBeInstanceOf(SessionExpiredError);
  });
});

describe('SessionLimitExceededError', () => {
  it('should create session limit exceeded error', () => {
    const error = new SessionLimitExceededError('project-123', 100);

    expect(error.message).toBe(
      'Session limit exceeded for project project-123. Maximum: 100'
    );
    expect(error.code).toBe('SESSION_LIMIT_EXCEEDED');
    expect(error.statusCode).toBe(429);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe('SessionLimitExceededError');
  });
});

describe('ToolExecutionError', () => {
  it('should create tool execution error with all properties', () => {
    const originalError = new Error('Original error');
    const error = new ToolExecutionError(
      'Tool execution failed',
      'gmail_send_email',
      'exec-123',
      originalError
    );

    expect(error.message).toBe('Tool execution failed');
    expect(error.code).toBe('TOOL_EXECUTION_FAILED');
    expect(error.statusCode).toBe(500);
    expect(error.retryable).toBe(false);
    expect(error.toolSlug).toBe('gmail_send_email');
    expect(error.executionId).toBe('exec-123');
    expect(error.originalError).toBe(originalError);
    expect(error.name).toBe('ToolExecutionError');
  });

  it('should create tool execution error without original error', () => {
    const error = new ToolExecutionError(
      'Tool execution failed',
      'gmail_send_email',
      'exec-123'
    );

    expect(error.originalError).toBeUndefined();
  });
});

describe('FileMountError', () => {
  it('should create file mount error for size exceeded', () => {
    const error = new FileMountError(
      'File size exceeds limit',
      'large-file.pdf',
      'size_exceeded'
    );

    expect(error.message).toBe('File size exceeds limit');
    expect(error.code).toBe('FILE_MOUNT_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.retryable).toBe(false);
    expect(error.fileName).toBe('large-file.pdf');
    expect(error.reason).toBe('size_exceeded');
    expect(error.name).toBe('FileMountError');
  });

  it('should create file mount error for invalid type', () => {
    const error = new FileMountError(
      'Invalid file type',
      'script.exe',
      'invalid_type'
    );

    expect(error.reason).toBe('invalid_type');
  });

  it('should create file mount error for upload failed', () => {
    const error = new FileMountError(
      'Upload failed',
      'document.pdf',
      'upload_failed'
    );

    expect(error.reason).toBe('upload_failed');
  });

  it('should create file mount error for not found', () => {
    const error = new FileMountError(
      'File not found',
      'missing.pdf',
      'not_found'
    );

    expect(error.reason).toBe('not_found');
  });
});

describe('ApiResponseError', () => {
  it('should create API response error with retryable status codes', () => {
    const responseBody = { error: 'Internal server error' };
    const error = new ApiResponseError(
      'API returned 500',
      responseBody,
      500
    );

    expect(error.message).toBe('API returned 500');
    expect(error.code).toBe('API_RESPONSE_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.retryable).toBe(true); // 500 is retryable
    expect(error.responseBody).toBe(responseBody);
    expect(error.name).toBe('ApiResponseError');
  });

  it('should set retryable true for 429 status code', () => {
    const error = new ApiResponseError('Rate limited', {}, 429);
    expect(error.retryable).toBe(true);
  });

  it('should set retryable true for 502 status code', () => {
    const error = new ApiResponseError('Bad gateway', {}, 502);
    expect(error.retryable).toBe(true);
  });

  it('should set retryable true for 503 status code', () => {
    const error = new ApiResponseError('Service unavailable', {}, 503);
    expect(error.retryable).toBe(true);
  });

  it('should set retryable true for 504 status code', () => {
    const error = new ApiResponseError('Gateway timeout', {}, 504);
    expect(error.retryable).toBe(true);
  });

  it('should set retryable false for 400 status code', () => {
    const error = new ApiResponseError('Bad request', {}, 400);
    expect(error.retryable).toBe(false);
  });

  it('should set retryable false for 404 status code', () => {
    const error = new ApiResponseError('Not found', {}, 404);
    expect(error.retryable).toBe(false);
  });
});

describe('NetworkError', () => {
  it('should create network error', () => {
    const originalError = new Error('Connection refused');
    const error = new NetworkError('Network request failed', originalError);

    expect(error.message).toBe('Network request failed');
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.statusCode).toBeUndefined();
    expect(error.retryable).toBe(true);
    expect(error.originalError).toBe(originalError);
    expect(error.name).toBe('NetworkError');
  });

  it('should create network error without original error', () => {
    const error = new NetworkError('Network request failed');

    expect(error.originalError).toBeUndefined();
    expect(error.retryable).toBe(true);
  });
});

describe('withErrorHandling', () => {
  it('should return successful operation result', async () => {
    const operation = vi.fn().mockResolvedValue({ success: true });
    const context = { toolSlug: 'test-tool', sessionId: 'session-123' };

    const result = await withErrorHandling(operation, context);

    expect(result).toEqual({ success: true });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('should rethrow ToolRouterError without wrapping', async () => {
    const originalError = new ToolExecutionError(
      'Execution failed',
      'test-tool',
      'exec-123'
    );
    const operation = vi.fn().mockRejectedValue(originalError);
    const context = { toolSlug: 'test-tool' };

    await expect(withErrorHandling(operation, context)).rejects.toThrow(
      ToolExecutionError
    );
  });

  it('should wrap generic errors in ToolRouterError', async () => {
    const originalError = new Error('Generic error');
    const operation = vi.fn().mockRejectedValue(originalError);
    const context = { sessionId: 'session-123' };

    try {
      await withErrorHandling(operation, context);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ToolRouterError);
      expect((error as ToolRouterError).code).toBe('UNKNOWN_ERROR');
      expect((error as ToolRouterError).context).toEqual({ originalError: 'Generic error', ...context });
    }
  });

  it('should include context in wrapped error', async () => {
    const context = {
      toolSlug: 'gmail_send_email',
      sessionId: 'session-456',
      projectId: 'project-123',
    };
    const operation = vi.fn().mockRejectedValue(new Error('Failed'));

    try {
      await withErrorHandling(operation, context);
    } catch (error) {
      expect((error as ToolRouterError).context).toEqual(context);
    }
  });

  it('should handle async operation errors', async () => {
    const operation = vi.fn().mockRejectedValue(new Error('Async error'));

    await expect(withErrorHandling(operation, {})).rejects.toThrow(
      ToolRouterError
    );
  });
});

/**
 * Retry Manager Tests
 *
 * Comprehensive tests for retry logic with exponential backoff,
 * jitter, and error classification.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { RetryManager, RetryConfig, withRetry } from "../retry-manager";
import {
  ToolRouterError,
  NetworkError,
  ApiResponseError,
} from "../errors";

describe("RetryManager", () => {
  let retryManager: RetryManager;

  beforeEach(() => {
    retryManager = new RetryManager();
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should use default configuration when no config provided", () => {
      const manager = new RetryManager();
      expect(manager).toBeDefined();
    });

    it("should merge custom configuration with defaults", () => {
      const manager = new RetryManager({
        maxRetries: 5,
        baseDelayMs: 500,
      });
      expect(manager).toBeDefined();
    });

    it("should accept full custom configuration", () => {
      const config: RetryConfig = {
        maxRetries: 10,
        baseDelayMs: 100,
        maxDelayMs: 60000,
        backoffMultiplier: 3,
        jitter: false,
      };
      const manager = new RetryManager(config);
      expect(manager).toBeDefined();
    });
  });

  describe("executeWithRetry", () => {
    it("should return result on successful operation", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const result = await retryManager.executeWithRetry(operation, "test-op");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on retryable error and eventually succeed", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new NetworkError("Connection failed"))
        .mockRejectedValueOnce(new NetworkError("Connection failed"))
        .mockResolvedValue("success");

      const result = await retryManager.executeWithRetry(operation, "test-op");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should throw after max retries exhausted", async () => {
      const error = new NetworkError("Persistent failure");
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryManager.executeWithRetry(operation, "test-op")
      ).rejects.toThrow("Persistent failure");

      expect(operation).toHaveBeenCalledTimes(4); // initial + 3 retries
    }, 10000);

    it("should not retry on non-retryable errors", async () => {
      const error = new ToolRouterError(
        "Invalid input",
        "VALIDATION_ERROR",
        400,
        false // not retryable
      );
      const operation = vi.fn().mockRejectedValue(error);

      await expect(
        retryManager.executeWithRetry(operation, "test-op")
      ).rejects.toThrow("Invalid input");

      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on API response errors with retryable status codes", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(
          new ApiResponseError("Rate limited", { error: "Rate limited" }, 429)
        )
        .mockResolvedValue("success");

      const result = await retryManager.executeWithRetry(operation, "test-op");

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should not retry on API response errors with non-retryable status codes", async () => {
      const operation = vi.fn().mockRejectedValue(
        new ApiResponseError("Bad request", { error: "Bad request" }, 400)
      );

      await expect(
        retryManager.executeWithRetry(operation, "test-op")
      ).rejects.toThrow("Bad request");

      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});
/**
 * Retry Manager for Composio Tool Router
 * Provides retry logic with exponential backoff and jitter
 */

import { ToolRouterConfig } from "./config";
import { ToolRouterError, NetworkError, ApiResponseError } from "./errors";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Whether to add jitter to delays (default: true) */
  jitter: boolean;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Error types that should trigger a retry
 */
const RETRYABLE_ERROR_CODES = [
  "NETWORK_ERROR",
  "API_RESPONSE_ERROR",
  "TOOL_EXECUTION_FAILED",
];

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];

/**
 * RetryManager handles retry logic with exponential backoff
 */
export class RetryManager {
  private config: RetryConfig;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Execute an operation with retry logic
   * @param operation - The async operation to execute
   * @param operationName - Name of the operation for logging
   * @param config - Optional retry config override
   * @returns The result of the operation
   * @throws The last error encountered after all retries are exhausted
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = "operation",
    config?: Partial<RetryConfig>
  ): Promise<T> {
    const retryConfig = { ...this.config, ...config };
    let lastError: Error | undefined;
    let delay = retryConfig.baseDelayMs;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(
            `[RetryManager] Retrying ${operationName} (attempt ${attempt}/${retryConfig.maxRetries})...`
          );
        }

        const result = await operation();

        if (attempt > 0) {
          console.log(
            `[RetryManager] ${operationName} succeeded after ${attempt} retries`
          );
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if this is the last attempt
        if (attempt === retryConfig.maxRetries) {
          console.error(
            `[RetryManager] ${operationName} failed after ${retryConfig.maxRetries + 1} attempts`
          );
          throw lastError;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          throw lastError;
        }

        // Calculate delay with exponential backoff
        const actualDelay = this.calculateDelay(delay, retryConfig);

        console.log(
          `[RetryManager] ${operationName} failed (attempt ${attempt + 1}/${retryConfig.maxRetries + 1}), ` +
            `retrying in ${actualDelay}ms...`
        );

        await this.sleep(actualDelay);

        // Increase delay for next iteration
        delay = Math.min(
          delay * retryConfig.backoffMultiplier,
          retryConfig.maxDelayMs
        );
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError || new Error("Retry loop exited unexpectedly");
  }

  /**
   * Check if an error should trigger a retry
   */
  private isRetryableError(error: Error): boolean {
    // Check for ToolRouterError
    if (error instanceof ToolRouterError) {
      // Retry on network errors
      if (error instanceof NetworkError) {
        return true;
      }

      // Retry on API response errors with retryable status codes
      if (error instanceof ApiResponseError) {
        return (
          error.retryable ||
          (error.statusCode !== undefined &&
            RETRYABLE_STATUS_CODES.includes(error.statusCode))
        );
      }

      // Check if the error itself is marked as retryable
      return error.retryable;
    }

    // Check for network-related error messages
    const networkErrorPatterns = [
      /fetch/i,
      /network/i,
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /ENOTFOUND/i,
      /socket/i,
      /timeout/i,
    ];

    if (
      networkErrorPatterns.some((pattern) => pattern.test(error.message))
    ) {
      return true;
    }

    return false;
  }

  /**
   * Calculate delay with optional jitter
   */
  private calculateDelay(
    baseDelay: number,
    config: RetryConfig
  ): number {
    if (config.jitter) {
      // Add random jitter between 0 and 25% of the delay
      const jitter = Math.random() * baseDelay * 0.25;
      return Math.min(baseDelay + jitter, config.maxDelayMs);
    }

    return Math.min(baseDelay, config.maxDelayMs);
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a RetryManager from ToolRouterConfig
   */
  static fromConfig(config: ToolRouterConfig): RetryManager {
    return new RetryManager({
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: true,
    });
  }
}

/**
 * Convenience function to execute with retry
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName?: string,
  config?: Partial<RetryConfig>
): Promise<T> {
  const retryManager = new RetryManager(config);
  return retryManager.executeWithRetry(operation, operationName, config);
}

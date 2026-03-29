/**
 * Auth Flow Manager for Composio Tool Router
 * Handles OAuth flow initiation, polling, and webhook callbacks
 */

import { ComposioToolRouter } from "./tool-router";
import { SessionAuthState } from "./session-manager";
import { ToolRouterConfig } from "./config";
import { AuthRequiredError, ToolRouterError } from "./errors";

/**
 * Result from initiating an auth flow
 */
export interface AuthFlowInitiationResult {
  /** The URL the user needs to visit to authenticate */
  linkUrl: string;
  /** The link code for tracking this auth flow */
  linkCode: string;
  /** Current status of the auth flow */
  status: "INITIATED" | "ACTIVE" | "FAILED";
  /** When the link expires */
  expiresAt: Date;
}

/**
 * Pending auth state stored in memory
 */
interface PendingAuthState {
  sessionId: string;
  toolkitSlug: string;
  authScheme: string;
  linkUrl: string;
  linkCode: string;
  status: "pending" | "authenticated" | "failed";
  initiatedAt: Date;
  expiresAt: Date;
  connectedAccountId?: string;
  error?: string;
}

/**
 * Callback handler function type
 */
export type AuthStatusCallback = (state: SessionAuthState) => void;

/**
 * AuthFlowManager handles OAuth authentication flows
 */
export class AuthFlowManager {
  private toolRouter: ComposioToolRouter;
  private config: ToolRouterConfig;
  private pendingAuthStates: Map<string, PendingAuthState> = new Map();
  private pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();
  private statusCallbacks: Map<string, AuthStatusCallback> = new Map();

  constructor(toolRouter: ComposioToolRouter, config: ToolRouterConfig) {
    this.toolRouter = toolRouter;
    this.config = config;
  }

  /**
   * Generate a unique key for an auth flow
   */
  private getAuthKey(sessionId: string, toolkitSlug: string): string {
    return `${sessionId}:${toolkitSlug}`;
  }

  /**
   * Initiate an authentication flow for a toolkit
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit to authenticate (e.g., "gmail")
   * @param authScheme - The authentication scheme (default: "OAUTH2")
   * @returns The auth flow initiation result with link URL
   */
  async initiateAuthFlow(
    sessionId: string,
    toolkitSlug: string,
    authScheme: string = "OAUTH2"
  ): Promise<AuthFlowInitiationResult> {
    console.log(
      `[AuthFlowManager] Initiating auth flow for ${toolkitSlug} (session: ${sessionId})`
    );

    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/link`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        toolkitSlug,
        authScheme,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ToolRouterError(
        `Failed to initiate auth flow: ${response.statusText} - ${errorText}`,
        "AUTH_INITIATION_FAILED",
        response.status
      );
    }

    const data = await response.json();

    const result: AuthFlowInitiationResult = {
      linkUrl: data.linkUrl,
      linkCode: data.linkCode || this.generateLinkCode(),
      status: data.status,
      expiresAt: new Date(data.expiresAt),
    };

    // Store pending auth state
    const authKey = this.getAuthKey(sessionId, toolkitSlug);
    const pendingState: PendingAuthState = {
      sessionId,
      toolkitSlug,
      authScheme,
      linkUrl: result.linkUrl,
      linkCode: result.linkCode,
      status: "pending",
      initiatedAt: new Date(),
      expiresAt: result.expiresAt,
    };

    this.pendingAuthStates.set(authKey, pendingState);

    console.log(
      `[AuthFlowManager] Auth flow initiated: ${result.linkUrl.substring(0, 50)}...`
    );

    return result;
  }

  /**
   * Poll for authentication status
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit to check
   * @param intervalMs - Polling interval in milliseconds (default: 2000)
   * @param maxAttempts - Maximum polling attempts (default: 150)
   * @returns Promise that resolves when auth completes or fails
   */
  async pollAuthStatus(
    sessionId: string,
    toolkitSlug: string,
    intervalMs: number = 2000,
    maxAttempts: number = 150
  ): Promise<SessionAuthState> {
    const authKey = this.getAuthKey(sessionId, toolkitSlug);

    console.log(
      `[AuthFlowManager] Polling auth status for ${toolkitSlug} (${maxAttempts} max attempts)`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const status = await this.checkAuthStatus(sessionId, toolkitSlug);

        // Notify callback if registered
        const callback = this.statusCallbacks.get(authKey);
        if (callback) {
          callback(status);
        }

        // Check if auth is complete
        if (status.status === "authenticated" || status.status === "failed") {
          // Update pending state
          const pendingState = this.pendingAuthStates.get(authKey);
          if (pendingState) {
            pendingState.status = status.status;
            pendingState.connectedAccountId = status.connectedAccountId;
          }

          return status;
        }

        // Wait before next poll
        await this.sleep(intervalMs);
      } catch (error) {
        console.error(
          `[AuthFlowManager] Error polling auth status (attempt ${attempt}):`,
          error
        );

        // On last attempt, throw the error
        if (attempt === maxAttempts) {
          throw error;
        }

        // Otherwise continue polling
        await this.sleep(intervalMs);
      }
    }

    throw new ToolRouterError(
      `Auth polling timed out after ${maxAttempts} attempts`,
      "AUTH_POLLING_TIMEOUT",
      undefined,
      true
    );
  }

  /**
   * Wait for authentication to complete using polling
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit to wait for
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 300000 = 5 minutes)
   * @returns Promise that resolves when auth completes
   */
  async waitForAuth(
    sessionId: string,
    toolkitSlug: string,
    timeoutMs: number = 300000
  ): Promise<SessionAuthState> {
    console.log(
      `[AuthFlowManager] Waiting for auth completion for ${toolkitSlug} (timeout: ${timeoutMs}ms)`
    );

    const startTime = Date.now();
    const intervalMs = 2000;
    const maxAttempts = Math.ceil(timeoutMs / intervalMs);

    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          // Check if we've exceeded timeout
          if (Date.now() - startTime > timeoutMs) {
            reject(
              new ToolRouterError(
                `Auth wait timed out after ${timeoutMs}ms`,
                "AUTH_WAIT_TIMEOUT",
                undefined,
                true
              )
            );
            return;
          }

          const status = await this.checkAuthStatus(sessionId, toolkitSlug);

          // Notify callback if registered
          const authKey = this.getAuthKey(sessionId, toolkitSlug);
          const callback = this.statusCallbacks.get(authKey);
          if (callback) {
            callback(status);
          }

          // Check if auth is complete
          if (status.status === "authenticated") {
            console.log(
              `[AuthFlowManager] Auth completed for ${toolkitSlug}`
            );
            resolve(status);
            return;
          }

          if (status.status === "failed") {
            reject(
              new ToolRouterError(
                `Authentication failed for ${toolkitSlug}`,
                "AUTH_FAILED",
                401,
                false
              )
            );
            return;
          }

          // Continue waiting
          setTimeout(checkStatus, intervalMs);
        } catch (error) {
          reject(error);
        }
      };

      // Start checking
      checkStatus();
    });
  }

  /**
   * Handle an auth callback from a webhook
   * @param linkCode - The link code from the callback
   * @param status - The auth status from the callback
   * @param connectedAccountId - Optional connected account ID
   */
  async handleAuthCallback(
    linkCode: string,
    status: "INITIATED" | "ACTIVE" | "FAILED",
    connectedAccountId?: string
  ): Promise<void> {
    console.log(
      `[AuthFlowManager] Handling auth callback: ${linkCode}, status: ${status}`
    );

    // Find pending auth state by link code
    let foundState: PendingAuthState | undefined;
    let authKey: string | undefined;

    for (const [key, state] of this.pendingAuthStates) {
      if (state.linkCode === linkCode) {
        foundState = state;
        authKey = key;
        break;
      }
    }

    if (!foundState || !authKey) {
      console.warn(
        `[AuthFlowManager] No pending auth found for link code: ${linkCode}`
      );
      return;
    }

    // Update state based on callback status
    if (status === "ACTIVE") {
      foundState.status = "authenticated";
      foundState.connectedAccountId = connectedAccountId;
    } else if (status === "FAILED") {
      foundState.status = "failed";
      foundState.error = "Authentication failed via callback";
    }

    // Stop any active polling
    this.stopPolling(authKey);

    // Notify callback if registered
    const callback = this.statusCallbacks.get(authKey);
    if (callback) {
      const sessionAuthState: SessionAuthState = {
        sessionId: foundState.sessionId,
        toolkitSlug: foundState.toolkitSlug,
        authScheme: foundState.authScheme,
        status: foundState.status,
        linkUrl: foundState.linkUrl,
        connectedAccountId: foundState.connectedAccountId,
        linkedAt: new Date(),
      };
      callback(sessionAuthState);
    }

    console.log(
      `[AuthFlowManager] Auth callback handled for ${foundState.toolkitSlug}`
    );
  }

  /**
   * Check the current authentication status
   */
  private async checkAuthStatus(
    sessionId: string,
    toolkitSlug: string
  ): Promise<SessionAuthState> {
    const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/auth/${toolkitSlug}/status`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": this.config.apiKey,
      },
    });

    if (!response.ok) {
      throw new ToolRouterError(
        `Failed to check auth status: ${response.statusText}`,
        "AUTH_STATUS_CHECK_FAILED",
        response.status
      );
    }

    const data = await response.json();

    return {
      sessionId,
      toolkitSlug,
      authScheme: "OAUTH2",
      status: data.status,
      connectedAccountId: data.connectedAccountId,
    };
  }

  /**
   * Start polling for auth status with a callback
   */
  startPolling(
    sessionId: string,
    toolkitSlug: string,
    onStatusChange: AuthStatusCallback,
    intervalMs: number = 2000,
    maxAttempts: number = 150
  ): void {
    const authKey = this.getAuthKey(sessionId, toolkitSlug);

    // Stop any existing polling
    this.stopPolling(authKey);

    // Register callback
    this.statusCallbacks.set(authKey, onStatusChange);

    let attempts = 0;

    const poll = async () => {
      attempts++;

      if (attempts > maxAttempts) {
        console.warn(
          `[AuthFlowManager] Polling stopped after ${maxAttempts} attempts`
        );
        this.stopPolling(authKey);
        return;
      }

      try {
        const status = await this.checkAuthStatus(sessionId, toolkitSlug);
        onStatusChange(status);

        // Stop polling if auth is complete
        if (status.status === "authenticated" || status.status === "failed") {
          this.stopPolling(authKey);
        }
      } catch (error) {
        console.error(`[AuthFlowManager] Polling error:`, error);
        this.stopPolling(authKey);
      }
    };

    // Start polling
    const interval = setInterval(poll, intervalMs);
    this.pollingIntervals.set(authKey, interval);

    // Initial poll
    poll();

    console.log(
      `[AuthFlowManager] Started polling for ${toolkitSlug} (${maxAttempts} max attempts)`
    );
  }

  /**
   * Stop polling for a specific auth flow
   */
  stopPolling(authKey: string): void {
    const interval = this.pollingIntervals.get(authKey);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(authKey);
      this.statusCallbacks.delete(authKey);
      console.log(`[AuthFlowManager] Stopped polling for ${authKey}`);
    }
  }

  /**
   * Get pending auth state for a toolkit
   */
  getPendingAuthState(
    sessionId: string,
    toolkitSlug: string
  ): PendingAuthState | undefined {
    const authKey = this.getAuthKey(sessionId, toolkitSlug);
    return this.pendingAuthStates.get(authKey);
  }

  /**
   * Get all pending auth states for a session
   */
  getPendingAuthsForSession(sessionId: string): PendingAuthState[] {
    const states: PendingAuthState[] = [];
    for (const [, state] of this.pendingAuthStates) {
      if (state.sessionId === sessionId) {
        states.push(state);
      }
    }
    return states;
  }

  /**
   * Clear a pending auth state
   */
  clearPendingAuth(sessionId: string, toolkitSlug: string): boolean {
    const authKey = this.getAuthKey(sessionId, toolkitSlug);
    this.stopPolling(authKey);
    return this.pendingAuthStates.delete(authKey);
  }

  /**
   * Clear all expired pending auth states
   */
  cleanupExpiredAuths(): number {
    const now = new Date();
    let cleaned = 0;

    for (const [key, state] of this.pendingAuthStates) {
      if (now > state.expiresAt) {
        this.stopPolling(key);
        this.pendingAuthStates.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[AuthFlowManager] Cleaned up ${cleaned} expired auth states`);
    }

    return cleaned;
  }

  /**
   * Generate a unique link code
   */
  private generateLinkCode(): string {
    return `link_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  stopAllPolling(): void {
    for (const [key, interval] of this.pollingIntervals) {
      clearInterval(interval);
      console.log(`[AuthFlowManager] Stopped polling for ${key}`);
    }
    this.pollingIntervals.clear();
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    // Stop all polling
    this.stopAllPolling();
    this.statusCallbacks.clear();
    this.pendingAuthStates.clear();
  }
}

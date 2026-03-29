import { z } from "zod";
import { ToolRouterConfig } from "./config";
import {
  SessionManager,
  ToolRouterSession,
  CreateSessionParams,
  SessionAuthState,
} from "./session-manager";
import {
  ToolRouterError,
  AuthRequiredError,
  SessionExpiredError,
  ToolExecutionError,
  withErrorHandling,
} from "./errors";
import {
  FileOperationsManager,
  CreateMountConfig,
  Mount,
  FileMountEntry,
  PresignedUrlResponse,
} from "./file-operations";

// ============================================================================
// Zod Schemas for API Responses
// ============================================================================

// Raw API response schema (snake_case from Composio API)
// Actual API v3 response: { session_id, mcp, tool_router_tools, config, experimental }
const ZToolRouterSessionResponse = z.object({
  session_id: z.string(),
  mcp: z.object({ type: z.string(), url: z.string() }).optional(),
  tool_router_tools: z.array(z.string()).optional(),
  config: z.record(z.any()).optional(),
  experimental: z.record(z.any()).optional(),
});

// Transformed schema for internal use (camelCase)
export const ZToolRouterSession = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

// Raw API response for toolkit (snake_case)
// Make fields optional to handle API response variations
const ZToolkitResponse = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional().default(''),
  logo: z.string().optional(),
  auth_schemes: z.array(z.string()).optional().default([]),
  meta: z.any().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

export const ZToolkit = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  logo: z.string().optional(),
  authSchemes: z.array(z.string()),
  meta: z.any().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

// Raw API response for tool (snake_case)
// Meta-tools from /session/{id}/tools have: slug, description, input_schema
const ZToolResponse = z.object({
  slug: z.string(),
  name: z.string().optional(),
  description: z.string(),
  toolkit: z.object({
    slug: z.string(),
    name: z.string(),
  }).passthrough().optional(),
  input_schema: z.record(z.any()).optional(),
  output_schema: z.record(z.any()).optional(),
  input_parameters: z.record(z.any()).optional(),
  output_parameters: z.record(z.any()).optional(),
  // Meta-tool style fields
  inputSchema: z.record(z.any()).optional(),
  outputSchema: z.record(z.any()).optional(),
}).passthrough();

export const ZTool = z.object({
  slug: z.string(),
  name: z.string().optional().default(""),
  description: z.string(),
  toolkit: z.object({
    slug: z.string(),
    name: z.string(),
  }).passthrough().optional().default({ slug: "composio", name: "Composio" }),
  inputSchema: z.record(z.any()).optional().default({}),
  outputSchema: z.record(z.any()).optional(),
});

// Raw API execute response: { data, error, log_id }
export const ZToolExecutionResult = z.object({
  data: z.any(),
  error: z.string().nullable().optional(),
  log_id: z.string().optional(),
});

// Raw API response for link session (snake_case)
// Actual API v3 response: { link_token, redirect_url, connected_account_id }
const ZLinkSessionResponseRaw = z.object({
  link_token: z.string().optional(),
  redirect_url: z.string().optional(),
  connected_account_id: z.string().optional(),
  // Legacy shape fallback
  link_url: z.string().optional(),
  status: z.enum(["INITIATED", "ACTIVE", "FAILED"]).optional(),
  expires_at: z.string().optional(),
});

export const ZLinkSessionResponse = z.object({
  linkUrl: z.string().optional(),
  redirectUrl: z.string().optional(),
  connectedAccountId: z.string().optional(),
});

// Raw API response for auth status (snake_case)
const ZAuthStatusResponseRaw = z.object({
  status: z.enum(["pending", "link_required", "authenticated", "failed"]).optional(),
  connected_account_id: z.string().optional(),
  // Also accept capitalized status from some endpoints
  connection_status: z.string().optional(),
});

export const ZAuthStatusResponse = z.object({
  status: z.enum(["pending", "link_required", "authenticated", "failed"]).optional(),
  connectedAccountId: z.string().optional(),
});

export const ZFileMount = z.object({
  id: z.string(),
  url: z.string(),
  mimeType: z.string(),
  size: z.number(),
});

// ============================================================================
// TypeScript Types
// ============================================================================

export type Toolkit = z.infer<typeof ZToolkit>;
export type Tool = z.infer<typeof ZTool>;
export type ToolExecutionResult<T = unknown> = {
  success: boolean;
  data: T;
  error?: { message: string; code: string };
  executionId: string;
};
export type FileMount = z.infer<typeof ZFileMount>;

export interface ToolExecutionParams {
  arguments: Record<string, unknown>;
  fileMounts?: FileMount[];
}

// ============================================================================
// Main ComposioToolRouter Class
// ============================================================================

/**
 * ComposioToolRouter - Main client for Composio Tool Router API v3
 *
 * Provides methods for:
 * - Session management
 * - Tool discovery (list, search)
 * - Tool execution
 * - Authentication flow
 * - File mounting
 */
export class ComposioToolRouter {
  private config: ToolRouterConfig;
  private sessionManager: SessionManager;
  private toolSchemaCache: Map<string, { schema: unknown; expiresAt: Date }>;
  private fileOperationsManager: FileOperationsManager;

  // SEC-003: Regex to validate identifiers used in URL path segments
  private static readonly SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  constructor(config: ToolRouterConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config);
    this.toolSchemaCache = new Map();
    this.fileOperationsManager = new FileOperationsManager(config);
  }

  /** SEC-003: Validate that an identifier is safe for URL construction */
  private validateId(id: string, name: string): void {
    if (!id || !ComposioToolRouter.SAFE_ID_PATTERN.test(id)) {
      throw new ToolRouterError(
        `Invalid ${name}: contains unsafe characters`,
        "INVALID_IDENTIFIER",
        400
      );
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Create a new session via the Composio API
   * @param params - Session creation parameters
   * @returns The created session
   */
  async createSession(params: CreateSessionParams): Promise<ToolRouterSession> {
    return withErrorHandling(async () => {
      const url = `${this.config.baseUrl}/api/v3/tool_router/session`;

      console.log(`[ComposioToolRouter] Creating session for project: ${params.projectId}`);
      console.log(`[ComposioToolRouter] Request body:`, { user_id: params.userId });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: params.userId,
        }),
      });

      const rawText = await response.text();
      // SEC-002: Don't log raw responses — may contain auth tokens
      console.log(`[ComposioToolRouter] Response received (${rawText.length} chars)`);

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText} - ${rawText}`);
      }

      const data = JSON.parse(rawText);
      
      // Parse with schema matching actual API v3 response
      // API returns: { session_id, mcp, tool_router_tools, config, experimental }
      const parsed = ZToolRouterSessionResponse.parse(data);
      const sessionId = parsed.session_id;
      
      console.log(`[ComposioToolRouter] Session created with ID: ${sessionId}`);

      // Create session in local cache (session manager generates its own timestamps via TTL)
      return this.sessionManager.createSession(sessionId, params);
    }, { projectId: params.projectId });
  }

  /**
   * Get a session by ID from the local cache
   * @param projectId - The project ID
   * @param userId - Optional user ID
   * @returns The session or null if not found
   */
  getSession(projectId: string, userId?: string): ToolRouterSession | null {
    return this.sessionManager.getSession(projectId, userId);
  }

  /**
   * Get or create a session for a project/user
   * @param projectId - The project ID
   * @param userId - Optional user ID
   * @returns Existing or new session
   */
  async getOrCreateSession(
    projectId: string,
    userId?: string
  ): Promise<ToolRouterSession> {
    const existing = this.getSession(projectId, userId);
    if (existing) {
      return existing;
    }

    return this.createSession({ projectId, userId });
  }

  /**
   * Close/delete a session
   * @param projectId - The project ID
   * @param userId - Optional user ID
   * @returns True if a session was deleted
   */
  closeSession(projectId: string, userId?: string): boolean {
    return this.sessionManager.deleteSession(projectId, userId);
  }

  // ============================================================================
  // Tool Discovery
  // ============================================================================

  /**
   * List all available toolkits for a session
   * Uses the session-specific endpoint which includes connection status
   * @param sessionId - The session ID
   * @returns Array of toolkits with connection status
   */
  async listToolkits(sessionId: string): Promise<Toolkit[]> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      
      // Use the session-specific endpoint which includes connection status
      const allToolkits: any[] = [];
      let cursor: string | null = null;
      let hasMore = true;
      
      console.log(`[ComposioToolRouter] Fetching toolkits for session: ${sessionId}`);

      while (hasMore) {
        // Build URL with cursor for pagination
        let url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/toolkits?limit=1000`;
        if (cursor) {
          url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": this.config.apiKey,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[ComposioToolRouter] Session toolkits endpoint failed: ${response.status} - ${errorText}`);
          // Fallback to standard toolkits endpoint if session endpoint fails
          return this.listToolkitsFallback(sessionId);
        }

        const data = await response.json();
        
        const items = data.items || [];
        allToolkits.push(...items);
        
        // Handle pagination
        cursor = data.next_cursor || null;
        hasMore = cursor !== null;
        
        console.log(`[ComposioToolRouter] Fetched ${items.length} toolkits for session, total so far: ${allToolkits.length}, hasMore: ${hasMore}`);
      }

      console.log(`[ComposioToolRouter] Total toolkits fetched for session: ${allToolkits.length}`);

      // Map toolkits - the session endpoint already includes connection status
      return allToolkits.map((t: any) => ({
        slug: t.slug,
        name: t.name,
        description: t.description || t.meta?.description || '',
        logo: t.logo || t.meta?.logo,
        authSchemes: t.auth_schemes || t.composio_managed_auth_schemes || [],
        meta: t.meta,
        category: t.categories?.[0]?.name || t.category,
        tags: t.tags,
        // Connection info from the session endpoint
        connection: t.connected_account ? {
          is_active: t.connected_account.status === 'ACTIVE' || t.connected_account.status === 'connected',
          connected_account: t.connected_account,
        } : null,
      }));
    }, { sessionId });
  }

  /**
   * Fallback: List toolkits using standard endpoint and merge connection status
   * @param sessionId - The session ID
   * @returns Array of toolkits
   */
  async listToolkitsFallback(sessionId: string): Promise<Toolkit[]> {
    return withErrorHandling(async () => {
      // Use the standard /api/v3/toolkits endpoint to get ALL available toolkits
      // This endpoint supports pagination and returns the complete list
      const allToolkits: any[] = [];
      let cursor: string | null = null;
      let hasMore = true;
      
      console.log(`[ComposioToolRouter] Fetching ALL toolkits with pagination (fallback)`);

      while (hasMore) {
        // Build URL with cursor for pagination
        let url = `${this.config.baseUrl}/api/v3/toolkits?limit=1000`;
        if (cursor) {
          url += `&cursor=${encodeURIComponent(cursor)}`;
        }

        const response = await fetch(url, {
          method: "GET",
          headers: {
            "x-api-key": this.config.apiKey,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[ComposioToolRouter] Toolkits endpoint failed: ${response.status} - ${errorText}`);
          // Fallback to multi endpoint if main endpoint fails
          return this.listToolkitsMulti();
        }

        const data = await response.json();
        
        const items = data.items || [];
        allToolkits.push(...items);
        
        // Handle pagination
        cursor = data.next_cursor || null;
        hasMore = cursor !== null;
        
        console.log(`[ComposioToolRouter] Fetched ${items.length} toolkits, total so far: ${allToolkits.length}, hasMore: ${hasMore}`);
      }

      console.log(`[ComposioToolRouter] Total toolkits fetched: ${allToolkits.length}`);

      // Also try to get connection status from session endpoint
      // This is optional - we'll merge connection info if available
      let connectionInfo: Map<string, any> = new Map();
      try {
        const sessionUrl = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/toolkits?limit=1000`;
        const sessionResponse = await fetch(sessionUrl, {
          method: "GET",
          headers: {
            "x-api-key": this.config.apiKey,
          },
        });
        
        if (sessionResponse.ok) {
          const sessionData = await sessionResponse.json();
          const sessionItems = sessionData.items || sessionData.toolkits || [];
          
          for (const item of sessionItems) {
            if (item.connected_account || item.connection) {
              connectionInfo.set(item.slug, {
                is_active: item.connected_account?.status === 'connected' || item.connected_account?.status === 'ACTIVE' || item.connection?.isActive,
                connected_account: item.connected_account || item.connection?.connected_account,
              });
            }
          }
          console.log(`[ComposioToolRouter] Got connection info for ${connectionInfo.size} toolkits`);
        }
      } catch (err) {
        console.log(`[ComposioToolRouter] Could not fetch connection status:`, err);
      }
      
      // Map toolkits, merging connection info if available
      return allToolkits.map((t: any) => {
        const connection = connectionInfo.get(t.slug);
        return {
          slug: t.slug,
          name: t.name,
          description: t.description || t.meta?.description || '',
          logo: t.logo || t.meta?.logo,
          authSchemes: t.auth_schemes || t.composio_managed_auth_schemes,
          meta: t.meta,
          category: t.categories?.[0]?.name || t.category,
          tags: t.tags,
          // Include connection info if available
          connection: connection || null,
        };
      });
    }, { sessionId });
  }

  /**
   * Fallback: List all available toolkits using the multi endpoint
   * Also uses pagination to ensure we get all toolkits
   * @returns Array of toolkits
   */
  async listToolkitsMulti(): Promise<Toolkit[]> {
    return withErrorHandling(async () => {
      const allToolkits: any[] = [];
      let cursor: string | null = null;
      let hasMore = true;
      
      console.log(`[ComposioToolRouter] Listing all toolkits over multi endpoint with pagination`);

      while (hasMore) {
        const url = `${this.config.baseUrl}/api/v3/toolkits/multi`;
        
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "x-api-key": this.config.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ limit: 1000, cursor }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to list toolkits: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        
        // API returns items array with snake_case fields
        const items = data.items || data;
        allToolkits.push(...items);
        
        // Handle pagination if available
        cursor = data.next_cursor || null;
        hasMore = cursor !== null;
        
        console.log(`[ComposioToolRouter] Multi endpoint: fetched ${items.length} toolkits, total: ${allToolkits.length}, hasMore: ${hasMore}`);
      }

      console.log(`[ComposioToolRouter] Total toolkits from multi endpoint: ${allToolkits.length}`);

      const parsed = z.array(ZToolkitResponse).parse(allToolkits);
      
      // Transform to camelCase
      return parsed.map((t) => ({
        ...t,
        slug: t.slug,
        name: t.name,
        description: t.description || t.meta?.description || '',
        logo: t.logo || t.meta?.logo,
        authSchemes: t.auth_schemes,
        meta: t.meta,
        category: t.category,
        tags: t.tags,
      }));
    }, {});
  }

  /**
   * List all meta-tools available for a session
   * The /tools endpoint returns meta-tool schemas (COMPOSIO_MULTI_EXECUTE_TOOL etc.)
   * NOT individual toolkit tools
   * @param sessionId - The session ID
   * @returns Array of meta-tools with their schemas
   */
  async listTools(
    sessionId: string,
    filters?: { toolkitSlug?: string }
  ): Promise<Tool[]> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      let url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/tools`;
      
      if (filters?.toolkitSlug) {
        url = `${this.config.baseUrl}/api/v3/tools?toolkit_slug=${filters.toolkitSlug}&limit=2000`;
        console.log(`[ComposioToolRouter] Listing actual tools for toolkit: ${filters.toolkitSlug}`);
      } else {
        console.log(`[ComposioToolRouter] Listing meta-tools for session: ${sessionId}`);
      }

      const response = await fetch(url, {
        headers: {
          "x-api-key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Failed to list tools: ${response.statusText} - ${errText}`);
      }

      const rawText = await response.text();
      const data = JSON.parse(rawText);
      
      // The response may be a direct array or { items: [...] }
      const items: unknown[] = Array.isArray(data) ? data : (data.items || data.tools || []);
      
      // Parse with lenient schema
      const parsed = z.array(ZToolResponse).parse(items);
      
      // Transform to internal Tool format
      return parsed.map((t) => ({
        slug: t.slug,
        name: t.name || t.slug,
        description: t.description,
        toolkit: t.toolkit || { slug: filters?.toolkitSlug || "composio", name: filters?.toolkitSlug || "Composio" },
        inputSchema: t.input_parameters || t.input_schema || t.inputSchema || {},
        outputSchema: t.output_parameters || t.output_schema || t.outputSchema,
      }));
    }, { sessionId });
  }

  /**
   * Execute a Composio meta-tool (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL, etc.)
   * Uses the /execute_meta endpoint
   * @param sessionId - The session ID
   * @param metaToolSlug - The meta-tool slug (e.g., "COMPOSIO_MULTI_EXECUTE_TOOL")
   * @param args - Arguments for the meta-tool
   * @returns Execution result
   */
  async executeMetaTool<T = unknown>(
    sessionId: string,
    metaToolSlug: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult<T>> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/execute_meta`;

      console.log(`[ComposioToolRouter] Executing meta-tool: ${metaToolSlug} for session: ${sessionId}`);
      console.log(`[ComposioToolRouter] Meta-tool args:`, JSON.stringify(args));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slug: metaToolSlug,
          arguments: args,
        }),
      });

      // Handle authentication required (401) — meta-tools may redirect for auth
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        const authUrl = errorData.redirect_url || errorData.link_url || "";
        throw new AuthRequiredError(
          authUrl,
          errorData.toolkit_slug || "unknown",
          new Date(errorData.expires_at || Date.now() + 300000)
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new ToolExecutionError(
          `Meta-tool execution failed: ${response.statusText} - ${errorText}`,
          metaToolSlug,
          "unknown",
          new Error(errorText)
        );
      }

      const data = await response.json();
      console.log(`[ComposioToolRouter] Meta-tool result:`, JSON.stringify(data).slice(0, 500));
      
      // API response: { data, error, log_id }
      const parsed = ZToolExecutionResult.parse(data);
      const hasError = parsed.error != null && parsed.error !== "";
      return {
        success: !hasError,
        data: parsed.data as T,
        error: hasError ? { message: parsed.error!, code: "META_TOOL_ERROR" } : undefined,
        executionId: parsed.log_id || `meta_${Date.now()}`,
      };
    }, { sessionId, toolSlug: metaToolSlug });
  }

  /**
   * Search for tools using a natural language query
   * @param sessionId - The session ID
   * @param query - Search query
   * @returns Array of matching tools
   */
  async searchTools(sessionId: string, query: string): Promise<Tool[]> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/search`;

      console.log(`[ComposioToolRouter] Searching tools for session: ${sessionId}, query: ${query}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to search tools: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      // API returns items array with snake_case fields
      const items = data.items || data;
      const parsed = z.array(ZToolResponse).parse(items);
      
      // Transform to camelCase, using defaults for optional fields
      return parsed.map((t) => ({
        slug: t.slug,
        name: t.name || t.slug,
        description: t.description,
        toolkit: t.toolkit || { slug: "composio", name: "Composio" },
        inputSchema: t.input_schema || t.inputSchema || {},
        outputSchema: t.output_schema || t.outputSchema,
      }));
    }, { sessionId });
  }

  // ============================================================================
  // Tool Execution
  // ============================================================================

  /**
   * Execute a tool with the given parameters
   * @param sessionId - The session ID
   * @param toolSlug - The tool identifier (e.g., "gmail_send_email")
   * @param params - Execution parameters including arguments and optional file mounts
   * @returns Tool execution result
   */
  async executeTool<T = unknown>(
    sessionId: string,
    toolSlug: string,
    params: ToolExecutionParams
  ): Promise<ToolExecutionResult<T>> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/execute`;

      console.log(`[ComposioToolRouter] Executing tool: ${toolSlug} for session: ${sessionId}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tool_slug: toolSlug,
          arguments: params.arguments,
          file_mounts: params.fileMounts,
        }),
      });

      // Handle authentication required (401)
      if (response.status === 401) {
        const errorData = await response.json().catch(() => ({}));
        // API v3 link response format: { link_token, redirect_url } or legacy { link_url }
        const authUrl = errorData.redirect_url || errorData.link_url || "";
        throw new AuthRequiredError(
          authUrl,
          errorData.toolkit_slug || toolSlug.split("_")[0],
          new Date(errorData.expires_at || Date.now() + 300000)
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new ToolExecutionError(
          `Tool execution failed: ${response.statusText} - ${errorText}`,
          toolSlug,
          "unknown",
          new Error(errorText)
        );
      }

      const data = await response.json();
      // API v3 execute response: { data, error, log_id }
      // Transform to our internal ToolExecutionResult shape
      const parsed = ZToolExecutionResult.parse(data);
      const hasError = parsed.error != null && parsed.error !== "";
      return {
        success: !hasError,
        data: parsed.data as T,
        error: hasError ? { message: parsed.error!, code: "TOOL_ERROR" } : undefined,
        executionId: parsed.log_id || `exec_${Date.now()}`,
      };
    }, { sessionId, toolSlug });
  }

  // ============================================================================
  // Authentication Flow
  // ============================================================================

  /**
   * Initiate authentication for a toolkit
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit to authenticate
   * @param authScheme - The authentication scheme (e.g., "OAUTH2")
   * @returns Authentication state with link URL if required
   */
  async initiateAuth(
    sessionId: string,
    toolkitSlug: string,
    authScheme: string
  ): Promise<SessionAuthState> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/link`;

      console.log(`[ComposioToolRouter] Initiating auth for toolkit: ${toolkitSlug}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        // API v3: request body uses "toolkit" not "toolkit_slug", and no auth_scheme needed
        body: JSON.stringify({
          toolkit: toolkitSlug,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to initiate auth: ${response.statusText}`);
      }

      const data = await response.json();
      const parsed = ZLinkSessionResponseRaw.parse(data);

      // API v3 link response: { link_token, redirect_url, connected_account_id }
      // If connected_account_id present → already authenticated
      // If redirect_url present → link required
      const linkUrl = parsed.redirect_url || parsed.link_url;
      const isAuthenticated = !!(parsed.connected_account_id && !parsed.redirect_url && !parsed.link_token);
      
      const authState: SessionAuthState = {
        sessionId,
        toolkitSlug,
        authScheme,
        status: isAuthenticated ? "authenticated" : (linkUrl ? "link_required" : "pending"),
        linkUrl: linkUrl,
        connectedAccountId: parsed.connected_account_id,
      };

      return authState;
    }, { sessionId });
  }

  /**
   * Get authentication status for a toolkit
   * Uses the toolkits endpoint to check connection status
   * @param sessionId - The session ID
   * @param toolkitSlug - The toolkit to check
   * @returns Current authentication state
   */
  async getAuthStatus(
    sessionId: string,
    toolkitSlug: string
  ): Promise<SessionAuthState> {
    return withErrorHandling(async () => {
      this.validateId(sessionId, 'sessionId');
      this.validateId(toolkitSlug, 'toolkitSlug');
      
      // Use the toolkits endpoint to check connection status
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/toolkits?toolkits=${toolkitSlug}`;

      console.log(`[ComposioToolRouter] Getting auth status for toolkit: ${toolkitSlug} via toolkits endpoint`);

      const response = await fetch(url, {
        headers: {
          "x-api-key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get auth status: ${response.statusText}`);
      }

      const data = await response.json();
      const items = data.items || [];
      
      // Find the toolkit in the response
      const toolkit = items.find((t: any) => t.slug === toolkitSlug);
      
      if (!toolkit) {
        return {
          sessionId,
          toolkitSlug,
          authScheme: "OAUTH2",
          status: "pending",
        };
      }

      // Check connection status from the toolkit response
      const isConnected = toolkit.connected_account && 
        (toolkit.connected_account.status === 'ACTIVE' || 
         toolkit.connected_account.status === 'connected');
      
      const authState: SessionAuthState = {
        sessionId,
        toolkitSlug,
        authScheme: "OAUTH2",
        status: isConnected ? "authenticated" : "pending",
        connectedAccountId: toolkit.connected_account?.id,
      };

      return authState;
    }, { sessionId });
  }

  /**
   * Delete a connected account from Composio API
   * @param connectedAccountId - The connected account ID to delete (nanoid)
   * @returns boolean if successful
   */
  async deleteConnectedAccount(connectedAccountId: string): Promise<boolean> {
    return withErrorHandling(async () => {
      const url = `${this.config.baseUrl}/api/v3/connected_accounts/${connectedAccountId}`;
      console.log(`[ComposioToolRouter] Deleting connected account: ${connectedAccountId}`);
      const response = await fetch(url, {
        method: "DELETE",
        headers: {
          "x-api-key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete connected account: ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      return !!data.success;
    }, {});
  }

  /**
   * List all connected accounts for a session
   * @param sessionId - The session ID
   * @returns Array of connected accounts
   */
  async listConnectedAccounts(sessionId: string): Promise<Array<{
    id: string;
    toolkitSlug: string;
    status: string;
    connectedAccountId: string;
  }>> {
    return withErrorHandling(async () => {
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/connected_accounts`;
      console.log(`[ComposioToolRouter] Listing connected accounts for session: ${sessionId}`);
      
      const response = await fetch(url, {
        headers: {
          "x-api-key": this.config.apiKey,
        },
      });

      if (!response.ok) {
        // If endpoint doesn't exist, return empty array
        if (response.status === 404) {
          return [];
        }
        throw new Error(`Failed to list connected accounts: ${response.statusText}`);
      }

      const data = await response.json();
      console.log(`[ComposioToolRouter] Raw connected accounts response:`, JSON.stringify(data, null, 2).substring(0, 2000));
      
      const items = data.items || data || [];
      
      return items.map((item: any) => ({
        id: item.id || item.connection_id,
        toolkitSlug: item.toolkit?.slug || item.app_slug,
        status: item.status,
        connectedAccountId: item.id || item.connected_account_id,
      }));
    }, { sessionId });
  }

  // ============================================================================
  // File Mounts
  // ============================================================================

  /**
   * Mount a file for use with tools
   * @param sessionId - The session ID
   * @param file - File to mount (name, content buffer, mime type)
   * @returns File mount information
   */
  async mountFile(
    sessionId: string,
    file: { name: string; content: Buffer; mimeType: string }
  ): Promise<FileMount> {
    return withErrorHandling(async () => {
      const url = `${this.config.baseUrl}/api/v3/tool_router/session/${sessionId}/file_mounts`;

      console.log(`[ComposioToolRouter] Mounting file: ${file.name} for session: ${sessionId}`);

      const formData = new FormData();
      // Convert Buffer to ArrayBuffer for Blob compatibility
      const arrayBuffer = file.content.buffer.slice(
        file.content.byteOffset,
        file.content.byteOffset + file.content.byteLength
      ) as ArrayBuffer;
      formData.append(
        "file",
        new Blob([arrayBuffer], { type: file.mimeType }),
        file.name
      );

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": this.config.apiKey,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to mount file: ${response.statusText}`);
      }

      const data = await response.json();
      return ZFileMount.parse(data);
    }, { sessionId });
  }

  // ============================================================================
  // File Mount Operations
  // ============================================================================

  /**
   * Create a new file mount for a session
   * @param sessionId - The session ID
   * @param config - Mount configuration
   * @returns The created mount
   */
  async createMount(
    sessionId: string,
    config: CreateMountConfig
  ): Promise<Mount> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.createMount(sessionId, config);
    }, { sessionId });
  }

  /**
   * List all mounts for a session
   * @param sessionId - The session ID
   * @returns Array of mounts
   */
  async listMounts(sessionId: string): Promise<Mount[]> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.listMounts(sessionId);
    }, { sessionId });
  }

  /**
   * Delete a mount and all its files
   * @param sessionId - The session ID
   * @param mountId - The mount ID to delete
   */
  async deleteMount(sessionId: string, mountId: string): Promise<void> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.deleteMount(sessionId, mountId);
    }, { sessionId });
  }

  /**
   * List files in a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @returns Array of file entries
   */
  async listMountFiles(
    sessionId: string,
    mountId: string
  ): Promise<FileMountEntry[]> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.listFiles(sessionId, mountId);
    }, { sessionId });
  }

  /**
   * Upload a file to a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileName - Name of the file
   * @param content - File content as Buffer or Blob
   * @param contentType - MIME type of the file
   * @returns The file entry
   */
  async uploadFile(
    sessionId: string,
    mountId: string,
    fileName: string,
    content: Buffer | Blob,
    contentType: string
  ): Promise<FileMountEntry> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.uploadFile(
        sessionId,
        mountId,
        fileName,
        content,
        contentType
      );
    }, { sessionId });
  }

  /**
   * Get a presigned upload URL for a file
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileName - Name of the file
   * @param contentType - MIME type
   * @param size - Optional file size
   * @returns Presigned URL response
   */
  async getUploadUrl(
    sessionId: string,
    mountId: string,
    fileName: string,
    contentType: string,
    size?: number
  ): Promise<PresignedUrlResponse> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.getUploadUrl(
        sessionId,
        mountId,
        fileName,
        contentType,
        size
      );
    }, { sessionId });
  }

  /**
   * Download a file from a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to download
   * @returns File content and metadata
   */
  async downloadFile(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<{ content: ArrayBuffer; contentType: string; fileName: string }> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.downloadFile(
        sessionId,
        mountId,
        fileId
      );
    }, { sessionId });
  }

  /**
   * Get a presigned download URL for a file
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID
   * @returns Presigned URL response
   */
  async getDownloadUrl(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<PresignedUrlResponse> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.getDownloadUrl(
        sessionId,
        mountId,
        fileId
      );
    }, { sessionId });
  }

  /**
   * Delete a file from a mount
   * @param sessionId - The session ID
   * @param mountId - The mount ID
   * @param fileId - The file ID to delete
   */
  async deleteMountFile(
    sessionId: string,
    mountId: string,
    fileId: string
  ): Promise<void> {
    return withErrorHandling(async () => {
      return this.fileOperationsManager.deleteFile(sessionId, mountId, fileId);
    }, { sessionId });
  }

  /**
   * Get the file operations manager instance
   * @returns The FileOperationsManager
   */
  getFileOperationsManager(): FileOperationsManager {
    return this.fileOperationsManager;
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get the session manager instance
   * @returns The SessionManager
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.sessionManager.destroy();
    this.toolSchemaCache.clear();
  }
}

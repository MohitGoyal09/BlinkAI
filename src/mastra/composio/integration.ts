/**
 * Composio Tool Router Integration for Blink
 *
 * This module integrates the Composio Tool Router with the Blink agent runtime.
 * It provides session management, tool execution, and authentication handling.
 */

import { z } from "zod";
import { createTool, Tool as MastraTool } from "@mastra/core/tools";
import { ComposioToolRouter } from "./tool-router";
import { ToolRouterConfig } from "./config";
import {
  AuthRequiredError,
  SessionExpiredError,
  ToolExecutionError,
} from "./errors";
import {
  Toolkit,
  Tool,
  ToolExecutionResult,
  FileMount,
} from "./tool-router";
import { SessionAuthState } from "./session-manager";
import { createToolRouterTool, formatToolName } from "./tool-factory";
import { RetryManager } from "./retry-manager";

// ============================================================================
// Configuration
// ============================================================================

const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_BASE_URL = process.env.COMPOSIO_BASE_URL || "https://backend.composio.dev";

// ============================================================================
// Types
// ============================================================================

/**
 * Tool Router session stored in project/user context
 */
export interface ToolRouterSessionRecord {
  id: string;
  userId: string;
  projectId: string;
  createdAt: string;
  expiresAt: string;
  connectedToolkits: string[];
}

/**
 * Tool execution result with auth handling
 */
export type ToolExecutionResponse =
  | { success: true; data: unknown; executionId: string }
  | { success: false; authRequired: true; authUrl: string; toolkitSlug: string }
  | { success: false; error: string; code: string };

// ============================================================================
// Singleton Tool Router Instance
// ============================================================================

let toolRouterInstance: ComposioToolRouter | null = null;

/**
 * Get or create the ComposioToolRouter singleton instance
 */
export function getToolRouter(): ComposioToolRouter {
  console.log(`[ToolRouterIntegration] getToolRouter() called`);

  if (!toolRouterInstance) {
    console.log(`[ToolRouterIntegration] Creating new ToolRouter instance...`);

    if (!COMPOSIO_API_KEY) {
      console.error(`[ToolRouterIntegration] ✗ COMPOSIO_API_KEY is not configured`);
      console.error(`[ToolRouterIntegration]   Please set COMPOSIO_API_KEY in your .env file`);
      throw new Error("COMPOSIO_API_KEY is not configured");
    }

    // SEC-002: Never log API keys, even partially
    console.log(`[ToolRouterIntegration] API key status: ${COMPOSIO_API_KEY ? 'configured' : 'missing'}`);
    console.log(`[ToolRouterIntegration] Base URL: ${COMPOSIO_BASE_URL}`);

    const config: ToolRouterConfig = {
      apiKey: COMPOSIO_API_KEY,
      baseUrl: COMPOSIO_BASE_URL,
      session: {
        ttlSeconds: 3600, // 1 hour
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

    try {
      toolRouterInstance = new ComposioToolRouter(config);
      console.log(`[ToolRouterIntegration] ✓ ToolRouter instance created successfully`);
    } catch (error) {
      console.error(`[ToolRouterIntegration] ✗ Failed to create ToolRouter instance:`, error);
      throw error;
    }
  } else {
    console.log(`[ToolRouterIntegration] Using existing ToolRouter instance`);
  }

  return toolRouterInstance;
}

/**
 * Reset the Tool Router singleton (useful for testing)
 */
export function resetToolRouter(): void {
  toolRouterInstance = null;
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Initialize a Tool Router session for a project/user
 * Creates a new session via the Composio API
 *
 * @param projectId - The project ID (used as the primary identifier)
 * @param userId - Optional user ID for user-specific sessions
 * @returns The session ID and record
 */
export async function initializeToolRouterForProject(
  projectId: string,
  userId?: string
): Promise<{ sessionId: string; record: ToolRouterSessionRecord }> {
  console.log(`[ToolRouterIntegration] initializeToolRouterForProject() called`);
  console.log(`[ToolRouterIntegration]   projectId: ${projectId}`);
  console.log(`[ToolRouterIntegration]   userId: ${userId || "anonymous"}`);

  try {
    const toolRouter = getToolRouter();
    console.log(`[ToolRouterIntegration] ToolRouter instance obtained`);

    // Create a new session via the Tool Router API
    console.log(`[ToolRouterIntegration] Creating session via API...`);
    const session = await toolRouter.createSession({
      projectId,
      userId,
      metadata: {
        initializedAt: new Date().toISOString(),
        source: "blink_integration",
      },
    });

    // Create the session record
    const record: ToolRouterSessionRecord = {
      id: session.id,
      userId: userId || "anonymous",
      projectId,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      connectedToolkits: [],
    };

    console.log(`[ToolRouterIntegration] ✓ Session created: ${session.id}`);
    console.log(`[ToolRouterIntegration]   Expires at: ${record.expiresAt}`);
    return { sessionId: session.id, record };
  } catch (error) {
    console.error(`[ToolRouterIntegration] ✗ Failed to create session:`, error);
    throw error;
  }
}

/**
 * Get or create a Tool Router session
 * If a valid session exists in the provided records, returns it; otherwise creates a new one
 *
 * @param projectId - The project ID
 * @param userId - Optional user ID
 * @param existingSessions - Existing session records (from storage)
 * @returns The session ID and updated records
 */
export async function getToolRouterForProject(
  projectId: string,
  userId?: string,
  existingSessions: ToolRouterSessionRecord[] = []
): Promise<{
  toolRouter: ComposioToolRouter;
  sessionId: string;
  records: ToolRouterSessionRecord[];
}> {
  console.log(`[ToolRouterIntegration] getToolRouterForProject() called`);
  console.log(`[ToolRouterIntegration]   projectId: ${projectId}`);
  console.log(`[ToolRouterIntegration]   userId: ${userId || "anonymous"}`);
  console.log(`[ToolRouterIntegration]   existingSessions count: ${existingSessions.length}`);

  const toolRouter = getToolRouter();

  // Try to find a valid session for this project/user
  const now = new Date();
  console.log(`[ToolRouterIntegration] Checking for valid existing sessions...`);
  console.log(`[ToolRouterIntegration]   Looking for session with projectId: ${projectId}, userId: ${userId || "anonymous"}`);
  console.log(`[ToolRouterIntegration]   Total existing sessions: ${existingSessions.length}`);

  // Filter by BOTH projectId AND userId to ensure proper session matching
  const validSession = existingSessions.find(
    (s: ToolRouterSessionRecord) => 
      s.projectId === projectId && 
      s.userId === (userId || "anonymous") && 
      new Date(s.expiresAt) > now
  );

  if (validSession) {
    console.log(`[ToolRouterIntegration] ✓ Found valid existing session: ${validSession.id}`);
    console.log(`[ToolRouterIntegration]   projectId: ${validSession.projectId}`);
    console.log(`[ToolRouterIntegration]   userId: ${validSession.userId}`);
    console.log(`[ToolRouterIntegration]   Expires at: ${validSession.expiresAt}`);
    return { toolRouter, sessionId: validSession.id, records: existingSessions };
  }

  console.log(`[ToolRouterIntegration] No valid session found, creating new one...`);

  // No valid session found, create a new one
  const { sessionId, record } = await initializeToolRouterForProject(projectId, userId);
  const updatedRecords = [...existingSessions, record];

  console.log(`[ToolRouterIntegration] ✓ New session ready: ${sessionId}`);
  console.log(`[ToolRouterIntegration]   Total records: ${updatedRecords.length}`);

  return { toolRouter, sessionId, records: updatedRecords };
}

/**
 * Refresh a session's TTL if it exists
 * Validates the session by making an API call
 *
 * @param sessionId - The session ID to refresh
 * @returns True if the session is valid
 */
export async function refreshSessionIfNeeded(sessionId: string): Promise<boolean> {
  console.log(`[ToolRouterIntegration] Refreshing session: ${sessionId}`);

  const toolRouter = getToolRouter();

  try {
    // Attempt to list toolkits as a validation check
    await toolRouter.listToolkits(sessionId);
    console.log(`[ToolRouterIntegration] Session ${sessionId} is valid`);
    return true;
  } catch (error) {
    console.log(`[ToolRouterIntegration] Session ${sessionId} refresh failed:`, error);
    return false;
  }
}

/**
 * Close a Tool Router session
 *
 * @param projectId - The project ID
 * @param sessionId - The session ID to close
 * @param existingSessions - Existing session records
 * @returns Updated session records
 */
export function closeToolRouterSession(
  projectId: string,
  sessionId: string,
  existingSessions: ToolRouterSessionRecord[]
): ToolRouterSessionRecord[] {
  console.log(`[ToolRouterIntegration] Closing session ${sessionId} for project ${projectId}`);

  const toolRouter = getToolRouter();

  // Close the session in the Tool Router
  toolRouter.closeSession(projectId);

  // Remove the session from records
  return existingSessions.filter((s: ToolRouterSessionRecord) => s.id !== sessionId);
}

/**
 * Clean up expired sessions
 *
 * @param existingSessions - Existing session records
 * @returns Valid session records only
 */
export function cleanupExpiredSessions(
  existingSessions: ToolRouterSessionRecord[]
): ToolRouterSessionRecord[] {
  const now = new Date();
  return existingSessions.filter((s: ToolRouterSessionRecord) => new Date(s.expiresAt) > now);
}

// ============================================================================
// Tool Operations
// ============================================================================

/**
 * Execute a tool with automatic authentication handling
 * If auth is required, returns the auth URL instead of throwing
 *
 * @param sessionId - The session ID
 * @param toolSlug - The tool slug (format: "toolkit_slug:tool_slug")
 * @param params - The tool parameters
 * @param fileMounts - Optional file mounts
 * @returns The tool execution result or auth required indicator
 */
export async function executeToolWithAuthHandling(
  sessionId: string,
  toolSlug: string,
  params: Record<string, unknown>,
  fileMounts?: FileMount[]
): Promise<ToolExecutionResponse> {
  console.log(`[ToolRouterIntegration] Executing tool ${toolSlug} in session ${sessionId}`);

  const toolRouter = getToolRouter();

  try {
    const result = await toolRouter.executeTool(sessionId, toolSlug, {
      arguments: params,
      fileMounts,
    });

    if (result.success) {
      return {
        success: true,
        data: result.data,
        executionId: result.executionId,
      };
    } else {
      return {
        success: false,
        error: result.error?.message || "Tool execution failed",
        code: result.error?.code || "UNKNOWN_ERROR",
      };
    }
  } catch (error) {
    console.log(`[ToolRouterIntegration] Tool execution error:`, error);

    // Handle auth required error
    if (error instanceof AuthRequiredError) {
      return {
        success: false,
        authRequired: true,
        authUrl: error.linkUrl,
        toolkitSlug: error.toolkitSlug,
      };
    }

    // Handle session expired error
    if (error instanceof SessionExpiredError) {
      return {
        success: false,
        error: "Session expired. Please reinitialize the tool router.",
        code: "SESSION_EXPIRED",
      };
    }

    // Handle tool execution error
    if (error instanceof ToolExecutionError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }

    // Generic error
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      code: "EXECUTION_FAILED",
    };
  }
}

/**
 * List available toolkits for a session
 *
 * @param sessionId - The session ID
 * @returns Array of available toolkits
 */
export async function listAvailableToolkits(sessionId: string): Promise<Toolkit[]> {
  console.log(`[ToolRouterIntegration] Listing toolkits for session ${sessionId}`);

  const toolRouter = getToolRouter();
  return toolRouter.listToolkits(sessionId);
}

/**
 * List tools available for a session
 *
 * @param sessionId - The session ID
 * @param toolkitSlug - Optional toolkit slug to filter by
 * @returns Array of available tools
 */
export async function listAvailableTools(
  sessionId: string,
  toolkitSlug?: string
): Promise<Tool[]> {
  console.log(`[ToolRouterIntegration] listAvailableTools() called`);
  console.log(`[ToolRouterIntegration]   sessionId: ${sessionId}`);
  console.log(`[ToolRouterIntegration]   toolkitSlug: ${toolkitSlug || "all"}`);

  try {
    const toolRouter = getToolRouter();
    console.log(`[ToolRouterIntegration] Fetching tools from API...`);

    const tools = await toolRouter.listTools(sessionId, { toolkitSlug });

    console.log(`[ToolRouterIntegration] ✓ Retrieved ${tools.length} tools`);
    if (tools.length > 0) {
      console.log(`[ToolRouterIntegration]   Tool slugs: ${tools.map(t => t.slug).join(", ")}`);
    }

    return tools;
  } catch (error) {
    console.error(`[ToolRouterIntegration] ✗ Failed to list tools:`, error);
    if (error instanceof Error) {
      console.error(`[ToolRouterIntegration]   Error message: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Initiate authentication for a toolkit
 *
 * @param sessionId - The session ID
 * @param toolkitSlug - The toolkit slug
 * @param authScheme - The authentication scheme (default: "OAUTH2")
 * @returns The auth state with link URL if required
 */
export async function initiateToolkitAuth(
  sessionId: string,
  toolkitSlug: string,
  authScheme: string = "OAUTH2"
): Promise<SessionAuthState> {
  console.log(`[ToolRouterIntegration] Initiating auth for toolkit ${toolkitSlug} in session ${sessionId}`);

  const toolRouter = getToolRouter();
  return toolRouter.initiateAuth(sessionId, toolkitSlug, authScheme);
}

/**
 * Check authentication status for a toolkit
 *
 * @param sessionId - The session ID
 * @param toolkitSlug - The toolkit slug
 * @returns The auth status
 */
export async function checkToolkitAuthStatus(
  sessionId: string,
  toolkitSlug: string
): Promise<{ status: "pending" | "link_required" | "authenticated" | "failed"; connectedAccountId?: string }> {
  console.log(`[ToolRouterIntegration] Checking auth status for toolkit ${toolkitSlug} in session ${sessionId}`);

  const toolRouter = getToolRouter();
  const authState = await toolRouter.getAuthStatus(sessionId, toolkitSlug);

  return {
    status: authState.status,
    connectedAccountId: authState.connectedAccountId,
  };
}

// ============================================================================
// Mastra Tool Factory
// ============================================================================

/**
 * Create a Mastra-compatible tool from a Tool Router tool definition
 * This integrates with the agent runtime
 *
 * @param tool - The Tool Router tool definition
 * @param sessionId - The session ID
 * @param options - Optional configuration
 * @returns A Mastra-compatible tool
 */
export function createMastraToolRouterTool(
  tool: Tool,
  sessionId: string,
  options?: {
    onAuthRequired?: (toolkitSlug: string, authUrl: string) => void;
    onError?: (error: Error) => void;
  }
): MastraTool {
  const toolName = formatToolName(tool.slug);

  return createTool({
    id: toolName,
    description: tool.description,
    inputSchema: jsonSchemaToZod(tool.inputSchema),
    execute: async (input) => {
      const result = await executeToolWithAuthHandling(sessionId, tool.slug, input);

      if (result.success) {
        return result.data;
      }

      if ("authRequired" in result && result.authRequired) {
        if (options?.onAuthRequired) {
          options.onAuthRequired(result.toolkitSlug, result.authUrl);
        }
        throw new Error(`Authentication required for ${result.toolkitSlug}. Please visit: ${result.authUrl}`);
      }

      const error = new Error("error" in result ? result.error : "Unknown error");
      if (options?.onError) {
        options.onError(error);
      }
      throw error;
    },
  });
}

/**
 * Create multiple Mastra-compatible tools from Tool Router tool definitions
 *
 * @param tools - Array of Tool Router tool definitions
 * @param sessionId - The session ID
 * @param options - Optional configuration
 * @returns Record of Mastra-compatible tools
 */
export function createMastraToolRouterTools(
  tools: Tool[],
  sessionId: string,
  options?: {
    onAuthRequired?: (toolkitSlug: string, authUrl: string) => void;
    onError?: (error: Error) => void;
  }
): Record<string, MastraTool> {
  const mastraTools: Record<string, MastraTool> = {};

  for (const tool of tools) {
    const toolName = formatToolName(tool.slug);
    mastraTools[toolName] = createMastraToolRouterTool(tool, sessionId, options);
  }

  return mastraTools;
}

// ============================================================================
// Helper: JSON Schema to Zod Converter
// ============================================================================

/**
 * Convert JSON schema to Zod schema
 * This is a simplified converter for common schema types
 * @param schema - JSON schema object
 * @returns Zod schema
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<any> {
  if (!schema || typeof schema !== "object") {
    return z.any();
  }

  // BUG-010: Handle allOf (intersection)
  if (schema.allOf && Array.isArray(schema.allOf)) {
    const schemas = (schema.allOf as Record<string, unknown>[]).map(s => jsonSchemaToZod(s));
    if (schemas.length === 0) return z.any();
    if (schemas.length === 1) return schemas[0];
    return schemas.reduce((acc, s) => z.intersection(acc, s));
  }

  // BUG-010: Handle oneOf/anyOf (union)
  const unionSchemas = (schema.oneOf || schema.anyOf) as Record<string, unknown>[] | undefined;
  if (unionSchemas && Array.isArray(unionSchemas)) {
    const schemas = unionSchemas.map(s => jsonSchemaToZod(s));
    if (schemas.length === 0) return z.any();
    if (schemas.length === 1) return schemas[0];
    return z.union(schemas as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }

  // BUG-010: Handle const values
  if ('const' in schema) {
    return z.literal(schema.const as string | number | boolean);
  }

  // BUG-010: Handle enum without explicit type
  if (schema.enum && Array.isArray(schema.enum) && !schema.type) {
    const values = schema.enum as [string, ...string[]];
    if (values.length > 0) return z.enum(values);
    return z.any();
  }

  const type = schema.type as string;
  const properties = schema.properties as Record<string, unknown>;
  const required = (schema.required as string[]) || [];

  switch (type) {
    case "object":
      if (!properties) {
        return z.record(z.any());
      }
      const shape: Record<string, z.ZodType<any>> = {};
      for (const [key, prop] of Object.entries(properties)) {
        const isRequired = required.includes(key);
        const zodType = jsonSchemaToZod(prop as Record<string, unknown>);
        shape[key] = isRequired ? zodType : zodType.optional();
      }
      return z.object(shape);

    case "string":
      let stringSchema = z.string();
      if (schema.enum && Array.isArray(schema.enum)) {
        // @ts-ignore - Zod expects literal types for enum
        stringSchema = z.enum(schema.enum as [string, ...string[]]);
      }
      if (schema.description) {
        stringSchema = stringSchema.describe(schema.description as string);
      }
      return stringSchema;

    case "number":
    case "integer":
      let numberSchema = type === "integer" ? z.number().int() : z.number();
      if (schema.description) {
        numberSchema = numberSchema.describe(schema.description as string);
      }
      return numberSchema;

    case "boolean":
      let booleanSchema = z.boolean();
      if (schema.description) {
        booleanSchema = booleanSchema.describe(schema.description as string);
      }
      return booleanSchema;

    case "array":
      const itemSchema = jsonSchemaToZod((schema.items as Record<string, unknown>) || {});
      let arraySchema = z.array(itemSchema);
      if (schema.description) {
        arraySchema = arraySchema.describe(schema.description as string);
      }
      return arraySchema;

    default:
      return z.any();
  }
}

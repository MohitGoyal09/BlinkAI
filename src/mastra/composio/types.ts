/**
 * Shared type definitions for Composio Tool Router
 *
 * Contains type definitions used across the MCP adapter, tool factory,
 * and other components of the Composio integration.
 */

import { z } from "zod";
import { Tool } from "./tool-router";
import { ComposioToolRouter } from "./tool-router";
import { SessionAuthState } from "./session-manager";

// ============================================================================
// Tool Router Tool Interfaces
// ============================================================================

/**
 * Interface for a Tool Router tool that can be executed
 */
export interface ToolRouterTool {
  /** The name/identifier of the tool */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** The tool slug from Composio (e.g., "gmail_send_email") */
  toolSlug: string;
  /** The toolkit this tool belongs to */
  toolkitSlug: string;
  /** JSON schema for the tool's input parameters */
  inputSchema: Record<string, unknown>;
  /** Execute the tool with the given arguments */
  execute: (args: Record<string, unknown>) => Promise<ToolExecutionResult>;
}

/**
 * Options for creating a Tool Router tool
 */
export interface ToolRouterToolOptions {
  /** Whether to enable automatic auth error handling */
  enableAuthRetry?: boolean;
  /** Custom auth prompt handler */
  onAuthRequired?: (authState: SessionAuthState) => Promise<void> | void;
  /** Maximum number of retries for failed executions */
  maxRetries?: number;
  /** Timeout in milliseconds for tool execution */
  timeoutMs?: number;
  /** Whether to include raw response data */
  includeRawResponse?: boolean;
}

/**
 * Context provided during tool execution
 */
export interface ToolExecutionContext {
  /** The session ID for this execution */
  sessionId: string;
  /** The project ID associated with the session */
  projectId: string;
  /** Optional user ID */
  userId?: string;
  /** Agent/thread context if available */
  agentContext?: {
    threadId?: string;
    resourceId?: string;
  };
}

/**
 * Result of a tool execution
 */
export interface ToolExecutionResult<T = unknown> {
  /** Whether the execution was successful */
  success: boolean;
  /** The result data */
  data: T;
  /** Error information if execution failed */
  error?: {
    message: string;
    code: string;
    details?: Record<string, unknown>;
  };
  /** Unique execution ID */
  executionId: string;
  /** Metadata about the execution */
  metadata?: {
    durationMs?: number;
    toolSlug?: string;
    retryCount?: number;
  };
}

// ============================================================================
// MCP Protocol Types
// ============================================================================

/**
 * MCP tool definition format
 */
export interface McpToolDefinition {
  /** Tool name (lowercase with underscores) */
  name: string;
  /** Tool description */
  description: string;
  /** Input schema in JSON Schema format */
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
    description?: string;
  };
}

/**
 * MCP tool execution result
 */
export interface McpToolResult {
  /** Content items returned by the tool */
  content: McpContentItem[];
  /** Whether the result represents an error */
  isError?: boolean;
}

/**
 * Individual content item in an MCP tool result
 */
export type McpContentItem =
  | McpTextContent
  | McpImageContent
  | McpResourceContent;

/**
 * Text content item
 */
export interface McpTextContent {
  type: "text";
  text: string;
}

/**
 * Image content item
 */
export interface McpImageContent {
  type: "image";
  data: string; // base64 encoded
  mimeType: string;
}

/**
 * Resource content item
 */
export interface McpResourceContent {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string; // base64 encoded
  };
}

/**
 * MCP resource definition
 */
export interface McpResourceDefinition {
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type of the resource */
  mimeType?: string;
}

/**
 * MCP resource content
 */
export interface McpResource {
  /** Resource URI */
  uri: string;
  /** Resource name */
  name: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
  /** Text content (if text resource) */
  text?: string;
  /** Binary content as base64 (if binary resource) */
  blob?: string;
}

/**
 * MCP server capabilities
 */
export interface McpServerCapabilities {
  /** Whether the server supports tools */
  tools?: boolean;
  /** Whether the server supports resources */
  resources?: boolean;
  /** Whether the server supports resource subscriptions */
  resourceSubscriptions?: boolean;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

/**
 * Zod schema for McpToolDefinition
 */
export const ZMcpToolDefinition = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
    additionalProperties: z.boolean().optional(),
    description: z.string().optional(),
  }),
});

/**
 * Zod schema for McpToolResult
 */
export const ZMcpToolResult = z.object({
  content: z.array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.string(),
      }),
      z.object({
        type: z.literal("resource"),
        resource: z.object({
          uri: z.string(),
          mimeType: z.string().optional(),
          text: z.string().optional(),
          blob: z.string().optional(),
        }),
      }),
    ])
  ),
  isError: z.boolean().optional(),
});

/**
 * Zod schema for ToolExecutionResult
 */
export const ZToolExecutionResult = z.object({
  success: z.boolean(),
  data: z.any(),
  error: z
    .object({
      message: z.string(),
      code: z.string(),
      details: z.record(z.any()).optional(),
    })
    .optional(),
  executionId: z.string(),
  metadata: z
    .object({
      durationMs: z.number().optional(),
      toolSlug: z.string().optional(),
      retryCount: z.number().optional(),
    })
    .optional(),
});

/**
 * Zod schema for ToolRouterToolOptions
 */
export const ZToolRouterToolOptions = z.object({
  enableAuthRetry: z.boolean().optional(),
  onAuthRequired: z.function().optional(),
  maxRetries: z.number().optional(),
  timeoutMs: z.number().optional(),
  includeRawResponse: z.boolean().optional(),
});

/**
 * Zod schema for ToolExecutionContext
 */
export const ZToolExecutionContext = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  userId: z.string().optional(),
  agentContext: z
    .object({
      threadId: z.string().optional(),
      resourceId: z.string().optional(),
    })
    .optional(),
});

// ============================================================================
// MCP Adapter Types
// ============================================================================

/**
 * Configuration for the Composio MCP Adapter
 */
export interface McpAdapterConfig {
  /** The Tool Router instance to use */
  toolRouter: ComposioToolRouter;
  /** Optional prefix for tool names (default: "composio_") */
  toolPrefix?: string;
  /** Optional custom resource URI scheme (default: "toolrouter://") */
  resourceUriScheme?: string;
}

/**
 * MCP Server configuration
 */
export interface McpServerConfig {
  /** Session ID this server is bound to */
  sessionId: string;
  /** Project ID for the session */
  projectId: string;
  /** Optional user ID */
  userId?: string;
  /** Toolkits to expose (empty = all) */
  toolkits?: string[];
  /** Specific tools to expose (empty = all from selected toolkits) */
  toolFilter?: string[];
  /** Whether to expose file mounts as resources */
  exposeFileMounts?: boolean;
}

/**
 * Parsed resource URI components
 */
export interface ParsedResourceUri {
  /** The mount ID */
  mountId: string;
  /** The file ID (optional for list operations) */
  fileId?: string;
  /** The operation type (file or list) */
  operation: "file" | "list";
}

/**
 * Tool batch creation options
 */
export interface ToolBatchOptions {
  /** Specific toolkit slugs to include */
  toolkits?: string[];
  /** Specific tool slugs to include (overrides toolkit filter) */
  tools?: string[];
  /** Toolkits to exclude */
  excludeToolkits?: string[];
  /** Tools to exclude */
  excludeTools?: string[];
}

/**
 * Factory function type for creating tool router tools
 */
export type ToolRouterToolFactory = (
  toolRouter: ComposioToolRouter,
  sessionId: string,
  toolSlug: string,
  options?: ToolRouterToolOptions
) => Promise<ToolRouterTool>;

/**
 * Mastra-compatible tool definition
 * This matches the structure expected by Mastra's createTool function
 */
export interface MastraToolDefinition {
  id: string;
  description: string;
  inputSchema: z.ZodType<any>;
  execute: (params: any, context: any) => Promise<any>;
}

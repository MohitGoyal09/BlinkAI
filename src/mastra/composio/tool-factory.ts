/**
 * Tool Factory for Composio Tool Router
 *
 * Provides factory functions for creating executable tools from Tool Router
 * definitions, with support for auth error handling, retries, and MCP compatibility.
 */

import { z } from "zod";
import { createTool, Tool as MastraTool } from "@mastra/core/tools";
import { ComposioToolRouter, Tool } from "./tool-router";
import { RetryManager } from "./retry-manager";
import { AuthRequiredError } from "./errors";
import {
  ToolRouterTool,
  ToolRouterToolOptions,
  ToolExecutionContext,
  ToolBatchOptions,
  McpToolDefinition,
  McpToolResult,
  MastraToolDefinition,
  ToolExecutionResult,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TOOL_PREFIX = "composio_";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 30000;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert a Composio tool slug to a valid tool name
 * @param slug - The tool slug (e.g., "GMAIL_SEND_EMAIL")
 * @returns The formatted tool name (e.g., "composio_gmail_send_email")
 */
export function formatToolName(slug: string, prefix: string = DEFAULT_TOOL_PREFIX): string {
  return `${prefix}${slug.toLowerCase()}`;
}

/**
 * Extract the original tool slug from a formatted tool name
 * @param name - The formatted tool name
 * @param prefix - The prefix used (default: "composio_")
 * @returns The original tool slug
 */
export function extractToolSlug(name: string, prefix: string = DEFAULT_TOOL_PREFIX): string {
  if (name.startsWith(prefix)) {
    return name.slice(prefix.length).toUpperCase();
  }
  return name.toUpperCase();
}

/**
 * Convert JSON schema to Zod schema
 * This is a simplified converter for common schema types
 * @param schema - JSON schema object
 * @returns Zod schema
 */
export function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<any> {
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
      return z.boolean();

    case "array":
      const items = schema.items as Record<string, unknown>;
      return z.array(items ? jsonSchemaToZod(items) : z.any());

    case "null":
      return z.null();

    default:
      return z.any();
  }
}

/**
 * Build a descriptive tool description from the tool info
 * @param tool - The Composio tool
 * @returns Enhanced description
 */
export function buildToolDescription(tool: Tool): string {
  const parts: string[] = [tool.description];

  if (tool.toolkit?.name) {
    parts.push(`\n\nToolkit: ${tool.toolkit.name}`);
  }

  return parts.join("");
}

// ============================================================================
// Single Tool Creation
// ============================================================================

/**
 * Options for creating a single tool
 */
interface CreateToolOptions extends ToolRouterToolOptions {
  /** Custom description override */
  description?: string;
  /** Custom name override */
  name?: string;
}

/**
 * Create a single executable tool from the Tool Router
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID for tool execution
 * @param toolSlug - The tool slug (e.g., "gmail_send_email")
 * @param options - Optional configuration
 * @returns A ToolRouterTool instance
 *
 * @example
 * ```typescript
 * const tool = await createToolRouterTool(
 *   toolRouter,
 *   sessionId,
 *   "gmail_send_email",
 *   {
 *     enableAuthRetry: true,
 *     onAuthRequired: (state) => console.log(`Auth required: ${state.linkUrl}`)
 *   }
 * );
 *
 * const result = await tool.execute({ to: "user@example.com", subject: "Hello" });
 * ```
 */
export async function createToolRouterTool(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  toolSlug: string,
  options: CreateToolOptions = {}
): Promise<ToolRouterTool> {
  const {
    enableAuthRetry = true,
    onAuthRequired,
    maxRetries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    includeRawResponse = false,
    description: customDescription,
    name: customName,
  } = options;

  // Get tool metadata from the Tool Router
  const tools = await toolRouter.listTools(sessionId, { toolkitSlug: toolSlug.split("_")[0] });
  const tool = tools.find((t) => t.slug === toolSlug);

  if (!tool) {
    throw new Error(`Tool not found: ${toolSlug}`);
  }

  const retryManager = new RetryManager({
    maxRetries,
    baseDelayMs: 1000,
    maxDelayMs: timeoutMs,
    backoffMultiplier: 2,
    jitter: true,
  });

  const name = customName || formatToolName(tool.slug);
  const description = customDescription || buildToolDescription(tool);

  // Create the tool with auth error handling
  const execute = async (args: Record<string, unknown>): Promise<ToolExecutionResult> => {
    const startTime = Date.now();
    let retryCount = 0;

    const operation = async (): Promise<ToolExecutionResult> => {
      try {
        const result = await toolRouter.executeTool(sessionId, toolSlug, {
          arguments: args,
        });

        const durationMs = Date.now() - startTime;

        // Return with metadata added
        const enhancedResult: ToolExecutionResult = {
          success: result.success,
          data: result.data,
          error: result.error,
          executionId: result.executionId,
          metadata: {
            durationMs,
            toolSlug,
            retryCount,
          },
        };
        return enhancedResult;
      } catch (error) {
        // Handle auth errors
        if (error instanceof AuthRequiredError && enableAuthRetry) {
          const authState = {
            sessionId,
            toolkitSlug: error.toolkitSlug,
            authScheme: "OAUTH2",
            status: "link_required" as const,
            linkUrl: error.linkUrl,
          };

          if (onAuthRequired) {
            await onAuthRequired(authState);
          }

          // Retry after auth
          const retryResult = await toolRouter.executeTool(sessionId, toolSlug, {
            arguments: args,
          });

          const durationMs = Date.now() - startTime;
          const enhancedResult: ToolExecutionResult = {
            success: retryResult.success,
            data: retryResult.data,
            error: retryResult.error,
            executionId: retryResult.executionId,
            metadata: {
              durationMs,
              toolSlug,
              retryCount: ++retryCount,
            },
          };
          return enhancedResult;
        }

        throw error;
      }
    };

    return retryManager.executeWithRetry(operation, `execute-${toolSlug}`);
  };

  return {
    name,
    description,
    toolSlug: tool.slug,
    toolkitSlug: tool.toolkit.slug,
    inputSchema: tool.inputSchema,
    execute,
  };
}

// ============================================================================
// Bulk Tool Creation
// ============================================================================

/**
 * Create multiple tools from the Tool Router
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID for tool execution
 * @param options - Batch creation options
 * @returns Array of ToolRouterTool instances
 *
 * @example
 * ```typescript
 * // Create all tools from specific toolkits
 * const tools = await createToolRouterTools(toolRouter, sessionId, {
 *   toolkits: ["gmail", "slack"]
 * });
 *
 * // Create specific tools only
 * const tools = await createToolRouterTools(toolRouter, sessionId, {
 *   tools: ["gmail_send_email", "slack_post_message"]
 * });
 * ```
 */
export async function createToolRouterTools(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  options: ToolBatchOptions & ToolRouterToolOptions = {}
): Promise<ToolRouterTool[]> {
  const {
    toolkits,
    tools: specificTools,
    excludeToolkits,
    excludeTools,
    ...toolOptions
  } = options;

  let tools: Tool[] = [];

  // Fetch tools based on filters
  if (specificTools && specificTools.length > 0) {
    // Fetch specific tools
    for (const slug of specificTools) {
      try {
        const toolkitSlug = slug.split("_")[0];
        const availableTools = await toolRouter.listTools(sessionId, { toolkitSlug });
        const tool = availableTools.find((t) => t.slug === slug);
        if (tool) {
          tools.push(tool);
        }
      } catch (error) {
        console.warn(`Failed to fetch tool ${slug}:`, error);
      }
    }
  } else if (toolkits && toolkits.length > 0) {
    // Fetch tools from specific toolkits
    for (const toolkitSlug of toolkits) {
      try {
        const toolkitTools = await toolRouter.listTools(sessionId, { toolkitSlug });
        tools.push(...toolkitTools);
      } catch (error) {
        console.warn(`Failed to fetch tools from toolkit ${toolkitSlug}:`, error);
      }
    }
  } else {
    // Fetch all available tools
    tools = await toolRouter.listTools(sessionId);
  }

  // Apply exclusion filters
  if (excludeToolkits && excludeToolkits.length > 0) {
    tools = tools.filter((t) => !excludeToolkits.includes(t.toolkit.slug));
  }
  if (excludeTools && excludeTools.length > 0) {
    tools = tools.filter((t) => !excludeTools.includes(t.slug));
  }

  // Create executable tools
  const toolPromises = tools.map((tool) =>
    createToolRouterTool(toolRouter, sessionId, tool.slug, toolOptions)
  );

  return Promise.all(toolPromises);
}

// ============================================================================
// MCP-Compatible Tool Creation
// ============================================================================

/**
 * Convert a Composio Tool to MCP tool definition format
 *
 * @param tool - The Composio tool
 * @param prefix - Optional prefix for the tool name
 * @returns MCP tool definition
 */
export function convertToMcpTool(tool: Tool, prefix: string = DEFAULT_TOOL_PREFIX): McpToolDefinition {
  const schema = tool.inputSchema as Record<string, unknown>;
  const properties = (schema?.properties as Record<string, unknown>) || {};
  const required = (schema?.required as string[]) || [];

  return {
    name: formatToolName(tool.slug, prefix),
    description: buildToolDescription(tool),
    inputSchema: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    },
  };
}

/**
 * Convert a ToolExecutionResult to MCP tool result format
 *
 * @param result - The execution result
 * @returns MCP tool result
 */
export function convertToMcpResult(result: ToolExecutionResult): McpToolResult {
  if (!result.success) {
    return {
      content: [
        {
          type: "text",
          text: result.error?.message || "Tool execution failed",
        },
      ],
      isError: true,
    };
  }

  const data = result.data;

  // Handle string responses directly
  if (typeof data === "string") {
    return {
      content: [{ type: "text", text: data }],
    };
  }

  // Handle image data
  if (
    data &&
    typeof data === "object" &&
    ("imageData" in data || "base64" in data || "image_url" in data)
  ) {
    const imageData = (data as any).imageData || (data as any).base64 || (data as any).image_url;
    const mimeType = (data as any).mimeType || (data as any).mime_type || "image/png";
    return {
      content: [
        {
          type: "image",
          data: imageData,
          mimeType,
        },
      ],
    };
  }

  // Default: stringify JSON
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

/**
 * Create MCP-compatible tool definitions from Tool Router tools
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID
 * @param options - Batch creation options
 * @returns Array of MCP tool definitions
 */
export async function createToolRouterMcpTools(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  options: ToolBatchOptions & { prefix?: string } = {}
): Promise<McpToolDefinition[]> {
  const { prefix = DEFAULT_TOOL_PREFIX, ...batchOptions } = options;

  // Get the tools
  let tools: Tool[] = [];

  if (batchOptions.tools && batchOptions.tools.length > 0) {
    for (const slug of batchOptions.tools) {
      const toolkitSlug = slug.split("_")[0];
      const availableTools = await toolRouter.listTools(sessionId, { toolkitSlug });
      const tool = availableTools.find((t) => t.slug === slug);
      if (tool) tools.push(tool);
    }
  } else if (batchOptions.toolkits && batchOptions.toolkits.length > 0) {
    for (const toolkitSlug of batchOptions.toolkits) {
      const toolkitTools = await toolRouter.listTools(sessionId, { toolkitSlug });
      tools.push(...toolkitTools);
    }
  } else {
    tools = await toolRouter.listTools(sessionId);
  }

  // Apply exclusions
  if (batchOptions.excludeToolkits) {
    tools = tools.filter((t) => !batchOptions.excludeToolkits!.includes(t.toolkit.slug));
  }
  if (batchOptions.excludeTools) {
    tools = tools.filter((t) => !batchOptions.excludeTools!.includes(t.slug));
  }

  return tools.map((tool) => convertToMcpTool(tool, prefix));
}

// ============================================================================
// Mastra-Compatible Tool Creation
// ============================================================================

/**
 * Create Mastra-compatible tool definitions from Tool Router
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID
 * @param options - Batch creation options
 * @returns Array of Mastra Tool instances
 */
export async function createMastraTools(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  options: ToolBatchOptions & ToolRouterToolOptions = {}
): Promise<MastraTool<any, any, any>[]> {
  const toolRouterTools = await createToolRouterTools(toolRouter, sessionId, options);

  return toolRouterTools.map((toolRouterTool) => {
    // Convert JSON schema to Zod
    const inputSchema = jsonSchemaToZod(toolRouterTool.inputSchema);

    // Create the Mastra tool
    return createTool({
      id: toolRouterTool.name,
      description: toolRouterTool.description,
      inputSchema,
      execute: async (params, context) => {
        const result = await toolRouterTool.execute(params);

        if (!result.success) {
          throw new Error(result.error?.message || "Tool execution failed");
        }

        return result.data;
      },
    });
  });
}

/**
 * Create a single Mastra-compatible tool
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID
 * @param toolSlug - The tool slug
 * @param options - Tool options
 * @returns Mastra Tool instance
 */
export async function createMastraTool(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  toolSlug: string,
  options: ToolRouterToolOptions = {}
): Promise<MastraTool<any, any, any>> {
  const toolRouterTool = await createToolRouterTool(toolRouter, sessionId, toolSlug, options);

  const inputSchema = jsonSchemaToZod(toolRouterTool.inputSchema);

  return createTool({
    id: toolRouterTool.name,
    description: toolRouterTool.description,
    inputSchema,
    execute: async (params, context) => {
      const result = await toolRouterTool.execute(params);

      if (!result.success) {
        throw new Error(result.error?.message || "Tool execution failed");
      }

      return result.data;
    },
  });
}

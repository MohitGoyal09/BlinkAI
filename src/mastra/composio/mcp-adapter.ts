/**
 * MCP Adapter for Composio Tool Router
 *
 * Provides an MCP (Model Context Protocol) bridge that allows Composio Tool Router
 * tools to be exposed through the MCP protocol. Supports tools, resources, and
 * resource subscriptions.
 */

import { z } from "zod";
import { ComposioToolRouter, Tool, ToolExecutionResult as RouterToolExecutionResult } from "./tool-router";
import { SessionManager, ToolRouterSession, SessionAuthState } from "./session-manager";
import { FileOperationsManager, FileMountEntry, Mount } from "./file-operations";
import { RetryManager } from "./retry-manager";
import { AuthRequiredError, ToolRouterError } from "./errors";
import {
  McpToolDefinition,
  McpToolResult,
  McpResourceDefinition,
  McpResource,
  McpServerCapabilities,
  McpAdapterConfig,
  McpServerConfig,
  ParsedResourceUri,
  ToolRouterToolOptions,
  ToolExecutionResult,
} from "./types";
import {
  formatToolName,
  extractToolSlug,
  convertToMcpTool,
  convertToMcpResult,
  createToolRouterTool,
} from "./tool-factory";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TOOL_PREFIX = "composio_";
const DEFAULT_RESOURCE_SCHEME = "toolrouter://";
const RESOURCE_URI_REGEX = /^toolrouter:\/\/mount\/([^/]+)(?:\/file\/(.+))?$/;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert JSON schema to MCP tool input schema
 *
 * @param toolSchema - The tool's JSON schema
 * @returns MCP-compatible input schema
 */
export function convertJsonSchemaToMcp(
  toolSchema: Record<string, unknown>
): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  if (!toolSchema || typeof toolSchema !== "object") {
    return {
      type: "object",
      properties: {},
    };
  }

  const properties = (toolSchema.properties as Record<string, unknown>) || {};
  const required = extractRequiredFields(toolSchema);

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * Extract required fields from a JSON schema
 *
 * @param schema - JSON schema object
 * @returns Array of required field names
 */
export function extractRequiredFields(schema: Record<string, unknown>): string[] {
  if (!schema || typeof schema !== "object") {
    return [];
  }

  const required = schema.required as string[];
  if (Array.isArray(required)) {
    return required;
  }

  // If no explicit required array, check for required markers in properties
  const properties = schema.properties as Record<string, Record<string, unknown>>;
  if (!properties) {
    return [];
  }

  return Object.entries(properties)
    .filter(([_, prop]) => prop && typeof prop === "object" && (prop as any).required === true)
    .map(([key, _]) => key);
}

/**
 * Build a resource URI for a file mount
 *
 * @param mountId - The mount ID
 * @param fileId - Optional file ID
 * @returns Resource URI
 */
export function buildResourceUri(mountId: string, fileId?: string): string {
  if (fileId) {
    return `${DEFAULT_RESOURCE_SCHEME}mount/${mountId}/file/${fileId}`;
  }
  return `${DEFAULT_RESOURCE_SCHEME}mount/${mountId}/list`;
}

/**
 * Parse a resource URI into its components
 *
 * @param uri - The resource URI
 * @returns Parsed URI components or null if invalid
 */
export function parseResourceUri(uri: string): ParsedResourceUri | null {
  const match = uri.match(RESOURCE_URI_REGEX);
  if (!match) {
    return null;
  }

  const [, mountId, fileId] = match;
  return {
    mountId,
    fileId,
    operation: fileId ? "file" : "list",
  };
}

/**
 * Convert a file mount entry to MCP resource format
 *
 * @param entry - The file mount entry
 * @param mountId - The mount ID
 * @returns MCP resource
 */
function convertFileEntryToResource(entry: FileMountEntry, mountId: string): McpResource {
  return {
    uri: buildResourceUri(mountId, entry.id),
    name: entry.name,
    mimeType: entry.mimeType,
  };
}

// ============================================================================
// ToolRouterMcpServer
// ============================================================================

/**
 * MCP Server implementation that exposes Tool Router functionality
 *
 * This class implements the MCP protocol for a specific session, providing:
 * - Tool discovery and execution
 * - Resource access for file mounts
 * - Resource subscription for watching file changes
 */
export class ToolRouterMcpServer {
  private toolRouter: ComposioToolRouter;
  private config: McpServerConfig;
  private toolPrefix: string;
  private cachedTools: Map<string, Tool> = new Map();
  private resourceSubscribers: Map<string, Set<(resource: McpResource) => void>> = new Map();
  private fileOperationsManager: FileOperationsManager;
  private capabilities: McpServerCapabilities;

  constructor(
    toolRouter: ComposioToolRouter,
    config: McpServerConfig,
    options: { toolPrefix?: string; capabilities?: McpServerCapabilities } = {}
  ) {
    this.toolRouter = toolRouter;
    this.config = config;
    this.toolPrefix = options.toolPrefix || DEFAULT_TOOL_PREFIX;
    this.capabilities = {
      tools: true,
      resources: true,
      resourceSubscriptions: false,
      ...options.capabilities,
    };
    this.fileOperationsManager = new FileOperationsManager(
      (toolRouter as any).config
    );
  }

  /**
   * Initialize the MCP server with available tools
   */
  async initialize(): Promise<void> {
    // Load and cache available tools
    const tools = await this.loadTools();
    for (const tool of tools) {
      this.cachedTools.set(tool.slug, tool);
    }
  }

  /**
   * Get the server's capabilities
   */
  getCapabilities(): McpServerCapabilities {
    return { ...this.capabilities };
  }

  /**
   * Load tools based on server configuration
   */
  private async loadTools(): Promise<Tool[]> {
    const { sessionId, toolkits, toolFilter } = this.config;

    let tools: Tool[] = [];

    if (toolFilter && toolFilter.length > 0) {
      // Load specific tools
      for (const slug of toolFilter) {
        const toolkitSlug = slug.split("_")[0];
        const availableTools = await this.toolRouter.listTools(sessionId, {
          toolkitSlug,
        });
        const tool = availableTools.find((t) => t.slug === slug);
        if (tool) tools.push(tool);
      }
    } else if (toolkits && toolkits.length > 0) {
      // Load tools from specific toolkits
      for (const toolkitSlug of toolkits) {
        const toolkitTools = await this.toolRouter.listTools(sessionId, {
          toolkitSlug,
        });
        tools.push(...toolkitTools);
      }
    } else {
      // Load all available tools
      tools = await this.toolRouter.listTools(sessionId);
    }

    return tools;
  }

  /**
   * List available tools in MCP format
   */
  async listTools(): Promise<McpToolDefinition[]> {
    const tools = Array.from(this.cachedTools.values());
    return tools.map((tool) => convertToMcpTool(tool, this.toolPrefix));
  }

  /**
   * Execute a tool by name with the given arguments
   *
   * @param name - The tool name (with or without prefix)
   * @param args - Tool arguments
   * @returns MCP tool result
   */
  async callTool(name: string, args: unknown): Promise<McpToolResult> {
    const actualToolSlug = extractToolSlug(name, this.toolPrefix);

    // Check if tool exists in cache
    if (!this.cachedTools.has(actualToolSlug)) {
      return {
        content: [
          {
            type: "text",
            text: `Tool not found: ${name}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await this.toolRouter.executeTool(
        this.config.sessionId,
        actualToolSlug,
        {
          arguments: typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
        }
      );

      return convertToMcpResult(result as ToolExecutionResult);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        return {
          content: [
            {
              type: "text",
              text: `Authentication required for ${error.toolkitSlug}. Please visit: ${error.linkUrl}`,
            },
          ],
          isError: true,
        };
      }

      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Tool execution failed: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  /**
   * List available resources (file mounts)
   */
  async listResources(): Promise<McpResourceDefinition[]> {
    if (!this.config.exposeFileMounts) {
      return [];
    }

    try {
      const mounts = await this.fileOperationsManager.listMounts(this.config.sessionId);

      const resources: McpResourceDefinition[] = [];
      for (const mount of mounts) {
        resources.push({
          uri: buildResourceUri(mount.id),
          name: mount.name,
          description: mount.description,
        });

        // Also list files in the mount
        const files = await this.fileOperationsManager.listFiles(
          this.config.sessionId,
          mount.id
        );

        for (const file of files) {
          resources.push({
            uri: buildResourceUri(mount.id, file.id),
            name: file.name,
            mimeType: file.mimeType,
          });
        }
      }

      return resources;
    } catch (error) {
      console.error("[ToolRouterMcpServer] Failed to list resources:", error);
      return [];
    }
  }

  /**
   * Read a resource by URI
   *
   * @param uri - The resource URI
   * @returns The resource content
   */
  async readResource(uri: string): Promise<McpResource | null> {
    if (!this.config.exposeFileMounts) {
      return null;
    }

    const parsed = parseResourceUri(uri);
    if (!parsed) {
      return null;
    }

    const { mountId, fileId } = parsed;

    try {
      if (!fileId) {
        // List operation - return mount info
        const mounts = await this.fileOperationsManager.listMounts(this.config.sessionId);
        const mount = mounts.find((m) => m.id === mountId);
        if (!mount) {
          return null;
        }

        return {
          uri,
          name: mount.name,
          description: mount.description,
          text: JSON.stringify(
            {
              id: mount.id,
              name: mount.name,
              description: mount.description,
              createdAt: mount.createdAt,
              updatedAt: mount.updatedAt,
            },
            null,
            2
          ),
        };
      }

      // Get file entry
      const files = await this.fileOperationsManager.listFiles(
        this.config.sessionId,
        mountId
      );
      const file = files.find((f) => f.id === fileId);

      if (!file) {
        return null;
      }

      // For text files, fetch and return content
      if (file.mimeType.startsWith("text/") || file.mimeType === "application/json") {
        const response = await fetch(file.url);
        const text = await response.text();

        return {
          uri,
          name: file.name,
          mimeType: file.mimeType,
          text,
        };
      }

      // For binary files, return as blob
      const response = await fetch(file.url);
      const buffer = await response.arrayBuffer();
      const blob = Buffer.from(buffer).toString("base64");

      return {
        uri,
        name: file.name,
        mimeType: file.mimeType,
        blob,
      };
    } catch (error) {
      console.error(`[ToolRouterMcpServer] Failed to read resource ${uri}:`, error);
      return null;
    }
  }

  /**
   * Subscribe to resource changes
   *
   * @param uri - The resource URI to watch
   * @param callback - Callback function when resource changes
   * @returns Unsubscribe function
   */
  subscribeToResource(
    uri: string,
    callback: (resource: McpResource) => void
  ): () => void {
    if (!this.resourceSubscribers.has(uri)) {
      this.resourceSubscribers.set(uri, new Set());
    }

    const subscribers = this.resourceSubscribers.get(uri)!;
    subscribers.add(callback);

    // Return unsubscribe function
    return () => {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.resourceSubscribers.delete(uri);
      }
    };
  }

  /**
   * Notify subscribers that a resource has changed
   *
   * @param uri - The resource URI that changed
   */
  private notifyResourceChange(uri: string): void {
    const subscribers = this.resourceSubscribers.get(uri);
    if (!subscribers) return;

    this.readResource(uri).then((resource) => {
      if (resource) {
        subscribers.forEach((callback) => callback(resource));
      }
    });
  }
}

// ============================================================================
// ComposioMcpAdapter
// ============================================================================

/**
 * Main MCP Adapter class for Composio Tool Router
 *
 * This adapter bridges the Composio Tool Router with the MCP protocol,
 * allowing agents to discover and execute Composio tools through MCP.
 */
export class ComposioMcpAdapter {
  private toolRouter: ComposioToolRouter;
  private toolPrefix: string;
  private resourceUriScheme: string;
  private servers: Map<string, ToolRouterMcpServer> = new Map();

  constructor(config: McpAdapterConfig) {
    this.toolRouter = config.toolRouter;
    this.toolPrefix = config.toolPrefix || DEFAULT_TOOL_PREFIX;
    this.resourceUriScheme = config.resourceUriScheme || DEFAULT_RESOURCE_SCHEME;
  }

  /**
   * Create an MCP server instance for a session
   *
   * @param sessionId - The session ID
   * @param config - Optional server configuration overrides
   * @returns The MCP server instance
   */
  async createServer(
    sessionId: string,
    config: Partial<McpServerConfig> = {}
  ): Promise<ToolRouterMcpServer> {
    // Get session info
    const session = await this.getSessionInfo(sessionId);
    if (!session) {
      throw new ToolRouterError(
        `Session not found: ${sessionId}`,
        "SESSION_NOT_FOUND",
        404
      );
    }

    const serverConfig: McpServerConfig = {
      sessionId,
      projectId: session.projectId,
      userId: session.userId,
      exposeFileMounts: true,
      ...config,
    };

    const server = new ToolRouterMcpServer(this.toolRouter, serverConfig, {
      toolPrefix: this.toolPrefix,
    });

    await server.initialize();

    // Store server instance
    this.servers.set(sessionId, server);

    return server;
  }

  /**
   * Get or create a server for a session
   */
  async getOrCreateServer(
    sessionId: string,
    config: Partial<McpServerConfig> = {}
  ): Promise<ToolRouterMcpServer> {
    if (this.servers.has(sessionId)) {
      return this.servers.get(sessionId)!;
    }
    return this.createServer(sessionId, config);
  }

  /**
   * Get session info from the tool router
   */
  private async getSessionInfo(
    sessionId: string
  ): Promise<{ projectId: string; userId?: string } | null> {
    // Try to find session in the session manager
    const sessionManager = (this.toolRouter as any).sessionManager;
    if (sessionManager) {
      // The session manager doesn't expose a direct getById method,
      // so we need to work around this
      const sessions = sessionManager.getAllSessions?.() || [];
      for (const session of sessions) {
        if (session.id === sessionId) {
          return {
            projectId: session.projectId,
            userId: session.userId,
          };
        }
      }
    }

    // Return a default if we can't find the session
    return {
      projectId: sessionId, // Use sessionId as projectId fallback
    };
  }

  /**
   * Convert a Tool Router tool to MCP format
   *
   * @param tool - The Composio tool
   * @returns MCP tool definition
   */
  convertToolToMcp(tool: Tool): McpToolDefinition {
    return convertToMcpTool(tool, this.toolPrefix);
  }

  /**
   * Convert an MCP tool call result to the standard format
   *
   * @param result - The MCP tool result
   * @returns Tool execution result
   */
  convertMcpToToolResult(result: McpToolResult): ToolExecutionResult {
    if (result.isError) {
      const errorText = result.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("\n");

      return {
        success: false,
        data: null,
        error: {
          message: errorText || "Tool execution failed",
          code: "MCP_ERROR",
        },
        executionId: `mcp-${Date.now()}`,
      };
    }

    // Extract text content as data
    const textContent = result.content
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("\n");

    // Try to parse as JSON
    let data: unknown = textContent;
    try {
      data = JSON.parse(textContent);
    } catch {
      // Keep as string if not valid JSON
    }

    return {
      success: true,
      data,
      executionId: `mcp-${Date.now()}`,
    };
  }

  /**
   * List tools for a session
   *
   * @param sessionId - The session ID
   * @returns Array of MCP tool definitions
   */
  async listTools(sessionId: string): Promise<McpToolDefinition[]> {
    const server = await this.getOrCreateServer(sessionId);
    return server.listTools();
  }

  /**
   * Call a tool by name
   *
   * @param sessionId - The session ID
   * @param toolName - The tool name
   * @param args - Tool arguments
   * @returns MCP tool result
   */
  async callTool(
    sessionId: string,
    toolName: string,
    args: unknown
  ): Promise<McpToolResult> {
    const server = await this.getOrCreateServer(sessionId);
    return server.callTool(toolName, args);
  }

  /**
   * List available resources for a session
   *
   * @param sessionId - The session ID
   * @returns Array of resource definitions
   */
  async listResources(sessionId: string): Promise<McpResourceDefinition[]> {
    const server = await this.getOrCreateServer(sessionId);
    return server.listResources();
  }

  /**
   * Read a resource by URI
   *
   * @param sessionId - The session ID
   * @param uri - The resource URI
   * @returns The resource or null if not found
   */
  async readResource(sessionId: string, uri: string): Promise<McpResource | null> {
    const server = await this.getOrCreateServer(sessionId);
    return server.readResource(uri);
  }

  /**
   * Dispose of the adapter and all its servers
   */
  dispose(): void {
    this.servers.clear();
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Create MCP tools from the Tool Router for a specific session
 *
 * This is a convenience function that creates MCP-compatible tool definitions
 * without setting up a full MCP server.
 *
 * @param toolRouter - The ComposioToolRouter instance
 * @param sessionId - The session ID
 * @param options - Options for tool selection
 * @returns Array of MCP tool definitions
 */
export async function createToolRouterMcpTools(
  toolRouter: ComposioToolRouter,
  sessionId: string,
  options: {
    toolkits?: string[];
    tools?: string[];
    prefix?: string;
  } = {}
): Promise<McpToolDefinition[]> {
  const { toolkits, tools: specificTools, prefix = DEFAULT_TOOL_PREFIX } = options;

  let tools: Tool[] = [];

  if (specificTools && specificTools.length > 0) {
    for (const slug of specificTools) {
      const toolkitSlug = slug.split("_")[0];
      const availableTools = await toolRouter.listTools(sessionId, { toolkitSlug });
      const tool = availableTools.find((t) => t.slug === slug);
      if (tool) tools.push(tool);
    }
  } else if (toolkits && toolkits.length > 0) {
    for (const toolkitSlug of toolkits) {
      const toolkitTools = await toolRouter.listTools(sessionId, { toolkitSlug });
      tools.push(...toolkitTools);
    }
  } else {
    tools = await toolRouter.listTools(sessionId);
  }

  return tools.map((tool) => convertToMcpTool(tool, prefix));
}

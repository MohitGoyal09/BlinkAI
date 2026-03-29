/**
 * Composio Tool Router - Public API
 *
 * Core infrastructure for Composio Tool Router integration.
 * Provides session management, tool discovery, execution, and authentication.
 */

// ============================================================================
// Configuration
// ============================================================================

export {
  ToolRouterConfigSchema,
  loadConfig,
  loadConfigWithDefaults,
  type ToolRouterConfig,
  type SessionConfig,
  type CacheConfig,
  type TimeoutConfig,
} from "./config";

// ============================================================================
// Errors
// ============================================================================

export {
  ToolRouterError,
  AuthRequiredError,
  SessionExpiredError,
  SessionLimitExceededError,
  ToolExecutionError,
  FileMountError,
  ApiResponseError,
  NetworkError,
  withErrorHandling,
} from "./errors";

// ============================================================================
// Session Management
// ============================================================================

export {
  SessionManager,
  type ToolRouterSession,
  type SessionAuthState,
  type CreateSessionParams,
} from "./session-manager";

// ============================================================================
// Tool Router
// ============================================================================

export {
  ComposioToolRouter,
  ZToolRouterSession,
  ZToolkit,
  ZTool,
  ZToolExecutionResult,
  ZLinkSessionResponse,
  ZAuthStatusResponse,
  ZFileMount,
  type Toolkit,
  type Tool,
  type ToolExecutionResult,
  type FileMount,
  type ToolExecutionParams,
} from "./tool-router";

// ============================================================================
// Retry Manager
// ============================================================================

export {
  RetryManager,
  withRetry,
  type RetryConfig,
} from "./retry-manager";

// ============================================================================
// Auth Flow
// ============================================================================

export {
  AuthFlowManager,
  type AuthFlowInitiationResult,
  type AuthStatusCallback,
} from "./auth-flow";

// ============================================================================
// File Operations
// ============================================================================

export {
  FileOperationsManager,
  ZFileMountEntry,
  ZFileListResponse,
  ZPresignedUrlResponse,
  ZMount,
  ZMountListResponse,
  type FileMountEntry,
  type FileListResponse,
  type PresignedUrlResponse,
  type Mount,
  type MountListResponse,
  type CreateMountConfig,
  type UploadFileConfig,
  type DownloadFileConfig,
} from "./file-operations";

// ============================================================================
// Shared Types
// ============================================================================

export {
  ZMcpToolDefinition,
  ZMcpToolResult,
  ZToolRouterToolOptions,
  ZToolExecutionContext,
  type ToolExecutionContext,
  type McpToolDefinition,
  type McpToolResult,
  type McpContentItem,
  type McpTextContent,
  type McpImageContent,
  type McpResourceContent,
  type McpResourceDefinition,
  type McpResource,
  type McpServerCapabilities,
  type ParsedResourceUri,
  type ToolRouterToolFactory,
  type MastraToolDefinition,
} from "./types";

// ============================================================================
// MCP Adapter
// ============================================================================

export {
  ComposioMcpAdapter,
  ToolRouterMcpServer,
  convertJsonSchemaToMcp,
  extractRequiredFields,
  buildResourceUri,
  parseResourceUri,
} from "./mcp-adapter";

// ============================================================================
// Tool Factory
// ============================================================================

export {
  createToolRouterTool,
  createToolRouterTools,
  createToolRouterMcpTools,
  createMastraTools,
  createMastraTool,
  formatToolName,
  extractToolSlug,
  jsonSchemaToZod,
  buildToolDescription,
  convertToMcpTool,
  convertToMcpResult,
} from "./tool-factory";

// ============================================================================
// Integration
// ============================================================================

export {
  // Session management
  getToolRouter,
  resetToolRouter,
  initializeToolRouterForProject,
  getToolRouterForProject,
  refreshSessionIfNeeded,
  closeToolRouterSession,
  cleanupExpiredSessions,
  // Tool operations
  executeToolWithAuthHandling,
  listAvailableToolkits,
  listAvailableTools,
  initiateToolkitAuth,
  checkToolkitAuthStatus,
  // Mastra tool factory
  createMastraToolRouterTool,
  createMastraToolRouterTools,
  // Types
  type ToolRouterSessionRecord,
  type ToolExecutionResponse,
} from "./integration";

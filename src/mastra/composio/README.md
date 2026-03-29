# Composio Tool Router Module

This module provides session-based tool management with built-in authentication handling for the Blink agent. It integrates with the Composio API to enable AI agents to securely access and execute tools from third-party services like Gmail, Calendar, Drive, and more.

## Quick Start

### 1. Installation

Ensure you have the required environment variables set:

```bash
# Required
COMPOSIO_API_KEY=your_api_key_here

# Optional (with defaults)
COMPOSIO_BASE_URL=https://backend.composio.dev
COMPOSIO_SESSION_TTL_SECONDS=3600
COMPOSIO_MAX_SESSIONS=100
```

### 2. Basic Usage

```typescript
import {
  initializeToolRouterForProject,
  executeToolWithAuthHandling,
  listAvailableToolkits,
} from './index';

// Create a session
const { sessionId, record } = await initializeToolRouterForProject(
  'my-project',
  'user-123'
);

// List available toolkits
const toolkits = await listAvailableToolkits(sessionId);
console.log('Available toolkits:', toolkits.map(t => t.name));

// Execute a tool
const result = await executeToolWithAuthHandling(
  sessionId,
  'gmail_send_email',
  {
    to: 'recipient@example.com',
    subject: 'Hello',
    body: 'World',
  }
);

if (result.success) {
  console.log('Success:', result.data);
} else if ('authRequired' in result && result.authRequired) {
  console.log('Please authenticate:', result.authUrl);
}
```

### 3. Authentication Flow

```typescript
import { initiateToolkitAuth, checkToolkitAuthStatus } from './index';

// Initiate auth
const authState = await initiateToolkitAuth(sessionId, 'gmail', 'OAUTH2');

if (authState.status === 'link_required') {
  console.log('Visit:', authState.linkUrl);
  
  // Poll for completion
  const status = await checkToolkitAuthStatus(sessionId, 'gmail');
  console.log('Auth status:', status.status);
}
```

## Module Structure

```
src/mastra/composio/
├── index.ts              # Public API exports
├── integration.ts        # Blink integration layer
├── tool-router.ts        # Core Tool Router API client
├── session-manager.ts    # Session lifecycle management
├── auth-flow.ts          # Authentication flow handling
├── file-operations.ts    # File mount operations
├── retry-manager.ts      # Retry with exponential backoff
├── errors.ts             # Custom error classes
├── types.ts              # Shared type definitions
├── tool-factory.ts       # Mastra tool creation
├── mcp-adapter.ts        # MCP protocol support
└── config.ts             # Configuration management
```

## API Documentation

### Session Management

#### `initializeToolRouterForProject(projectId, userId?)`

Creates a new Tool Router session for a project.

```typescript
const { sessionId, record } = await initializeToolRouterForProject(
  'project-123',
  'user-456'
);
```

**Parameters:**
- `projectId` (string): The project identifier
- `userId` (string, optional): User identifier for user-specific sessions

**Returns:** `{ sessionId: string; record: ToolRouterSessionRecord }`

#### `getToolRouterForProject(projectId, userId?, existingSessions?)`

Gets or creates a Tool Router session, reusing existing sessions when valid.

```typescript
const { toolRouter, sessionId, records } = await getToolRouterForProject(
  'project-123',
  'user-456',
  existingSessions
);
```

#### `refreshSessionIfNeeded(sessionId)`

Refreshes a session's TTL if it exists and is valid.

```typescript
const isValid = await refreshSessionIfNeeded(sessionId);
```

#### `closeToolRouterSession(projectId, sessionId, existingSessions)`

Closes a session and removes it from records.

```typescript
const updatedRecords = closeToolRouterSession(
  'project-123',
  sessionId,
  existingSessions
);
```

### Tool Operations

#### `executeToolWithAuthHandling(sessionId, toolSlug, params, fileMounts?)`

Executes a tool with automatic authentication handling.

```typescript
const result = await executeToolWithAuthHandling(
  sessionId,
  'gmail_send_email',
  { to: 'user@example.com', subject: 'Hello' }
);
```

**Returns:** `ToolExecutionResponse`
- Success: `{ success: true; data: unknown; executionId: string }`
- Auth Required: `{ success: false; authRequired: true; authUrl: string; toolkitSlug: string }`
- Error: `{ success: false; error: string; code: string }`

#### `listAvailableToolkits(sessionId)`

Lists all available toolkits for a session.

```typescript
const toolkits = await listAvailableToolkits(sessionId);
```

#### `listAvailableTools(sessionId, toolkitSlug?)`

Lists tools available for a session, optionally filtered by toolkit.

```typescript
const tools = await listAvailableTools(sessionId, 'gmail');
```

### Authentication

#### `initiateToolkitAuth(sessionId, toolkitSlug, authScheme?)`

Initiates authentication for a toolkit.

```typescript
const authState = await initiateToolkitAuth(sessionId, 'gmail', 'OAUTH2');
```

**Returns:** `SessionAuthState`
- `status`: `"pending" | "link_required" | "authenticated" | "failed"`
- `linkUrl`: URL for OAuth when status is `link_required`
- `connectedAccountId`: ID of the connected account when authenticated

#### `checkToolkitAuthStatus(sessionId, toolkitSlug)`

Checks the authentication status for a toolkit.

```typescript
const status = await checkToolkitAuthStatus(sessionId, 'gmail');
```

### File Operations

#### `FileOperationsManager`

Manages file mounts and operations.

```typescript
import { FileOperationsManager } from './file-operations';

const fileOps = new FileOperationsManager(config);

// Create a mount
const mount = await fileOps.createMount(sessionId, {
  name: 'my-mount',
  maxFileSize: 10 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf'],
});

// Get upload URL
const { url, fileId } = await fileOps.getPresignedUploadUrl(sessionId, {
  fileName: 'document.pdf',
  contentType: 'application/pdf',
  size: 1024,
});

// Upload file
await fetch(url, {
  method: 'PUT',
  body: fileContent,
  headers: { 'Content-Type': 'application/pdf' },
});
```

### Mastra Integration

#### `createMastraToolRouterTool(tool, sessionId, options?)`

Creates a Mastra-compatible tool from a Tool Router tool definition.

```typescript
const mastraTool = createMastraToolRouterTool(
  toolDefinition,
  sessionId,
  {
    onAuthRequired: (toolkitSlug, authUrl) => {
      console.log(`Auth required: ${authUrl}`);
    },
  }
);
```

#### `createMastraToolRouterTools(tools, sessionId, options?)`

Creates multiple Mastra-compatible tools.

```typescript
const mastraTools = createMastraToolRouterTools(tools, sessionId);

// Use with Mastra agent
const agent = new Agent({
  name: 'email-assistant',
  tools: mastraTools,
});
```

## Integration Examples

### With Blink Agent

```typescript
// In your agent configuration
import { createMastraToolRouterTools, listAvailableTools } from './composio';

async function configureAgent(sessionId: string) {
  // Get available tools
  const tools = await listAvailableTools(sessionId, 'gmail');
  
  // Convert to Mastra tools
  const mastraTools = createMastraToolRouterTools(tools, sessionId, {
    onAuthRequired: (toolkitSlug, authUrl) => {
      // Notify user about required auth
      notifyUser(`Please authenticate ${toolkitSlug}: ${authUrl}`);
    },
  });
  
  // Create agent with tools
  return new Agent({
    name: 'blink',
    tools: {
      ...mastraTools,
      // ... other tools
    },
  });
}
```

### With MCP Protocol

```typescript
import { ComposioMcpAdapter, ToolRouterMcpServer } from './mcp-adapter';

// Create MCP server
const adapter = new ComposioMcpAdapter(sessionId);
const mcpServer = new ToolRouterMcpServer(adapter);

// List tools in MCP format
const mcpTools = await mcpServer.listTools();

// Execute via MCP
const result = await mcpServer.executeTool('gmail_send_email', params);
```

### Session Persistence

```typescript
import {
  initializeToolRouterForProject,
  getToolRouterForProject,
  cleanupExpiredSessions,
} from './composio';

// Load sessions from storage
const storedSessions = await loadSessionsFromDatabase();

// Clean up expired
const validSessions = cleanupExpiredSessions(storedSessions);

// Get or create session
const { sessionId, records } = await getToolRouterForProject(
  projectId,
  userId,
  validSessions
);

// Save updated sessions
await saveSessionsToDatabase(records);
```

## Error Handling

### Error Classes

```typescript
import {
  AuthRequiredError,
  SessionExpiredError,
  ToolExecutionError,
  FileMountError,
  withErrorHandling,
} from './errors';

try {
  const result = await executeToolWithAuthHandling(sessionId, toolSlug, params);
} catch (error) {
  if (error instanceof AuthRequiredError) {
    console.log('Auth URL:', error.linkUrl);
  } else if (error instanceof SessionExpiredError) {
    // Create new session
    const newSession = await initializeToolRouterForProject(projectId);
  } else if (error instanceof ToolExecutionError) {
    console.error(`Tool ${error.toolSlug} failed:`, error.message);
  } else if (error instanceof FileMountError) {
    console.error(`File ${error.fileName} error:`, error.reason);
  }
}

// Using withErrorHandling helper
const result = await withErrorHandling(
  () => toolRouter.executeTool(sessionId, toolSlug, params),
  { toolSlug, sessionId, projectId }
);
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `COMPOSIO_API_KEY` | Yes | - | Your Composio API key |
| `COMPOSIO_BASE_URL` | No | `https://backend.composio.dev` | API base URL |
| `COMPOSIO_SESSION_TTL_SECONDS` | No | `3600` | Session lifetime in seconds |
| `COMPOSIO_MAX_SESSIONS` | No | `100` | Maximum concurrent sessions |

### Programmatic Configuration

```typescript
import { loadConfigWithDefaults } from './config';

const config = loadConfigWithDefaults({
  apiKey: 'custom-key',
  session: {
    ttlSeconds: 7200,
    maxSessions: 50,
  },
  cache: {
    enabled: true,
    maxSize: 50,
  },
  timeout: {
    requestMs: 60000,
    connectMs: 10000,
  },
});
```

## Testing

### Running Tests

```bash
# Run all tests
npm test -- src/mastra/composio/tests/

# Run specific test file
npm test -- src/mastra/composio/tests/config.test.ts
```

### Test Structure

```
src/mastra/composio/tests/
├── config.test.ts          # Configuration tests
├── errors.test.ts          # Error handling tests
├── session-manager.test.ts # Session management tests
├── tool-router.test.ts     # API integration tests (mocked)
└── integration.test.ts     # End-to-end integration tests
```

### Mocking the API

```typescript
import { vi } from 'vitest';

// Mock the Tool Router API
vi.mock('../tool-router', () => ({
  ComposioToolRouter: vi.fn().mockImplementation(() => ({
    createSession: vi.fn().mockResolvedValue({
      id: 'test-session-id',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
    }),
    executeTool: vi.fn().mockResolvedValue({
      success: true,
      data: { message: 'Success' },
      executionId: 'exec-123',
    }),
  })),
}));
```

## Troubleshooting

### Common Issues

#### Session Expiration

Sessions expire after the configured TTL (default: 1 hour). Handle this by:

1. Checking session validity before operations
2. Creating new sessions when expired
3. Using `refreshSessionIfNeeded()` to extend sessions

```typescript
const isValid = await refreshSessionIfNeeded(sessionId);
if (!isValid) {
  const { sessionId: newId } = await initializeToolRouterForProject(projectId);
}
```

#### Authentication Required

Some tools require authentication. The integration returns auth URLs:

```typescript
const result = await executeToolWithAuthHandling(sessionId, toolSlug, params);

if ('authRequired' in result && result.authRequired) {
  // Show auth URL to user
  console.log('Please visit:', result.authUrl);
}
```

#### Rate Limiting

Use the RetryManager for automatic retry with exponential backoff:

```typescript
import { RetryManager } from './retry-manager';

const retryManager = new RetryManager({
  maxRetries: 5,
  baseDelayMs: 2000,
});

const result = await retryManager.execute(
  () => toolRouter.executeTool(sessionId, toolSlug, params)
);
```

## Contributing

When adding new features or fixing bugs:

1. Add tests for new functionality
2. Update this README with API changes
3. Follow existing code patterns
4. Ensure error handling is comprehensive

## Resources

- [Composio Documentation](https://docs.composio.dev)
- [Mastra Documentation](https://mastra.ai/docs)
- [MCP Specification](https://modelcontextprotocol.io)

---

*Part of the Blink AI Agent System*

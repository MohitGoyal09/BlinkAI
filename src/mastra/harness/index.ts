import { Harness } from '@mastra/core/harness';
import { createWorkspaceTools } from '@mastra/core/workspace';
import { blinkAgent } from '../agents/coworker/agent';
import { AGENT_ID, DEFAULT_MODEL, agentConfig } from '../config/agent-config';
import { createBlinkSubagentTool } from './blink-subagent-tool';
import { getDynamicWorkspace } from '../agents/coworker/workspace';
import { subagents } from '../agents/subagents';
import { resolveModel } from '../agents/coworker/model';
import { stateSchema } from './schema';
import { getToolCategory } from './permissions';
import { getDynamicMemory } from './memory';
import { getMcpToolsets } from '../mcp';
import { filterComposioDuplicates } from './mcp-dedup';
import { viewImageTool } from './tools/view-image';
import { scheduledTasksTool } from './tools/scheduled-tasks';
import { researchSearchTool } from './tools/web-search';
import { searchVaultTool } from '../tools/search-vault';
import { getCurrentClassification } from '../agents/coworker/query-classifier';
import { storage } from '../db';
import { getToolRouterTools } from '../agents/coworker/tool-router-tools';
import { getCapabilityContext, resolveCapabilities, filterToolsByDecision, isDynamicCapabilitiesEnabled } from '../capabilities/resolver';
import {
  threadArtifactPutTool,
  threadArtifactListTool,
  threadArtifactGetTool,
  checkSubagentSpawnGateTool,
} from '../tools/thread-artifacts';
import { loadSkillSnippetTool } from '../tools/skill-snippet';

/** Concrete harness type used across the app (parameterized with our stateSchema) */
export type BlinkHarness = Harness<typeof stateSchema>;

// Backward compatibility alias
export type CoworkerHarness = BlinkHarness;

// Re-export so whatsapp-bridge and other consumers can still import from here
export const harnessStorage = storage;

export const sharedConfig = {
  resourceId: AGENT_ID,
  storage: harnessStorage,
  stateSchema,
  initialState: {
    yolo: agentConfig.getYoloMode(), // off by default unless configured
  },
  memory: getDynamicMemory(harnessStorage) as any, // Dynamic factory — Harness resolves at runtime
  workspace: getDynamicWorkspace,
  toolCategoryResolver: getToolCategory,
  modes: [
    { id: 'build' as const, name: 'Build', default: true as const, agent: blinkAgent, defaultModelId: DEFAULT_MODEL },
    { id: 'plan' as const, name: 'Plan', agent: blinkAgent, defaultModelId: DEFAULT_MODEL },
    { id: 'fast' as const, name: 'Fast', agent: blinkAgent, defaultModelId: DEFAULT_MODEL },
  ],
  tools: async ({ requestContext }: { requestContext: any }) => {
    // Ensure Composio meta-tools are available in Harness-level toolset.
    // Without this, the model may call composio_* by name but they won't execute.
    const composioTools = await getToolRouterTools();
    // Load MCP tools, but filter out any that duplicate Composio integrations.
    const rawMcpTools = await getMcpToolsets();
    const uniqueMcpTools = filterComposioDuplicates(rawMcpTools);
    const workspace = getDynamicWorkspace({ requestContext });
    const wsTools = workspace ? createWorkspaceTools(workspace) : {};
    const mergedTools = {
      ...composioTools,
      ...uniqueMcpTools,
      ...wsTools,
      view_image: viewImageTool,
      scheduled_tasks: scheduledTasksTool,
      research_search: researchSearchTool,
      search_vault: searchVaultTool,
      thread_artifact_put: threadArtifactPutTool,
      thread_artifact_list: threadArtifactListTool,
      thread_artifact_get: threadArtifactGetTool,
      check_subagent_spawn_gate: checkSubagentSpawnGateTool,
      load_skill_snippet: loadSkillSnippetTool,
    };
    const withSubagent = {
      ...mergedTools,
      /** Overrides Mastra harnessBuiltIn.subagent so spawn runs inside `runWithSpawnCapabilityContext`. */
      subagent: createBlinkSubagentTool({
        subagents,
        resolveModel,
        harnessTools: mergedTools,
        fallbackModelId: DEFAULT_MODEL,
      }),
    };

    if (!isDynamicCapabilitiesEnabled()) return withSubagent;
    const capCtx = getCapabilityContext();
    if (!capCtx) return withSubagent;
    const decision = resolveCapabilities(capCtx);
    return filterToolsByDecision(withSubagent, decision);
  },
  subagents,
  resolveModel,
};

/** Create a channel-specific harness (same resourceId, isolated session state) */
export function createChannelHarness(channelId: string) {
  return new Harness({ id: `harness-${channelId}`, ...sharedConfig });
}

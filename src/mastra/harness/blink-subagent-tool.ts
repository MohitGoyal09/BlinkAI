/**
 * Blink override of Mastra's built-in `subagent` tool: runs subagent.stream inside
 * `runWithSpawnCapabilityContext` so capability resolution sees `subagentId` + `spawnTask`.
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { HarnessSubagent } from '@mastra/core/harness';
import type { MastraLanguageModel } from '@mastra/core/agent';
import { z } from 'zod';
import { runWithSpawnCapabilityContext, getCapabilityContext } from '../capabilities/resolver';
import { buildTemporalContextBlock } from '../agents/subagents/temporal-context';
import { getDynamicWorkspace } from '../agents/coworker/workspace';
import { createWorkspaceTools } from '@mastra/core/workspace';

function buildSubagentMeta(
  modelId: string,
  durationMs: number,
  toolCalls: { name: string; toolCallId: string; isError?: boolean }[],
): string {
  const tools = toolCalls.map((tc) => `${tc.name}:${tc.isError ? 'err' : 'ok'}`).join(',');
  return `
<subagent-meta modelId="${modelId}" durationMs="${durationMs}" tools="${tools}" />`;
}

export function createBlinkSubagentTool(opts: {
  subagents: HarnessSubagent[];
  resolveModel: (modelId: string) => MastraLanguageModel;
  harnessTools: Record<string, unknown> | undefined;
  fallbackModelId: string | undefined;
}) {
  const { subagents, resolveModel, harnessTools, fallbackModelId } = opts;
  const subagentIds = subagents.map((s) => s.id);
  const agentTypeEnum = z.enum(subagentIds as [string, ...string[]]);
  const typeDescriptions = subagents.map((s) => `- **${s.id}** (${s.name}): ${s.description}`).join('\n');

  return createTool({
    id: 'subagent',
    description: `Delegate a focused task to a specialized subagent. The subagent runs independently with a constrained toolset, then returns its findings as text.

Available agent types:
${typeDescriptions}

The subagent runs in its own context — it does NOT see the parent conversation history. Write a clear, self-contained task description.

Use this tool when:
- You want to run multiple investigations in parallel
- The task is self-contained and can be delegated`,
    inputSchema: z.object({
      agentType: agentTypeEnum.describe('Type of subagent to spawn'),
      task: z
        .string()
        .describe(
          'Clear, self-contained description of what the subagent should do. Include all relevant context — the subagent cannot see the parent conversation.',
        ),
      modelId: z.string().optional().describe('Optional model ID override for this task.'),
    }),
    execute: async ({ agentType, task, modelId }, context) => {
      return runWithSpawnCapabilityContext({ subagentId: agentType, task }, async () => {
        const definition = subagents.find((s) => s.id === agentType);
        if (!definition) {
          return {
            content: `Unknown agent type: ${agentType}. Valid types: ${subagentIds.join(', ')}`,
            isError: true,
          };
        }
        const harnessCtx = context?.requestContext?.get('harness') as
          | {
              emitEvent?: (e: unknown) => void;
              abortSignal?: AbortSignal;
              getSubagentModelId?: (p: { agentType: string }) => string | undefined;
            }
          | undefined;
        const emitEvent = harnessCtx?.emitEvent;
        const abortSignal = harnessCtx?.abortSignal;
        const toolCallId = context?.agent?.toolCallId ?? 'unknown';
        const mergedTools = { ...definition.tools };
        
        const ws = getDynamicWorkspace({ requestContext: context?.requestContext as any });
        const wsTools = ws ? createWorkspaceTools(ws) : {};
        const fullHarnessTools = { ...(harnessTools || {}), ...wsTools };
        
        if (definition.allowedHarnessTools) {
          for (const toolId of definition.allowedHarnessTools) {
            if (fullHarnessTools[toolId] && !mergedTools[toolId]) {
              mergedTools[toolId] = fullHarnessTools[toolId] as never;
            }
          }
        }
        const harnessModelId = harnessCtx?.getSubagentModelId?.({ agentType }) ?? undefined;
        const resolvedModelId = modelId ?? harnessModelId ?? definition.defaultModelId ?? fallbackModelId;
        if (!resolvedModelId) {
          return { content: 'No model ID available for subagent. Configure defaultModelId.', isError: true };
        }
        let model: MastraLanguageModel;
        try {
          model = resolveModel(resolvedModelId);
        } catch (err) {
          return {
            content: `Failed to resolve model "${resolvedModelId}": ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
        const subagent = new Agent({
          id: `subagent-${definition.id}`,
          name: `${definition.name} Subagent`,
          instructions: `${definition.instructions}\n\n${buildTemporalContextBlock()}`,
          model,
          tools: mergedTools,
        });
        const startTime = Date.now();
        emitEvent?.({
          type: 'subagent_start',
          toolCallId,
          agentType,
          task,
          modelId: resolvedModelId,
        });
        let partialText = '';
        const toolCallLog: { name: string; toolCallId: string; isError?: boolean }[] = [];
        try {
          const response = await subagent.stream(task, {
            maxSteps: (definition as { maxSteps?: number }).maxSteps ?? 50,
            abortSignal,
            requireToolApproval: false,
            requestContext: context?.requestContext,
          });
          for await (const chunk of response.fullStream) {
            switch (chunk.type) {
              case 'text-delta':
                partialText += chunk.payload.text;
                emitEvent?.({
                  type: 'subagent_text_delta',
                  toolCallId,
                  agentType,
                  textDelta: chunk.payload.text,
                });
                break;
              case 'tool-call':
                toolCallLog.push({ name: chunk.payload.toolName, toolCallId: chunk.payload.toolCallId });
                emitEvent?.({
                  type: 'subagent_tool_start',
                  toolCallId,
                  agentType,
                  subToolName: chunk.payload.toolName,
                  subToolArgs: chunk.payload.args,
                });
                break;
              case 'tool-result': {
                const isErr = chunk.payload.isError ?? false;
                for (let i = toolCallLog.length - 1; i >= 0; i--) {
                  if (toolCallLog[i]!.toolCallId === chunk.payload.toolCallId && toolCallLog[i]!.isError === undefined) {
                    toolCallLog[i]!.isError = isErr;
                    break;
                  }
                }
                emitEvent?.({
                  type: 'subagent_tool_end',
                  toolCallId,
                  agentType,
                  subToolName: chunk.payload.toolName,
                  subToolResult: chunk.payload.result,
                  isError: isErr,
                });
                break;
              }
            }
          }
          if (abortSignal?.aborted) {
            const durationMs2 = Date.now() - startTime;
            const abortResult = partialText
              ? `[Aborted by user]

Partial output:
${partialText}`
              : '[Aborted by user]';
            emitEvent?.({ type: 'subagent_end', toolCallId, agentType, result: abortResult, isError: false, durationMs: durationMs2 });
            const meta2 = buildSubagentMeta(resolvedModelId, durationMs2, toolCallLog);
            return { content: abortResult + meta2, isError: false };
          }
          const fullOutput = await response.getFullOutput();
          const resultText = fullOutput.text || partialText;
          const durationMs = Date.now() - startTime;
          emitEvent?.({ type: 'subagent_end', toolCallId, agentType, result: resultText, isError: false, durationMs });
          const meta = buildSubagentMeta(resolvedModelId, durationMs, toolCallLog);
          return { content: resultText + meta, isError: false };
        } catch (err) {
          const isAbort =
            err instanceof Error &&
            (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('cancel'));
          const durationMs = Date.now() - startTime;
          if (isAbort) {
            const abortResult = partialText
              ? `[Aborted by user]

Partial output:
${partialText}`
              : '[Aborted by user]';
            emitEvent?.({ type: 'subagent_end', toolCallId, agentType, result: abortResult, isError: false, durationMs });
            const meta2 = buildSubagentMeta(resolvedModelId, durationMs, toolCallLog);
            return { content: abortResult + meta2, isError: false };
          }
          const message = err instanceof Error ? err.message : String(err);
          emitEvent?.({ type: 'subagent_end', toolCallId, agentType, result: message, isError: true, durationMs });
          const meta = buildSubagentMeta(resolvedModelId, durationMs, toolCallLog);
          return { content: `Subagent "${definition.name}" failed: ${message}` + meta, isError: true };
        }
      });
    },
  });
}

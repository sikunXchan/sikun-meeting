import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { getPersonaById } from '../personas';
import { loadQuery, resolveClaudeBinaryPath } from '../agent/claudeAgent';
import { AgentClient, AgentRequest, AgentResponse } from './types';
import { approvedTools, methodFor } from '../capabilities';

function toolSummary(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const values = input as Record<string, unknown>;
    const target = values.file_path ?? values.path ?? values.pattern;
    if (typeof target === 'string') return `${name}: ${target.slice(0, 240)}`;
  }
  return `${name} を使用`;
}

export class SdkAgentClient implements AgentClient {
  async run(request: AgentRequest): Promise<AgentResponse> {
    const persona = getPersonaById(request.personaId);
    if (!persona) throw new Error(`Unknown personaId: ${request.personaId}`);
    const query = await loadQuery();
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.abortSignal.addEventListener('abort', onAbort, { once: true });
    if (request.abortSignal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), 12 * 60 * 1000);
    const models = new Set<string>();
    let effectiveModel: string | undefined;
    let result: AgentResponse | null = null;
    try {
      const tools = approvedTools(request.personaId,
        request.tools === 'read' ? 'read' : request.phase === 'review' ? 'review' : 'work');
      const conversation = query({
        prompt: request.prompt,
        options: {
          systemPrompt: `あなたは ${persona.name}（${persona.roleTitle}）です。専門は ${persona.expertise}。\n部門別の確認手順: ${methodFor(persona.id)}\n発注者が確定した企画と仕事の担当範囲に従ってください。実行した内容と残る問題を正確に報告してください。`,
          cwd: request.workingDirectory,
          model: request.model,
          fallbackModel: request.fallbackModel,
          tools,
          allowedTools: tools,
          permissionMode: 'dontAsk',
          settingSources: [],
          skills: [],
          maxTurns: request.maxTurns,
          abortController: controller,
          pathToClaudeCodeExecutable: resolveClaudeBinaryPath(),
        },
      });
      for await (const message of conversation as AsyncGenerator<SDKMessage, void>) {
        if (message.type === 'assistant') {
          if (message.message.model) {
            models.add(message.message.model);
            if (message.message.model !== '<synthetic>') effectiveModel = message.message.model;
          }
          for (const block of message.message.content) {
            const tool = block as unknown as { type?: string; name?: string; input?: unknown };
            if (tool.type === 'tool_use' && tool.name) {
              await request.onTool?.(toolSummary(tool.name, tool.input));
            }
          }
        }
        if (message.type === 'result') {
          for (const model of Object.keys(message.modelUsage ?? {})) models.add(model);
          const tokens = Object.values(message.modelUsage ?? {}).reduce((sum, usage) => sum
            + (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
            + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0), 0);
          if (message.subtype !== 'success' || message.is_error) {
            throw Object.assign(new Error(message.subtype === 'success' ? message.result : `AI実行が ${message.subtype} で停止しました`), {
              observedModels: [...models],
              effectiveModel,
              estimatedCostUsd: message.total_cost_usd,
              numTurns: message.num_turns,
              tokens,
            });
          }
          result = {
            text: message.result,
            observedModels: [...models],
            effectiveModel,
            estimatedCostUsd: message.total_cost_usd,
            numTurns: message.num_turns,
            tokens,
          };
        }
      }
      if (!result) throw new Error('AI実行結果がありません');
      return result;
    } finally {
      clearTimeout(timer);
      request.abortSignal.removeEventListener('abort', onAbort);
    }
  }
}

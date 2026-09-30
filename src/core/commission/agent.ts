import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { getPersonaById } from '../personas';
import { loadQuery, resolveClaudeBinaryPath } from '../agent/claudeAgent';
import { AgentClient, AgentRequest, AgentResponse } from './types';
import { approvedTools, methodFor, preapprovedTools, verificationToolsFor } from '../capabilities';
import { createVerificationServer, VERIFICATION_SERVER } from './verificationTools';
import { redactSecrets } from './redact';
import { skillPromptFor } from '../skills/catalog';

function toolSummary(name: string, input: unknown): string {
  if (input && typeof input === 'object') {
    const values = input as Record<string, unknown>;
    // 確認役が報告と照合できるよう、コマンド・URL・検索語も記録する。
    const target = values.file_path ?? values.path ?? values.pattern ?? values.command ?? values.url ?? values.query ?? values.file;
    if (typeof target === 'string') return `${name}: ${redactSecrets(target).slice(0, 240)}`;
    if (Array.isArray(values.items)) return `${name}: ${values.items.map((item) => (item as { name?: unknown }).name).filter((value) => typeof value === 'string').join(', ').slice(0, 240)}`;
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
    let toolCalls = 0;
    try {
      const tools = approvedTools(request.personaId,
        request.tools === 'read' ? 'read' : request.phase === 'review' ? 'review' : 'work');
      const verification = verificationToolsFor(request.phase);
      const mcpServers = verification.length ? {
        [VERIFICATION_SERVER]: await createVerificationServer({ workingDirectory: request.workingDirectory, readableDirectories: request.readableDirectories }),
      } : undefined;
      const toolGuide = verification.length
        ? '\n検証ツール: calculate（厳密な計算）と read_table（csv/tsv/xlsxの読み取りと列合計）を使える。報告に書く金額・合計・率・件数は暗算せずツールで求め、報告の数値をツールの結果と照合する。ツールで確かめていない数値は未検算と明記する。'
        : '';
      const conversation = query({
        prompt: request.prompt,
        options: {
          systemPrompt: `あなたは ${persona.name}（${persona.roleTitle}）です。専門は ${persona.expertise}。\n部門別の確認手順: ${methodFor(persona.id)}${skillPromptFor(persona.id, request.phase)}\n選択した進め方に従って採用された企画と仕事の担当範囲に従ってください。実行した内容と残る問題を正確に報告してください。${toolGuide}`,
          cwd: request.workingDirectory,
          model: request.model,
          fallbackModel: request.fallbackModel,
          tools,
          allowedTools: [...preapprovedTools(tools), ...verification],
          mcpServers,
          additionalDirectories: request.readableDirectories?.length ? [...request.readableDirectories] : undefined,
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
              toolCalls++;
              await request.onTool?.(toolSummary(tool.name, tool.input));
            }
          }
        }
        if (message.type === 'result') {
          for (const model of Object.keys(message.modelUsage ?? {})) models.add(model);
          const usage = Object.values(message.modelUsage ?? {});
          const inputTokens = usage.reduce((sum, item) => sum + (item.inputTokens ?? 0)
            + (item.cacheReadInputTokens ?? 0) + (item.cacheCreationInputTokens ?? 0), 0);
          const cachedInputTokens = usage.reduce((sum, item) => sum + (item.cacheReadInputTokens ?? 0), 0);
          const outputTokens = usage.reduce((sum, item) => sum + (item.outputTokens ?? 0), 0);
          const tokens = inputTokens + outputTokens;
          if (message.subtype !== 'success' || message.is_error) {
            throw Object.assign(new Error(message.subtype === 'success' ? message.result : `AI実行が ${message.subtype} で停止しました`), {
              observedModels: [...models],
              effectiveModel,
              estimatedCostUsd: message.total_cost_usd,
              numTurns: message.num_turns,
              tokens,
              inputTokens,
              cachedInputTokens,
              outputTokens,
              toolCalls,
            });
          }
          result = {
            text: message.result,
            observedModels: [...models],
            effectiveModel,
            estimatedCostUsd: message.total_cost_usd,
            numTurns: message.num_turns,
            tokens,
            inputTokens,
            cachedInputTokens,
            outputTokens,
            toolCalls,
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

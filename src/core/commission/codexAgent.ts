import * as fs from 'fs';
import * as path from 'path';
import type { ThreadEvent, ThreadOptions } from '@openai/codex-sdk';
import { getPersonaById } from '../personas';
import { AgentClient, AgentRequest, AgentResponse } from './types';
import { codexPolicy, methodFor } from '../capabilities';
import { skillPromptFor } from '../skills/catalog';

type CodexModule = typeof import('@openai/codex-sdk');

export function codexPhase(request: Pick<AgentRequest, 'tools' | 'phase'>): 'read' | 'review' | 'work' {
  return request.tools === 'read' ? 'read' : request.phase === 'review' ? 'review' : 'work';
}

export function codexThreadOptions(request: Pick<AgentRequest, 'personaId' | 'tools' | 'phase' | 'model' | 'workingDirectory'>): ThreadOptions {
  const policy = codexPolicy(request.personaId, codexPhase(request));
  return {
    model: request.model,
    modelReasoningEffort: request.phase === 'consultation' || request.phase === 'delivery' ? 'low' : undefined,
    workingDirectory: request.workingDirectory,
    sandboxMode: policy.sandboxMode,
    approvalPolicy: 'never',
    skipGitRepoCheck: true,
    networkAccessEnabled: policy.networkAccessEnabled,
    webSearchEnabled: false,
  };
}
const importCodex = new Function('return import("@openai/codex-sdk")') as () => Promise<CodexModule>;

function packagedCodexPath(): string | undefined {
  const candidate = path.join(process.resourcesPath || '', 'codex-runtime', 'bin', 'codex.exe');
  return fs.existsSync(candidate) ? candidate : undefined;
}

export class CodexAgentClient implements AgentClient {
  async run(request: AgentRequest): Promise<AgentResponse> {
    const persona = getPersonaById(request.personaId);
    if (!persona) throw new Error(`Unknown personaId: ${request.personaId}`);
    const { Codex } = await importCodex();
    const codexPathOverride = packagedCodexPath();
    const codex = new Codex(codexPathOverride ? { codexPathOverride } : undefined);
    const controller = new AbortController();
    let rejectCancellation: (error: Error) => void = () => undefined;
    const cancelled = new Promise<never>((_, reject) => { rejectCancellation = reject; });
    const onAbort = () => {
      controller.abort();
      rejectCancellation(new Error('Codex実行が中断されました'));
    };
    request.abortSignal.addEventListener('abort', onAbort, { once: true });
    if (request.abortSignal.aborted) onAbort();
    const limitMs = request.phase === 'delivery' ? 60 * 1000 : 12 * 60 * 1000;
    const timer = setTimeout(() => {
      controller.abort();
      rejectCancellation(new Error(`Codexの${request.phase}実行が${limitMs / 1000}秒で時間切れになりました`));
    }, limitMs);
    let text = '';
    let completed = false;
    let tokens = 0;
    try {
      const thread = codex.startThread(codexThreadOptions(request));
      const restricted = codexPhase(request) === 'work' && !codexPolicy(request.personaId, 'work').canRunCode
        ? 'あなたの部門はコード実行部門ではありません。コマンドはファイルの閲覧と成果の確認に限り、ネットワークは使えません。\n'
        : '';
      const phaseInstruction = request.phase === 'planning'
        ? 'この段階は仕事の割当だけを行います。与えられた企画と担当一覧からJSONを返し、ファイル閲覧やコマンド実行はしないでください。'
        : request.phase === 'delivery'
          ? '保存済みの仕事と内部確認記録だけから納品文を作ってください。ファイル閲覧やコマンド実行はしないでください。'
          : request.phase === 'consultation'
            ? 'この段階は企画相談です。まず発注者の意図から短い企画案を返してください。既存機能について事実確認が必要なときだけ関連する文書やコードを最大3ファイル読み、広範囲の探索や試行錯誤のコマンド実行は避けてください。未確認のことは断定せず、質問は最大2件に絞ってください。実装・テストは企画確定後に行います。'
            : '必要なファイルだけを読み、.venv、node_modulesなどの依存ディレクトリは探索しないでください。';
      const prompt = `あなたは ${persona.name}（${persona.roleTitle}）です。専門は ${persona.expertise}。\n部門別の確認手順: ${methodFor(persona.id)}${skillPromptFor(persona.id, request.phase)}\n発注者が確定した企画と仕事の担当範囲に従ってください。実行した内容と残る問題を正確に報告してください。\n${request.tools === 'read' ? 'この段階ではファイルを変更しないでください。' : '実際に必要な作業を行ってください。'}\n${restricted}${phaseInstruction}\n\n${request.prompt}`;
      const execute = async (): Promise<void> => {
        const turn = await thread.runStreamed(prompt, { signal: controller.signal });
        for await (const event of turn.events as AsyncGenerator<ThreadEvent>) {
          if (event.type === 'item.completed') {
            const item = event.item;
            if (item.type === 'agent_message') text = item.text;
            if (item.type === 'command_execution') await request.onTool?.(`コマンド実行: ${item.status}`);
            if (item.type === 'file_change') {
              const paths = item.changes.map((change) => change.path).join(', ');
              await request.onTool?.(`ファイル変更: ${paths.slice(0, 240)}`);
            }
          }
          if (event.type === 'turn.completed') {
            completed = true;
            tokens += (event.usage?.input_tokens ?? 0) + (event.usage?.output_tokens ?? 0);
          }
          if (event.type === 'turn.failed') throw new Error(event.error.message);
          if (event.type === 'error') throw new Error(event.message);
        }
      };
      await Promise.race([execute(), cancelled]);
      if (controller.signal.aborted) throw new Error('Codex実行が中断されました');
      if (!completed || !text.trim()) throw new Error('Codexの実行結果を取得できませんでした');
      return {
        text,
        observedModels: [],
        effectiveModel: undefined,
        estimatedCostUsd: 0,
        numTurns: 1,
        tokens,
      };
    } finally {
      clearTimeout(timer);
      request.abortSignal.removeEventListener('abort', onAbort);
    }
  }
}

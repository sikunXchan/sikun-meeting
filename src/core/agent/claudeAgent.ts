import type { query as QueryFn, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Persona } from '../types';

export interface AgentTurnResult {
  text: string;
  isError: boolean;
  sessionId?: string;
}

/**
 * @anthropic-ai/claude-agent-sdk はESM専用パッケージ（package.jsonの"type":"module"）のため、
 * CommonJSでビルドしているElectronメインプロセスからは通常の `import`/`require` では読み込めない
 * （TypeScriptがCommonJS向けに動的importをrequire()へダウンレベルしてしまい ERR_REQUIRE_ESM になる）。
 * `new Function` 経由の動的importはTypeScriptのダウンレベル変換の対象外になるため、これで回避する。
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<{ query: typeof QueryFn }>;

let queryFnPromise: Promise<typeof QueryFn> | null = null;
function loadQuery(): Promise<typeof QueryFn> {
  if (!queryFnPromise) {
    queryFnPromise = dynamicImport('@anthropic-ai/claude-agent-sdk').then((mod) => mod.query);
  }
  return queryFnPromise;
}

/**
 * Claude Agent SDK（Claude Codeのエンジン）を1ターン分だけ呼び出す。
 * 会議参加者AIは「発言するたびに、その時点までの議論全文をプロンプトに含めて」
 * 毎回ステートレスに呼ぶ設計にしている（アプリ再起動後もsession idに依存せず
 * 議事録=DBだけで会話を完全に再現できるようにするため）。
 *
 * 読み取り専用ツール（Read/Grep/Glob）のみ許可し、対象プロジェクトのコードを
 * 踏まえた発言はできるが、ファイルの変更やコマンド実行はできないようにする。
 */
export async function runAgentTurn(
  persona: Persona,
  prompt: string,
  workingDirectory: string | null,
): Promise<AgentTurnResult> {
  const query = await loadQuery();
  const q = query({
    prompt,
    options: {
      systemPrompt: persona.systemPrompt,
      permissionMode: 'default',
      allowedTools: ['Read', 'Grep', 'Glob'],
      cwd: workingDirectory ?? process.cwd(),
    },
  });

  let finalText = '';
  let isError = false;
  let sessionId: string | undefined;

  for await (const message of q as AsyncGenerator<SDKMessage, void>) {
    if (message.type === 'result') {
      sessionId = message.session_id;
      if (message.subtype === 'success') {
        finalText = message.result;
        isError = message.is_error;
      } else {
        isError = true;
        finalText = `[エラー: ${message.subtype}] AIからの応答を取得できませんでした。`;
      }
    }
  }

  if (!finalText) {
    isError = true;
    finalText = 'AIからの応答が空でした。';
  }

  return { text: finalText, isError, sessionId };
}

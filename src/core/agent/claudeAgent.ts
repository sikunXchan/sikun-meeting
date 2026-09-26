import type { query as QueryFn, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Persona } from '../types';
import { approvedTools, capabilityFor, methodFor } from '../capabilities';
import { skillPromptFor } from '../skills/catalog';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

/**
 * SDKは同梱のネイティブCLIバイナリ(claude / claude.exe)の場所を自前で解決するが、
 * Electron+asarでパッケージした状態だとその解決結果が `resources/app.asar/...` という
 * 「asar内の仮想パス」のままになることがある。fs.existsSync等のNode fs API経由の読み取りは
 * Electronがasar内も透過的に扱うため「存在する」判定は通るが、child_process.spawnによる
 * 実行はOSのCreateProcess相当を直接呼ぶためasarの透過処理が効かず、"exists but failed to
 * launch" のようなエラーになる。electron-builderのasarUnpack設定で実体は
 * `app.asar.unpacked/...` に展開されているので、そちらの実パスを明示的に渡す。
 */
function toUnpackedPath(p: string): string {
  return p.split(`${path.sep}app.asar${path.sep}`).join(`${path.sep}app.asar.unpacked${path.sep}`);
}

export function resolveClaudeBinaryPath(): string | undefined {
  try {
    if (app.isPackaged) {
      const bundled = path.join(process.resourcesPath, process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (fs.existsSync(bundled)) return bundled;
    }
    // package.json自体はexportsマップで公開されていない(ERR_PACKAGE_PATH_NOT_EXPORTED)ため、
    // メインエントリ(sdk.mjs、パッケージ直下に存在)を解決してそのディレクトリを使う。
    const sdkMainPath = require.resolve('@anthropic-ai/claude-agent-sdk');
    const sdkDir = path.dirname(sdkMainPath); // .../node_modules/@anthropic-ai/claude-agent-sdk
    const scopeDir = path.dirname(sdkDir); // .../node_modules/@anthropic-ai
    const platformPkgName = `claude-agent-sdk-${process.platform}-${process.arch}`;
    const binName = process.platform === 'win32' ? 'claude.exe' : 'claude';

    // npmのhoisting次第で、プラットフォーム別バイナリパッケージは
    // claude-agent-sdk の node_modules 配下にネストされることも、@anthropic-ai 直下に
    // 引き上げられることもあるため、両方の配置パターンを候補として試す。
    const candidates = [
      path.join(sdkDir, 'node_modules', '@anthropic-ai', platformPkgName, binName),
      path.join(scopeDir, platformPkgName, binName),
    ];

    for (const candidate of candidates) {
      const resolved = app.isPackaged ? toUnpackedPath(candidate) : candidate;
      if (fs.existsSync(resolved)) return resolved;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export interface AgentTurnResult {
  text: string;
  isError: boolean;
  sessionId?: string;
  requestedModel?: string;
  effectiveModel?: string;
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
export function loadQuery(): Promise<typeof QueryFn> {
  if (!queryFnPromise) {
    queryFnPromise = dynamicImport('@anthropic-ai/claude-agent-sdk').then((mod) => mod.query);
  }
  return queryFnPromise;
}

/**
 * 1ターンにかけてよい最大待ち時間。
 * SDK呼び出しにタイムアウトがないと、CLIサブプロセスが応答を返さなくなった場合に
 * for-awaitが永久に終わらず、会議全体が「考え中」のまま無限に固まってしまう
 * （UI側のisBusyも解除されない）。必ず有限時間で打ち切れるようにする。
 */
const TURN_TIMEOUT_MS = 3 * 60 * 1000;

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
  const capability = capabilityFor(persona.id);
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), TURN_TIMEOUT_MS);

  const q = query({
    prompt,
    options: {
      systemPrompt: `${persona.systemPrompt}\n\n部門別の確認手順: ${methodFor(persona.id)}${skillPromptFor(persona.id, 'meeting')}`,
      model: capability.model,
      tools: approvedTools(persona.id, 'meeting'),
      permissionMode: 'dontAsk',
      allowedTools: approvedTools(persona.id, 'meeting'),
      settingSources: [],
      skills: [],
      cwd: workingDirectory ?? process.cwd(),
      abortController,
      pathToClaudeCodeExecutable: resolveClaudeBinaryPath(),
    },
  });

  let finalText = '';
  let isError = false;
  let sessionId: string | undefined;
  let effectiveModel: string | undefined;

  try {
    for await (const message of q as AsyncGenerator<SDKMessage, void>) {
      if (message.type === 'assistant' && message.message.model && message.message.model !== '<synthetic>') {
        effectiveModel = message.message.model;
      }
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
  } catch (err) {
    isError = true;
    finalText = abortController.signal.aborted
      ? `[タイムアウト] ${Math.round(TURN_TIMEOUT_MS / 1000)}秒以内に応答がありませんでした。ネットワークやCLIの状態を確認し、必要であれば再度発言を求めてください。`
      : `[エラー] AI呼び出し中に例外が発生しました: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    clearTimeout(timer);
  }

  if (!finalText) {
    isError = true;
    finalText = 'AIからの応答が空でした。';
  }

  return { text: finalText, isError, sessionId, requestedModel: capability.model, effectiveModel };
}

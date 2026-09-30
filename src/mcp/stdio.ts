/**
 * アプリ同梱の検証ツールを公開する stdio MCP サーバー。
 * Claude Code と Codex がこのスクリプトを子プロセスとして起動し、1行1メッセージの JSON-RPC で通信する。
 * 標準出力はプロトコル専用なので、ログは出さない。
 *
 * 起動: node dist/mcp/stdio.js --tools calculate,read_table,record_criterion（--groups calc,data でグループ単位も可）
 * 環境変数: SIKUN_WORKDIR（作業フォルダ）, SIKUN_READABLE_DIRS（読み取り可能な追加フォルダのJSON配列）,
 *          SIKUN_REVIEW_FILE（確認記録の保存先。確認段階だけ）, SIKUN_SOURCES_FILE（出典の記録先。調査部門だけ）
 */
import * as readline from 'readline';
import { SERVER_NAME, TOOL_GROUPS, ToolContext, ToolDefinition, ToolGroup } from '../core/tools/catalog';

/** アプリのデータ領域の記録だけを書くツール（作業フォルダは変更しない）。 */
const WRITES_APP_RECORD = new Set(['record_criterion', 'record_source']);
const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST_VERSION = '2025-06-18';

interface JsonRpcMessage { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: Record<string, unknown> }

/** カンマ区切りのツール名またはグループ名から、公開するツールを決める。 */
export function selectedTools(namesArg: string | undefined): ToolDefinition[] {
  const all = Object.values(TOOL_GROUPS).flat();
  const selected = new Set<ToolDefinition>();
  for (const name of (namesArg ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)) {
    const group = Object.prototype.hasOwnProperty.call(TOOL_GROUPS, name) ? TOOL_GROUPS[name as ToolGroup] : undefined;
    const tool = all.find((entry) => entry.name === name);
    if (!group && !tool) throw new Error(`不明なツール: ${name}`);
    for (const entry of group ?? [tool!]) selected.add(entry);
  }
  return [...selected];
}

export function contextFromEnv(env: NodeJS.ProcessEnv): ToolContext {
  const workingDirectory = env.SIKUN_WORKDIR;
  if (!workingDirectory) throw new Error('SIKUN_WORKDIR がありません');
  let readableDirectories: string[] = [];
  if (env.SIKUN_READABLE_DIRS) {
    const parsed: unknown = JSON.parse(env.SIKUN_READABLE_DIRS);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) throw new Error('SIKUN_READABLE_DIRS はパスのJSON配列にしてください');
    readableDirectories = parsed;
  }
  return { workingDirectory, readableDirectories, reviewFile: env.SIKUN_REVIEW_FILE || undefined, sourcesFile: env.SIKUN_SOURCES_FILE || undefined };
}

/** 1件のメッセージを処理して応答を返す。通知（idなし）には応答しない。 */
export async function handleMessage(message: JsonRpcMessage, tools: ToolDefinition[], context: ToolContext): Promise<Record<string, unknown> | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
  const error = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
  if (message.id === undefined) return undefined; // notifications/initialized など
  switch (message.method) {
    case 'initialize': {
      const requested = String(message.params?.protocolVersion ?? '');
      return reply({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: '1.0.0' },
        instructions: '答えが一つに決まる検証（計算・表の集計と照合・確認の記録）を行うツール。報告に書く数値は暗算せずこれらで求める。',
      });
    }
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({
        tools: tools.map((tool) => ({
          name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
          annotations: WRITES_APP_RECORD.has(tool.name)
            ? { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
            : { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        })),
      });
    case 'tools/call': {
      const name = message.params?.name;
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) return error(-32602, `不明なツール: ${String(name)}`);
      const args = message.params?.arguments;
      try {
        const result = await tool.handler(args && typeof args === 'object' ? args as Record<string, unknown> : {}, context);
        // 画像などを返すツールは mcpContent に MCP の content ブロックをそのまま入れる。
        const blocks = result && typeof result === 'object' && Array.isArray((result as { mcpContent?: unknown }).mcpContent) ? (result as { mcpContent: unknown[] }).mcpContent : undefined;
        return reply({ content: blocks ?? [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (failure) {
        // ツールの失敗はAIが読んで直せるように結果として返す（プロトコルエラーにしない）。
        return reply({ content: [{ type: 'text', text: `エラー: ${failure instanceof Error ? failure.message : String(failure)}` }], isError: true });
      }
    }
    default:
      return error(-32601, `未対応のメソッド: ${String(message.method)}`);
  }
}

function main(): void {
  const flag = ['--tools', '--groups'].map((name) => process.argv.indexOf(name)).find((index) => index >= 0);
  const tools = selectedTools(flag !== undefined ? process.argv[flag + 1] : '');
  const context = contextFromEnv(process.env);
  const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let pending = Promise.resolve();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    // 応答の順序を保つため、1件ずつ順に処理する。
    pending = pending.then(async () => {
      let message: JsonRpcMessage;
      try { message = JSON.parse(line) as JsonRpcMessage; }
      catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSONとして読めません' } }); return; }
      const response = await handleMessage(message, tools, context);
      if (response) write(response);
    });
  });
  lines.on('close', () => { void pending.then(() => process.exit(0)); });
}

if (require.main === module) main();

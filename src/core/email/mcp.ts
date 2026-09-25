import { EmailMcpConfig } from './types';

type McpModule = typeof import('@modelcontextprotocol/client');
const loadMcp = new Function('return import("@modelcontextprotocol/client")') as () => Promise<McpModule>;

export interface EmailMcpClient {
  listTools(config: EmailMcpConfig): Promise<string[]>;
  send(config: EmailMcpConfig, args: Record<string, unknown>): Promise<string>;
}

function headers(config: EmailMcpConfig): Record<string, string> {
  if (!config.authorizationEnv) return {};
  const value = process.env[config.authorizationEnv];
  if (!value) throw new Error(`環境変数 ${config.authorizationEnv} にMCP認証トークンがありません`);
  return { Authorization: `Bearer ${value}` };
}

async function withConnection<T>(config: EmailMcpConfig, fn: (client: InstanceType<McpModule['Client']>) => Promise<T>): Promise<T> {
  const { Client, StreamableHTTPClientTransport } = await loadMcp();
  const client = new Client({ name: 'sikun-meeting-email', version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  const transport = new StreamableHTTPClientTransport(new URL(config.endpoint), { requestInit: { headers: headers(config) } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      (async () => { await client.connect(transport); return fn(client); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('MCPサーバーが30秒以内に応答しませんでした')), 30000); }),
    ]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

export class HttpEmailMcpClient implements EmailMcpClient {
  listTools(config: EmailMcpConfig): Promise<string[]> {
    return withConnection(config, async (client) => (await client.listTools()).tools.map((tool) => tool.name));
  }
  send(config: EmailMcpConfig, args: Record<string, unknown>): Promise<string> {
    return withConnection(config, async (client) => {
      const listed = (await client.listTools()).tools;
      if (!listed.some((tool) => tool.name === config.sendTool)) throw new Error('設定された送信ツールがMCPサーバーにありません');
      const result = await client.callTool({ name: config.sendTool, arguments: args });
      const output = (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n').slice(0, 4000);
      if (result.isError) throw new Error(output || 'MCPメール送信ツールがエラーを返しました');
      return output || 'MCPツールは成功を返しました';
    });
  }
}

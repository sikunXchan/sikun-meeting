import * as path from 'path';
import { SERVER_NAME, toolsFor } from './catalog';

export interface ToolLaunchContext { phase: string; personaId?: string; workingDirectory: string; readableDirectories?: string[]; reviewFile?: string; sourcesFile?: string }
export interface StdioLaunch { command: string; args: string[]; env: Record<string, string> }

/**
 * 同梱MCPサーバーの起動方法。Electron本体を ELECTRON_RUN_AS_NODE で Node として使うため、
 * 配布版でも別途 Node を必要としない。開発時・試験時は node がそのまま使われる。
 */
export function toolServerLaunch(context: ToolLaunchContext): StdioLaunch | undefined {
  const names = toolsFor(context.phase, context.personaId).map((tool) => tool.name);
  if (!names.length) return undefined;
  const env: Record<string, string> = {
    ELECTRON_RUN_AS_NODE: '1',
    SIKUN_WORKDIR: context.workingDirectory,
    SIKUN_READABLE_DIRS: JSON.stringify(context.readableDirectories ?? []),
  };
  if (names.includes('record_criterion') && context.reviewFile) env.SIKUN_REVIEW_FILE = context.reviewFile;
  if ((names.includes('record_source') || names.includes('list_sources')) && context.sourcesFile) env.SIKUN_SOURCES_FILE = context.sourcesFile;
  return { command: process.execPath, args: [path.join(__dirname, '..', '..', 'mcp', 'stdio.js'), '--tools', names.join(',')], env };
}

/** Claude Agent SDK の mcpServers 形式。 */
export function claudeToolServers(context: ToolLaunchContext) {
  const launch = toolServerLaunch(context);
  return launch ? { [SERVER_NAME]: { type: 'stdio' as const, ...launch } } : undefined;
}

/** Codex の設定（config.toml の mcp_servers）形式。 */
export function codexToolServers(context: ToolLaunchContext) {
  const launch = toolServerLaunch(context);
  return launch ? { [SERVER_NAME]: { command: launch.command, args: launch.args, env: launch.env } } : undefined;
}

import { randomUUID } from 'crypto';
import { Repository } from '../store/repository';
import { EmailStore } from './store';
import { EmailDraft, EmailMcpConfig } from './types';
import { EmailMcpClient, HttpEmailMcpClient } from './mcp';

const DEFAULT_ARGUMENTS = { to: '{{toArray}}', subject: '{{subject}}', body: '{{body}}' };

function required(value: string, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}を入力してください`);
  return value.trim();
}

function fillTemplate(value: unknown, draft: EmailDraft): unknown {
  if (typeof value === 'string') {
    if (value === '{{toArray}}') return draft.to;
    return value.replaceAll('{{to}}', draft.to.join(', ')).replaceAll('{{subject}}', draft.subject).replaceAll('{{body}}', draft.body);
  }
  if (Array.isArray(value)) return value.map((entry) => fillTemplate(entry, draft));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, fillTemplate(entry, draft)]));
  return value;
}

export class EmailService {
  private active = new Set<string>();
  constructor(private store: EmailStore, private repo: Repository, private mcp: EmailMcpClient = new HttpEmailMcpClient()) {}

  config(): EmailMcpConfig | null { return this.store.snapshot().config; }
  list(projectId: string): EmailDraft[] {
    if (!this.repo.getProject(projectId)) throw new Error('プロジェクトが見つかりません');
    return this.store.list(projectId);
  }

  async configure(input: Omit<EmailMcpConfig, 'updatedAt'>): Promise<EmailMcpConfig> {
    const endpoint = required(input.endpoint, 'MCPサーバーURL', 2048);
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
      throw new Error('MCP接続先はHTTPSまたはローカルHTTPにしてください');
    }
    const sendTool = required(input.sendTool, 'メール送信ツール名', 160);
    const authorizationEnv = input.authorizationEnv?.trim() || '';
    if (authorizationEnv && !/^[A-Z][A-Z0-9_]*$/.test(authorizationEnv)) throw new Error('認証用環境変数名が不正です');
    const argumentTemplate = input.argumentTemplate || DEFAULT_ARGUMENTS;
    if (!argumentTemplate || typeof argumentTemplate !== 'object' || Array.isArray(argumentTemplate)) throw new Error('引数テンプレートはJSONオブジェクトにしてください');
    const serialized = JSON.stringify(argumentTemplate);
    if (serialized.length > 8000 || !serialized.includes('{{to') || !serialized.includes('{{subject}}') || !serialized.includes('{{body}}')) {
      throw new Error('引数テンプレートに宛先・件名・本文を含めてください');
    }
    return this.store.saveConfig({ endpoint: url.href, sendTool, authorizationEnv, argumentTemplate, updatedAt: new Date().toISOString() });
  }

  async testConnection(): Promise<string[]> {
    const config = this.config();
    if (!config) throw new Error('メールMCPの接続設定がありません');
    return this.mcp.listTools(config);
  }

  async createDraft(input: { projectId: string; sourceMeetingId: string; to: string[]; subject: string; body: string }): Promise<EmailDraft> {
    const meeting = this.repo.getMeeting(input.sourceMeetingId);
    if (!meeting?.decision || meeting.projectId !== input.projectId) throw new Error('確定済みの会議を選択してください');
    const to = [...new Set(input.to.map((entry) => entry.trim()).filter(Boolean))];
    if (!to.length || to.length > 20 || to.some((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry))) throw new Error('宛先メールアドレスが不正です');
    const draft: EmailDraft = {
      id: randomUUID(), projectId: input.projectId, sourceMeetingId: meeting.id,
      to, subject: required(input.subject, '件名', 300), body: required(input.body, '本文', 20000),
      status: 'draft', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    return this.store.mutate((data) => { data.drafts.push(draft); return structuredClone(draft); });
  }

  async sendDraft(id: string): Promise<EmailDraft> {
    if (this.active.has(id)) throw new Error('メールは送信中です');
    const config = this.config();
    if (!config) throw new Error('メールMCPの接続設定がありません');
    const draft = this.store.get(id);
    if (draft.status !== 'draft') throw new Error('このメールは下書きではありません。結果不明のメールは送信先で確認してください');
    this.active.add(id);
    try {
      await this.store.mutate((data) => {
        const current = data.drafts.find((entry) => entry.id === id)!;
        if (current.status !== 'draft') throw new Error('すでに送信が始まっています');
        current.status = 'sending'; current.updatedAt = new Date().toISOString();
      });
      const args = fillTemplate(config.argumentTemplate, draft) as Record<string, unknown>;
      const result = await this.mcp.send(config, args);
      return this.store.mutate((data) => {
        const current = data.drafts.find((entry) => entry.id === id)!;
        current.status = 'sent'; current.sentAt = new Date().toISOString();
        current.updatedAt = current.sentAt; current.result = result;
        return structuredClone(current);
      });
    } catch (error) {
      await this.store.mutate((data) => {
        const current = data.drafts.find((entry) => entry.id === id);
        if (current?.status === 'sending') {
          current.status = 'unknown'; current.updatedAt = new Date().toISOString();
          current.result = error instanceof Error ? error.message : String(error);
        }
      });
      throw error;
    } finally { this.active.delete(id); }
  }
}

export interface EmailMcpConfig {
  endpoint: string;
  sendTool: string;
  authorizationEnv: string;
  /** MCPツールの引数テンプレート。{{to}}、{{toArray}}、{{subject}}、{{body}} を置換する。 */
  argumentTemplate: Record<string, unknown>;
  updatedAt: string;
}

export type EmailStatus = 'draft' | 'sending' | 'sent' | 'failed' | 'unknown';

export interface EmailDraft {
  id: string;
  projectId: string;
  sourceMeetingId: string;
  to: string[];
  subject: string;
  body: string;
  status: EmailStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  result?: string;
}

export interface EmailData {
  config: EmailMcpConfig | null;
  drafts: EmailDraft[];
}

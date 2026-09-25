import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { EmailData, EmailDraft, EmailMcpConfig } from './types';

export class EmailStore {
  private file: string;
  private data: EmailData;
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'email-actions.json');
    if (!fs.existsSync(this.file)) this.data = { config: null, drafts: [] };
    else {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as EmailData;
      if (!Array.isArray(parsed.drafts)) throw new Error('メール操作記録の形式が不正です');
      this.data = { config: parsed.config || null, drafts: parsed.drafts };
      for (const draft of this.data.drafts) {
        if (draft.status === 'sending') draft.status = 'unknown';
      }
    }
  }

  snapshot(): EmailData { return structuredClone(this.data); }
  get(id: string): EmailDraft {
    const draft = this.data.drafts.find((entry) => entry.id === id);
    if (!draft) throw new Error('メール下書きが見つかりません');
    return structuredClone(draft);
  }
  list(projectId: string): EmailDraft[] {
    return this.data.drafts.filter((entry) => entry.projectId === projectId).map((entry) => structuredClone(entry)).reverse();
  }
  async mutate<T>(fn: (data: EmailData) => T): Promise<T> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      const result = fn(next);
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      if (fs.existsSync(this.file)) await fs.promises.copyFile(this.file, this.file + '.bak');
      await fs.promises.rename(temporary, this.file);
      this.data = next;
      return result;
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
  saveConfig(config: EmailMcpConfig): Promise<EmailMcpConfig> {
    return this.mutate((data) => { data.config = config; return structuredClone(config); });
  }
}

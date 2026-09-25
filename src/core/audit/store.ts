import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AuditRecord } from './types';

/** 通常会議のDBとは別ファイルに保管する、追記専用の監査履歴。 */
export class AuditStore {
  private readonly file: string;
  private records: AuditRecord[];
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'independent-audits.json');
    this.records = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : [];
    if (!Array.isArray(this.records)) throw new Error('監査履歴の形式が不正です');
  }

  list(projectId: string): AuditRecord[] {
    return this.records.filter((record) => record.projectId === projectId).map((record) => structuredClone(record)).reverse();
  }

  async append(record: AuditRecord): Promise<AuditRecord> {
    const operation = this.queue.then(async () => {
      const next = [...this.records, structuredClone(record)];
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
      if (fs.existsSync(this.file)) await fs.promises.copyFile(this.file, this.file + '.bak');
      await fs.promises.rename(temporary, this.file);
      this.records = next;
      return structuredClone(record);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

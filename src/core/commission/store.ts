import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ActivityEvent, Commission } from './types';

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class CommissionStore {
  private readonly filePath: string;
  private readonly eventDir: string;
  private commissions: Commission[];
  private queue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'commissions.json');
    this.eventDir = path.join(dataDir, 'commission-events');
    fs.mkdirSync(this.eventDir, { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.commissions = [];
      return;
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('commissions.json の形式が不正です');
    this.commissions = parsed as Commission[];
    let recovered = false;
    for (const commission of this.commissions) {
      commission.artifacts ??= [];
      commission.workDecisions ??= [];
      commission.reviewDecisions ??= [];
      commission.memories ??= [];
      for (const work of commission.workItems) {
        work.domainPersonaId ??= work.ownerPersonaId;
        work.critical ??= false;
      }
      commission.settings.executionMode ??= 'review';
      commission.settings.criticalModel ??= 'claude-opus-5-5';
      commission.settings.fallbackModel ??= 'claude-haiku-4-5-20251001';
      if (commission.status === 'running') {
        commission.status = 'interrupted';
        commission.error = 'アプリ終了により実行が中断しました。作業結果を確認してから再開してください。';
        recovered = true;
      }
      for (const work of commission.workItems) {
        if (work.status === 'running' || work.status === 'review_pending') {
          work.status = 'interrupted';
          recovered = true;
        }
      }
      for (const run of commission.runs) {
        if (run.status === 'running') {
          run.status = 'interrupted';
          run.endedAt = new Date().toISOString();
          recovered = true;
        }
      }
    }
    if (recovered) {
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(this.commissions, null, 2));
      fs.renameSync(temporary, this.filePath);
    }
  }

  list(projectId?: string): Commission[] {
    return copy(projectId ? this.commissions.filter((item) => item.projectId === projectId) : this.commissions);
  }

  get(id: string): Commission {
    const found = this.commissions.find((item) => item.id === id);
    if (!found) throw new Error(`Commission not found: ${id}`);
    return copy(found);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async write(next: Commission[]): Promise<void> {
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(next, null, 2), 'utf8');
    await fs.promises.rename(temporary, this.filePath);
    this.commissions = next;
  }

  insert(commission: Commission): Promise<Commission> {
    return this.enqueue(async () => {
      if (this.commissions.some((item) => item.id === commission.id)) throw new Error('案件IDが重複しています');
      await this.write([...this.commissions, copy(commission)]);
      return copy(commission);
    });
  }

  update(id: string, change: (item: Commission) => void): Promise<Commission> {
    return this.enqueue(async () => {
      const next = copy(this.commissions);
      const item = next.find((entry) => entry.id === id);
      if (!item) throw new Error(`Commission not found: ${id}`);
      change(item);
      item.updatedAt = new Date().toISOString();
      await this.write(next);
      return copy(item);
    });
  }

  appendEvent(event: ActivityEvent): Promise<void> {
    return this.enqueue(async () => {
      if (!/^[a-f0-9-]{36}$/i.test(event.commissionId)) throw new Error('案件IDが不正です');
      const file = path.join(this.eventDir, `${event.commissionId}.jsonl`);
      await fs.promises.appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
    });
  }

  events(id: string): ActivityEvent[] {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('案件IDが不正です');
    const file = path.join(this.eventDir, `${id}.jsonl`);
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const events: ActivityEvent[] = [];
    for (const line of lines.slice(-300)) {
      try { events.push(JSON.parse(line) as ActivityEvent); }
      catch { /* クラッシュで不完全になった末尾は表示しない */ }
    }
    return events;
  }
}

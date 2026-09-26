import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Repository } from '../store/repository';
import { buildSnapshot, MobileSnapshot } from './snapshot';
import { createShareKey, deriveShareKeys, encryptSnapshot } from './envelope';

export const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  source(): 'secure' | 'env' | 'none';
}

interface StoredSettings {
  baseUrl: string;
  enabled: boolean;
  shareKey: string;
}

export interface MobileSyncStatus {
  lastAttemptAt?: string;
  lastSyncedAt?: string;
  meetings?: number;
  omitted?: number;
  bytes?: number;
  error?: string;
}

export interface MobileSyncView {
  baseUrl: string;
  enabled: boolean;
  tokenSource: 'secure' | 'env' | 'none';
  pairingUrl: string | null;
  status: MobileSyncStatus;
}

export interface MobileSyncOptions {
  fetch?: typeof fetch;
  maxBytes?: number;
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  let url: URL;
  try { url = new URL(trimmed); } catch { throw new Error('公開先URLの形式が正しくありません'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('公開先URLは https:// で始めてください');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('公開先URLにはドメインまでを入力してください（例: https://sikun-mobile.vercel.app）');
  return url.origin;
}

/** 会議の読み取り用スナップショットを暗号化して、Vercelの保存APIへ送る。 */
export class MobileSyncService {
  private readonly filePath: string;
  private settings: StoredSettings;
  private status: MobileSyncStatus = {};
  private lastHash: string | null = null;
  private running: Promise<MobileSyncStatus> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;

  constructor(dataDir: string, private repo: Repository, private tokens: TokenStore, options: MobileSyncOptions = {}) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'mobile-sync.json');
    this.fetchImpl = options.fetch ?? fetch;
    this.maxBytes = options.maxBytes ?? MAX_ENVELOPE_BYTES;
    let stored: Partial<StoredSettings> = {};
    try { stored = JSON.parse(fs.readFileSync(this.filePath, 'utf8')); } catch { /* 初回 */ }
    this.settings = {
      baseUrl: typeof stored.baseUrl === 'string' ? stored.baseUrl : '',
      enabled: stored.enabled === true,
      shareKey: typeof stored.shareKey === 'string' && stored.shareKey ? stored.shareKey : createShareKey(),
    };
    try { deriveShareKeys(this.settings.shareKey); } catch { this.settings.shareKey = createShareKey(); }
    if (stored.shareKey !== this.settings.shareKey) this.save();
  }

  private save(): void {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.settings, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  view(): MobileSyncView {
    return {
      baseUrl: this.settings.baseUrl,
      enabled: this.settings.enabled,
      tokenSource: this.tokens.source(),
      pairingUrl: this.settings.baseUrl ? `${this.settings.baseUrl}/#k=${this.settings.shareKey}` : null,
      status: { ...this.status },
    };
  }

  async configure(input: { baseUrl: string; enabled: boolean; token?: string }): Promise<MobileSyncView> {
    const baseUrl = normalizeBaseUrl(input.baseUrl || '');
    const token = input.token?.trim();
    if (token) {
      if (token.length < 16) throw new Error('同期トークンは16文字以上にしてください');
      this.tokens.set(token);
    }
    if (input.enabled && !baseUrl) throw new Error('公開先URLを入力してください');
    if (input.enabled && !this.tokens.get()) throw new Error('同期トークンを入力してください');
    const changedTarget = baseUrl !== this.settings.baseUrl;
    this.settings = { ...this.settings, baseUrl, enabled: input.enabled === true };
    this.save();
    if (changedTarget || token) this.lastHash = null;
    if (this.settings.enabled) await this.syncNow({ force: true }).catch(() => undefined);
    return this.view();
  }

  syncNow(options: { force?: boolean } = {}): Promise<MobileSyncStatus> {
    if (this.running) return this.running;
    this.running = this.upload(options.force === true).finally(() => { this.running = null; });
    return this.running;
  }

  private async request(method: 'PUT' | 'DELETE', id: string, body?: string): Promise<void> {
    const token = this.tokens.get();
    if (!token) throw new Error('同期トークンが設定されていません');
    const response = await this.fetchImpl(`${this.settings.baseUrl}/api/snapshot?id=${id}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 401) throw new Error('同期トークンがVercelの SYNC_TOKEN と一致しません');
    if (response.status === 413) throw new Error('送信する内容が大きすぎます');
    if (!response.ok) throw new Error(`送信に失敗しました（HTTP ${response.status}）`);
  }

  private encryptWithinLimit(snapshot: MobileSnapshot, encryptionKey: Buffer): { body: string; snapshot: MobileSnapshot } {
    let current = snapshot;
    for (;;) {
      const body = JSON.stringify(encryptSnapshot(JSON.stringify(current), encryptionKey));
      if (Buffer.byteLength(body) <= this.maxBytes || current.meetings.length === 0) {
        if (Buffer.byteLength(body) > this.maxBytes) throw new Error('会議を省いても容量の上限を超えます');
        return { body, snapshot: current };
      }
      const drop = Math.max(1, Math.ceil(current.meetings.length * 0.1));
      current = { ...current, meetings: current.meetings.slice(0, -drop), omittedMeetings: current.omittedMeetings + drop };
    }
  }

  private async upload(force: boolean): Promise<MobileSyncStatus> {
    const attemptAt = new Date().toISOString();
    try {
      if (!this.settings.baseUrl) throw new Error('公開先URLが設定されていません');
      const snapshot = buildSnapshot(this.repo.listMeetings(), this.repo.listProjects(), attemptAt);
      const hash = createHash('sha256').update(JSON.stringify({ projects: snapshot.projects, meetings: snapshot.meetings })).digest('hex');
      if (!force && hash === this.lastHash) {
        this.status = { ...this.status, lastAttemptAt: attemptAt, error: undefined };
        return { ...this.status };
      }
      const { encryptionKey, id } = deriveShareKeys(this.settings.shareKey);
      const fitted = this.encryptWithinLimit(snapshot, encryptionKey);
      await this.request('PUT', id, fitted.body);
      this.lastHash = hash;
      this.status = {
        lastAttemptAt: attemptAt, lastSyncedAt: attemptAt, meetings: fitted.snapshot.meetings.length,
        omitted: fitted.snapshot.omittedMeetings, bytes: Buffer.byteLength(fitted.body),
      };
    } catch (error) {
      this.status = { ...this.status, lastAttemptAt: attemptAt, error: error instanceof Error ? error.message : String(error) };
    }
    return { ...this.status };
  }

  /** 鍵を作り直す。古い鍵のスマホは読めなくなり、古い暗号文は削除する。 */
  async rotateKey(): Promise<MobileSyncView> {
    await this.running?.catch(() => undefined);
    const previous = deriveShareKeys(this.settings.shareKey).id;
    this.settings = { ...this.settings, shareKey: createShareKey() };
    this.save();
    this.lastHash = null;
    if (this.settings.baseUrl && this.tokens.get()) {
      if (this.settings.enabled) await this.syncNow({ force: true });
      try { await this.request('DELETE', previous); }
      catch (error) { this.status = { ...this.status, error: `古い暗号文を削除できませんでした: ${error instanceof Error ? error.message : String(error)}` }; }
    }
    return this.view();
  }

  start(intervalMs = 30_000): void {
    this.stop();
    this.timer = setInterval(() => { if (this.settings.enabled) void this.syncNow(); }, intervalMs);
    this.timer.unref?.();
    if (this.settings.enabled) void this.syncNow();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

import * as fs from 'fs';
import * as path from 'path';

/**
 * 出典の記録。Web取得を使う部門が、主張ごとに原資料のURL・発行日・確認日・引用箇所を残す。
 * 記録先は案件ごとにアプリのデータ領域で、作業フォルダには書かない。確認役や次の作業が一覧で参照できる。
 */

export interface SourceRecord { id: string; url: string; title: string; publisher?: string; published?: string; accessed: string; quote?: string; claim?: string; recordedAt: string }

export function readSources(file: string | undefined): SourceRecord[] {
  if (!file || !fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: unknown };
    return Array.isArray(parsed.sources) ? parsed.sources.filter((entry): entry is SourceRecord => Boolean(entry) && typeof entry.url === 'string') : [];
  } catch { return []; }
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined) || undefined;
const date = (value: unknown, label: string) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) throw new Error(`${label} は YYYY / YYYY-MM / YYYY-MM-DD にしてください（不明なら省略）`);
  return value;
};

export function recordSource(file: string | undefined, input: Record<string, unknown>) {
  if (!file) throw new Error('この段階では出典を記録できません');
  const url = text(input.url, 2000);
  if (!url || !/^https?:\/\//i.test(url)) throw new Error('url は http(s):// から始まる原資料のURLにしてください');
  const title = text(input.title, 300);
  if (!title) throw new Error('title に資料名を書いてください');
  const accessed = date(input.accessed, 'accessed') ?? new Date().toISOString().slice(0, 10);
  const sources = readSources(file);
  if (sources.length >= 300) throw new Error('記録できる出典は300件までです');
  const record: SourceRecord = {
    id: `S${sources.length + 1}`, url, title, publisher: text(input.publisher, 200), published: date(input.published, 'published'),
    accessed, quote: text(input.quote, 2000), claim: text(input.claim, 1000), recordedAt: new Date().toISOString(),
  };
  sources.push(record);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ sources }, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return { recorded: record, total: sources.length, note: '報告では [S番号] で出典を示す' };
}

export function listSources(file: string | undefined) {
  const sources = readSources(file);
  return { total: sources.length, sources, missingPublished: sources.filter((entry) => !entry.published).map((entry) => entry.id), missingQuote: sources.filter((entry) => !entry.quote).map((entry) => entry.id) };
}

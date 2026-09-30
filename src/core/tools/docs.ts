import * as fs from 'fs';
import * as path from 'path';
import { resolveReadable } from './data';
import { importEsm } from './esm';

/**
 * 文書系ツール。差分・本文抽出・引用の実在確認・文章の統計・翻訳の変数・リンク・見出し・用語の揺れを
 * 機械的に確かめる。読めるのは作業フォルダと参考資料フォルダだけで、ファイルは変更しない。
 */

const MAX_TEXT = 2_000_000;
const PAGE = 50_000;

export interface Scope { workingDirectory: string; readableDirectories: string[] }
type Source = { file?: string; text?: string };

/** PDF・Word・HTML・テキストから本文を取り出す。 */
export async function loadText(file: string, scope: Scope): Promise<{ file: string; text: string; pages?: number }> {
  const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
  const extension = path.extname(target).toLowerCase();
  const relative = path.relative(scope.workingDirectory, target) || path.basename(target);
  if (extension === '.pdf') {
    const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(target)), isEvalSupported: false, useSystemFonts: false });
    const document = await loading.promise;
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(content.items.map((item: { str?: string; hasEOL?: boolean }) => (item.str ?? '') + (item.hasEOL ? '\n' : '')).join(''));
    }
    await loading.destroy();
    return { file: relative, text: pages.map((text, i) => `--- ${i + 1}ページ ---\n${text}`).join('\n'), pages: pages.length };
  }
  if (extension === '.docx') {
    const mammoth = require('mammoth') as typeof import('mammoth');
    return { file: relative, text: (await mammoth.extractRawText({ path: target })).value };
  }
  const raw = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
  if (extension === '.html' || extension === '.htm') return { file: relative, text: htmlToText(raw) };
  if (['.md', '.markdown', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.toml', '.xml', '.srt', '.vtt', '.po', '.properties', '.strings', ''].includes(extension)) return { file: relative, text: raw };
  throw new Error(`本文を取り出せない形式です: ${extension}（pdf / docx / html / md / txt などに対応）`);
}

function htmlToText(html: string): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (entity, code: string) => code.startsWith('#x') ? String.fromCodePoint(parseInt(code.slice(2), 16))
      : code.startsWith('#') ? String.fromCodePoint(Number(code.slice(1))) : entities[code.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function sourceText(source: Source | undefined, scope: Scope, label: string): Promise<{ name: string; text: string }> {
  if (source?.file) { const loaded = await loadText(source.file, scope); return { name: loaded.file, text: loaded.text }; }
  if (typeof source?.text === 'string') {
    if (source.text.length > MAX_TEXT) throw new Error(`${label} の text が長すぎます`);
    return { name: label, text: source.text };
  }
  throw new Error(`${label} には file か text を指定してください`);
}

/** 本文の取り出し。長い場合は offset から50,000文字ずつ返す。 */
export async function extractText(file: string, scope: Scope, offset = 0) {
  const loaded = await loadText(file, scope);
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset は0以上の整数にしてください');
  return { file: loaded.file, pages: loaded.pages, totalChars: loaded.text.length, offset, nextOffset: offset + PAGE < loaded.text.length ? offset + PAGE : null, text: loaded.text.slice(offset, offset + PAGE) };
}

/** 2つの文章の差分。行・単語・文字の単位で、統一差分形式と追加・削除の件数を返す。 */
export async function textDiff(before: Source, after: Source, scope: Scope, unit: 'lines' | 'words' | 'chars' = 'lines') {
  const [a, b] = await Promise.all([sourceText(before, scope, 'before'), sourceText(after, scope, 'after')]);
  const diff = await importEsm('diff');
  const parts: { added?: boolean; removed?: boolean; value: string; count?: number }[] = unit === 'chars' ? diff.diffChars(a.text, b.text) : unit === 'words' ? diff.diffWordsWithSpace(a.text, b.text) : diff.diffLines(a.text, b.text);
  const stats = { added: 0, removed: 0, unchanged: 0 };
  for (const part of parts) stats[part.added ? 'added' : part.removed ? 'removed' : 'unchanged'] += part.count ?? 1;
  const identical = !parts.some((part) => part.added || part.removed);
  if (unit === 'lines') {
    const patch: string = diff.createTwoFilesPatch(a.name, b.name, a.text, b.text, '', '', { context: 3 });
    return { unit, identical, stats, patch: patch.length > PAGE ? `${patch.slice(0, PAGE)}\n…（省略）` : patch };
  }
  const changes = parts.filter((part) => part.added || part.removed).slice(0, 500).map((part) => ({ type: part.added ? 'added' : 'removed', text: part.value.slice(0, 500) }));
  return { unit, identical, stats, changes };
}

const normalize = (text: string) => text.normalize('NFKC').replace(/[\s　]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

/** 引用文が資料に実在するか。表記ゆれ（全角/半角・空白・改行）を正規化して探し、見つからなければ最も近い箇所と一致度を返す。 */
export async function findQuote(file: string, quote: string, scope: Scope) {
  if (typeof quote !== 'string' || quote.trim().length < 4) throw new Error('quote は4文字以上にしてください');
  const loaded = await loadText(file, scope);
  const text = normalize(loaded.text), target = normalize(quote);
  // 空白・改行の有無の違いを無視して探す（日本語は空白の入れ方が資料によって違うため）。位置は元の文字列に戻して返す。
  const positions: number[] = [];
  let compact = '';
  for (let i = 0; i < text.length; i++) if (text[i] !== ' ') { positions.push(i); compact += text[i]; }
  const needle = target.replace(/ /g, '');
  const found: { position: number; context: string }[] = [];
  for (let index = compact.indexOf(needle); index >= 0 && found.length < 20; index = compact.indexOf(needle, index + 1)) {
    const start = positions[index], end = positions[index + needle.length - 1] + 1;
    found.push({ position: start, context: text.slice(Math.max(0, start - 80), end + 80) });
  }
  if (found.length) return { file: loaded.file, found: true, exact: true, occurrences: found.length, matches: found, note: '全角/半角・空白・改行の違いは無視して照合した' };
  // 見つからない場合: 引用と同じ長さの窓を動かし、文字の2-gramの一致率が最も高い箇所を返す。
  const grams = (value: string) => { const set = new Map<string, number>(); for (let i = 0; i < value.length - 1; i++) set.set(value.slice(i, i + 2), (set.get(value.slice(i, i + 2)) ?? 0) + 1); return set; };
  const wanted = grams(target);
  const total = Math.max(1, target.length - 1);
  let best = { score: 0, position: 0 };
  const step = Math.max(1, Math.floor(target.length / 4));
  for (let start = 0; start <= Math.max(0, text.length - target.length); start += step) {
    const window = grams(text.slice(start, start + target.length));
    let shared = 0;
    for (const [gram, count] of wanted) shared += Math.min(count, window.get(gram) ?? 0);
    if (shared / total > best.score) best = { score: shared / total, position: start };
  }
  return {
    file: loaded.file, found: false, exact: false, similarity: Number(best.score.toFixed(3)),
    closest: text.slice(Math.max(0, best.position - 40), best.position + target.length + 40),
    note: '一致度は文字の2-gramの重なり（0〜1）。0.9未満なら引用として扱わず、原文の表現を確認する',
  };
}

/** 文字数・行数・文の長さ・漢字の比率など。読みやすさの目安として使う（読む時間は1分500字の概算）。 */
export async function textStats(source: Source, scope: Scope) {
  const { name, text } = await sourceText(source, scope, 'text');
  const sentences = text.split(/(?<=[。．！？!?])\s*|\n{2,}/).map((value) => value.trim()).filter(Boolean);
  const lengths = sentences.map((value) => [...value].length);
  const chars = [...text];
  const count = (pattern: RegExp) => chars.filter((char) => pattern.test(char)).length;
  const nonSpace = chars.filter((char) => !/\s/.test(char)).length;
  return {
    source: name, characters: chars.length, charactersWithoutSpaces: nonSpace,
    lines: text.split('\n').length, paragraphs: text.split(/\n\s*\n/).filter((value) => value.trim()).length,
    sentences: sentences.length,
    averageSentenceLength: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 0,
    longestSentences: sentences.map((value, i) => ({ length: lengths[i], text: value.slice(0, 200) })).sort((a, b) => b.length - a.length).slice(0, 5),
    sentencesOver80Chars: lengths.filter((value) => value > 80).length,
    kanjiRatio: nonSpace ? Number((count(/\p{Script=Han}/u) / nonSpace).toFixed(3)) : 0,
    katakanaRatio: nonSpace ? Number((count(/\p{Script=Katakana}/u) / nonSpace).toFixed(3)) : 0,
    estimatedReadingMinutes: Math.max(1, Math.round(nonSpace / 500)),
  };
}

const PLACEHOLDER = /\{\{\s*[\w.-]+\s*\}\}|\$\{[\w.-]+\}|\{[\w.-]*\}|%(\d+\$)?[-+ 0#]*\d*(\.\d+)?[sdifuxXcboe@%]|<\/?[a-zA-Z][\w-]*[^>]*>/g;

function flatten(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') out.set(prefix, value);
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

async function stringsFrom(source: Source, scope: Scope, label: string): Promise<Map<string, string>> {
  if (source.file && /\.json$/i.test(source.file)) {
    const loaded = await loadText(source.file, scope);
    return flatten(JSON.parse(loaded.text));
  }
  return new Map([['(text)', (await sourceText(source, scope, label)).text]]);
}

/** 翻訳前後で変数（{name}・{{x}}・%s・${x}・タグ）が同じか。JSONの翻訳ファイルならキーの過不足も調べる。 */
export async function checkPlaceholders(source: Source, target: Source, scope: Scope) {
  const [a, b] = await Promise.all([stringsFrom(source, scope, 'source'), stringsFrom(target, scope, 'target')]);
  const tokens = (text: string) => (text.match(PLACEHOLDER) ?? []).map((token) => token.replace(/\s+/g, '')).sort();
  const issues: { key: string; problem: string; source?: string[]; target?: string[] }[] = [];
  for (const [key, text] of a) {
    if (!b.has(key)) { if (a.size > 1) issues.push({ key, problem: '訳がありません' }); continue; }
    const translated = b.get(key)!;
    const wanted = tokens(text), got = tokens(translated);
    if (JSON.stringify(wanted) !== JSON.stringify(got)) issues.push({ key, problem: '変数・タグが一致しません', source: wanted, target: got });
    if (text.trim() && !translated.trim()) issues.push({ key, problem: '訳が空です' });
    if (text.trim() && text === translated && /[A-Za-z]{3,}/.test(text)) issues.push({ key, problem: '原文のまま（未翻訳の可能性）' });
  }
  if (a.size > 1) for (const key of b.keys()) if (!a.has(key)) issues.push({ key, problem: '原文にないキー' });
  return { keys: a.size, ok: issues.length === 0, issueCount: issues.length, issues: issues.slice(0, 500) };
}

/** GitHub と同じ規則で見出しからアンカーを作る。 */
function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
}

function headingsOf(text: string, html: boolean): { level: number; text: string; line: number }[] {
  const result: { level: number; text: string; line: number }[] = [];
  if (html) {
    for (const match of text.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)) result.push({ level: Number(match[1]), text: htmlToText(match[2]), line: text.slice(0, match.index).split('\n').length });
    return result;
  }
  let fenced = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = !fenced && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) result.push({ level: match[1].length, text: match[2], line: i + 1 });
  });
  return result;
}

/** 見出しの構成。階層の飛び（h2→h4）・重複・h1の数を調べる。 */
export async function documentOutline(file: string, scope: Scope) {
  const loaded = await loadText(file, scope);
  const raw = /\.html?$/i.test(file) ? fs.readFileSync(resolveReadable(file, scope.workingDirectory, scope.readableDirectories), 'utf8') : loaded.text;
  const headings = headingsOf(raw, /\.html?$/i.test(file));
  const issues: string[] = [];
  headings.forEach((heading, i) => { if (i && heading.level > headings[i - 1].level + 1) issues.push(`${heading.line}行目: 見出しの階層が h${headings[i - 1].level} から h${heading.level} に飛んでいます（${heading.text}）`); });
  const h1 = headings.filter((heading) => heading.level === 1).length;
  if (h1 !== 1) issues.push(`h1 が ${h1} 個あります（通常は1個）`);
  const seen = new Map<string, number>();
  for (const heading of headings) {
    if (seen.has(heading.text)) issues.push(`${heading.line}行目: 見出し「${heading.text}」が ${seen.get(heading.text)}行目と重複しています`);
    else seen.set(heading.text, heading.line);
  }
  return { file: loaded.file, headings, issues };
}

/** Markdown / HTML のローカルリンク・画像参照が存在するか、アンカー（#見出し）が実在するかを調べる。外部URLは一覧にするだけで接続しない。 */
export async function checkLinks(file: string, scope: Scope) {
  const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
  const raw = fs.readFileSync(target, 'utf8');
  const html = /\.html?$/i.test(target);
  const links: { url: string; line: number }[] = [];
  const push = (url: string, index: number) => links.push({ url: url.trim().replace(/^<|>$/g, ''), line: raw.slice(0, index).split('\n').length });
  if (html) for (const match of raw.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)) push(match[1], match.index ?? 0);
  else {
    for (const match of raw.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) push(match[1], match.index ?? 0);
    for (const match of raw.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) push(match[1], match.index ?? 0);
  }
  const anchorsOf = (file: string) => {
    const text = fs.readFileSync(file, 'utf8');
    const ids = [...text.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
    return new Set([...headingsOf(text, /\.html?$/i.test(file)).map((heading) => slug(heading.text)), ...ids]);
  };
  const broken: { url: string; line: number; problem: string }[] = [], external: string[] = [];
  let checked = 0;
  for (const link of links) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(link.url)) { if (/^https?:/i.test(link.url)) external.push(link.url); continue; }
    checked++;
    const [pathPart, anchor] = link.url.split('#');
    let destination = target;
    if (pathPart) {
      destination = path.resolve(path.dirname(target), decodeURIComponent(pathPart.split('?')[0]));
      if (!fs.existsSync(destination)) { broken.push({ ...link, problem: 'リンク先のファイルがありません' }); continue; }
    }
    if (anchor && fs.statSync(destination).isFile() && /\.(md|markdown|html?)$/i.test(destination) && !anchorsOf(destination).has(decodeURIComponent(anchor))) {
      broken.push({ ...link, problem: `見出し・id「#${anchor}」がありません` });
    }
  }
  return { file: path.relative(scope.workingDirectory, target) || path.basename(target), links: links.length, checkedLocal: checked, broken, external: [...new Set(external)].slice(0, 200), note: '外部URLは接続確認していない' };
}

/** 用語集にある表記の揺れ（例: ユーザー/ユーザ）と、全角・半角英数字の混在を行番号付きで返す。 */
export async function checkTerms(source: Source, terms: { preferred: string; variants: string[] }[], scope: Scope) {
  const { name, text } = await sourceText(source, scope, 'text');
  const lines = text.split('\n');
  const findings: { line: number; found: string; preferred: string; context: string }[] = [];
  for (const term of terms ?? []) {
    if (!term?.preferred || !Array.isArray(term.variants)) throw new Error('terms は [{preferred, variants[]}] にしてください');
    for (const variant of term.variants) {
      if (!variant || variant === term.preferred) continue;
      lines.forEach((line, i) => {
        for (let index = line.indexOf(variant); index >= 0; index = line.indexOf(variant, index + 1)) {
          // 正しい表記の一部として出現している場合（例: ユーザー 中の ユーザ）は数えない。
          if (line.slice(index, index + term.preferred.length) === term.preferred) continue;
          findings.push({ line: i + 1, found: variant, preferred: term.preferred, context: line.slice(Math.max(0, index - 20), index + variant.length + 20) });
        }
      });
    }
  }
  const fullWidth = lines.flatMap((line, i) => (/[０-９Ａ-Ｚａ-ｚ]/.test(line) ? [{ line: i + 1, context: line.slice(0, 120) }] : []));
  return { source: name, findings: findings.slice(0, 500), findingCount: findings.length, fullWidthAlphanumericLines: fullWidth.slice(0, 100), note: '全角英数字の行は、半角との混在がないか確認する' };
}

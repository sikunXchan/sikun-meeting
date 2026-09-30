import * as fs from 'fs';
import * as path from 'path';

/**
 * 利用者が整理した UI/UX の原則集（500項目）を番号や語で引く。全文をプロンプトに入れず、必要な項目だけを返す。
 * 原本は interface-design スキルの knowledge/ux-principles.md（ビルド時に dist へコピーされる）。
 */

export interface UxSection { number: number; title: string; body: string }

const KNOWLEDGE_FILE = path.join(__dirname, '..', 'skills', 'catalog', 'interface-design', 'knowledge', 'ux-principles.md');
let cache: UxSection[] | undefined;

export function parseUxSections(source: string): UxSection[] {
  const sections: UxSection[] = [];
  let current: UxSection | undefined;
  for (const line of source.replace(/\r/g, '').split('\n')) {
    const heading = /^#{1,2} (\d+)\. (.+)$/.exec(line);
    if (heading) { current = { number: Number(heading[1]), title: heading[2].trim(), body: '' }; sections.push(current); continue; }
    if (current && line.trim() !== '---') current.body += `${line}\n`;
  }
  for (const section of sections) section.body = section.body.replace(/\n{3,}/g, '\n\n').trim();
  return sections;
}

export function uxSections(file = KNOWLEDGE_FILE): UxSection[] {
  if (file !== KNOWLEDGE_FILE) return parseUxSections(fs.readFileSync(file, 'utf8'));
  cache ??= parseUxSections(fs.readFileSync(KNOWLEDGE_FILE, 'utf8'));
  return cache;
}

const MAX_BODY = 1500;
const shown = (section: UxSection) => ({ number: section.number, title: section.title, body: section.body.length > MAX_BODY ? `${section.body.slice(0, MAX_BODY)}…` : section.body });

/** numbers で番号指定、query で語を検索（見出しの一致を優先）。どちらも無ければ目次を返す。 */
export function lookupUxPrinciples(input: { query?: unknown; numbers?: unknown; limit?: unknown }, sections = uxSections()) {
  const limit = input.limit === undefined ? 5 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('limit は1〜10にしてください');
  if (Array.isArray(input.numbers) && input.numbers.length) {
    if (input.numbers.length > 10) throw new Error('numbers は10個までにしてください');
    const wanted = input.numbers.map(Number);
    const found = sections.filter((section) => wanted.includes(section.number));
    const missing = wanted.filter((n) => !found.some((section) => section.number === n));
    return { sections: found.map(shown), missing: missing.length ? missing : undefined };
  }
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) {
    return { total: sections.length, index: sections.map((section) => `${section.number}. ${section.title}`), note: 'query に語（例: フォーム エラー）か numbers に番号を指定すると本文を返す' };
  }
  if (query.length > 100) throw new Error('query は100文字以内にしてください');
  const terms = query.toLowerCase().split(/[\s、,]+/).filter(Boolean);
  const scored = sections.map((section) => {
    const title = section.title.toLowerCase(), body = section.body.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 10 : 0) + Math.min(body.split(term).length - 1, 5), 0);
    const all = terms.every((term) => title.includes(term) || body.includes(term));
    return { section, score: score + (all ? 5 : 0) };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.section.number - b.section.number);
  return {
    query, matched: scored.length,
    sections: scored.slice(0, limit).map((entry) => shown(entry.section)),
    alsoRelated: scored.slice(limit, limit + 15).map((entry) => `${entry.section.number}. ${entry.section.title}`),
  };
}

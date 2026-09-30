import * as fs from 'fs';
import * as path from 'path';
import { resolveReadable } from './data';
import { importEsm } from './esm';
import type { Scope } from './docs';

/**
 * コード補助ツール。正規表現・バージョン範囲・設定ファイルの構文・JSON Schema・cron式を、実行せずに検証する。
 * semver・ajv・smol-toml・js-yaml・cron-parser を使う。
 */

/** 正規表現を複数の入力に当て、一致・位置・グループを返す。JavaScriptの正規表現として解釈する。 */
export function testRegex(pattern: unknown, flags: unknown, inputs: unknown) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 500) throw new Error('pattern は1〜500文字にしてください');
  const flagText = typeof flags === 'string' ? flags : '';
  if (!/^[dgimsuvy]*$/.test(flagText)) throw new Error('flags は d g i m s u v y の組み合わせです');
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 50 || inputs.some((value) => typeof value !== 'string' || value.length > 5000)) throw new Error('inputs は5000文字以内の文字列を50個までにしてください');
  const regex = new RegExp(pattern, flagText.includes('g') ? flagText : `${flagText}g`);
  return {
    pattern, flags: flagText, note: '全一致を調べるため g を付けて評価した。JavaScript の正規表現で、他の言語とは一部の構文が異なる',
    results: (inputs as string[]).map((input) => {
      const matches = [...input.matchAll(regex)].slice(0, 100).map((match) => ({ match: match[0], index: match.index, groups: match.slice(1), named: match.groups }));
      return { input: input.slice(0, 200), matched: matches.length > 0, fullMatch: new RegExp(`^(?:${pattern})$`, flagText.replace('g', '')).test(input), matches };
    }),
  };
}

/** バージョン番号を比較・整列し、範囲指定（^1.2.0、~2.0、>=3 <4 など）を満たすか調べる。npm の semver の規則。 */
export function compareVersions(versionsInput: unknown, range?: unknown) {
  const semver = require('semver') as typeof import('semver');
  if (!Array.isArray(versionsInput) || !versionsInput.length || versionsInput.length > 200) throw new Error('versions は1〜200個にしてください');
  const versions = versionsInput.map((value) => String(value));
  const invalid = versions.filter((value) => !semver.valid(value));
  const valid = versions.filter((value) => semver.valid(value));
  if (range !== undefined && (typeof range !== 'string' || !semver.validRange(range))) throw new Error(`範囲指定として読めません: ${String(range)}`);
  return {
    sorted: [...valid].sort(semver.compare), latest: valid.length ? semver.maxSatisfying(valid, '*', { includePrerelease: true }) : null,
    invalid: invalid.length ? invalid : undefined,
    coerced: invalid.length ? Object.fromEntries(invalid.map((value) => [value, semver.coerce(value)?.version ?? null])) : undefined,
    ...(typeof range === 'string' ? {
      range, satisfying: valid.filter((value) => semver.satisfies(value, range)),
      maxSatisfying: semver.maxSatisfying(valid, range), notSatisfying: valid.filter((value) => !semver.satisfies(value, range)),
    } : {}),
  };
}

/** JSON の最初の構文エラーの位置を調べる（JSON.parse のメッセージに位置が含まれない場合があるため）。 */
export function jsonErrorPosition(text: string): number {
  let i = 0;
  const fail = (): never => { throw i; };
  const space = () => { while (/[ \t\n\r]/.test(text[i] ?? '')) i++; };
  const literal = (word: string) => { if (text.startsWith(word, i)) i += word.length; else fail(); };
  const string = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') { i++; if (text[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail(); i += 4; } else if (!'"\\/bfnrt'.includes(text[i] ?? '')) fail(); }
      else if (text.charCodeAt(i) < 0x20) fail();
      i++;
    }
    if (text[i] !== '"') fail();
    i++;
  };
  const value = (): void => {
    space();
    const c = text[i];
    if (c === '{') {
      i++; space();
      if (text[i] === '}') { i++; return; }
      for (;;) { space(); if (text[i] !== '"') fail(); string(); space(); if (text[i] !== ':') fail(); i++; value(); space(); if (text[i] === ',') { i++; continue; } if (text[i] === '}') { i++; return; } fail(); }
    }
    if (c === '[') {
      i++; space();
      if (text[i] === ']') { i++; return; }
      for (;;) { value(); space(); if (text[i] === ',') { i++; continue; } if (text[i] === ']') { i++; return; } fail(); }
    }
    if (c === '"') return string();
    if (c === 't') return literal('true');
    if (c === 'f') return literal('false');
    if (c === 'n') return literal('null');
    const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!number) fail();
    i += number![0].length;
  };
  try { value(); space(); if (i < text.length) fail(); return -1; } catch (position) { return typeof position === 'number' ? position : i; }
}

/** JSON / YAML / TOML の構文を検査し、誤りの位置（行・列）か、読めた場合は最上位のキーを返す。 */
export async function validateConfig(file: string, scope: Scope) {
  const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
  const extension = path.extname(target).toLowerCase();
  const text = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
  const relative = path.relative(scope.workingDirectory, target) || path.basename(target);
  const summarize = (value: unknown) => ({ file: relative, valid: true, type: Array.isArray(value) ? 'array' : typeof value, topLevelKeys: value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 100) : undefined });
  try {
    if (extension === '.json') return summarize(JSON.parse(text));
    if (extension === '.yaml' || extension === '.yml') {
      const { loadAll } = require('js-yaml') as typeof import('js-yaml');
      const documents = loadAll(text);
      return { ...summarize(documents.length === 1 ? documents[0] : documents), documents: documents.length };
    }
    if (extension === '.toml') { const { parse } = await importEsm('smol-toml'); return summarize(parse(text)); }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = /position (\d+)/.exec(message) ?? (extension === '.json' ? [, String(Math.max(0, jsonErrorPosition(text)))] as unknown as RegExpExecArray : null);
    const lineColumn = position ? (() => { const before = text.slice(0, Number(position[1])); return { line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') }; })()
      : (error as { mark?: { line: number; column: number }; line?: number; column?: number }).mark
        ? { line: (error as { mark: { line: number } }).mark.line + 1, column: (error as { mark: { column: number } }).mark.column + 1 }
        : (error as { line?: number }).line ? { line: (error as { line: number }).line, column: (error as { column?: number }).column } : undefined;
    return { file: relative, valid: false, error: message.split('\n')[0].slice(0, 500), ...lineColumn };
  }
  throw new Error('検査できる形式は .json / .yaml / .yml / .toml です');
}

/** データが JSON Schema に合うかを ajv で検証する。data・schema はファイル（JSON / YAML）か値を直接渡す。 */
export async function validateJsonSchema(input: { data?: unknown; dataFile?: string; schema?: unknown; schemaFile?: string }, scope: Scope) {
  const read = (file: string) => {
    const target = resolveReadable(file, scope.workingDirectory, scope.readableDirectories);
    const text = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
    if (/\.ya?ml$/i.test(target)) return (require('js-yaml') as typeof import('js-yaml')).load(text);
    return JSON.parse(text);
  };
  const data = input.dataFile ? read(input.dataFile) : input.data;
  const schema = input.schemaFile ? read(input.schemaFile) : input.schema;
  if (data === undefined || !schema || typeof schema !== 'object') throw new Error('data（または dataFile）と schema（または schemaFile）を指定してください');
  const Ajv = (require('ajv') as { default: typeof import('ajv').default }).default;
  const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
  const validate = ajv.compile(schema as object);
  const valid = validate(data) as boolean;
  return {
    valid, errorCount: validate.errors?.length ?? 0,
    errors: (validate.errors ?? []).slice(0, 200).map((error) => ({ path: error.instancePath || '/', keyword: error.keyword, message: error.message, params: error.params })),
    note: 'format（email・date など）の書式は検証していない',
  };
}

/** cron 式の次回以降の実行日時を、指定したタイムゾーンで列挙する（5項目、または秒を含む6項目）。 */
export function explainCron(expression: unknown, countInput: unknown = 5, timezone: unknown = 'Asia/Tokyo', from?: unknown) {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression に cron 式を指定してください（例: 0 9 * * 1-5）');
  const count = Number(countInput);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error('count は1〜50にしてください');
  const { CronExpressionParser } = require('cron-parser') as typeof import('cron-parser');
  const tz = typeof timezone === 'string' ? timezone : 'Asia/Tokyo';
  const start = typeof from === 'string' ? new Date(from) : new Date();
  if (Number.isNaN(start.getTime())) throw new Error('from は日時（例: 2026-10-01T00:00:00+09:00）にしてください');
  const parsed = CronExpressionParser.parse(expression.trim(), { currentDate: start, tz });
  const next: string[] = [];
  for (let i = 0; i < count; i++) {
    const date = parsed.next().toDate();
    next.push(new Intl.DateTimeFormat('ja-JP', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(date) + `（${date.toISOString()}）`);
  }
  const fields = expression.trim().split(/\s+/);
  const names = fields.length === 6 ? ['秒', '分', '時', '日', '月', '曜日'] : ['分', '時', '日', '月', '曜日'];
  return { expression: expression.trim(), timezone: tz, from: start.toISOString(), fields: Object.fromEntries(names.map((name, i) => [name, fields[i]])), next };
}

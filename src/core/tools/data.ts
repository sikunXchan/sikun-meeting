import * as fs from 'fs';
import * as path from 'path';
import { add, compare, div, parseNumber, rational, toDecimal, type Rational } from './rational';

/** 表・構造化データの読み取り。読めるのは作業フォルダと許可フォルダの中だけで、ファイルは変更しない。 */
const MAX_TABLE_BYTES = 20 * 1024 * 1024;
const MAX_TABLE_ROWS = 1000;
const MAX_TABLE_COLUMNS = 100;
const MAX_CELL_LENGTH = 500;

// ---- 表の読み取り ----

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** 作業フォルダと許可フォルダの内側だけを読む。シンボリックリンクで外へ出る場合も拒否する。 */
export function resolveReadable(file: string, workingDirectory: string, readableDirectories: readonly string[] = []): string {
  if (typeof file !== 'string' || !file.trim()) throw new Error('ファイルを指定してください');
  const roots = [workingDirectory, ...readableDirectories].filter((root) => fs.existsSync(root)).map((root) => fs.realpathSync(root));
  const target = fs.realpathSync(path.resolve(workingDirectory, file));
  if (!roots.some((root) => inside(root, target))) throw new Error('作業フォルダと参考資料フォルダの外のファイルは読めません');
  const info = fs.statSync(target);
  if (!info.isFile()) throw new Error('ファイルを指定してください');
  if (info.size > MAX_TABLE_BYTES) throw new Error('表ファイルは20 MBまでです');
  return target;
}

export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const cell = value as { result?: unknown; text?: unknown; richText?: { text: string }[]; error?: unknown };
    if ('result' in cell) return cellText(cell.result);
    if (Array.isArray(cell.richText)) return cell.richText.map((part) => part.text).join('');
    if (typeof cell.text === 'string') return cell.text;
    if (cell.error !== undefined) return String(cell.error);
    return JSON.stringify(value);
  }
  return String(value);
}

export interface LoadedTable { file: string; sheet?: string; sheets?: string[]; header: string[]; rows: string[][] }

/** 表を読み込み、1行目を見出しとして返す。セルは前後の空白を除いた文字列。 */
export async function loadTable(file: string, workingDirectory: string, readableDirectories: readonly string[] = [], sheetName?: string): Promise<LoadedTable> {
  const target = resolveReadable(file, workingDirectory, readableDirectories);
  const extension = path.extname(target).toLowerCase();
  let rows: string[][], sheet: string | undefined, sheets: string[] | undefined;
  if (extension === '.csv' || extension === '.tsv') {
    const text = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
    rows = parseDelimited(text, extension === '.tsv' ? '\t' : ',');
  } else if (extension === '.xlsx') {
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(target);
    sheets = workbook.worksheets.map((entry) => entry.name);
    const worksheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
    if (!worksheet) throw new Error(`シートがありません: ${sheetName ?? '（先頭）'}。シート: ${sheets.join(', ')}`);
    sheet = worksheet.name;
    rows = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values, cellText)); // 空セルの穴も空文字にそろえる
    });
  } else throw new Error('読める表形式は .csv / .tsv / .xlsx です');
  rows = rows.map((row) => row.slice(0, MAX_TABLE_COLUMNS).map((cell) => cell.trim().slice(0, MAX_CELL_LENGTH)));
  return { file: path.relative(workingDirectory, target) || path.basename(target), sheet, sheets, header: rows[0] ?? [], rows: rows.slice(1) };
}

/** 桁区切りのカンマ・通貨記号・全角数字を許して数値として読む。読めなければ undefined。 */
export function cellNumber(cell: string | undefined): Rational | undefined {
  if (cell === undefined) return undefined;
  const text = cell.normalize('NFKC').replace(/[,\s¥$€£円]/g, '');
  if (!text) return undefined;
  const percent = text.endsWith('%');
  try {
    const value = parseNumber(percent ? text.slice(0, -1) : text);
    return percent ? div(value, rational(100n)) : value;
  } catch { return undefined; }
}

function columnIndex(table: LoadedTable, column: string): number {
  const index = table.header.indexOf(column);
  if (index >= 0) return index;
  if (/^\d+$/.test(column) && Number(column) >= 1 && Number(column) <= table.header.length) return Number(column) - 1;
  throw new Error(`列がありません: ${column}（見出し: ${table.header.join(', ')}）`);
}

export interface TableResult {
  file: string;
  sheet?: string;
  sheets?: string[];
  totalRows: number;
  truncated: boolean;
  rows: string[][];
  /** 1行目を見出しとして、2行目以降の数値セルを厳密に合計した値。数値でないセルの数も返す。 */
  numericColumns: { column: number; header: string; total: string; numericCells: number; otherCells: number }[];
}

export async function readTable(file: string, workingDirectory: string, readableDirectories: readonly string[] = [], options: { sheet?: string; maxRows?: number } = {}): Promise<TableResult> {
  const maxRows = options.maxRows ?? 200;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_TABLE_ROWS) throw new Error(`maxRows は1〜${MAX_TABLE_ROWS}にしてください`);
  const table = await loadTable(file, workingDirectory, readableDirectories, options.sheet);
  const all = [table.header, ...table.rows];
  const width = Math.max(0, ...all.map((row) => row.length));
  const numericColumns = [];
  for (let column = 0; column < width; column++) {
    let total = rational(0n), numericCells = 0, otherCells = 0;
    for (const row of table.rows) {
      const raw = (row[column] ?? '').replace(/,/g, '');
      if (!raw) continue;
      try { total = add(total, parseNumber(raw)); numericCells++; } catch { otherCells++; }
    }
    if (numericCells) numericColumns.push({ column: column + 1, header: table.header[column] ?? '', total: toDecimal(total, 10), numericCells, otherCells });
  }
  return {
    file: table.file, sheet: table.sheet, sheets: table.sheets,
    totalRows: all.length, truncated: all.length > maxRows, rows: all.slice(0, maxRows), numericColumns,
  };
}

export type FilterOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'contains' | 'empty' | 'not_empty';
export interface TableFilter { column: string; op: FilterOperator; value?: string }
export type Aggregate = 'sum' | 'count' | 'avg' | 'min' | 'max';

function matches(cell: string, filter: TableFilter): boolean {
  if (filter.op === 'empty') return cell === '';
  if (filter.op === 'not_empty') return cell !== '';
  const value = filter.value ?? '';
  if (filter.op === 'contains') return cell.includes(value);
  const left = cellNumber(cell), right = cellNumber(value);
  // 数値と比べる大小条件では、数値でないセル（空欄・文字）を該当させない。
  if (right && !left && filter.op !== '=' && filter.op !== '!=') return false;
  const order = left && right ? compare(left, right) : cell < value ? -1 : cell > value ? 1 : 0;
  switch (filter.op) {
    case '=': return order === 0;
    case '!=': return order !== 0;
    case '>': return order > 0;
    case '>=': return order >= 0;
    case '<': return order < 0;
    case '<=': return order <= 0;
    default: throw new Error(`使えない条件です: ${String(filter.op)}`);
  }
}

/** 行の絞り込みと、列ごとのグループ集計（合計・件数・平均・最小・最大）を厳密に行う。 */
export async function queryTable(file: string, workingDirectory: string, readableDirectories: readonly string[], options: {
  sheet?: string; filters?: TableFilter[]; groupBy?: string[]; aggregates?: { column: string; fn: Aggregate }[]; maxRows?: number;
}) {
  const table = await loadTable(file, workingDirectory, readableDirectories, options.sheet);
  const filters = options.filters ?? [];
  const filterIndexes = filters.map((filter) => columnIndex(table, filter.column));
  const selected = table.rows.filter((row) => filters.every((filter, i) => matches(row[filterIndexes[i]] ?? '', filter)));
  const aggregates = options.aggregates ?? [];
  const maxRows = options.maxRows ?? 200;
  if (!aggregates.length) {
    return { file: table.file, matchedRows: selected.length, header: table.header, rows: selected.slice(0, maxRows), truncated: selected.length > maxRows };
  }
  const groupIndexes = (options.groupBy ?? []).map((column) => columnIndex(table, column));
  const aggregateIndexes = aggregates.map((aggregate) => columnIndex(table, aggregate.column));
  const groups = new Map<string, string[][]>();
  for (const row of selected) {
    const key = JSON.stringify(groupIndexes.map((index) => row[index] ?? ''));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const results = [...groups.entries()].map(([key, rows]) => {
    const group = Object.fromEntries((options.groupBy ?? []).map((column, i) => [column, (JSON.parse(key) as string[])[i]]));
    const values: Record<string, string | number> = {};
    aggregates.forEach((aggregate, i) => {
      const numbers = rows.map((row) => cellNumber(row[aggregateIndexes[i]])).filter((value): value is Rational => Boolean(value));
      const label = `${aggregate.fn}(${aggregate.column})`;
      if (aggregate.fn === 'count') { values[label] = rows.filter((row) => (row[aggregateIndexes[i]] ?? '') !== '').length; return; }
      if (!numbers.length) { values[label] = '数値なし'; return; }
      const total = numbers.reduce(add, rational(0n));
      const pick = (sign: number) => numbers.reduce((a, b) => (compare(a, b) * sign >= 0 ? a : b));
      values[label] = toDecimal(aggregate.fn === 'sum' ? total : aggregate.fn === 'avg' ? div(total, rational(BigInt(numbers.length))) : pick(aggregate.fn === 'max' ? 1 : -1), 10);
    });
    return { ...group, rows: rows.length, ...values };
  });
  return { file: table.file, matchedRows: selected.length, groups: results.slice(0, maxRows), truncated: results.length > maxRows };
}

/** 2つの表をキー列で突き合わせ、片方にしかない行と、比較列の値の違い・差額を返す。 */
export async function reconcileTables(options: {
  left: string; right: string; key: string[]; compare: string[]; leftSheet?: string; rightSheet?: string; maxRows?: number;
}, workingDirectory: string, readableDirectories: readonly string[]) {
  if (!options.key?.length) throw new Error('キー列を1つ以上指定してください');
  const left = await loadTable(options.left, workingDirectory, readableDirectories, options.leftSheet);
  const right = await loadTable(options.right, workingDirectory, readableDirectories, options.rightSheet);
  const index = (table: LoadedTable) => {
    const keys = options.key.map((column) => columnIndex(table, column));
    const map = new Map<string, string[]>(), duplicates: string[] = [];
    for (const row of table.rows) {
      const key = keys.map((i) => row[i] ?? '').join(' | ');
      if (map.has(key)) duplicates.push(key); else map.set(key, row);
    }
    return { map, duplicates };
  };
  const l = index(left), r = index(right);
  const maxRows = options.maxRows ?? 200;
  const onlyLeft = [...l.map.keys()].filter((key) => !r.map.has(key));
  const onlyRight = [...r.map.keys()].filter((key) => !l.map.has(key));
  const differences: { key: string; column: string; left: string; right: string; difference?: string }[] = [];
  const totals = options.compare.map((column) => ({ column, left: rational(0n), right: rational(0n) }));
  for (const [key, leftRow] of l.map) {
    const rightRow = r.map.get(key);
    options.compare.forEach((column, i) => {
      const a = leftRow[columnIndex(left, column)] ?? '';
      const b = rightRow ? rightRow[columnIndex(right, column)] ?? '' : undefined;
      const na = cellNumber(a);
      if (na) totals[i].left = add(totals[i].left, na);
      if (b === undefined) return;
      const nb = cellNumber(b);
      const same = na && nb ? compare(na, nb) === 0 : a === b;
      if (!same) differences.push({ key, column, left: a, right: b, ...(na && nb ? { difference: toDecimal(add(nb, rational(-na.n, na.d)), 10) } : {}) });
    });
  }
  for (const [, rightRow] of r.map) options.compare.forEach((column, i) => {
    const nb = cellNumber(rightRow[columnIndex(right, column)]);
    if (nb) totals[i].right = add(totals[i].right, nb);
  });
  return {
    matchedKeys: [...l.map.keys()].filter((key) => r.map.has(key)).length,
    onlyInLeft: { count: onlyLeft.length, keys: onlyLeft.slice(0, maxRows) },
    onlyInRight: { count: onlyRight.length, keys: onlyRight.slice(0, maxRows) },
    differences: { count: differences.length, rows: differences.slice(0, maxRows) },
    duplicateKeys: { left: l.duplicates.slice(0, maxRows), right: r.duplicates.slice(0, maxRows) },
    totals: totals.map((total) => ({ column: total.column, left: toDecimal(total.left, 10), right: toDecimal(total.right, 10), difference: toDecimal(add(total.right, rational(-total.left.n, total.left.d)), 10) })),
  };
}

export type ColumnRule = { column: string; required?: boolean; type?: 'number' | 'date' | 'text'; unique?: boolean; min?: string; max?: string; pattern?: string };

/** 必須列・空欄・型・重複・範囲・形式を検査し、問題のある行番号（見出しを1行目とした番号）を返す。 */
export async function validateTable(file: string, workingDirectory: string, readableDirectories: readonly string[], rules: ColumnRule[], sheet?: string) {
  const table = await loadTable(file, workingDirectory, readableDirectories, sheet);
  const issues: { row?: number; column: string; problem: string; value?: string }[] = [];
  for (const rule of rules) {
    const index = table.header.indexOf(rule.column);
    if (index < 0) { issues.push({ column: rule.column, problem: '列がありません' }); continue; }
    const seen = new Map<string, number>();
    if (rule.pattern && rule.pattern.length > 200) throw new Error('pattern は200文字までにしてください');
    const pattern = rule.pattern ? new RegExp(rule.pattern, 'u') : undefined;
    const min = rule.min !== undefined ? cellNumber(rule.min) : undefined, max = rule.max !== undefined ? cellNumber(rule.max) : undefined;
    table.rows.forEach((row, i) => {
      const cell = row[index] ?? '', line = i + 2;
      if (!cell) { if (rule.required) issues.push({ row: line, column: rule.column, problem: '空欄' }); return; }
      const number = cellNumber(cell);
      if (rule.type === 'number' && !number) issues.push({ row: line, column: rule.column, problem: '数値ではありません', value: cell });
      if (rule.type === 'date' && !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cell)) issues.push({ row: line, column: rule.column, problem: '日付（YYYY-MM-DD）ではありません', value: cell });
      if (number && min && compare(number, min) < 0) issues.push({ row: line, column: rule.column, problem: `${rule.min} 未満`, value: cell });
      if (number && max && compare(number, max) > 0) issues.push({ row: line, column: rule.column, problem: `${rule.max} 超過`, value: cell });
      if (pattern && !pattern.test(cell)) issues.push({ row: line, column: rule.column, problem: '形式が一致しません', value: cell });
      if (rule.unique) {
        if (seen.has(cell)) issues.push({ row: line, column: rule.column, problem: `${seen.get(cell)}行目と重複`, value: cell });
        else seen.set(cell, line);
      }
    });
  }
  return { file: table.file, rows: table.rows.length, valid: issues.length === 0, issueCount: issues.length, issues: issues.slice(0, 500) };
}

/** 列ごとの型の推定・空欄数・値の種類数・数値の最小/最大を返す。表の中身を把握してから計算するために使う。 */
export async function describeTable(file: string, workingDirectory: string, readableDirectories: readonly string[], sheet?: string) {
  const table = await loadTable(file, workingDirectory, readableDirectories, sheet);
  const columns = table.header.map((header, index) => {
    const cells = table.rows.map((row) => row[index] ?? '');
    const filled = cells.filter(Boolean);
    const numbers = filled.map(cellNumber).filter((value): value is Rational => Boolean(value));
    const pick = (sign: number) => numbers.reduce((a, b) => (compare(a, b) * sign >= 0 ? a : b));
    return {
      column: index + 1, header, blanks: cells.length - filled.length, distinct: new Set(filled).size,
      type: !filled.length ? 'empty' : numbers.length === filled.length ? 'number' : numbers.length ? 'mixed' : 'text',
      ...(numbers.length ? { min: toDecimal(pick(-1), 10), max: toDecimal(pick(1), 10) } : {}),
      examples: [...new Set(filled)].slice(0, 3),
    };
  });
  return { file: table.file, sheet: table.sheet, sheets: table.sheets, rows: table.rows.length, columns };
}

/** JSON / YAML を読み、必要ならドット区切りのパス（例: items.0.price）の値だけを返す。 */
export function readStructured(file: string, workingDirectory: string, readableDirectories: readonly string[], pointer?: string) {
  const target = resolveReadable(file, workingDirectory, readableDirectories);
  const extension = path.extname(target).toLowerCase();
  const text = fs.readFileSync(target, 'utf8').replace(/^﻿/, '');
  let value: unknown;
  if (extension === '.json') value = JSON.parse(text);
  else if (extension === '.yaml' || extension === '.yml') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { load, JSON_SCHEMA } = require('js-yaml') as typeof import('js-yaml');
    value = load(text, { schema: JSON_SCHEMA });
  } else throw new Error('読める形式は .json / .yaml / .yml です');
  if (pointer) {
    for (const part of pointer.split('.').filter(Boolean)) {
      if (value === null || typeof value !== 'object' || !(part in (value as Record<string, unknown>))) throw new Error(`パスがありません: ${pointer}`);
      value = (value as Record<string, unknown>)[part];
    }
  }
  const json = JSON.stringify(value, null, 2) ?? 'null';
  return { file: path.relative(workingDirectory, target) || path.basename(target), pointer: pointer ?? '', truncated: json.length > 50000, value: json.length > 50000 ? `${json.slice(0, 50000)}…（省略）` : value };
}

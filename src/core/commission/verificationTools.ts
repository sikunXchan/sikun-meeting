import * as fs from 'fs';
import * as path from 'path';

/**
 * 答えが一つに決まる検証（計算・表の読み取り）をAIの暗算や推測に任せないための道具。
 * ファイルの書き込み・コマンド実行・外部通信はしない。読めるのは作業フォルダと指定フォルダだけ。
 */

export const VERIFICATION_SERVER = 'sikun';
export const VERIFICATION_TOOL_NAMES = ['calculate', 'read_table'] as const;
export const VERIFICATION_TOOLS = VERIFICATION_TOOL_NAMES.map((name) => `mcp__${VERIFICATION_SERVER}__${name}`);

const MAX_EXPRESSIONS = 200;
const MAX_EXPRESSION_LENGTH = 2000;
const MAX_EXPONENT = 1000n;
const MAX_BITS = 8192;
const MAX_TABLE_BYTES = 20 * 1024 * 1024;
const MAX_TABLE_ROWS = 1000;
const MAX_TABLE_COLUMNS = 100;
const MAX_CELL_LENGTH = 500;

// ---- 厳密な有理数 ----

interface Rational { n: bigint; d: bigint }

const abs = (value: bigint) => (value < 0n ? -value : value);
function gcd(a: bigint, b: bigint): bigint {
  a = abs(a); b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error('0で割ることはできません');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  const result = { n: n / g, d: d / g };
  if (result.n.toString(2).length > MAX_BITS || result.d.toString(2).length > MAX_BITS) throw new Error('計算結果の桁数が大きすぎます');
  return result;
}
const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rational, b: Rational) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
const div = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
const compare = (a: Rational, b: Rational) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; };

function power(base: Rational, exponent: Rational): Rational {
  if (exponent.d !== 1n) throw new Error('べき乗の指数は整数にしてください');
  if (abs(exponent.n) > MAX_EXPONENT) throw new Error('べき乗の指数が大きすぎます');
  let result = rational(1n), e = abs(exponent.n), b = base;
  while (e > 0n) {
    if (e & 1n) result = mul(result, b);
    e >>= 1n;
    if (e) b = mul(b, b);
  }
  return exponent.n < 0n ? div(rational(1n), result) : result;
}

/** 小数点以下 digits 桁に丸める。mode は四捨五入（0から遠い側）・切り捨て（床）・切り上げ（天井）。 */
function roundTo(value: Rational, digits: bigint, mode: 'half' | 'floor' | 'ceil'): Rational {
  if (digits < 0n || digits > 20n) throw new Error('丸めの桁数は0〜20にしてください');
  const scale = 10n ** digits;
  const scaled = value.n * scale;
  let q = scaled / value.d; // 0方向への切り捨て
  const r = scaled % value.d;
  if (r !== 0n) {
    if (mode === 'floor' && value.n < 0n) q -= 1n;
    else if (mode === 'ceil' && value.n > 0n) q += 1n;
    else if (mode === 'half' && abs(r) * 2n >= value.d) q += value.n < 0n ? -1n : 1n;
  }
  return rational(q, scale);
}

function toDecimal(value: Rational, digits: number): string {
  const rounded = roundTo(value, BigInt(digits), 'half');
  const negative = rounded.n < 0n;
  const scale = 10n ** BigInt(digits);
  const scaled = abs(rounded.n) * (scale / rounded.d);
  let text = scaled.toString().padStart(digits + 1, '0');
  if (digits > 0) text = `${text.slice(0, -digits)}.${text.slice(-digits)}`.replace(/\.?0+$/, '');
  return `${negative && text !== '0' ? '-' : ''}${text}`;
}

function parseNumber(text: string): Rational {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`数値として読めません: ${text}`);
  const fraction = match[3] ?? '';
  const n = BigInt(match[2] + fraction) * (match[1] === '-' ? -1n : 1n);
  return rational(n, 10n ** BigInt(fraction.length));
}

// ---- 式の解析（evalは使わない） ----

type Token = { kind: 'number' | 'name' | 'op'; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+(?:\.\d+)?)|([\p{L}_][\p{L}\p{N}_]*)|(\*\*|[-+*/%^(),]))/uy;
  let index = 0;
  while (index < source.length) {
    if (/^\s*$/.test(source.slice(index))) break;
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new Error(`式を読めません（${index + 1}文字目付近）: ${source.slice(index, index + 20)}`);
    if (match[1] !== undefined) tokens.push({ kind: 'number', text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', text: match[2] });
    else tokens.push({ kind: 'op', text: match[3] === '**' ? '^' : match[3] });
    index = pattern.lastIndex;
  }
  return tokens;
}

const FUNCTIONS: Record<string, (args: Rational[]) => Rational> = {
  sum: (args) => args.reduce(add, rational(0n)),
  min: (args) => { if (!args.length) throw new Error('min には1つ以上の値が必要です'); return args.reduce((a, b) => (compare(a, b) <= 0 ? a : b)); },
  max: (args) => { if (!args.length) throw new Error('max には1つ以上の値が必要です'); return args.reduce((a, b) => (compare(a, b) >= 0 ? a : b)); },
  abs: ([x, ...rest]) => { if (!x || rest.length) throw new Error('abs の引数は1つです'); return rational(abs(x.n), x.d); },
  round: (args) => rounding(args, 'half', 'round'),
  floor: (args) => rounding(args, 'floor', 'floor'),
  ceil: (args) => rounding(args, 'ceil', 'ceil'),
};
function rounding(args: Rational[], mode: 'half' | 'floor' | 'ceil', name: string): Rational {
  if (args.length < 1 || args.length > 2) throw new Error(`${name} の引数は（値, 桁数）です`);
  const digits = args[1] ?? rational(0n);
  if (digits.d !== 1n) throw new Error(`${name} の桁数は整数にしてください`);
  return roundTo(args[0], digits.n, mode);
}

/** 優先順位: ( ) → 関数 → 後置% → ^（右結合）→ 単項± → * / → + - */
function evaluate(source: string, variables: Map<string, Rational>): Rational {
  const tokens = tokenize(source);
  let position = 0;
  const peek = () => tokens[position];
  const take = (text?: string) => {
    const token = tokens[position];
    if (!token || (text !== undefined && token.text !== text)) throw new Error(`式が不完全です${text ? `（「${text}」が必要）` : ''}`);
    position++;
    return token;
  };
  const expression = (): Rational => {
    let value = term();
    while (peek()?.kind === 'op' && (peek().text === '+' || peek().text === '-')) {
      const op = take().text;
      value = op === '+' ? add(value, term()) : sub(value, term());
    }
    return value;
  };
  const term = (): Rational => {
    let value = unary();
    while (peek()?.kind === 'op' && (peek().text === '*' || peek().text === '/')) {
      const op = take().text;
      value = op === '*' ? mul(value, unary()) : div(value, unary());
    }
    return value;
  };
  const unary = (): Rational => {
    if (peek()?.kind === 'op' && (peek().text === '-' || peek().text === '+')) {
      const op = take().text;
      const value = unary();
      return op === '-' ? rational(-value.n, value.d) : value;
    }
    return exponent();
  };
  const exponent = (): Rational => {
    const base = postfix();
    if (peek()?.kind === 'op' && peek().text === '^') { take(); return power(base, unary()); }
    return base;
  };
  const postfix = (): Rational => {
    let value = primary();
    while (peek()?.kind === 'op' && peek().text === '%') { take(); value = div(value, rational(100n)); }
    return value;
  };
  const primary = (): Rational => {
    const token = take();
    if (token.kind === 'number') return parseNumber(token.text);
    if (token.kind === 'op' && token.text === '(') { const value = expression(); take(')'); return value; }
    if (token.kind === 'name') {
      if (peek()?.text === '(') {
        const fn = FUNCTIONS[token.text];
        if (!fn) throw new Error(`使えない関数です: ${token.text}（使えるのは ${Object.keys(FUNCTIONS).join(', ')}）`);
        take('(');
        const args: Rational[] = [];
        if (peek()?.text !== ')') {
          args.push(expression());
          while (peek()?.text === ',') { take(','); args.push(expression()); }
        }
        take(')');
        return fn(args);
      }
      const value = variables.get(token.text);
      if (!value) throw new Error(`未定義の名前です: ${token.text}（先に name で定義した値だけを参照できます）`);
      return value;
    }
    throw new Error(`式を読めません: ${token.text}`);
  };
  if (!tokens.length) throw new Error('式が空です');
  const value = expression();
  if (position !== tokens.length) {
    if (tokens[position].text === ',') throw new Error('桁区切りのカンマは使えません（1,000 は 1000 と書いてください）');
    throw new Error(`式の途中に余分な記号があります: ${tokens[position].text}`);
  }
  return value;
}

export interface CalculationInput { name: string; expression: string }
export interface CalculationResult { name: string; expression: string; value: string; exact: boolean }

/**
 * 式を順に厳密計算する。前の結果は name で参照できる。
 * 例: [{name:'売上', expression:'120000*12'}, {name:'利益', expression:'売上 - 900000'}]
 */
export function calculate(items: CalculationInput[], decimals = 6): CalculationResult[] {
  if (!Array.isArray(items) || !items.length || items.length > MAX_EXPRESSIONS) throw new Error(`式は1〜${MAX_EXPRESSIONS}件にしてください`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 20) throw new Error('表示桁数は0〜20にしてください');
  const variables = new Map<string, Rational>();
  return items.map(({ name, expression }, index) => {
    if (typeof name !== 'string' || !/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) || name in FUNCTIONS) throw new Error(`${index + 1}件目の name が不正です`);
    if (variables.has(name)) throw new Error(`name が重複しています: ${name}`);
    if (typeof expression !== 'string' || expression.length > MAX_EXPRESSION_LENGTH) throw new Error(`${name} の式が長すぎます`);
    let value: Rational;
    try { value = evaluate(expression, variables); }
    catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
    variables.set(name, value);
    const exact = compare(roundTo(value, BigInt(decimals), 'half'), value) === 0;
    return { name, expression, value: toDecimal(value, decimals), exact };
  });
}

// ---- 表の読み取り ----

function inside(root: string, target: string): boolean {
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

function parseDelimited(text: string, delimiter: string): string[][] {
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

function cellText(value: unknown): string {
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
  const target = resolveReadable(file, workingDirectory, readableDirectories);
  const maxRows = options.maxRows ?? 200;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_TABLE_ROWS) throw new Error(`maxRows は1〜${MAX_TABLE_ROWS}にしてください`);
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
    const worksheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
    if (!worksheet) throw new Error(`シートがありません: ${options.sheet ?? '（先頭）'}。シート: ${sheets.join(', ')}`);
    sheet = worksheet.name;
    rows = [];
    worksheet.eachRow({ includeEmpty: true }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(Array.from(values, cellText)); // 空セルの穴も空文字にそろえる
    });
  } else throw new Error('読める表形式は .csv / .tsv / .xlsx です');
  rows = rows.map((row) => row.slice(0, MAX_TABLE_COLUMNS).map((cell) => cell.trim().slice(0, MAX_CELL_LENGTH)));
  const header = rows[0] ?? [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  const numericColumns = [];
  for (let column = 0; column < width; column++) {
    let total = rational(0n), numericCells = 0, otherCells = 0;
    for (const row of rows.slice(1)) {
      const raw = (row[column] ?? '').replace(/,/g, '');
      if (!raw) continue;
      try { total = add(total, parseNumber(raw)); numericCells++; } catch { otherCells++; }
    }
    if (numericCells) numericColumns.push({ column: column + 1, header: header[column] ?? '', total: toDecimal(total, 10), numericCells, otherCells });
  }
  return {
    file: path.relative(workingDirectory, target) || path.basename(target), sheet, sheets,
    totalRows: rows.length, truncated: rows.length > maxRows, rows: rows.slice(0, maxRows), numericColumns,
  };
}

// ---- Claude Agent SDK への登録 ----

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');
const importSdk = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<SdkModule>;

/**
 * ESM専用のSDKとzodを動的importし、案件の作業フォルダに限定した検証ツールを作る。
 * zod は @anthropic-ai/claude-agent-sdk の peerDependency（^4）で、SDKと同じ版を使う。
 */
export async function createVerificationServer(context: { workingDirectory: string; readableDirectories?: readonly string[] }) {
  const [{ createSdkMcpServer, tool }, { z }] = await Promise.all([importSdk('@anthropic-ai/claude-agent-sdk'), import('zod')]);
  const ok = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
  const fail = (error: unknown) => ({ content: [{ type: 'text' as const, text: `エラー: ${error instanceof Error ? error.message : String(error)}` }], isError: true });
  const readOnly = { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } };
  return createSdkMcpServer({
    name: VERIFICATION_SERVER,
    version: '1.0.0',
    tools: [
      tool('calculate',
        '数値を厳密に計算する（浮動小数の誤差なし）。式を順に評価し、前の結果は name で参照できる。演算子 + - * / ^ ( ) と後置%（=÷100）、関数 sum, min, max, abs, round(値,桁), floor(値,桁), ceil(値,桁)。金額・合計・率・感度分析・資金繰りなど、報告に書く数値は暗算せずこのツールで求める。',
        {
          items: z.array(z.object({
            name: z.string().describe('結果の名前。後の式で参照できる（例: 月次売上）'),
            expression: z.string().describe('計算式（例: 月次売上 * 12 - 初期費用）'),
          })).min(1).max(MAX_EXPRESSIONS),
          decimals: z.number().int().min(0).max(20).optional().describe('表示する小数桁（既定6）。exact=false は丸めた値'),
        },
        async (args) => { try { return ok(calculate(args.items, args.decimals ?? 6)); } catch (error) { return fail(error); } },
        readOnly),
      tool('read_table',
        '作業フォルダまたは参考資料フォルダの .csv / .tsv / .xlsx を読み、行データと数値列の厳密な合計を返す。xlsx の数式セルは保存済みの計算結果を返す。ファイルは変更しない。',
        {
          file: z.string().describe('作業フォルダからの相対パス、または参考資料の絶対パス'),
          sheet: z.string().optional().describe('xlsx のシート名（省略時は先頭）'),
          maxRows: z.number().int().min(1).max(MAX_TABLE_ROWS).optional().describe('返す最大行数（既定200）'),
        },
        async (args) => {
          try { return ok(await readTable(args.file, context.workingDirectory, context.readableDirectories ?? [], { sheet: args.sheet, maxRows: args.maxRows })); }
          catch (error) { return fail(error); }
        },
        readOnly),
    ],
  });
}

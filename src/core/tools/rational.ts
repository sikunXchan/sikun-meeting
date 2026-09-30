/**
 * 浮動小数の誤差なく計算するための有理数（BigInt の分子/分母）と、eval を使わない式の評価。
 * 答えが一つに決まる計算をAIの暗算に任せないためのツール群の土台。
 */
const MAX_EXPRESSIONS = 200;
const MAX_EXPRESSION_LENGTH = 2000;
const MAX_EXPONENT = 1000n;
const MAX_BITS = 8192;

// ---- 厳密な有理数 ----

export interface Rational { n: bigint; d: bigint }

export const abs = (value: bigint) => (value < 0n ? -value : value);
export function gcd(a: bigint, b: bigint): bigint {
  a = abs(a); b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
export function rational(n: bigint, d = 1n): Rational {
  if (d === 0n) throw new Error('0で割ることはできません');
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  const result = { n: n / g, d: d / g };
  if (result.n.toString(2).length > MAX_BITS || result.d.toString(2).length > MAX_BITS) throw new Error('計算結果の桁数が大きすぎます');
  return result;
}
export const add = (a: Rational, b: Rational) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Rational, b: Rational) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Rational, b: Rational) => rational(a.n * b.n, a.d * b.d);
export const div = (a: Rational, b: Rational) => rational(a.n * b.d, a.d * b.n);
export const compare = (a: Rational, b: Rational) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; };

export function power(base: Rational, exponent: Rational): Rational {
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
export function roundTo(value: Rational, digits: bigint, mode: 'half' | 'floor' | 'ceil'): Rational {
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

export function toDecimal(value: Rational, digits: number): string {
  const rounded = roundTo(value, BigInt(digits), 'half');
  const negative = rounded.n < 0n;
  const scale = 10n ** BigInt(digits);
  const scaled = abs(rounded.n) * (scale / rounded.d);
  let text = scaled.toString().padStart(digits + 1, '0');
  if (digits > 0) text = `${text.slice(0, -digits)}.${text.slice(-digits)}`.replace(/\.?0+$/, '');
  return `${negative && text !== '0' ? '-' : ''}${text}`;
}

export function parseNumber(text: string): Rational {
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
export function evaluate(source: string, variables: Map<string, Rational>): Rational {
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

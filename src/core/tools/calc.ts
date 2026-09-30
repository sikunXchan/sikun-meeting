import { add, compare, div, evaluate, mul, parseNumber, power, rational, roundTo, sub, toDecimal, type Rational } from './rational';

/**
 * 計算系ツール。答えが一つに決まる計算を厳密に行う。
 * 平方根・累乗根・内部収益率のように有理数で表せない値だけは近似値とし、結果に approximate を付ける。
 */

const MAX_VALUES = 10000;
const ZERO = rational(0n);

function num(value: unknown, label: string): Rational {
  if (typeof value === 'number' && Number.isFinite(value)) return parseNumber(String(value).includes('e') ? value.toFixed(20) : String(value));
  if (typeof value === 'string') {
    const text = value.normalize('NFKC').replace(/[,\s]/g, '');
    try { return parseNumber(text); } catch { /* 下で説明付きのエラーにする */ }
  }
  throw new Error(`${label} は数値にしてください（受け取った値: ${JSON.stringify(value)}）`);
}
function numbers(values: unknown, label: string): Rational[] {
  if (!Array.isArray(values) || !values.length || values.length > MAX_VALUES) throw new Error(`${label} は1〜${MAX_VALUES}個の数値の配列にしてください`);
  return values.map((value, i) => num(value, `${label}[${i}]`));
}
const out = (value: Rational, digits = 10) => toDecimal(value, digits);
const toFloat = (value: Rational) => Number(value.n) / Number(value.d);
const negate = (value: Rational) => rational(-value.n, value.d);

// ---- 統計 ----

/** 分位点は線形補間（Excel の PERCENTILE.INC と同じ定義）。 */
function percentile(sorted: Rational[], p: Rational): Rational {
  const position = mul(p, rational(BigInt(sorted.length - 1)));
  const lower = position.n / position.d;
  const fraction = sub(position, rational(lower));
  const base = sorted[Number(lower)];
  if (Number(lower) + 1 >= sorted.length) return base;
  return add(base, mul(fraction, sub(sorted[Number(lower) + 1], base)));
}

export function statistics(valuesInput: unknown, percentilesInput: unknown = [25, 50, 75]) {
  const values = numbers(valuesInput, 'values');
  const sorted = [...values].sort(compare);
  const count = values.length;
  const sum = values.reduce(add, ZERO);
  const mean = div(sum, rational(BigInt(count)));
  const squares = values.reduce((total, value) => add(total, mul(sub(value, mean), sub(value, mean))), ZERO);
  const percentiles = (Array.isArray(percentilesInput) ? percentilesInput : []).map((p) => {
    const value = num(p, 'percentiles');
    if (compare(value, ZERO) < 0 || compare(value, rational(100n)) > 0) throw new Error('percentiles は0〜100にしてください');
    return { percentile: out(value, 6), value: out(percentile(sorted, div(value, rational(100n)))) };
  });
  const variance = (divisor: number) => (divisor > 0 ? div(squares, rational(BigInt(divisor))) : undefined);
  const population = variance(count), sample = variance(count - 1);
  return {
    count, sum: out(sum), mean: out(mean), median: out(percentile(sorted, rational(1n, 2n))),
    min: out(sorted[0]), max: out(sorted[count - 1]),
    populationVariance: population ? out(population) : null,
    sampleVariance: sample ? out(sample) : null,
    populationStdDev: population ? { value: Math.sqrt(toFloat(population)).toPrecision(12), approximate: true } : null,
    sampleStdDev: sample ? { value: Math.sqrt(toFloat(sample)).toPrecision(12), approximate: true } : null,
    percentiles,
  };
}

// ---- 増減率 ----

export function growthRate(fromInput: unknown, toInput: unknown, periodsInput?: unknown) {
  const from = num(fromInput, 'from'), to = num(toInput, 'to');
  const change = sub(to, from);
  const result: Record<string, unknown> = { change: out(change) };
  if (from.n === 0n) result.percentChange = null;
  else result.percentChange = out(mul(div(change, rational(from.n < 0n ? -from.n : from.n, from.d)), rational(100n)), 6);
  if (periodsInput !== undefined) {
    const periods = num(periodsInput, 'periods');
    if (compare(periods, ZERO) <= 0) throw new Error('periods は正の数にしてください');
    if (from.n <= 0n || to.n < 0n) result.cagr = null;
    else {
      const ratio = toFloat(div(to, from));
      result.cagr = { percent: ((Math.pow(ratio, 1 / toFloat(periods)) - 1) * 100).toPrecision(12), approximate: true };
    }
  }
  return result;
}

// ---- 正味現在価値・内部収益率 ----

/** cashflows[0] は期首（割引なし）、以降は各期末。rate は1期あたりの率（%）。 */
export function npvIrr(cashflowsInput: unknown, ratePercentInput?: unknown) {
  const flows = numbers(cashflowsInput, 'cashflows');
  const result: Record<string, unknown> = { periods: flows.length - 1, total: out(flows.reduce(add, ZERO)) };
  if (ratePercentInput !== undefined) {
    const rate = div(num(ratePercentInput, 'ratePercent'), rational(100n));
    const factor = add(rational(1n), rate);
    if (factor.n === 0n) throw new Error('ratePercent に -100 は使えません');
    let npv = ZERO, discount = rational(1n);
    for (const flow of flows) { npv = add(npv, div(flow, discount)); discount = mul(discount, factor); }
    result.npv = out(npv, 6);
  }
  // 内部収益率: NPV(r)=0 を二分法で解く。符号が変わらない場合は解なし。
  const f = (r: number) => flows.reduce((total, flow, i) => total + toFloat(flow) / Math.pow(1 + r, i), 0);
  let low = -0.9999, high = 10;
  if (Math.sign(f(low)) === Math.sign(f(high))) result.irr = null;
  else {
    for (let i = 0; i < 200; i++) {
      const mid = (low + high) / 2;
      if (Math.sign(f(mid)) === Math.sign(f(low))) low = mid; else high = mid;
    }
    result.irr = { percent: (((low + high) / 2) * 100).toPrecision(10), approximate: true };
  }
  return result;
}

// ---- ローン返済 ----

/** 元利均等返済。annualRatePercent を12で割った月利で、months 回払いの毎月返済額と総利息を返す。 */
export function loanPayment(principalInput: unknown, annualRatePercentInput: unknown, monthsInput: unknown, roundDigitsInput: unknown = 0) {
  const principal = num(principalInput, 'principal');
  const months = num(monthsInput, 'months');
  if (months.d !== 1n || months.n < 1n || months.n > 1200n) throw new Error('months は1〜1200の整数にしてください');
  const roundDigits = num(roundDigitsInput, 'roundDigits');
  if (roundDigits.d !== 1n || roundDigits.n < 0n || roundDigits.n > 6n) throw new Error('roundDigits は0〜6の整数にしてください');
  const monthlyRate = div(num(annualRatePercentInput, 'annualRatePercent'), rational(1200n));
  const exact = monthlyRate.n === 0n ? div(principal, months)
    : div(mul(principal, monthlyRate), sub(rational(1n), power(add(rational(1n), monthlyRate), negate(months))));
  const payment = roundTo(exact, roundDigits.n, 'half');
  // 丸めた返済額で残高を追い、最終回で端数を調整する（実務の返済予定表と同じ扱い）。
  let balance = principal, interestTotal = ZERO;
  for (let i = 1n; i <= months.n; i++) {
    const interest = roundTo(mul(balance, monthlyRate), roundDigits.n, 'half');
    interestTotal = add(interestTotal, interest);
    balance = i === months.n ? ZERO : sub(balance, sub(payment, interest));
  }
  return {
    monthlyPayment: out(payment, 6), exactMonthlyPayment: out(exact, 10),
    totalInterest: out(interestTotal, 6), totalPaid: out(add(principal, interestTotal), 6),
    note: '各月の利息を指定桁で丸め、最終回で残高を精算した場合の総利息',
  };
}

// ---- 感度分析 ----

/** base の変数で式を計算し、vary に挙げた変数を1つずつ（または2変数の組み合わせで）変えた結果の表を返す。 */
export function sensitivityTable(expression: unknown, baseInput: unknown, varyInput: unknown, decimals = 6) {
  if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression を指定してください');
  if (!baseInput || typeof baseInput !== 'object') throw new Error('base は {名前: 値} にしてください');
  const base = new Map(Object.entries(baseInput as Record<string, unknown>).map(([name, value]) => [name, num(value, name)] as [string, Rational]));
  const vary = (Array.isArray(varyInput) ? varyInput : []) as { name: string; values: unknown[] }[];
  if (!vary.length || vary.length > 2) throw new Error('vary は1つか2つの変数にしてください（例: [{name:"単価", values:[900,1000,1100]}]）');
  for (const item of vary) if (!base.has(item.name)) throw new Error(`vary の ${item.name} が base にありません`);
  const run = (overrides: [string, Rational][]) => out(evaluate(expression, new Map([...base, ...overrides])), decimals);
  const baseValue = run([]);
  const [first, second] = vary.map((item) => ({ name: item.name, values: numbers(item.values, item.name) }));
  if (!second) return { expression, base: baseValue, rows: first.values.map((value) => ({ [first.name]: out(value, decimals), result: run([[first.name, value]]) })) };
  return {
    expression, base: baseValue, rowVariable: first.name, columnVariable: second.name,
    columns: second.values.map((value) => out(value, decimals)),
    rows: first.values.map((a) => ({ [first.name]: out(a, decimals), results: second.values.map((b) => run([[first.name, a], [second.name, b]])) })),
  };
}

// ---- 単位換算 ----

const UNITS: Record<string, Record<string, string>> = {
  length: { mm: '0.001', cm: '0.01', m: '1', km: '1000', in: '0.0254', ft: '0.3048', yd: '0.9144', mi: '1609.344' },
  mass: { mg: '0.000001', g: '0.001', kg: '1', t: '1000', oz: '0.028349523125', lb: '0.45359237' },
  area: { m2: '1', km2: '1000000', ha: '10000', a: '100', ft2: '0.09290304', 坪: '400/121' },
  volume: { ml: '0.001', l: '1', m3: '1000', gal_us: '3.785411784' },
  time: { s: '1', min: '60', h: '3600', day: '86400', week: '604800' },
  data: { B: '1', KB: '1000', MB: '1000000', GB: '1000000000', TB: '1000000000000', KiB: '1024', MiB: '1048576', GiB: '1073741824', TiB: '1099511627776' },
  energy: { J: '1', kJ: '1000', MJ: '1000000', GJ: '1000000000', Wh: '3600', kWh: '3600000', MWh: '3600000000', kcal: '4184' },
};

export function unitConvert(valueInput: unknown, from: unknown, to: unknown) {
  const value = num(valueInput, 'value');
  if (typeof from !== 'string' || typeof to !== 'string') throw new Error('from / to に単位を指定してください');
  const temperature: Record<string, [Rational, Rational]> = { // 摂氏 = (値 + a) × b
    C: [ZERO, rational(1n)], F: [rational(-32n), rational(5n, 9n)], K: [parseNumber('-273.15'), rational(1n)],
  };
  if (temperature[from] || temperature[to]) {
    if (!temperature[from] || !temperature[to]) throw new Error('温度は C / F / K どうしで換算してください');
    const celsius = mul(add(value, temperature[from][0]), temperature[from][1]);
    return { value: out(value), from, to, result: out(sub(div(celsius, temperature[to][1]), temperature[to][0])), category: 'temperature' };
  }
  const category = Object.keys(UNITS).find((key) => UNITS[key][from] && UNITS[key][to]);
  if (!category) throw new Error(`換算できない組み合わせです: ${from} → ${to}。使える単位: ${Object.entries(UNITS).map(([key, units]) => `${key}(${Object.keys(units).join('/')})`).join(', ')}, temperature(C/F/K)`);
  const factorOf = (text: string) => { const [a, b = '1'] = text.split('/'); return div(parseNumber(a), parseNumber(b)); };
  const factor = div(factorOf(UNITS[category][from]), factorOf(UNITS[category][to]));
  return { value: out(value), from, to, result: out(mul(value, factor)), category, note: from === '坪' || to === '坪' ? '1坪 = 400/121 m²（約3.3058）で換算' : undefined };
}

// ---- 日付 ----

const DAY = 86400000;
function parseDate(value: unknown, label: string): Date {
  if (typeof value !== 'string') throw new Error(`${label} は YYYY-MM-DD にしてください`);
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value.normalize('NFKC').trim());
  if (!match) throw new Error(`${label} は YYYY-MM-DD にしてください: ${value}`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) throw new Error(`存在しない日付です: ${value}`);
  return date;
}
const iso = (date: Date) => date.toISOString().slice(0, 10);
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const endOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0));

function addMonths(date: Date, months: number): Date {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const last = endOfMonth(target.getUTCFullYear(), target.getUTCMonth()).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), last)));
}

/**
 * 日付の計算。祝日はデータを持たないため、営業日の計算で祝日を除く場合は holidays に日付を渡す。
 * operation: between（期間・営業日数）/ add（日数・月数・営業日を加算）/ info（曜日・月末・年齢）
 */
export function dateCalc(input: { operation: string; start?: string; end?: string; date?: string; days?: number; months?: number; businessDays?: number; holidays?: string[]; asOf?: string }) {
  const holidays = new Set((input.holidays ?? []).map((value, i) => iso(parseDate(value, `holidays[${i}]`))));
  const isBusinessDay = (date: Date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6 && !holidays.has(iso(date));
  const notes = holidays.size ? [`祝日として${holidays.size}日を除外`] : ['祝日は除外していない（土日のみ除外）'];
  if (input.operation === 'between') {
    const start = parseDate(input.start, 'start'), end = parseDate(input.end, 'end');
    const days = Math.round((end.getTime() - start.getTime()) / DAY);
    let business = 0;
    const [from, to] = days >= 0 ? [start, end] : [end, start];
    for (let t = from.getTime() + DAY; t <= to.getTime(); t += DAY) if (isBusinessDay(new Date(t))) business++;
    let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
    if (days >= 0 && end.getUTCDate() < start.getUTCDate() && end.getUTCDate() !== endOfMonth(end.getUTCFullYear(), end.getUTCMonth()).getUTCDate()) months--;
    return { start: iso(start), end: iso(end), days, daysInclusive: days >= 0 ? days + 1 : days - 1, businessDaysAfterStart: days >= 0 ? business : -business, fullMonths: months, notes: [...notes, '営業日数は開始日を含まず終了日を含む'] };
  }
  if (input.operation === 'add') {
    let date = parseDate(input.date ?? input.start, 'date');
    if (input.months !== undefined) { if (!Number.isInteger(input.months)) throw new Error('months は整数にしてください'); date = addMonths(date, input.months); }
    if (input.days !== undefined) { if (!Number.isInteger(input.days)) throw new Error('days は整数にしてください'); date = new Date(date.getTime() + input.days * DAY); }
    if (input.businessDays !== undefined) {
      if (!Number.isInteger(input.businessDays) || Math.abs(input.businessDays) > 10000) throw new Error('businessDays は整数にしてください');
      const step = input.businessDays >= 0 ? 1 : -1;
      for (let remaining = Math.abs(input.businessDays); remaining > 0;) { date = new Date(date.getTime() + step * DAY); if (isBusinessDay(date)) remaining--; }
    }
    return { result: iso(date), weekday: WEEKDAYS[date.getUTCDay()], notes: input.months !== undefined ? [...notes, '月の加算で日が存在しない場合は月末にそろえる'] : notes };
  }
  if (input.operation === 'info') {
    const date = parseDate(input.date ?? input.start, 'date');
    const result: Record<string, unknown> = {
      date: iso(date), weekday: WEEKDAYS[date.getUTCDay()], businessDay: isBusinessDay(date),
      endOfMonth: iso(endOfMonth(date.getUTCFullYear(), date.getUTCMonth())),
      dayOfYear: Math.round((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY) + 1,
    };
    if (input.asOf) {
      const asOf = parseDate(input.asOf, 'asOf');
      let age = asOf.getUTCFullYear() - date.getUTCFullYear();
      if (asOf.getUTCMonth() < date.getUTCMonth() || (asOf.getUTCMonth() === date.getUTCMonth() && asOf.getUTCDate() < date.getUTCDate())) age--;
      result.ageAsOf = { asOf: iso(asOf), years: age };
    }
    return { ...result, notes };
  }
  throw new Error('operation は between / add / info のいずれかにしてください');
}

import { calculate } from './rational';
import { dateCalc, growthRate, loanPayment, npvIrr, sensitivityTable, statistics, unitConvert } from './calc';
import { describeTable, queryTable, readStructured, readTable, reconcileTables, validateTable } from './data';
import { listCriteria, recordCriterion } from './review';

/**
 * アプリ同梱のMCPツール一覧。どれも答えが一つに決まる検証用で、ファイル書き込み（確認記録を除く）・
 * コマンド実行・外部通信を持たない。ClaudeとCodexの双方へ同じ stdio サーバーとして渡す。
 */

export interface ToolContext { workingDirectory: string; readableDirectories: string[]; reviewFile?: string }
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>, context: ToolContext) => unknown | Promise<unknown>;
}
export type ToolGroup = 'calc' | 'data' | 'review';

const str = (description: string) => ({ type: 'string', description });
const int = (description: string, minimum?: number, maximum?: number) => ({ type: 'integer', description, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
const numOrStr = (description: string) => ({ type: ['number', 'string'], description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const file = str('作業フォルダからの相対パス、または参考資料の絶対パス（.csv / .tsv / .xlsx）');
const sheet = str('xlsx のシート名（省略時は先頭）');

export const TOOL_GROUPS: Record<ToolGroup, ToolDefinition[]> = {
  calc: [
    {
      name: 'calculate',
      description: '数値を厳密に計算する（浮動小数の誤差なし）。式を順に評価し、前の結果は name で参照できる。演算子 + - * / ^ ( ) と後置%（=÷100）、関数 sum, min, max, abs, round(値,桁), floor(値,桁), ceil(値,桁)。金額・合計・率・資金繰りなど、報告に書く数値は暗算せずこのツールで求める。',
      inputSchema: object({
        items: { type: 'array', minItems: 1, maxItems: 200, items: object({ name: str('結果の名前。後の式で参照できる（例: 月次売上）'), expression: str('計算式（例: 月次売上 * 12 - 初期費用）') }, ['name', 'expression']) },
        decimals: int('表示する小数桁（既定6）。exact=false は丸めた値', 0, 20),
      }, ['items']),
      handler: (args) => calculate(args.items, args.decimals ?? 6),
    },
    {
      name: 'describe_statistics',
      description: '数値の並びの件数・合計・平均・中央値・最小・最大・分散・標準偏差・分位点（Excel の PERCENTILE.INC と同じ定義）を求める。標準偏差だけは近似値。',
      inputSchema: object({ values: { type: 'array', items: numOrStr('数値'), minItems: 1 }, percentiles: { type: 'array', items: { type: 'number' }, description: '求める分位点（0〜100。既定 25, 50, 75）' } }, ['values']),
      handler: (args) => statistics(args.values, args.percentiles),
    },
    {
      name: 'growth_rate',
      description: '2つの値の増減額・増減率（%）と、periods を指定したときの年平均成長率（CAGR、近似値）を求める。前年比・前月比・伸び率の確認に使う。',
      inputSchema: object({ from: numOrStr('比較元の値'), to: numOrStr('比較先の値'), periods: numOrStr('CAGR の期間数（年数など。省略可）') }, ['from', 'to']),
      handler: (args) => growthRate(args.from, args.to, args.periods),
    },
    {
      name: 'npv_irr',
      description: 'キャッシュフローの正味現在価値（NPV、厳密）と内部収益率（IRR、近似値）を求める。cashflows[0] は期首の投資（通常は負の値）、以降は各期末の入出金。',
      inputSchema: object({ cashflows: { type: 'array', items: numOrStr('各期の入出金'), minItems: 2 }, ratePercent: numOrStr('割引率（1期あたりの%）。NPV を求めるときに指定') }, ['cashflows']),
      handler: (args) => npvIrr(args.cashflows, args.ratePercent),
    },
    {
      name: 'loan_payment',
      description: '元利均等返済の毎月返済額・総利息・総支払額を求める。年利を12で割った月利で計算し、各月の利息を指定桁で丸める。',
      inputSchema: object({ principal: numOrStr('借入額'), annualRatePercent: numOrStr('年利（%）'), months: int('返済回数（月）', 1, 1200), roundDigits: int('円未満などの丸め桁（既定0）', 0, 6) }, ['principal', 'annualRatePercent', 'months']),
      handler: (args) => loanPayment(args.principal, args.annualRatePercent, args.months, args.roundDigits ?? 0),
    },
    {
      name: 'sensitivity_table',
      description: '基準値で式を計算し、1つまたは2つの変数を変えたときの結果の表を作る（感度分析・シナリオ比較）。式の書き方は calculate と同じ。',
      inputSchema: object({
        expression: str('計算式（例: (単価 - 原価) * 数量 - 固定費）'),
        base: { type: 'object', additionalProperties: numOrStr('値'), description: '変数の基準値（例: {"単価":1000,"原価":600,"数量":500,"固定費":100000}）' },
        vary: { type: 'array', minItems: 1, maxItems: 2, items: object({ name: str('変える変数名'), values: { type: 'array', items: numOrStr('値'), minItems: 1 } }, ['name', 'values']) },
        decimals: int('表示する小数桁（既定6）', 0, 20),
      }, ['expression', 'base', 'vary']),
      handler: (args) => sensitivityTable(args.expression, args.base, args.vary, args.decimals ?? 6),
    },
    {
      name: 'convert_units',
      description: '物理量の単位を厳密に換算する（長さ・重さ・面積（坪を含む）・体積・時間・データ量・エネルギー（kWh/MJ/kcal）・温度）。通貨の換算はしない。',
      inputSchema: object({ value: numOrStr('値'), from: str('換算元の単位（例: kWh, 坪, lb, F）'), to: str('換算先の単位（例: MJ, m2, kg, C）') }, ['value', 'from', 'to']),
      handler: (args) => unitConvert(args.value, args.from, args.to),
    },
    {
      name: 'calculate_dates',
      description: '日付を計算する。between: 2つの日付の日数・営業日数・経過月数。add: 日数・月数・営業日を加算した日付（支払期日・納期）。info: 曜日・月末・年齢。祝日のデータは持たないので、除外する祝日は holidays に渡す。',
      inputSchema: object({
        operation: { type: 'string', enum: ['between', 'add', 'info'] },
        start: str('開始日 YYYY-MM-DD（between）'), end: str('終了日 YYYY-MM-DD（between）'), date: str('基準日 YYYY-MM-DD（add / info）'),
        days: int('加算する日数（負の値も可）'), months: int('加算する月数（負の値も可）'), businessDays: int('加算する営業日数（土日と holidays を除く）'),
        holidays: { type: 'array', items: str('除外する祝日 YYYY-MM-DD') }, asOf: str('年齢を求める基準日 YYYY-MM-DD（info）'),
      }, ['operation']),
      handler: (args) => dateCalc(args as Parameters<typeof dateCalc>[0]),
    },
  ],
  data: [
    {
      name: 'read_table',
      description: '作業フォルダまたは参考資料フォルダの .csv / .tsv / .xlsx を読み、行データと数値列の厳密な合計を返す。xlsx の数式セルは保存済みの計算結果を返す。',
      inputSchema: object({ file, sheet, maxRows: int('返す最大行数（既定200）', 1, 1000) }, ['file']),
      handler: (args, context) => readTable(args.file, context.workingDirectory, context.readableDirectories, { sheet: args.sheet, maxRows: args.maxRows }),
    },
    {
      name: 'describe_table',
      description: '表の各列の型（数値・文字・混在）、空欄数、値の種類数、数値の最小と最大、値の例を返す。計算や照合の前に表の構造を把握するために使う。',
      inputSchema: object({ file, sheet }, ['file']),
      handler: (args, context) => describeTable(args.file, context.workingDirectory, context.readableDirectories, args.sheet),
    },
    {
      name: 'query_table',
      description: '表の行を条件で絞り込み、列でグループ化して合計・件数・平均・最小・最大を厳密に集計する（ピボット集計）。例: 部門ごとの費用合計、3月の売上件数。',
      inputSchema: object({
        file, sheet,
        filters: { type: 'array', items: object({ column: str('列名（または1始まりの列番号）'), op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'contains', 'empty', 'not_empty'] }, value: str('比較する値') }, ['column', 'op']) },
        groupBy: { type: 'array', items: str('グループ化する列名') },
        aggregates: { type: 'array', items: object({ column: str('集計する列名'), fn: { type: 'string', enum: ['sum', 'count', 'avg', 'min', 'max'] } }, ['column', 'fn']) },
        maxRows: int('返す最大行数（既定200）', 1, 1000),
      }, ['file']),
      handler: (args, context) => queryTable(args.file, context.workingDirectory, context.readableDirectories, args),
    },
    {
      name: 'reconcile_tables',
      description: '2つの表をキー列で突き合わせ、片方にしかない行、比較列の値が異なる行と差額、列の合計差、重複キーを返す。証憑と帳簿、発注と納品、在庫の帳簿と実数の照合に使う。',
      inputSchema: object({
        left: str('1つ目の表（.csv / .tsv / .xlsx）'), right: str('2つ目の表'), leftSheet: sheet, rightSheet: sheet,
        key: { type: 'array', items: str('キー列名（両方の表で同じ名前）'), minItems: 1 },
        compare: { type: 'array', items: str('値を比べる列名（両方の表で同じ名前）') },
        maxRows: int('各一覧の最大件数（既定200）', 1, 1000),
      }, ['left', 'right', 'key', 'compare']),
      handler: (args, context) => reconcileTables(args as Parameters<typeof reconcileTables>[0], context.workingDirectory, context.readableDirectories),
    },
    {
      name: 'validate_table',
      description: '表を規則で検査し、問題のある行番号を返す。規則: 必須（空欄禁止）、型（number / date / text）、重複禁止、最小値・最大値、正規表現の形式。入力データの品質確認に使う。',
      inputSchema: object({
        file, sheet,
        rules: { type: 'array', minItems: 1, items: object({ column: str('列名'), required: { type: 'boolean' }, type: { type: 'string', enum: ['number', 'date', 'text'] }, unique: { type: 'boolean' }, min: str('最小値'), max: str('最大値'), pattern: str('正規表現（200文字まで）') }, ['column']) },
      }, ['file', 'rules']),
      handler: (args, context) => validateTable(args.file, context.workingDirectory, context.readableDirectories, args.rules, args.sheet),
    },
    {
      name: 'read_structured_data',
      description: '作業フォルダまたは参考資料フォルダの JSON / YAML を読み、全体またはドット区切りのパス（例: items.0.price）の値を返す。設定ファイルやAPIの応答例の確認に使う。',
      inputSchema: object({ file: str('.json / .yaml / .yml のパス'), path: str('取り出す値のパス（省略時は全体）') }, ['file']),
      handler: (args, context) => readStructured(args.file, context.workingDirectory, context.readableDirectories, args.path),
    },
  ],
  review: [
    {
      name: 'record_criterion',
      description: '受け入れ条件1件ごとの判定（pass / fail / unverified）と証拠を記録する。同じ id を再記録すると上書き。pass には証拠が必須。fail か unverified が1件でも残ると、アプリは承認を差し戻す。',
      inputSchema: object({ id: str('条件の識別子（例: AC-01）'), criterion: str('受け入れ条件の内容'), result: { type: 'string', enum: ['pass', 'fail', 'unverified'] }, evidence: str('根拠: 実行したコマンドと結果、ツールの出力、確認したファイルと箇所') }, ['id', 'criterion', 'result']),
      handler: (args, context) => recordCriterion(context.reviewFile, args),
    },
    {
      name: 'list_criteria',
      description: 'これまでに記録した受け入れ条件の判定と、pass / fail / unverified の件数を返す。承認を判断する前に全条件が記録済みか確認する。',
      inputSchema: object({}),
      handler: (_args, context) => listCriteria(context.reviewFile),
    },
  ],
};

/** 1つのstdioプロセスで、段階に応じたグループのツールだけを公開する。 */
export const SERVER_NAME = 'sikun';

/** 段階ごとに接続するサーバー。確認の記録は確認役の段階だけ。 */
export function toolGroupsFor(phase: string): ToolGroup[] {
  if (phase === 'work') return ['calc', 'data'];
  if (phase === 'review' || phase === 'goal_check' || phase === 'kgi_check') return ['calc', 'data', 'review'];
  return [];
}

export function toolNamesFor(phase: string): string[] {
  return toolGroupsFor(phase).flatMap((group) => TOOL_GROUPS[group].map((tool) => `mcp__${SERVER_NAME}__${tool.name}`));
}

/** 検証ツールの使い方。ClaudeとCodexで同じ文面を使う。 */
export function verificationGuide(phase: string): string {
  const names = toolNamesFor(phase);
  if (!names.length) return '';
  const review = names.some((name) => name.endsWith('__record_criterion'));
  return '\n検証ツール（sikun）: 計算は calculate・describe_statistics・growth_rate・npv_irr・loan_payment・sensitivity_table・convert_units・calculate_dates、表は read_table・describe_table・query_table・reconcile_tables・validate_table・read_structured_data。報告に書く金額・合計・率・件数・日付は暗算せずツールで求め、報告の数値をツールの結果と照合する。ツールで確かめていない数値は未検算と明記する。'
    + (review ? '確認では受け入れ条件ごとに record_criterion で pass / fail / unverified と証拠を記録し、list_criteria で漏れがないか確かめてから判定する。fail か unverified が残る場合は承認しない。' : '');
}

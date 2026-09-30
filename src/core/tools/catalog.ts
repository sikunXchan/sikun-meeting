import { calculate } from './rational';
import { dateCalc, growthRate, loanPayment, npvIrr, sensitivityTable, statistics, unitConvert } from './calc';
import { describeTable, queryTable, readStructured, readTable, reconcileTables, validateTable } from './data';
import { listCriteria, recordCriterion } from './review';
import { checkLinks, checkPlaceholders, checkTerms, documentOutline, extractText, findQuote, textDiff, textStats } from './docs';
import { colorContrast, colorPalette, compareColors, compareImages, imageInfo, optimizeSvg } from './design';
import { auditAccessibility, checkDesignPatterns, checkLayout, screenshotPage } from './browser';
import { compareVersions, explainCron, testRegex, validateConfig, validateJsonSchema } from './code';
import { listSources, recordSource } from './sources';
import { lookupUxPrinciples } from './knowledge';

/**
 * アプリ同梱のMCPツール一覧。どれも答えが一つに決まる検証用で、ファイル書き込み（確認記録を除く）・
 * コマンド実行・外部通信を持たない。ClaudeとCodexの双方へ同じ stdio サーバーとして渡す。
 */

export interface ToolContext { workingDirectory: string; readableDirectories: string[]; reviewFile?: string; sourcesFile?: string }
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, any>, context: ToolContext) => unknown | Promise<unknown>;
}
export type ToolGroup = 'calc' | 'data' | 'docs' | 'design' | 'browser' | 'code' | 'knowledge' | 'sources' | 'review';

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
  docs: [
    {
      name: 'extract_text',
      description: 'PDF・Word（.docx）・HTML・Markdown・テキストから本文を取り出す（PDFはページ区切り付き）。長い場合は offset で続きを読む。資料の内容確認や引用の前に使う。',
      inputSchema: object({ file: str('作業フォルダからの相対パス、または参考資料の絶対パス'), offset: int('読み始める文字位置（既定0。nextOffset を渡すと続き）', 0) }, ['file']),
      handler: (args, context) => extractText(args.file, context, args.offset ?? 0),
    },
    {
      name: 'text_diff',
      description: '2つの文章（ファイルまたは文字列）の差分を、行・単語・文字の単位で返す。修正前後の比較、原文と訳文・契約書の版の比較、指摘が反映されたかの確認に使う。',
      inputSchema: object({
        before: object({ file: str('ファイル（pdf・docx・html・md・txt など）'), text: str('文字列') }), after: object({ file: str('ファイル'), text: str('文字列') }),
        unit: { type: 'string', enum: ['lines', 'words', 'chars'], description: '比較の単位（既定 lines）' },
      }, ['before', 'after']),
      handler: (args, context) => textDiff(args.before, args.after, context, args.unit ?? 'lines'),
    },
    {
      name: 'find_quote',
      description: '引用した文が資料に実在するかを確かめる。全角/半角・空白・改行の違いは正規化して探し、見つからなければ最も近い箇所と一致度を返す。報告の引用・数値の出典確認に使う。',
      inputSchema: object({ file: str('資料のファイル（pdf・docx・html・md・txt など）'), quote: str('確かめる引用文（4文字以上）') }, ['file', 'quote']),
      handler: (args, context) => findQuote(args.file, args.quote, context),
    },
    {
      name: 'text_statistics',
      description: '文章の文字数・行数・段落数・文の数と平均の長さ・長い文の一覧・80字超の文の数・漢字とカタカナの比率・読む時間の目安を返す。読みやすさの確認や文字数制限の確認に使う。',
      inputSchema: object({ file: str('ファイル'), text: str('文字列（file の代わり）') }),
      handler: (args, context) => textStats(args, context),
    },
    {
      name: 'check_placeholders',
      description: '翻訳の前後で変数（{name}・{{x}}・%s・%1$d・${x}）とタグが同じかを調べる。JSONの翻訳ファイルならキーの過不足・空の訳・未翻訳らしい訳も調べる。',
      inputSchema: object({ source: object({ file: str('原文（.json の翻訳ファイルや文章）'), text: str('原文の文字列') }), target: object({ file: str('訳文'), text: str('訳文の文字列') }) }, ['source', 'target']),
      handler: (args, context) => checkPlaceholders(args.source, args.target, context),
    },
    {
      name: 'check_links',
      description: 'Markdown / HTML のローカルリンク・画像の参照先が存在するか、#見出し・id のアンカーが実在するかを調べる。外部URLは一覧にするだけで接続しない。',
      inputSchema: object({ file: str('.md / .html のファイル') }, ['file']),
      handler: (args, context) => checkLinks(args.file, context),
    },
    {
      name: 'document_outline',
      description: '文書の見出しの構成（階層・行番号）を返し、階層の飛び（h2→h4）・h1の数・重複した見出しを指摘する。マニュアルや報告書の構成確認に使う。',
      inputSchema: object({ file: str('.md / .html / .docx / .pdf などのファイル') }, ['file']),
      handler: (args, context) => documentOutline(args.file, context),
    },
    {
      name: 'check_terms',
      description: '用語集にある表記の揺れ（例: ユーザー / ユーザ、ログイン / サインイン）の出現を行番号付きで返し、全角英数字を含む行も示す。用語の統一の確認に使う。',
      inputSchema: object({
        file: str('ファイル'), text: str('文字列（file の代わり）'),
        terms: { type: 'array', minItems: 1, items: object({ preferred: str('使う表記'), variants: { type: 'array', items: str('揺れとして探す表記') } }, ['preferred', 'variants']) },
      }, ['terms']),
      handler: (args, context) => checkTerms(args, args.terms, context),
    },
  ],
  design: [
    {
      name: 'color_contrast',
      description: '文字色と背景色のコントラスト比（WCAG 2.2）と、通常文字・大きい文字・UI部品の AA / AAA の合否を返す。半透明の文字色は背景と合成して測る。',
      inputSchema: object({ foreground: str('文字・前景の色（#hex, rgb(), hsl(), oklch(), 色名）'), background: str('背景色（不透明）') }, ['foreground', 'background']),
      handler: (args) => colorContrast(args.foreground, args.background),
    },
    {
      name: 'color_palette',
      description: '基準色から明るさの段階（100〜900 など）を OKLCH で作り、各色に白・黒の文字を載せたときのコントラストと読みやすい文字色を返す。配色やデザイントークンの作成に使う。',
      inputSchema: object({ base: str('基準色'), steps: int('段階の数（既定9）', 3, 15) }, ['base']),
      handler: (args) => colorPalette(args.base, args.steps ?? 9),
    },
    {
      name: 'compare_colors',
      description: '複数の色の全組み合わせのコントラスト比と色差（CIEDE2000）を返す。見分けにくい色（グラフ・状態表示）や、読めない文字色の組み合わせを見つける。',
      inputSchema: object({ colors: { type: 'array', minItems: 2, maxItems: 30, items: { anyOf: [str('色'), object({ name: str('名前'), color: str('色') }, ['color'])] } } }, ['colors']),
      handler: (args) => compareColors(args.colors),
    },
    {
      name: 'image_info',
      description: '画像の形式・幅と高さ・縦横比・容量・透過の有無と、PNG / JPEG の主要な色（上位8色）・平均色を返す。書き出しサイズやブランド色の確認に使う。',
      inputSchema: object({ file: str('画像ファイル（png・jpg・gif・webp・svg など）') }, ['file']),
      handler: (args, context) => imageInfo(args.file, context),
    },
    {
      name: 'compare_images',
      description: '同じ大きさの2枚の画像（PNG / JPEG）を比べ、変化したピクセルの数と割合、変化箇所を赤で示した画像を返す。修正前後の見た目の差（screenshot_page で撮った画像など）の確認に使う。',
      inputSchema: object({ before: str('比較元の画像'), after: str('比較先の画像'), threshold: { type: 'number', minimum: 0, maximum: 1, description: '色の違いを無視する度合い（既定0.1、小さいほど厳しい）' } }, ['before', 'after']),
      handler: (args, context) => compareImages(args.before, args.after, context, args.threshold ?? 0.1),
    },
    {
      name: 'optimize_svg',
      description: 'SVG を svgo で最適化した結果（容量の変化と最適化後のコード）と、viewBox なし・代替テキストなし・script・外部参照・埋め込み画像といった問題を返す。ファイルは変更しない。',
      inputSchema: object({ file: str('.svg ファイル') }, ['file']),
      handler: (args, context) => optimizeSvg(args.file, context),
    },
  ],
  browser: [
    {
      name: 'screenshot_page',
      description: '作業フォルダのローカルHTMLを分離ブラウザで開き、指定した画面幅の画像を返す（fullPage で縦長の全体）。デザインの見た目・崩れの確認や、修正前後の比較に使う。外部サイト・開発サーバーは開けない。',
      inputSchema: object({ file: str('作業フォルダ内の .html の相対パス'), width: int('画面幅（既定1280。スマホは375など）', 320, 2560), height: int('画面の高さ（既定800）', 240, 4000), fullPage: { type: 'boolean', description: 'ページ全体を撮る（高さ8000pxまで）' } }, ['file']),
      handler: (args, context) => screenshotPage(context, args.file, args.width, args.height, args.fullPage),
    },
    {
      name: 'audit_accessibility',
      description: 'axe-core で WCAG 2.x（A / AA）とベストプラクティスの自動検査を行い、違反（影響度・該当要素・解説URL）と要確認項目を返す。自動検査で分かるのは一部の問題だけ。',
      inputSchema: object({ file: str('作業フォルダ内の .html の相対パス'), width: int('画面幅（既定1280）', 320, 2560) }, ['file']),
      handler: (args, context) => auditAccessibility(context, args.file, args.width),
    },
    {
      name: 'check_layout',
      description: '画面幅ごと（既定 375・768・1280）に、横スクロール・画面外へはみ出す要素・切れた文字・24px未満のタップ領域・12px未満の文字・alt のない画像を調べる。レスポンシブ対応の確認に使う。',
      inputSchema: object({ file: str('作業フォルダ内の .html の相対パス'), widths: { type: 'array', items: { type: 'integer', minimum: 320, maximum: 2560 }, maxItems: 6 } }, ['file']),
      handler: (args, context) => checkLayout(context, args.file, args.widths),
    },
    {
      name: 'check_design_patterns',
      description: 'モックアップや画面の絵文字（本文・aria-label・alt・::before/::after）と、題材に関係なく出やすい定番の型（同じ角丸と影のカードの割合・英大文字の小ラベル・見出しの一部だけの強調・01/02 番号・グラデーション・アニメーション）、使っている書体の割合を調べる。良し悪しは判定せず所見を返す。',
      inputSchema: object({ file: str('作業フォルダ内の .html の相対パス'), width: int('画面幅（既定1280）', 320, 2560) }, ['file']),
      handler: (args, context) => checkDesignPatterns(context, args.file, args.width),
    },
  ],
  code: [
    {
      name: 'test_regex',
      description: '正規表現（JavaScript）を複数の入力に当て、一致の有無・位置・グループ・全体一致を返す。入力チェックや抽出ルールの確認に使う。',
      inputSchema: object({ pattern: str('正規表現（/ で囲まない）'), flags: str('フラグ（例: i, m, u）'), inputs: { type: 'array', items: str('試す文字列'), minItems: 1, maxItems: 50 } }, ['pattern', 'inputs']),
      handler: (args) => testRegex(args.pattern, args.flags, args.inputs),
    },
    {
      name: 'compare_versions',
      description: 'バージョン番号（semver）を並べ替え、最新版を求め、範囲指定（^1.2.0、~2.0、>=3 <4）を満たすものを返す。依存関係の更新可否の確認に使う。',
      inputSchema: object({ versions: { type: 'array', items: str('バージョン番号'), minItems: 1 }, range: str('範囲指定（省略可）') }, ['versions']),
      handler: (args) => compareVersions(args.versions, args.range),
    },
    {
      name: 'validate_config',
      description: 'JSON / YAML / TOML の構文を検査し、誤りの行・列、または読めた場合の最上位キーを返す。設定ファイル・CI定義・マニフェストの確認に使う。',
      inputSchema: object({ file: str('.json / .yaml / .yml / .toml のファイル') }, ['file']),
      handler: (args, context) => validateConfig(args.file, context),
    },
    {
      name: 'validate_json_schema',
      description: 'データが JSON Schema に合うかを ajv で検証し、違反の場所と理由を返す。API の入出力例や設定ファイルが仕様どおりかの確認に使う。',
      inputSchema: object({ dataFile: str('データのファイル（.json / .yaml）'), data: { description: 'データを直接渡す場合' }, schemaFile: str('スキーマのファイル'), schema: { type: 'object', description: 'スキーマを直接渡す場合' } }),
      handler: (args, context) => validateJsonSchema(args, context),
    },
    {
      name: 'explain_cron',
      description: 'cron 式（5項目または秒付き6項目）の各項目と、指定したタイムゾーンでの次回以降の実行日時を返す。定期実行の設定確認に使う。',
      inputSchema: object({ expression: str('cron 式（例: 0 9 * * 1-5）'), count: int('列挙する回数（既定5）', 1, 50), timezone: str('タイムゾーン（既定 Asia/Tokyo）'), from: str('起点の日時（既定は現在）') }, ['expression']),
      handler: (args) => explainCron(args.expression, args.count ?? 5, args.timezone ?? 'Asia/Tokyo', args.from),
    },
  ],
  knowledge: [
    {
      name: 'lookup_ux_principles',
      description: '利用者が整理した UI/UX の原則集（500項目: ヤコブ・フィッツ・ヒックの法則、フォーム、エラー、アクセシビリティ、ダークパターン、評価手法など）を引く。numbers で番号指定（例: [3, 97]）、query で語を検索（例: "フォーム エラー"）、どちらも無ければ目次。設計や確認の判断の根拠に、該当する項目の番号を示す。',
      inputSchema: object({ query: str('検索語。空白区切りで複数可（例: 空状態 オンボーディング）'), numbers: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 500 }, maxItems: 10 }, limit: int('本文を返す最大件数（既定5）', 1, 10) }),
      handler: (args) => lookupUxPrinciples(args),
    },
  ],
  sources: [
    {
      name: 'record_source',
      description: '調べた原資料を出典として記録する（URL・資料名・発行者・発行日・確認日・根拠の引用・支える主張）。報告では返された [S番号] で出典を示す。取得できなかった資料は記録しない。',
      inputSchema: object({ url: str('原資料のURL'), title: str('資料名'), publisher: str('発行者'), published: str('発行日・改訂日 YYYY-MM-DD（不明なら省略）'), accessed: str('確認日 YYYY-MM-DD（既定は今日）'), quote: str('根拠となる原文の引用'), claim: str('この資料が支える主張') }, ['url', 'title']),
      handler: (args, context) => recordSource(context.sourcesFile, args),
    },
    {
      name: 'list_sources',
      description: 'この依頼で記録された出典の一覧と、発行日・引用が欠けている出典を返す。報告の出典表や確認に使う。',
      inputSchema: object({}),
      handler: (_args, context) => listSources(context.sourcesFile),
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

/** 1つのstdioプロセスで、部門と段階に応じたツールだけを公開する。 */
export const SERVER_NAME = 'sikun';

/**
 * 部門ごとの固定のツール。スキル（ROLE_SKILLS）と同じく部門で決まり、AIが多数の中から選ぶ必要をなくす。
 * 部門の仕事で実際に確かめる対象（数値・表・文書・画面・設定・出典）に合うものだけを8〜10個に絞る。
 */
export const ROLE_TOOLS: Record<string, string[]> = {
  it_consultant: ['calculate', 'calculate_dates', 'read_table', 'extract_text', 'find_quote', 'text_diff', 'document_outline'],
  architect: ['calculate', 'convert_units', 'extract_text', 'document_outline', 'validate_config', 'validate_json_schema', 'compare_versions'],
  engineer: ['calculate', 'read_structured_data', 'text_diff', 'test_regex', 'compare_versions', 'validate_config', 'validate_json_schema', 'explain_cron'],
  backend: ['calculate', 'calculate_dates', 'read_structured_data', 'text_diff', 'test_regex', 'compare_versions', 'validate_config', 'validate_json_schema', 'explain_cron'],
  product: ['calculate', 'growth_rate', 'sensitivity_table', 'read_table', 'query_table', 'document_outline', 'screenshot_page', 'check_layout', 'lookup_ux_principles'],
  researcher: ['calculate', 'growth_rate', 'read_table', 'extract_text', 'find_quote', 'check_links', 'record_source', 'list_sources'],
  critic: ['calculate', 'read_table', 'reconcile_tables', 'extract_text', 'find_quote', 'text_diff', 'screenshot_page', 'check_layout'],
  security: ['read_structured_data', 'extract_text', 'find_quote', 'test_regex', 'compare_versions', 'validate_config', 'validate_json_schema', 'explain_cron'],
  innovator: ['calculate', 'describe_statistics', 'growth_rate', 'sensitivity_table', 'read_table', 'extract_text'],
  analyst: ['calculate', 'describe_statistics', 'growth_rate', 'read_table', 'describe_table', 'query_table', 'reconcile_tables', 'validate_table', 'extract_text'],
  finance: ['calculate', 'growth_rate', 'npv_irr', 'loan_payment', 'sensitivity_table', 'calculate_dates', 'read_table', 'query_table', 'reconcile_tables'],
  legal: ['calculate_dates', 'extract_text', 'find_quote', 'text_diff', 'document_outline', 'check_terms', 'record_source', 'list_sources'],
  designer: ['color_contrast', 'color_palette', 'compare_colors', 'image_info', 'compare_images', 'screenshot_page', 'audit_accessibility', 'check_layout', 'check_design_patterns', 'lookup_ux_principles'],
  marketing: ['calculate', 'growth_rate', 'sensitivity_table', 'read_table', 'query_table', 'text_statistics', 'check_terms', 'color_contrast', 'image_info', 'screenshot_page'],
  devops: ['convert_units', 'calculate_dates', 'read_structured_data', 'test_regex', 'compare_versions', 'validate_config', 'validate_json_schema', 'explain_cron'],
  qa: ['calculate', 'reconcile_tables', 'text_diff', 'compare_images', 'screenshot_page', 'audit_accessibility', 'check_layout', 'test_regex', 'validate_config', 'validate_json_schema'],
  writer: ['extract_text', 'text_diff', 'find_quote', 'text_statistics', 'check_placeholders', 'check_links', 'document_outline', 'check_terms'],
  ai_researcher: ['calculate', 'describe_statistics', 'read_table', 'query_table', 'reconcile_tables', 'read_structured_data', 'text_diff', 'validate_json_schema'],
  support: ['calculate_dates', 'query_table', 'extract_text', 'find_quote', 'text_statistics', 'document_outline', 'check_terms'],
  data_engineer: ['read_table', 'describe_table', 'query_table', 'reconcile_tables', 'validate_table', 'read_structured_data', 'test_regex', 'validate_config', 'validate_json_schema', 'explain_cron'],
  cloud: ['calculate', 'sensitivity_table', 'convert_units', 'compare_versions', 'validate_config', 'validate_json_schema', 'explain_cron'],
  visionary: ['calculate', 'describe_statistics', 'growth_rate', 'sensitivity_table', 'extract_text'],
  frontend: ['color_contrast', 'compare_images', 'optimize_svg', 'screenshot_page', 'audit_accessibility', 'check_layout', 'test_regex', 'compare_versions', 'validate_config', 'lookup_ux_principles'],
  mobile: ['color_contrast', 'image_info', 'compare_images', 'screenshot_page', 'audit_accessibility', 'check_layout', 'compare_versions', 'validate_config', 'lookup_ux_principles'],
  embedded: ['calculate', 'convert_units', 'read_table', 'test_regex', 'compare_versions', 'validate_config'],
  accessibility: ['document_outline', 'color_contrast', 'compare_colors', 'screenshot_page', 'audit_accessibility', 'check_layout', 'lookup_ux_principles'],
  privacy: ['calculate_dates', 'validate_table', 'read_structured_data', 'extract_text', 'text_diff', 'find_quote', 'check_terms', 'record_source', 'list_sources'],
  sales: ['calculate', 'growth_rate', 'sensitivity_table', 'calculate_dates', 'read_table', 'query_table'],
  data_scientist: ['calculate', 'describe_statistics', 'growth_rate', 'sensitivity_table', 'read_table', 'describe_table', 'query_table', 'reconcile_tables', 'validate_table'],
  human_resources: ['calculate', 'calculate_dates', 'read_table', 'query_table', 'validate_table', 'text_statistics', 'check_terms'],
  procurement: ['calculate', 'sensitivity_table', 'convert_units', 'calculate_dates', 'read_table', 'query_table', 'reconcile_tables', 'text_diff'],
  accountant: ['calculate', 'loan_payment', 'calculate_dates', 'read_table', 'describe_table', 'query_table', 'reconcile_tables', 'validate_table'],
  healthcare: ['calculate', 'describe_statistics', 'convert_units', 'calculate_dates', 'extract_text', 'find_quote', 'record_source', 'list_sources'],
  localization: ['read_structured_data', 'extract_text', 'text_diff', 'text_statistics', 'check_placeholders', 'check_terms', 'screenshot_page', 'check_layout'],
  public_policy: ['calculate', 'growth_rate', 'calculate_dates', 'read_table', 'extract_text', 'find_quote', 'record_source', 'list_sources'],
  manufacturing: ['calculate', 'describe_statistics', 'sensitivity_table', 'convert_units', 'calculate_dates', 'read_table', 'query_table'],
  logistics: ['calculate', 'sensitivity_table', 'convert_units', 'calculate_dates', 'read_table', 'query_table', 'reconcile_tables'],
  sustainability: ['calculate', 'growth_rate', 'convert_units', 'read_table', 'query_table', 'extract_text', 'find_quote', 'record_source', 'list_sources'],
  education: ['calculate_dates', 'extract_text', 'text_statistics', 'document_outline', 'check_terms', 'color_contrast', 'screenshot_page', 'check_layout'],
};
/** 表に無い部門（利用者が追加したAIなど）の最小限のツール。 */
export const DEFAULT_TOOLS = ['calculate', 'read_table', 'extract_text', 'find_quote'];
/** 確認の段階で全部門に加えるツール。 */
const REVIEW_TOOLS = ['record_criterion', 'list_criteria'];
const REVIEW_PHASES = new Set(['review', 'goal_check', 'kgi_check']);
const ALL_TOOLS = (Object.keys(TOOL_GROUPS) as ToolGroup[]).flatMap((group) => TOOL_GROUPS[group].map((tool) => ({ group, tool })));

/**
 * 段階と部門で決まるツール。作業では部門のツール、確認の段階ではそれに確認記録を加える。会議・相談・計画・納品では渡さない。
 * 出典の記録は作業と所管の確認だけ（目標確認・KGI確認は出典を増やさない）。並びはカタログの順。
 */
export function toolsFor(phase: string, personaId = ''): ToolDefinition[] {
  const review = REVIEW_PHASES.has(phase);
  if (phase !== 'work' && !review) return [];
  const names = new Set([...(ROLE_TOOLS[personaId] ?? DEFAULT_TOOLS), ...(review ? REVIEW_TOOLS : [])]);
  if (phase !== 'work' && phase !== 'review') names.delete('record_source');
  return ALL_TOOLS.filter(({ tool }) => names.has(tool.name)).map(({ tool }) => tool);
}

/** 公開するツールが属するグループ（案内文の見出しに使う）。 */
export function toolGroupsFor(phase: string, personaId = ''): ToolGroup[] {
  const names = new Set(toolsFor(phase, personaId).map((tool) => tool.name));
  return [...new Set(ALL_TOOLS.filter(({ tool }) => names.has(tool.name)).map(({ group }) => group))];
}

export function toolNamesFor(phase: string, personaId = ''): string[] {
  return toolsFor(phase, personaId).map((tool) => `mcp__${SERVER_NAME}__${tool.name}`);
}

const GROUP_LABELS: Record<ToolGroup, string> = { calc: '計算', data: '表', docs: '文書', design: '配色・画像', browser: '画面', code: 'コード', knowledge: 'UI/UXの原則', sources: '出典', review: '確認記録' };

/** 検証ツールの使い方。ClaudeとCodexで同じ文面を使う。 */
export function verificationGuide(phase: string, personaId = ''): string {
  const tools = toolsFor(phase, personaId);
  if (!tools.length) return '';
  const names = new Set(tools.map((tool) => tool.name));
  const list = toolGroupsFor(phase, personaId).map((group) => `${GROUP_LABELS[group]}: ${TOOL_GROUPS[group].filter((tool) => names.has(tool.name)).map((tool) => tool.name).join('・')}`).join('。');
  return `\n検証ツール（sikun。この部門用）: ${list}。答えが一つに決まる確認（計算・集計・照合・引用の実在・差分・色のコントラスト・画面の崩れ）はツールで行い、報告の数値や判定をツールの結果と照合する。ツールで確かめていない数値は未検算、画面は未確認と明記する。`
    + (names.has('lookup_ux_principles') ? '画面の設計・確認では lookup_ux_principles で該当する原則を引き、判断の根拠に番号（例: #97 プレースホルダーはラベルの代わりではない）を示す。' : '')
    + (names.has('record_source') ? '調べた原資料は record_source で記録し、報告では [S番号] で示す。' : '')
    + (names.has('record_criterion') ? '確認では受け入れ条件ごとに record_criterion で pass / fail / unverified と証拠を記録し、list_criteria で漏れがないか確かめてから判定する。fail か unverified が残る場合は承認しない。' : '');
}

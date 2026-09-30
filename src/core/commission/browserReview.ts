import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { randomBytes } from 'crypto';
import { spawn, ChildProcess } from 'child_process';

const MAX_BODY = 8192;
const MAX_ACTIONS = 80;
const EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2']);
const MIME: Record<string, string> = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

export function browserExecutable(): string | undefined {
  const choices = process.platform === 'win32'
    ? [process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'), process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return choices.find((value): value is string => Boolean(value && fs.existsSync(value)));
}

class DevTools {
  private socket: WebSocket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private events = new Map<string, (params: any) => void>();

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event) => {
      let message: any;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.id === 'number') {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      } else if (message.method) this.events.get(message.method)?.(message.params);
    });
    this.socket.addEventListener('close', () => {
      for (const waiter of this.pending.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('ブラウザ接続が閉じられました'));
      }
      this.pending.clear();
    });
  }

  async ready(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ブラウザ接続がタイムアウトしました')), 10000);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ブラウザ接続に失敗しました')); }, { once: true });
    });
  }

  on(name: string, handler: (params: any) => void): void { this.events.set(name, handler); }
  send(method: string, params: object = {}): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ブラウザ操作がタイムアウトしました: ${method}`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  close(): void { this.socket.close(); }
}

async function waitForPort(profile: string, child: ChildProcess): Promise<number> {
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('ブラウザが起動直後に終了しました');
    try {
      const value = Number((await fs.promises.readFile(file, 'utf8')).split('\n')[0]);
      if (Number.isInteger(value) && value > 0) return value;
    } catch { /* Chrome がまだ準備中 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ブラウザの起動がタイムアウトしました');
}

function sendJson(response: http.ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}

async function body(request: http.IncomingMessage): Promise<URLSearchParams> {
  let value = '';
  for await (const part of request) {
    value += part.toString();
    if (value.length > MAX_BODY) throw new Error('入力が長すぎます');
  }
  return new URLSearchParams(value);
}

export class BrowserReviewSession {
  private server?: http.Server;
  private browser?: ChildProcess;
  private devtools?: DevTools;
  private profile?: string;
  private origin = '';
  private token = randomBytes(32).toString('hex');
  private actions = 0;
  private trace: string[] = [];
  private rootReal = '';

  constructor(private readonly root: string, private readonly htmlFiles: string[], private readonly allowNewHtml = false) {}

  async start(): Promise<void> {
    const binary = browserExecutable();
    if (!binary) throw new Error('Chrome または Edge が見つかりません');
    this.rootReal = await fs.promises.realpath(this.root);
    this.server = http.createServer((request, response) => { void this.handle(request, response); });
    this.server.on('connect', (_request, socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => this.server!.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('ブラウザ確認口を開けません');
    this.origin = `http://127.0.0.1:${address.port}`;
    this.profile = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sikun-browser-qa-'));
    this.browser = spawn(binary, [
      '--headless=new', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-sync', '--disable-features=Translate',
      `--proxy-server=${this.origin}`, '--proxy-bypass-list=127.0.0.1;localhost',
      '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
      `--user-data-dir=${this.profile}`, 'about:blank',
    ], { stdio: 'ignore', windowsHide: true });
    const port = await waitForPort(this.profile, this.browser);
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((result) => result.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const target = targets.find((entry) => entry.type === 'page');
    if (!target) throw new Error('ブラウザのページに接続できません');
    this.devtools = new DevTools(target.webSocketDebuggerUrl);
    await this.devtools.ready();
    this.devtools.on('Fetch.requestPaused', (params) => {
      const requested = String(params.request?.url ?? '');
      const allowed = requested.startsWith(`${this.origin}/`) || requested === 'about:blank';
      void this.devtools?.send(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    await this.devtools.send('Page.enable');
    await this.devtools.send('Runtime.enable');
    await this.devtools.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  }

  instructions(): string {
    const files = this.htmlFiles.slice(0, 30).map((file) => `- ${file}`).join('\n');
    return `\n\nブラウザ実機確認を利用できます。ファイルを編集しない検証APIです。${process.platform === 'win32' ? 'curl.exe' : 'curl'} で次の127.0.0.1の口を呼んでください。認証トークンを報告文へ転記しないでください。\nURL: ${this.origin}\nAuthorization: Bearer ${this.token}\n対象HTML:\n${files || '作成したローカルHTMLの相対パスを指定してください'}\n最初に GET /help を呼び、POST /open で対象を開いてください。入力・クリック・キーボード操作・画面幅変更・アクセシビリティツリー確認・再読込を行い、実測した状態を採否の根拠にしてください。外部URLや任意JavaScriptは利用できません。読み上げ音声やモバイル実機の検査は提供しません。ブラウザが失敗した場合は未検証として扱ってください。`;
  }

  summary(): string { return this.trace.join(' / ').slice(0, 1500); }

  private async safeFile(relative: string): Promise<string> {
    if (!relative || path.isAbsolute(relative) || relative.includes('\0') || relative.split(/[\\/]/).some((part) => part.startsWith('.'))) throw new Error('ファイル名が不正です');
    const candidate = path.resolve(this.rootReal, relative);
    const real = await fs.promises.realpath(candidate);
    if (!real.startsWith(this.rootReal + path.sep)) throw new Error('作業フォルダ外のファイルです');
    if (!EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('この形式は表示できません');
    const info = await fs.promises.stat(real);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('表示できないファイルです');
    return real;
  }

  private async evaluate(expression: string): Promise<any> {
    if (!this.devtools) throw new Error('ブラウザが利用できません');
    const result = await this.devtools.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'ページ操作に失敗しました');
    return result.result?.value;
  }

  private async navigate(relative: string): Promise<unknown> {
    await this.safeFile(relative);
    if (!this.htmlFiles.includes(relative) && !(this.allowNewHtml && /\.html?$/i.test(relative))) throw new Error('確認対象のHTMLではありません');
    const url = `${this.origin}/files/${relative.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
    const navigation = await this.devtools!.send('Page.navigate', { url });
    if (navigation.errorText) throw new Error(`ページを開けません: ${navigation.errorText}`);
    let loaded = false;
    for (let i = 0; i < 50; i++) {
      const state = await this.evaluate('({url:location.href,ready:document.readyState})');
      if (state.url === url && state.ready === 'complete') { loaded = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!loaded) throw new Error('ページの読み込みがタイムアウトしました');
    this.trace.push(`open ${relative}`);
    return this.evaluate('({title:document.title,url:location.pathname,text:document.body?.innerText.slice(0,3000)})');
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', this.origin);
      if (url.origin !== this.origin) return sendJson(response, 403, { error: '外部URLは禁止です' });
      if (url.pathname.startsWith('/files/')) {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'GETのみ' });
        const relative = decodeURIComponent(url.pathname.slice('/files/'.length));
        const file = await this.safeFile(relative);
        response.writeHead(200, {
          'Content-Type': `${MIME[path.extname(file).toLowerCase()]}; charset=utf-8`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self' data: blob: 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-src 'none'; base-uri 'none'",
        });
        fs.createReadStream(file).pipe(response);
        return;
      }
      if (request.headers.authorization !== `Bearer ${this.token}`) return sendJson(response, 401, { error: '認証が必要です' });
      if (url.pathname === '/help' && request.method === 'GET') return sendJson(response, 200, {
        usage: `${process.platform === 'win32' ? 'curl.exe' : 'curl'} -s -H "Authorization: Bearer TOKEN" URL/PATH`,
        routes: ['GET /help', 'POST /open --data-urlencode "file=relative/path.html"', 'POST /type --data-urlencode "selector=#id" --data-urlencode "text=value"', 'POST /click --data-urlencode "selector=#id"', 'POST /press --data-urlencode "key=Tab" (Shift+Tab, Enter, Space, Escape, ArrowUp/Down/Left/Right)', 'POST /viewport --data-urlencode "width=390" --data-urlencode "height=844"', 'GET /accessibility', 'GET /state?selector=%23id', 'POST /reload'],
        files: this.htmlFiles.slice(0, 30),
      });
      if (++this.actions > MAX_ACTIONS) return sendJson(response, 429, { error: '操作回数の上限です' });
      const input = request.method === 'POST' ? await body(request) : new URLSearchParams(url.search);
      const selector = input.get('selector') ?? '';
      if (selector.length > 300) throw new Error('セレクタが長すぎます');
      let result: unknown;
      if (url.pathname === '/open' && request.method === 'POST') result = await this.navigate(input.get('file') ?? '');
      else if (url.pathname === '/type' && request.method === 'POST') {
        const value = input.get('text') ?? '';
        if (value.length > 2000) throw new Error('入力が長すぎます');
        result = await this.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e || !(e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement)) return {error:'入力欄が見つかりません'}; const p=e instanceof HTMLInputElement?HTMLInputElement.prototype:HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {value:e.value}; })()`);
        this.trace.push(`type ${selector}`);
      } else if (url.pathname === '/click' && request.method === 'POST') {
        result = await this.evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e || !(e instanceof HTMLElement)) return {error:'要素が見つかりません'}; e.click(); return {clicked:true}; })()`);
        this.trace.push(`click ${selector}`);
      } else if (url.pathname === '/press' && request.method === 'POST') {
        const key = input.get('key') ?? '';
        const keys: Record<string, [string, number, number]> = { Tab: ['Tab', 9, 0], 'Shift+Tab': ['Tab', 9, 8], Enter: ['Enter', 13, 0], Space: [' ', 32, 0], Escape: ['Escape', 27, 0], ArrowLeft: ['ArrowLeft', 37, 0], ArrowUp: ['ArrowUp', 38, 0], ArrowRight: ['ArrowRight', 39, 0], ArrowDown: ['ArrowDown', 40, 0] };
        const definition = keys[key];
        if (!definition) throw new Error('対応していないキーです');
        const [value, windowsVirtualKeyCode, modifiers] = definition;
        await this.devtools!.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value, windowsVirtualKeyCode, modifiers, ...(key === 'Enter' ? { text: '\r' } : key === 'Space' ? { text: ' ' } : {}) });
        await this.devtools!.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value, windowsVirtualKeyCode, modifiers });
        result = await this.evaluate('({focus:{tag:document.activeElement?.tagName,id:document.activeElement?.id,text:document.activeElement?.textContent?.slice(0,200)}})');
        this.trace.push(`press ${key}`);
      } else if (url.pathname === '/viewport' && request.method === 'POST') {
        const width = Number(input.get('width')), height = Number(input.get('height'));
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 2560 || height < 240 || height > 2160) throw new Error('画面サイズが範囲外です');
        await this.devtools!.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        result = await this.evaluate('({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth})');
        this.trace.push(`viewport ${width}x${height}`);
      } else if (url.pathname === '/accessibility' && request.method === 'GET') {
        const tree = await this.devtools!.send('Accessibility.getFullAXTree');
        const nodes = tree.nodes.filter((node: any) => !node.ignored);
        result = { truncated: nodes.length > 300, nodes: nodes.slice(0, 300).map((node: any) => ({
          id: node.nodeId, parentId: node.parentId, role: node.role?.value, name: String(node.name?.value ?? '').slice(0, 300),
          properties: node.properties?.filter((property: any) => ['focused', 'focusable', 'disabled', 'checked', 'expanded', 'required', 'invalid', 'level', 'live'].includes(property.name)),
        })), note: 'アクセシビリティツリーの検査。音声読み上げは未検証。' };
        this.trace.push('accessibility');
      } else if (url.pathname === '/state' && request.method === 'GET') {
        result = await this.evaluate(`(() => { const s=${JSON.stringify(selector)}; if (!s) return {title:document.title,url:location.pathname,text:document.body?.innerText.slice(0,4000)}; const e=document.querySelector(s); return {count:document.querySelectorAll(s).length,text:e?.textContent?.slice(0,2000)??null,value:'value' in (e??{})?e.value:null,checked:'checked' in (e??{})?e.checked:null}; })()`);
        this.trace.push(`state ${selector || 'page'}`);
      } else if (url.pathname === '/reload' && request.method === 'POST') {
        await this.devtools!.send('Page.reload');
        await new Promise((resolve) => setTimeout(resolve, 300));
        result = await this.evaluate('({title:document.title,text:document.body?.innerText.slice(0,3000)})');
        this.trace.push('reload');
      } else return sendJson(response, 404, { error: '操作が見つかりません' });
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // ---- 同梱MCPの検証ツール用。AIが書いたスクリプトは受け取らず、アプリが用意した処理だけを実行する。 ----

  async setViewport(width: number, height: number): Promise<void> {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 320 || width > 2560 || height < 240 || height > 4000) throw new Error('画面サイズは幅320〜2560、高さ240〜4000にしてください');
    // mobile: true だとChromeが内容幅に合わせて表示領域を広げ、はみ出しが隠れるため使わない。
    await this.devtools!.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    this.trace.push(`viewport ${width}x${height}`);
  }

  async openPage(relative: string): Promise<unknown> { return this.navigate(relative); }

  /** 表示中のページを画像にする。全体表示は高さ8000pxまで。 */
  async screenshot(fullPage: boolean): Promise<{ data: string; mimeType: string; width: number; height: number; clipped: boolean }> {
    const metrics = await this.devtools!.send('Page.getLayoutMetrics');
    const viewport = metrics.cssLayoutViewport ?? { clientWidth: 1280, clientHeight: 800 };
    const content = metrics.cssContentSize ?? { width: viewport.clientWidth, height: viewport.clientHeight };
    const width = Math.ceil(viewport.clientWidth);
    const fullHeight = Math.ceil(content.height);
    const height = fullPage ? Math.min(fullHeight, 8000) : Math.ceil(viewport.clientHeight);
    const format = fullPage && height > 2000 ? 'jpeg' : 'png';
    const shot = await this.devtools!.send('Page.captureScreenshot', {
      format, ...(format === 'jpeg' ? { quality: 70 } : {}), captureBeyondViewport: fullPage,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    this.trace.push(`screenshot ${width}x${height}`);
    return { data: shot.data, mimeType: `image/${format}`, width, height, clipped: fullPage && fullHeight > height };
  }

  /** アプリ同梱の検査スクリプト（axe-core・レイアウト検査）だけを実行する。 */
  async runTrustedScript(expression: string): Promise<any> { return this.evaluate(expression); }

  async close(): Promise<void> {
    this.devtools?.close();
    const browser = this.browser;
    if (browser && browser.exitCode === null) {
      const stopped = new Promise<void>((resolve) => {
        browser.once('exit', () => resolve());
        setTimeout(resolve, 3000);
      });
      browser.kill();
      await stopped;
    }
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    if (this.profile) {
      const target = path.resolve(this.profile);
      const parent = path.resolve(os.tmpdir());
      if (target.startsWith(parent + path.sep) && path.basename(target).startsWith('sikun-browser-qa-')) {
        await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
      }
    }
  }
}

import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createAppContext, AppContext } from '../core';
import { IPC_CHANNELS, registerIpcHandlers } from './ipc';
import { CreateMeetingInput } from '../core/services/meetingService';

let mainWindow: BrowserWindow | null = null;

/**
 * 外部アプリ(Sikun Lab IDE等)からの起動引数 `--pending-meeting <jsonファイルパス>` を見て、
 * あれば指定のJSON({title, agenda, workingDirectory, meetingTypeId?})から会議を自動作成し、
 * 使い終わったJSONファイルは削除する。戻り値は作成した会議のID（引数がなければnull）。
 */
async function createPendingMeetingFromArgs(ctx: AppContext): Promise<string | null> {
  const flagIndex = process.argv.indexOf('--pending-meeting');
  if (flagIndex === -1 || flagIndex + 1 >= process.argv.length) return null;

  const jsonPath = process.argv[flagIndex + 1];
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<CreateMeetingInput>;
    if (!parsed.title || !parsed.agenda) {
      console.error('[pending-meeting] title/agenda missing in', jsonPath);
      return null;
    }
    const input: CreateMeetingInput = {
      title: parsed.title,
      agenda: parsed.agenda,
      meetingTypeId: parsed.meetingTypeId ?? 'architecture_review',
      workingDirectory: parsed.workingDirectory ?? null,
    };
    const meeting = await ctx.meetingService.createMeeting(input);
    fs.unlink(jsonPath, () => {});
    return meeting.id;
  } catch (err) {
    console.error('[pending-meeting] failed to create meeting from', jsonPath, err);
    return null;
  }
}

// アプリ独自のUIを持つため、Electron既定の File/Edit/View/Window/Help メニューバーは不要。
Menu.setApplicationMenu(null);

/**
 * 「今動いているのは本当に最新ビルドか」をタイトルバーだけで目視確認できるようにする。
 * package.jsonのversionは手動bumpを忘れると変化しないので、必ず変わるビルド日時を併記する。
 * dist/build-info.json は scripts/copy-static.js がビルドの都度生成する。
 */
function windowTitle(): string {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'build-info.json'), 'utf-8'));
    const d = new Date(info.builtAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    const stamp = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `Sikun Meeting v${info.version} (build ${stamp})`;
  } catch {
    return 'Sikun Meeting';
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: windowTitle(),
    // exeファイル自体のアイコン(electron-builderがbuild/icon.pngから生成)とは別に、
    // 実行中のウィンドウ/タスクバー/Alt+Tabに表示されるアイコンはここで明示しないと
    // Electronの既定アイコン(atomマーク)になってしまうため設定する。
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // preload.ts はローカルの ./ipc から定数をrequireしている。sandbox:true だと
      // preloadは専用のサンドボックス化モジュールローダーで動き、相対requireができず
      // "module not found: ./ipc" になるため false にする。contextIsolation:true が
      // レンダラー(信頼できないWebコンテンツ)からNode/Electron内部を隠す本来の境界であり、
      // preload自体はこちらが書いた信頼済みコードなので Node フルアクセスで問題ない。
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // レンダラーのconsole出力・読み込み失敗をメインプロセス側のログにも転送する（デバッグ用）。
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error(`[renderer] did-fail-load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const ctx = createAppContext(dataDir);
  registerIpcHandlers(ctx, () => mainWindow);
  // 通常会議とは別の監査を、アプリ起動時と稼働中の1日ごとに確認する。
  void ctx.auditService.runDue();
  const auditTimer = setInterval(() => void ctx.auditService.runDue(), 24 * 60 * 60 * 1000);
  app.once('before-quit', () => clearInterval(auditTimer));

  const [pendingMeetingId] = await Promise.all([
    createPendingMeetingFromArgs(ctx),
    Promise.resolve(createWindow()),
  ]);

  if (pendingMeetingId && mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.send(IPC_CHANNELS.pendingMeetingReady, pendingMeetingId);
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

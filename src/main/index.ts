import { app, BrowserWindow, Menu, Tray, nativeImage, powerSaveBlocker, session, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { createAppContext, AppContext } from '../core';
import { IPC_CHANNELS, registerIpcHandlers } from './ipc';
import { CreateMeetingInput } from '../core/services/meetingService';
import { AppSettingsStore } from './appSettings';
import { isAppUrl, isExternalWebUrl } from './security';
import { MobileSyncService } from '../core/mobile/service';
import { createTokenStore } from './mobileToken';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let sleepBlocker: number | null = null;
let settingsStore: AppSettingsStore | null = null;

/**
 * 外部アプリ(Sikun Lab IDE等)からの起動引数 `--pending-meeting <jsonファイルパス>` を見て、
 * あれば指定のJSON({title, agenda, workingDirectory, meetingTypeId?})から会議を自動作成し、
 * 使い終わったJSONファイルは削除する。戻り値は作成した会議のID（引数がなければnull）。
 */
async function createPendingMeetingFromArgs(ctx: AppContext, argv: string[] = process.argv): Promise<string | null> {
  const flagIndex = argv.indexOf('--pending-meeting');
  if (flagIndex === -1 || flagIndex + 1 >= argv.length) return null;

  const jsonPath = argv[flagIndex + 1];
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

function createWindow(show = true): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show,
    title: windowTitle(),
    // exeファイル自体のアイコン(electron-builderがbuild/icon.pngから生成)とは別に、
    // 実行中のウィンドウ/タスクバー/Alt+Tabに表示されるアイコンはここで明示しないと
    // Electronの既定アイコン(atomマーク)になってしまうため設定する。
    icon: path.join(__dirname, '..', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // AIの発言（作業場所のファイル経由で外部の文章が混ざりうる）を描画するため、レンダラーをOSのサンドボックスで隔離する。
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // レンダラーのconsole出力・読み込み失敗をメインプロセス側のログにも転送する（デバッグ用）。
  mainWindow.webContents.on('console-message', (details) => {
    console.log(`[renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    console.error(`[renderer] did-fail-load: ${errorCode} ${errorDescription}`);
  });

  mainWindow.on('close', (event) => {
    if (!quitting && settingsStore?.get().keepInTray && tray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function showWindow(): void {
  if (!mainWindow) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}

/** 外部ページを画面内に読み込ませない。preloadのAPIが外部ページに渡るのを防ぐ。 */
function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => {
      if (isAppUrl(event.url)) return;
      event.preventDefault();
      if (isExternalWebUrl(event.url)) void shell.openExternal(event.url);
    });
    contents.on('will-redirect', (event) => {
      if (!isAppUrl(event.url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (isExternalWebUrl(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

function updateAutonomyState(ctx: AppContext): void {
  const running = ctx.commissionService.hasRunning();
  if (running && sleepBlocker === null) sleepBlocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!running && sleepBlocker !== null) {
    powerSaveBlocker.stop(sleepBlocker);
    sleepBlocker = null;
  }
  tray?.setToolTip(`Sikun Meeting${ctx.commissionService.hasActiveAutonomy() ? '（無人運用中）' : ''}`);
}

function applyLoginItem(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
}

function buildTrayMenu(): Menu {
  const settings = settingsStore!.get();
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: 'ウィンドウを表示', click: showWindow },
    { type: 'separator' },
    { label: 'ウィンドウを閉じても常駐する', type: 'checkbox', checked: settings.keepInTray,
      click: (item) => { settingsStore!.set({ keepInTray: item.checked }); tray?.setContextMenu(buildTrayMenu()); } },
  ];
  if (process.platform === 'win32' || process.platform === 'darwin') {
    items.push({ label: 'ログイン時に起動する', type: 'checkbox', checked: settings.launchAtLogin,
      click: (item) => { settingsStore!.set({ launchAtLogin: item.checked }); applyLoginItem(item.checked); tray?.setContextMenu(buildTrayMenu()); } });
  }
  items.push({ type: 'separator' }, { label: '終了', click: () => { quitting = true; app.quit(); } });
  return Menu.buildFromTemplate(items);
}

function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? icon : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Sikun Meeting');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', showWindow);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
installNavigationGuards();
app.on('before-quit', () => { quitting = true; });

if (singleInstance) app.whenReady().then(async () => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const ctx = createAppContext(dataDir);
  settingsStore = new AppSettingsStore(dataDir);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === 'clipboard-sanitized-write');
  const mobileSync = new MobileSyncService(dataDir, ctx.repo, createTokenStore(dataDir));
  registerIpcHandlers(ctx, () => mainWindow, mobileSync);
  mobileSync.start();
  app.once('before-quit', () => mobileSync.stop());
  try { createTray(); } catch (error) { console.error('[tray] トレイを作成できません', error); }
  applyLoginItem(settingsStore.get().launchAtLogin);
  ctx.commissionService.subscribe(() => updateAutonomyState(ctx));
  ctx.commissionService.resumeAutonomous();
  updateAutonomyState(ctx);
  app.on('second-instance', (_event, argv) => {
    showWindow();
    void createPendingMeetingFromArgs(ctx, argv).then((meetingId) => {
      if (meetingId) mainWindow?.webContents.send(IPC_CHANNELS.pendingMeetingReady, meetingId);
    });
  });
  // 通常会議とは別の監査を、アプリ起動時と稼働中の1日ごとに確認する。
  void ctx.auditService.runDue();
  const auditTimer = setInterval(() => void ctx.auditService.runDue(), 24 * 60 * 60 * 1000);
  app.once('before-quit', () => clearInterval(auditTimer));

  const [pendingMeetingId] = await Promise.all([
    createPendingMeetingFromArgs(ctx),
    Promise.resolve(createWindow(!process.argv.includes('--hidden'))),
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
  if (process.platform !== 'darwin' && !(settingsStore?.get().keepInTray && tray)) {
    app.quit();
  }
});

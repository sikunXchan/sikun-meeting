import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createAppContext } from '../core';
import { registerIpcHandlers } from './ipc';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'Sikun Meeting',
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

app.whenReady().then(() => {
  const dataDir = path.join(app.getPath('userData'), 'data');
  const ctx = createAppContext(dataDir);
  registerIpcHandlers(ctx, () => mainWindow);

  createWindow();

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

// 起動済みの通常アプリを妨げずに、実画面を隔離データで確認するための開発専用エントリ。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const dataDir = process.env.SIKUN_QA_DATA_DIR || path.join(os.tmpdir(), 'sikun-meeting-ui-qa');
fs.mkdirSync(dataDir, { recursive: true });
app.setName('Sikun Meeting QA');
app.setPath('userData', dataDir);
require('../dist/main/index.js');

// レンダラーの静的ファイル(html/css/画像)を dist/renderer にコピーする。
// tsc はスクリプトファイルのみをコンパイルするため、静的アセットは別途配置が必要。
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'renderer');
const destDir = path.join(__dirname, '..', 'dist', 'renderer');

fs.mkdirSync(destDir, { recursive: true });

for (const entry of fs.readdirSync(srcDir)) {
  if (entry.endsWith('.html') || entry.endsWith('.css')) {
    fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
  }
}

fs.cpSync(path.join(srcDir, 'assets'), path.join(destDir, 'assets'), { recursive: true });

console.log(`[copy-static] copied renderer assets -> ${destDir}`);

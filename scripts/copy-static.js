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
fs.cpSync(path.join(__dirname, '..', 'src', 'core', 'skills', 'catalog'),
  path.join(__dirname, '..', 'dist', 'core', 'skills', 'catalog'), { recursive: true });

// 発言のMarkdown/Mermaidレンダリング用ライブラリ（ブラウザ向けUMD/グローバルビルドをそのまま同梱）。
// レンダラーはバンドラーを使わない素の<script>読み込み構成のため、npm経由ではなくここでファイルごとコピーする。
const vendorDestDir = path.join(destDir, 'vendor');
fs.mkdirSync(vendorDestDir, { recursive: true });
const vendorFiles = [
  ['marked', 'lib/marked.umd.js'],
  ['mermaid', 'dist/mermaid.min.js'],
];
for (const [pkg, rel] of vendorFiles) {
  const src = path.join(__dirname, '..', 'node_modules', pkg, rel);
  fs.copyFileSync(src, path.join(vendorDestDir, path.basename(rel)));
}

// ビルド識別情報。「今動いているのは本当に最新ビルドか」をウィンドウタイトル/画面上で
// 目視確認できるように、ビルドのたびにタイムスタンプを焼き込む(package.jsonのversionだけだと
// 手動bumpを忘れると変化がなく判別できないため、必ず変わるbuiltAtを併記する)。
const pkg = require(path.join(__dirname, '..', 'package.json'));
const buildInfo = { version: pkg.version, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'build-info.json'), JSON.stringify(buildInfo));
fs.writeFileSync(
  path.join(destDir, 'build-info.js'),
  `window.__BUILD_INFO__ = ${JSON.stringify(buildInfo)};\n`,
);

// アプリアイコン(BrowserWindowのタスクバー/タイトルバー表示用)。
// electron-builderのbuild/icon.pngはパッケージ時のexeアイコン生成専用でdistには含まれないため、
// 実行時アイコンとして使えるようdist直下にもコピーしておく。
const iconSrc = path.join(__dirname, '..', 'build', 'icon.png');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(__dirname, '..', 'dist', 'icon.png'));
}

console.log(`[copy-static] copied renderer assets -> ${destDir}`);

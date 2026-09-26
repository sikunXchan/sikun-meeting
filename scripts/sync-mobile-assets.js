// デスクトップと同じHTML整形・Markdown変換・ペルソナ画像をPWAへコピーする。npm run build の後に実行する。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'mobile', 'public');
const copies = [
  [path.join(root, 'dist', 'renderer', 'sanitize.js'), path.join(target, 'js', 'sanitize.js')],
  [path.join(root, 'node_modules', 'marked', 'lib', 'marked.umd.js'), path.join(target, 'vendor', 'marked.umd.js')],
];
for (const [from, to] of copies) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
const personas = path.join(root, 'src', 'renderer', 'assets', 'personas');
fs.mkdirSync(path.join(target, 'personas'), { recursive: true });
for (const file of fs.readdirSync(personas).filter((name) => name.endsWith('.png'))) {
  fs.copyFileSync(path.join(personas, file), path.join(target, 'personas', file));
}
console.log('[sync-mobile-assets] copied sanitize.js, marked.umd.js and persona images -> mobile/public');

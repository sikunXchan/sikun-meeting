// PWAのアイコンを build/icon.png から作る。Electronで実行する: npx electron scripts/make-mobile-icons.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  const out = path.join(__dirname, '..', 'mobile', 'public', 'icons');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    fs.writeFileSync(path.join(out, name), source.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  console.log('[make-mobile-icons] wrote', fs.readdirSync(out).join(', '));
  app.quit();
});

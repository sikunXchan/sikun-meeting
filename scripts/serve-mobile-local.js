// Vercelへデプロイする前に、同じAPIとPWAを手元で動かす。
// 使い方: SYNC_TOKEN=16文字以上の値 node scripts/serve-mobile-local.js [ポート] [保存先ディレクトリ]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const port = Number(process.argv[2] || 3000);
const storeDir = path.resolve(process.argv[3] || path.join(__dirname, '..', 'mobile', '.local-blob'));
const publicDir = path.join(__dirname, '..', 'mobile', 'public');
const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mobile', 'vercel.json'), 'utf8'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

function headersFor(pathname) {
  const result = {};
  for (const rule of vercel.headers) {
    const pattern = new RegExp(`^${rule.source.replace('(.*)', '.*')}$`);
    if (pattern.test(pathname)) for (const header of rule.headers) result[header.key] = header.value;
  }
  delete result['Strict-Transport-Security'];
  return result;
}

const storage = {
  file: (pathname) => path.join(storeDir, pathname.replace(/[^a-z0-9/._-]/gi, '_')),
  async read(pathname) { try { return await fs.promises.readFile(this.file(pathname), 'utf8'); } catch { return null; } },
  async write(pathname, text) { await fs.promises.mkdir(path.dirname(this.file(pathname)), { recursive: true }); await fs.promises.writeFile(this.file(pathname), text); },
  async remove(pathname) { await fs.promises.rm(this.file(pathname), { force: true }); },
};

async function main() {
  const { createHandler } = await import(pathToFileURL(path.join(__dirname, '..', 'mobile', 'lib', 'handler.js')).href);
  const handle = createHandler({ storage, syncToken: process.env.SYNC_TOKEN || '' });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/snapshot') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const response = await handle(new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }));
      res.writeHead(response.status, { ...headersFor(url.pathname), ...Object.fromEntries(response.headers) });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const relative = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.join(publicDir, relative);
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, headersFor(url.pathname)); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', ...headersFor(url.pathname) });
    fs.createReadStream(file).pipe(res);
  });
  server.listen(port, '127.0.0.1', () => console.log(`[serve-mobile-local] http://127.0.0.1:${port} (保存先 ${storeDir}, SYNC_TOKEN ${process.env.SYNC_TOKEN ? '設定済み' : '未設定'})`));
}

main().catch((error) => { console.error(error); process.exit(1); });

import { createHash, timingSafeEqual } from 'node:crypto';

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const ID_PATTERN = /^[0-9a-f]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

/** 長さの違いも含めて一定時間で比較するため、両者をハッシュしてから比べる。 */
function sameToken(given, expected) {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

function authorized(request, syncToken) {
  if (!syncToken) return false;
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer (.+)$/.exec(header);
  return Boolean(match) && sameToken(match[1], syncToken);
}

export function validEnvelope(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && value.v === 1 && value.alg === 'A256GCM' && value.gzip === true
    && typeof value.iv === 'string' && value.iv.length === 16 && BASE64_PATTERN.test(value.iv)
    && typeof value.data === 'string' && value.data.length > 0 && BASE64_PATTERN.test(value.data)
    && Object.keys(value).length === 5;
}

/**
 * 暗号文だけを扱う保存API。storage は { read(pathname), write(pathname, text), remove(pathname) }。
 * サーバーは鍵を持たないため中身を復号しない。
 */
export function createHandler({ storage, syncToken }) {
  return async function handle(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'invalid id' });
    const pathname = `snapshots/${id}.json`;

    if (request.method === 'GET') {
      const text = await storage.read(pathname);
      if (text === null) return json(404, { error: 'not found' });
      return new Response(text, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }

    if (request.method !== 'PUT' && request.method !== 'DELETE') {
      return json(405, { error: 'method not allowed' }, { Allow: 'GET, PUT, DELETE' });
    }
    if (!authorized(request, syncToken)) return json(401, { error: 'unauthorized' });

    if (request.method === 'DELETE') {
      await storage.remove(pathname);
      return json(200, { ok: true });
    }

    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) return json(413, { error: 'too large' });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return json(413, { error: 'too large' });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return json(400, { error: 'invalid json' }); }
    if (!validEnvelope(parsed)) return json(400, { error: 'invalid envelope' });
    await storage.write(pathname, JSON.stringify(parsed));
    return json(200, { ok: true, bytes: Buffer.byteLength(text) });
  };
}

// デスクトップ（src/core/mobile/envelope.ts）と同じ手順で鍵を導き、暗号文を復号する。
const encoder = new TextEncoder();
const SALT = encoder.encode('sikun-meeting-mobile-v1');

export function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isShareKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  try { return base64UrlToBytes(value).length === 32; } catch { return false; }
}

export async function deriveKeys(shareKey) {
  if (!isShareKey(shareKey)) throw new Error('鍵の形式が正しくありません');
  const material = await crypto.subtle.importKey('raw', base64UrlToBytes(shareKey), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode('enc') },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const idBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: SALT, info: encoder.encode('id') }, material, 256);
  return { aesKey, id: toHex(idBits) };
}

export async function decryptEnvelope(envelope, aesKey) {
  if (!envelope || envelope.v !== 1 || envelope.alg !== 'A256GCM' || envelope.gzip !== true) throw new Error('対応していない形式です');
  const compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(envelope.iv) }, aesKey, base64ToBytes(envelope.data));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

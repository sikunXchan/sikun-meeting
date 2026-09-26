import { createCipheriv, hkdfSync, randomBytes } from 'crypto';
import { gzipSync } from 'zlib';

const SALT = Buffer.from('sikun-meeting-mobile-v1');

export interface Envelope {
  v: 1;
  alg: 'A256GCM';
  gzip: true;
  iv: string;
  data: string;
}

export function createShareKey(): string {
  return randomBytes(32).toString('base64url');
}

function keyBytes(shareKey: string): Buffer {
  const bytes = Buffer.from(shareKey, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== shareKey) throw new Error('共有鍵の形式が不正です');
  return bytes;
}

/** mobile/public/js/crypto.js の deriveKeys と同じ導出。 */
export function deriveShareKeys(shareKey: string): { encryptionKey: Buffer; id: string } {
  const material = keyBytes(shareKey);
  return {
    encryptionKey: Buffer.from(hkdfSync('sha256', material, SALT, Buffer.from('enc'), 32)),
    id: Buffer.from(hkdfSync('sha256', material, SALT, Buffer.from('id'), 32)).toString('hex'),
  };
}

export function encryptSnapshot(plaintext: string, encryptionKey: Buffer): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(plaintext, 'utf8'))), cipher.final(), cipher.getAuthTag()]);
  return { v: 1, alg: 'A256GCM', gzip: true, iv: iv.toString('base64'), data: encrypted.toString('base64') };
}

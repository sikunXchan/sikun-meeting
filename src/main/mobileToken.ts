import * as fs from 'fs';
import * as path from 'path';
import { safeStorage } from 'electron';
import { TokenStore } from '../core/mobile/service';

const ENV_NAME = 'SIKUN_MOBILE_SYNC_TOKEN';

function secureAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Linuxで鍵管理サービスがない場合の basic_text は実質平文なので使わない。
  const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend?.() : undefined;
  return backend !== 'basic_text' && backend !== 'unknown';
}

/** 同期トークンをOSの暗号化保存（DPAPI・キーチェーン等）で保持する。使えない環境では環境変数だけを使う。 */
export function createTokenStore(dataDir: string): TokenStore {
  const file = path.join(dataDir, 'mobile-token.bin');
  return {
    get() {
      if (fs.existsSync(file) && secureAvailable()) {
        try { return safeStorage.decryptString(fs.readFileSync(file)); } catch { /* 読めない場合は環境変数へ */ }
      }
      return process.env[ENV_NAME]?.trim() || null;
    },
    set(token: string) {
      if (!secureAvailable()) throw new Error(`この環境ではトークンを安全に保存できません。環境変数 ${ENV_NAME} に設定してアプリを再起動してください`);
      fs.writeFileSync(file, safeStorage.encryptString(token), { mode: 0o600 });
    },
    source() {
      if (fs.existsSync(file) && secureAvailable()) return 'secure';
      return process.env[ENV_NAME]?.trim() ? 'env' : 'none';
    },
  };
}

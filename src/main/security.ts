import * as path from 'path';
import { pathToFileURL } from 'url';

export function rendererUrl(): string {
  return pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href;
}

/** アプリ自身の画面（file:// の renderer/index.html）かどうか。クエリとハッシュは無視する。 */
export function isAppUrl(url: string | undefined | null, expected = rendererUrl()): boolean {
  if (!url) return false;
  try {
    const actual = new URL(url);
    const target = new URL(expected);
    return actual.protocol === 'file:' && actual.pathname === target.pathname && actual.host === target.host;
  } catch {
    return false;
  }
}

export function isExternalWebUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

export function assertTrustedSender(event: { senderFrame?: { url: string } | null }, expected = rendererUrl()): void {
  if (!isAppUrl(event.senderFrame?.url, expected)) throw new Error('許可されていない画面からの呼び出しです');
}

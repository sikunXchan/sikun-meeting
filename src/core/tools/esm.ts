/**
 * ESM専用パッケージ（diff・culori・svgo・pixelmatch・smol-toml・pdfjs-dist）の読み込み。
 * CommonJSへ変換される通常の import() は require() になり失敗するため、new Function 経由で読む。
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
const cache = new Map<string, Promise<any>>();
export function importEsm<T = any>(specifier: string): Promise<T> {
  if (!cache.has(specifier)) cache.set(specifier, dynamicImport(specifier));
  return cache.get(specifier)!;
}

import * as fs from 'fs';
import * as path from 'path';

/** メインプロセスが選択時に読み取ったスナップショット。IPCから直接受け取らない。 */
export interface ReferenceSnapshot { name: string; content: Buffer }
export const MAX_REFERENCE_FILES = 10;
export const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_REFERENCE_BYTES = 100 * 1024 * 1024;

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** 作業リポジトリから独立したアプリデータ領域へ保存する。既存ファイルは上書きしない。 */
export function persistReferences(dataDir: string, id: string, workingDirectory: string, files: readonly ReferenceSnapshot[]): string[] {
  if (!files.length) return [];
  if (files.length > MAX_REFERENCE_FILES) throw new Error('参考資料は10件までです');
  let bytes = 0;
  for (const file of files) {
    if (!file || typeof file.name !== 'string' || !file.name || /[\\/:\x00-\x1f]/.test(file.name)
      || file.name === '.' || file.name === '..' || !Buffer.isBuffer(file.content)
      || file.content.length > MAX_REFERENCE_BYTES) throw new Error('参考資料が不正です');
    bytes += file.content.length;
  }
  if (bytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error('参考資料は合計100 MBまでです');
  const base = path.join(fs.realpathSync(dataDir), 'commission-references');
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('参考資料の保存先が不正です');
  fs.mkdirSync(base, { recursive: true });
  const realBase = fs.realpathSync(base);
  if (inside(fs.realpathSync(workingDirectory), realBase)) throw new Error('参考資料の保存領域を含まない作業フォルダを選んでください');
  for (let parent = realBase; ; parent = path.dirname(parent)) {
    if (fs.existsSync(path.join(parent, '.git'))) throw new Error('参考資料の保存先をGitリポジトリの外にしてください');
    if (parent === path.dirname(parent)) break;
  }
  const destination = path.join(realBase, id);
  if (path.dirname(destination) !== realBase) throw new Error('参考資料の保存先が不正です');
  fs.mkdirSync(destination); // 新規案件だけ。既存のsymlinkやフォルダも受け付けない。
  const written: string[] = [];
  try {
    files.forEach((file, index) => {
      const target = path.join(destination, `${index + 1}-${file.name}`);
      fs.writeFileSync(target, file.content, { flag: 'wx', mode: 0o600 });
      written.push(target);
    });
    return written;
  } catch (error) {
    for (const file of written) fs.unlinkSync(file);
    fs.rmdirSync(destination);
    throw error;
  }
}

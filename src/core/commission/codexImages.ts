import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Codex の組み込み画像生成（image_gen）の生成物を作業フォルダへ取り込む。
 * 生成物は $CODEX_HOME/generated_images/ に保存され、実行イベント（SDKの ThreadItem）には現れない。
 * 実行中に作られた画像のうち、作業フォルダに同じ内容が無いものを generated-images/ へコピーする。
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', '.venv', 'dist', 'build']);
export const GENERATED_IMAGE_FOLDER = 'generated-images';

export function codexHomeDirectory(env: NodeJS.ProcessEnv): string {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function imageFiles(root: string, depth: number, limit: number, found: string[] = []): string[] {
  if (depth < 0 || found.length >= limit) return found;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return found; }
  for (const entry of entries) {
    if (found.length >= limit) break;
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && !SKIP_DIRECTORIES.has(entry.name)) imageFiles(full, depth - 1, limit, found);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
  }
  return found;
}

const digest = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export interface CollectedImage { relativePath: string; copied: boolean }

/** since（ミリ秒）以降に作られた生成画像を作業フォルダへ取り込み、作業フォルダ内の相対パスを返す。 */
export function collectGeneratedImages(codexHome: string, since: number, workingDirectory: string): CollectedImage[] {
  const generated = imageFiles(path.join(codexHome, 'generated_images'), 6, 200)
    .filter((file) => { try { return fs.statSync(file).mtimeMs >= since - 1000; } catch { return false; } })
    .sort();
  if (!generated.length) return [];
  const existing = new Map<string, string>();
  for (const file of imageFiles(workingDirectory, 6, 2000)) {
    try { existing.set(digest(file), path.relative(workingDirectory, file)); } catch { /* 読めないファイルは照合しない */ }
  }
  const results: CollectedImage[] = [];
  for (const file of generated) {
    const hash = digest(file);
    const placed = existing.get(hash);
    if (placed) { results.push({ relativePath: placed.split(path.sep).join('/'), copied: false }); continue; }
    const folder = path.join(workingDirectory, GENERATED_IMAGE_FOLDER);
    fs.mkdirSync(folder, { recursive: true });
    const extension = path.extname(file).toLowerCase();
    const stem = path.basename(file, path.extname(file)).replace(/[^\w.-]/g, '_').slice(0, 80) || 'image';
    let name = `${stem}${extension}`;
    for (let n = 2; fs.existsSync(path.join(folder, name)); n++) name = `${stem}-${n}${extension}`;
    fs.copyFileSync(file, path.join(folder, name));
    const relativePath = `${GENERATED_IMAGE_FOLDER}/${name}`;
    existing.set(hash, relativePath);
    results.push({ relativePath, copied: true });
  }
  return results;
}

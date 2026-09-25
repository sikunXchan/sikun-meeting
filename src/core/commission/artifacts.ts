import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

export type WorkspaceSnapshot = Map<string, string>;
const ignored = new Set([
  '.git', 'node_modules', 'dist', 'release', '.next', '.venv', 'venv',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.nox',
]);

/** 作業ディレクトリ内のファイルをハッシュで比較する。上限超過は黙って欠落させない。 */
export async function snapshotWorkspace(root: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = new Map();
  const pending = [root];
  let totalBytes = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        const info = await fs.promises.stat(absolute);
        if (info.size > 10 * 1024 * 1024) continue;
        totalBytes += info.size;
        if (snapshot.size >= 3000 || totalBytes > 100 * 1024 * 1024) {
          throw new Error('成果物の走査上限を超えました。作業ディレクトリを小さくしてください');
        }
        const content = await fs.promises.readFile(absolute);
        snapshot.set(path.relative(root, absolute), createHash('sha256').update(content).digest('hex'));
      }
    }
  }
  return snapshot;
}

export function compareSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): Array<{
  relativePath: string;
  change: 'added' | 'modified' | 'deleted';
  beforeHash?: string;
  afterHash?: string;
}> {
  const changes: ReturnType<typeof compareSnapshots> = [];
  for (const relativePath of new Set([...before.keys(), ...after.keys()])) {
    const beforeHash = before.get(relativePath);
    const afterHash = after.get(relativePath);
    if (beforeHash === afterHash) continue;
    changes.push({
      relativePath,
      change: beforeHash === undefined ? 'added' : afterHash === undefined ? 'deleted' : 'modified',
      beforeHash, afterHash,
    });
  }
  return changes.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

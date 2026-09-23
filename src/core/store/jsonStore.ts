import * as fs from 'fs';
import * as path from 'path';
import { DB } from '../types';

function emptyDB(): DB {
  return { projects: [], meetings: [] };
}

/**
 * 単一JSONファイルに全データを永続化する、シンプルなファイルストア。
 * 書き込みはテンポラリファイル→renameのアトミック置換にして破損を防ぐ。
 */
export class JsonStore {
  private filePath: string;
  private data: DB;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'db.json');
    this.data = this.load();
  }

  private load(): DB {
    if (!fs.existsSync(this.filePath)) {
      return emptyDB();
    }
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...emptyDB(), ...parsed };
    } catch (err) {
      console.error('[JsonStore] failed to load db.json, starting fresh:', err);
      return emptyDB();
    }
  }

  getSnapshot(): DB {
    return this.data;
  }

  /** データを書き換えて永続化する。mutator内で this.data を直接書き換える。 */
  async mutate<T>(mutator: (db: DB) => T): Promise<T> {
    const result = mutator(this.data);
    await this.persist();
    return result;
  }

  private persist(): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this.writeToDisk());
    return this.writeQueue;
  }

  private async writeToDisk(): Promise<void> {
    const tmpPath = `${this.filePath}.tmp`;
    await fs.promises.writeFile(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
    await fs.promises.rename(tmpPath, this.filePath);
  }
}

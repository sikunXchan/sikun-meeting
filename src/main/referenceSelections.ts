import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { MAX_REFERENCE_BYTES, MAX_REFERENCE_FILES, MAX_TOTAL_REFERENCE_BYTES, ReferenceSnapshot } from '../core/commission/references';

export interface SelectedReference { id: string; name: string }
interface Selection extends ReferenceSnapshot { id: string; reserved: boolean }

/** rendererはパスを指定できない。選択内容はウィンドウに紐づけ、一度の依頼作成で消費する。 */
export class ReferenceSelections {
  private owners = new Map<number, Map<string, Selection>>();

  clear(owner: number): void { this.owners.delete(owner); }

  private resolve(owner: number, ids: unknown): Selection[] {
    if (!Array.isArray(ids) || ids.length > MAX_REFERENCE_FILES) throw new Error('参考資料は10件までです');
    if (new Set(ids).size !== ids.length) throw new Error('参考資料の指定が重複しています');
    return ids.map(id => {
      const file = typeof id === 'string' ? this.owners.get(owner)?.get(id) : undefined;
      if (!file || file.reserved) throw new Error('参考資料を選び直してください');
      return file;
    });
  }

  /** pathsにはメインプロセスのdialogの結果だけを渡す。既存の選択は明示したIDだけ保持。 */
  select(owner: number, paths: string[], retainedIds: unknown = []): SelectedReference[] {
    const retained = this.resolve(owner, retainedIds);
    if (paths.length + retained.length > MAX_REFERENCE_FILES) throw new Error('参考資料は10件までです');
    if ([...this.owners.get(owner)?.values() || []].some(file => file.reserved)) throw new Error('依頼の作成が終わるまでお待ちください');
    let bytes = retained.reduce((sum, file) => sum + file.content.length, 0);
    const selected = paths.map(source => {
      const resolved = fs.realpathSync(source);
      const descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      try {
        const info = fs.fstatSync(descriptor);
        if (!info.isFile() || info.size > MAX_REFERENCE_BYTES) throw new Error('参考資料は1件20 MBまでのファイルを選んでください');
        bytes += info.size;
        if (bytes > MAX_TOTAL_REFERENCE_BYTES) throw new Error('参考資料は合計100 MBまでです');
        // 読み取り中に増大したファイルでも上限を超えてメモリを確保しない。
        const content = Buffer.alloc(info.size);
        let read = 0;
        while (read < content.length) {
          const count = fs.readSync(descriptor, content, read, content.length - read, read);
          if (!count) break;
          read += count;
        }
        const after = fs.fstatSync(descriptor);
        if (read !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('変更中の参考資料を選び直してください');
        return { id: randomUUID(), name: path.basename(source), content, reserved: false };
      } finally { fs.closeSync(descriptor); }
    });
    const all = [...retained, ...selected];
    if (all.reduce((sum, file) => sum + file.content.length, 0) > MAX_TOTAL_REFERENCE_BYTES) throw new Error('参考資料は合計100 MBまでです');
    this.owners.set(owner, new Map(all.map(file => [file.id, file])));
    return all.map(({ id, name }) => ({ id, name }));
  }

  async consume<T>(owner: number, ids: unknown, action: (files: ReferenceSnapshot[]) => Promise<T>): Promise<T> {
    const files = this.resolve(owner, ids);
    files.forEach(file => { file.reserved = true; });
    try {
      const result = await action(files.map(({ name, content }) => ({ name, content: Buffer.from(content) })));
      files.forEach(file => this.owners.get(owner)?.delete(file.id));
      return result;
    } finally { files.forEach(file => { file.reserved = false; }); }
  }
}

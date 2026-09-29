import * as fs from 'fs/promises';
import * as path from 'path';
import { Commission } from '../core/commission/types';
import { Workbook } from 'exceljs';

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const textExtensions = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.html', '.htm', '.css', '.js', '.ts', '.py', '.yaml', '.yml', '.xml', '.log']);
const imageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** Only tracked artifacts inside the real working directory may be read. */
export async function resolveArtifactPath(commission: Commission, artifactId: string): Promise<string> {
  const artifact = commission.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact || artifact.change === 'deleted') throw new Error('成果ファイルが見つかりません');
  const root = await fs.realpath(commission.workingDirectory);
  const target = await fs.realpath(path.resolve(root, artifact.relativePath));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('成果ファイルの場所が不正です');
  return target;
}

export async function readArtifactPreview(commission: Commission, artifactId: string) {
  const target = await resolveArtifactPath(commission, artifactId);
  const file = await fs.open(target, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('ファイルではありません');
    const name = path.basename(target), extension = path.extname(name).toLowerCase();
    if (info.size > MAX_PREVIEW_BYTES) return { kind: 'unsupported', name, reason: '4 MBを超えるファイルです。ファイルの場所から開いてください。' };
    if (!imageTypes[extension] && !textExtensions.has(extension) && !['.pdf','.xlsx'].includes(extension)) return { kind: 'unsupported', name, reason: 'この形式は、ファイルの場所から対応アプリで開けます。' };
    // Bounded read also protects against a file growing while an agent writes it.
    const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_PREVIEW_BYTES) return { kind: 'unsupported', name, reason: 'ファイルが大きいためプレビューできません。' };
    const data = buffer.subarray(0, bytesRead);
    if (extension === '.pdf') {
      if (!data.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('PDFの形式を確認できません');
      return { kind: 'pdf', name, content: data.toString('base64') };
    }
    if (extension === '.xlsx') {
      // Check declared expansion sizes before handing the local archive to the workbook parser.
      let expanded=0, entries=0;
      for(let offset=0;offset<data.length-46;offset++) {
        if(data.readUInt32LE(offset)!==0x02014b50)continue;
        expanded+=data.readUInt32LE(offset+24);entries++;
        if(expanded>64*1024*1024||entries>1000)throw new Error('表が大きいため、対応アプリから開いてください');
        offset+=45+data.readUInt16LE(offset+28)+data.readUInt16LE(offset+30)+data.readUInt16LE(offset+32);
      }
      const workbook=new Workbook();await workbook.xlsx.load(data as any);
      const sheets=workbook.worksheets.slice(0,20).map(sheet=>({name:sheet.name,
        rows:Array.from({length:Math.min(sheet.rowCount,200)},(_,r)=>Array.from({length:Math.min(sheet.columnCount,30)},(_,c)=>sheet.getCell(r+1,c+1).text.slice(0,3000))),
        truncated:sheet.rowCount>200||sheet.columnCount>30,
      }));
      return {kind:'sheet',name,sheets};
    }
    if (imageTypes[extension]) return { kind: 'image', name, content: `data:${imageTypes[extension]};base64,${data.toString('base64')}` };
    return { kind: ['.md', '.markdown'].includes(extension) ? 'markdown' : ['.html', '.htm'].includes(extension) ? 'html' : 'text', name, content: data.toString('utf8') };
  } finally { await file.close(); }
}

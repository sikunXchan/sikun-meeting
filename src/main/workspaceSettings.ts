import * as fs from 'fs';
import * as path from 'path';

export interface WorkspacePreferences {
  fields: Record<string,string>;
  flags: Record<string,boolean>;
  executionMode: 'automatic'|'review';
  modelMode: 'recommended'|'custom';
}
const textFields = new Set(['commission-provider','commission-dir','commission-model-codex','commission-model-consultant','commission-model-planner','commission-model-worker','commission-model-reviewer','commission-model-critical','commission-model-fallback','commission-model-by-persona']);
const numbers: Record<string,[number,number]> = {'commission-max-calls':[1,5000],'commission-max-turns':[1,100],'commission-max-cycles':[1,100],'commission-retry-limit':[0,10]};
export function normalizeWorkspacePreferences(raw: Partial<WorkspacePreferences>): WorkspacePreferences {
  const fields:Record<string,string>={},flags:Record<string,boolean>={};
  for(const [key,value] of Object.entries(raw?.fields||{})) {
    if(!textFields.has(key)&&!numbers[key])continue;
    if(typeof value!=='string'||value.length>(key==='commission-model-by-persona'?5000:1000))throw new Error('設定値が不正です');
    if(numbers[key]&&(!Number.isInteger(Number(value))||Number(value)<numbers[key][0]||Number(value)>numbers[key][1]))throw new Error('回数の設定が範囲外です');
    fields[key]=value.trim();
  }
  if(fields['commission-provider']&&!['claude','codex'].includes(fields['commission-provider']))throw new Error('AIの設定が不正です');
  for(const key of ['commission-autonomy'])if(typeof raw?.flags?.[key]==='boolean')flags[key]=raw.flags[key];
  if(!flags['commission-autonomy']&&Number(fields['commission-max-calls'])>200)throw new Error('自動再試行を無効にする場合、AIの最大呼び出し回数は200回までです');
  return {fields,flags,executionMode:raw?.executionMode==='review'?'review':'automatic',modelMode:raw?.modelMode==='custom'?'custom':'recommended'};
}
export class WorkspaceSettingsStore {
  private file:string;
  constructor(directory:string){this.file=path.join(directory,'workspace-preferences.json');}
  get():WorkspacePreferences {try{return normalizeWorkspacePreferences(JSON.parse(fs.readFileSync(this.file,'utf8')));}catch{return normalizeWorkspacePreferences({});}}
  set(raw:Partial<WorkspacePreferences>):WorkspacePreferences {const value=normalizeWorkspacePreferences(raw);fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(this.file+'.tmp',this.file);return value;}
}

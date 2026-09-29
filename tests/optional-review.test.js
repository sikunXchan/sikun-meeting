const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {JsonStore}=require('../dist/core/store/jsonStore');
const {Repository}=require('../dist/core/store/repository');
const {ProjectService}=require('../dist/core/services/projectService');
const {CommissionStore}=require('../dist/core/commission/store');
const {CommissionService}=require('../dist/core/commission/service');
const plan=JSON.stringify({tasks:[{title:'文書作成',instructions:'hello.txtを作る',acceptance:'ファイルがある',ownerPersonaId:'engineer',reviewerPersonaId:'qa'}]});
async function setup(t,consult=()=> '企画: hello.txtを作る',workHook) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-autonomy-'));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 const repo=new Repository(new JsonStore(dir)), project=await new ProjectService(repo).createProject('test','');
 const store=new CommissionStore(dir), calls=[];
 const agent={async run(request){calls.push(request);let text;
  if(request.phase==='consultation')text=await consult(request);
  else if(request.phase==='planning')text=plan;
  else if(request.phase==='work'){await workHook?.(request);fs.writeFileSync(path.join(request.workingDirectory,'hello.txt'),'done');text='作成済み';}
  else if(request.phase==='review'){assert.equal(fs.readFileSync(path.join(request.workingDirectory,'hello.txt'),'utf8'),'done');text=JSON.stringify({approved:true,note:'実ファイルを確認'});}
  else text='hello.txtを納品';
  return {text,observedModels:['test'],estimatedCostUsd:0,numTurns:1};
 }};
 const service=new CommissionService(store,repo,agent,dir);
 return {dir,project,store,service,calls};
}
async function delivered(f,id) {
 for(let i=0;i<150;i++){const item=f.store.get(id);if(item.status==='delivered')return item;if(item.status==='failed')throw Error(item.error);await new Promise(r=>setTimeout(r,20));}
 throw Error('delivery timeout');
}
test('自動進行は人の企画確定なしで成果物作成・内部確認・納品まで完走する',async t=>{
 const f=await setup(t);const item=await f.service.create({projectId:f.project.id,goal:'文書を作る',settings:{executionMode:'automatic'}});
 await f.service.consult(item.id,item.goal);const result=await delivered(f,item.id);
 assert.deepEqual(f.calls.map(c=>c.phase),['consultation','planning','work','review','delivery']);
 assert.match(f.calls[0].prompt,/追加の回答を待たず/);
 assert.equal(result.artifacts[0].status,'accepted');assert.equal(result.reviewDecisions[0].approved,true);
 assert.ok(f.store.events(item.id).some(e=>e.detail.includes('自動進行の設定')));
 assert.ok(!f.store.events(item.id).some(e=>e.detail.includes('発注者が企画を確定')));
});
test('確認モードと設定省略の既存クライアントは人の企画確定を待つ',async t=>{
 const f=await setup(t);
 for(const settings of [{executionMode:'review'},undefined]){
  const item=await f.service.create({projectId:f.project.id,goal:'文書を作る',settings});await f.service.consult(item.id,item.goal);
  assert.equal(f.store.get(item.id).status,'consulting');assert.equal(f.store.get(item.id).workItems.length,0);
 }
 assert.ok(f.calls.every(c=>c.tools==='read'));
});
test('相談に失敗しても実作業せず、同じ案件で再試行できる',async t=>{
 let attempt=0;const f=await setup(t,()=>{if(++attempt===1)throw Error('接続失敗');return '有効な企画';});
 const item=await f.service.create({projectId:f.project.id,goal:'文書作成',settings:{executionMode:'automatic'}});
 await assert.rejects(f.service.consult(item.id,item.goal),/接続失敗/);
 assert.equal(f.store.get(item.id).status,'consulting');assert.equal(f.calls.length,1);assert.match(f.store.get(item.id).error,/接続失敗/);
 await f.service.consult(item.id,item.goal);const result=await delivered(f,item.id);assert.equal(result.error,undefined);
});
test('空の企画回答や不正な進行モードで作業を開始しない',async t=>{
 const f=await setup(t,()=> '   ');
 await assert.rejects(f.service.create({projectId:f.project.id,goal:'文書',settings:{executionMode:'invalid'}}),/進め方/);
 const item=await f.service.create({projectId:f.project.id,goal:'文書',settings:{executionMode:'automatic'}});
 await assert.rejects(f.service.consult(item.id,item.goal),/AIの企画案/);
 assert.equal(f.store.get(item.id).status,'consulting');assert.equal(f.store.get(item.id).workItems.length,0);
});
test('保存済みの進行設定を再読込し、古い案件は確認モードに補完する',async t=>{
 const f=await setup(t);
 const automatic=await f.service.create({projectId:f.project.id,goal:'A',settings:{executionMode:'automatic'}});
 const legacy=await f.service.create({projectId:f.project.id,goal:'B'});
 await f.store.update(legacy.id,item=>{delete item.settings.executionMode;});
 const reloaded=new CommissionStore(f.dir);
 assert.equal(reloaded.get(automatic.id).settings.executionMode,'automatic');assert.equal(reloaded.get(legacy.id).settings.executionMode,'review');
});

test('作業中の追加指示は旧実行を止め、指示を渡して再開する',async t=>{
 let started;const ready=new Promise(resolve=>started=resolve);let first=true,active=0,maxActive=0;
 const f=await setup(t,undefined,async request=>{active++;maxActive=Math.max(active,maxActive);try{if(first){first=false;started();await new Promise((resolve,reject)=>request.abortSignal.addEventListener('abort',()=>reject(Error('paused')),{once:true}));}}finally{active--;}});
 const item=await f.service.create({projectId:f.project.id,goal:'文書を作る',settings:{executionMode:'automatic'}});
 await f.service.consult(item.id,item.goal);await ready;
 await assert.rejects(f.service.addInstruction(item.id,'  '),/追加の指示/);
 assert.equal(f.store.get(item.id).status,'running');
 await f.service.addInstruction(item.id,'見出しを日本語にしてください');
 const result=await delivered(f,item.id);
 assert.equal(maxActive,1);assert.ok(result.revisionRequests.includes('見出しを日本語にしてください'));
 assert.ok(f.calls.filter(c=>c.phase==='work').slice(1).every(c=>c.prompt.includes('見出しを日本語にしてください')));
});
test('企画未確定の案件に追加指示APIで実作業を始めさせない',async t=>{
 const f=await setup(t);const item=await f.service.create({projectId:f.project.id,goal:'文書を作る'});
 await assert.rejects(f.service.addInstruction(item.id,'追加してください'),/作業開始後/);
 assert.equal(f.calls.length,0);assert.equal(f.store.get(item.id).status,'consulting');
});

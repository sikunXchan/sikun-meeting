const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {JsonStore}=require('../dist/core/store/jsonStore');
const {Repository}=require('../dist/core/store/repository');
const {MeetingService}=require('../dist/core/services/meetingService');
const {DiscussionService}=require('../dist/core/services/discussionService');
const {MeetingAutomationService}=require('../dist/core/services/meetingAutomationService');
const {WorkspaceSettingsStore}=require('../dist/main/workspaceSettings');
const {readArtifactPreview}=require('../dist/main/artifactPreview');
const {CommissionStore}=require('../dist/core/commission/store');
const {CommissionService}=require('../dist/core/commission/service');
const {ProjectService}=require('../dist/core/services/projectService');
const {Workbook}=require('exceljs');
function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pearl-workspace-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function done(service,id){for(let i=0;i<300;i++){if(!service.isBusy(id))return;await delay(10);}throw Error('automatic meeting timeout');}
async function meeting(t,agent){const repo=new Repository(new JsonStore(folder(t)));const m=await new MeetingService(repo).createMeeting({title:'比較',agenda:'A案とB案を比べる',meetingTypeId:'product_review',personaIds:['product','engineer','qa']});const discussion=new DiscussionService(repo,agent);return {repo,m,discussion,auto:new MeetingAutomationService(repo,discussion,()=>{},()=>{},agent)};}

test('preferences persist, discard unknown fields and retain saved values after invalid edits',t=>{
 const dir=folder(t),store=new WorkspaceSettingsStore(dir);
 assert.equal(store.get().executionMode,'automatic');
 const value={fields:{'commission-provider':'codex','commission-max-calls':'42',unexpected:'discard'},flags:{'commission-autonomy':true},modelMode:'custom',executionMode:'review'};
 store.set(value);const saved=new WorkspaceSettingsStore(dir).get();assert.equal(saved.fields['commission-provider'],'codex');assert.equal(saved.fields.unexpected,undefined);
 assert.throws(()=>store.set({...value,fields:{'commission-max-calls':'999999'}}),/範囲外/);assert.deepEqual(store.get(),saved);
 assert.throws(()=>store.set({...value,flags:{},fields:{'commission-max-calls':'201'}}),/200/);
});
test('PDF signature and workbook content are previewed with bounded rows and literal text',async t=>{
 const dir=folder(t),item=file=>({workingDirectory:dir,artifacts:[{id:'a',relativePath:file,change:'added'}]});
 fs.writeFileSync(path.join(dir,'test.pdf'),'%PDF-1.7\nmock');assert.equal((await readArtifactPreview(item('test.pdf'),'a')).kind,'pdf');
 fs.writeFileSync(path.join(dir,'bad.pdf'),'not a PDF');await assert.rejects(readArtifactPreview(item('bad.pdf'),'a'),/PDF/);
 const book=new Workbook(),sheet=book.addWorksheet('売上');sheet.addRows([['月','売上'],['9月',124],['<script>bad()</script>',{formula:'1+1',result:2}]]);sheet.getCell('A201').value='last';await book.xlsx.writeFile(path.join(dir,'sales.xlsx'));
 const result=await readArtifactPreview(item('sales.xlsx'),'a');assert.equal(result.kind,'sheet');assert.equal(result.sheets[0].rows.length,200);assert.equal(result.sheets[0].truncated,true);assert.equal(result.sheets[0].rows[2][0],'<script>bad()</script>');assert.equal(result.sheets[0].rows[2][1],'2');
});
test('references are snapshotted into the request folder and supplied to the agent',async t=>{
 const dir=folder(t),repo=new Repository(new JsonStore(dir)),project=await new ProjectService(repo).createProject('test','');let request;
 const store=new CommissionStore(dir),service=new CommissionService(store,repo,{async run(r){request=r;return {text:'企画です',observedModels:['test'],numTurns:1,estimatedCostUsd:0};}},dir);
 const file=path.join(dir,'source.txt');fs.writeFileSync(file,'original');const created=await service.create({projectId:project.id,goal:'資料を読む',referenceFiles:[file]});
 fs.writeFileSync(file,'modified');assert.equal(fs.readFileSync(path.join(created.workingDirectory,created.referenceFiles[0]),'utf8'),'original');await service.consult(created.id,created.goal);assert.ok(request.prompt.includes(created.referenceFiles[0]));
 await assert.rejects(service.create({projectId:project.id,goal:'test',referenceFiles:[dir]}),/ファイル/);await assert.rejects(service.create({projectId:project.id,goal:'test',referenceFiles:Array(11).fill(file)}),/10件/);
});
test('automatic meetings finish without human approval and preserve distinct decision state',async t=>{
 const prompts=[],agent=async(_p,prompt)=>{prompts.push(prompt);return {text:prompt.includes('提示された記録だけ')?'## 方向性\nA案。ただし検証を継続。':'【立場: 賛成】\n試験導入を提案します。',isError:false};};
 const f=await meeting(t,agent);await f.auto.start(f.m.id);await done(f.auto,f.m.id);const result=f.repo.getMeeting(f.m.id);
 assert.equal(result.automation.status,'completed');assert.equal(result.initialRound.status,'published');assert.equal(result.transcript.length,6);assert.equal(result.decision,null);assert.ok(result.transcript.every(m=>m.speakerType==='AI'));assert.equal(prompts.length,7);
 await f.discussion.humanSpeak(f.m.id,'予算も比較する');assert.equal(f.repo.getMeeting(f.m.id).automation.status,'paused');assert.equal(f.repo.getMeeting(f.m.id).automation.summary,'');
});
test('pause waits for the current turn and resume does not repeat collected independent answers',async t=>{
 let release,started;const ready=new Promise(r=>started=r),calls=[];const agent=async(p,prompt)=>{calls.push([p.id,prompt]);if(calls.length===1){started();await new Promise(r=>release=r);}return {text:'【立場: 賛成】\n根拠を確認',isError:false};};
 const f=await meeting(t,agent);await f.auto.start(f.m.id);await ready;await assert.rejects(f.auto.start(f.m.id),/進行中/);await assert.rejects(f.discussion.askAllActiveToSpeak(f.m.id),/発言中/);await f.auto.pause(f.m.id);release();await done(f.auto,f.m.id);
 assert.equal(f.repo.getMeeting(f.m.id).automation.status,'paused');assert.equal(f.repo.getMeeting(f.m.id).transcript.length,0);assert.equal(f.repo.getMeeting(f.m.id).initialRound.responses.length,1);
 await f.auto.start(f.m.id);await done(f.auto,f.m.id);assert.equal(f.repo.getMeeting(f.m.id).automation.status,'completed');assert.equal(calls.length,7);
});
test('failed automation can retry, and a restarted in-flight meeting requires explicit resume',async t=>{
 let fail=true;const f=await meeting(t,async()=>({text:fail?'connection failed':'【立場: 賛成】\n意見',isError:fail}));await f.auto.start(f.m.id);await done(f.auto,f.m.id);assert.equal(f.repo.getMeeting(f.m.id).automation.status,'failed');
 fail=false;await f.auto.start(f.m.id);await done(f.auto,f.m.id);assert.equal(f.repo.getMeeting(f.m.id).automation.status,'completed');
 await f.repo.updateMeeting(f.m.id,m=>{m.automation.status='running';});new MeetingAutomationService(f.repo,f.discussion,()=>{},()=>{},async()=>{throw Error('must not run');});await delay(30);assert.equal(f.repo.getMeeting(f.m.id).automation.status,'paused');
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {approvedTools,canReviewInBrowser}=require('../dist/core/capabilities');
const {codexThreadOptions}=require('../dist/core/commission/codexAgent');
const {PERSONAS}=require('../dist/core/personas');
test('Web research is available only to Researcher and Legal during work/review, without enabling their shell network',()=>{
 for(const p of PERSONAS)for(const phase of ['work','review','read','meeting']){
  const enabled=['researcher','legal'].includes(p.id)&&['work','review'].includes(phase);
  assert.equal(approvedTools(p.id,phase).includes('WebSearch'),enabled);
  assert.equal(approvedTools(p.id,phase).includes('WebFetch'),enabled);
  const options=codexThreadOptions({personaId:p.id,phase:phase==='read'||phase==='meeting'?'planning':phase,tools:phase==='read'||phase==='meeting'?'read':'full',model:'test',workingDirectory:process.cwd()});
  assert.equal(options.webSearchMode,enabled?'live':'disabled');
  if(['researcher','legal'].includes(p.id)){assert.equal(options.networkAccessEnabled,false);assert.equal(approvedTools(p.id,phase).includes('Bash'),false);}
 }
});
test('UI roles receive browser tools for work and review, failures remain unverified and every session closes',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sikun-role-tools-'));
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const {JsonStore}=require('../dist/core/store/jsonStore'),{Repository}=require('../dist/core/store/repository'),{ProjectService}=require('../dist/core/services/projectService');
 const {CommissionStore}=require('../dist/core/commission/store'),{CommissionService}=require('../dist/core/commission/service');
 const repo=new Repository(new JsonStore(root)),project=await new ProjectService(repo).createProject('test','');
 const sessions=[],calls=[];let failStart=false,failAgent=false;
 const service=new CommissionService(new CommissionStore(root),repo,{async run(request){calls.push(request);if(failAgent)throw Error('agent failed');return {text:'test',observedModels:[],numTurns:1,estimatedCostUsd:0};}},root,undefined,{browserFactory:(directory,files,allowNew)=>{
  const session={directory,files,allowNew,closed:false,async start(){if(failStart)throw Error('browser missing');},instructions(){return '\nBROWSER-TOOLS';},summary(){return 'keyboard checked';},async close(){this.closed=true;}};sessions.push(session);return session;
 }});
 const job=await service.create({projectId:project.id,goal:'UI verification'}),signal=new AbortController().signal;
 await service.callAgent(job.id,'work','frontend','create index.html','full',signal);
 assert.equal(sessions.at(-1).allowNew,true);assert.deepEqual(sessions.at(-1).files,[]);
 fs.writeFileSync(path.join(job.workingDirectory,'index.html'),'<button>Go</button>');
 for(const role of ['qa','frontend','accessibility','mobile'])for(const phase of ['work','review']){
  await service.callAgent(job.id,phase,role,'verify UI','full',signal);
  assert.match(calls.at(-1).prompt,/BROWSER-TOOLS/);assert.ok(sessions.at(-1).closed);
  assert.ok(sessions.at(-1).files.includes('index.html'));assert.equal(sessions.at(-1).allowNew,phase==='work');
 }
 const count=sessions.length;
 for(const role of ['legal','researcher','sales']){assert.equal(canReviewInBrowser(role),false);await service.callAgent(job.id,'work',role,'task','full',signal);}
 await service.callAgent(job.id,'planning','frontend','plan','read',signal);assert.equal(sessions.length,count);
 failStart=true;await service.callAgent(job.id,'review','accessibility','check','full',signal);
 assert.match(calls.at(-1).prompt,/未検証/);assert.ok(sessions.at(-1).closed);
 failStart=false;failAgent=true;await assert.rejects(service.callAgent(job.id,'work','frontend','task','full',signal),/agent failed/);
 assert.ok(sessions.at(-1).closed);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {PERSONAS,getPersonaById}=require('../dist/core/personas');
const {SPECIALIST_PROFILES}=require('../dist/core/specialties');
const {MEETING_TYPES}=require('../dist/core/meetingTypes');
const {approvedTools,codexPolicy,preapprovedTools,verificationToolsFor}=require('../dist/core/capabilities');
const {appliedSkillsFor,skillPromptFor,skillDetailsFor}=require('../dist/core/skills/catalog');
const {JsonStore}=require('../dist/core/store/jsonStore'),{Repository}=require('../dist/core/store/repository');
const {ProjectService}=require('../dist/core/services/projectService'),{MeetingService}=require('../dist/core/services/meetingService');
const {DiscussionService}=require('../dist/core/services/discussionService');
const {CommissionStore}=require('../dist/core/commission/store'),{CommissionService}=require('../dist/core/commission/service');
const {toMobileMeeting}=require('../dist/core/mobile/snapshot');
const expected=['architect','engineer','backend','devops','data_engineer','cloud','product','designer','qa','writer','support','researcher','analyst','ai_researcher','innovator','critic','visionary','finance','legal','marketing','security','frontend','mobile','embedded','accessibility','privacy','sales','data_scientist','human_resources','procurement','accountant','healthcare','localization','public_policy','manufacturing','logistics','sustainability','education'];
function fixture(t){const base=process.env.SIKUN_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});const dir=fs.mkdtempSync(path.join(base,'sikun-specialists-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));fs.rmSync(dir,{recursive:true,force:true});});const repo=new Repository(new JsonStore(dir));return {dir,repo};}
const response=text=>({text,observedModels:['test'],estimatedCostUsd:0,numTurns:1});
async function delivered(store,id){for(let i=0;i<500;i++){const item=store.get(id);if(item.status==='delivered')return item;if(item.status==='failed')throw Error(item.error);await new Promise(r=>setTimeout(r,10));}throw Error('delivery timeout');}

test('見本の全38分野と相談役が登録され、デスクトップとPWAに画像がある',()=>{
 assert.deepEqual(new Set(PERSONAS.map(p=>p.id)),new Set([...expected,'it_consultant']));assert.equal(PERSONAS.length,39);
 for(const id of expected){const p=getPersonaById(id);for(const dir of ['src/renderer/assets/personas','dist/renderer/assets/personas','mobile/public/personas']){const png=fs.readFileSync(path.resolve(__dirname,'..',dir,p.avatar));assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),160);assert.equal(png.readUInt32BE(20),160);}}
 for(const type of MEETING_TYPES)for(const id of type.defaultPersonaIds)assert.ok(getPersonaById(id),type.id+': '+id);
 for(const p of SPECIALIST_PROFILES){assert.ok(MEETING_TYPES.some(t=>t.defaultPersonaIds.includes(p.id)),p.id+' has a usable meeting template');for(const id of p.reviewerIds)assert.ok(getPersonaById(id));}
});

test('新分野のコード実行と閲覧権限を分け、仕事と確認で専門手順を適用する',()=>{
 for(const profile of SPECIALIST_PROFILES){
  assert.deepEqual(approvedTools(profile.id,'meeting'),['Read','Grep','Glob']);
  assert.equal(approvedTools(profile.id,'work').includes('Bash'),Boolean(profile.canRunCode));
  assert.equal(approvedTools(profile.id,'review').includes('Write'),false);
  assert.equal(codexPolicy(profile.id,'review').sandboxMode,'read-only');
  assert.equal(codexPolicy(profile.id,'work').networkAccessEnabled,Boolean(profile.canRunCode));
  for(const phase of ['meeting','work','review']){const prompt=skillPromptFor(profile.id,phase);assert.ok(prompt.includes(profile.outputs[0]));assert.ok(prompt.includes(skillDetailsFor(profile.id)[0].instructions));assert.ok(prompt.includes('権限を追加しない'));assert.equal(appliedSkillsFor(profile.id,phase).length,1);}
 }
});

test('追加17分野を会議に招集して個別質問でき、保存・モバイル表示でも役割を保持する',async t=>{
 const f=fixture(t),meetings=new MeetingService(f.repo),seen=new Set();
 const meeting=await meetings.createMeeting({title:'全分野の表示と発言確認',agenda:'各分野の成果物と検証方法',meetingTypeId:'brainstorming',personaIds:PERSONAS.map(p=>p.id)});
 const discussion=new DiscussionService(f.repo,async(persona,prompt)=>{seen.add(persona.id);assert.ok(prompt.includes(persona.roleTitle));return {text:'【立場: 条件付き賛成】根拠と検証項目を整理します。',isError:false};});
 await discussion.askAllActiveToSpeak(meeting.id);assert.equal(seen.size,39);seen.clear();
 for(const p of SPECIALIST_PROFILES){const participant=meeting.participants.find(x=>x.personaId===p.id);await discussion.askSpecific(meeting.id,participant.id,'担当分野の確認点を教えてください');}
 assert.equal(seen.size,17);
 const reloaded=new Repository(new JsonStore(f.dir)),saved=reloaded.getMeeting(meeting.id);
 assert.equal(saved.participants.length,39);assert.equal(saved.transcript.filter(m=>m.speakerType==='AI').length,56);
 const mobile=toMobileMeeting(saved);assert.equal(mobile.participants.length,39);
 for(const p of SPECIALIST_PROFILES){const entry=mobile.participants.find(m=>m.personaId===p.id);assert.equal(entry.avatar,p.id+'.png');assert.equal(entry.name,p.name);}
 const education=saved.participants.find(p=>p.personaId==='education');await meetings.deactivateParticipant(meeting.id,education.id);await meetings.inviteParticipant(meeting.id,'education');assert.equal(meetings.getMeeting(meeting.id).participants.length,39);
});

for(const profile of SPECIALIST_PROFILES)test(`${profile.name}: 自動で担当作業・所管レビュー・納品まで進み、専門手順の適用を記録する`,async t=>{
 const f=fixture(t),project=await new ProjectService(f.repo).createProject('test',''),store=new CommissionStore(f.dir),calls=[];
 const agent={async run(r){calls.push(r);let text;
  if(r.phase==='consultation')text=profile.outputs[0]+'と検証記録を作成する企画';
  else if(r.phase==='planning'){
   assert.ok(r.prompt.includes(profile.id+':'+profile.roleTitle.replace(/の専門家$/, '')));
   text=JSON.stringify({tasks:[{title:profile.outputs[0],instructions:'specialist.mdを作成',acceptance:'根拠と確認項目がある',ownerPersonaId:profile.id,domainPersonaId:profile.id,reviewerPersonaId:'critic'},
    {title:'技術支援の結果を分野の担当者が確認',instructions:'support.mdを作成',acceptance:'所管の確認を通過',ownerPersonaId:'engineer',domainPersonaId:profile.id,reviewerPersonaId:profile.id}]});
  } else if(r.phase==='work'){const file=r.personaId===profile.id?'specialist.md':'support.md';fs.writeFileSync(path.join(r.workingDirectory,file),'# '+profile.outputs[0]+'\n\n検証用の成果物。根拠と確認項目。');text=file+'を作成';}
  else if(r.phase==='review'){assert.ok(fs.existsSync(path.join(r.workingDirectory,r.personaId===profile.id?'support.md':'specialist.md')));text=JSON.stringify({approved:true,note:'実ファイルと確認条件を照合'});}
  else if(r.phase==='goal_check')text=JSON.stringify({complete:true,evidence:['成果ファイル2件を確認'],remaining:[]});
  else text='成果物を納品しました';
  return response(text);
 }};
 const service=new CommissionService(store,f.repo,agent,f.dir,undefined,{browserFactory:()=>({async start(){},instructions(){return '\nBrowser test fixture';},summary(){return '';},async close(){}})}),item=await service.create({projectId:project.id,goal:profile.outputs[0],successCriteria:'根拠と確認記録をファイルに保存',settings:{executionMode:'automatic',modelByPersona:{[profile.id]:'specialist-test-model'}}});
 await service.consult(item.id,item.goal);const done=await delivered(store,item.id);
 assert.equal(done.workItems.length,2);assert.ok(done.workItems.every(w=>w.status==='accepted'));assert.ok(done.goalChecks.at(-1).complete);
 assert.ok(done.artifacts.filter(a=>a.status==='accepted').length>=2);
 for(const phase of ['work','review']){const run=done.runs.find(r=>r.personaId===profile.id&&r.phase===phase);assert.ok(run);assert.deepEqual(run.appliedSkills,appliedSkillsFor(profile.id,phase));assert.equal(run.requestedModel,'specialist-test-model');}
 const saved=new CommissionStore(f.dir).get(item.id);assert.equal(saved.status,'delivered');assert.equal(saved.workItems[1].reviewerPersonaId,profile.id);
});

test('Claudeの実行クライアントへ新分野の専門手順とツール設定が渡る',async t=>{
 const claude=require('../dist/core/agent/claudeAgent'),original=claude.loadQuery,seen=[];
 claude.loadQuery=async()=>async function* (input){seen.push(input);yield {type:'result',subtype:'success',is_error:false,result:'検証用の応答',modelUsage:{},total_cost_usd:0,num_turns:1};};
 t.after(()=>{claude.loadQuery=original;});
 const {SdkAgentClient}=require('../dist/core/commission/agent'),client=new SdkAgentClient();
 for(const profile of SPECIALIST_PROFILES){await client.run({provider:'claude',phase:'work',personaId:profile.id,prompt:'検証用',workingDirectory:process.cwd(),model:'test',tools:'full',maxTurns:1,abortSignal:new AbortController().signal});const options=seen.at(-1).options;assert.ok(options.systemPrompt.includes(skillDetailsFor(profile.id)[0].instructions));assert.ok(options.systemPrompt.includes(profile.outputs[0]));assert.deepEqual(options.allowedTools,[...preapprovedTools(approvedTools(profile.id,'work')),...verificationToolsFor('work',profile.id)]);}
});

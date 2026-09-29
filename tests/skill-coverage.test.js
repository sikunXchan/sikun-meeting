const test=require('node:test'),assert=require('node:assert/strict');
const {PERSONAS}=require('../dist/core/personas');
const {skillDetailsFor,appliedSkillsFor,skillPromptFor}=require('../dist/core/skills/catalog');
const {capabilityFor,approvedTools}=require('../dist/core/capabilities');

test('all 38 SKILL.md definitions parse identically with LF and CRLF, including QA evidence requirements',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {parseSkillDocument}=require('../dist/core/skills/catalog');
 const ids=new Set(PERSONAS.flatMap(p=>skillDetailsFor(p.id).map(s=>s.id)));
 assert.equal(ids.size,38);
 for(const id of ids){
  const source=fs.readFileSync(path.join(__dirname,'../src/core/skills/catalog',id,'SKILL.md'),'utf8').replace(/\r/g,'');
  const lf=parseSkillDocument(source),crlf=parseSkillDocument(source.replace(/\n/g,'\r\n'));
  assert.deepEqual(lf,crlf,id);assert.ok(lf.instructions.replace(/\r/g,'').length>180,id);
 }
 const qa=skillDetailsFor('qa')[0];assert.equal(qa.version,'1.1.0');
 assert.match(qa.instructions,/pass \/ fail \/ 未検証/);
 assert.equal(qa.resources[0].name,'references/acceptance-table.md');
 assert.ok(skillPromptFor('qa','review').includes(qa.resources[0].content));
 assert.throws(()=>parseSkillDocument('---\nname: missing-version\n---\ntext'),/version/);
});

test('planner retains every role in a compact roster and specialist criteria occur only once',()=>{
 const {plannerRoster}=require('../dist/core/commission/service');
 const {methodFor}=require('../dist/core/capabilities');
 const {SPECIALIST_PROFILES}=require('../dist/core/specialties');
 const roster=plannerRoster();assert.ok(roster.length<1800,roster.length);
 for(const persona of PERSONAS)assert.ok(roster.split('\n').some(line=>line.startsWith(persona.id+':')));
 for(const profile of SPECIALIST_PROFILES){
  const criterion=skillDetailsFor(profile.id)[0].instructions.match(/確認基準: ([^\n]+)/)[1];
  assert.equal((methodFor(profile.id)+skillPromptFor(profile.id,'work')).split(criterion).length-1,1);
 }
});

test('全39体に実行側と表示側が共通のスキルがあり、対象外の段階には適用しない',()=>{
 assert.equal(PERSONAS.length,39);
 for(const p of PERSONAS){
  const details=skillDetailsFor(p.id);assert.ok(details.length,p.id);
  assert.deepEqual(capabilityFor(p.id).skills,details.map(s=>s.id));
  for(const skill of details){assert.ok(skill.instructions.replace(/\r/g, '').length>180);assert.ok(skill.phases.includes('meeting'));for(const phase of skill.phases){assert.ok(skillPromptFor(p.id,phase).includes(skill.instructions));assert.ok(appliedSkillsFor(p.id,phase).some(s=>s.id===skill.id&&s.version===skill.version));}}
  assert.deepEqual(appliedSkillsFor(p.id,'delivery'),[]);
 }
 assert.deepEqual(skillDetailsFor('unknown'),[]);assert.equal(skillPromptFor('unknown','work'),'');
});

test('不足していた14分野の手順をClaude実行に渡し、ツール権限は維持する',async t=>{
 const roles=['researcher','innovator','analyst','finance','legal','designer','marketing','devops','writer','ai_researcher','support','data_engineer','cloud','visionary'];
 const claude=require('../dist/core/agent/claudeAgent'),original=claude.loadQuery,seen=[];
 claude.loadQuery=async()=>async function* (input){seen.push(input);yield {type:'result',subtype:'success',is_error:false,result:'検証用応答',modelUsage:{},total_cost_usd:0,num_turns:1};};
 t.after(()=>{claude.loadQuery=original;});
 const {SdkAgentClient}=require('../dist/core/commission/agent'),client=new SdkAgentClient();
 for(const role of roles)for(const phase of ['work','review']){
  await client.run({provider:'claude',phase,personaId:role,prompt:'検証用',workingDirectory:process.cwd(),model:'test',tools:'full',maxTurns:1,abortSignal:new AbortController().signal});
  const options=seen.at(-1).options;assert.ok(options.systemPrompt.includes(skillDetailsFor(role)[0].instructions),role);
  assert.deepEqual(options.allowedTools,approvedTools(role,phase));
 }
});

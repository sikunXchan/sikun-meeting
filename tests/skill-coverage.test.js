const test=require('node:test'),assert=require('node:assert/strict');
const {PERSONAS}=require('../dist/core/personas');
const {skillDetailsFor,appliedSkillsFor,skillPromptFor,parseSkillDocument,COMMON_SKILL_RULES}=require('../dist/core/skills/catalog');
const {capabilityFor,approvedTools,preapprovedTools,verificationToolsFor}=require('../dist/core/capabilities');

test('all 38 SKILL.md definitions parse identically with LF and CRLF, including QA evidence requirements',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const {parseSkillDocument}=require('../dist/core/skills/catalog');
 const ids=new Set(PERSONAS.flatMap(p=>skillDetailsFor(p.id).map(s=>s.id)));
 assert.equal(ids.size,38);
 for(const id of ids){
  const source=fs.readFileSync(path.join(__dirname,'../src/core/skills/catalog',id,'SKILL.md'),'utf8').replace(/\r/g,'');
  const lf=parseSkillDocument(source),crlf=parseSkillDocument(source.replace(/\n/g,'\r\n'));
  assert.deepEqual(lf,crlf,id);assert.ok(lf.instructions.replace(/\r/g,'').length>180,id);
  assert.equal(lf.name,id);
  assert.deepEqual(lf.instructions.match(/^## .+$/gm),['## 成果物','## 手順','## 確認基準'],id);
  assert.ok(!lf.instructions.includes('受入'),id);
 }
 const qa=skillDetailsFor('qa')[0];assert.equal(qa.version,'1.2.0');
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
  const criterion=skillDetailsFor(profile.id)[0].instructions.split('## 確認基準\n\n')[1].trim();
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
  assert.equal(options.systemPrompt.split(COMMON_SKILL_RULES).length-1,1,role);
  assert.deepEqual(options.tools,approvedTools(role,phase));assert.deepEqual(options.allowedTools,[...preapprovedTools(approvedTools(role,phase)),...verificationToolsFor(phase)]);
 }
});

test('standard frontmatter accepts nested YAML metadata and rejects incompatible or ambiguous fields',()=>{
 const doc=front=>`---\n${front}\n---\n# 検証用\n本文`;
 const valid='name: test-skill\ndescription: >-\n  条件を検証するときに使う。\nmetadata:\n  author: tester\n  version: "1.2.0" # 版';
 const parsed=parseSkillDocument(doc(valid));
 assert.equal(parsed.version,'1.2.0');assert.equal(parsed.description,'条件を検証するときに使う。');
 assert.equal(parseSkillDocument(doc('name: test-skill\ndescription: 検証\nmetadata: {version: 2.0.0}')).version,'2.0.0');
 for(const extra of ['license: MIT','compatibility: Requires a browser','allowed-tools: Read Grep'])assert.equal(parseSkillDocument(doc(valid+'\n'+extra)).version,'1.2.0');
 for(const invalid of [
  valid+'\nversion: 9.0.0', valid+'\nunknown: value',valid+'\nname: duplicate',
  valid.replace('version: "1.2.0"','version: 1.2'),valid.replace('metadata:','other:'),
  valid.replace('  author: tester','  author: {nested: map}'),valid.replace('name: test-skill','name: Invalid_Name'),
  valid.replace('description: >-\n  条件を検証するときに使う。','description: []'),
  'name: test-skill\ndescription: 検証\nmetadata: [version, 1.0.0]',
  valid+'\nmetadata:\n  version: "3.0.0"',valid+'\ncompatibility: '+ 'x'.repeat(501),
 ])assert.throws(()=>parseSkillDocument(doc(invalid)),undefined,invalid);
 assert.throws(()=>parseSkillDocument('本文のみ'));
});

test('shared rules are injected once before every applicable skill, and the three templates reach execution',()=>{
 for(const persona of PERSONAS)for(const skill of skillDetailsFor(persona.id)){
  for(const sentence of COMMON_SKILL_RULES.split('\n').slice(1))assert.ok(!skill.instructions.includes(sentence),skill.id);
  for(const phase of skill.phases){const prompt=skillPromptFor(persona.id,phase);assert.equal(prompt.split(COMMON_SKILL_RULES).length-1,1);assert.ok(prompt.indexOf(COMMON_SKILL_RULES)<prompt.indexOf(skill.instructions));}
 }
 for(const [persona,reference] of [['qa','references/acceptance-table.md'],['legal','references/issue-table.md'],['finance','references/sensitivity-table.md']]){
  const skill=skillDetailsFor(persona)[0],resource=skill.resources.find(r=>r.name===reference);assert.ok(resource);
  assert.ok(resource.content.includes('|'));assert.equal(skillPromptFor(persona,'review').split(resource.content).length-1,1);
 }
});

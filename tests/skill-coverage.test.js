const test=require('node:test'),assert=require('node:assert/strict');
const {PERSONAS}=require('../dist/core/personas');
const {skillDetailsFor,appliedSkillsFor,skillPromptFor}=require('../dist/core/skills/catalog');
const {capabilityFor,approvedTools}=require('../dist/core/capabilities');

test('全39体に実行側と表示側が共通のスキルがあり、対象外の段階には適用しない',()=>{
 assert.equal(PERSONAS.length,39);
 for(const p of PERSONAS){
  const details=skillDetailsFor(p.id);assert.ok(details.length,p.id);
  assert.deepEqual(capabilityFor(p.id).skills,details.map(s=>s.id));
  for(const skill of details){assert.ok(skill.instructions.length>180);assert.ok(skill.phases.includes('meeting'));for(const phase of skill.phases){assert.ok(skillPromptFor(p.id,phase).includes(skill.instructions));assert.ok(appliedSkillsFor(p.id,phase).some(s=>s.id===skill.id&&s.version===skill.version));}}
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

const test=require('node:test'),assert=require('node:assert/strict');
const {skillMetricsFor}=require('../dist/core/skills/metrics');
function run(id,phase,version,overrides={}){return {id,phase,version,workItemId:'work',personaId:phase==='work'?'engineer':'qa',status:'completed',provider:'claude',requestedModel:'requested',observedModels:['actual'],appliedSkills:[{id:phase==='work'?'implementation':'acceptance-verification',version}],...overrides};}
function decision(workRunId,reviewRunId,approved=true,overrides={}){return {id:'d-'+workRunId,workItemId:'work',workRunId,reviewRunId,approved,reviewerPersonaId:'qa',...overrides};}
function item(runs,reviewDecisions,id='job'){return {id,runs,reviewDecisions};}

test('attributes rejection then acceptance to their actual run versions, with separate reviewer results',()=>{
 const input=[item([run('w1','work','1.0.0'),run('r1','review','1.1.0'),run('w2','work','1.1.0'),run('r2','review','1.2.0')],[decision('w1','r1',false),decision('w2','r2',true)])];
 const original=structuredClone(input),report=skillMetricsFor(input);assert.deepEqual(input,original);
 assert.equal(report.excludedDecisions,0);assert.equal(report.rows.length,4);
 for(const row of report.rows){assert.equal(row.reviewed,1);assert.equal(row.runs,1);assert.equal(row.commissionCount,1);assert.equal(row.unlinked,0);assert.equal(row.model,'actual');}
 assert.equal(report.rows.find(r=>r.phase==='work'&&r.version==='1.0.0').returnRate,1);
 assert.equal(report.rows.find(r=>r.phase==='work'&&r.version==='1.1.0').returnRate,0);
 assert.equal(report.rows.find(r=>r.phase==='review'&&r.version==='1.1.0').returnRate,1);
 assert.equal(report.rows.find(r=>r.phase==='review'&&r.version==='1.2.0').returnRate,0);
});

test('rates count reviewed attempts only, exclude failed/interrupted/running/unlinked work, and keep zero distinct from unknown',()=>{
 const input=[item([
  run('w1','work','1.0.0'),run('w2','work','1.0.0'),run('r1','review','1.0.0'),run('r2','review','1.0.0'),
  run('unreviewed','work','1.0.0'),run('failed','work','1.0.0',{status:'failed'}),run('interrupted','work','1.0.0',{status:'interrupted'}),run('running','work','1.0.0',{status:'running'}),
  run('unknown','work','2.0.0'),run('plan','planning','1.0.0'),
 ],[decision('w1','r1',false),decision('w2','r2',true)])];
 const rows=skillMetricsFor(input).rows,row=rows.find(r=>r.phase==='work'&&r.version==='1.0.0');
 assert.deepEqual({runs:row.runs,completed:row.completed,failed:row.failed,interrupted:row.interrupted,running:row.running,reviewed:row.reviewed,returned:row.returned,unlinked:row.unlinked,rate:row.returnRate},
 {runs:6,completed:3,failed:1,interrupted:1,running:1,reviewed:2,returned:1,unlinked:1,rate:0.5});
 assert.equal(rows.find(r=>r.version==='2.0.0').returnRate,null);
});

test('does not guess links in legacy, cross-job, wrong-work or duplicated decisions',()=>{
 const cases=[
  [decision(undefined,undefined)], [decision('missing','r')], [decision('w','r',true,{workItemId:'another'})],
  [decision('w','r',true,{reviewerPersonaId:'other'})], [decision('w','r'),decision('w','r',false)],
 ];
 for(const decisions of cases){const report=skillMetricsFor([item([run('w','work','1.0.0'),run('r','review','1.0.0')],decisions)]);assert.equal(report.excludedDecisions,decisions.length);assert.ok(report.rows.every(r=>r.returnRate===null));}
 const report=skillMetricsFor([item([run('w','work','1.0.0')],[decision('w','r')],'a'),item([run('r','review','1.0.0')],[],'b')]);assert.equal(report.excludedDecisions,1);
 assert.ok(report.rows.every(r=>r.returnRate===null));
});

test('separates persona/provider/observed model and does not double-count repeated skill tags',()=>{
 const runs=[run('a','work','1.0.0'),run('b','work','1.0.0',{personaId:'backend'}),run('c','work','1.0.0',{provider:'codex'}),
  run('d','work','1.0.0',{effectiveModel:'fallback',observedModels:['fallback']}),run('e','work','1.0.0',{observedModels:[]}),run('f','work','1.0.0',{effectiveModel:'second',observedModels:['second','first','first']})];
 runs[0].appliedSkills.push({...runs[0].appliedSkills[0]});
 const report=skillMetricsFor([item(runs,[])]);assert.equal(report.rows.length,6);assert.ok(report.rows.every(r=>r.runs===1));
 assert.ok(report.rows.some(r=>r.model==='unknown'));assert.ok(report.rows.some(r=>r.model==='first + second'));assert.ok(!report.rows.some(r=>r.model==='requested'));
 assert.deepEqual(skillMetricsFor([]),{rows:[],excludedDecisions:0});
});

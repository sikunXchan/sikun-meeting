const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {calculate}=require('../dist/core/tools/rational');
const {readTable}=require('../dist/core/tools/data');
const {toolNamesFor,TOOL_GROUPS}=require('../dist/core/tools/catalog');
const {verificationToolsFor,approvedTools,preapprovedTools,capabilityFor}=require('../dist/core/capabilities');
const {redactSecrets}=require('../dist/core/commission/redact');
const {PERSONAS}=require('../dist/core/personas');

function tempDir(t,prefix){
 const base=process.env.SIKUN_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,prefix));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return dir;
}

test('calculate is exact, supports named steps, and rejects unsafe or ambiguous input',()=>{
 const values=Object.fromEntries(calculate([
  {name:'a',expression:'0.1 + 0.2'},
  {name:'月次売上',expression:'1200000'},
  {name:'年間売上',expression:'月次売上 * 12'},
  {name:'利益',expression:'年間売上 - 900000 - sum(120000, 80000)'},
  {name:'率',expression:'8% * 年間売上'},
  {name:'複利',expression:'1000000 * 1.05^3'},
  {name:'三分の一',expression:'1/3'},
  {name:'四捨五入',expression:'round(2.5)'},{name:'負の四捨五入',expression:'round(-2.5)'},
  {name:'切り捨て',expression:'floor(-1.21, 1)'},{name:'切り上げ',expression:'ceil(1.21, 1)'},{name:'円未満',expression:'round(1234.5678, 2)'},
  {name:'最大',expression:'max(1, -2, 3.5) - min(4, 2) + abs(-1)'},
  {name:'単項',expression:'-2^2'},
 ]).map(r=>[r.name,r]));
 assert.equal(values.a.value,'0.3');assert.equal(values.a.exact,true);
 assert.equal(values.年間売上.value,'14400000');assert.equal(values.利益.value,'13300000');
 assert.equal(values.率.value,'1152000');assert.equal(values.複利.value,'1157625');
 assert.equal(values.三分の一.value,'0.333333');assert.equal(values.三分の一.exact,false);
 assert.deepEqual(['四捨五入','負の四捨五入','切り捨て','切り上げ','円未満'].map(n=>values[n].value),['3','-3','-1.3','1.3','1234.57']);assert.equal(values.最大.value,'2.5');assert.equal(values.単項.value,'-4');
 assert.equal(calculate([{name:'x',expression:'1/3'}],2)[0].value,'0.33');
 assert.equal(calculate([{name:'x',expression:'2^-30'}],6)[0].exact,false);
 for(const [expression,message] of [['1/0',/0で割る/],['未知 + 1',/未定義/],['process.exit()',/式を読めません|未定義|使えない/],['1,000',/桁区切りのカンマ/],['2^0.5',/整数/],['2^100000',/大きすぎ/],['(1+2',/不完全/],['1 2',/余分/],['eval(1)',/使えない関数/]]){
  assert.throws(()=>calculate([{name:'x',expression}]),message,expression);
 }
 assert.throws(()=>calculate([{name:'a',expression:'1'},{name:'a',expression:'2'}]),/重複/);
 assert.throws(()=>calculate([{name:'sum',expression:'1'}]),/name が不正/);
 assert.throws(()=>calculate([]),/1〜200件/);
});

test('read_table reads csv/tsv/xlsx inside allowed folders only and totals numeric columns exactly',async t=>{
 const work=tempDir(t,'sikun-table-work-'),refs=tempDir(t,'sikun-table-refs-'),outside=tempDir(t,'sikun-table-out-');
 fs.writeFileSync(path.join(work,'cost.csv'),'﻿項目,金額,備考\r\n"サーバー, 月額",1200.10,"引用""あり"""\r\nAPI,300.20,\r\n未定,不明,\r\n');
 fs.writeFileSync(path.join(refs,'plan.tsv'),'月\t売上\n1\t1,000\n2\t2,500\n');
 fs.writeFileSync(path.join(outside,'secret.csv'),'a\n1\n');
 const csv=await readTable('cost.csv',work,[refs]);
 assert.deepEqual(csv.rows[1],['サーバー, 月額','1200.10','引用"あり"']);
 assert.deepEqual(csv.numericColumns,[{column:2,header:'金額',total:'1500.3',numericCells:2,otherCells:1}]);
 const tsv=await readTable(path.join(refs,'plan.tsv'),work,[refs]);
 assert.equal(tsv.numericColumns.find(c=>c.header==='売上').total,'3500');
 const ExcelJS=require('exceljs'),workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('収支');
 sheet.addRow(['月','売上','費用']);sheet.addRow([1,1000,400]);sheet.addRow([2,1500]);
 sheet.getCell('C3').value={formula:'C2*2',result:800};
 await workbook.xlsx.writeFile(path.join(work,'plan.xlsx'));
 const xlsx=await readTable('plan.xlsx',work,[]);
 assert.equal(xlsx.sheet,'収支');assert.deepEqual(xlsx.rows[2],['2','1500','800']);
 assert.equal(xlsx.numericColumns.find(c=>c.header==='費用').total,'1200');
 await assert.rejects(readTable(path.join(outside,'secret.csv'),work,[refs]),/外のファイル/);
 await assert.rejects(readTable('../'+path.basename(outside)+'/secret.csv',work,[refs]),/外のファイル/);
 fs.symlinkSync(path.join(outside,'secret.csv'),path.join(work,'link.csv'));
 await assert.rejects(readTable('link.csv',work,[refs]),/外のファイル/);
 fs.writeFileSync(path.join(work,'note.txt'),'x');
 await assert.rejects(readTable('note.txt',work,[]),/csv/);
 const limited=await readTable('cost.csv',work,[],{maxRows:2});assert.equal(limited.truncated,true);assert.equal(limited.rows.length,2);
});

test('every role gets the same verification tools only in work, review and goal checks',async t=>{
 const names=group=>TOOL_GROUPS[group].map(tool=>'mcp__sikun__'+tool.name);
 assert.equal(names('calc').length+names('data').length+names('review').length,16);
 assert.deepEqual(verificationToolsFor('work'),[...names('calc'),...names('data')],'作業では確認記録を渡さない');
 for(const phase of ['review','goal_check','kgi_check'])assert.deepEqual(verificationToolsFor(phase),[...names('calc'),...names('data'),...names('review')]);
 for(const phase of ['meeting','consultation','planning','delivery'])assert.deepEqual(verificationToolsFor(phase),[]);
 assert.deepEqual(verificationToolsFor('work'),toolNamesFor('work'));
 const claude=require('../dist/core/agent/claudeAgent'),original=claude.loadQuery,seen=[];
 claude.loadQuery=async()=>async function* (input){seen.push(input);yield {type:'result',subtype:'success',is_error:false,result:'ok',modelUsage:{},total_cost_usd:0,num_turns:1};};
 t.after(()=>{claude.loadQuery=original;});
 const {SdkAgentClient}=require('../dist/core/commission/agent'),client=new SdkAgentClient();
 for(const personaId of ['finance','critic','engineer','designer','researcher'])for(const [phase,tools] of [['work','full'],['review','full'],['goal_check','read'],['planning','read']]){
  await client.run({provider:'claude',phase,personaId,prompt:'x',workingDirectory:process.cwd(),model:'test',tools,readableDirectories:['/refs'],reviewFile:'/data/checks/run.json',maxTurns:1,abortSignal:new AbortController().signal});
  const options=seen.at(-1).options,granted=verificationToolsFor(phase);
  const builtins=approvedTools(personaId,tools==='read'?'read':phase==='review'?'review':'work');
  assert.deepEqual(options.tools,builtins,'組み込みツールは部門の権限のまま');
  assert.deepEqual(options.allowedTools,[...preapprovedTools(builtins),...granted]);
  if(granted.length){
   const server=options.mcpServers.sikun;
   assert.equal(server.type,'stdio');assert.equal(server.command,process.execPath);
   assert.ok(server.args[0].endsWith(path.join('dist','mcp','stdio.js')));assert.equal(server.env.ELECTRON_RUN_AS_NODE,'1');
   assert.equal(server.env.SIKUN_WORKDIR,process.cwd());assert.equal(server.env.SIKUN_READABLE_DIRS,'["/refs"]');
   assert.equal(server.env.SIKUN_REVIEW_FILE,phase==='work'?undefined:'/data/checks/run.json');
   assert.match(options.systemPrompt,/calculate/);assert.equal(/record_criterion/.test(options.systemPrompt),phase!=='work');
  }
  else{assert.equal(options.mcpServers,undefined);assert.doesNotMatch(options.systemPrompt,/検証ツール/);}
 }
});

test('tool usage is logged with commands and URLs but secrets are masked',async t=>{
 assert.equal(redactSecrets('curl -H "Authorization: Bearer abc.DEF-123" http://127.0.0.1'),'curl -H "Authorization: Bearer ***" http://127.0.0.1');
 assert.equal(redactSecrets('API_KEY=sk-live-1234567890 node x.js --password=hunter2'),'API_KEY=*** node x.js --password=***');
 assert.equal(redactSecrets('echo ghp_abcdefghijklmnop'),'echo ghp-***');
 const claude=require('../dist/core/agent/claudeAgent'),original=claude.loadQuery,logged=[];
 claude.loadQuery=async()=>async function* (){
  yield {type:'assistant',message:{model:'m',content:[
   {type:'tool_use',name:'Bash',input:{command:'curl -H "Authorization: Bearer secret-token" http://127.0.0.1/open'}},
   {type:'tool_use',name:'WebFetch',input:{url:'https://example.com/law?id=1'}},
   {type:'tool_use',name:'mcp__sikun__calculate',input:{items:[{name:'利益',expression:'1-1'},{name:'率',expression:'1'}]}},
  ]}};
  yield {type:'result',subtype:'success',is_error:false,result:'ok',modelUsage:{},total_cost_usd:0,num_turns:1};
 };
 t.after(()=>{claude.loadQuery=original;});
 const {SdkAgentClient}=require('../dist/core/commission/agent');
 await new SdkAgentClient().run({provider:'claude',phase:'work',personaId:'qa',prompt:'x',workingDirectory:process.cwd(),model:'test',tools:'full',maxTurns:1,abortSignal:new AbortController().signal,onTool:(detail)=>logged.push(detail)});
 assert.deepEqual(logged,['Bash: curl -H "Authorization: Bearer ***" http://127.0.0.1/open','WebFetch: https://example.com/law?id=1','mcp__sikun__calculate: 利益, 率']);
});

test('reviewers receive the worker tool log and are told unlogged checks count as unperformed',async t=>{
 const root=tempDir(t,'sikun-tool-log-');
 const {JsonStore}=require('../dist/core/store/jsonStore'),{Repository}=require('../dist/core/store/repository'),{ProjectService}=require('../dist/core/services/projectService');
 const {CommissionStore}=require('../dist/core/commission/store'),{CommissionService}=require('../dist/core/commission/service');
 const repo=new Repository(new JsonStore(root)),project=await new ProjectService(repo).createProject('test',''),store=new CommissionStore(root),prompts=[];
 const agent={async run(r){
  prompts.push(r);let text='ok';
  if(r.phase==='consultation')text='企画';
  else if(r.phase==='planning')text=JSON.stringify({tasks:[{title:'収支表',instructions:'plan.md',acceptance:'計算が正しい',ownerPersonaId:'finance',domainPersonaId:'finance',reviewerPersonaId:'critic'}]});
  else if(r.phase==='work'){await r.onTool('mcp__sikun__calculate: 利益');await r.onTool('Bash: npm test');fs.writeFileSync(path.join(r.workingDirectory,'plan.md'),'利益 100');text='計算しテストも通った';}
  else if(r.phase==='review')text=JSON.stringify({approved:true,note:'記録と一致'});
  else if(r.phase==='goal_check')text=JSON.stringify({complete:true,evidence:['plan.md'],remaining:[]});
  return {text,observedModels:['m'],estimatedCostUsd:0,numTurns:1};
 }};
 const service=new CommissionService(store,repo,agent,root),item=await service.create({projectId:project.id,goal:'収支',settings:{executionMode:'automatic'}});
 assert.equal(item.settings.fallbackModel,'','既定は代替なし');
 await service.consult(item.id,'収支');
 for(let i=0;i<300&&store.get(item.id).status!=='delivered';i++){if(store.get(item.id).status==='failed')throw Error(store.get(item.id).error);await new Promise(r=>setTimeout(r,10));}
 const review=prompts.find(r=>r.phase==='review');
 assert.match(review.prompt,/担当AIの実行記録（アプリが記録したツール使用2件/);
 assert.match(review.prompt,/- mcp__sikun__calculate: 利益\n- Bash: npm test/);
 assert.match(review.prompt,/実行記録にない場合、その検証は未実施/);
 assert.ok(prompts.every(r=>r.fallbackModel===undefined));
});

test('Haiku is not used by default anywhere and old Haiku defaults are migrated away',async t=>{
 for(const p of PERSONAS)assert.doesNotMatch(capabilityFor(p.id).model,/haiku/i,p.id);
 assert.equal(capabilityFor('innovator').model,'claude-sonnet-5');
 const html=fs.readFileSync(path.join(__dirname,'..','src','renderer','index.html'),'utf8');
 assert.doesNotMatch(html,/haiku/i);
 const {normalizeWorkspacePreferences}=require('../dist/main/workspaceSettings');
 assert.equal(normalizeWorkspacePreferences({fields:{'commission-model-fallback':'claude-haiku-4-5-20251001'}}).fields['commission-model-fallback'],undefined);
 assert.equal(normalizeWorkspacePreferences({fields:{'commission-model-fallback':'claude-sonnet-5'}}).fields['commission-model-fallback'],'claude-sonnet-5');
 const root=tempDir(t,'sikun-fallback-');
 const {CommissionStore}=require('../dist/core/commission/store');
 const legacy={id:'00000000-0000-4000-8000-000000000001',projectId:'p',goal:'g',status:'delivered',settings:{provider:'claude',fallbackModel:'claude-haiku-4-5-20251001',workerModel:'claude-sonnet-5'},consultation:[],workItems:[],runs:[],revisionRequests:[]};
 const custom={...legacy,id:'00000000-0000-4000-8000-000000000002',settings:{...legacy.settings,fallbackModel:'claude-sonnet-5'}};
 fs.writeFileSync(path.join(root,'commissions.json'),JSON.stringify([legacy,custom]));
 const store=new CommissionStore(root);
 assert.equal(store.get(legacy.id).settings.fallbackModel,'');
 assert.equal(store.get(custom.id).settings.fallbackModel,'claude-sonnet-5');
});

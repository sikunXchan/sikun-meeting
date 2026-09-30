const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const calc=require('../dist/core/tools/calc');
const data=require('../dist/core/tools/data');
const review=require('../dist/core/tools/review');
const {TOOL_GROUPS,toolNamesFor}=require('../dist/core/tools/catalog');
const {toolServerLaunch}=require('../dist/core/tools/launch');
const {handleMessage,selectedTools}=require('../dist/mcp/stdio');
const {codexOptionsForPhase}=require('../dist/core/commission/codexAgent');

function tempDir(t,prefix){
 const base=process.env.SIKUN_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,prefix));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return dir;
}

test('calculation tools return exact or explicitly approximate results',()=>{
 const s=calc.statistics([1,2,3,4,'100'],[0,50,90]);
 assert.equal(s.count,5);assert.equal(s.sum,'110');assert.equal(s.mean,'22');assert.equal(s.median,'3');
 assert.equal(s.sampleVariance,'1902.5');assert.equal(s.populationVariance,'1522');assert.equal(s.sampleStdDev.approximate,true);
 assert.deepEqual(s.percentiles.map(p=>p.value),['1','3','61.6']);
 assert.equal(calc.statistics([5]).sampleVariance,null);
 const g=calc.growthRate(800,1000,2);assert.equal(g.change,'200');assert.equal(g.percentChange,'25');assert.match(g.cagr.percent,/^11\.803398/);
 assert.equal(calc.growthRate(0,5).percentChange,null);
 const n=calc.npvIrr([-1000,500,500,500],'10');assert.equal(n.npv,'243.425995');assert.equal(n.irr.approximate,true);
 const r=Number(n.irr.percent)/100;assert.ok(Math.abs(-1000+500/(1+r)+500/(1+r)**2+500/(1+r)**3)<1e-6,'IRRでNPVがほぼ0');
 assert.equal(calc.npvIrr([100,100]).irr,null,'符号が変わらなければIRRなし');
 const loan=calc.loanPayment(1000000,'1.2',12);
 const expected=Math.round(1000000*0.001/(1-Math.pow(1.001,-12)));
 assert.equal(loan.monthlyPayment,String(expected));assert.equal(calc.loanPayment(120000,0,12).monthlyPayment,'10000');
 const one=calc.sensitivityTable('(単価 - 原価) * 数量',{単価:1000,原価:600,数量:10},[{name:'単価',values:[900,1100]}]);
 assert.equal(one.base,'4000');assert.deepEqual(one.rows.map(r=>r.result),['3000','5000']);
 const two=calc.sensitivityTable('(単価 - 原価) * 数量',{単価:1000,原価:600,数量:10},[{name:'単価',values:[900,1100]},{name:'数量',values:[10,20]}]);
 assert.deepEqual(two.rows[1].results,['5000','10000']);
 assert.throws(()=>calc.sensitivityTable('a*2',{a:1},[{name:'b',values:[1]}]),/base にありません/);
 assert.equal(calc.unitConvert(1,'kWh','MJ').result,'3.6');assert.equal(calc.unitConvert(121,'m2','坪').result,'36.6025');
 assert.equal(calc.unitConvert(212,'F','C').result,'100');assert.equal(calc.unitConvert(0,'C','K').result,'273.15');
 assert.throws(()=>calc.unitConvert(1,'USD','JPY'),/換算できない/);
 const between=calc.dateCalc({operation:'between',start:'2026-01-30',end:'2026-03-02',holidays:['2026-02-11','2026-02-23']});
 assert.equal(between.days,31);assert.equal(between.businessDaysAfterStart,19,'2月の平日20日−祝日2日＋3/2');assert.equal(between.fullMonths,1);
 assert.equal(calc.dateCalc({operation:'add',date:'2026-01-31',months:1}).result,'2026-02-28');
 assert.equal(calc.dateCalc({operation:'add',date:'2026-09-30',businessDays:3}).result,'2026-10-05');
 const info=calc.dateCalc({operation:'info',date:'2000-02-29',asOf:'2026-02-28'});
 assert.equal(info.weekday,'火');assert.equal(info.ageAsOf.years,25);assert.equal(info.endOfMonth,'2000-02-29');
 assert.throws(()=>calc.dateCalc({operation:'info',date:'2026-02-30'}),/存在しない日付/);
});

test('table tools filter, aggregate, reconcile and validate without leaving allowed folders',async t=>{
 const work=tempDir(t,'sikun-data-'),outside=tempDir(t,'sikun-data-out-');
 fs.writeFileSync(path.join(work,'ledger.csv'),'伝票,部門,金額,日付\nA1,営業,"1,200",2026-09-01\nA2,開発,300,2026-09-02\nA3,営業,¥500,2026-09-03\nA3,営業,500,2026/9/4\nA5,,abc,x\n');
 fs.writeFileSync(path.join(work,'bank.csv'),'伝票,金額\nA1,1200\nA2,350\nB9,10\n');
 const described=await data.describeTable('ledger.csv',work,[]);
 assert.deepEqual(described.columns.map(c=>c.type),['text','text','mixed','text']);assert.equal(described.columns[1].blanks,1);
 const grouped=await data.queryTable('ledger.csv',work,[],{filters:[{column:'金額',op:'>=',value:'500'}],groupBy:['部門'],aggregates:[{column:'金額',fn:'sum'},{column:'金額',fn:'count'}]});
 assert.equal(grouped.matchedRows,3);assert.deepEqual(grouped.groups,[{部門:'営業','rows':3,'sum(金額)':'2200','count(金額)':3}]);
 const rows=await data.queryTable('ledger.csv',work,[],{filters:[{column:'2',op:'empty'}]});assert.deepEqual(rows.rows.map(r=>r[0]),['A5']);
 const rec=await data.reconcileTables({left:'ledger.csv',right:'bank.csv',key:['伝票'],compare:['金額']},work,[]);
 assert.equal(rec.matchedKeys,2);assert.deepEqual(rec.onlyInLeft.keys,['A3','A5']);assert.deepEqual(rec.onlyInRight.keys,['B9']);
 assert.deepEqual(rec.differences.rows,[{key:'A2',column:'金額',left:'300',right:'350',difference:'50'}]);
 assert.deepEqual(rec.duplicateKeys.left,['A3']);assert.equal(rec.totals[0].left,'2000');assert.equal(rec.totals[0].right,'1560');
 const valid=await data.validateTable('ledger.csv',work,[],[{column:'伝票',unique:true,pattern:'^[A-Z]\\d$'},{column:'部門',required:true},{column:'金額',type:'number',min:'0',max:'1000'},{column:'日付',type:'date'},{column:'税額'}]);
 assert.equal(valid.valid,false);
 const problems=valid.issues.map(i=>`${i.row??'-'}:${i.column}:${i.problem}`);
 for(const expected of ['5:伝票:4行目と重複','6:部門:空欄','2:金額:1000 超過','6:金額:数値ではありません','6:日付:日付（YYYY-MM-DD）ではありません','-:税額:列がありません'])assert.ok(problems.includes(expected),expected+' / '+problems.join(' | '));
 await assert.rejects(data.validateTable('ledger.csv',work,[],[{column:'伝票',pattern:'a'.repeat(201)}]),/200文字/);
 fs.writeFileSync(path.join(work,'config.yaml'),'items:\n  - name: 基本\n    price: 1200\n');
 fs.writeFileSync(path.join(work,'plan.json'),'{"months":[{"sales":100}]}');
 assert.equal(data.readStructured('config.yaml',work,[],'items.0.price').value,1200);
 assert.deepEqual(data.readStructured('plan.json',work,[]).value,{months:[{sales:100}]});
 assert.throws(()=>data.readStructured('plan.json',work,[],'months.3'),/パスがありません/);
 fs.writeFileSync(path.join(outside,'secret.json'),'{}');
 assert.throws(()=>data.readStructured(path.join(outside,'secret.json'),work,[]),/外のファイル/);
});

test('review criteria are recorded outside the workspace and summarize approvability',t=>{
 const dir=tempDir(t,'sikun-review-'),file=path.join(dir,'checks','run.json');
 assert.throws(()=>review.recordCriterion(undefined,{id:'AC-01',criterion:'x',result:'pass',evidence:'e'}),/記録できません/);
 assert.throws(()=>review.recordCriterion(file,{id:'AC-01',criterion:'合計が正しい',result:'pass'}),/証拠/);
 assert.throws(()=>review.recordCriterion(file,{id:'AC 01',criterion:'x',result:'pass',evidence:'e'}),/識別子/);
 review.recordCriterion(file,{id:'AC-01',criterion:'合計が正しい',result:'fail',evidence:'合計が50違う'});
 const second=review.recordCriterion(file,{id:'AC-01',criterion:'合計が正しい',result:'pass',evidence:'calculate の結果 13500000 と一致'});
 assert.deepEqual(second.summary,{total:1,pass:1,fail:0,unverified:0,approvable:true});
 review.recordCriterion(file,{id:'AC-02',criterion:'UI',result:'unverified'});
 assert.equal(review.listCriteria(file).summary.approvable,false);
 assert.deepEqual(review.listCriteria(path.join(dir,'none.json')).summary,{total:0,pass:0,fail:0,unverified:0,approvable:false});
});

test('stdio server speaks MCP JSON-RPC and exposes only the requested groups',async t=>{
 const work=tempDir(t,'sikun-mcp-');
 fs.writeFileSync(path.join(work,'sales.csv'),'月,売上\n1,1000\n2,2500\n');
 const context={workingDirectory:work,readableDirectories:[],reviewFile:path.join(work,'..',path.basename(work)+'-review.json')};
 t.after(()=>fs.rmSync(context.reviewFile,{force:true}));
 const tools=selectedTools('calc,data,review');assert.equal(tools.length,16);
 assert.throws(()=>selectedTools('calc,shell'),/不明なツール/);
 assert.deepEqual(selectedTools('calculate,read_table,calc').map(tool=>tool.name).slice(0,2),['calculate','read_table'],'ツール名とグループ名を混ぜても重複しない');assert.equal(selectedTools('calculate,read_table,calc').length,9);
 const init=await handleMessage({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2099-01-01'}},tools,context);
 assert.equal(init.result.protocolVersion,'2025-06-18');assert.deepEqual(init.result.capabilities,{tools:{listChanged:false}});
 assert.equal((await handleMessage({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-03-26'}},tools,context)).result.protocolVersion,'2025-03-26');
 assert.equal(await handleMessage({jsonrpc:'2.0',method:'notifications/initialized'},tools,context),undefined);
 assert.deepEqual((await handleMessage({jsonrpc:'2.0',id:3,method:'ping'},tools,context)).result,{});
 const list=(await handleMessage({jsonrpc:'2.0',id:4,method:'tools/list'},tools,context)).result.tools;
 assert.equal(list.length,16);assert.ok(list.every(tool=>tool.inputSchema.type==='object'&&tool.description.length>20));
 assert.equal(list.find(tool=>tool.name==='record_criterion').annotations.readOnlyHint,false);
 assert.ok(list.filter(tool=>tool.name!=='record_criterion').every(tool=>tool.annotations.readOnlyHint));
 const bad=await handleMessage({jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'calculate',arguments:{items:[{name:'x',expression:'1/0'}]}}},tools,context);
 assert.equal(bad.result.isError,true);assert.match(bad.result.content[0].text,/0で割る/);
 assert.equal((await handleMessage({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'run_shell'}},tools,context)).error.code,-32602);
 assert.equal((await handleMessage({jsonrpc:'2.0',id:7,method:'resources/list'},tools,context)).error.code,-32601);
 // 実プロセスを公式MCPクライアントで起動して往復する
 let Client,StdioClientTransport;
 try{({Client}=require('@modelcontextprotocol/sdk/client/index.js'));({StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js'));}
 catch{t.diagnostic('@modelcontextprotocol/sdk が見つからないため実プロセス試験を省略');return;}
 const launch=toolServerLaunch({phase:'review',workingDirectory:work,readableDirectories:[],reviewFile:context.reviewFile});
 const client=new Client({name:'test',version:'1'});
 await client.connect(new StdioClientTransport({command:launch.command,args:launch.args,env:{...process.env,...launch.env}}));
 t.after(()=>client.close());
 const listed=await client.listTools();
 assert.deepEqual(listed.tools.map(tool=>'mcp__sikun__'+tool.name),toolNamesFor('review'));
 const sum=JSON.parse((await client.callTool({name:'read_table',arguments:{file:'sales.csv'}})).content[0].text);
 assert.equal(sum.numericColumns.find(c=>c.header==='売上').total,'3500');
 const recorded=JSON.parse((await client.callTool({name:'record_criterion',arguments:{id:'AC-01',criterion:'売上合計',result:'pass',evidence:'read_table 3500'}})).content[0].text);
 assert.equal(recorded.summary.approvable,true);assert.equal(review.readCriteria(context.reviewFile)[0].id,'AC-01');
 const outside=await client.callTool({name:'read_table',arguments:{file:'/etc/passwd'}});
 assert.equal(outside.isError,true);
 const workLaunch=toolServerLaunch({phase:'work',workingDirectory:work});
 assert.deepEqual(workLaunch.args.slice(1),['--tools','calculate,read_table,extract_text,find_quote']);assert.equal(workLaunch.env.SIKUN_REVIEW_FILE,undefined);
 assert.equal(toolServerLaunch({phase:'planning',workingDirectory:work}),undefined);
});

test('the server survives malformed input and answers in order over real stdio',async t=>{
 const work=tempDir(t,'sikun-mcp-raw-');
 const launch=toolServerLaunch({phase:'work',workingDirectory:work});
 const child=spawn(launch.command,launch.args,{env:{...process.env,...launch.env},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>{output+=chunk;});
 child.stdin.write('not json\n');
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'calculate',arguments:{items:[{name:'a',expression:'0.1+0.2'}]}}})+'\n');
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'ping'})+'\n');
 child.stdin.end();
 const code=await new Promise(resolve=>child.on('close',resolve));
 assert.equal(code,0);
 const messages=output.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(messages[0].error.code,-32700);
 assert.deepEqual(messages.slice(1).map(m=>m.id),[1,2]);
 assert.equal(JSON.parse(messages[1].result.content[0].text)[0].value,'0.3');
});

test('Codex receives the same stdio server through config.mcp_servers',()=>{
 const options=codexOptionsForPhase('review',undefined,{workingDirectory:'/w',readableDirectories:['/r'],reviewFile:'/d/c.json'});
 const server=options.config.mcp_servers.sikun;
 assert.equal(server.command,process.execPath);assert.deepEqual(server.args.slice(1),['--tools','calculate,read_table,extract_text,find_quote,record_criterion,list_criteria']);
 assert.equal(server.env.SIKUN_WORKDIR,'/w');assert.equal(server.env.SIKUN_REVIEW_FILE,'/d/c.json');
 assert.equal(codexOptionsForPhase('work',undefined,{workingDirectory:'/w'}).config.mcp_servers.sikun.env.SIKUN_REVIEW_FILE,undefined);
 assert.equal(codexOptionsForPhase('planning',undefined,{workingDirectory:'/w'}).config.mcp_servers,undefined,'文章だけの段階はツールなし');
 assert.equal(codexOptionsForPhase('work').config,undefined);
});

test('reviewers that record an unmet criterion cannot approve, even if their JSON says approved',async t=>{
 const root=tempDir(t,'sikun-gate-');
 const {JsonStore}=require('../dist/core/store/jsonStore'),{Repository}=require('../dist/core/store/repository'),{ProjectService}=require('../dist/core/services/projectService');
 const {CommissionStore}=require('../dist/core/commission/store'),{CommissionService}=require('../dist/core/commission/service');
 const repo=new Repository(new JsonStore(root)),project=await new ProjectService(repo).createProject('test',''),store=new CommissionStore(root);
 let reviews=0;const reviewFiles=[];
 const agent={async run(r){
  let text='ok';
  if(r.phase==='consultation')text='企画';
  else if(r.phase==='planning')text=JSON.stringify({tasks:[{title:'収支表',instructions:'plan.md',acceptance:'AC-01 合計が正しい',ownerPersonaId:'finance',domainPersonaId:'finance',reviewerPersonaId:'critic'}]});
  else if(r.phase==='work'){assert.equal(r.reviewFile,undefined);fs.writeFileSync(path.join(r.workingDirectory,'plan.md'),'合計 100');}
  else if(r.phase==='review'){
   reviews++;reviewFiles.push(r.reviewFile);
   assert.ok(r.reviewFile.startsWith(path.join(root,'commission-checks')+path.sep),'確認記録はアプリのデータ領域');
   review.recordCriterion(r.reviewFile,reviews===1?{id:'AC-01',criterion:'合計が正しい',result:'fail',evidence:'50違う'}:{id:'AC-01',criterion:'合計が正しい',result:'pass',evidence:'calculate で一致'});
   text=JSON.stringify({approved:true,note:'問題なし'});
  } else if(r.phase==='goal_check'){
   review.recordCriterion(r.reviewFile,{id:'G-1',criterion:'完了条件',result:'pass',evidence:'plan.md'});
   text=JSON.stringify({complete:true,evidence:['plan.md'],remaining:[]});
  }
  return {text,observedModels:['m'],estimatedCostUsd:0,numTurns:1};
 }};
 const service=new CommissionService(store,repo,agent,root),item=await service.create({projectId:project.id,goal:'収支',successCriteria:'合計が正しい',settings:{executionMode:'automatic'}});
 await service.consult(item.id,'収支');
 for(let i=0;i<500&&store.get(item.id).status!=='delivered';i++){if(store.get(item.id).status==='failed')throw Error(store.get(item.id).error);await new Promise(r=>setTimeout(r,10));}
 const done=store.get(item.id);
 assert.equal(done.status,'delivered');assert.equal(reviews,2);assert.notEqual(reviewFiles[0],reviewFiles[1],'確認ごとに別の記録');
 const [first,second]=done.reviewDecisions;
 assert.equal(first.approved,false);assert.match(first.note,/アプリ判定.*AC-01=fail/);assert.equal(first.criteria[0].result,'fail');
 assert.equal(second.approved,true);assert.equal(second.criteria[0].result,'pass');
 assert.equal(done.runs.filter(r=>r.phase==='review').at(-1).criteria[0].evidence,'calculate で一致');
 assert.equal(done.goalChecks.at(-1).complete,true);
 assert.ok(!fs.existsSync(path.join(done.workingDirectory,'commission-checks')),'作業フォルダに記録を書かない');
});

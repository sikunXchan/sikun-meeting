const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {codexOptionsForPhase,CodexAgentClient}=require('../dist/core/commission/codexAgent');
const {canGenerateImages,imageGuide}=require('../dist/core/capabilities');
const {collectGeneratedImages,codexHomeDirectory}=require('../dist/core/commission/codexImages');

function tempDir(t,prefix){
 const base=process.env.SIKUN_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,prefix));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return dir;
}
const png=(seed)=>Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),Buffer.from(seed)]);

test('Codex image generation is on only for image roles in the work phase, and Claude is told it cannot generate',()=>{
 const features=(phase,personaId)=>codexOptionsForPhase(phase,undefined,{workingDirectory:'/w',personaId}).config.features;
 for(const role of ['designer','marketing','frontend','mobile','education'])assert.equal(features('work',role).image_generation,true,role);
 for(const role of ['engineer','finance','qa','legal'])assert.equal(features('work',role).image_generation,false,role);
 for(const phase of ['review','goal_check','consultation','planning','delivery'])assert.equal(features(phase,'designer').image_generation,false,phase);
 assert.ok(codexOptionsForPhase('work',undefined,{workingDirectory:'/w',personaId:'designer'}).config.mcp_servers.sikun,'検証ツールと両立する');
 assert.equal(canGenerateImages('designer','work','claude'),false);
 assert.match(imageGuide('designer','work','codex'),/image_gen/);assert.match(imageGuide('designer','work','codex'),/generated-images\//);
 assert.match(imageGuide('designer','work','claude'),/生成できない/);
 assert.equal(imageGuide('engineer','work','codex'),'');assert.equal(imageGuide('designer','review','codex'),'');
 assert.equal(codexHomeDirectory({CODEX_HOME:'/x/codex'}),'/x/codex');assert.equal(codexHomeDirectory({}),path.join(os.homedir(),'.codex'));
});

test('generated images made during the run are copied into the working folder once, without clobbering or re-copying placed ones',t=>{
 const home=tempDir(t,'sikun-codex-home-'),work=tempDir(t,'sikun-image-work-');
 const gen=path.join(home,'generated_images','thread-1');fs.mkdirSync(gen,{recursive:true});
 const old=path.join(gen,'old.png');fs.writeFileSync(old,png('old'));const past=new Date(Date.now()-3600_000);fs.utimesSync(old,past,past);
 const since=Date.now();
 fs.writeFileSync(path.join(gen,'hero.png'),png('hero'));fs.writeFileSync(path.join(gen,'placed.png'),png('placed'));fs.writeFileSync(path.join(gen,'notes.txt'),'x');
 fs.mkdirSync(path.join(work,'assets'));fs.writeFileSync(path.join(work,'assets','banner.png'),png('placed'));
 fs.mkdirSync(path.join(work,'generated-images'));fs.writeFileSync(path.join(work,'generated-images','hero.png'),png('other'));
 const collected=collectGeneratedImages(home,since,work);
 assert.deepEqual(collected,[{relativePath:'generated-images/hero-2.png',copied:true},{relativePath:'assets/banner.png',copied:false}]);
 assert.deepEqual(fs.readFileSync(path.join(work,'generated-images','hero-2.png')),png('hero'));
 assert.deepEqual(fs.readFileSync(path.join(work,'generated-images','hero.png')),png('other'),'既存のファイルは上書きしない');
 assert.equal(fs.existsSync(path.join(work,'generated-images','old.png')),false,'実行前の画像は取り込まない');
 assert.deepEqual(collectGeneratedImages(home,since,work).map(i=>i.copied),[false,false],'2回目は再コピーしない');
 assert.deepEqual(collectGeneratedImages(path.join(home,'missing'),since,work),[]);
});

test('a Codex run for Designer enables image_gen, and generated images are imported and logged',{skip:process.platform==='win32'&&'fake codex is a shell script'},async t=>{
 const root=tempDir(t,'sikun-fake-codex-'),home=path.join(root,'home'),work=path.join(root,'work'),bin=path.join(root,'resources','codex-runtime','bin');
 fs.mkdirSync(home);fs.mkdirSync(work);fs.mkdirSync(bin,{recursive:true});
 const argsFile=path.join(root,'args.json'),promptFile=path.join(root,'prompt.txt');
 fs.writeFileSync(path.join(bin,'codex.exe'),`#!${process.execPath}
const fs=require('fs'),path=require('path');
fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2)));
let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{
 fs.writeFileSync(${JSON.stringify(promptFile)},input);
 const dir=path.join(process.env.CODEX_HOME,'generated_images','t1');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'ig_1.png'),'\\x89PNG fake');
 const out=(e)=>process.stdout.write(JSON.stringify(e)+'\\n');
 out({type:'thread.started',thread_id:'t1'});out({type:'turn.started'});
 out({type:'item.completed',item:{id:'1',type:'agent_message',text:'モックアップを作成'}});
 out({type:'turn.completed',usage:{input_tokens:1,cached_input_tokens:0,output_tokens:1}});
});
`,{mode:0o755});
 const originalHome=process.env.CODEX_HOME,originalResources=process.resourcesPath;
 process.env.CODEX_HOME=home;Object.defineProperty(process,'resourcesPath',{value:path.join(root,'resources'),configurable:true,writable:true});
 t.after(()=>{if(originalHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=originalHome;process.resourcesPath=originalResources;});
 const logged=[];
 const response=await new CodexAgentClient().run({provider:'codex',phase:'work',personaId:'designer',prompt:'予約画面のモックアップ',workingDirectory:work,model:'gpt-test',tools:'full',maxTurns:1,abortSignal:new AbortController().signal,onTool:d=>logged.push(d)});
 assert.equal(response.text,'モックアップを作成');
 const args=JSON.parse(fs.readFileSync(argsFile,'utf8')).join(' ');
 assert.match(args,/features\.image_generation=true/);
 assert.match(fs.readFileSync(promptFile,'utf8'),/image_gen/);
 assert.deepEqual(logged,['画像生成: generated-images/ig_1.png（作業フォルダへ取り込み）']);
 assert.equal(fs.readFileSync(path.join(work,'generated-images','ig_1.png'),'utf8'),'\x89PNG fake');
 assert.equal(response.toolCalls,1);
});

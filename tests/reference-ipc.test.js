const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
test('attachment IPC accepts only dialog selections, binds them to the sender and invalidates pending dialogs on navigation',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sikun-reference-ipc-'));
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 const file=path.join(root,'note.txt');fs.writeFileSync(file,'dialog content');
 const handlers=new Map(),sender=new EventEmitter();sender.id=21;sender.isDestroyed=()=>false;sender.send=()=>{};
 let result={canceled:false,filePaths:[file]},dialogCalls=0,resolveDialog;
 const electron={app:{getPath:()=>root},ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn)},dialog:{async showOpenDialog(){dialogCalls++;return typeof result==='function'?result():result;}}};
 const Module=require('node:module'),load=Module._load;let registerIpcHandlers,IPC_CHANNELS;
 try {Module._load=function(name,...args){return name==='electron'?electron:load.call(this,name,...args);};({registerIpcHandlers,IPC_CHANNELS}=require('../dist/main/ipc'));}
 finally {Module._load=load;}
 const {rendererUrl}=require('../dist/main/security');
 const created=[];
 const ctx={repo:{listMeetings:()=>[]},discussionService:{},commissionService:{subscribe(){},async create(input,files){created.push({input,files});return {id:'job'};}}};
 registerIpcHandlers(ctx,()=>({webContents:sender}));
 const event={sender,senderFrame:{url:rendererUrl()}},choose=handlers.get(IPC_CHANNELS.chooseFiles),create=handlers.get(IPC_CHANNELS.commissionsCreate);
 assert.throws(()=>create({...event,senderFrame:{url:'https://example.com'}},{goal:'x'}),/許可されていない/);
 assert.throws(()=>create(event,{goal:'x',referenceFiles:[file]}),/選択ダイアログ/);
 await assert.rejects(create(event,{goal:'x',referenceIds:[file]}),/選び直/);
 assert.equal(dialogCalls,0);assert.equal(created.length,0);
 const [selected]=await choose(event,[]);assert.deepEqual(Object.keys(selected).sort(),['id','name']);
 result={canceled:true,filePaths:[]};assert.deepEqual(await choose(event,[selected.id]),[selected]);
 await assert.rejects(create({...event,sender:{id:22}},{referenceIds:[selected.id]}),/選び直/);
 fs.writeFileSync(file,'changed');await create(event,{goal:'x',referenceIds:[selected.id]});
 assert.equal(created[0].files[0].content.toString(),'dialog content');assert.equal(created[0].input.referenceIds,undefined);
 await assert.rejects(create(event,{referenceIds:[selected.id]}),/選び直/);
 result=()=>new Promise(resolve=>{resolveDialog=resolve;});
 const pending=choose(event,[]);sender.emit('did-start-navigation',{},rendererUrl(),false,true);
 resolveDialog({canceled:false,filePaths:[file]});await assert.rejects(pending,/選び直/);
 result={canceled:false,filePaths:[file]};const [later]=await choose(event,[]);sender.emit('destroyed');
 await assert.rejects(create(event,{referenceIds:[later.id]}),/選び直/);
 assert.equal(created.length,1);
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readArtifactPreview}=require('../dist/main/artifactPreview');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'meeting-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const commission=(root,file)=>({workingDirectory:root,artifacts:[{id:'file',relativePath:file,change:'added'}]});
test('tracked markdown and binary image previews are returned without executing content',async t=>{
 const root=setup(t);fs.writeFileSync(path.join(root,'report.md'),'# 実際の成果物');
 assert.deepEqual(await readArtifactPreview(commission(root,'report.md'),'file'),{kind:'markdown',name:'report.md',content:'# 実際の成果物'});
 fs.writeFileSync(path.join(root,'image.png'),Buffer.from([137,80,78,71]));assert.match((await readArtifactPreview(commission(root,'image.png'),'file')).content,/^data:image\/png;base64,/);
});
test('untracked, deleted and outside artifacts cannot be previewed',async t=>{
 const root=setup(t),work=path.join(root,'work');fs.mkdirSync(work);fs.writeFileSync(path.join(root,'outside.txt'),'private');
 await assert.rejects(readArtifactPreview(commission(work,'../outside.txt'),'file'),/場所が不正/);
 await assert.rejects(readArtifactPreview(commission(work,'../outside.txt'),'other'),/見つかりません/);
 const item=commission(root,'outside.txt');item.artifacts[0].change='deleted';await assert.rejects(readArtifactPreview(item,'file'),/見つかりません/);
});
test('junction escape is rejected and oversized or office files receive an honest fallback',async t=>{
 const root=setup(t),work=path.join(root,'work'),outside=path.join(root,'outside');fs.mkdirSync(work);fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'data.txt'),'outside');
 fs.symlinkSync(outside,path.join(work,'link'),'junction');await assert.rejects(readArtifactPreview(commission(work,'link/data.txt'),'file'),/場所が不正/);
 fs.writeFileSync(path.join(work,'large.txt'),Buffer.alloc(4*1024*1024+1));assert.equal((await readArtifactPreview(commission(work,'large.txt'),'file')).kind,'unsupported');
 fs.writeFileSync(path.join(work,'slides.pptx'),'binary');assert.equal((await readArtifactPreview(commission(work,'slides.pptx'),'file')).kind,'unsupported');
});

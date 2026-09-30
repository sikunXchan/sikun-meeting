const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {uxSections,lookupUxPrinciples,parseUxSections}=require('../dist/core/tools/knowledge');
const {skillDetailsFor,skillPromptFor}=require('../dist/core/skills/catalog');
const {verificationToolsFor}=require('../dist/core/capabilities');
const {verificationGuide}=require('../dist/core/tools/catalog');

test('the bundled UI/UX principles parse into 500 numbered sections',()=>{
 const sections=uxSections();
 assert.equal(sections.length,500);
 assert.deepEqual(sections.map(s=>s.number),Array.from({length:500},(_,i)=>i+1));
 assert.match(sections[0].title,/アクセシビリティとコントラスト/);assert.match(sections[0].body,/4\.5:1/);
 assert.match(sections[2].title,/フィッツの法則/);assert.ok(sections.every(s=>s.body.length>0&&!s.body.includes('\n---\n')));
 assert.deepEqual(parseUxSections('# x\n## 1. A\n本文\n\n---\n\n# 2. B\nb\r\n').map(s=>[s.number,s.title,s.body]),[[1,'A','本文'],[2,'B','b']]);
});

test('lookup_ux_principles returns sections by number, by query, or an index',()=>{
 const byNumber=lookupUxPrinciples({numbers:[97,3,999]});
 assert.deepEqual(byNumber.sections.map(s=>s.number),[3,97]);assert.deepEqual(byNumber.missing,[999]);
 assert.match(byNumber.sections[1].title,/プレースホルダー/);
 const query=lookupUxPrinciples({query:'エラーメッセージ',limit:3});
 assert.equal(query.sections.length,3);assert.ok(query.sections.some(s=>s.number===72),query.sections.map(s=>s.number).join(','));
 const broad=lookupUxPrinciples({query:'エラー',limit:3});assert.ok(broad.matched>10);assert.equal(broad.sections.length,3);assert.ok(broad.alsoRelated.length>0);
 const multi=lookupUxPrinciples({query:'フォーム 必須'});assert.ok(multi.sections.some(s=>s.number===155));
 const index=lookupUxPrinciples({});assert.equal(index.total,500);assert.equal(index.index[1],'2. ヤコブの法則（Jakob\'s Law）');
 assert.deepEqual(lookupUxPrinciples({query:'存在しない語xyz'}).sections,[]);
 assert.throws(()=>lookupUxPrinciples({limit:20}),/limit/);assert.throws(()=>lookupUxPrinciples({numbers:Array(11).fill(1)}),/10個/);
 assert.ok(lookupUxPrinciples({numbers:[70]}).sections[0].body.length<=1501);
});

test('Designer applies the UX checklist, and every item number it cites exists',()=>{
 const skill=skillDetailsFor('designer')[0];
 assert.equal(skill.version,'1.3.0');
 const checklist=skill.resources.find(r=>r.name==='references/ux-checklist.md');
 assert.ok(checklist,'確認リストを同梱');assert.ok(Buffer.byteLength(checklist.content)<16384);
 assert.ok(skillPromptFor('designer','work').includes(checklist.content));
 assert.ok(!skillPromptFor('designer','work').includes('# 500.'),'原則集の全文はプロンプトに入れない');
 const titles=new Map(uxSections().map(s=>[s.number,s.title]));
 const cited=[...checklist.content.matchAll(/#(\d+)/g)].map(m=>Number(m[1]));
 assert.ok(cited.length>80);for(const n of cited)assert.ok(titles.has(n),'#'+n);
 for(const [n,word] of [[3,'フィッツ'],[97,'プレースホルダー'],[177,'Line Length'],[72,'エラーメッセージ'],[40,'ダークパターン'],[189,'Response Time']])assert.match(titles.get(n),new RegExp(word),'#'+n);
 for(const role of ['designer','frontend','mobile','accessibility','product'])assert.ok(verificationToolsFor('work',role).includes('mcp__sikun__lookup_ux_principles'),role);
 assert.ok(!verificationToolsFor('work','finance').includes('mcp__sikun__lookup_ux_principles'));
 assert.match(verificationGuide('work','designer'),/#97/);
 assert.ok(fs.existsSync(path.join(__dirname,'..','dist','core','skills','catalog','interface-design','knowledge','ux-principles.md')),'ビルドで dist に同梱');
});

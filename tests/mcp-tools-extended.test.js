const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const docs=require('../dist/core/tools/docs');
const design=require('../dist/core/tools/design');
const code=require('../dist/core/tools/code');
const sources=require('../dist/core/tools/sources');
const browser=require('../dist/core/tools/browser');
const {browserExecutable}=require('../dist/core/commission/browserReview');
const {handleMessage,selectedTools}=require('../dist/mcp/stdio');

function tempDir(t,prefix){
 const base=process.env.SIKUN_TEST_ROOT||os.tmpdir();fs.mkdirSync(base,{recursive:true});
 const dir=fs.mkdtempSync(path.join(base,prefix));
 t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(base)+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
 return dir;
}

test('document tools extract, diff, verify quotes and check structure',async t=>{
 const work=tempDir(t,'sikun-docs-'),scope={workingDirectory:work,readableDirectories:[]};
 fs.writeFileSync(path.join(work,'v1.md'),'# 契約\n第1条 支払期日は月末とする。\n第2条 解約は30日前に通知する。\n');
 fs.writeFileSync(path.join(work,'v2.md'),'# 契約\n第1条 支払期日は翌月10日とする。\n第2条 解約は30日前に通知する。\n');
 const diff=await docs.textDiff({file:'v1.md'},{file:'v2.md'},scope);
 assert.equal(diff.identical,false);assert.equal(diff.stats.added,1);assert.match(diff.patch,/-第1条 支払期日は月末とする。\n\+第1条 支払期日は翌月10日とする。/);
 assert.equal((await docs.textDiff({text:'a b c'},{text:'a b c'},scope,'words')).identical,true);
 const found=await docs.findQuote('v2.md','支払期日は 翌月１０日',scope);
 assert.equal(found.found,true,'全角数字と空白の違いを正規化して見つける');
 const missing=await docs.findQuote('v2.md','支払期日は翌月末日とする',scope);
 assert.equal(missing.found,false);assert.ok(missing.similarity>0.5&&missing.similarity<1);assert.match(missing.closest,/支払期日/);
 const html='<html><body><h1>案内</h1><p>本文&amp;説明</p><script>x()</script><h3>飛び</h3><a href="v1.md#契約">ok</a><a href="none.md">ng</a><a href="v1.md#なし">ng</a><img src="logo.png"><a href="https://example.com">ext</a></body></html>';
 fs.writeFileSync(path.join(work,'page.html'),html);
 const extracted=await docs.extractText('page.html',scope);
 assert.match(extracted.text,/本文&説明/);assert.doesNotMatch(extracted.text,/x\(\)/);
 const outline=await docs.documentOutline('page.html',scope);
 assert.ok(outline.issues.some(issue=>/h1 から h3/.test(issue)),outline.issues.join('|'));
 const links=await docs.checkLinks('page.html',scope);
 assert.deepEqual(links.broken.map(b=>b.url).sort(),['logo.png','none.md','v1.md#なし'].sort());assert.deepEqual(links.external,['https://example.com']);
 const stats=await docs.textStats({text:'短い文。これはとても長い文です。\n\n次の段落。'},scope);
 assert.equal(stats.sentences,3);assert.equal(stats.paragraphs,2);
 fs.writeFileSync(path.join(work,'en.json'),JSON.stringify({greet:'Hello {name}',count:'%d items',html:'<b>Save</b>',only:'x'}));
 fs.writeFileSync(path.join(work,'ja.json'),JSON.stringify({greet:'こんにちは {name}',count:'件数',html:'<b>保存</b>',extra:'余分'}));
 const ph=await docs.checkPlaceholders({file:'en.json'},{file:'ja.json'},scope);
 assert.deepEqual(ph.issues.map(i=>`${i.key}:${i.problem}`).sort(),['count:変数・タグが一致しません','extra:原文にないキー','only:訳がありません']);
 const terms=await docs.checkTerms({text:'ユーザーとユーザの違い\nログインはＩＤで'},[{preferred:'ユーザー',variants:['ユーザ']}],scope);
 assert.equal(terms.findingCount,1,'正しい表記の一部は数えない');assert.equal(terms.findings[0].line,1);assert.equal(terms.fullWidthAlphanumericLines[0].line,2);
 const mammothDoc=path.join(__dirname,'..','node_modules','mammoth','test','test-data','single-paragraph.docx');
 if(fs.existsSync(mammothDoc)){fs.copyFileSync(mammothDoc,path.join(work,'w.docx'));assert.match((await docs.extractText('w.docx',scope)).text,/\S/);}
 await assert.rejects(docs.extractText('/etc/passwd',scope),/外のファイル/);
});

test('PDF text is extracted with page markers',async t=>{
 const work=tempDir(t,'sikun-pdf-'),scope={workingDirectory:work,readableDirectories:[]};
 const pdf='%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 18 Tf 20 100 Td (Invoice total 1200) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF';
 fs.writeFileSync(path.join(work,'a.pdf'),pdf);
 const result=await docs.extractText('a.pdf',scope);
 assert.equal(result.pages,1);assert.match(result.text,/1ページ[\s\S]*Invoice total 1200/);
 assert.equal((await docs.findQuote('a.pdf','Invoice total 1200',scope)).found,true);
});

test('design tools measure contrast, build palettes and compare images',async t=>{
 const work=tempDir(t,'sikun-design-'),scope={workingDirectory:work,readableDirectories:[]};
 const bw=await design.colorContrast('#000','#fff');assert.equal(bw.ratio,21);assert.equal(bw.normalTextAAA,true);
 const gray=await design.colorContrast('#777777','#ffffff');assert.equal(gray.ratio,4.48);assert.equal(gray.normalTextAA,false);assert.equal(gray.largeTextAA,true);
 const translucent=await design.colorContrast('rgb(0 0 0 / 50%)','#ffffff');assert.equal(translucent.foreground,'#808080');
 await assert.rejects(design.colorContrast('#000','rgb(0 0 0 / 50%)'),/不透明/);
 await assert.rejects(design.colorContrast('nope','#fff'),/色として読めません/);
 const palette=await design.colorPalette('#1a73e8',5);assert.equal(palette.colors.length,5);
 assert.ok(palette.colors[0].lightness>palette.colors[4].lightness);assert.equal(palette.colors[0].readableText,'#000000');assert.equal(palette.colors[4].readableText,'#ffffff');
 const compared=await design.compareColors(['#ff0000',{name:'ほぼ赤',color:'#fe0101'},'#0000ff']);
 const near=compared.pairs.find(p=>p.b==='ほぼ赤');assert.equal(near.nearlyIdentical,true);assert.ok(near.deltaE2000<1);
 const {PNG}=require('pngjs');
 const make=(file,changed)=>{const png=new PNG({width:20,height:10});for(let i=0;i<200;i++){png.data[i*4]=255;png.data[i*4+1]=255;png.data[i*4+2]=255;png.data[i*4+3]=255;}if(changed)for(let i=0;i<10;i++){png.data[i*4]=0;png.data[i*4+1]=0;}fs.writeFileSync(path.join(work,file),PNG.sync.write(png));};
 make('a.png',false);make('b.png',true);
 const info=await design.imageInfo('a.png',scope);assert.equal(info.width,20);assert.equal(info.format,'png');assert.equal(info.dominantColors[0].hex,'#ffffff');assert.equal(info.hasTransparency,false);
 const same=await design.compareImages('a.png','a.png',scope);assert.equal(same.identical,true);
 const changed=await design.compareImages('a.png','b.png',scope);
 assert.equal(changed.mcpContent[1].type,'image');assert.equal(JSON.parse(changed.mcpContent[0].text).changedPixels,10);
 fs.writeFileSync(path.join(work,'icon.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><!-- c --><g><rect x="0" y="0" width="10" height="10" fill="#ff0000"/></g><script>alert(1)</script></svg>');
 const svg=await design.optimizeSvg('icon.svg',scope);
 assert.ok(svg.bytesAfter<svg.bytesBefore);assert.ok(svg.issues.some(i=>/viewBox/.test(i)));assert.ok(svg.issues.some(i=>/script/.test(i)));
 assert.equal(fs.readFileSync(path.join(work,'icon.svg'),'utf8').includes('<!-- c -->'),true,'元ファイルは変更しない');
});

test('code tools check regexes, versions, configs, schemas and cron',async t=>{
 const work=tempDir(t,'sikun-code-'),scope={workingDirectory:work,readableDirectories:[]};
 const regex=code.testRegex('^(\\d{3})-(\\d{4})$','',['123-4567','1234567']);
 assert.deepEqual(regex.results.map(r=>r.fullMatch),[true,false]);assert.deepEqual(regex.results[0].matches[0].groups,['123','4567']);
 assert.throws(()=>code.testRegex('(',undefined,['x']),/Invalid regular expression|正規表現/);
 const versions=code.compareVersions(['1.2.0','1.10.0','2.0.0-beta.1','bad'],'^1.2.0');
 assert.deepEqual(versions.sorted,['1.2.0','1.10.0','2.0.0-beta.1']);assert.deepEqual(versions.satisfying,['1.2.0','1.10.0']);assert.deepEqual(versions.invalid,['bad']);
 fs.writeFileSync(path.join(work,'ok.toml'),'title = "x"\n[server]\nport = 8080\n');
 fs.writeFileSync(path.join(work,'bad.json'),'{\n  "a": 1,\n  "b": \n}');
 fs.writeFileSync(path.join(work,'bad.yaml'),'a: 1\n b: 2\n');
 assert.deepEqual((await code.validateConfig('ok.toml',scope)).topLevelKeys,['title','server']);
 const badJson=await code.validateConfig('bad.json',scope);assert.equal(badJson.valid,false);assert.equal(badJson.line,4);
 const badYaml=await code.validateConfig('bad.yaml',scope);assert.equal(badYaml.valid,false);assert.equal(badYaml.line,2);
 const schema={type:'object',required:['name','price'],properties:{name:{type:'string'},price:{type:'number',minimum:0}}};
 assert.equal((await code.validateJsonSchema({data:{name:'a',price:1},schema},scope)).valid,true);
 const invalid=await code.validateJsonSchema({data:{price:-1},schema},scope);
 assert.equal(invalid.valid,false);assert.deepEqual(invalid.errors.map(e=>e.keyword).sort(),['minimum','required']);
 const cron=code.explainCron('0 9 * * 1-5',3,'Asia/Tokyo','2026-10-02T12:00:00+09:00');
 assert.equal(cron.next.length,3);assert.match(cron.next[0],/2026-10-05T00:00:00.000Z/,'金曜12時の次は月曜9時');assert.equal(cron.fields['曜日'],'1-5');
});

test('sources are recorded per commission outside the workspace',t=>{
 const dir=tempDir(t,'sikun-src-'),file=path.join(dir,'sources','c.json');
 assert.throws(()=>sources.recordSource(undefined,{url:'https://a',title:'x'}),/記録できません/);
 assert.throws(()=>sources.recordSource(file,{url:'ftp://a',title:'x'}),/http/);
 assert.throws(()=>sources.recordSource(file,{url:'https://a',title:'x',published:'2026/1/1'}),/YYYY/);
 const first=sources.recordSource(file,{url:'https://www.e-gov.go.jp/law',title:'個人情報保護法',published:'2026-04-01',quote:'第1条…',claim:'目的規定'});
 assert.equal(first.recorded.id,'S1');assert.match(first.recorded.accessed,/^\d{4}-\d{2}-\d{2}$/);
 sources.recordSource(file,{url:'https://example.com/b',title:'解説'});
 const list=sources.listSources(file);assert.equal(list.total,2);assert.deepEqual(list.missingPublished,['S2']);assert.deepEqual(list.missingQuote,['S2']);
});

test('image results pass through the MCP server as image content',async t=>{
 const work=tempDir(t,'sikun-mcp-img-');
 const {PNG}=require('pngjs');
 for(const [file,value] of [['a.png',255],['b.png',0]]){const png=new PNG({width:4,height:4});png.data.fill(value);for(let i=3;i<png.data.length;i+=4)png.data[i]=255;fs.writeFileSync(path.join(work,file),PNG.sync.write(png));}
 const tools=selectedTools('design');
 const reply=await handleMessage({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'compare_images',arguments:{before:'a.png',after:'b.png'}}},tools,{workingDirectory:work,readableDirectories:[]});
 assert.deepEqual(reply.result.content.map(block=>block.type),['text','image']);assert.equal(reply.result.content[1].mimeType,'image/png');
 const list=(await handleMessage({jsonrpc:'2.0',id:2,method:'tools/list'},selectedTools('sources'),{workingDirectory:work,readableDirectories:[]})).result.tools;
 assert.equal(list.find(tool=>tool.name==='record_source').annotations.readOnlyHint,false);
});

test('browser tools screenshot, audit and check layout of local HTML',{skip:!browserExecutable()&&'Chrome/Edge unavailable'},async t=>{
 const work=tempDir(t,'sikun-browser-tools-'),scope={workingDirectory:work,readableDirectories:[]};
 fs.writeFileSync(path.join(work,'index.html'),'<!doctype html><html lang="ja"><head><title>t</title><meta name="viewport" content="width=device-width"></head><body style="margin:0"><h1>見出し</h1><img src="x.png"><div id="wide" style="width:600px;height:20px;background:#eee"></div><button id="tiny" style="width:10px;height:10px;padding:0"></button><p style="color:#bbb">薄い文字</p><p id="small" style="font-size:9px">小さい</p></body></html>');
 const shot=await browser.screenshotPage(scope,'index.html',400,300);
 assert.equal(shot.mcpContent[1].type,'image');assert.equal(JSON.parse(shot.mcpContent[0].text).horizontalScroll,true);
 const audit=await browser.auditAccessibility(scope,'index.html');
 const ids=audit.violations.map(v=>v.id);assert.ok(ids.includes('image-alt'),ids.join(','));assert.ok(ids.includes('color-contrast'),ids.join(','));assert.ok(ids.includes('button-name'),ids.join(','));
 const layout=await browser.checkLayout(scope,'index.html',[375,1280]);
 const [narrow,widePage]=layout.results;
 assert.equal(narrow.horizontalScroll,true);assert.ok(narrow.overflowing.some(o=>o.selector==='#wide'));assert.equal(widePage.horizontalScroll,false);
 assert.ok(narrow.smallTapTargets.some(o=>o.selector==='#tiny'));assert.ok(narrow.smallText.some(o=>o.selector==='#small'));assert.equal(narrow.imagesWithoutAlt.length,1);
 await assert.rejects(browser.screenshotPage(scope,'../secret.html'),/ファイル名が不正|作業フォルダ外|no such file|ENOENT/);
});

// @ts-nocheck
// Each surface owns its loading token, PDF document and cancellation lifecycle.
(() => {
  const states = new WeakMap();
  let pdfLibrary;
  const pdfjs = () => pdfLibrary ||= window.loadPdfLibrary().then(lib => {
    lib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', location.href).href;
    return lib;
  });
  const node = (tag, text, className) => { const n=document.createElement(tag); if(text)n.textContent=text; if(className)n.className=className;return n; };
  function clear(parent) {
    const old=states.get(parent); if(old){old.cancelled=true;void old.task?.destroy().catch(()=>{});}
    const state={cancelled:false};states.set(parent,state);parent.replaceChildren();return state;
  }
  window.clearArtifactPreview=clear;
  window.renderArtifactPreview=async (parent,item,artifact) => {
    const state=clear(parent);
    parent.append(node('p','読み込み中…','preview-caption'));
    try {
      const result=await window.api.commissions.previewArtifact(item.id,artifact.id);
      if(state.cancelled)return;
      parent.replaceChildren();
      if(result.kind==='pdf') {
        const lib=await pdfjs(); if(state.cancelled)return;
        state.task=lib.getDocument({data:Uint8Array.from(atob(result.content),c=>c.charCodeAt(0)),isEvalSupported:false,useWasm:false,
          cMapUrl:new URL('./vendor/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',location.href).href});
        const pdf=await state.task.promise;state.document=pdf;
        if(state.cancelled)return;
        const stage=node('div','','pdf-stage'),canvas=node('canvas'),bar=node('div','','pdf-controls');
        canvas.setAttribute('aria-label',result.name);canvas.setAttribute('role','img');stage.append(canvas);
        let pageNumber=1,zoom=1,rendering=false;
        const prev=node('button','‹','secondary'),next=node('button','›','secondary'),label=node('span'),minus=node('button','−','secondary'),plus=node('button','＋','secondary'),zoomLabel=node('span');
        prev.setAttribute('aria-label','前のページ');next.setAttribute('aria-label','次のページ');minus.setAttribute('aria-label','縮小');plus.setAttribute('aria-label','拡大');
        for(const button of [prev,next,minus,plus])button.type='button';
        bar.append(prev,label,next,minus,zoomLabel,plus);parent.append(stage,bar);
        async function draw(){
          if(rendering||state.cancelled)return;rendering=true;
          for(const b of [prev,next,minus,plus])b.disabled=true;
          try {
            const page=await pdf.getPage(pageNumber);if(state.cancelled)return;
            const natural=page.getViewport({scale:1}),width=Math.max(260,parent.clientWidth-40);
            const scale=Math.min(width/natural.width,1.6)*zoom,ratio=Math.min(devicePixelRatio||1,2);
            const viewport=page.getViewport({scale});
            canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);
            canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
            await page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]}).promise;
            label.textContent=`${pageNumber} / ${pdf.numPages}`;zoomLabel.textContent=Math.round(zoom*100)+'%';
          } catch(error){if(!state.cancelled)parent.replaceChildren(node('p','PDFを表示できません。'+error.message,'preview-error'));}
          finally {rendering=false;prev.disabled=pageNumber<=1;next.disabled=pageNumber>=pdf.numPages;minus.disabled=zoom<=.5;plus.disabled=zoom>=2;}
        }
        prev.onclick=()=>{pageNumber--;void draw();};next.onclick=()=>{pageNumber++;void draw();};minus.onclick=()=>{zoom=Math.max(.5,zoom-.25);void draw();};plus.onclick=()=>{zoom=Math.min(2,zoom+.25);void draw();};
        await draw();
      } else if(result.kind==='sheet') {
        const tabs=node('div','','sheet-tabs'),paper=node('article','','artifact-paper sheet-paper');
        result.sheets.forEach((sheet,index)=>{const b=node('button',sheet.name,'secondary');b.type='button';b.onclick=()=>{
          for(const other of tabs.children)other.setAttribute('aria-pressed',String(other===b));
          paper.replaceChildren();const table=node('table');
          sheet.rows.forEach((row,i)=>{const tr=node('tr');for(const value of row)tr.append(node(i===0?'th':'td',String(value)));table.append(tr);});
          paper.append(table);if(sheet.truncated)paper.append(node('p','先頭200行・30列を表示しています。全体は対応アプリで開けます。','field-help'));
        };tabs.append(b);if(index===0)b.click();});parent.append(tabs,paper);
      } else if(result.kind==='image') {
        const img=node('img','','preview-image');img.src=result.content;img.alt=result.name;parent.append(img);
      } else if(result.kind==='unsupported') {
        const box=node('div','','preview-placeholder');box.append(node('strong',result.name),node('span',result.reason));parent.append(box);
      } else {
        const paper=node('article','','artifact-paper markdown-body');
        if(result.kind==='markdown')paper.innerHTML=window.renderMarkdownSafe(result.content);
        else if(result.kind==='html')paper.innerHTML=window.sanitizeHtml(result.content);
        else paper.append(node('pre',result.content,'preview-text'));
        parent.append(paper);
      }
    } catch(error){if(!state.cancelled){parent.replaceChildren(node('p','プレビューを表示できません。'+error.message,'preview-error'));}}
  };
})();

// @ts-nocheck
// Approved A/C workspace. The main process remains authoritative for files and execution.
(() => {
  const api = window.api, el = (id) => document.getElementById(id);
  const labels = { consulting:'企画を作成中', running:'作業中', paused:'一時停止', stopped:'停止', interrupted:'中断', failed:'要確認', delivered:'完成' };
  const personas = new Map();
  let current = null, currentSnapshot = null, items = [], artifactId = null, previewKey = '', listKey = '', interventionBusy = false;
  const button = (text, fn, className = 'secondary') => { const b=document.createElement('button'); b.type='button'; b.className=className; b.textContent=text; b.addEventListener('click',fn); return b; };
  const open = (id) => window.dispatchEvent(new CustomEvent('commission:open',{detail:id}));
  const empty = (parent, text) => { const box=document.createElement('div'); box.className='empty-work'; const image=document.createElement('img'); image.src='assets/guide-bear.png'; image.alt=''; box.append(image,document.createTextNode(text)); parent.append(box); };

  const detailTabs=[...el('workroom-tabs').querySelectorAll('[role="tab"]')], selectedDetailTabs=new Map();
  function selectDetailTab(id,focus=false) {
    for(const tab of detailTabs){const selected=tab.id===id;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;el(tab.getAttribute('aria-controls')).classList.toggle('hidden',!selected);}
    if(current)selectedDetailTabs.set(current.id,id);
    if(focus)el(id).focus();
  }
  detailTabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectDetailTab(tab.id));
    tab.addEventListener('keydown',event=>{const next=event.key==='ArrowRight'?(index+1)%detailTabs.length:event.key==='ArrowLeft'?(index+detailTabs.length-1)%detailTabs.length:event.key==='Home'?0:event.key==='End'?detailTabs.length-1:null;if(next!==null){event.preventDefault();selectDetailTab(detailTabs[next].id,true);}});
  });

  const workspacePanels = ['workspace-meetings','workspace-settings','workspace-library','empty-state','new-meeting-form','meeting-view','project-view','commission-create','commission-view','community-view','mobile-view'];
  function showWorkspacePage(id) {
    window.dispatchEvent(new Event('commission:leave'));
    for (const panel of workspacePanels) el(panel).classList.toggle('hidden', panel !== id);
    document.body.classList.remove('commission-active','community-active','project-active');
    for (const item of ['sidebar-roster','sidebar-chief','tb-status','tb-elapsed']) el(item).classList.add('hidden');
    el('main').scrollTop = 0;
  }
  el('workspace-meetings-btn').addEventListener('click', () => showWorkspacePage('workspace-meetings'));
  el('workspace-settings-btn').addEventListener('click', () => showWorkspacePage('workspace-settings'));
  const navigationGroups = [
    ['commission-new-btn', ['commission-create','commission-view']],
    ['workspace-meetings-btn', ['workspace-meetings','new-meeting-form','meeting-view']],
    ['workspace-files-btn', ['workspace-library']],
    ['workspace-settings-btn', ['workspace-settings','project-view','community-view','mobile-view']],
  ];
  function syncWorkspaceNavigation() {
    for (const [buttonId, panels] of navigationGroups) {
      const selected = panels.some(id => !el(id).classList.contains('hidden'));
      if (selected) el(buttonId).setAttribute('aria-current','page');
      else el(buttonId).removeAttribute('aria-current');
    }
  }
  const navigationObserver = new MutationObserver(syncWorkspaceNavigation);
  for (const id of workspacePanels) navigationObserver.observe(el(id), {attributes:true,attributeFilter:['class']});
  syncWorkspaceNavigation();

  const requestTabs = [...document.querySelectorAll('[data-request-tab]')];
  function selectRequestTab(name) {
    for (const tab of requestTabs) {
      const selected = tab.dataset.requestTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      el(tab.getAttribute('aria-controls')).classList.toggle('hidden', !selected);
    }
  }
  for (const [index, tab] of requestTabs.entries()) {
    tab.addEventListener('click', () => selectRequestTab(tab.dataset.requestTab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index+1)%requestTabs.length
        : event.key === 'ArrowLeft' ? (index+requestTabs.length-1)%requestTabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? requestTabs.length-1 : null;
      if (next === null) return;
      event.preventDefault();
      selectRequestTab(requestTabs[next].dataset.requestTab);
      requestTabs[next].focus();
    });
  }

  function card(item) {
    const b=button('',()=>open(item.id),'recent-job'); b.dataset.jobId=item.id;
    const title=document.createElement('strong'); title.textContent=item.goal;
    const meta=document.createElement('div'); meta.className='job-meta';
    const status=document.createElement('span'); status.textContent=labels[item.status];
    const date=document.createElement('span'); date.textContent=new Date(item.updatedAt).toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'});
    meta.append(status,date); b.append(title,meta);
    const artifact=[...(item.artifacts||[])].reverse().find(a=>a.change!=='deleted');
    const thumb=document.createElement('div'); thumb.className='file-thumbnail';
    const type=document.createElement('span'); type.className='file-extension'; type.textContent=artifact ? artifact.relativePath.split('.').at(-1).slice(0,8).toUpperCase() : item.planText ? '企画' : '準備中';
    const file=document.createElement('span'); file.textContent=artifact?.relativePath || (item.workItems?.length ? `${item.workItems.filter(w=>w.status==='accepted').length} / ${item.workItems.length} 件確認済み` : item.planText ? '企画を開く' : item.status==='consulting' ? '企画を準備しています' : '依頼の内容を開く');
    thumb.append(type,file); b.append(thumb);
    return b;
  }

  function renderLists(commissions) {
    items=[...commissions].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const signature=JSON.stringify(items.map(i=>[i.id,i.updatedAt,i.status,i.goal,i.artifacts?.length]));
    if(signature===listKey)return; listKey=signature;
    const active=el('workspace-active-jobs'),recent=el('workspace-recent-files');
    const focused=document.activeElement?.dataset?.jobId;
    active.replaceChildren(); recent.replaceChildren();
    const unfinished=items.filter(i=>i.status!=='delivered'),completed=items.filter(i=>i.status==='delivered');
    unfinished.slice(0,4).forEach(i=>active.append(card(i)));
    completed.forEach(i=>recent.append(card(i)));
    if(!unfinished.length)empty(active,'進行中の依頼はありません');
    if(!completed.length)empty(recent,'完成した仕事がここに並びます');
    if(unfinished.length>4)active.append(button(`ほか ${unfinished.length-4} 件を表示`,event=>{event.currentTarget.remove();unfinished.slice(4).forEach(i=>active.append(card(i)));},'text-button'));
    window.dispatchEvent(new CustomEvent('pearl:items',{detail:items}));
    if(focused) [...document.querySelectorAll('[data-job-id]')].find(b=>b.dataset.jobId===focused)?.focus();
  }

  function placeholder(title, text) {
    const box=document.createElement('div'); box.className='preview-placeholder';
    const image=document.createElement('img'); image.src='assets/personas/engineer.png'; image.alt='';
    const heading=document.createElement('strong'); heading.textContent=title;
    const detail=document.createElement('span'); detail.textContent=text; box.append(image,heading,detail); return box;
  }

  async function preview(item, artifact, force=false) {
    const key=JSON.stringify([item.id,artifact?.id,artifact?.afterHash,artifact?.status,artifact?.detectedAt,artifact ? null : [item.status,item.delivery,item.planText]]);
    if(!force && key===previewKey)return; previewKey=key;
    const parent=el('workspace-artifact-preview');
    parent.replaceChildren();
    el('workspace-reveal').classList.toggle('hidden',!artifact);
    if(!artifact) {
      if(item.delivery||item.planText) {
        const caption=document.createElement('p'); caption.className='preview-caption'; caption.textContent=item.delivery?'完了報告':'企画 · 成果ファイルができると、ここに表示されます';
        const paper=document.createElement('article'); paper.className='artifact-paper markdown-body'; paper.innerHTML=window.renderMarkdownSafe(item.delivery||item.planText); parent.append(caption,paper);
      } else parent.append(placeholder('成果物を準備しています','作成したファイルがここに表示されます'));
      return;
    }
    await window.renderArtifactPreview(parent,item,artifact);
  }

  function renderTeam(item,stage,run) {
    const team=el('commission-team-strip'); team.replaceChildren();
    const groups=[['企画',['consultation','planning'],'product'],['作成',['work'],'engineer'],['確認',['review','goal_check','kgi_check'],'qa']];
    groups.forEach(([title,phases,fallback],index)=>{
      const last=item.runs.findLast(r=>phases.includes(r.phase)),person=personas.get(last?.personaId||fallback);
      const row=document.createElement('div');row.className='team-station';row.dataset.phase=String(index);
      const active=run&&phases.includes(run.phase);row.classList.toggle('is-active',Boolean(active));
      row.classList.toggle('is-current',index===(run?groups.findIndex(g=>g[1].includes(run.phase)):Math.min(stage,2)) || (run?.phase==='delivery'&&index===2));
      const image=document.createElement('img');image.alt=''; image.src=`assets/personas/${person && /^[a-z0-9_-]+\.png$/.test(person.avatar)?person.avatar:fallback+'.png'}`;
      const copy=document.createElement('div'),heading=document.createElement('strong'),name=document.createElement('small'),status=document.createElement('span');
      heading.textContent=title;name.textContent=person?.name||'';
      status.textContent=active ? (index===2?'確認中':'作業中') : item.status==='delivered'?'完了':last?.status==='failed'?'要確認':last?.status==='interrupted'?'中断':last?.status==='completed'?'実行済み':'待機';
      row.dataset.state=active?'running':item.status==='delivered'||last?.status==='completed'?'completed':last?.status==='failed'?'failed':'waiting';
      status.className='team-status';
      copy.append(heading,name,status);row.append(image,copy);team.append(row);
    });
    const live=el('commission-live-stage');live.replaceChildren();
    const heading=document.createElement('strong');heading.textContent=run ? ({planning:'仕事と担当を決定中',work:'成果物を作成中',review:'成果物を確認中',goal_check:'完了条件を確認中',kgi_check:'KGIを確認中',delivery:'納品内容を整理中'}[run.phase]||'企画を作成中') : labels[item.status];
    const note=document.createElement('span');
    const accepted=item.workItems.filter(w=>w.status==='accepted').length;
    note.textContent=item.workItems.length ? `確認済みの仕事 ${accepted} / ${item.workItems.length}` : '';
    live.append(heading,note);
  }

  function render(snapshot) {
    currentSnapshot=snapshot;
    const item=snapshot.commission;
    const changed=current?.id!==item.id;
    if(changed){artifactId=null;previewKey='';el('workspace-instruction-form').classList.add('hidden');el('workspace-instruction').value='';}
    current=item;
    if(changed)selectDetailTab(selectedDetailTabs.get(item.id)||'workroom-tab-files');
    el('workroom-task-count').textContent=item.workItems.length?`${item.workItems.length}件の作業 · 行を開くと確認担当と詳細を表示`:'企画が決まると、担当と作業が表示されます。';
    el('commission-title').title=item.goal;
    document.querySelector('.workroom-controls .row').classList.toggle('hidden',item.status==='consulting');
    const run=item.runs.findLast(r=>r.status==='running');
    const stage=item.status==='delivered'?3:run?(['consultation','planning'].includes(run.phase)?0:run.phase==='work'?1:2):item.workItems.length?1:0;
    const track=el('workspace-stage-track');track.replaceChildren();
    ['企画','作成','確認'].forEach((label,index)=>{const li=document.createElement('li');li.textContent=label;li.className=index<stage?'done':index===stage?'current':'';if(index===stage)li.setAttribute('aria-current','step');track.append(li);});
    renderTeam(item,stage,run);
    el('commission-status').dataset.state=item.status;
    const activity=el('workspace-recent-activity');activity.replaceChildren();
    const events=(snapshot.events||[]).filter(e=>e.detail?.trim()).slice(-1);
    if(!events.length)activity.textContent='作業が進むと記録されます。';
    for(const event of events){
      const entry=document.createElement('span');entry.className='activity-item';entry.dataset.kind=event.kind;
      const time=document.createElement('time');time.dateTime=event.at;time.textContent=new Date(event.at).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
      const text=document.createElement('span');text.textContent=event.detail.replace(/[#*`]/g,'').trim();entry.title=event.detail;entry.append(time,text);activity.append(entry);
    }
    if(item.status==='running')el('commission-status').textContent=item.settings.executionMode==='automatic'?'自動で進行中':'作業中';
    el('commission-next').classList.toggle('hidden',item.status==='running'||item.status==='delivered');
    window.dispatchEvent(new CustomEvent('pearl:work',{detail:item}));
    const artifacts=[...new Map((item.artifacts||[]).map(a=>[a.relativePath,a])).values()].filter(a=>a.change!=='deleted');
    if(!artifacts.some(a=>a.id===artifactId))artifactId=artifacts.at(-1)?.id||null;
    const tabs=el('workspace-artifact-tabs');
    const signature=artifacts.map(a=>a.id+':'+a.status).join('|')+'|'+artifactId;
    if(tabs.dataset.signature!==signature){tabs.dataset.signature=signature;tabs.replaceChildren();
      for(const artifact of artifacts){const tab=button(artifact.relativePath,()=>{if(!currentSnapshot)return;artifactId=artifact.id;render(currentSnapshot);});tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(artifact.id===artifactId));tab.title=artifact.relativePath;tabs.append(tab);}
    }
    void preview(item,artifacts.find(a=>a.id===artifactId));
    el('workspace-check').classList.toggle('hidden',item.status!=='running');
    el('workspace-check').disabled=interventionBusy;
    el('workspace-add-instruction').disabled=interventionBusy||item.status==='consulting';
    el('workspace-send-instruction').disabled=interventionBusy;
  }

  async function intervention(fn) {
    if(interventionBusy||!current)return;
    interventionBusy=true;const id=current.id;el('workspace-instruction-error').textContent='';
    try {await fn(id);const snapshot=await api.commissions.get(id);if(current?.id===id){render(snapshot);window.dispatchEvent(new CustomEvent('commission:open',{detail:id}));}}
    catch(error){el('workspace-instruction-form').classList.remove('hidden');el('workspace-instruction-error').textContent=error.message;}
    finally{interventionBusy=false;el('workspace-check').disabled=false;el('workspace-add-instruction').disabled=false;el('workspace-send-instruction').disabled=false;}
  }
  el('workspace-reveal').addEventListener('click',()=>{if(current&&artifactId)void api.commissions.openArtifact(current.id,artifactId).catch(e=>{el('commission-error').textContent=e.message;el('commission-error').classList.remove('hidden');});});
  el('workspace-back').addEventListener('click',()=>{el('commission-new-btn').click();window.dispatchEvent(new CustomEvent('request:section',{detail:'existing'}));});
  el('workroom-meetings').addEventListener('click',()=>el('workspace-meetings-btn').click());
  el('workspace-show-history').addEventListener('click',()=>selectDetailTab('workroom-tab-activity',true));
  el('workspace-add-instruction').addEventListener('click',()=>{el('workspace-instruction-form').classList.remove('hidden');el('workspace-instruction').focus();});
  el('workspace-cancel-instruction').addEventListener('click',()=>el('workspace-instruction-form').classList.add('hidden'));
  el('workspace-check').addEventListener('click',()=>intervention(id=>api.commissions.pause(id)));
  el('workspace-send-instruction').addEventListener('click',()=>{
    const text=el('workspace-instruction').value.trim();if(!text){el('workspace-instruction-error').textContent='追加の指示を入力してください';return;}
    void intervention(async id=>{await api.commissions.addInstruction(id,text);el('workspace-instruction').value='';el('workspace-instruction-form').classList.add('hidden');});
  });
  el('workspace-files-btn').addEventListener('click',()=>{
    window.dispatchEvent(new Event('commission:leave'));
    for(const id of ['workspace-meetings','workspace-settings','empty-state','new-meeting-form','meeting-view','project-view','commission-create','commission-view','community-view','mobile-view'])el(id).classList.add('hidden');
    document.body.classList.remove('commission-active','community-active','project-active');
    el('sidebar-roster').classList.add('hidden');el('sidebar-chief').classList.add('hidden');
    el('workspace-library').classList.remove('hidden');el('workspace-files-btn').setAttribute('aria-current','page');el('main').scrollTop=0;
    void api.commissions.list().then(renderLists);
  });
  new MutationObserver(()=>{if(el('workspace-library').classList.contains('hidden'))el('workspace-files-btn').removeAttribute('aria-current');}).observe(el('workspace-library'),{attributes:true,attributeFilter:['class']});
  window.addEventListener('workspace:list',e=>renderLists(e.detail));
  window.addEventListener('workspace:render',e=>render(e.detail));
  window.addEventListener('commission:leave',()=>{current=null;currentSnapshot=null;previewKey='';});
  void api.personas.list().then(list=>{list.forEach(p=>personas.set(p.id,p));});
  void api.commissions.list().then(renderLists);
})();

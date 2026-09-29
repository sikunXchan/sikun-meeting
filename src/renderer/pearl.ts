// @ts-nocheck
// Approved pearl-lilac workspace. Existing controls retain their IDs and handlers.
(() => {
  const el=id=>document.getElementById(id),api=window.api;
  const make=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const markup=(tag,cls,html)=>{const n=make(tag,cls);n.innerHTML=html;return n;};
  const click=(text,fn,cls='secondary')=>{const b=make('button',cls,text);b.type='button';b.onclick=fn;return b;};
  const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><use href="assets/pearl-icons.svg#${name}"/></svg>`;
  const request=el('commission-create'),main=request.querySelector('.request-main'),recent=request.querySelector('.request-recent');
  const nav=document.querySelector('.sidebar-main-nav');nav.setAttribute('aria-label','メインメニュー');
  el('topbar').insertBefore(nav,el('topbar').querySelector('.topbar-right'));
  const brand=document.querySelector('.topbar-left');brand.classList.add('workspace-brand');
  brand.querySelector('.app-title').textContent='Sikun Meeting';
  const homeBrand=document.querySelector('#sidebar .workspace-brand');homeBrand.remove();
  el('topbar').classList.remove('collapsed');
  const navIcons=['request','meeting','file','settings'];
  [...nav.querySelectorAll('.nav-main')].forEach((b,i)=>b.querySelector('svg').outerHTML=icon(navIcons[i]));
  const user=click('',()=>el('workspace-settings-btn').click(),'profile-button');user.innerHTML=icon('person');user.setAttribute('aria-label','設定を開く');
  el('topbar').querySelector('.topbar-right').append(user);

  // New drafts and existing jobs occupy separate panels; switching preserves input.
  main.querySelector('h1').textContent='依頼';
  request.prepend(main.querySelector('h1'));
  main.id='request-new-panel';recent.id='request-existing-panel';
  const selectRequestSection=tabs(request,[['request-new-tab','新規の依頼',main],['request-existing-tab','既存の依頼',recent]],'依頼の表示');
  request.prepend(request.querySelector('h1'));
  window.addEventListener('request:section',e=>selectRequestSection(e.detail==='existing'?1:0));
  el('commission-new-btn').addEventListener('click',()=>selectRequestSection(0));
  const goHome=()=>el('commission-new-btn').click();
  api.onHomeRequested(goHome);
  brand.setAttribute('role','button');brand.tabIndex=0;brand.setAttribute('aria-label','ホーム');
  brand.onclick=goHome;brand.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();goHome();}};
  const composer=main.querySelector('.request-composer');composer.querySelector(':scope > label').className='sr-only';
  const shortcuts=make('div','request-shortcuts');
  for(const [label,text,key] of [['資料をまとめる','資料の内容を整理して、会議用の資料にまとめてください。','file'],['比較する','選択肢を比較し、それぞれの特徴とおすすめをまとめてください。','chart']]){
    const b=click('',()=>{el('commission-goal').value=text;el('commission-goal').focus();});b.innerHTML=icon(key)+label;shortcuts.append(b);
  }
  composer.prepend(shortcuts);el('commission-goal').placeholder='依頼したいことを書いてください';el('commission-goal').rows=3;
  const files=make('div','reference-files');files.id='pearl-reference-files';el('commission-goal').after(files);
  window.requestReferenceFiles=[];
  function renderReferences(){files.replaceChildren();for(const file of window.requestReferenceFiles){const chip=make('span','reference-chip');chip.append(document.createTextNode(file.name),click('×',()=>{window.requestReferenceFiles=window.requestReferenceFiles.filter(f=>f!==file);renderReferences();},'chip-remove'));chip.lastChild.setAttribute('aria-label',file.name+'を外す');files.append(chip);}}
  const footer=composer.querySelector('.composer-footer'),tools=make('div','composer-tools');
  const attach=click('',async()=>{try{const selected=await api.system.chooseFiles(window.requestReferenceFiles.map(file=>file.id));window.requestReferenceFiles=selected;renderReferences();}catch(e){el('commission-create-error').textContent=e.message;el('commission-create-error').classList.remove('hidden');}});attach.id='pearl-attach';attach.innerHTML=icon('plus')+'資料';
  const details=click('',()=>{el('commission-advanced').open=!el('commission-advanced').open;});details.innerHTML=icon('chevron')+'詳細';details.setAttribute('aria-controls','commission-advanced');details.setAttribute('aria-expanded','false');
  el('commission-advanced').addEventListener('toggle',()=>details.setAttribute('aria-expanded',String(el('commission-advanced').open)));
  tools.append(attach,details);footer.prepend(tools);footer.after(el('commission-advanced'));
  const automatic=markup('label','auto-switch','<input id="pearl-auto" type="checkbox" checked role="switch"/><span class="switch-track"></span><span>自動で進める</span>');
  const oldModes=footer.querySelector('.execution-mode');oldModes.classList.add('hidden');oldModes.after(automatic);
  const syncMode=()=>{el('pearl-auto').checked=document.querySelector('input[name="execution-mode"]:checked').value==='automatic';};
  el('pearl-auto').onchange=()=>{const input=document.querySelector(`input[name="execution-mode"][value="${el('pearl-auto').checked?'automatic':'review'}"]`);input.checked=true;input.dispatchEvent(new Event('change'));};
  document.querySelectorAll('input[name="execution-mode"]').forEach(i=>i.addEventListener('change',syncMode));el('commission-create-btn').textContent='依頼する';
  const active=markup('section','pearl-surface request-active','<div class="section-line"><h2>進行中・確認待ち</h2><span id="pearl-job-count" class="count"></span></div>');active.append(el('workspace-active-jobs'));
  const completed=markup('section','pearl-surface recent-completed','<div class="section-line"><h2>完了した依頼</h2><button id="pearl-all-files" type="button" class="text-button">成果物を見る ›</button></div>');
  completed.append(el('workspace-recent-files'));recent.replaceChildren(active,completed);
  el('pearl-all-files').onclick=()=>el('workspace-files-btn').click();
  let jobs=[],libraryKey='',selectedFile=null,filter='all';
  function updateHome(items){jobs=items;el('pearl-job-count').textContent=String(items.filter(i=>i.status!=='delivered').length);renderLibrary();}

  // Artifact list and persistent preview selection.
  const library=el('workspace-library');
  const libraryHeading=markup('div','workspace-page-heading','<h1>成果物</h1><label class="library-search"><span class="sr-only">成果物を検索</span><input id="pearl-file-search" type="search" placeholder="成果物を検索"/></label>');library.querySelector('h1').remove();library.prepend(libraryHeading);
  const libraryLayout=markup('div','library-layout','<aside class="pearl-surface library-browser"><div class="library-filters" role="group" aria-label="形式で絞り込む"><button type="button" data-filter="all" aria-pressed="true">すべて</button><button type="button" data-filter="document" aria-pressed="false">資料</button><button type="button" data-filter="text" aria-pressed="false">文書</button></div><div id="pearl-file-list"></div></aside><section class="pearl-surface library-detail"><div class="library-toolbar"><h2 id="pearl-file-name">成果物</h2><button id="pearl-file-folder" type="button" class="secondary hidden">保存先を開く</button></div><div id="pearl-file-preview" class="artifact-preview"><div class="empty-work"><img src="assets/guide-bear.png" alt=""/>成果物を選ぶと、ここに表示されます。</div></div><div id="pearl-file-meta" class="field-help"></div></section>');library.append(libraryLayout);
  function allFiles(){return jobs.flatMap(job=>[...new Map((job.artifacts||[]).map(a=>[a.relativePath,a])).values()].filter(a=>a.change!=='deleted').map(artifact=>({job,artifact,key:job.id+':'+artifact.id})));}
  async function selectFile(entry){selectedFile=entry.key;renderLibrary();el('pearl-file-name').textContent=entry.artifact.relativePath;el('pearl-file-folder').classList.remove('hidden');el('pearl-file-meta').textContent=entry.job.goal;await window.renderArtifactPreview(el('pearl-file-preview'),entry.job,entry.artifact);}
  function renderLibrary(){
    const entries=allFiles(),search=el('pearl-file-search').value.toLocaleLowerCase(),list=el('pearl-file-list');
    const matching=entries.filter(e=>{const ext=e.artifact.relativePath.split('.').pop().toLowerCase();return (!search||(e.job.goal+' '+e.artifact.relativePath).toLocaleLowerCase().includes(search))&&(filter==='all'||(filter==='document'?['pdf','xlsx','pptx','png','jpg','jpeg'].includes(ext):!['pdf','xlsx','pptx','png','jpg','jpeg'].includes(ext)));});
    const key=JSON.stringify([matching.map(e=>[e.key,e.artifact.afterHash,e.job.updatedAt]),selectedFile]);if(key===libraryKey)return;libraryKey=key;list.replaceChildren();
    let lastJob='';for(const entry of matching){if(entry.job.id!==lastJob){list.append(make('h3','file-group',entry.job.goal));lastJob=entry.job.id;}const b=click('',()=>selectFile(entry),'library-file');b.dataset.fileKey=entry.key;b.setAttribute('aria-pressed',String(entry.key===selectedFile));const ext=entry.artifact.relativePath.split('.').pop().toUpperCase(),thumb=make('span','file-type '+ext.toLowerCase(),ext.slice(0,5)),copy=make('span','file-copy');copy.append(make('strong','',entry.artifact.relativePath),make('small','',`更新 ${new Date(entry.job.updatedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`));b.append(thumb,copy);list.append(b);}
    if(!matching.length)list.append(markup('div','empty-work',`<img src="assets/guide-bear.png" alt=""/><span>${entries.length?'条件に合う成果物がありません':'完成したファイルがここに並びます'}</span>`));
    if(selectedFile&&!entries.some(e=>e.key===selectedFile)){selectedFile=null;window.clearArtifactPreview(el('pearl-file-preview'));el('pearl-file-preview').append(make('p','empty-work','この成果物は削除または更新されました。'));el('pearl-file-folder').classList.add('hidden');}
  }
  el('pearl-file-search').oninput=renderLibrary;
  for(const b of library.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;for(const other of library.querySelectorAll('[data-filter]'))other.setAttribute('aria-pressed',String(other===b));renderLibrary();};
  el('pearl-file-folder').onclick=async()=>{const entry=allFiles().find(e=>e.key===selectedFile);if(entry)try{await api.commissions.openArtifact(entry.job.id,entry.artifact.id);}catch(e){el('pearl-file-meta').textContent=e.message;}};
  el('workspace-files-btn').addEventListener('click',()=>{const entry=allFiles().find(e=>e.key===selectedFile)||allFiles()[0];if(entry)void selectFile(entry);});
  window.addEventListener('pearl:items',e=>updateHome(e.detail));
  window.addEventListener('workspace:list',e=>updateHome(e.detail));
  void api.commissions.list().then(updateHome);

  // Settings are grouped; save/discard affects defaults for subsequent requests.
  const settings=el('workspace-settings'),oldSettings=settings.querySelector('.workspace-settings-grid');
  const settingsLayout=markup('div','pearl-settings-layout','<nav id="pearl-settings-nav" aria-label="設定の分類" class="pearl-surface"></nav><div class="pearl-settings-content"></div>');settings.append(settingsLayout);
  const content=settingsLayout.lastChild,panes={};
  const names=[['basic','基本','settings'],['ai','AI・モデル','spark'],['auto','自動進行','play'],['folder','保存先','folder'],['links','連携','link']];
  for(const [key,name,ico] of names){const b=click('',()=>selectSettings(key),'settings-category');b.dataset.category=key;b.innerHTML=icon(ico)+name;el('pearl-settings-nav').append(b);const pane=make('section','settings-pane hidden');pane.id='pref-pane-'+key;pane.setAttribute('aria-label',name);pane.append(make('h2','',name));panes[key]=pane;content.append(pane);}
  const navBear=make('img','settings-bear');navBear.src='assets/guide-bear.png';navBear.alt='';el('pearl-settings-nav').append(navBear);
  panes.basic.append(oldSettings.firstElementChild);panes.links.append(oldSettings.firstElementChild);oldSettings.remove();
  panes.basic.append(markup('div','pearl-surface about-box','<strong>Sikun Meeting</strong><span id="pearl-version"></span>'));el('pearl-version').textContent=`v${window.__BUILD_INFO__?.version||''}`;
  panes.ai.insertAdjacentHTML('beforeend','<section class="pearl-surface"><h3>使用するAI</h3><div class="provider-options"><label><input type="radio" name="pref-provider" value="claude"/><span class="provider-mark">C</span><strong>Claude</strong></label><label><input type="radio" name="pref-provider" value="codex"/><span class="provider-mark">◇</span><strong>Codex</strong></label></div><p class="field-help">依頼の作成時に変更できます。会議の発言にはClaudeを使用します。</p></section><div class="model-layout"><section class="pearl-surface"><h3>モデルの選び方</h3><div class="model-modes"><button type="button" id="pref-recommended">推奨構成</button><button type="button" id="pref-custom">個別に指定</button></div><div id="pref-model-summary"></div><div id="pref-custom-fields" class="request-fields-grid hidden"></div></section><section class="pearl-surface model-summary"><h3>現在の構成</h3><div class="model-pipeline"><span>計画</span><i>→</i><span>作業</span><i>→</i><span>確認</span></div><dl><dt>AI</dt><dd id="pref-summary-provider"></dd><dt>モデル</dt><dd id="pref-summary-mode"></dd></dl><img src="assets/personas/researcher.png" alt=""/></section></div><details class="pearl-surface"><summary>高度な設定</summary><div id="pref-limits" class="request-fields-grid"></div></details>');
  const fields=['commission-model-codex','commission-model-consultant','commission-model-planner','commission-model-worker','commission-model-reviewer','commission-model-critical','commission-model-fallback','commission-model-by-persona','commission-max-calls','commission-max-turns','commission-max-cycles','commission-retry-limit','commission-dir'];
  const defaults=Object.fromEntries(fields.map(id=>[id,el(id).defaultValue||'']));defaults['commission-provider']='claude';
  panes.auto.insertAdjacentHTML('beforeend','<section class="pearl-surface"><h3>依頼の進め方</h3><label class="setting-toggle"><span><strong>自動で進める</strong><small>企画から制作・確認まで、チームに任せます。</small></span><input id="pref-execution" type="checkbox" role="switch" checked/></label><label class="setting-toggle"><span><strong>失敗時に再試行する</strong><small>途中で失敗した作業の再試行と、再起動後の再開を有効にします。</small></span><input id="pref-autonomy" type="checkbox" role="switch"/></label><div id="pref-auto-fields" class="request-fields-grid"></div></section>');
  panes.folder.insertAdjacentHTML('beforeend','<section class="pearl-surface"><h3>作業するフォルダ</h3><p class="field-help">未指定の場合は、依頼ごとに専用のフォルダを作成します。</p><div class="folder-control"><input id="pref-commission-dir" readonly placeholder="依頼ごとに自動作成" aria-label="既定の作業フォルダ"/><button id="pref-choose-folder" type="button" class="secondary">選択…</button><button id="pref-clear-folder" type="button" class="text-button">自動に戻す</button></div></section>');
  for(const id of fields.filter(id=>id!=='commission-dir')){const original=el(id),label=make('label','pref-field');const title=original.closest('label')?.childNodes[0]?.textContent.trim()||id;label.textContent=title;const input=original.cloneNode(true);input.id='pref-'+id;label.append(input);if(id.includes('model-')){label.dataset.provider=id==='commission-model-codex'?'codex':'claude';el('pref-custom-fields').append(label);}else if(id==='commission-max-cycles'||id==='commission-retry-limit')el('pref-auto-fields').append(label);else el('pref-limits').append(label);}
  const saveRow=markup('div','settings-save-row','<span id="pref-feedback" role="status"></span><button id="pref-discard" type="button" class="secondary">変更を戻す</button><button id="pref-save" type="button">変更を保存</button>');content.append(saveRow);
  let saved={fields:{},flags:{},executionMode:'automatic',modelMode:'recommended'},modelMode='recommended';
  function selectSettings(key){for(const [name,pane] of Object.entries(panes))pane.classList.toggle('hidden',key!==name);for(const b of el('pearl-settings-nav').querySelectorAll('button'))b.setAttribute('aria-current',b.dataset.category===key?'page':'false');saveRow.classList.toggle('hidden',['basic','links'].includes(key));}
  function provider(){return document.querySelector('input[name="pref-provider"]:checked')?.value||'claude';}
  function refreshModels(){
    for(const label of el('pref-custom-fields').children)label.classList.toggle('hidden',label.dataset.provider!==provider());
    el('pref-custom-fields').classList.toggle('hidden',modelMode!=='custom');el('pref-model-summary').classList.toggle('hidden',modelMode==='custom');
    el('pref-recommended').setAttribute('aria-pressed',String(modelMode==='recommended'));el('pref-custom').setAttribute('aria-pressed',String(modelMode==='custom'));
    el('pref-summary-provider').textContent=provider()==='codex'?'Codex':'Claude';el('pref-summary-mode').textContent=modelMode==='custom'?'個別に指定':'推奨構成';
    const table=make('table');for(const [title,id] of [['計画','planner'],['作業','worker'],['確認','reviewer']]){const tr=make('tr');tr.append(make('th','',title),make('td','',provider()==='codex'?defaults['commission-model-codex']:defaults['commission-model-'+id]));table.append(tr);}el('pref-model-summary').replaceChildren(table);
  }
  function loadPrefs(prefs){modelMode=prefs.modelMode;for(const id of fields)el('pref-'+id).value=prefs.fields[id]??defaults[id];document.querySelector(`input[name="pref-provider"][value="${prefs.fields['commission-provider']||'claude'}"]`).checked=true;el('pref-execution').checked=prefs.executionMode==='automatic';el('pref-autonomy').checked=!!prefs.flags['commission-autonomy'];refreshModels();}
  function applyDefaults(){for(const [id,value] of Object.entries({...defaults,...saved.fields}))el(id).value=value;el('commission-autonomy').checked=!!saved.flags['commission-autonomy'];document.querySelector(`input[name="execution-mode"][value="${saved.executionMode}"]`).checked=true;el('commission-provider').dispatchEvent(new Event('change'));el('commission-autonomy').dispatchEvent(new Event('change'));syncMode();}
  el('pref-recommended').onclick=()=>{modelMode='recommended';refreshModels();};el('pref-custom').onclick=()=>{modelMode='custom';refreshModels();};document.querySelectorAll('input[name="pref-provider"]').forEach(r=>r.onchange=refreshModels);
  el('pref-choose-folder').onclick=async()=>{const dir=await api.system.chooseDirectory();if(dir)el('pref-commission-dir').value=dir;};el('pref-clear-folder').onclick=()=>el('pref-commission-dir').value='';
  el('pref-discard').onclick=()=>{loadPrefs(saved);el('pref-feedback').textContent='保存済みの設定に戻しました。';};
  el('pref-save').onclick=async()=>{el('pref-save').disabled=true;try{const values=Object.fromEntries(fields.map(id=>[id,modelMode==='recommended'&&id.includes('model-')?defaults[id]:el('pref-'+id).value]));values['commission-provider']=provider();saved=await api.system.savePreferences({fields:values,flags:{'commission-autonomy':el('pref-autonomy').checked},executionMode:el('pref-execution').checked?'automatic':'review',modelMode});loadPrefs(saved);if(!el('commission-goal').value.trim())applyDefaults();el('pref-feedback').textContent='保存しました。次の依頼に適用します。';}catch(e){el('pref-feedback').textContent=e.message;}finally{el('pref-save').disabled=false;}};
  selectSettings('ai');
  void api.system.getPreferences().then(p=>{saved=p;loadPrefs(p);if(!el('commission-goal').value.trim())applyDefaults();}).catch(e=>el('pref-feedback').textContent=e.message);
  window.addEventListener('request:reset',applyDefaults);window.addEventListener('request:submitted',()=>{window.requestReferenceFiles=[];renderReferences();});

  const skillSection=markup('details','pearl-surface specialist-skills','<summary>専門家のスキル</summary><label class="sr-only" for="specialist-skill-search">専門家を検索</label><input id="specialist-skill-search" type="search" placeholder="名前・専門分野で検索"/><p id="specialist-skill-count" class="field-help" role="status"></p><div id="specialist-skill-list"></div>');
  panes.ai.append(skillSection);
  const phaseLabels={meeting:'会議',consultation:'企画相談',planning:'計画',work:'作業',review:'確認',goal_check:'目標確認',kgi_check:'KGI確認',delivery:'納品'};
  let skillMembers=[];
  function filterSkills(){const query=el('specialist-skill-search').value.trim().toLocaleLowerCase();let count=0;for(const row of el('specialist-skill-list').children){row.hidden=query&&!row.dataset.search.includes(query);if(!row.hidden)count++;}el('specialist-skill-count').textContent=count+' / '+skillMembers.length+'体';}
  el('specialist-skill-search').oninput=filterSkills;
  void api.personas.skills().then(members=>{
    skillMembers=members;
    for(const member of members){const row=make('details','specialist-skill');row.dataset.personaId=member.id;row.dataset.search=(member.name+' '+member.roleTitle+' '+member.expertise).toLocaleLowerCase();
      const heading=make('summary'),img=make('img');img.src='assets/personas/'+member.avatar;img.alt='';const copy=make('span');copy.append(make('strong','',member.name),make('small','',member.roleTitle));heading.append(img,copy);row.append(heading);
      for(const skill of member.skills){
        row.append(make('p','field-help',skill.phases.map(p=>phaseLabels[p]).join(' / ')));
        const body=make('div','markdown-body');
        body.innerHTML=window.renderMarkdownSafe(skill.instructions.replace(/\[([^\]]+)\]\((?:references|scripts)\/[^)]+\)/g,'$1（同梱資料）'));
        row.append(body);
        for(const resource of skill.resources||[]){
          const details=make('details','skill-resource');details.append(make('summary','',resource.name));
          if(resource.name.endsWith('.md')){const content=make('div','markdown-body');content.innerHTML=window.renderMarkdownSafe(resource.content);details.append(content);}
          else details.append(make('pre','',resource.content));
          row.append(details);
        }
        row.append(make('small','skill-version',skill.id+' v'+skill.version));
      }
      el('specialist-skill-list').append(row);
    }filterSkills();
  }).catch(e=>el('specialist-skill-count').textContent='スキルを取得できません: '+e.message);

  // Approved round-table layout. Keep the original controls and their handlers.
  const meeting=el('meeting-view');
  const meetingHeader=markup('div','pearl-meeting-heading','<button id="pearl-meeting-back" type="button" class="text-button">‹ 会議一覧</button><div class="meeting-title-row"><h1 id="pearl-meeting-title"></h1><span id="pearl-meeting-status" class="status-badge"></span><button id="pearl-meeting-run" type="button">自動で進める</button></div><ol id="pearl-meeting-stages" class="workspace-stage-track"><li>論点整理</li><li>比較・検討</li><li>結論</li></ol><p id="pearl-meeting-error" class="field-help" role="status"></p>');meeting.prepend(meetingHeader);
  const grid=make('div','pearl-meeting-grid'),board=make('section','pearl-surface meeting-board');meeting.append(grid);grid.append(board,el('discussion-panel'));board.append(el('meeting-room'));
  el('meeting-whiteboard-title').textContent='検討資料';
  el('meeting-board-progress').closest('.meeting-board-row').classList.add('hidden');
  const members=make('h3','member-heading','会議メンバー');el('circle-wrap').prepend(members);
  el('meeting-room').prepend(el('circle-wrap'));
  const tableState=make('span','table-state','開始前');tableState.id='pearl-table-state';el('meeting-table').append(tableState);
  const roster=el('sidebar-roster');el('circle-wrap').append(roster);roster.querySelector('summary').textContent='参加者を調整';
  const code=make('details','meeting-detail-tools');code.append(make('summary','','資料・コードの参照先'),el('mv-codebase'),el('analyze-code-btn'));
  const agenda=el('meeting-board-agenda').closest('.meeting-board-row'),summary=el('meeting-board-decision').closest('.meeting-board-row');
  agenda.append(code);el('meeting-whiteboard-title').classList.add('sr-only');
  function tabs(parent, entries, label){
    const bar=make('div','detail-tabs');bar.setAttribute('role','tablist');bar.setAttribute('aria-label',label);
    const buttons=entries.map(([id,title,panel],i)=>{
      panel.id ||= id+'-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',id);
      const b=click(title,()=>select(i));b.id=id;b.setAttribute('role','tab');b.setAttribute('aria-controls',panel.id);
      b.onkeydown=e=>{const j=e.key==='ArrowRight'?(i+1)%entries.length:e.key==='ArrowLeft'?(i+entries.length-1)%entries.length:e.key==='Home'?0:e.key==='End'?entries.length-1:null;if(j!==null){e.preventDefault();select(j);buttons[j].focus();}};
      bar.append(b);return b;
    });
    function select(index){entries.forEach((entry,i)=>{entry[2].classList.toggle('hidden',i!==index);buttons[i].setAttribute('aria-selected',String(i===index));buttons[i].tabIndex=i===index?0:-1;});}
    parent.prepend(bar);select(0);return select;
  }
  const selectMaterial=tabs(el('meeting-whiteboard'),[['meeting-material-tab','検討資料',agenda],['meeting-summary-tab','現時点の整理',summary]],'会議の資料');
  el('discussion-panel-header').querySelector('h2').textContent='話し合い';el('discussion-expand-btn').textContent='広く表示';
  const controls=el('composer'),expert=make('details','meeting-detail-tools'),roundActions=make('div','meeting-round-actions');
  expert.id='pearl-meeting-tools';roundActions.append(el('ask-all-btn'),el('rebuttal-btn'));
  expert.append(make('summary','','AIに個別に質問する'),el('ask-specific-select').closest('.composer-row'),roundActions);controls.prepend(make('label','','必要なときだけ参加'));controls.append(expert);
  el('ask-specific-select').setAttribute('aria-label','質問するAI');el('ask-specific-question').setAttribute('aria-label','AIへの質問');
  el('ask-specific-select').before(el('ask-specific-question'));
  el('human-speak-input').placeholder='意見・追加の指示';el('human-speak-btn').textContent='送信';
  const conversation=make('div','meeting-conversation');conversation.id='meeting-conversation';
  conversation.append(el('transcript-list'),el('transcript-empty'),el('thinking-banner'),el('composer'));
  const record=make('div','meeting-record');record.id='meeting-record';
  const decisionDetails=make('details','manual-decision');decisionDetails.append(make('summary','','結論を記録する・議事録を見る'),el('mv-decision'));record.append(decisionDetails);
  const recordHelp=make('p','field-help','AIの検討結果は「現時点の整理」で確認できます。必要なときに結論を記録できます。');record.prepend(recordHelp);
  el('discussion-panel').append(conversation,record);el('discussion-panel-header').querySelector('h2').classList.add('sr-only');
  const selectDiscussion=tabs(el('discussion-panel-header'),[['meeting-talk-tab','話し合い',conversation],['meeting-record-tab','記録',record]],'会議の表示');
  el('df-submit').textContent='この結論を記録';
  const autoLabel=markup('label','meeting-auto-setting','<input id="pearl-meeting-auto" type="checkbox" checked/> 作成後、自動で話し合いを進める');el('nm-submit').parentElement.before(autoLabel);
  el('pearl-meeting-back').onclick=()=>el('workspace-meetings-btn').click();
  let meetingCurrent=null,autoBusy=false;
  window.addEventListener('meeting:render',event=>{
    if(meetingCurrent?.id!==event.detail.id){selectMaterial(0);selectDiscussion(0);}
    meetingCurrent=event.detail;const m=meetingCurrent,a=m.automation;
    el('pearl-meeting-title').textContent=m.title;
    el('pearl-meeting-status').textContent=a?.status==='running'?'自動進行中':a?.status==='pausing'?'発言後に一時停止':a?.status==='paused'?'一時停止':a?.status==='failed'?'要確認':a?.status==='completed'?'検討完了':m.status==='CONCLUDED'?'終了':m.status==='CREATED'?'開始前':'進行中';
    el('pearl-meeting-status').dataset.state=a?.status||m.status;
    tableState.textContent=a?.status==='running'?(a.phase==='summary'?'結論を整理中':m.initialRound?.status==='published'?'比較・検討中':'論点を整理中'):el('pearl-meeting-status').textContent;
    const b=el('pearl-meeting-run');b.textContent=a?.status==='running'?'一時停止':a?.status==='pausing'?'停止中…':a?.status==='paused'?'自動進行を再開':'自動で進める';b.disabled=autoBusy||a?.status==='pausing'||a?.status==='completed'||m.status==='CONCLUDED';
    el('pearl-meeting-error').textContent=a?.error||'';
    const stage=a?.status==='completed'||m.status==='CONCLUDED'?3:a?.phase==='summary'?2:m.initialRound?.status==='published'?1:0;
    [...el('pearl-meeting-stages').children].forEach((li,i)=>{li.className=i<stage?'done':i===stage?'current':'';if(i===stage)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
    if(a?.summary&&!m.decision)el('meeting-board-decision').innerHTML=window.renderMarkdownSafe(a.summary);
    el('meeting-board-decision').closest('.meeting-board-row').querySelector('span').textContent=m.decision?'結論':a?.summary?'検討結果':'最新の意見';
    if(!m.decision&&!a?.summary){const last=m.transcript.findLast(msg=>msg.speakerType==='AI');el('meeting-board-decision').innerHTML=window.renderMarkdownSafe(last?last.content.slice(0,1300):'話し合いが進むと、ここに最新の検討内容が表示されます。');}
    const running=['running','pausing'].includes(a?.status);for(const id of ['ask-all-btn','ask-specific-btn','rebuttal-btn','analyze-code-btn','invite-btn','df-submit'])el(id).disabled=running||m.status==='CONCLUDED';
    el('human-speak-btn').disabled=running||m.status==='CONCLUDED';el('human-speak-input').title=running?'一時停止してから追加の意見を送れます。':'';
  });
  el('pearl-meeting-run').onclick=async()=>{if(!meetingCurrent||autoBusy)return;autoBusy=true;el('pearl-meeting-run').disabled=true;try{if(meetingCurrent.automation?.status==='running')await api.meetings.pauseAuto(meetingCurrent.id);else await api.meetings.startAuto(meetingCurrent.id);window.dispatchEvent(new Event('meeting:reload'));}catch(e){el('pearl-meeting-error').textContent=e.message;}finally{autoBusy=false;}};
})();

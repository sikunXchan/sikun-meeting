// @ts-nocheck
// プロジェクトに常設されるAIコミュニティ画面。
(() => {
  const api = window.api;
  const el = (id) => document.getElementById(id);
  let projectId = null;
  let selectedId = null;
  let selectedPost = null;
  let busy = false;
  let refreshPending = false;
  let personas = [];

  function personaName(id) {
    const persona = personas.find((entry) => entry.id === id);
    return persona ? persona.emoji + ' ' + persona.name : id;
  }

  function error(message) {
    const box = el('community-error');
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['community-create-btn', 'community-suggest-btn', 'community-comment-btn', 'community-run-btn',
      'community-commission-btn', 'community-open-commission-btn', 'community-accept-btn']) {
      el(id).disabled = value;
    }
  }

  function show() {
    for (const id of ['empty-state', 'new-meeting-form', 'meeting-view', 'project-view',
      'commission-create', 'commission-view', 'community-view', 'mobile-view']) {
      el(id).classList.add('hidden');
    }
    document.body.classList.remove('commission-active', 'project-active');
    document.body.classList.add('community-active');
    el('community-view').classList.remove('hidden');
  }

  function postStatus(post, commission) {
    if (post.acceptedAt) return '知識として採用';
    if (!post.commissionId) return '議論中';
    if (!commission) return '委託案件あり';
    const labels = {
      consulting: '企画相談中', running: '作業中', paused: '一時停止', stopped: '停止',
      interrupted: '中断', delivered: '納品済み', failed: '要確認',
    };
    return labels[commission.status] || commission.status;
  }

  function card(post, isMemory) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'community-card' + (post.id === selectedId ? ' active' : '');
    const title = document.createElement('strong');
    title.textContent = post.title;
    const meta = document.createElement('small');
    meta.textContent = isMemory ? (post.acceptanceNote || '').slice(0, 90)
      : (post.createdBy === 'ai' ? personaName(post.creatorPersonaId) + 'の提案 · ' : '')
        + postStatus(post) + ' · ' + post.messages.length + '件の発言';
    button.append(title, meta);
    button.addEventListener('click', () => { void openPost(post.id); });
    return button;
  }

  async function refreshList() {
    if (!projectId) return;
    const posts = await api.community.list(projectId);
    const list = el('community-post-list');
    const memory = el('community-memory-list');
    list.replaceChildren();
    memory.replaceChildren();
    if (!posts.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'まだ課題がありません。';
      list.appendChild(empty);
    }
    for (const post of posts) list.appendChild(card(post, false));
    const accepted = posts.filter((post) => post.acceptedAt);
    if (!accepted.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = '採用された知識はまだありません。';
      memory.appendChild(empty);
    }
    for (const post of accepted) memory.appendChild(card(post, true));
  }

  function renderMessages(post) {
    const list = el('community-messages');
    list.replaceChildren();
    if (!post.messages.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'まだ発言はありません。';
      list.appendChild(empty);
      return;
    }
    for (const message of post.messages) {
      const row = document.createElement('div');
      row.className = 'community-message ' + message.author;
      const author = document.createElement('strong');
      const label = message.author === 'human' ? 'あなた' : personaName(message.authorId);
      author.textContent = label + ' · ' + new Date(message.createdAt).toLocaleString('ja-JP');
      const body = document.createElement('div');
      body.className = 'markdown-body';
      body.innerHTML = window.renderMarkdownSafe(message.content);
      row.append(author, body);
      list.appendChild(row);
    }
  }

  function renderWork(commission) {
    el('community-linked-work').classList.toggle('hidden', !commission);
    if (!commission) return;
    const list = el('community-work-list');
    list.replaceChildren();
    for (const work of commission.workItems) {
      const row = document.createElement('div');
      row.textContent = work.title + ' · ' + work.status + ' · 担当 ' + personaName(work.ownerPersonaId)
        + ' / 確認 ' + personaName(work.reviewerPersonaId);
      list.appendChild(row);
    }
    if (!commission.workItems.length) {
      const row = document.createElement('div');
      row.className = 'muted';
      row.textContent = '企画確定後に仕事が表示されます。';
      list.appendChild(row);
    }
    el('community-delivery').innerHTML = window.renderMarkdownSafe(commission.delivery || '納品後に表示されます。');
  }

  function renderPost(post, commission) {
    selectedPost = post;
    el('community-thread-empty').classList.add('hidden');
    el('community-thread-content').classList.remove('hidden');
    el('community-post-title').textContent = post.title;
    el('community-post-status').textContent = postStatus(post, commission);
    el('community-post-body').innerHTML = window.renderMarkdownSafe(post.body);
    el('community-post-roster').textContent = (post.createdBy === 'ai' ? '投稿: ' + personaName(post.creatorPersonaId) + ' · ' : '')
      + '参加AI: ' + post.personaIds.map(personaName).join('、')
      + (post.workingDirectory ? ' · 参照先: ' + post.workingDirectory : '');
    el('community-commission-btn').classList.toggle('hidden', !!post.commissionId);
    el('community-open-commission-btn').classList.toggle('hidden', !post.commissionId);
    el('community-accepted-note').innerHTML = post.acceptedAt
      ? window.renderMarkdownSafe('採用済み: ' + (post.acceptanceNote || '')) : '';
    const input = el('community-accept-note');
    if (document.activeElement !== input) input.value = post.acceptanceNote || '';
    renderMessages(post);
    renderWork(commission);
  }

  async function openPost(id) {
    selectedId = id;
    error('');
    const post = await api.community.get(id);
    const commission = post.commissionId
      ? (await api.commissions.get(post.commissionId)).commission : null;
    if (selectedId !== id || projectId !== post.projectId) return;
    renderPost(post, commission);
    await refreshList();
  }

  async function refreshSelected() {
    if (!selectedId || refreshPending || el('community-view').classList.contains('hidden')) return;
    refreshPending = true;
    try {
      const id = selectedId;
      const post = await api.community.get(id);
      const commission = post.commissionId
        ? (await api.commissions.get(post.commissionId)).commission : null;
      if (selectedId === id && projectId === post.projectId) renderPost(post, commission);
      await refreshList();
    } catch (failure) {
      error(failure.message || String(failure));
    } finally {
      refreshPending = false;
    }
  }

  async function openCommunity() {
    const nextProjectId = el('project-select').value;
    if (!nextProjectId) return;
    const changed = projectId !== nextProjectId;
    projectId = nextProjectId;
    if (changed) { selectedId = null; selectedPost = null; }
    show();
    const project = await api.projects.get(projectId);
    el('community-project-name').textContent = project.name + ' のAIコミュニティ';
    el('tb-title').textContent = project.name + ' のAIコミュニティ';
    el('tb-agenda').textContent = '課題・議論・委託・採用知識';
    await refreshList();
    if (selectedId) await openPost(selectedId);
    else {
      el('community-thread-empty').classList.remove('hidden');
      el('community-thread-content').classList.add('hidden');
    }
  }

  async function action(operation) {
    if (busy) return;
    setBusy(true);
    error('');
    try { await operation(); }
    catch (failure) { error(failure.message || String(failure)); }
    finally { setBusy(false); await refreshSelected(); }
  }

  async function loadPersonas() {
    personas = await api.personas.list();
    const grid = el('community-personas');
    grid.replaceChildren();
    for (const persona of personas) {
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.value = persona.id;
      check.checked = ['product', 'architect', 'critic', 'qa'].includes(persona.id);
      label.append(check, document.createTextNode(persona.emoji + ' ' + persona.name));
      grid.appendChild(label);
    }
  }

  el('community-open-btn').addEventListener('click', () => { void openCommunity(); });
  el('project-select').addEventListener('change', () => {
    if (!el('community-view').classList.contains('hidden')) void openCommunity();
  });
  el('community-choose-dir').addEventListener('click', async () => {
    const directory = await api.system.chooseDirectory();
    if (directory) el('community-dir').value = directory;
  });
  el('community-create-btn').addEventListener('click', () => action(async () => {
    const personaIds = [...document.querySelectorAll('#community-personas input:checked')]
      .map((checkbox) => checkbox.value);
    const post = await api.community.create({
      projectId, title: el('community-title').value, body: el('community-body').value,
      workingDirectory: el('community-dir').value || null, personaIds,
    });
    el('community-title').value = '';
    el('community-body').value = '';
    el('community-dir').value = '';
    for (const check of document.querySelectorAll('#community-personas input')) {
      check.checked = ['product', 'architect', 'critic', 'qa'].includes(check.value);
    }
    el('community-advanced').open = false;
    el('community-new-details').open = false;
    await openPost(post.id);
  }));
  el('community-suggest-btn').addEventListener('click', () => action(async () => {
    if (!projectId) return;
    const post = await api.community.suggest(projectId);
    await openPost(post.id);
  }));
  el('community-comment-btn').addEventListener('click', () => action(async () => {
    if (!selectedId) return;
    await api.community.comment(selectedId, el('community-comment').value);
    el('community-comment').value = '';
  }));
  el('community-run-btn').addEventListener('click', () => action(async () => {
    if (!selectedId) return;
    el('community-progress').textContent = 'AIの議論を開始しています…';
    try { await api.community.runRound(selectedId); }
    finally { el('community-progress').textContent = ''; }
  }));
  el('community-commission-btn').addEventListener('click', () => action(async () => {
    if (!selectedId) return;
    const commission = await api.community.startCommission(selectedId);
    window.dispatchEvent(new CustomEvent('commission:open', { detail: commission.id }));
  }));
  el('community-open-commission-btn').addEventListener('click', () => {
    if (selectedPost?.commissionId) {
      window.dispatchEvent(new CustomEvent('commission:open', { detail: selectedPost.commissionId }));
    }
  });
  el('community-accept-btn').addEventListener('click', () => action(async () => {
    if (!selectedId) return;
    await api.community.accept(selectedId, el('community-accept-note').value);
  }));
  api.community.onProgress((event) => {
    if (event.postId !== selectedId) return;
    if (event.type === 'turn-start') el('community-progress').textContent = personaName(event.personaId) + 'が考えています…';
    if (event.type === 'turn-end') {
      el('community-progress').textContent = personaName(event.personaId) + 'が発言しました。';
      void refreshSelected();
    }
    if (event.type === 'turn-error') el('community-progress').textContent = personaName(event.personaId) + ': ' + event.error;
  });
  api.commissions.onProgress((id) => {
    if (selectedPost?.commissionId === id) void refreshSelected();
  });
  setInterval(() => { void refreshSelected(); }, 5000);
  void loadPersonas();
})();

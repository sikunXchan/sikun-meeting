// @ts-nocheck
// 委託案件の画面。データと実行状態はすべて main プロセスに保持する。
(() => {
  const api = window.api;
  const el = (id) => document.getElementById(id);
  let selectedId = null;
  let planEdited = false;
  let busy = false;
  let refreshPending = false;

  const statusLabels = {
    consulting: '企画相談中', running: 'AIチームが作業中', paused: '一時停止', stopped: '停止',
    interrupted: '中断', delivered: '納品済み', failed: '要確認',
  };
  const workLabels = {
    queued: '待機', running: '作業中', review_pending: '内部確認中',
    accepted: '確認済み', failed: '失敗', interrupted: '中断',
  };

  function show(id) {
    for (const panel of ['empty-state', 'new-meeting-form', 'meeting-view', 'project-view', 'commission-create', 'commission-view', 'community-view']) {
      el(panel).classList.add('hidden');
    }
    document.body.classList.remove('community-active');
    document.body.classList.toggle('commission-active', id.startsWith('commission-'));
    if (id.startsWith('commission-')) {
      el('tb-title').textContent = 'AIチームへの委託';
      el('tb-agenda').textContent = '';
    }
    el(id).classList.remove('hidden');
  }

  function setBusy(value) {
    busy = value;
    for (const id of ['commission-create-btn', 'commission-send-btn', 'commission-confirm-btn', 'commission-pause-btn', 'commission-stop-btn', 'commission-resume-btn', 'commission-revise-btn']) {
      el(id).disabled = value;
    }
  }

  function showError(message) {
    for (const id of ['commission-error', 'commission-create-error']) {
      const error = el(id);
      error.textContent = message || '';
      error.classList.toggle('hidden', !message);
    }
  }

  function selectedProjectId() {
    return el('project-select').value;
  }

  async function ensureProject() {
    if (selectedProjectId()) return selectedProjectId();
    const existing = await api.projects.list();
    const project = existing[0] || await api.projects.create('AI委託', 'AIチームへ委託する案件');
    const select = el('project-select');
    if (![...select.options].some((option) => option.value === project.id)) {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    }
    select.value = project.id;
    select.dispatchEvent(new Event('change'));
    return project.id;
  }

  function parsePersonaModels(raw) {
    const result = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const separator = line.indexOf('=');
      if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error('役割別モデルは personaId=model の形式で指定してください');
      result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return result;
  }

  async function refreshList() {
    const list = el('commission-list');
    const commissions = await api.commissions.list();
    list.replaceChildren();
    for (const item of commissions) {
      const li = document.createElement('li');
      li.className = item.id === selectedId ? 'active' : '';
      const title = document.createElement('span');
      title.textContent = item.goal.length > 36 ? `${item.goal.slice(0, 36)}…` : item.goal;
      const status = document.createElement('small');
      status.textContent = statusLabels[item.status] || item.status;
      li.append(title, status);
      li.addEventListener('click', () => { void openCommission(item.id); });
      list.appendChild(li);
    }
  }

  function addTextRow(parent, className, title, body) {
    const row = document.createElement('div');
    row.className = className;
    if (title) {
      const strong = document.createElement('strong');
      strong.textContent = title;
      row.appendChild(strong);
    }
    const content = document.createElement('div');
    content.textContent = body;
    row.appendChild(content);
    parent.appendChild(row);
  }

  function render(snapshot) {
    const { commission: item, events } = snapshot;
    if (item.id !== selectedId) return;
    el('commission-title').textContent = item.goal;
    el('commission-subtitle').textContent = `${item.settings?.provider === 'codex' ? 'Codex' : 'Claude'} · 作業場所: ${item.workingDirectory}`;
    el('commission-status').textContent = statusLabels[item.status] || item.status;
    el('commission-status').className = `status-badge commission-status-${item.status}`;
    if (item.error) showError(item.error);
    const consulting = item.status === 'consulting';
    el('commission-consult-section').classList.toggle('hidden', !consulting);
    el('commission-progress-section').classList.toggle('hidden', consulting);
    el('commission-pause-btn').classList.toggle('hidden', item.status !== 'running');
    el('commission-stop-btn').classList.toggle('hidden', item.status !== 'running');
    el('commission-resume-btn').classList.toggle('hidden', !['paused', 'stopped', 'interrupted', 'failed'].includes(item.status));
    el('commission-revision-section').classList.toggle('hidden', item.status !== 'delivered');
    el('commission-confirm-btn').disabled = busy || !item.consultation.some((entry) => entry.speaker === 'it_consultant');
    if (!planEdited) el('commission-plan').value = item.planText || '';

    const chat = el('commission-chat');
    chat.replaceChildren();
    for (const message of item.consultation) {
      addTextRow(chat, `commission-message ${message.speaker}`, message.speaker === 'human' ? 'あなた' : 'ITコンサルタントAI', message.content);
    }
    const workList = el('commission-work-list');
    workList.replaceChildren();
    for (const work of item.workItems) {
      addTextRow(workList, 'commission-work', `${work.title} · ${workLabels[work.status] || work.status}`, `担当 ${work.ownerPersonaId} / 所管 ${work.domainPersonaId || work.ownerPersonaId} / 確認 ${work.reviewerPersonaId}${work.review ? `\n確認: ${work.review}` : ''}`);
    }
    const artifacts = el('commission-artifacts');
    artifacts.replaceChildren();
    for (const artifact of item.artifacts || []) {
      const row = document.createElement('div');
      row.className = 'commission-work';
      const label = document.createElement('strong');
      label.textContent = `${artifact.status === 'accepted' ? '採用済み' : '提案中'} · ${artifact.change}`;
      row.appendChild(label);
      if (artifact.change === 'deleted') {
        const pathLabel = document.createElement('span');
        pathLabel.textContent = artifact.relativePath;
        row.appendChild(pathLabel);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary small-btn';
        button.textContent = `📂 ${artifact.relativePath}`;
        button.addEventListener('click', () => action(() => api.commissions.openArtifact(item.id, artifact.id)));
        row.appendChild(button);
      }
      artifacts.appendChild(row);
    }
    for (const decision of item.reviewDecisions || []) {
      addTextRow(artifacts, 'commission-event', `${decision.approved ? '内部確認を通過' : '差戻し'} · ${decision.reviewerPersonaId}`, decision.note);
    }
    const goalChecks = el('commission-goal-checks');
    goalChecks.replaceChildren();
    if (!item.successCriteria) addTextRow(goalChecks, 'commission-event', '旧案件', '発注者の完了条件が未設定のため、目標の独立確認は行いません。');
    else if (!(item.goalChecks || []).length) addTextRow(goalChecks, 'commission-event', '確認待ち', item.successCriteria);
    for (const check of item.goalChecks || []) {
      addTextRow(goalChecks, 'commission-event', check.complete ? '達成と判定' : '未達・追加作業',
        `根拠: ${check.evidence.join('、') || 'なし'}\n残り: ${check.remaining.join('、') || 'なし'}`);
    }
    const runs = el('commission-runs');
    runs.replaceChildren();
    for (const run of item.runs.slice().reverse()) {
      addTextRow(runs, 'commission-event', `${run.provider === 'codex' ? 'Codex' : 'Claude'} · ${run.personaId} · ${run.phase} · ${run.status}`, `要求モデル ${run.requestedModel} / 応答モデル ${run.effectiveModel || '未確認'} / 使用モデル ${run.observedModels.join(', ') || '未確認'} / ${run.numTurns}ターン`);
    }
    const eventList = el('commission-events');
    eventList.replaceChildren();
    for (const event of events.slice(-80).reverse()) {
      addTextRow(eventList, `commission-event ${event.kind}`, new Date(event.at).toLocaleString('ja-JP'), event.detail);
    }
    el('commission-delivery').textContent = item.delivery || (item.status === 'delivered' ? '納品レポートがありません' : '作業完了後に表示されます。');
  }

  async function refresh() {
    if (!selectedId || refreshPending) return;
    refreshPending = true;
    try {
      const [snapshot] = await Promise.all([api.commissions.get(selectedId), refreshList()]);
      render(snapshot);
    } catch (error) {
      showError(error.message || String(error));
    } finally {
      refreshPending = false;
    }
  }

  async function openCommission(id) {
    selectedId = id;
    planEdited = false;
    showError('');
    show('commission-view');
    await refresh();
  }

  async function action(fn) {
    if (busy) return;
    setBusy(true);
    showError('');
    try { await fn(); }
    catch (error) { showError(error.message || String(error)); }
    finally { setBusy(false); await refresh(); }
  }

  el('commission-new-btn').addEventListener('click', async () => {
    selectedId = null;
    el('commission-goal').value = '';
    el('commission-criteria').value = '';
    el('commission-dir').value = '';
    const select = el('commission-card');
    select.replaceChildren(new Option('指定しない', ''));
    const projectId = el('project-select').value;
    if (projectId) {
      const project = await api.projects.get(projectId);
      for (const card of project.artifactCards || []) select.add(new Option(card.name, card.id));
    }
    show('commission-create');
    void refreshList();
  });
  el('commission-create-cancel').addEventListener('click', () => {
    show('empty-state');
  });
  el('commission-choose-dir').addEventListener('click', async () => {
    const directory = await api.system.chooseDirectory();
    if (directory) el('commission-dir').value = directory;
  });
  function updateProviderFields() {
    const codex = el('commission-provider').value === 'codex';
    for (const field of document.querySelectorAll('#commission-create .claude-only')) field.classList.toggle('hidden', codex);
    for (const field of document.querySelectorAll('#commission-create .codex-only')) field.classList.toggle('hidden', !codex);
  }
  el('commission-provider').addEventListener('change', updateProviderFields);
  updateProviderFields();
  el('commission-create-btn').addEventListener('click', () => action(async () => {
    const goal = el('commission-goal').value.trim();
    if (!goal) throw new Error('目標を入力してください');
    const successCriteria = el('commission-criteria').value.trim();
    if (!successCriteria) throw new Error('完成と判断する条件を入力してください');
    const projectId = await ensureProject();
    const settings = {
      provider: el('commission-provider').value,
      codexModel: el('commission-model-codex').value.trim(),
      consultantModel: el('commission-model-consultant').value.trim(),
      plannerModel: el('commission-model-planner').value.trim(),
      workerModel: el('commission-model-worker').value.trim(),
      reviewerModel: el('commission-model-reviewer').value.trim(),
      criticalModel: el('commission-model-critical').value.trim(),
      fallbackModel: el('commission-model-fallback').value.trim(),
      maxCalls: Number(el('commission-max-calls').value),
      maxTurnsPerCall: Number(el('commission-max-turns').value),
      modelByPersona: el('commission-provider').value === 'claude' ? parsePersonaModels(el('commission-model-by-persona').value) : {},
    };
    const item = await api.commissions.create({ projectId, goal,
      successCriteria,
      artifactCardId: el('commission-card').value || undefined,
      workingDirectory: el('commission-dir').value || undefined, settings });
    await openCommission(item.id);
    await api.commissions.consult(item.id, goal);
  }));
  el('commission-plan').addEventListener('input', () => { planEdited = true; });
  el('commission-send-btn').addEventListener('click', () => action(async () => {
    const message = el('commission-message').value.trim();
    if (!message) throw new Error('相談内容を入力してください');
    await api.commissions.consult(selectedId, message);
    el('commission-message').value = '';
    planEdited = false;
  }));
  el('commission-confirm-btn').addEventListener('click', () => action(async () => {
    await api.commissions.confirm(selectedId, el('commission-plan').value);
  }));
  el('commission-pause-btn').addEventListener('click', () => action(() => api.commissions.pause(selectedId)));
  el('commission-stop-btn').addEventListener('click', () => action(() => api.commissions.stop(selectedId)));
  el('commission-resume-btn').addEventListener('click', () => action(() => api.commissions.resume(selectedId)));
  el('commission-revise-btn').addEventListener('click', () => action(async () => {
    const text = el('commission-revision').value.trim();
    if (!text) throw new Error('修正内容を入力してください');
    await api.commissions.revise(selectedId, text);
    el('commission-revision').value = '';
  }));
  api.commissions.onProgress((id) => { if (id === selectedId) void refresh(); else void refreshList(); });
  window.addEventListener('commission:open', (event) => {
    void (async () => {
      const id = event.detail;
      await openCommission(id);
      const { commission } = await api.commissions.get(id);
      if (commission.status === 'consulting' && commission.consultation.length === 0) {
        await action(() => api.commissions.consult(id, commission.goal));
      }
    })();
  });
  setInterval(() => { void refresh(); }, 5000);
  void refreshList();
})();

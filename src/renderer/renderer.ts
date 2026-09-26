// @ts-nocheck
// レンダラー側のUIロジック。
// window.api は preload.ts が contextBridge 経由で公開する。
//
// 全体をIIFEで包んでいるのは、contextBridge.exposeInMainWorld が
// window.api をconfigurable:falseなプロパティとして定義するため、
// トップレベルで `const api = window.api` と宣言すると
// 「Identifier 'api' has already been declared」になってしまうため
// （グローバルの let/const 宣言は同名の非configurableなグローバルプロパティと衝突する）。
// 関数スコープ内のローカル変数にすれば衝突しない。
(function () {
const api = window.api;

let personas = [];
let meetingTypes = [];
let meetings = [];
let projects = [];
let currentMeeting = null;
let currentProjectId = null;
let projectViewProjectId = null;
let editingCardId = null;
function addGoalRow(goal = {}) {
  const list = document.getElementById('pv-card-goal-list');
  const row = document.createElement('div');
  row.className = 'goal-row';
  if (goal.id) row.dataset.goalId = goal.id;
  const fields = [
    ['label', '指標', 'text', '例：初回利用完了率'],
    ['target', '目標値', 'number', '例：80'],
    ['current', '現在値（任意）', 'number', '未測定なら空欄'],
    ['unit', '単位', 'text', '例：%'],
    ['evidence', '測定根拠（任意）', 'text', '例：9月の利用記録'],
  ];
  for (const [key, title, type, placeholder] of fields) {
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.className = `goal-${key}`;
    input.type = type;
    if (type === 'number') input.step = 'any';
    input.placeholder = placeholder;
    input.value = goal[key] ?? '';
    label.appendChild(input);
    row.appendChild(label);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'secondary goal-remove';
  remove.textContent = 'この目標を削除';
  remove.addEventListener('click', () => row.remove());
  row.appendChild(remove);
  list.appendChild(row);
  return row;
}

function readGoalRows() {
  return [...document.querySelectorAll('#pv-card-goal-list .goal-row')].map((row, index) => {
    const field = (name) => row.querySelector(`.goal-${name}`).value.trim();
    const label = field('label');
    const targetText = field('target');
    const currentText = field('current');
    if (!label || targetText === '' || !Number.isFinite(Number(targetText))
      || (currentText !== '' && !Number.isFinite(Number(currentText)))) {
      row.querySelector(!label ? '.goal-label' : targetText === '' || !Number.isFinite(Number(targetText)) ? '.goal-target' : '.goal-current').focus();
      throw new Error(`${index + 1}件目の目標は、指標と数値の目標値を入力してください`);
    }
    return { id: row.dataset.goalId, label, target: Number(targetText),
      current: currentText === '' ? null : Number(currentText), unit: field('unit'), evidence: field('evidence') };
  });
}
/** 議事録パネルで現在表示中のMinutesView（ダウンロードで参照する）。議事録自体は編集不可。 */
let currentMinutes = null;
/** FINAL DECISIONのAction Itemsのうち、現在編集フォームを開いている項目のid。'new'なら新規追加中。 */
let editingActionItemId = null;
/**
 * discussion系の操作(askAll等)が進行中かどうか。
 * ターン完了ごとにreloadCurrentMeeting()がrenderMeetingView()を呼び直すため、
 * m.status(CONCLUDEDかどうか)だけでボタンの有効/無効を決めると、
 * ラウンド途中の再読み込みでボタンが誤って再有効化されてしまう。
 * その再有効化を防ぐためのフラグ。
 */
let isBusy = false;

function personaById(id) {
  return personas.find((p) => p.id === id);
}

function meetingTypeById(id) {
  return meetingTypes.find((t) => t.id === id);
}

function avatarSrc(fileName) {
  return `assets/personas/${fileName}`;
}

function personaAvatarSrc(personaId) {
  const p = personaById(personaId);
  return p ? avatarSrc(p.avatar) : avatarSrc('default.png');
}

function personaLabel(id) {
  const p = personaById(id);
  return p ? `${p.emoji} ${p.name}` : id;
}

/** ペルソナごとに円陣アバターのリング色をゆるく分散させる（IDのハッシュから固定色を決めるだけ）。 */
const SEAT_RING_COLORS = ['ring-amber', 'ring-teal', 'ring-rose', 'ring-violet', 'ring-blue', 'ring-green'];
function ringClassForPersona(personaId) {
  let hash = 0;
  for (let i = 0; i < personaId.length; i++) hash = (hash * 31 + personaId.charCodeAt(i)) >>> 0;
  return SEAT_RING_COLORS[hash % SEAT_RING_COLORS.length];
}

function participantById(meeting, participantId) {
  return meeting.participants.find((p) => p.id === participantId);
}

function participantLabel(meeting, participantId) {
  const participant = participantById(meeting, participantId);
  return participant ? personaLabel(participant.personaId) : participantId;
}

const STANCE_CLASS = {
  '賛成': 'agree',
  '反対': 'disagree',
  '条件付き賛成': 'conditional',
  '推奨案': 'suggest',
  'リスク指摘': 'risk',
};

/** コード解析に向いている（実装寄りの）ペルソナの優先順位。 */
const CODE_ANALYST_PERSONA_PRIORITY = [
  'architect', 'engineer', 'backend', 'devops', 'cloud', 'data_engineer', 'security', 'qa',
];

/** 会議のACTIVE参加者から、コード解析を任せるのに最も適したAIを1体選ぶ。 */
function pickCodeAnalystParticipant(meeting) {
  for (const personaId of CODE_ANALYST_PERSONA_PRIORITY) {
    const found = meeting.participants.find((p) => p.personaId === personaId && p.status === 'ACTIVE');
    if (found) return found;
  }
  return meeting.participants.find((p) => p.status === 'ACTIVE') || null;
}

/** 各参加者の「最新の立場」をトランスクリプトから逐次計算する（円陣の吹き出し表示用）。 */
function latestStanceByParticipant(meeting) {
  const map = new Map();
  for (const msg of meeting.transcript) {
    if (msg.speakerType !== 'AI') continue;
    const participantId = msg.speakerId.split('#')[1];
    if (msg.stance) map.set(participantId, msg.stance);
  }
  return map;
}

async function init() {
  renderBuildBadge();
  if (window.mermaid) {
    window.mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', fontFamily: 'inherit' });
  }
  [personas, meetingTypes, meetings, projects] = await Promise.all([
    api.personas.list(),
    api.meetingTypes.list(),
    api.meetings.list(),
    api.projects.list(),
  ]);
  renderMeetingList();
  renderProjectSelect();
  populateMeetingTypeSelect();
  wireStaticEvents();
  wireTopbarToggle();
  wireDiscussionExpand();
  api.discussion.onProgress(handleDiscussionProgress);
  // Sikun Lab IDE等の外部アプリから --pending-meeting 付きで起動された場合、
  // メインプロセス側で自動作成された会議のIDが1回だけ届くのでそれを開く。
  api.onPendingMeetingReady((meetingId) => {
    selectMeeting(meetingId);
  });
  setInterval(updateElapsedTimer, 1000);
}

/** 「今動いているのは最新ビルドか」を画面上で常時確認できるようにする(build-info.jsはビルドの都度再生成)。 */
function renderBuildBadge() {
  const el = document.getElementById('tb-build');
  const info = window.__BUILD_INFO__;
  if (!info) {
    el.textContent = 'build unknown';
    return;
  }
  const d = new Date(info.builtAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  el.textContent = `v${info.version} · ${stamp}`;
  el.title = `built at ${info.builtAt}`;
}

/** ヘッダーの折りたたみ状態はlocalStorageに保存し、次回起動時も引き継ぐ。 */
function wireTopbarToggle() {
  const topbar = document.getElementById('topbar');
  const btn = document.getElementById('topbar-toggle');
  const collapsed = localStorage.getItem('topbarCollapsed') === '1';
  topbar.classList.toggle('collapsed', collapsed);
  btn.title = collapsed ? 'ヘッダーを開く' : 'ヘッダーを折りたたむ';
  btn.addEventListener('click', () => {
    const next = !topbar.classList.contains('collapsed');
    topbar.classList.toggle('collapsed', next);
    btn.title = next ? 'ヘッダーを開く' : 'ヘッダーを折りたたむ';
    localStorage.setItem('topbarCollapsed', next ? '1' : '0');
  });
}

/** 表やmermaid図が340px幅に収まりきらないことがあるため、ディスカッション欄をフル画面表示に切り替えられるようにする。 */
function wireDiscussionExpand() {
  const panel = document.getElementById('discussion-panel');
  const btn = document.getElementById('discussion-expand-btn');
  btn.addEventListener('click', () => {
    const next = !panel.classList.contains('expanded');
    panel.classList.toggle('expanded', next);
    btn.textContent = next ? '✕ 閉じる' : '⛶ フル画面';
    btn.title = next ? 'フル画面を閉じる' : 'フル画面で表示';
  });
}

/** トップバーの経過時間表示。会議のstartedAtから1秒ごとに再計算するだけで、タイマー自体は持たない。 */
function updateElapsedTimer() {
  const el = document.getElementById('tb-elapsed');
  const m = currentMeeting;
  if (!m || !m.startedAt || m.status === 'CREATED') {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const endMs = m.status === 'CONCLUDED' && m.decision ? Date.parse(m.decision.decidedAt || m.startedAt) : Date.now();
  const totalSec = Math.max(0, Math.floor((endMs - Date.parse(m.startedAt)) / 1000));
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  document.getElementById('tb-elapsed-value').textContent = `${hh}:${mm}:${ss}`;
}

function handleDiscussionProgress(event) {
  if (!currentMeeting || event.meetingId !== currentMeeting.id) return;
  if (event.type === 'turn-start') {
    const stage = document.getElementById('circle-stage');
    stage.classList.add('discussion-active');

    const seat = document.querySelector(`.seat[data-participant-id="${event.participantId}"]`);
    if (seat) {
      seat.classList.add('speaking');
      if (!seat.querySelector('.seat-thinking')) {
        const label = document.createElement('div');
        label.className = 'seat-thinking';
        label.innerHTML = '考え中<span class="thinking-dots"><span></span><span></span><span></span></span>';
        seat.appendChild(label);
      }
    }

    const participant = participantById(currentMeeting, event.participantId);
    const banner = document.getElementById('thinking-banner');
    if (participant) {
      document.getElementById('thinking-avatar').src = personaAvatarSrc(participant.personaId);
      document.getElementById('thinking-text').textContent = `${participantLabel(currentMeeting, participant.id)}が考え中`;
      banner.classList.remove('hidden');
    }
  } else if (event.type === 'turn-end') {
    document.getElementById('thinking-banner').classList.add('hidden');
    document.getElementById('circle-stage').classList.remove('discussion-active');
    reloadCurrentMeeting();
  }
}

function renderMeetingList() {
  const ul = document.getElementById('meeting-list');
  ul.innerHTML = '';
  for (const m of meetings) {
    const li = document.createElement('li');
    const type = meetingTypeById(m.meetingTypeId);
    li.textContent = `${type ? type.emoji : ''} ${m.title}`;
    li.className = currentMeeting && currentMeeting.id === m.id ? 'active' : '';
    li.addEventListener('click', () => selectMeeting(m.id));
    ul.appendChild(li);
  }
}

function populateMeetingTypeSelect() {
  const select = document.getElementById('nm-type');
  select.innerHTML = '';
  const labels = { steering_committee: '方針・戦略', architecture_review: '技術設計', product_review: '製品・使いやすさ',
    incident_review: '障害・原因調査', brainstorming: 'アイデア出し', investment_committee: '投資判断' };
  for (const t of meetingTypes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.emoji} ${labels[t.id] || t.name}`;
    select.appendChild(opt);
  }
  select.value = meetingTypes.some((type) => type.id === 'product_review') ? 'product_review' : meetingTypes[0]?.id;
  renderPersonaCheckboxes(select.value);
  select.addEventListener('change', () => renderPersonaCheckboxes(select.value));
}

function renderPersonaCheckboxes(meetingTypeId) {
  const fieldset = document.getElementById('nm-personas');
  fieldset.innerHTML = '<legend>招集するAI（会議タイプのデフォルトから編集可能）</legend>';
  const type = meetingTypeById(meetingTypeId);
  const defaultIds = new Set(type ? type.defaultPersonaIds : []);
  for (const p of personas) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = p.id;
    checkbox.checked = defaultIds.has(p.id);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(`${p.emoji} ${p.name}`));
    fieldset.appendChild(label);
  }
}

function wireStaticEvents() {
  document.getElementById('welcome-meeting-btn').addEventListener('click', () => document.getElementById('new-meeting-btn').click());
  document.getElementById('welcome-commission-btn').addEventListener('click', () => document.getElementById('commission-new-btn').click());
  document.getElementById('new-meeting-btn').addEventListener('click', () => {
    hideAll();
    document.getElementById('new-meeting-form').classList.remove('hidden');
    document.getElementById('nm-title').value = '';
    document.getElementById('nm-agenda').value = '';
    document.getElementById('nm-dir').value = '';
    const type = document.getElementById('nm-type');
    type.value = meetingTypes.some((entry) => entry.id === 'product_review') ? 'product_review' : meetingTypes[0]?.id;
    renderPersonaCheckboxes(type.value);
    document.getElementById('nm-advanced').open = false;
    document.getElementById('tb-title').textContent = '新しい会議';
    document.getElementById('tb-agenda').textContent = '';
  });
  document.getElementById('nm-cancel').addEventListener('click', () => {
    hideAll();
    if (currentMeeting) {
      document.getElementById('meeting-view').classList.remove('hidden');
    } else {
      document.getElementById('empty-state').classList.remove('hidden');
    }
  });
  document.getElementById('nm-choose-dir').addEventListener('click', async () => {
    const dir = await api.system.chooseDirectory();
    if (dir) document.getElementById('nm-dir').value = dir;
  });
  document.getElementById('nm-submit').addEventListener('click', submitNewMeeting);

  document.getElementById('project-select').addEventListener('change', (e) => {
    currentProjectId = e.target.value || null;
    document.getElementById('project-dashboard-btn').classList.toggle('hidden', !currentProjectId);
    document.getElementById('community-open-btn').classList.toggle('hidden', !currentProjectId);
  });
  document.getElementById('project-new-btn').addEventListener('click', () => {
    document.getElementById('project-new-form').classList.toggle('hidden');
  });
  document.getElementById('pj-cancel').addEventListener('click', () => {
    document.getElementById('project-new-form').classList.add('hidden');
  });
  document.getElementById('pj-submit').addEventListener('click', async () => {
    const name = document.getElementById('pj-name').value.trim();
    const description = document.getElementById('pj-desc').value.trim();
    if (!name) return;
    const project = await api.projects.create(name, description);
    projects = await api.projects.list();
    renderProjectSelect();
    document.getElementById('project-select').value = project.id;
    currentProjectId = project.id;
    document.getElementById('project-dashboard-btn').classList.remove('hidden');
    document.getElementById('community-open-btn').classList.remove('hidden');
    document.getElementById('pj-name').value = '';
    document.getElementById('pj-desc').value = '';
    document.getElementById('project-new-form').classList.add('hidden');
  });
  document.getElementById('project-dashboard-btn').addEventListener('click', () => openProjectView(currentProjectId));
  document.getElementById('pv-card-goal-add').addEventListener('click', () => addGoalRow().querySelector('.goal-label').focus());
  document.getElementById('pv-card-save').addEventListener('click', async () => {
    if (!currentProjectId) return;
    const el = (id) => document.getElementById(id);
    el('pv-card-error').classList.add('hidden');
    try {
      const goals = readGoalRows();
      await api.projects.upsertArtifactCard(currentProjectId, {
        id: editingCardId || undefined, name: el('pv-card-name').value, kind: el('pv-card-kind').value,
        status: el('pv-card-status').value, summary: el('pv-card-summary').value,
        knownIssues: el('pv-card-issues').value.split('\n'), backlog: el('pv-card-backlog').value.split('\n'), goals,
      });
      editingCardId = null;
      el('pv-card-reset').click();
      el('pv-card-editor').open = false;
      await openProjectView(currentProjectId);
    } catch (error) {
      el('pv-card-error').textContent = error.message || String(error);
      el('pv-card-error').classList.remove('hidden');
    }
  });
  document.getElementById('pv-card-reset').addEventListener('click', () => {
    editingCardId = null;
    for (const id of ['pv-card-name', 'pv-card-summary', 'pv-card-issues', 'pv-card-backlog']) {
      document.getElementById(id).value = '';
    }
    document.getElementById('pv-card-status').value = document.getElementById('pv-card-status').defaultValue;
    document.getElementById('pv-card-goal-list').replaceChildren();
    document.getElementById('pv-card-error').classList.add('hidden');
    document.getElementById('pv-card-advanced').open = false;
    document.getElementById('pv-card-kind').value = 'app';
  });
  document.getElementById('email-config-save').addEventListener('click', async () => {
    const el = (id) => document.getElementById(id);
    try {
      const argumentTemplate = JSON.parse(el('email-template').value);
      await api.email.configure({ endpoint: el('email-endpoint').value, sendTool: el('email-tool').value,
        authorizationEnv: el('email-auth-env').value, argumentTemplate });
      el('email-connection-result').textContent = '接続設定を保存しました。認証トークンはアプリに保存されません。';
    } catch (error) { el('email-connection-result').textContent = error.message || String(error); }
  });
  document.getElementById('email-test').addEventListener('click', async () => {
    const output = document.getElementById('email-connection-result');
    output.textContent = 'MCPサーバーへ接続中…';
    try { output.textContent = '利用可能なツール: ' + (await api.email.test()).join('、'); }
    catch (error) { output.textContent = error.message || String(error); }
  });
  document.getElementById('email-meeting').addEventListener('change', async (event) => {
    const id = event.target.value;
    if (!id) return;
    const meeting = await api.meetings.get(id);
    if (!meeting.decision) return;
    document.getElementById('email-subject').value = meeting.title;
    document.getElementById('email-body').value = `会議「${meeting.title}」の決定事項\n\n${meeting.decision.decisionText}\n\n理由:\n${meeting.decision.reasoning.map((line) => '- ' + line).join('\n')}`;
  });
  document.getElementById('email-draft-create').addEventListener('click', async () => {
    if (!currentProjectId) return;
    try {
      const el = (id) => document.getElementById(id);
      await api.email.draft({ projectId: currentProjectId, sourceMeetingId: el('email-meeting').value,
        to: el('email-to').value.split(/[,;\n]/).map((entry) => entry.trim()).filter(Boolean),
        subject: el('email-subject').value, body: el('email-body').value });
      await renderEmailDrafts(currentProjectId);
    } catch (error) { alert(error.message || String(error)); }
  });
  document.getElementById('audit-run').addEventListener('click', async () => {
    if (!currentProjectId) return;
    const button = document.getElementById('audit-run');
    const status = document.getElementById('audit-status');
    button.disabled = true; status.textContent = '独立監査を実行中…';
    try { await api.audit.run(currentProjectId); status.textContent = '監査記録を保存しました。'; await renderAudits(currentProjectId); }
    catch (error) { status.textContent = error.message || String(error); }
    finally { button.disabled = false; }
  });

  document.getElementById('invite-btn').addEventListener('click', async () => {
    const personaId = document.getElementById('invite-persona-select').value;
    if (!personaId || !currentMeeting) return;
    await api.meetings.inviteParticipant(currentMeeting.id, personaId);
    await reloadCurrentMeeting();
  });

  document.getElementById('ask-all-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    setBusy(true);
    try {
      await api.discussion.askAll(currentMeeting.id);
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
      await reloadCurrentMeeting();
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('rebuttal-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    setBusy(true);
    try {
      await api.discussion.rebuttal(currentMeeting.id);
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('mv-codebase-change').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const dir = await api.system.chooseDirectory();
    if (!dir) return;
    await api.meetings.setWorkingDirectory(currentMeeting.id, dir);
    await reloadCurrentMeeting();
  });

  document.getElementById('analyze-code-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    let dir = currentMeeting.workingDirectory;
    if (!dir) {
      dir = await api.system.chooseDirectory();
      if (!dir) return;
      currentMeeting = await api.meetings.setWorkingDirectory(currentMeeting.id, dir);
    }

    const participant = pickCodeAnalystParticipant(currentMeeting);
    if (!participant) {
      alert('コードを解析できる専門家（Architect/Engineer/Backend等）が会議に参加していません。AI ROSTERから招集してください。');
      return;
    }

    setBusy(true);
    try {
      await api.discussion.askSpecific(
        currentMeeting.id,
        participant.id,
        'コード解析対象ディレクトリの実際のコードを読んで、現在の実装状況・アーキテクチャ・気になる点を具体的に説明してください。',
      );
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
      await reloadCurrentMeeting();
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('ask-specific-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const participantId = document.getElementById('ask-specific-select').value;
    const question = document.getElementById('ask-specific-question').value.trim();
    if (!participantId || !question) return;
    setBusy(true);
    try {
      await api.discussion.askSpecific(currentMeeting.id, participantId, question);
      document.getElementById('ask-specific-question').value = '';
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
      await reloadCurrentMeeting();
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('human-speak-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const input = document.getElementById('human-speak-input');
    const content = input.value.trim();
    if (!content) return;
    setBusy(true);
    try {
      await api.discussion.humanSpeak(currentMeeting.id, content);
      input.value = '';
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('df-submit').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const decisionText = document.getElementById('df-text').value.trim();
    const reasoning = document
      .getElementById('df-reasoning')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const actionItems = document
      .getElementById('df-actions')
      .value.split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(':');
        if (idx === -1) return { assignee: '未指定', description: line };
        return { assignee: line.slice(0, idx).trim(), description: line.slice(idx + 1).trim() };
      });
    if (!decisionText) return;
    const overrideReason = document.getElementById('df-override').value.trim();
    try {
      await api.decision.finalize(currentMeeting.id, { decisionText, reasoning, actionItems, overrideReason });
      await reloadCurrentMeeting();
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  document.getElementById('mv-minutes-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const panel = document.getElementById('minutes-panel');
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    currentMinutes = await api.minutes.get(currentMeeting.id);
    document.getElementById('minutes-view').textContent = currentMinutes.markdown;
    panel.classList.remove('hidden');
  });

  document.getElementById('minutes-download-btn').addEventListener('click', async () => {
    if (!currentMeeting || !currentMinutes) return;
    const safeTitle = currentMeeting.title.replace(/[\\/:*?"<>|]/g, '_');
    await api.minutes.download(currentMeeting.id, currentMinutes.markdown, `${safeTitle}-議事録.md`);
  });
}

function setBusy(busy) {
  isBusy = busy;
  document.body.style.cursor = busy ? 'progress' : 'default';
  for (const btn of document.querySelectorAll('button')) btn.disabled = busy;
}

async function submitNewMeeting() {
  const title = document.getElementById('nm-title').value.trim();
  const agenda = document.getElementById('nm-agenda').value.trim();
  const meetingTypeId = document.getElementById('nm-type').value;
  const workingDirectory = document.getElementById('nm-dir').value || null;
  const personaIds = Array.from(document.querySelectorAll('#nm-personas input:checked')).map((el) => el.value);
  if (!title || !agenda) {
    alert('タイトルと議題を入力してください。');
    return;
  }
  const meeting = await api.meetings.create({
    title,
    agenda,
    meetingTypeId,
    workingDirectory,
    personaIds,
    projectId: currentProjectId,
  });
  meetings = await api.meetings.list();
  renderMeetingList();
  document.getElementById('nm-title').value = '';
  document.getElementById('nm-agenda').value = '';
  document.getElementById('nm-dir').value = '';
  await selectMeeting(meeting.id);
}

function hideAll() {
  document.body.classList.remove('commission-active');
  document.body.classList.remove('community-active');
  document.body.classList.remove('project-active');
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('new-meeting-form').classList.add('hidden');
  document.getElementById('meeting-view').classList.add('hidden');
  document.getElementById('project-view').classList.add('hidden');
  document.getElementById('commission-create').classList.add('hidden');
  document.getElementById('commission-view').classList.add('hidden');
  document.getElementById('community-view').classList.add('hidden');
  document.getElementById('mobile-view').classList.add('hidden');
}

function renderProjectSelect() {
  const select = document.getElementById('project-select');
  const prevValue = select.value;
  select.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '（プロジェクトなし）';
  select.appendChild(noneOpt);
  for (const p of projects) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    select.appendChild(opt);
  }
  if (prevValue && projects.some((p) => p.id === prevValue)) {
    select.value = prevValue;
  }
}

async function openProjectView(projectId) {
  if (!projectId) return;
  const project = await api.projects.get(projectId);
  if (projectViewProjectId !== projectId) {
    document.getElementById('pv-card-reset').click();
    document.getElementById('pv-card-editor').open = false;
    document.getElementById('email-config-details').open = false;
    document.getElementById('email-advanced').open = false;
  }
  projectViewProjectId = projectId;
  currentProjectId = projectId;
  hideAll();
  document.body.classList.add('project-active');
  document.getElementById('project-view').classList.remove('hidden');
  document.getElementById('pv-name').textContent = `📋 ${project.name}`;
  document.getElementById('pv-description').textContent = project.description || '';

  const list = document.getElementById('pv-action-items');
  list.innerHTML = '';
  document.getElementById('pv-empty').classList.toggle('hidden', project.actionItems.length > 0);

  for (const item of project.actionItems) {
    const li = document.createElement('li');
    li.className = item.done ? 'done' : '';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.done;
    checkbox.addEventListener('change', async () => {
      await api.projects.toggleActionItem(project.id, item.id, checkbox.checked);
      li.classList.toggle('done', checkbox.checked);
    });
    li.appendChild(checkbox);

    const body = document.createElement('div');
    const assignee = document.createElement('div');
    assignee.className = 'ai-assignee';
    assignee.textContent = item.assignee;
    body.appendChild(assignee);
    const desc = document.createElement('div');
    desc.className = 'ai-desc';
    desc.textContent = item.description;
    body.appendChild(desc);
    const source = document.createElement('div');
    source.className = 'ai-source';
    source.textContent = `from: ${item.sourceMeetingTitle}`;
    body.appendChild(source);
    const commissionButton = document.createElement('button');
    commissionButton.type = 'button';
    commissionButton.className = 'secondary small-btn';
    commissionButton.textContent = 'AIチームに委託';
    commissionButton.addEventListener('click', async () => {
      commissionButton.disabled = true;
      try {
        const commission = await api.commissions.fromActionItem(project.id, item.id);
        window.dispatchEvent(new CustomEvent('commission:open', { detail: commission.id }));
      } catch (error) {
        window.alert(error.message || String(error));
      } finally {
        commissionButton.disabled = false;
      }
    });
    body.appendChild(commissionButton);
    li.appendChild(body);

    list.appendChild(li);
  }
  const cards = document.getElementById('pv-card-list');
  cards.replaceChildren();
  for (const card of project.artifactCards || []) {
    const latest = card.versions.at(-1);
    if (!latest) continue;
    const row = document.createElement('div');
    row.className = 'community-card';
    const title = document.createElement('strong');
    title.textContent = `${card.name} · v${latest.version} · ${latest.status}`;
    const body = document.createElement('p');
    body.textContent = latest.summary;
    const details = document.createElement('small');
    details.textContent = `問題: ${latest.knownIssues.join('、') || 'なし'} / バックログ: ${latest.backlog.join('、') || 'なし'} / KGI: ${latest.goals.map((goal) => `${goal.label} ${goal.current ?? '未測定'}/${goal.target}${goal.unit}`).join('、') || '未設定'} / 決定: ${latest.decisionIds.length}件`;
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'secondary small-btn'; edit.textContent = '編集';
    edit.addEventListener('click', () => {
      editingCardId = card.id;
      const el = (id) => document.getElementById(id);
      el('pv-card-name').value = card.name;
      el('pv-card-kind').value = card.kind;
      el('pv-card-status').value = latest.status;
      el('pv-card-summary').value = latest.summary;
      el('pv-card-issues').value = latest.knownIssues.join('\n');
      el('pv-card-backlog').value = latest.backlog.join('\n');
      el('pv-card-goal-list').replaceChildren();
      for (const goal of latest.goals) addGoalRow(goal);
      el('pv-card-advanced').open = card.kind !== 'app' || latest.knownIssues.length > 0 || latest.backlog.length > 0 || latest.goals.length > 0;
      el('pv-card-editor').open = true;
      el('pv-card-editor').scrollIntoView({ block: 'nearest' });
    });
    row.append(title, body, details, edit);
    cards.appendChild(row);
  }
  if (!cards.childElementCount) {
    const empty = document.createElement('p'); empty.className = 'muted small'; empty.textContent = 'まだ成果物カルテがありません。'; cards.appendChild(empty);
  }
  const config = await api.email.config();
  if (config) {
    document.getElementById('email-endpoint').value = config.endpoint;
    document.getElementById('email-tool').value = config.sendTool;
    document.getElementById('email-auth-env').value = config.authorizationEnv;
    document.getElementById('email-template').value = JSON.stringify(config.argumentTemplate, null, 2);
  }
  const meetingSelect = document.getElementById('email-meeting');
  const previousMeeting = meetingSelect.value;
  meetingSelect.replaceChildren(new Option('会議を選択', ''));
  for (const meetingId of project.meetingIds) {
    const meeting = await api.meetings.get(meetingId);
    if (meeting.decision) meetingSelect.add(new Option(meeting.title, meeting.id));
  }
  if ([...meetingSelect.options].some((option) => option.value === previousMeeting)) meetingSelect.value = previousMeeting;
  await renderEmailDrafts(projectId);
  await renderAudits(projectId);
}

async function renderAudits(projectId) {
  const container = document.getElementById('audit-records');
  container.replaceChildren();
  for (const audit of await api.audit.list(projectId)) {
    const row = document.createElement('div'); row.className = 'community-card';
    const title = document.createElement('strong');
    title.textContent = `${new Date(audit.createdAt).toLocaleString('ja-JP')} · 会議${audit.meetingIds.length}件 · KGI${audit.goalProgress.length}件`;
    const assessment = document.createElement('p'); assessment.textContent = audit.assessment;
    row.append(title, assessment);
    for (const finding of audit.findings) {
      const detail = document.createElement('p');
      detail.textContent = `${finding.kind}: ${finding.finding}（参照: ${finding.referenceId}）`;
      row.appendChild(detail);
    }
    container.appendChild(row);
  }
  if (!container.childElementCount) container.textContent = '監査記録はまだありません。';
}

async function renderEmailDrafts(projectId) {
  const container = document.getElementById('email-drafts');
  container.replaceChildren();
  for (const draft of await api.email.list(projectId)) {
    const row = document.createElement('div'); row.className = 'community-card';
    const title = document.createElement('strong');
    title.textContent = `${draft.status === 'draft' ? '送信待ち' : draft.status} · ${draft.subject}`;
    const detail = document.createElement('p');
    detail.textContent = `宛先: ${draft.to.join('、')}\n${draft.body}\n${draft.result || ''}`;
    row.append(title, detail);
    if (draft.status === 'draft') {
      const send = document.createElement('button'); send.type = 'button'; send.textContent = '内容を確認して送信';
      send.addEventListener('click', async () => {
        if (!confirm(`${draft.to.join('、')} に「${draft.subject}」を送信しますか？`)) return;
        send.disabled = true;
        try { await api.email.send(draft.id); }
        catch (error) { alert(error.message || String(error)); }
        await renderEmailDrafts(projectId);
      });
      row.appendChild(send);
    }
    container.appendChild(row);
  }
}

async function selectMeeting(id) {
  currentMeeting = await api.meetings.get(id);
  renderMeetingList();
  hideAll();
  document.getElementById('meeting-view').classList.remove('hidden');
  document.getElementById('sidebar-roster').classList.remove('hidden');
  document.getElementById('sidebar-chief').classList.remove('hidden');
  document.getElementById('minutes-panel').classList.add('hidden');
  document.getElementById('minutes-view').textContent = '';
  currentMinutes = null;
  editingActionItemId = null;
  document.getElementById('thinking-banner').classList.add('hidden');
  renderMeetingView();
}

async function reloadCurrentMeeting() {
  if (!currentMeeting) return;
  currentMeeting = await api.meetings.get(currentMeeting.id);
  renderMeetingView();
}

function renderMeetingView() {
  const m = currentMeeting;
  const type = meetingTypeById(m.meetingTypeId);

  document.getElementById('tb-title').textContent = `${type ? type.emoji : ''} ${m.title}`;
  document.getElementById('tb-agenda').textContent = m.agenda;
  const statusBadge = document.getElementById('tb-status');
  statusBadge.textContent = { CREATED: '未開始', IN_PROGRESS: '進行中', CONCLUDED: '終了' }[m.status] || m.status;
  statusBadge.className = `status-badge ${m.status}`;
  statusBadge.classList.remove('hidden');

  const codebasePath = document.getElementById('mv-codebase-path');
  codebasePath.textContent = m.workingDirectory || '未設定（「変更…」から設定するとコードを読んで解析できます）';
  codebasePath.classList.toggle('muted', !m.workingDirectory);

  renderRoster(m);
  renderCircle(m);
  renderTranscript(m);
  renderDecision(m);
  updateElapsedTimer();

  const rebuttalBtn = document.getElementById('rebuttal-btn');
  rebuttalBtn.disabled = isBusy || !type || !type.protocol.allowRebuttal || m.status === 'CONCLUDED';

  const controlsDisabled = isBusy || m.status === 'CONCLUDED';
  for (const id of ['ask-all-btn', 'ask-specific-btn', 'human-speak-btn', 'invite-btn', 'analyze-code-btn']) {
    document.getElementById(id).disabled = controlsDisabled;
  }
  document.getElementById('df-submit').disabled = controlsDisabled;
}

function renderRoster(m) {
  const activeList = document.getElementById('roster-active-list');
  const inactiveList = document.getElementById('roster-inactive-list');
  activeList.innerHTML = '';
  activeList.className = 'roster-list active';
  inactiveList.innerHTML = '';
  inactiveList.className = 'roster-list inactive';

  // 発言ターン進行中に参加者を除籍/再招集されると進行中のロジックと矛盾しうるため、
  // 他の操作ボタンと同様に isBusy 中はここも操作不可にする（フールプルーフ）。
  const rosterDisabled = isBusy || m.status === 'CONCLUDED';

  let activeCount = 0;
  let inactiveCount = 0;

  for (const p of m.participants) {
    const li = document.createElement('li');

    const dot = document.createElement('span');
    dot.className = 'status-dot';
    li.appendChild(dot);

    const avatar = document.createElement('img');
    avatar.className = 'roster-avatar';
    avatar.src = personaAvatarSrc(p.personaId);
    li.appendChild(avatar);

    const name = document.createElement('span');
    name.className = 'roster-name';
    name.textContent = personaLabel(p.personaId);
    li.appendChild(name);

    const btn = document.createElement('button');
    btn.disabled = rosterDisabled;
    if (p.status === 'ACTIVE') {
      activeCount++;
      btn.textContent = '除籍';
      btn.className = 'secondary';
      btn.addEventListener('click', async () => {
        await api.meetings.deactivateParticipant(m.id, p.id);
        await reloadCurrentMeeting();
      });
      li.appendChild(btn);
      activeList.appendChild(li);
    } else {
      inactiveCount++;
      btn.textContent = '再招集';
      btn.addEventListener('click', async () => {
        await api.meetings.reactivateParticipant(m.id, p.id);
        await reloadCurrentMeeting();
      });
      li.appendChild(btn);
      inactiveList.appendChild(li);
    }
  }

  document.getElementById('active-count').textContent = `(${activeCount})`;
  document.getElementById('inactive-count').textContent = `(${inactiveCount})`;

  const inviteSelect = document.getElementById('invite-persona-select');
  const askSelect = document.getElementById('ask-specific-select');
  inviteSelect.innerHTML = '';
  askSelect.innerHTML = '';
  const invitedIds = new Set(m.participants.map((p) => p.personaId));
  for (const p of personas) {
    if (!invitedIds.has(p.id)) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.emoji} ${p.name}`;
      inviteSelect.appendChild(opt);
    }
  }
  for (const p of m.participants.filter((x) => x.status === 'ACTIVE')) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = personaLabel(p.personaId);
    askSelect.appendChild(opt);
  }
}

/** 立場の極性。対立ペア判定に使う（賛成寄り⇔反対寄りの組み合わせだけを「対立中」とする）。 */
const STANCE_POLARITY = {
  '賛成': 'positive',
  '推奨案': 'positive',
  '反対': 'negative',
  'リスク指摘': 'negative',
  '条件付き賛成': 'neutral',
};

function renderCircle(m) {
  const stage = document.getElementById('circle-stage');
  // 既存の座席・対立マップ要素だけ削除し、中央の chief カードは残す。
  stage.querySelectorAll('.seat').forEach((el) => el.remove());
  const oldSvg = document.getElementById('conflict-svg');
  if (oldSvg) oldSvg.remove();

  const activeParticipants = m.participants.filter((p) => p.status === 'ACTIVE');
  const stanceMap = latestStanceByParticipant(m);

  const cx = 280;
  const cy = 240;
  const rx = 220;
  const ry = 190;
  const n = activeParticipants.length;

  const positions = new Map(); // participantId -> {x, y}

  activeParticipants.forEach((p, i) => {
    const angle = (-90 + (360 / Math.max(n, 1)) * i) * (Math.PI / 180);
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    positions.set(p.id, { x, y });

    const persona = personaById(p.personaId);
    const seat = document.createElement('div');
    seat.className = `seat ${ringClassForPersona(p.personaId)}`;
    seat.dataset.participantId = p.id;
    seat.style.left = `${x}px`;
    seat.style.top = `${y}px`;
    seat.title = `${personaLabel(p.personaId)}を指名して質問する`;

    const img = document.createElement('img');
    img.src = personaAvatarSrc(p.personaId);
    seat.appendChild(img);

    const name = document.createElement('div');
    name.className = 'seat-name';
    name.textContent = persona ? persona.name : p.personaId;
    seat.appendChild(name);

    const role = document.createElement('div');
    role.className = 'seat-role';
    role.textContent = persona ? persona.roleTitle : '';
    seat.appendChild(role);

    const activeBadge = document.createElement('div');
    activeBadge.className = 'seat-active-badge';
    activeBadge.textContent = 'ACTIVE';
    seat.appendChild(activeBadge);

    const stance = stanceMap.get(p.id);
    if (stance) {
      const tag = document.createElement('div');
      tag.className = `seat-stance ${STANCE_CLASS[stance] || ''}`;
      tag.textContent = stance;
      seat.appendChild(tag);
    }

    seat.addEventListener('click', () => {
      document.getElementById('ask-specific-select').value = p.id;
      const q = document.getElementById('ask-specific-question');
      q.focus();
    });

    stage.appendChild(seat);
  });

  renderConflictMap(stage, activeParticipants, stanceMap, positions);
}

/**
 * AI対立マップ: 最新の立場が「賛成寄り」のAIと「反対寄り」のAIを、
 * 円陣上で点線で結んで可視化する。SVGを座席の背面(z-index)に重ねて描画する。
 */
function renderConflictMap(stage, activeParticipants, stanceMap, positions) {
  const positiveIds = [];
  const negativeIds = [];
  for (const p of activeParticipants) {
    const stance = stanceMap.get(p.id);
    const polarity = STANCE_POLARITY[stance];
    if (polarity === 'positive') positiveIds.push(p.id);
    else if (polarity === 'negative') negativeIds.push(p.id);
  }
  if (positiveIds.length === 0 || negativeIds.length === 0) return;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.id = 'conflict-svg';
  svg.setAttribute('viewBox', '0 0 560 480');

  for (const posId of positiveIds) {
    for (const negId of negativeIds) {
      const a = positions.get(posId);
      const b = positions.get(negId);
      if (!a || !b) continue;

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', a.x);
      line.setAttribute('y1', a.y);
      line.setAttribute('x2', b.x);
      line.setAttribute('y2', b.y);
      line.setAttribute('class', 'conflict-line');
      svg.appendChild(line);

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', midX);
      label.setAttribute('y', midY);
      label.setAttribute('class', 'conflict-label');
      label.textContent = '対立中';
      svg.appendChild(label);
    }
  }

  stage.insertBefore(svg, stage.firstChild);
}

function renderTranscript(m) {
  const list = document.getElementById('transcript-list');
  const empty = document.getElementById('transcript-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', m.transcript.length > 0);

  for (const msg of m.transcript) {
    const div = document.createElement('div');
    div.className = 'msg' + (msg.speakerType === 'HUMAN' ? ' human' : '');

    const img = document.createElement('img');
    if (msg.speakerType === 'HUMAN') {
      img.src = avatarSrc('chief.png');
    } else if (msg.speakerType === 'SYSTEM') {
      img.src = avatarSrc('default.png');
    } else {
      const participantId = msg.speakerId.split('#')[1];
      const participant = participantById(m, participantId);
      img.src = participant ? personaAvatarSrc(participant.personaId) : avatarSrc('default.png');
    }
    div.appendChild(img);

    const body = document.createElement('div');
    body.className = 'body';

    const speakerRow = document.createElement('div');
    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    if (msg.speakerType === 'HUMAN') speaker.textContent = '最高開発者';
    else if (msg.speakerType === 'SYSTEM') speaker.textContent = 'system';
    else speaker.textContent = participantLabel(m, msg.speakerId.split('#')[1]);
    speakerRow.appendChild(speaker);

    if (msg.stance) {
      const stance = document.createElement('span');
      stance.className = `stance-tag ${STANCE_CLASS[msg.stance] || ''}`;
      stance.textContent = msg.stance;
      speakerRow.appendChild(stance);
    }
    body.appendChild(speakerRow);

    const content = document.createElement('div');
    content.className = 'content markdown-body';
    content.innerHTML = renderMarkdown(msg.content);
    body.appendChild(content);

    div.appendChild(body);
    list.appendChild(div);
  }
  list.scrollTop = list.scrollHeight;
  renderMermaidBlocks();
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** innerHTMLに入れる前に、sanitize.ts の許可リストで要素と属性を絞る。CSPと合わせた二重の防御。 */
function sanitizeHtml(html) {
  return window.sanitizeHtml(html);
}

/**
 * AIの発言をMarkdownとして描画する。```mermaid フェンスだけは、marked任せにせず
 * 先に抜き出して <pre class="mermaid"> に置き換える（マークダウン変換後にmermaid.runで図化するため、
 * 中のコードがMarkdownとして誤変換されないよう避ける）。
 */
function renderMarkdown(text) {
  const mermaidBlocks = [];
  const withPlaceholders = text.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code) => {
    const idx = mermaidBlocks.length;
    mermaidBlocks.push(code.trim());
    return `@@MERMAID_BLOCK_${idx}@@`;
  });

  let html = window.marked ? window.marked.parse(withPlaceholders, { gfm: true, breaks: true }) : escapeHtml(withPlaceholders);
  html = sanitizeHtml(html);

  html = html.replace(/@@MERMAID_BLOCK_(\d+)@@/g, (_m, idx) => {
    const code = mermaidBlocks[Number(idx)];
    return code ? `<pre class="mermaid">${escapeHtml(code)}</pre>` : '';
  });

  return html;
}

/** メッセージ再描画のたびに新しく増えた.mermaidブロックを図としてレンダリングする。 */
/**
 * mermaid.run()にそのまま任せると、構文エラー時に大きな爆弾アイコンのエラー図が
 * 描画されてしまい発言が読みにくくなる。先にmermaid.parse()で検証し、無効な図だけ
 * コンパクトな警告表示（元のコード付き）に差し替えてからrunする。
 */
async function renderMermaidBlocks() {
  if (!window.mermaid) return;
  const nodes = Array.from(document.querySelectorAll('#transcript-list .mermaid:not([data-processed])'));
  if (nodes.length === 0) return;

  const valid = [];
  for (const node of nodes) {
    const code = node.textContent;
    let ok = true;
    try {
      ok = await window.mermaid.parse(code, { suppressErrors: true });
    } catch {
      ok = false;
    }
    if (ok) {
      valid.push(node);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'mermaid-error';
      fallback.innerHTML = `⚠️ 図の構文エラーのため表示できませんでした<pre>${escapeHtml(code)}</pre>`;
      node.replaceWith(fallback);
    }
  }

  if (valid.length === 0) return;
  try {
    window.mermaid.run({ nodes: valid, suppressErrors: true });
  } catch (err) {
    console.error('[mermaid] render failed', err);
  }
}

function decisionColumn(title, items) {
  const col = document.createElement('div');
  col.className = 'decision-col';
  const h = document.createElement('h4');
  h.textContent = title;
  col.appendChild(h);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = 'なし';
    col.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    for (const item of items) {
      const li = document.createElement('li');
      li.appendChild(item);
      ul.appendChild(li);
    }
    col.appendChild(ul);
  }
  return col;
}

function renderDecision(m) {
  const view = document.getElementById('decision-view');
  const form = document.getElementById('decision-form');
  view.innerHTML = '';
  if (m.decision) {
    form.classList.add('hidden');
    const d = m.decision;
    if (d.overrideReason) {
      const override = document.createElement('p');
      override.className = 'muted small';
      override.textContent = '議決条件の例外理由: ' + d.overrideReason;
      view.appendChild(override);
    }

    const callout = document.createElement('div');
    callout.className = 'decision-callout';
    const goTag = document.createElement('span');
    goTag.className = 'decision-go';
    goTag.textContent = '🟢 GO';
    callout.appendChild(goTag);
    const text = document.createElement('div');
    text.className = 'decision-text';
    text.textContent = d.decisionText;
    callout.appendChild(text);
    view.appendChild(callout);

    const grid = document.createElement('div');
    grid.className = 'decision-grid';
    grid.appendChild(
      decisionColumn(
        'REASONING',
        d.reasoning.map((r) => {
          const s = document.createElement('span');
          s.textContent = r;
          return s;
        })
      )
    );
    grid.appendChild(
      decisionColumn(
        'DISAGREEMENTS',
        d.disagreements.map((x) => {
          const s = document.createElement('span');
          s.textContent = `${participantLabel(m, x.participantId)}: ${x.stance ?? '（発言なし）'}`;
          return s;
        })
      )
    );
    grid.appendChild(renderActionItemsColumn(m, d));
    view.appendChild(grid);
  } else {
    form.classList.remove('hidden');
    const gateView = document.getElementById('df-gate');
    gateView.textContent = '議決条件を確認中…';
    void api.decision.gate(m.id).then((gate) => {
      if (currentMeeting?.id !== m.id) return;
      gateView.textContent = gate.ready
        ? `議決可能 · 有効意見 ${gate.validStanceCount}/${gate.activeCount} · 賛成 ${gate.supportCount}`
        : `議決条件が未達: ${gate.reasons.join('／')}。例外として確定する場合は理由を記録してください。`;
    }).catch((error) => { gateView.textContent = error.message || String(error); });
  }
}

/**
 * 会議での決定内容・理由・各AIの立場は「その場の記録」であり通常の会議では書き換え不可だが、
 * Action Itemsは実行タスクなので、後から担当/内容の編集・削除・追加ができるようにする。
 * どの項目が編集中かはeditingActionItemIdで管理する（'new'なら新規追加フォーム）。
 */
function renderActionItemsColumn(m, d) {
  const col = document.createElement('div');
  col.className = 'decision-col';
  const h = document.createElement('h4');
  h.textContent = 'ACTION ITEMS';
  col.appendChild(h);

  if (d.actionItems.length === 0 && editingActionItemId !== 'new') {
    const empty = document.createElement('div');
    empty.className = 'muted small';
    empty.textContent = 'なし';
    col.appendChild(empty);
  }

  const ul = document.createElement('ul');
  for (const item of d.actionItems) {
    const li = document.createElement('li');
    li.appendChild(
      editingActionItemId === item.id ? buildActionItemEditRow(m, item) : buildActionItemViewRow(m, item),
    );
    ul.appendChild(li);
  }
  if (editingActionItemId === 'new') {
    const li = document.createElement('li');
    li.appendChild(buildActionItemEditRow(m, null));
    ul.appendChild(li);
  }
  col.appendChild(ul);

  if (editingActionItemId === null) {
    const addBtn = document.createElement('button');
    addBtn.className = 'secondary small-btn';
    addBtn.textContent = '+ 追加';
    addBtn.addEventListener('click', () => {
      editingActionItemId = 'new';
      renderDecision(currentMeeting);
    });
    col.appendChild(addBtn);
  }

  return col;
}

function buildActionItemViewRow(m, item) {
  const wrap = document.createElement('div');
  wrap.className = 'action-item-row';

  const text = document.createElement('span');
  text.className = 'action-item-text' + (item.done ? ' done' : '');
  const assignee = document.createElement('b');
  assignee.textContent = `[${item.assignee}] `;
  text.appendChild(assignee);
  text.appendChild(document.createTextNode(item.description));
  wrap.appendChild(text);

  const icons = document.createElement('span');
  icons.className = 'action-item-icons';

  const editBtn = document.createElement('button');
  editBtn.className = 'icon-btn';
  editBtn.textContent = '✏️';
  editBtn.title = '編集';
  editBtn.addEventListener('click', () => {
    editingActionItemId = item.id;
    renderDecision(currentMeeting);
  });
  icons.appendChild(editBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.textContent = '🗑';
  delBtn.title = '削除';
  delBtn.addEventListener('click', async () => {
    if (!confirm('このAction Itemを削除しますか？')) return;
    const next = m.decision.actionItems
      .filter((a) => a.id !== item.id)
      .map((a) => ({ id: a.id, assignee: a.assignee, description: a.description }));
    await api.decision.updateActionItems(m.id, next);
    await reloadCurrentMeeting();
  });
  icons.appendChild(delBtn);

  wrap.appendChild(icons);
  return wrap;
}

function buildActionItemEditRow(m, item) {
  const wrap = document.createElement('div');
  wrap.className = 'action-item-edit-row';

  const assigneeInput = document.createElement('input');
  assigneeInput.type = 'text';
  assigneeInput.placeholder = '担当';
  assigneeInput.value = item ? item.assignee : '';
  wrap.appendChild(assigneeInput);

  const descInput = document.createElement('input');
  descInput.type = 'text';
  descInput.placeholder = '内容';
  descInput.value = item ? item.description : '';
  wrap.appendChild(descInput);

  const icons = document.createElement('span');
  icons.className = 'action-item-icons';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'icon-btn';
  saveBtn.textContent = '✓';
  saveBtn.title = '保存';
  saveBtn.addEventListener('click', async () => {
    const description = descInput.value.trim();
    const assignee = assigneeInput.value.trim() || '未指定';
    if (!description) return;
    const next = item
      ? m.decision.actionItems.map((a) =>
          a.id === item.id ? { id: a.id, assignee, description } : { id: a.id, assignee: a.assignee, description: a.description },
        )
      : [
          ...m.decision.actionItems.map((a) => ({ id: a.id, assignee: a.assignee, description: a.description })),
          { assignee, description },
        ];
    editingActionItemId = null;
    await api.decision.updateActionItems(m.id, next);
    await reloadCurrentMeeting();
  });
  icons.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'icon-btn';
  cancelBtn.textContent = '✕';
  cancelBtn.title = 'キャンセル';
  cancelBtn.addEventListener('click', () => {
    editingActionItemId = null;
    renderDecision(currentMeeting);
  });
  icons.appendChild(cancelBtn);

  wrap.appendChild(icons);
  return wrap;
}

init();
})();

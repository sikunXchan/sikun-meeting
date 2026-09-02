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

/**
 * 議題欄のMarkdownテンプレート。
 * 議題(agenda)は毎ターン全AIのプロンプトにそのまま入る（promptBuilder.ts）ため、
 * ここに「コードを読んでも分からない文脈」（目的・背景・制約）を
 * 最高開発者があらかじめ書いておけるようにしておく。
 */
const AGENDA_TEMPLATE = `## プロジェクト概要


## 目的・ゴール


## 背景・制約（コードだけでは分からない事情）


## 今回の会議で決めたいこと


`;

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
  api.discussion.onProgress(handleDiscussionProgress);
}

function handleDiscussionProgress(event) {
  if (!currentMeeting || event.meetingId !== currentMeeting.id) return;
  if (event.type === 'turn-start') {
    const seat = document.querySelector(`.seat[data-participant-id="${event.participantId}"]`);
    if (!seat) return;
    seat.classList.add('speaking');
    if (!seat.querySelector('.seat-thinking')) {
      const label = document.createElement('div');
      label.className = 'seat-thinking';
      label.textContent = '💭 考え中…';
      seat.appendChild(label);
    }
  } else if (event.type === 'turn-end') {
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
  for (const t of meetingTypes) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `${t.emoji} ${t.name} — ${t.description}`;
    select.appendChild(opt);
  }
  renderPersonaCheckboxes(meetingTypes[0]?.id);
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
  document.getElementById('new-meeting-btn').addEventListener('click', () => {
    hideAll();
    document.getElementById('new-meeting-form').classList.remove('hidden');
    const agenda = document.getElementById('nm-agenda');
    if (!agenda.value.trim()) agenda.value = AGENDA_TEMPLATE;
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
    document.getElementById('pj-name').value = '';
    document.getElementById('pj-desc').value = '';
    document.getElementById('project-new-form').classList.add('hidden');
  });
  document.getElementById('project-dashboard-btn').addEventListener('click', () => openProjectView(currentProjectId));

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
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('human-speak-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const input = document.getElementById('human-speak-input');
    const content = input.value.trim();
    if (!content) return;
    await api.discussion.humanSpeak(currentMeeting.id, content);
    input.value = '';
    await reloadCurrentMeeting();
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
    await api.decision.finalize(currentMeeting.id, { decisionText, reasoning, actionItems });
    await reloadCurrentMeeting();
  });

  document.getElementById('mv-minutes-btn').addEventListener('click', async () => {
    if (!currentMeeting) return;
    const minutes = await api.minutes.get(currentMeeting.id);
    const view = document.getElementById('minutes-view');
    view.textContent = minutes.markdown;
    view.classList.toggle('hidden');
  });
}

function setBusy(busy) {
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
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('new-meeting-form').classList.add('hidden');
  document.getElementById('meeting-view').classList.add('hidden');
  document.getElementById('project-view').classList.add('hidden');
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
  hideAll();
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
    li.appendChild(body);

    list.appendChild(li);
  }
}

async function selectMeeting(id) {
  currentMeeting = await api.meetings.get(id);
  renderMeetingList();
  hideAll();
  document.getElementById('meeting-view').classList.remove('hidden');
  document.getElementById('sidebar-roster').classList.remove('hidden');
  document.getElementById('sidebar-chief').classList.remove('hidden');
  document.getElementById('minutes-view').classList.add('hidden');
  document.getElementById('minutes-view').textContent = '';
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

  const rebuttalBtn = document.getElementById('rebuttal-btn');
  rebuttalBtn.disabled = !type || !type.protocol.allowRebuttal || m.status === 'CONCLUDED';

  const controlsDisabled = m.status === 'CONCLUDED';
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

function renderCircle(m) {
  const stage = document.getElementById('circle-stage');
  // 既存の座席要素だけ削除し、中央の chief カードは残す。
  stage.querySelectorAll('.seat').forEach((el) => el.remove());

  const activeParticipants = m.participants.filter((p) => p.status === 'ACTIVE');
  const stanceMap = latestStanceByParticipant(m);

  const cx = 280;
  const cy = 240;
  const rx = 220;
  const ry = 190;
  const n = activeParticipants.length;

  activeParticipants.forEach((p, i) => {
    const angle = (-90 + (360 / Math.max(n, 1)) * i) * (Math.PI / 180);
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);

    const persona = personaById(p.personaId);
    const seat = document.createElement('div');
    seat.className = 'seat';
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
    content.className = 'content';
    content.textContent = msg.content;
    body.appendChild(content);

    div.appendChild(body);
    list.appendChild(div);
  }
  list.scrollTop = list.scrollHeight;
}

function renderDecision(m) {
  const view = document.getElementById('decision-view');
  const form = document.getElementById('decision-form');
  if (m.decision) {
    form.classList.add('hidden');
    const d = m.decision;
    const disagreements = d.disagreements
      .map((x) => `  - ${participantLabel(m, x.participantId)}: ${x.stance ?? '（発言なし）'}`)
      .join('\n');
    const actions = d.actionItems.map((a) => `  - [${a.assignee}] ${a.description}`).join('\n');
    view.textContent =
      `🟢 GO\n${d.decisionText}\n\n` +
      `REASONING:\n${d.reasoning.map((r) => `  - ${r}`).join('\n')}\n\n` +
      `DISAGREEMENTS:\n${disagreements}\n\n` +
      `ACTION ITEMS:\n${actions}`;
  } else {
    view.textContent = '';
    form.classList.remove('hidden');
  }
}

init();
})();

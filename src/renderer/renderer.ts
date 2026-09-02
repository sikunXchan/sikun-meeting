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
let currentMeeting = null;

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
  [personas, meetingTypes, meetings] = await Promise.all([
    api.personas.list(),
    api.meetingTypes.list(),
    api.meetings.list(),
  ]);
  renderMeetingList();
  populateMeetingTypeSelect();
  wireStaticEvents();
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
  const meeting = await api.meetings.create({ title, agenda, meetingTypeId, workingDirectory, personaIds });
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

  renderRoster(m);
  renderCircle(m);
  renderTranscript(m);
  renderDecision(m);

  const rebuttalBtn = document.getElementById('rebuttal-btn');
  rebuttalBtn.disabled = !type || !type.protocol.allowRebuttal || m.status === 'CONCLUDED';

  const controlsDisabled = m.status === 'CONCLUDED';
  for (const id of ['ask-all-btn', 'ask-specific-btn', 'human-speak-btn', 'invite-btn']) {
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

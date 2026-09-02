// @ts-nocheck
// レンダラー側の最小限のUIロジック（機能優先・デザインは後回し）。
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

function personaLabel(id) {
  const p = personaById(id);
  return p ? `${p.emoji} ${p.name}` : id;
}

function participantLabel(meeting, participantId) {
  const participant = meeting.participants.find((p) => p.id === participantId);
  return participant ? personaLabel(participant.personaId) : participantId;
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
    document.getElementById('empty-state').classList.remove('hidden');
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
    view.classList.remove('hidden');
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
  document.getElementById('minutes-view').classList.add('hidden');
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

  document.getElementById('mv-title').textContent = `${type ? type.emoji : ''} ${m.title}`;
  document.getElementById('mv-agenda').textContent = m.agenda;
  document.getElementById('mv-status').textContent = m.status;

  renderRoster(m);
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
  inactiveList.innerHTML = '';

  for (const p of m.participants) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = personaLabel(p.personaId);
    li.appendChild(label);

    const btn = document.createElement('button');
    if (p.status === 'ACTIVE') {
      btn.textContent = '除籍';
      btn.className = 'secondary';
      btn.addEventListener('click', async () => {
        await api.meetings.deactivateParticipant(m.id, p.id);
        await reloadCurrentMeeting();
      });
      li.appendChild(btn);
      activeList.appendChild(li);
    } else {
      btn.textContent = '再招集';
      btn.addEventListener('click', async () => {
        await api.meetings.reactivateParticipant(m.id, p.id);
        await reloadCurrentMeeting();
      });
      li.appendChild(btn);
      inactiveList.appendChild(li);
    }
  }

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

function renderTranscript(m) {
  const list = document.getElementById('transcript-list');
  list.innerHTML = '';
  for (const msg of m.transcript) {
    const div = document.createElement('div');
    div.className = 'msg' + (msg.speakerType === 'HUMAN' ? ' human' : '');

    const speaker = document.createElement('span');
    speaker.className = 'speaker';
    if (msg.speakerType === 'HUMAN') speaker.textContent = '👤 最高開発者';
    else if (msg.speakerType === 'SYSTEM') speaker.textContent = '🗒 system';
    else speaker.textContent = participantLabel(m, msg.speakerId.split('#')[1]);
    div.appendChild(speaker);

    if (msg.stance) {
      const stance = document.createElement('span');
      stance.className = 'stance';
      stance.textContent = msg.stance;
      div.appendChild(stance);
    }

    const content = document.createElement('div');
    content.textContent = msg.content;
    div.appendChild(content);

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

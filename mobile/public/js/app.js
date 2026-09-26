import { decryptEnvelope, deriveKeys, isShareKey } from './crypto.js';

const KEY_STORAGE = 'sikun-mobile-key';
const FILTER_STORAGE = 'sikun-mobile-project';
const app = document.getElementById('app');
const banner = document.getElementById('banner');
const backBtn = document.getElementById('back-btn');
const refreshBtn = document.getElementById('refresh-btn');
const titleEl = document.getElementById('topbar-title');
const subEl = document.getElementById('topbar-sub');

const STATUS = { CREATED: '準備中', IN_PROGRESS: '進行中', CONCLUDED: '決定済み' };
const POLARITY = { '賛成': 'positive', '推奨案': 'positive', '反対': 'negative', 'リスク指摘': 'negative', '条件付き賛成': 'neutral' };
const ROUND = { initial: '初回意見', discussion: '討論', rebuttal: '反論' };

const state = { keys: null, snapshot: null, offline: false, loading: false, query: '' };

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch { /* 保存できない環境では毎回読み取る */ } }
function storageRemove(key) { try { localStorage.removeItem(key); } catch { /* 同上 */ } }

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'className') node.className = value;
    else if (name.startsWith('on')) node.addEventListener(name.slice(2).toLowerCase(), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function markdown(text) {
  const node = h('div', { className: 'markdown' });
  if (window.renderMarkdownSafe) node.innerHTML = window.renderMarkdownSafe(text);
  else node.textContent = text || '';
  return node;
}

function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function avatar(file, alt) {
  const safe = /^[a-z_]+\.png$/.test(file || '') ? file : null;
  return h('img', { src: safe ? `/personas/${safe}` : '/icons/guide-bear.png', alt, loading: 'lazy', width: 48, height: 48 });
}

function stanceChip(stance) {
  return stance ? h('span', { className: `stance ${POLARITY[stance] || ''}` }, stance) : null;
}

function showBanner(text, kind = '') {
  banner.textContent = text || '';
  banner.className = `banner ${kind}`;
  banner.classList.toggle('hidden', !text);
}

function setTopbar(title, sub, { back = false } = {}) {
  titleEl.textContent = title;
  subEl.textContent = sub || '';
  backBtn.classList.toggle('hidden', !back);
  refreshBtn.classList.toggle('hidden', !state.keys);
}

function readKeyFromHash() {
  const match = /^#k=([A-Za-z0-9_-]+)/.exec(location.hash);
  if (!match) return;
  if (isShareKey(match[1])) storageSet(KEY_STORAGE, match[1]);
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}

function extractKey(input) {
  const trimmed = input.trim();
  const fromUrl = /#k=([A-Za-z0-9_-]+)/.exec(trimmed);
  const key = fromUrl ? fromUrl[1] : trimmed;
  return isShareKey(key) ? key : null;
}

function renderPairing(message) {
  setTopbar('Sikun Meeting', 'スマホで会議を見る');
  showBanner(message || '', message ? 'error' : '');
  const input = h('input', { className: 'pair-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'デスクトップに表示されたURLを貼り付け', 'aria-label': '共有URL' });
  app.replaceChildren(
    h('section', { className: 'guide-card' },
      h('img', { className: 'guide-bear', src: '/icons/guide-bear.png', alt: '' }),
      h('div', {}, h('p', { className: 'guide-eyebrow' }, 'スマホで会議を確認'), h('h2', {}, '会議の続きは、ここで読めます'),
        h('p', {}, 'まずパソコンと連携しましょう。二次元コードを読み取るだけで始められます。'))),
    h('section', { className: 'card' },
      h('h2', {}, 'デスクトップと連携する'),
      h('ol', { className: 'steps' },
        h('li', {}, 'パソコンのSikun Meetingで「📱 スマホで見る」を開き、同期を有効にします。'),
        h('li', {}, '表示された二次元コードをスマホのカメラで読み取ります。'),
        h('li', {}, '開いたページをホーム画面に追加すると、アプリのように使えます。')),
      h('p', { className: 'muted' }, '会議の内容はパソコンで暗号化されてから送られます。読むための鍵はこのスマホの中だけに保存されます。')),
    h('section', { className: 'card' },
      h('h2', {}, 'URLを貼り付けて連携する'),
      input,
      h('button', { className: 'primary-btn', type: 'button', onClick: () => {
        const key = extractKey(input.value);
        if (!key) { showBanner('URLまたは鍵の形式が正しくありません。', 'error'); return; }
        storageSet(KEY_STORAGE, key);
        void start();
      } }, '連携する')),
  );
}

async function loadSnapshot() {
  if (state.loading) return;
  state.loading = true;
  refreshBtn.disabled = true;
  try {
    const response = await fetch(`/api/snapshot?id=${state.keys.id}`, { cache: 'no-store' });
    if (response.status === 404) {
      state.snapshot = null;
      showBanner('まだ同期された内容がありません。パソコンで「今すぐ同期」を押してください。');
      return;
    }
    if (!response.ok) throw new Error(`読み込みに失敗しました（${response.status}）`);
    state.offline = response.headers.get('X-Sikun-Offline') === '1';
    const envelope = await response.json();
    try {
      state.snapshot = await decryptEnvelope(envelope, state.keys.aesKey);
    } catch {
      throw new Error('復号できませんでした。パソコン側で鍵が作り直された可能性があります。二次元コードを読み取り直してください。');
    }
    const omitted = state.snapshot.omittedMeetings ? ` 容量のため古い会議${state.snapshot.omittedMeetings}件は省略しています。` : '';
    showBanner(state.offline ? `オフラインのため前回の内容を表示しています（${formatTime(state.snapshot.generatedAt)}時点）。${omitted}` : omitted.trim());
  } catch (error) {
    showBanner(error instanceof TypeError ? '通信できませんでした。電波の良い場所で再読み込みしてください。' : error.message, 'error');
  } finally {
    state.loading = false;
    refreshBtn.disabled = false;
  }
}

function projectName(id) {
  return state.snapshot.projects.find((project) => project.id === id)?.name || 'プロジェクトなし';
}

function renderList() {
  const snapshot = state.snapshot;
  setTopbar('会議一覧', snapshot ? `${formatTime(snapshot.generatedAt)} 同期` : '');
  if (!snapshot) {
    app.replaceChildren(h('div', { className: 'guide-empty' }, h('img', { className: 'guide-bear', src: '/icons/guide-bear.png', alt: '' }),
      h('h2', {}, '会議がまだ届いていません'), h('p', {}, 'パソコン側で「今すぐ同期」を押すと、ここに会議が表示されます。')), unpairButton());
    return;
  }
  const selected = storageGet(FILTER_STORAGE) || 'all';
  const select = h('select', { 'aria-label': 'プロジェクトで絞り込む', onChange: (event) => { storageSet(FILTER_STORAGE, event.target.value); renderList(); } },
    h('option', { value: 'all' }, 'すべてのプロジェクト'),
    snapshot.projects.map((project) => h('option', { value: project.id, selected: project.id === selected }, project.name)));
  const search = h('input', { type: 'search', placeholder: '会議名で検索', value: state.query, 'aria-label': '会議名で検索',
    onInput: (event) => { state.query = event.target.value; renderItems(); } });
  const list = h('div', {});
  function renderItems() {
    const query = state.query.trim().toLowerCase();
    const meetings = snapshot.meetings.filter((meeting) => (selected === 'all' || meeting.projectId === selected)
      && (!query || meeting.title.toLowerCase().includes(query)));
    list.replaceChildren(...(meetings.length ? meetings.map((meeting) => h('button', {
      className: 'card meeting-item', type: 'button', onClick: () => { location.hash = `#/m/${meeting.id}`; },
    },
    h('div', { className: 'meeting-card-main' },
      avatar(meeting.participants?.find((participant) => participant.active)?.avatar || meeting.participants?.[0]?.avatar, ''),
      h('div', { className: 'meeting-card-copy' },
        h('div', { className: 'meeting-head' },
          h('span', { className: 'meeting-title' }, `${meeting.typeEmoji || ''} ${meeting.title}`),
          h('span', { className: `badge ${meeting.status}` }, STATUS[meeting.status] || meeting.status)),
        h('div', { className: 'meeting-meta' }, `${projectName(meeting.projectId)} · ${meeting.typeName}`))),
    meeting.decision ? h('div', { className: 'meeting-summary' }, h('span', { className: 'meeting-summary-label' }, '決まったこと'), markdown(meeting.decision.text)) : null,
    h('div', { className: 'meeting-footer' }, h('span', {}, formatTime(meeting.createdAt)), h('span', {}, `発言 ${meeting.messages.length}件`), h('span', { 'aria-hidden': 'true' }, '→')),
    )) : [h('div', { className: 'guide-empty' }, h('img', { className: 'guide-bear', src: '/icons/guide-bear.png', alt: '' }), h('h2', {}, '会議が見つかりません'), h('p', {}, '検索の言葉やプロジェクトを変えてみてください。'))]));
  }
  renderItems();
  app.replaceChildren(
    h('section', { className: 'list-hero' }, h('img', { className: 'guide-bear', src: '/icons/guide-bear.png', alt: '' }),
      h('div', {}, h('p', { className: 'guide-eyebrow' }, 'Sikun Meeting'), h('h1', {}, '会議を振り返る'),
        h('p', {}, `${snapshot.meetings.length}件の会議をスマホで確認できます。決まったことや専門家の発言をいつでも読み返せます。`))),
    h('div', { className: 'list-toolbar' }, h('div', { className: 'filters' }, select), h('div', { className: 'filters' }, search)),
    list, unpairButton());
}

function unpairButton() {
  return h('button', { className: 'secondary-btn', type: 'button', onClick: () => {
    if (!confirm('このスマホから鍵を削除します。再び見るには二次元コードを読み取り直してください。')) return;
    storageRemove(KEY_STORAGE);
    state.keys = null;
    state.snapshot = null;
    renderPairing();
  } }, 'このスマホとの連携を解除');
}

function renderDetail(meetingId) {
  const meeting = state.snapshot?.meetings.find((entry) => entry.id === meetingId);
  if (!meeting) { location.hash = ''; return; }
  setTopbar(meeting.title, `${meeting.typeEmoji || ''} ${meeting.typeName} · ${STATUS[meeting.status] || meeting.status}`, { back: true });
  const participants = new Map(meeting.participants.map((participant) => [participant.id, participant]));
  const latest = new Map();
  for (const message of meeting.messages) if (message.participantId && message.stance) latest.set(message.participantId, message.stance);
  const label = (participant) => participant ? `${participant.emoji} ${participant.name}` : '不明なAI';

  const sections = [
    h('section', { className: 'card' },
      h('div', { className: 'meeting-meta' }, `${projectName(meeting.projectId)} · 作成 ${formatTime(meeting.createdAt)}${meeting.endedAt ? ` · 終了 ${formatTime(meeting.endedAt)}` : ''}`),
      h('details', { open: !meeting.decision }, h('summary', {}, '議題'), markdown(meeting.agenda))),
  ];

  if (meeting.decision) {
    const decision = meeting.decision;
    sections.push(h('section', { className: 'card' },
      h('h2', {}, '決定'),
      h('div', { className: 'decision-text' }, markdown(decision.text)),
      h('div', { className: 'muted' }, formatTime(decision.decidedAt)),
      decision.overrideReason ? h('p', { className: 'muted' }, `議決条件は未達。人間の例外判断の理由: ${decision.overrideReason}`) : null,
      decision.reasoning.length ? h('ul', { className: 'list' }, decision.reasoning.map((reason) => h('li', {}, markdown(reason)))) : null));
    if (decision.actionItems.length) {
      sections.push(h('section', { className: 'card' },
        h('h2', {}, 'Action Item'),
        decision.actionItems.map((item) => h('div', { className: `action ${item.done ? 'done' : ''}` },
          h('span', { 'aria-label': item.done ? '完了' : '未完了' }, item.done ? '☑' : '☐'),
          h('div', { className: 'action-text' }, markdown(item.description)),
          h('span', { className: 'muted' }, item.assignee)))));
    }
    if (decision.stances.length) {
      sections.push(h('section', { className: 'card' },
        h('h2', {}, '決定時の各AIの立場'),
        decision.stances.map((entry) => h('div', { className: 'stance-row' },
          h('span', {}, label(participants.get(entry.participantId))),
          stanceChip(entry.stance) || h('span', { className: 'muted' }, '発言なし')))));
    }
  }

  sections.push(h('section', { className: 'card' },
    h('h2', {}, `参加者（${meeting.participants.length}）`),
    h('div', { className: 'participants' }, meeting.participants.map((participant) => h('div', { className: `participant ${participant.active ? '' : 'inactive'}` },
      avatar(participant.avatar, participant.name),
      h('span', { className: 'participant-name' }, participant.name),
      stanceChip(latest.get(participant.id)))))));

  sections.push(h('section', { className: 'card' },
    h('h2', {}, `発言（${meeting.messages.length}）`),
    meeting.messages.length ? meeting.messages.map((message) => {
      const participant = message.participantId ? participants.get(message.participantId) : null;
      const name = message.speaker === 'human' ? '👤 最高開発者' : message.speaker === 'system' ? '🗒 システム' : label(participant);
      const file = message.speaker === 'human' ? 'chief.png' : participant?.avatar;
      return h('article', { className: `message ${message.speaker}` },
        avatar(file, name),
        h('div', { className: 'message-body' },
          h('div', { className: 'message-head' },
            h('strong', {}, name),
            stanceChip(message.stance),
            h('span', { className: 'muted' }, `${ROUND[message.round] ? `${ROUND[message.round]} · ` : ''}${formatTime(message.createdAt)}`)),
          markdown(message.content)));
    }) : h('p', { className: 'muted' }, 'まだ発言がありません。')));

  app.replaceChildren(...sections);
  window.scrollTo(0, 0);
}

function render() {
  if (!state.keys) { renderPairing(); return; }
  const match = /^#\/m\/([A-Za-z0-9-]+)$/.exec(location.hash);
  if (match && state.snapshot) renderDetail(match[1]);
  else renderList();
}

async function refresh() {
  await loadSnapshot();
  render();
}

async function start() {
  readKeyFromHash();
  const key = storageGet(KEY_STORAGE);
  if (!key || !isShareKey(key)) { state.keys = null; render(); return; }
  try {
    state.keys = await deriveKeys(key);
  } catch {
    storageRemove(KEY_STORAGE);
    renderPairing('保存されていた鍵を読み込めませんでした。二次元コードを読み取り直してください。');
    return;
  }
  app.replaceChildren(h('p', { className: 'empty' }, '読み込み中…'));
  await refresh();
}

backBtn.addEventListener('click', () => { location.hash = ''; });
refreshBtn.addEventListener('click', () => { void refresh(); });
window.addEventListener('hashchange', () => {
  if (location.hash.startsWith('#k=')) { void start(); return; }
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.keys) void refresh();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

void start();

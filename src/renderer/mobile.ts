// @ts-nocheck
// スマホ閲覧（PWA）への暗号化同期の設定画面。
(() => {
  const api = window.api;
  const el = (id) => document.getElementById(id);
  const TOKEN_STATE = {
    secure: '同期トークンはOSの暗号化保存に保存済みです。',
    env: '同期トークンは環境変数 SIKUN_MOBILE_SYNC_TOKEN から読み込んでいます。',
    none: '同期トークンが未設定です。',
  };

  function showError(message) {
    el('mobile-error').textContent = message || '';
    el('mobile-error').classList.toggle('hidden', !message);
  }

  function render(view) {
    el('mobile-base-url').value = view.baseUrl || '';
    el('mobile-enabled').checked = view.enabled;
    el('mobile-token').value = '';
    el('mobile-token-state').textContent = TOKEN_STATE[view.tokenSource] || '';
    const status = view.status || {};
    el('mobile-status').textContent = [
      `自動同期: ${view.enabled ? '有効' : '無効'}`,
      `最終同期: ${status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString('ja-JP') : 'まだありません'}`,
      status.meetings !== undefined ? `送った会議: ${status.meetings}件${status.omitted ? `（容量のため古い${status.omitted}件を省略）` : ''} / ${Math.ceil((status.bytes || 0) / 1024)}KB` : '',
      status.error ? `エラー: ${status.error}` : '',
    ].filter(Boolean).join('\n');
    el('mobile-pairing').classList.toggle('hidden', !view.qr);
    if (view.qr) el('mobile-qr').src = view.qr;
    el('mobile-pairing-url').value = view.pairingUrl || '';
  }

  async function action(fn) {
    showError('');
    for (const id of ['mobile-save-btn', 'mobile-sync-btn', 'mobile-rotate-btn']) el(id).disabled = true;
    try { render(await fn()); }
    catch (error) { showError(error.message || String(error)); }
    finally { for (const id of ['mobile-save-btn', 'mobile-sync-btn', 'mobile-rotate-btn']) el(id).disabled = false; }
  }

  el('mobile-open-btn').addEventListener('click', () => {
    for (const panel of ['empty-state', 'new-meeting-form', 'meeting-view', 'project-view', 'commission-create', 'commission-view', 'community-view']) {
      el(panel).classList.add('hidden');
    }
    document.body.classList.remove('community-active', 'commission-active');
    document.body.classList.add('mobile-active');
    el('tb-title').textContent = 'スマホで会議を見る';
    el('tb-agenda').textContent = '';
    el('mobile-view').classList.remove('hidden');
    void action(() => api.mobile.get());
  });
  el('mobile-save-btn').addEventListener('click', () => action(() => api.mobile.configure({
    baseUrl: el('mobile-base-url').value,
    enabled: el('mobile-enabled').checked,
    token: el('mobile-token').value || undefined,
  })));
  el('mobile-sync-btn').addEventListener('click', () => action(() => api.mobile.syncNow()));
  el('mobile-rotate-btn').addEventListener('click', () => {
    if (!confirm('鍵を作り直すと、連携済みのスマホでは読めなくなります。続けますか？')) return;
    void action(() => api.mobile.rotateKey());
  });
  el('mobile-pairing-url').addEventListener('focus', (event) => event.target.select());
  // 他の画面へ切り替えて非表示になったら、会議パネルを隠す指定も外す。
  new MutationObserver(() => {
    if (el('mobile-view').classList.contains('hidden')) document.body.classList.remove('mobile-active');
  }).observe(el('mobile-view'), { attributes: true, attributeFilter: ['class'] });
})();

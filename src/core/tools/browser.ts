import * as fs from 'fs';
import { BrowserReviewSession } from '../commission/browserReview';
import type { Scope } from './docs';

/**
 * 画面系ツール。作業フォルダのローカルHTMLを、外部通信を遮断した分離ブラウザ（Chrome / Edge）で開く。
 * AIが書いたスクリプトは実行せず、ここで用意した検査（axe-core・レイアウト検査）だけを実行する。
 */

async function withPage<T>(scope: Scope, file: string, width: number, height: number, action: (session: BrowserReviewSession) => Promise<T>): Promise<T> {
  if (typeof file !== 'string' || !/\.html?$/i.test(file)) throw new Error('作業フォルダ内の .html / .htm を相対パスで指定してください');
  const session = new BrowserReviewSession(scope.workingDirectory, [], true);
  try {
    await session.start();
    await session.setViewport(width, height);
    await session.openPage(file);
    return await action(session);
  } finally {
    await session.close();
  }
}

const size = (value: unknown, fallback: number) => (value === undefined ? fallback : Number(value));

/** ページの画像。デザインの確認・修正前後の比較（compare_images と組み合わせる）に使う。 */
export async function screenshotPage(scope: Scope, file: string, widthInput?: unknown, heightInput?: unknown, fullPage = false) {
  const width = size(widthInput, 1280), height = size(heightInput, 800);
  return withPage(scope, file, width, height, async (session) => {
    const shot = await session.screenshot(Boolean(fullPage));
    const state = await session.runTrustedScript('({title:document.title,scrollWidth:document.documentElement.scrollWidth,innerWidth})');
    return { mcpContent: [
      { type: 'text', text: JSON.stringify({ file, viewport: { width, height }, image: { width: shot.width, height: shot.height, clippedAt8000px: shot.clipped }, title: state.title, horizontalScroll: state.scrollWidth > state.innerWidth }, null, 2) },
      { type: 'image', data: shot.data, mimeType: shot.mimeType },
    ] };
  });
}

/** axe-core（Deque、MPL-2.0）によるアクセシビリティ検査。WCAG 2.x の A / AA の規則に対する違反と、要確認項目を返す。 */
export async function auditAccessibility(scope: Scope, file: string, widthInput?: unknown) {
  const source = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  return withPage(scope, file, size(widthInput, 1280), 800, async (session) => {
    await session.runTrustedScript(`${source};void 0`);
    const result = await session.runTrustedScript(`axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice']},resultTypes:['violations','incomplete']}).then(r=>({
      violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,helpUrl:v.helpUrl,tags:v.tags.filter(t=>/^wcag/.test(t)),count:v.nodes.length,targets:v.nodes.slice(0,5).map(n=>({target:n.target.join(' '),summary:(n.failureSummary||'').slice(0,300)}))})),
      incomplete:r.incomplete.map(v=>({id:v.id,help:v.help,count:v.nodes.length})),
      passes:r.passes?r.passes.length:undefined,testEngine:r.testEngine.version}))`);
    return {
      file, engine: `axe-core ${result.testEngine}`, violationCount: result.violations.length,
      violations: result.violations, needsReview: result.incomplete,
      note: '自動検査で見つかるのは一部の問題だけ。キーボード操作・読み上げ・意味の妥当性は別に確認する',
    };
  });
}

const LAYOUT_SCRIPT = `(() => {
  const vw = innerWidth, docW = document.documentElement.scrollWidth;
  const sel = (e) => { if (e.id) return '#' + CSS.escape(e.id); let s = e.tagName.toLowerCase(); if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.'); return s; };
  const overflowing = [], clipped = [], smallTargets = [], smallText = [], noAlt = [];
  for (const e of [...document.body.querySelectorAll('*')].slice(0, 5000)) {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) overflowing.push({ selector: sel(e), left: Math.round(r.left), right: Math.round(r.right) });
    if ((cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && e.scrollWidth > e.clientWidth + 1 && e.textContent.trim()) clipped.push({ selector: sel(e), text: e.textContent.trim().slice(0, 60) });
    if (e.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[tabindex]:not([tabindex="-1"])') && (r.width < 24 || r.height < 24)) smallTargets.push({ selector: sel(e), width: Math.round(r.width), height: Math.round(r.height) });
    if ([...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12) smallText.push({ selector: sel(e), fontSize: cs.fontSize });
  }
  for (const img of document.images) if (!img.hasAttribute('alt')) noAlt.push(sel(img));
  return { viewportWidth: vw, documentWidth: docW, horizontalScroll: docW > vw + 1, overflowing: overflowing.slice(0, 30), clippedText: clipped.slice(0, 30), smallTapTargets: smallTargets.slice(0, 30), smallText: smallText.slice(0, 30), imagesWithoutAlt: noAlt.slice(0, 30) };
})()`;

/** 画面幅ごとに、横スクロール・はみ出す要素・切れた文字・小さすぎるタップ領域（24px未満）・12px未満の文字・alt のない画像を調べる。 */
export async function checkLayout(scope: Scope, file: string, widthsInput?: unknown) {
  const widths = Array.isArray(widthsInput) && widthsInput.length ? widthsInput.map(Number) : [375, 768, 1280];
  if (widths.length > 6 || widths.some((width) => !Number.isInteger(width) || width < 320 || width > 2560)) throw new Error('widths は320〜2560の整数を6個まで指定してください');
  return withPage(scope, file, widths[0], 800, async (session) => {
    const results = [];
    for (const width of widths) {
      await session.setViewport(width, 800);
      await new Promise((resolve) => setTimeout(resolve, 150));
      results.push(await session.runTrustedScript(LAYOUT_SCRIPT));
    }
    return { file, results, note: 'タップ領域の基準は WCAG 2.2 の 2.5.8（24×24 CSS px 以上）。文字サイズ12px未満は目安' };
  });
}

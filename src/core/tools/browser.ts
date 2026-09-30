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

const PATTERN_SCRIPT = `(() => {
  const sel = (e) => { if (e.id) return '#' + CSS.escape(e.id); let s = e.tagName.toLowerCase(); if (e.classList.length) s += '.' + [...e.classList].slice(0, 2).map((c) => CSS.escape(c)).join('.'); return s; };
  const emojiRe = /\\p{Emoji_Presentation}|\\p{Extended_Pictographic}\\uFE0F/gu;
  const visible = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const emoji = [], eyebrow = [], accents = [], numbered = [], gradients = [], animated = [], radii = new Map(), fonts = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && emoji.length < 50; n = walker.nextNode()) {
    const found = n.textContent.match(emojiRe);
    if (found && n.parentElement && visible(n.parentElement)) emoji.push({ selector: sel(n.parentElement), emoji: [...new Set(found)].join(' '), text: n.textContent.trim().slice(0, 60) });
  }
  const elements = [...document.body.querySelectorAll('*')].slice(0, 5000);
  for (const e of elements) {
    if (!visible(e)) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    for (const attr of ['aria-label', 'title', 'alt', 'placeholder']) { const v = e.getAttribute(attr); if (v && emojiRe.test(v)) emoji.push({ selector: sel(e), attribute: attr, text: v.slice(0, 60) }); emojiRe.lastIndex = 0; }
    for (const pseudo of ['::before', '::after']) { const c = getComputedStyle(e, pseudo).content; if (c && c !== 'none' && emojiRe.test(c)) emoji.push({ selector: sel(e) + pseudo, text: c.slice(0, 60) }); emojiRe.lastIndex = 0; }
    const text = [...e.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
    if (text) { const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); fonts.set(family, (fonts.get(family) || 0) + text.length); }
    if (text && text.length <= 40 && cs.textTransform === 'uppercase' && parseFloat(cs.letterSpacing) > 0) eyebrow.push({ selector: sel(e), text });
    if (/^0\\d[.)]?$/.test(text)) numbered.push({ selector: sel(e), text });
    if (/^H[1-3]$/.test(e.tagName)) {
      for (const child of e.querySelectorAll('span,em,strong,i,b,mark')) {
        const c = getComputedStyle(child);
        if (child.textContent.trim() && child.textContent.trim().length < e.textContent.trim().length && (c.color !== cs.color || c.fontStyle !== cs.fontStyle || c.backgroundImage !== 'none')) { accents.push({ selector: sel(e), accent: child.textContent.trim().slice(0, 30) }); break; }
      }
    }
    if (cs.backgroundImage.includes('gradient')) gradients.push({ selector: sel(e), value: cs.backgroundImage.slice(0, 120) });
    if (cs.animationName && cs.animationName !== 'none') animated.push({ selector: sel(e), animation: cs.animationName });
    const radius = cs.borderTopLeftRadius;
    if (parseFloat(radius) > 0 && r.width >= 120 && r.height >= 60 && (cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0)) radii.set(radius, (radii.get(radius) || 0) + 1);
  }
  const boxes = [...radii.values()].reduce((a, b) => a + b, 0);
  const [topRadius, topCount] = [...radii.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const totalText = [...fonts.values()].reduce((a, b) => a + b, 0) || 1;
  return {
    emoji: emoji.slice(0, 50),
    uppercaseLabels: eyebrow.slice(0, 30),
    headingPartialAccent: accents.slice(0, 20),
    numberedMarkers: numbered.slice(0, 20),
    gradients: gradients.slice(0, 20),
    animatedElements: { count: animated.length, examples: animated.slice(0, 10) },
    cardRadius: { boxes, mostCommon: topRadius || null, share: boxes ? Math.round(topCount / boxes * 100) : 0 },
    fonts: [...fonts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([family, chars]) => ({ family, sharePercent: Math.round(chars / totalText * 100) })),
  };
})()`;

/**
 * 絵文字と、題材に関係なく出やすい定番の型（同じ角丸カードの羅列・英大文字の小ラベル・見出しの一部だけの強調・
 * 01/02 番号・グラデーション・アニメーション）の有無と、使っている書体を調べる。良し悪しの判定はせず、所見を返す。
 */
export async function checkDesignPatterns(scope: Scope, file: string, widthInput?: unknown) {
  return withPage(scope, file, size(widthInput, 1280), 800, async (session) => {
    const found = await session.runTrustedScript(PATTERN_SCRIPT);
    return {
      file, ...found,
      note: '誤りの判定ではなく所見。絵文字は依頼者が求めた場合を除き、アイコン（SVGなど）か文言に置き換える。定番の型を残す場合は、この題材で必要な理由を仕様に書く',
    };
  });
}

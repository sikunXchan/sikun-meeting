// @ts-nocheck
// AIの発言をMarkdownから変換したHTMLを、許可した要素と属性だけに整える。
(() => {
  const DROP_WITH_CONTENT = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'SVG', 'MATH',
    'TEMPLATE', 'FORM', 'TEXTAREA', 'SELECT', 'BUTTON', 'LINK', 'META', 'BASE', 'NOSCRIPT', 'AUDIO', 'VIDEO', 'SOURCE', 'PORTAL']);
  const ALLOWED = {
    P: [], BR: [], HR: [], STRONG: [], B: [], EM: [], I: [], DEL: [], S: [], SUB: [], SUP: [],
    CODE: ['class'], PRE: ['class'], BLOCKQUOTE: [], UL: [], OL: ['start'], LI: [],
    H1: [], H2: [], H3: [], H4: [], H5: [], H6: [], TABLE: [], THEAD: [], TBODY: [], TR: [],
    TH: ['align'], TD: ['align'], A: ['href', 'title'], SPAN: [], DIV: [],
    INPUT: ['type', 'checked', 'disabled'], IMG: ['src', 'alt'],
  };

  function safeHref(value) {
    const href = value.trim();
    if (href.startsWith('#')) return true;
    try {
      return ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol);
    } catch {
      return false;
    }
  }

  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.COMMENT_NODE) { child.remove(); continue; }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.tagName.toUpperCase();
      if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
      const allowed = ALLOWED[tag];
      if (!allowed) {
        clean(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attribute of [...child.attributes]) {
        const name = attribute.name.toLowerCase();
        if (!allowed.includes(name)) child.removeAttribute(attribute.name);
      }
      if (tag === 'A') {
        if (child.hasAttribute('href') && !safeHref(child.getAttribute('href'))) child.removeAttribute('href');
        child.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'IMG' && !/^data:image\/(png|jpeg|gif|webp);/i.test(child.getAttribute('src') || '')) { child.remove(); continue; }
      if (tag === 'INPUT' && child.getAttribute('type') !== 'checkbox') { child.remove(); continue; }
      if (tag === 'INPUT') child.setAttribute('disabled', '');
      clean(child);
    }
  }

  window.sanitizeHtml = (html) => {
    const template = document.createElement('template');
    template.innerHTML = html;
    clean(template.content);
    return template.innerHTML;
  };
})();

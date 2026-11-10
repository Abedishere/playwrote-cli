// Injected into the page on every call. Must be self-contained (serialized with toString).
// Installs window.__web. Refs live in the DOM as data-aref="eN" so they survive between CLI calls.
module.exports = function install() {
  const W = (window.__web = window.__web || {});
  W.n = W.n || 0;

  const STRONG = 'a[href],button,input:not([type=hidden]),select,textarea,summary,' +
    '[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],' +
    '[role=option],[role=switch],[role=textbox],[role=combobox],[role=searchbox],' +
    '[contenteditable=""],[contenteditable=true]';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'SVG', 'svg', 'CANVAS', 'PATH']);
  const STRUCT = 'h1,h2,h3,h4,h5,h6,table,ul,ol,form,nav,main,header,footer,aside,dialog,[role=dialog],iframe,li';
  const LANDMARK = { NAV: 'nav', MAIN: 'main', HEADER: 'header', FOOTER: 'footer', ASIDE: 'aside', FORM: 'form', DIALOG: 'dialog' };
  const FOLD_MIN = 8, FOLD_SHOW = 5;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function visible(el) {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    if (el.checkVisibility) {
      if (el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return true;
      return getComputedStyle(el).display === 'contents';
    }
    return !!(el.offsetParent || el.getClientRects().length);
  }

  function ref(el) {
    if (!el.dataset.aref) el.dataset.aref = 'e' + ++W.n;
    return el.dataset.aref;
  }

  function strong(el) { return el.matches(STRONG); }

  function interactive(el) {
    if (strong(el)) return true;
    const weak = el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex')) ||
      (getComputedStyle(el).cursor === 'pointer' && (!el.parentElement || getComputedStyle(el.parentElement).cursor !== 'pointer'));
    if (!weak) return false;
    if (el === document.body || el === document.documentElement) return false;
    if ((el.textContent || '').length > 200) return false;
    return !el.querySelector(STRONG); // weak wrapper around real controls: descend instead
  }

  function role(el) {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName;
    if (t === 'A') return 'link';
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button';
    if (t === 'SELECT') return 'combobox';
    if (t === 'TEXTAREA') return 'textbox';
    if (t === 'INPUT') {
      const ty = (el.type || 'text').toLowerCase();
      if (['submit', 'button', 'reset', 'image'].includes(ty)) return 'button';
      if (ty === 'checkbox' || ty === 'radio') return ty;
      return ty === 'text' ? 'textbox' : 'textbox:' + ty;
    }
    if (el.isContentEditable) return 'textbox';
    return 'clickable';
  }

  function name(el) {
    let n = el.getAttribute('aria-label');
    if (!n && el.getAttribute('aria-labelledby')) {
      n = el.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
    }
    if (!n && el.labels && el.labels[0]) n = el.labels[0].innerText;
    if (!n && el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type)) n = el.value;
    if (!n && !['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) n = el.innerText;
    if (!n) n = el.getAttribute('alt') || el.querySelector?.('img[alt]')?.alt || el.title || el.placeholder || '';
    return clip(clean(n), 60);
  }

  function tok(el) {
    const r = role(el);
    let s = `[${ref(el)} ${r} "${name(el)}"`;
    if (r === 'checkbox' || r === 'radio') s += el.checked ? ' [x]' : ' [ ]';
    else if (el.tagName === 'SELECT') s += ` ="${clip(clean(el.selectedOptions[0]?.text || ''), 40)}"`;
    else if (r.startsWith('textbox')) s += ` ="${clip(el.isContentEditable ? clean(el.innerText) : el.value || '', 40)}"`;
    if (el.disabled) s += ' disabled';
    if (el.tagName === 'A' && el.getAttribute('href') && !name(el)) s += ' ' + clip(el.getAttribute('href'), 50);
    return s + ']';
  }

  // One-line rendering of a small subtree: text plus [ref] tokens in document order.
  function inline(root) {
    const parts = [];
    (function walk(n) {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { const t = clean(c.nodeValue); if (t) parts.push(clip(t, 120)); continue; }
        if (c.nodeType !== 1 || SKIP.has(c.tagName) || !visible(c)) continue;
        if (interactive(c)) parts.push(tok(c));
        else walk(c);
      }
    })(root);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function leaf(el) {
    if ((el.textContent || '').length > 200) return false;
    if (el.querySelectorAll(STRONG).length > 6) return false;
    return !el.querySelector(STRUCT);
  }

  function landmark(el) {
    const r = el.getAttribute('role');
    let k = LANDMARK[el.tagName] || (r && ['navigation', 'main', 'dialog', 'search', 'banner', 'contentinfo', 'form'].includes(r) ? r : null);
    if (!k) return null;
    const lab = el.getAttribute('aria-label') || el.getAttribute('name') || '';
    return lab ? `${k} "${clip(clean(lab), 40)}"` : k;
  }

  function render(el, depth, out, o) {
    if (SKIP.has(el.tagName) || !visible(el)) return;
    const ind = '  '.repeat(depth);
    if (interactive(el)) { out.push(ind + tok(el)); return; }
    const h = /^H([1-6])$/.exec(el.tagName);
    if (h) { const t = inline(el); if (t) out.push(ind + '#'.repeat(+h[1]) + ' ' + t); return; }
    if (el.tagName === 'IFRAME') { out.push(ind + `iframe "${clip(el.src || '', 80)}"`); return; }
    // data table = no nested tables and every cell small; anything else is a layout table, walk it like divs
    if (el.tagName === 'TABLE' && !el.querySelector('table') && [...el.querySelectorAll('td,th')].every(leaf)) {
      const rows = [...el.rows];
      out.push(ind + `table ${rows.length}x${rows[0]?.cells.length || 0}:`);
      seq(rows, depth + 1, out, o, el, (row) => {
        const t = [...row.cells].map((c) => inline(c)).join(' | ');
        if (/[\p{L}\p{N}]/u.test(t)) out.push('  '.repeat(depth + 1) + '| ' + t);
      });
      return;
    }
    const lm = landmark(el);
    if (lm) { out.push(ind + lm + ':'); children(el, depth + 1, out, o); return; }
    if (leaf(el)) { const t = inline(el); if (t) out.push(ind + (el.tagName === 'LI' ? '- ' : '') + t); return; }
    children(el, depth + (el.tagName === 'UL' || el.tagName === 'OL' ? 1 : 0), out, o);
  }

  // Walk children; fold runs of repeated sibling shapes. Period 1-3 catches alternating rows
  // like story/subtext/spacer. ponytail: fixed periods, a real pattern finder if sites need longer cycles.
  function children(el, depth, out, o) {
    const ind = '  '.repeat(depth);
    const ns = [...el.childNodes].filter((c) => c.nodeType === 1 ? !SKIP.has(c.tagName) : c.nodeType === 3 && /[\p{L}\p{N}]/u.test(c.nodeValue));
    seq(ns, depth, out, o, el, (c) => (c.nodeType === 3 ? out.push(ind + clip(clean(c.nodeValue), 200)) : render(c, depth, out, o)));
  }

  function seq(ns, depth, out, o, parent, draw) {
    const ind = '  '.repeat(depth);
    const sg = ns.map((c) => (c.nodeType === 1 ? sig(c) : null));
    for (let i = 0; i < ns.length;) {
      let fold = null;
      for (let p = 1; p <= 3 && !o.nofold && !fold; p++) {
        const SHOW = o.show || FOLD_SHOW;
        if (sg.slice(i, i + p).some((s) => s === null)) break;
        let reps = 1;
        while (i + (reps + 1) * p <= ns.length && sg.slice(i + reps * p, i + (reps + 1) * p).every((s, k) => s === sg[i + k])) reps++;
        if (reps >= Math.max(FOLD_MIN, SHOW + 3)) fold = { p, reps, show: SHOW };
      }
      if (fold) {
        ns.slice(i, i + fold.show * fold.p).forEach(draw);
        out.push(ind + `…+${fold.reps - fold.show} similar (web page --expand ${ref(parent)})`);
        i += fold.reps * fold.p;
        continue;
      }
      draw(ns[i++]);
    }
  }

  const sig = (el) => el.tagName + '.' + (typeof el.className === 'string' ? el.className : '');

  function resolve(r) {
    const el = document.querySelector(`[data-aref="${r}"]`);
    if (!el) throw new Error(`stale ref ${r}, run web find or web page again`);
    return el;
  }

  function regionRoot(o) {
    if (o.sel) { const e = document.querySelector(o.sel); if (!e) throw new Error('no element matches --sel ' + o.sel); return e; }
    const r = o.expand || o.region;
    if (!r) return document.body;
    if (/^e\d+$/.test(r)) return resolve(r);
    const map = { main: 'main,[role=main]', nav: 'nav,[role=navigation]', form: 'form', dialog: 'dialog[open],[role=dialog]', header: 'header', footer: 'footer' };
    const e = [...document.querySelectorAll(map[r] || r)].find(visible);
    if (!e) throw new Error('no visible region ' + r);
    return e;
  }

  W.page = (o) => {
    o = o || {};
    if (o.expand) o.nofold = true;
    if (o.raw) o.nofold = true;
    const root = regionRoot(o);
    const max = o.raw ? Infinity : o.max || 8000;
    const draw = (opts) => { const out = []; root === document.body ? children(root, 0, out, opts) : render(root, 0, out, opts); return out; };
    // whole page if it fits the budget; fold repeats only when it doesn't
    let out = o.nofold ? draw(o) : draw({ ...o, nofold: true });
    // over budget: show as many repeats per group as still fit
    if (!o.nofold && out.join('\n').length > max) {
      for (const show of [40, 20, 10, 5]) { out = draw({ ...o, show }); if (out.join('\n').length <= max) break; }
    }
    let lines = out;
    if (o.interactive) lines = lines.filter((l) => l.includes('[e') || /^\s*#/.test(l) || /:$/.test(l) || l.includes('similar (web'));
    if (o.lines) lines = lines.slice(0, o.lines);
    let s = lines.join('\n');
    if (s.length > max) {
      const total = s.length;
      s = s.slice(0, max) + `\n…truncated, ${Math.round(total / 100) / 10}k chars total. Narrow with --region main|nav|form|<ref>, --sel <css>, or --max N`;
    } else if (o.lines && out.length > o.lines) s += `\n…+${out.length - o.lines} lines (web page)`;
    return `@ ${clip(location.href, 150)} "${clip(clean(document.title), 80)}"\n` + (s || '(empty page)');
  };

  W.find = (q) => {
    let r = null, txt = q.toLowerCase();
    const m = /^([a-z]+):(.*)$/.exec(q); // button:Send, textbox:, link:Home
    if (m && !q.startsWith('http')) { r = m[1]; txt = m[2].toLowerCase(); }
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      if (SKIP.has(el.tagName) || !interactive(el) || !visible(el)) continue;
      if (r && !role(el).startsWith(r)) continue;
      const hay = (name(el) + ' ' + (el.placeholder || '') + ' ' + (el.title || '') + ' ' + (el.id || '')).toLowerCase();
      if (hay.includes(txt)) hits.push(tok(el));
      if (hits.length >= 30) break;
    }
    if (hits.length || r) return hits.join('\n') || 'no match';
    // fall back to the smallest visible elements whose text contains q
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode() && hits.length < 15) {
      const n = walker.currentNode, el = n.parentElement;
      if (!el || seen.has(el) || SKIP.has(el.tagName) || !n.nodeValue.toLowerCase().includes(txt) || !visible(el)) continue;
      seen.add(el);
      hits.push(`[${ref(el)} text "${clip(clean(el.innerText), 80)}"]`);
    }
    return hits.join('\n') || 'no match';
  };

  W.point = (r) => {
    const el = resolve(r);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const b = el.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const hit = document.elementFromPoint(x, y);
    const ok = hit && (hit === el || el.contains(hit) || hit.contains(el) && hit !== document.body);
    return { x, y, covered: ok ? null : hit ? hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') : 'offscreen', w: b.width, h: b.height };
  };
  W.jsclick = (r) => { resolve(r).click(); return true; };
  W.focus = (r, clear) => {
    const el = resolve(r);
    el.scrollIntoView({ block: 'center' });
    el.focus();
    if (clear) {
      if ('value' in el && el.tagName !== 'SELECT') { el.select?.(); }
      else if (el.isContentEditable) { const s = getSelection(); s.selectAllChildren(el); }
    }
    return document.activeElement === el || el.contains(document.activeElement);
  };
  W.select = (r, v) => {
    const el = resolve(r);
    if (el.tagName !== 'SELECT') throw new Error(r + ' is not a <select>, click it and pick the option ref instead');
    const opt = [...el.options].find((x) => clean(x.text) === v || x.value === v) ||
      [...el.options].find((x) => clean(x.text).toLowerCase().includes(v.toLowerCase()));
    if (!opt) throw new Error('no option "' + v + '", options: ' + [...el.options].map((x) => clean(x.text)).join(' | ').slice(0, 300));
    el.value = opt.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return clean(opt.text);
  };
  // file inputs are usually hidden behind a styled button, so accept the button/label/dropzone ref too
  W.fileInput = (r) => {
    const isFile = (e) => e && e.tagName === 'INPUT' && e.type === 'file';
    if (!r) {
      const all = document.querySelectorAll('input[type=file]');
      if (all.length === 1) return all[0];
      throw new Error(all.length ? `${all.length} file inputs on page, pass the ref of the upload button` : 'no file input on page');
    }
    const el = resolve(r);
    const hit = [el, el.control, el.querySelector('input[type=file]'), el.closest('label')?.control,
      ...(el.parentElement?.children || [])].find(isFile); // direct siblings only: a wider search grabs unrelated inputs
    return hit || null; // null = caller drops the files onto the element instead
  };
  W.rect = (r) => {
    const el = resolve(r);
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    return { x: b.left + scrollX, y: b.top + scrollY, width: Math.max(1, b.width), height: Math.max(1, b.height) };
  };
  W.scroll = (a) => {
    if (/^e\d+$/.test(a)) { resolve(a).scrollIntoView({ block: 'center' }); return 'ok'; }
    const dy = (a === 'up' ? -1 : 1) * innerHeight * 0.8;
    // scroll the biggest scrollable container if the window itself can't move
    const before = scrollY;
    scrollBy(0, dy);
    if (scrollY !== before) return `ok ${Math.round(scrollY)}/${document.documentElement.scrollHeight - innerHeight}`;
    const sc = [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY) && visible(e))
      .sort((a, b) => b.clientHeight * b.clientWidth - a.clientHeight * a.clientWidth)[0];
    if (!sc) return 'ok (nothing to scroll)';
    sc.scrollBy(0, dy);
    return `ok inner ${Math.round(sc.scrollTop)}/${sc.scrollHeight - sc.clientHeight}`;
  };
  W.has = (q) => {
    if (q.startsWith('url:')) return location.href.includes(q.slice(4));
    if (q.startsWith('gone:')) return !document.body.innerText.includes(q.slice(5));
    if (/^e\d+$/.test(q)) { const el = document.querySelector(`[data-aref="${q}"]`); return !!el && visible(el); }
    return document.body.innerText.includes(q);
  };
};

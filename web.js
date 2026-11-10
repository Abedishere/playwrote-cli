#!/usr/bin/env node
// web: token-lean browser CLI for agents. Drives Opera GX / Chrome / Edge over CDP.
// Docs: README.md next to this file. No dependencies, Node 22+.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const LIB = require('./pagelib.js').toString();

const HOME = os.homedir();
const STATE = path.join(HOME, '.web-cli', 'state.json');
const PROFILES = path.join(HOME, '.web-cli', 'profiles');
const L = process.env.LOCALAPPDATA || '';
const BROWSERS = {
  opera: { port: 9222, exe: [path.join(L, 'Programs', 'Opera GX', 'opera.exe'), path.join(L, 'Programs', 'Opera', 'opera.exe')] },
  chrome: { port: 9223, exe: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', path.join(L, 'Google', 'Chrome', 'Application', 'chrome.exe')] },
  edge: { port: 9224, exe: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'] },
};
const BOOL = new Set(['enter', 'clear', 'raw', 'quiet', 'interactive', 'i', 'all', 'minimized']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

class Fail extends Error {}

// ---------- state ----------
function loadState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { browser: 'opera', tabs: {} }; } }
function saveState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(s, null, 1)); }

// ---------- args ----------
function parse(argv) {
  const pos = [], fl = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const k = a.slice(2);
      if (BOOL.has(k)) fl[k] = true; else fl[k] = argv[++i];
    } else pos.push(a);
  }
  return { pos, fl };
}
function tokenize(line) {
  const out = [], re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

// ---------- CDP ----------
class CDP {
  static connect(url) {
    return new Promise((res, rej) => {
      const c = new CDP(); c.ws = new WebSocket(url); c.id = 0; c.wait = new Map(); c.subs = [];
      c.ws.onopen = () => res(c);
      c.ws.onerror = () => rej(new Fail('cannot connect to tab websocket ' + url));
      c.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id && c.wait.has(m.id)) { const [ok, no] = c.wait.get(m.id); c.wait.delete(m.id); m.error ? no(new Fail(m.error.message)) : ok(m.result); }
        else if (m.method) c.subs.forEach((f) => f(m));
      };
      c.ws.onclose = () => { for (const [, [, no]] of c.wait) no(new Fail('tab connection closed')); c.wait.clear(); };
    });
  }
  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.wait.delete(id); no(new Fail(method + ' timed out')); }, timeout);
      this.wait.set(id, [(r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); no(e); }]);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------- browser ----------
async function http(port, p, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, signal: AbortSignal.timeout(3000) });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}
async function alive(port) { try { await http(port, '/json/version'); return true; } catch { return false; } }

async function up(b, quiet) {
  const B = BROWSERS[b];
  if (!B) throw new Fail(`unknown browser ${b}, use opera|chrome|edge`);
  if (await alive(B.port)) return quiet ? null : `up ${b} :${B.port}`;
  const exe = B.exe.find((e) => fs.existsSync(e));
  if (!exe) throw new Fail(`${b} not installed (looked in ${B.exe.join(', ')})`);
  const prof = path.join(PROFILES, b);
  fs.mkdirSync(prof, { recursive: true });
  spawn(exe, [`--remote-debugging-port=${B.port}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', 'about:blank'],
    { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) { await sleep(250); if (await alive(B.port)) return `up ${b} :${B.port} (started, profile ${prof})`; }
  throw new Fail(`${b} started but port ${B.port} never opened. If ${b} was already running without the debug flag on this profile, close that window and retry`);
}

// Copy logins (cookies, saved passwords, site storage) from the user's real profile into the agent profile.
// The real browser must be closed: Chromium holds the cookie DB open exclusively.
// ponytail: a snapshot, not a live share. Re-run when a new login is needed.
const REAL = {
  opera: path.join(process.env.APPDATA || '', 'Opera Software', 'Opera GX Stable'),
  chrome: path.join(L, 'Google', 'Chrome', 'User Data'),
  edge: path.join(L, 'Microsoft', 'Edge', 'User Data'),
};
const CLONE_ITEMS = ['Network', 'Local Storage', 'IndexedDB', 'Session Storage', 'WebStorage', 'Login Data', 'Login Data For Account',
  'Web Data', 'Preferences', 'Secure Preferences', 'Extensions', 'Local Extension Settings', 'Extension State', 'Bookmarks'];
async function clone(b) {
  const src = REAL[b];
  if (!src || !fs.existsSync(path.join(src, 'Local State'))) throw new Fail(`no real ${b} profile at ${src}`);
  const exe = BROWSERS[b].exe.find((e) => fs.existsSync(e));
  // the agent instance uses the same exe; shut it down cleanly first
  if (await alive(BROWSERS[b].port)) {
    const v = await http(BROWSERS[b].port, '/json/version');
    const c = await CDP.connect(v.webSocketDebuggerUrl); await c.send('Browser.close').catch(() => {}); c.close();
    for (let i = 0; i < 20 && (await alive(BROWSERS[b].port)); i++) await sleep(250);
    await sleep(1500);
  }
  const still = require('child_process').execSync(`powershell -NoProfile -Command "@(Get-Process | ? { $_.Path -eq '${exe}' }).Count"`).toString().trim();
  if (+still > 0) throw new Fail(`close your ${b} window first (${still} processes running; cookies are locked while it is open). Then rerun web clone ${b}`);
  const dst = path.join(PROFILES, b);
  fs.mkdirSync(path.join(dst, 'Default'), { recursive: true });
  fs.copyFileSync(path.join(src, 'Local State'), path.join(dst, 'Local State')); // holds the cookie encryption key
  const copied = [];
  for (const it of CLONE_ITEMS) {
    const s = path.join(src, 'Default', it), d = path.join(dst, 'Default', it);
    if (!fs.existsSync(s)) continue;
    fs.rmSync(d, { recursive: true, force: true });
    fs.cpSync(s, d, { recursive: true, force: true, filter: (f) => !f.endsWith('.tmp') && !f.includes('LOCK') });
    copied.push(it);
  }
  const st = loadState(); if (st.tabs) delete st.tabs[b]; saveState(st);
  return `ok cloned ${copied.length} items from ${src}. Reopen your ${b} now; the agent one starts on next web call`;
}

async function pages(port) { return (await http(port, '/json/list')).filter((t) => t.type === 'page'); }
async function newTab(port, url = 'about:blank') {
  let t = await http(port, '/json/new?' + encodeURI(url), 'PUT');
  if (typeof t === 'string') t = await http(port, '/json/new?' + encodeURI(url)); // old builds want GET
  if (!t.id) throw new Fail('could not open a tab: ' + t);
  return t;
}

// ---------- context: one connected tab ----------
class Ctx {
  constructor(st, b) { this.st = st; this.b = b; this.port = BROWSERS[b].port; this.c = null; this.tab = null; }
  async attach(tabArg) {
    await up(this.b, true);
    const list = await pages(this.port);
    let t;
    if (tabArg) {
      t = list.find((p) => p.id.toLowerCase().startsWith(tabArg.toLowerCase()));
      if (!t) throw new Fail(`no tab ${tabArg}, run web tabs`);
    } else {
      t = list.find((p) => p.id === this.st.tabs[this.b]);
      if (!t) { t = await newTab(this.port); this.st.tabs[this.b] = t.id; saveState(this.st); }
    }
    await this.connect(t);
  }
  async connect(t) {
    this.close();
    this.tab = t;
    this.c = await CDP.connect(t.webSocketDebuggerUrl);
    await this.c.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  }
  close() { if (this.c) this.c.close(); this.c = null; }
  async ev(expr, timeout) {
    for (let i = 0; ; i++) {
      try {
        const r = await this.c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, timeout);
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          throw new Fail(clip(((d.exception && (d.exception.description || d.exception.value)) || d.text || 'error').split('\n')[0].replace(/^Error: /, ''), 300));
        }
        return r.result.value;
      } catch (e) {
        // context destroyed mid-navigation: retry a couple of times
        if (i < 3 && /context|Cannot find|navigat/i.test(e.message)) { await sleep(400); continue; }
        throw e;
      }
    }
  }
  lib(fn, ...args) { return this.ev(`(${LIB})(), window.__web.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`); }
  async settle(max = 5000) {
    await sleep(150);
    const end = Date.now() + max;
    while (Date.now() < end) {
      try { if ((await this.ev('document.readyState', 2000)) === 'complete') break; } catch {}
      await sleep(150);
    }
    await sleep(100);
  }
  url() { return this.ev('location.href').catch(() => '?'); }
}

// ---------- keys ----------
const KEYS = { Enter: [13, 'Enter', '\r'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'],
  ArrowUp: [38, 'ArrowUp'], ArrowDown: [40, 'ArrowDown'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
  PageUp: [33, 'PageUp'], PageDown: [34, 'PageDown'], Home: [36, 'Home'], End: [35, 'End'], Space: [32, 'Space', ' '] };
const MODS = { Alt: 1, Control: 2, Ctrl: 2, Meta: 4, Shift: 8 };
async function press(ctx, combo) {
  const parts = combo.split('+'); const k = parts.pop();
  let mod = 0; for (const p of parts) { if (!(p in MODS)) throw new Fail('unknown modifier ' + p); mod |= MODS[p]; }
  let vk, code, text;
  if (KEYS[k]) [vk, code, text] = KEYS[k];
  else if (k.length === 1) { const u = k.toUpperCase(); vk = u.charCodeAt(0); code = /[A-Z]/.test(u) ? 'Key' + u : /\d/.test(k) ? 'Digit' + k : ''; text = k; }
  else throw new Fail(`unknown key ${k}, use Enter Tab Escape Backspace Delete Arrow* Page* Home End Space or one character`);
  if (mod & ~8) text = undefined; // no text when Ctrl/Alt/Meta held
  const base = { key: KEYS[k] ? KEYS[k][1].replace('Space', ' ') : k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod };
  await ctx.c.send('Input.dispatchKeyEvent', { ...base, type: text ? 'keyDown' : 'rawKeyDown', text });
  await ctx.c.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
}

// ---------- commands ----------
const isRef = (r) => /^e\d+$/.test(r || '');
function needRef(r, cmd) { if (!isRef(r)) throw new Fail(`${cmd} needs a ref like e12 (get one from web page or web find)`); return r; }

async function afterAction(ctx, before) {
  await ctx.settle(4000);
  const now = await ctx.url();
  return now !== before ? `ok -> ${now}` : 'ok';
}

const pageOpts = (fl) => ({ region: fl.region, sel: fl.sel, expand: fl.expand, raw: fl.raw, interactive: fl.interactive || fl.i, max: fl.max ? +fl.max : undefined });

const CMDS = {
  async goto(ctx, [url], fl) {
    if (!url) throw new Fail('goto needs a url');
    if (!/^[a-z]+:/i.test(url)) url = 'https://' + url;
    const r = await ctx.c.send('Page.navigate', { url });
    if (r.errorText) throw new Fail(`navigation failed: ${r.errorText}`);
    await ctx.settle(+(fl.t || 20) * 1000);
    if (fl.quiet) { const [u, t] = await Promise.all([ctx.url(), ctx.ev('document.title')]); return `ok ${u} "${clip(t, 80)}"`; }
    return 'ok ' + (await ctx.lib('page', { lines: 40 })).slice(2);
  },
  async open(ctx, [url], fl) {
    const t = await newTab(ctx.port);
    ctx.st.tabs[ctx.b] = t.id; saveState(ctx.st);
    await ctx.connect(t);
    return url ? CMDS.goto(ctx, [url], fl) : `ok new tab ${t.id.slice(0, 6)}`;
  },
  async back(ctx) { const b = await ctx.url(); await ctx.ev('history.back()'); return afterAction(ctx, b); },
  async reload(ctx) { await ctx.c.send('Page.reload'); await ctx.settle(15000); return 'ok'; },
  async page(ctx, _, fl) { return ctx.lib('page', pageOpts(fl)); },
  async snap(ctx, _, fl) { return ctx.lib('page', { ...pageOpts(fl), interactive: true }); },
  async find(ctx, pos) { if (!pos.length) throw new Fail('find needs text or role:text'); return ctx.lib('find', pos.join(' ')); },
  async text(ctx, _, fl) {
    const t = await ctx.ev(`(()=>{const e=${fl.sel ? `document.querySelector(${JSON.stringify(fl.sel)})` : 'document.body'};return e?e.innerText:null})()`);
    if (t == null) throw new Fail('no element matches --sel ' + fl.sel);
    const s = t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(), max = +(fl.max || 4000);
    return s.length > max ? s.slice(0, max) + `\n…+${Math.round((s.length - max) / 100) / 10}k chars (--max N)` : s || '(no text)';
  },
  async click(ctx, [r]) {
    needRef(r, 'click');
    const before = await ctx.url();
    const p = await ctx.lib('point', r);
    if (p.covered || !p.w) {
      await ctx.lib('jsclick', r);
      return (await afterAction(ctx, before)) + ` (js click, element ${p.w ? 'covered by ' + p.covered : 'has no size'})`;
    }
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await ctx.c.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    return afterAction(ctx, before);
  },
  async type(ctx, [r, ...rest], fl) {
    needRef(r, 'type');
    const text = rest.join(' ');
    if (!(await ctx.lib('focus', r, !!fl.clear))) throw new Fail(`${r} did not take focus, click it first`);
    if (fl.clear) await press(ctx, 'Backspace');
    if (text) await ctx.c.send('Input.insertText', { text });
    if (fl.enter) { const b = await ctx.url(); await press(ctx, 'Enter'); return afterAction(ctx, b); }
    return 'ok';
  },
  async select(ctx, [r, ...v]) { needRef(r, 'select'); return 'ok ' + (await ctx.lib('select', r, v.join(' '))); },
  async upload(ctx, args) {
    const r = isRef(args[0]) ? args.shift() : null;
    if (!args.length) throw new Fail('upload needs file paths: web upload [ref] <file> [file...]');
    const files = args.map((f) => path.resolve(f));
    const missing = files.find((f) => !fs.statSync(f, { throwIfNoEntry: false })?.isFile());
    if (missing) throw new Fail('no such file ' + missing);
    const res = await ctx.c.send('Runtime.evaluate', { expression: `(${LIB})(), window.__web.fileInput(${JSON.stringify(r)})` });
    if (res.exceptionDetails) throw new Fail((res.exceptionDetails.exception?.description || 'error').split('\n')[0].replace(/^Error: /, ''));
    const { objectId } = res.result;
    if (files.length > 1 && !(await ctx.c.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){return this.multiple}', returnByValue: true })).result.value)
      throw new Fail('this file input takes one file');
    await ctx.c.send('DOM.setFileInputFiles', { objectId, files }); // fires input + change like a real pick
    return `ok ${files.length} file${files.length > 1 ? 's' : ''}: ${files.map((f) => path.basename(f)).join(', ')}`;
  },
  async key(ctx, [k]) { if (!k) throw new Fail('key needs a key, e.g. Enter or Control+a'); const b = await ctx.url(); await press(ctx, k); return afterAction(ctx, b); },
  async hover(ctx, [r]) { const p = await ctx.lib('point', needRef(r, 'hover')); await ctx.c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y }); return 'ok'; },
  async scroll(ctx, [a = 'down']) { return ctx.lib('scroll', a); },
  async wait(ctx, pos, fl) {
    const q = pos.join(' ');
    if (!q) throw new Fail('wait needs text, a ref, url:<part> or gone:<text>');
    const end = Date.now() + +(fl.t || 10) * 1000;
    while (Date.now() < end) { try { if (await ctx.lib('has', q)) return 'ok'; } catch {} await sleep(250); }
    throw new Fail(`timeout after ${fl.t || 10}s waiting for ${q}`);
  },
  async eval(ctx, pos) {
    const v = await ctx.ev(pos.join(' '));
    const s = v === undefined ? 'undefined' : typeof v === 'string' ? v : JSON.stringify(v);
    return clip(s, 4000);
  },
  async shot(ctx, [r], fl) {
    const params = { format: 'png' };
    if (r) params.clip = { ...(await ctx.lib('rect', needRef(r, 'shot'))), scale: 1 };
    // minimized windows produce no frames, so capture would hang: restore briefly, then re-minimize
    let win = null;
    try {
      const w = await ctx.c.send('Browser.getWindowForTarget', { targetId: ctx.tab.id });
      if (w.bounds.windowState === 'minimized') { win = w.windowId; await ctx.c.send('Browser.setWindowBounds', { windowId: win, bounds: { windowState: 'normal' } }); await sleep(400); }
    } catch {}
    let data;
    try { ({ data } = await ctx.c.send('Page.captureScreenshot', params, 15000)); }
    finally { if (win) await ctx.c.send('Browser.setWindowBounds', { windowId: win, bounds: { windowState: 'minimized' } }).catch(() => {}); }
    const out = fl.o || path.join(os.tmpdir(), `web-shot-${Date.now()}.png`);
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    return out;
  },
  async net(ctx, _, fl) {
    const rows = await ctx.ev(`performance.getEntriesByType('resource').slice(-${+(fl.n || 30) * 3}).map(e=>[e.responseStatus||0,e.initiatorType,e.transferSize,Math.round(e.duration),e.name])`);
    const f = fl.filter;
    const lines = rows.filter((r) => !f || r[4].includes(f)).slice(-(+(fl.n || 30)))
      .map(([s, t, sz, ms, u]) => `${s || '---'} ${t} ${sz > 1024 ? (sz / 1024).toFixed(1) + 'kb' : sz + 'b'} ${ms}ms ${clip(u, 120)}`);
    return lines.join('\n') || 'no requests';
  },
  async console(ctx, _, fl) {
    const msgs = [];
    ctx.c.subs.push((m) => {
      if (m.method === 'Runtime.consoleAPICalled') msgs.push([m.params.type, m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')]);
      if (m.method === 'Runtime.exceptionThrown') msgs.push(['exception', m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text]);
      if (m.method === 'Log.entryAdded') msgs.push([m.params.entry.level, m.params.entry.text + (m.params.entry.url ? ' ' + m.params.entry.url : '')]);
    });
    await ctx.c.send('Runtime.enable'); await ctx.c.send('Log.enable');
    await sleep(400);
    const keep = fl.all ? () => true : ([lv]) => /error|warn|exception|assert/.test(lv);
    const lines = msgs.filter(keep).slice(-(+(fl.n || 30))).map(([lv, t]) => `${lv} ${clip(String(t).split('\n')[0], 200)}`);
    return lines.join('\n') || `no ${fl.all ? '' : 'errors/warnings '}logged since page load`;
  },
  async close(ctx) {
    await http(ctx.port, '/json/close/' + ctx.tab.id);
    if (ctx.st.tabs[ctx.b] === ctx.tab.id) { delete ctx.st.tabs[ctx.b]; saveState(ctx.st); }
    return 'ok closed';
  },
  async use(ctx, [id]) {
    if (!id) throw new Fail('use needs a tab id from web tabs');
    const t = (await pages(ctx.port)).find((p) => p.id.toLowerCase().startsWith(id.toLowerCase()));
    if (!t) throw new Fail(`no tab ${id}`);
    ctx.st.tabs[ctx.b] = t.id; saveState(ctx.st);
    return `ok agent tab is now ${t.id.slice(0, 6)} "${clip(t.title, 60)}"`;
  },
  async do(ctx) {
    const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const toks = tokenize(lines[i]); if (toks[0] === 'web') toks.shift();
      const { pos, fl } = parse(toks); const cmd = pos.shift();
      if (!CMDS[cmd] || ['do', 'selftest'].includes(cmd)) { out.push(`error line ${i + 1}: unknown or unsupported in do: ${cmd}`); return finish(out, 1); }
      try { out.push(`> ${lines[i]}\n` + (await CMDS[cmd](ctx, pos, fl))); }
      catch (e) { out.push(`> ${lines[i]}\nerror line ${i + 1}: ${e.message}`); return finish(out, 1); }
    }
    return out.join('\n');
  },
};
function finish(out, code) { const e = new Fail(out.join('\n')); e.raw = true; e.code = code; throw e; }

// commands that don't need a tab
const GLOBAL = {
  async up(st, b, [which]) { if (which) { st.browser = which; saveState(st); } return up(which || b); },
  async tabs(st, b) {
    await up(b, true);
    const mine = st.tabs[b];
    return (await pages(BROWSERS[b].port)).map((p) => `${p.id === mine ? '*' : ' '} ${p.id.slice(0, 6)} ${clip(p.title || '', 60)}  ${clip(p.url, 90)}`).join('\n');
  },
  help() { return HELP; },
  clone: (st, b) => clone(b),
  selftest: (st, b, pos, fl) => require('./selftest.js')({ st, b, Ctx, CMDS, newTab, http, BROWSERS, fl }),
};

const HELP = `web <cmd> [args] [--b opera|chrome|edge] [--tab <id>]   (docs: ${path.join(__dirname, 'README.md')})
  up [browser]          start/attach browser (sets default)   tabs            list tabs, * = agent tab
  open [url]            new agent tab                          goto <url>      navigate, prints top of page
  page [--region main|nav|form|dialog|<ref>] [--sel css] [--expand ref] [--max N] [--raw] [-i]
  snap                  = page --interactive                   find <text|role:text>
  text [--sel css] [--max N]                                   click <ref>     hover <ref>
  type <ref> <text> [--clear] [--enter]                        select <ref> <option>
  upload [ref] <file...>  set files on a file input (ref may be its button/label; no ref = the page's only one)
  key <Enter|Tab|Control+a|...>   scroll [down|up|<ref>]       wait <text|ref|url:x|gone:x> [--t s]
  eval <js>   shot [ref] [--o file]   net [--filter s]   console [--all]   back   reload
  use <tabid>  close   do (commands on stdin, one per line)   selftest [--minimized]
  clone [browser]       copy logins from your real profile (real browser must be closed)`;

async function main() {
  const { pos, fl } = parse(process.argv.slice(2));
  const cmd = pos.shift() || 'help';
  const st = loadState(); st.tabs = st.tabs || {};
  const b = fl.b || st.browser || 'opera';
  if (!BROWSERS[b]) throw new Fail(`unknown browser ${b}`);
  if (GLOBAL[cmd]) return GLOBAL[cmd](st, b, pos, fl);
  if (!CMDS[cmd]) throw new Fail(`unknown command ${cmd}, run web help`);
  const ctx = new Ctx(st, b);
  try { await ctx.attach(fl.tab); return await CMDS[cmd](ctx, pos, fl); }
  finally { ctx.close(); }
}

if (require.main === module) {
  main().then((o) => { if (o != null) process.stdout.write(o + '\n'); process.exit(0); },
    (e) => {
      if (e.raw) { process.stdout.write(e.message + '\n'); process.exit(e.code || 1); }
      process.stderr.write('error: ' + (e instanceof Fail ? e.message : e.stack) + '\n'); process.exit(1);
    });
}
module.exports = { parse, tokenize };

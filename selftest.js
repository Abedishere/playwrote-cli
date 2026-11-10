// web selftest: runs every core command against a local data: page in a throwaway tab.
// Exit 0 = all checks passed. --minimized also proves it works with the window minimized.
const fs = require('fs');

const HTML = `<!doctype html><title>web selftest</title>
<h1>Self Test</h1>
<nav aria-label="Top"><a href="#a">Home</a> <a href="#b">About</a></nav>
<main>
<form onsubmit="event.preventDefault();document.getElementById('out').textContent='submitted:'+document.getElementById('q').value">
<label>Query <input id="q" placeholder="type here"></label>
<select id="s"><option value="a">Alpha</option><option value="b">Beta</option></select>
<label><input type="checkbox" id="c"> Agree</label>
<label>Attach <input type="file" id="f" style="display:none" onchange="document.getElementById('fout').textContent='file:'+this.files[0].name"></label><span id="fout"></span>
<div role="button" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.textContent='drop:'+event.dataTransfer.files[0].name">Drop here</div>
<button type="button" onclick="document.getElementById('out').textContent='clicked:'+document.getElementById('q').value+'-'+document.getElementById('s').value+'-'+document.getElementById('c').checked">Go</button>
</form>
<p id="out">waiting</p>
<div style="display:none">SECRETHIDDEN</div>
<ul id="list">${Array.from({ length: 250 }, (_, i) => `<li class="row">Item ${i + 1} <a href="#i${i + 1}">open</a></li>`).join('')}</ul>
<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Apple</td><td>3</td></tr><tr><td>Pear</td><td>5</td></tr></table>
<div onclick="this.textContent='div clicked'" style="cursor:pointer">Fake button</div>
</main><script>console.error('selftest-boom')</script>`;

module.exports = async ({ st, b, Ctx, CMDS, newTab, http, BROWSERS, fl }) => {
  const ctx = new Ctx(st, b);
  const port = BROWSERS[b].port;
  const results = [];
  let tab;
  const check = (name, cond, got) => results.push((cond ? 'pass ' : 'FAIL ') + name + (cond ? '' : `\n     got: ${String(got).slice(0, 300).replace(/\n/g, '\n     ')}`));
  const run = (cmd, ...a) => { const fl2 = {}; const pos = a.filter((x) => (typeof x === 'object' ? (Object.assign(fl2, x), false) : true)); return CMDS[cmd](ctx, pos, fl2); };
  try {
    await ctx.attach(); ctx.close(); // ensures browser is up
    tab = await newTab(port);
    await ctx.connect(tab);
    if (fl.minimized) {
      const { windowId } = await ctx.c.send('Browser.getWindowForTarget', { targetId: tab.id });
      await ctx.c.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } });
    }
    const g = await run('goto', 'data:text/html,' + encodeURIComponent(HTML));
    check('goto prints page outline', g.startsWith('ok data:') && g.includes('# Self Test'), g);

    const p = await run('page');
    check('page has landmark + refs', /nav "Top":/.test(p) && /\[e\d+ button "Go"\]/.test(p), p);
    check('page hides display:none', !p.includes('SECRETHIDDEN'), p);
    check('page folds 250 rows (over budget)', /…\+\d+ similar \(web page --expand e\d+\)/.test(p), p);
    check('page renders table', p.includes('table 3x2:') && p.includes('| Apple | 3'), p);
    check('page finds cursor:pointer div', /\[e\d+ clickable "Fake button"\]/.test(p), p);
    const exp = /--expand (e\d+)/.exec(p)[1];
    const e = await run('page', { expand: exp, max: '30000' });
    check('expand shows all 250', e.includes('Item 250') && !e.includes('similar'), e);
    const small = await run('page', { sel: 'form' });
    check('small region is not folded', small.includes('Agree') && !small.includes('similar'), small);
    const snap = await run('snap');
    check('snap drops plain text', !snap.includes('waiting') && snap.includes('button "Go"'), snap);

    const ref = (s, re) => (re.exec(s) || [])[1];
    const q = ref(await run('find', 'Query'), /\[(e\d+) textbox/);
    const s = ref(await run('find', 'combobox:'), /\[(e\d+) combobox/);
    const c = ref(await run('find', 'checkbox:'), /\[(e\d+) checkbox/);
    const go = ref(await run('find', 'Go'), /\[(e\d+) button "Go"/);
    check('find returns refs', q && s && c && go, [q, s, c, go]);

    await run('type', q, 'hello');
    check('select by text', (await run('select', s, 'Beta')) === 'ok Beta');
    await run('click', c);
    await run('click', go);
    check('wait for text', (await run('wait', 'clicked:hello-b-true', { t: '3' })) === 'ok');
    check('text', (await run('text')).includes('clicked:hello-b-true'), await run('text'));
    await run('type', q, 'bye', { clear: true, enter: true });
    check('type --clear --enter submits form', (await run('text')).includes('submitted:bye'), await run('text'));
    const up = await run('upload', __filename);
    check('upload to hidden file input', up === 'ok 1 file: selftest.js' && (await run('text')).includes('file:selftest.js'), up);
    const dz = ref(await run('find', 'Drop here'), /\[(e\d+)/);
    const dr = await run('upload', dz, __filename);
    check('upload drops onto dropzone', dr.startsWith('ok dropped') && (await run('text')).includes('drop:selftest.js'), dr);
    const fake = ref(await run('find', 'Fake'), /\[(e\d+)/);
    await run('click', fake);
    check('click weak clickable', (await run('text')).includes('div clicked'), await run('text'));
    check('eval', (await run('eval', '1+1')) === '2');
    let stale; try { await run('click', 'e99999'); } catch (x) { stale = x.message; }
    check('stale ref error', /stale ref e99999/.test(stale || ''), stale);
    const con = await run('console');
    check('console shows page error', con.includes('selftest-boom'), con);
    const shot = await run('shot', { o: require('path').join(require('os').tmpdir(), 'web-selftest.png') });
    check('shot writes png', fs.existsSync(shot) && fs.statSync(shot).size > 1000, shot);
    const wt = await run('wait', 'never-appears', { t: '1' }).catch((x) => x.message);
    check('wait timeout error', /timeout after 1s/.test(wt), wt);
  } catch (err) {
    results.push('FAIL crashed: ' + err.message);
  } finally {
    ctx.close();
    if (tab) await http(port, '/json/close/' + tab.id).catch(() => {});
  }
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  const out = results.join('\n') + `\n${fails ? 'selftest FAILED' : 'selftest ok'} (${results.length - fails}/${results.length})`;
  if (fails) { const e = new Error(out); e.raw = true; e.code = 1; throw e; }
  return out;
};

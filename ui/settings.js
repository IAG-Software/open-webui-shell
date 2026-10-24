const { invoke, on } = window.shellAPI;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
let cfg = null;
let recording = null; // active shortcut recorder target

/* ─────────────────── helpers ─────────────────── */
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function get(path) {
  const parts = path.split('.'); let o = cfg;
  for (const p of parts) { if (o == null) return undefined; o = o[p]; }
  return o;
}
function setK(path, val, save = true) {
  const parts = path.split('.'); let o = cfg;
  while (parts.length > 1) o = o[parts.shift()];
  o[parts[0]] = val;
  if (save) invoke('config:set', cfg);
}

const pretty = (combo) => (combo || '')
  .split('+').filter(Boolean).map(p =>
    ({ Control: 'Ctrl', CommandOrControl: 'Ctrl' }[p] || p))
  .join(' + ') || 'Not set';

/* ─────────────────── hydrate ─────────────────── */
function hydrate() {
  const ver = cfg.appVersion || '2.0.0';
  $('#ver').textContent = 'v' + ver;
  $('#aboutVer').textContent = 'v' + ver;

  $$('.switch').forEach(sw => sw.classList.toggle('on', !!get(sw.dataset.k)));
  $$('select[data-k]').forEach((sel) => { sel.value = String(get(sel.dataset.k) ?? ''); });
  $$('input[type=text][data-k]').forEach((inp) => { inp.value = String(get(inp.dataset.k) ?? ''); });
  $('#cssText').value = get('appearance.customCSS') || '';
  $$('.kbd').forEach(k => {
    if (recording && recording.key === k.dataset.k) return; // don't clobber active recorder
    const v = cfg.shortcuts?.[k.dataset.k];
    k.textContent = pretty(v);
    k.classList.remove('record', 'conflict');
  });

  renderInstances();
}

async function refresh() {
  cfg = await invoke('config:get');
  hydrate();
}

/* ─────────────────── boot ─────────────────── */
(async function boot() {
  try {
    cfg = await invoke('config:get');
  } catch (e) {
    document.body.innerHTML = '<div style="padding:40px;color:#999">Could not reach the shell process.</div>';
    return;
  }
  hydrate();

  // nav
  $$('.navbtn').forEach(btn => btn.onclick = () => {
    $$('.navbtn').forEach(b => b.classList.remove('act'));
    btn.classList.add('act');
    $$('section').forEach(s => s.classList.toggle('act', s.dataset.s === btn.dataset.s));
  });

  // switches
  $$('.switch').forEach(sw => sw.onclick = () => {
    const on = !sw.classList.contains('on');
    sw.classList.toggle('on', on);
    setK(sw.dataset.k, on);
    toast(on ? 'Enabled — applied live' : 'Disabled — applied live');
  });

  // selects / text inputs
  $$('select[data-k], input[type=text][data-k]').forEach(inp => {
    inp.onchange = () => { setK(inp.dataset.k, inp.value); toast('Saved'); };
  });

  // custom CSS
  $('#cssApply').onclick = () => { setK('appearance.customCSS', $('#cssText').value); toast('CSS applied to the window'); };
  $('#cssRevert').onclick = () => { $('#cssText').value = get('appearance.customCSS') || ''; };
  $('#cssText').addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') $('#cssApply').click();
  });

  // shortcut recorders
  $$('.kbd').forEach(k => k.onclick = (e) => { e.stopPropagation(); startRecording(k); });
  document.addEventListener('keydown', (e) => {
    if (!recording) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopRecording(); toast('Recording cancelled'); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    const { key } = recording;
    // conflict check: same combo already bound to another action
    const clash = Object.entries(cfg.shortcuts || {}).find(([k, v]) => k !== key && v === combo);
    if (clash) {
      stopRecording();
      const el = $(`.kbd[data-k="${key}"]`);
      if (el) { el.classList.add('conflict'); el.textContent = pretty(combo); }
      toast(`Already used by "${labelOf(clash[0])}" — pick a different combo`);
      return;
    }
    cfg.shortcuts[key] = combo;
    setK('shortcuts.' + key, combo);
    stopRecording();
    toast('Shortcut saved: ' + pretty(combo));
  }, true);
  document.addEventListener('click', () => { if (recording) stopRecording(); });

  // instances
  $('#btnAdd').onclick = addInstance;
  $('#inUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') addInstance(); });
  $('#btnScan').onclick = scanInstances;
  $('#btnReset').onclick = async (e) => {
    const btn = $('#btnReset');
    if (btn.dataset.arm !== '1') {
      btn.dataset.arm = '1';
      btn.textContent = 'Are you sure?';
      setTimeout(() => { btn.dataset.arm = ''; btn.textContent = 'Reset'; }, 3000);
      return;
    }
    btn.dataset.arm = ''; btn.textContent = 'Reset';
    cfg = await invoke('config:reset');
    hydrate(); toast('Settings reset');
  };
  $('#btnOpenCfg').onclick = () => invoke('config:openFile');

  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') invoke('window:close'); });

  on('config:changed', (c) => { if (c && !recording) { cfg = c; hydrate(); } });
})();

function labelOf(key) {
  return ({ spotlight: 'Spotlight', toggleWindow: 'Toggle Shell Window', liveMode: 'Live Mode', devTools: 'Developer Tools' })[key] || key;
}

function comboFromEvent(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null; // just a modifier
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else key = ({ Escape: 'Esc' }[key] || key);
  const parts = [];
  if (e.ctrlKey) parts.push('Control');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  parts.push(key);
  if (parts.length < 2) { toast('Add at least one modifier (Ctrl / Alt / Shift)'); return null; }
  parts.sort((a, b) => ({ Control: 0, Alt: 1, Shift: 2, Meta: 3 }[a] ?? 9) - ({ Control: 0, Alt: 1, Shift: 2, Meta: 3 }[b] ?? 9));
  return parts.join('+');
}

function startRecording(k) {
  stopRecording();
  recording = { key: k.dataset.k, el: k };
  k.textContent = 'Press keys… (Esc to cancel)';
  k.classList.add('record');
  k.classList.remove('conflict');
}
function stopRecording() {
  if (!recording) return;
  const v = cfg.shortcuts?.[recording.key];
  if (recording.el && recording.el.isConnected) {
    recording.el.textContent = pretty(v);
    recording.el.classList.remove('record');
  }
  recording = null;
}

/* ─────────────────── instances ─────────────────── */
function renderInstances() {
  const wrap = $('#instList');
  const instances = cfg.instances || [];
  if (!instances.length) {
    wrap.innerHTML = '<div class="row" style="color:var(--muted); font-size:12px;">No instances saved yet — add one below or scan for running instances.</div>';
    return;
  }
  wrap.innerHTML = '';
  instances.forEach((i, idx) => {
    const active = i.url === cfg.url;
    const d = document.createElement('div');
    d.className = 'inst' + (active ? ' sel' : '');
    d.innerHTML = `<div class="radio"></div>
      <div style="min-width:0"><div class="t">${esc(i.name || i.url)}</div><div class="u">${esc(i.url)}</div></div>
      ${active ? '<div class="dot" title="Active"></div>' : ''}
      <div class="del" title="Remove">✕</div>`;
    d.onclick = async (e) => {
      if (e.target.classList.contains('del')) {
        const next = instances.filter((_, x) => x !== idx);
        cfg.instances = next; setK('instances', next); renderInstances(); toast('Removed');
        return;
      }
      if (active) return;
      cfg.url = i.url;
      await invoke('instances:select', { url: i.url });
      renderInstances(); toast('Connected to ' + (i.name || i.url));
    };
    wrap.appendChild(d);
  });
}

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

async function addInstance() {
  const name = $('#inName').value.trim();
  let url = $('#inUrl').value.trim();
  if (!url) { toast('Enter an instance URL'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  url = url.replace(/\/+$/, '');
  const list = cfg.instances || [];
  if (!list.some(i => i.url === url)) list.push({ name: name || null, url, lastUsed: Date.now() });
  cfg.instances = list;
  cfg.url = url;
  await invoke('instances:save', { instances: list, select: url });
  $('#inName').value = ''; $('#inUrl').value = '';
  toast('Instance added & connected');
}

async function scanInstances() {
  const info = $('#scanInfo');
  info.innerHTML = '<span style="animation:pulse 1s infinite">Scanning common ports…</span>';
  const found = await invoke('instances:detect');
  const running = found.filter(f => f.kind === 'open-webui');
  const others = found.filter(f => f.kind !== 'open-webui');
  if (running.length) {
    const list = cfg.instances || [];
    let added = 0;
    running.forEach(f => { if (!list.some(i => i.url === f.url)) { list.push({ name: f.name, url: f.url, lastUsed: Date.now() }); added++; } });
    cfg.instances = list;
    await invoke('instances:save', { instances: list, select: null });
    info.innerHTML = `<span style="color:var(--ok)">Found Open WebUI on ${running.map(r => new URL(r.url).port).join(', ')} — ${added ? added + ' added' : 'already saved'}</span>`;
  } else {
    let msg = 'No Open WebUI found on common ports.';
    if (others.length) msg += ' Other services: ' + others.map(o => o.name).join(', ');
    info.innerHTML = `<span style="color:var(--muted)">${esc(msg)}</span>`;
  }
  renderInstances();
}

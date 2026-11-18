// Chord Study — app: state, UI, library, sharing, video export.
(() => {
const $ = id => document.getElementById(id);
// Transport icons (crisp SVG instead of text symbols)
const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
const ICON = {
  play: svg('<path d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.05-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14Z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
};
CS.ICON = ICON;
const SPEEDS = { slow: { label: 'Slow', D: 4.0 }, medium: { label: 'Medium', D: 3.2 }, flowing: { label: 'Flowing', D: 2.5 } };
const LIB_KEY = 'chordstudy.library.v1';
const PREF_KEY = 'chordstudy.prefs.v1';

const S = {
  mood: 'dreamy', key: null, tokens: [], custom: false,
  level: 'rich', sound: 'strings', speed: 'medium', dyn: null, gFrac: 0.36, loop: false, no: 1,
  study: null, tl: null, playing: false, t: 0, nowIdx: -1,
};
const player = new CS.Player();
const cv = $('cv'), ctx = cv.getContext('2d');

// ------------------------------------------------------------ storage (best effort)
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
let library = store.get(LIB_KEY, []);
const nextNo = () => library.reduce((m, x) => Math.max(m, x.no || 0), 0) + 1;

// ------------------------------------------------------------ helpers
const moodOf = id => CS.MOODS.find(m => m.id === id) || CS.MOODS[0];
const keyFor = (pc, minor) => CS.keyOf((minor ? CS.KEYS_MINOR : CS.KEYS_MAJOR)[pc], minor);
const D = () => SPEEDS[S.speed].D;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
    return ok;
  }
}
const title = () => S.custom ? 'Custom progression' : `${moodOf(S.mood).name} in ${CS.keyLabel(S.key)} ${S.key.minor ? 'minor' : 'major'}`;

// ------------------------------------------------------------ study lifecycle
function setStudy(tokens, key) {
  S.study = CS.buildStudy(tokens, key);
  S.tokens = tokens.slice();
  S.key = key;
  rebuildTimeline();
  S.t = 0;
  S.nowIdx = -1;
  renderChips();
  renderKeys();
  renderMoods();
  $('inp').value = S.tokens.join(' ');
  savePrefs();
}
function rebuildTimeline() { S.tl = CS.timeline(S.study, D(), S.gFrac, S.loop); refreshDyn(); }

function play(fromK = 0) {
  if (rec) return;
  rebuildTimeline();
  player.setLevels(1, 0);
  player.start(S.tl, S.sound, fromK, { dyn: S.dyn });
  S.playing = true;
  $('playhint').classList.remove('first');
  updateTransport();
}
function stop() {
  player.stop();
  S.playing = false;
  S.t = 0;
  S.nowIdx = -1;
  markChip(-1);
  if (rec) finishRecording(false);
  updateTransport();
}
const toggle = () => S.playing ? stop() : play();
// keep playing from the current chord after a setting changes
function restartIfPlaying() {
  if (!S.playing) { rebuildTimeline(); return; }
  const k = CS.mod(S.tl.chordIndexAt(player.now()), S.study.N);
  play(k);
}

function generate() {
  const g = $('generate');
  g.classList.remove('spin'); void g.offsetWidth; g.classList.add('spin');
  S.custom = false;
  S.no = nextNo();
  setStudy(CS.generate(S.mood, S.key, null, S.level), S.key);
  play();
}

// ------------------------------------------------------------ UI builders
function renderMoods() {
  const el = $('moods');
  if (!el.children.length) {
    CS.MOODS.forEach(m => {
      const b = document.createElement('button');
      b.className = 'mood';
      b.dataset.id = m.id;
      b.innerHTML = `<span class="sw" style="background:${m.color}"></span><b>${m.name}</b><small>${m.blurb}</small>`;
      b.onclick = () => {
        S.mood = m.id;
        if (S.key.minor !== m.minor) S.key = keyFor(S.key.pc, m.minor);
        generate();
      };
      el.appendChild(b);
    });
  }
  [...el.children].forEach(b => b.classList.toggle('on', !S.custom && b.dataset.id === S.mood));
  $('modeLabel').textContent = S.key ? (S.key.minor ? 'Minor' : 'Major') : '';
}

function renderKeys() {
  const el = $('keys');
  const names = S.key.minor ? CS.KEYS_MINOR : CS.KEYS_MAJOR;
  el.innerHTML = '';
  names.forEach((n, pc) => {
    const b = document.createElement('button');
    b.className = 'key' + (pc === S.key.pc ? ' on' : '');
    b.textContent = n;
    b.onclick = () => changeKey(pc);
    el.appendChild(b);
  });
  const r = document.createElement('button');
  r.className = 'key rand';
  r.textContent = 'Random';
  r.title = 'Surprise me';
  r.onclick = () => {
    let pc;
    do { pc = Math.floor(Math.random() * 12); } while (pc === S.key.pc);
    changeKey(pc);
  };
  el.appendChild(r);
}
function changeKey(pc) {
  const nk = keyFor(pc, S.key.minor);
  const tokens = S.tokens.map(t => CS.transposeToken(t, S.key, nk));
  setStudy(tokens, nk);
  play();
}

function renderChips() {
  const el = $('chips');
  el.innerHTML = '';
  S.study.chords.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'chip' + (c.beats < 1 ? ' half' : '');
    b.title = (c.beats < 1 ? 'Passing chord (half length). ' : '') + 'Tap to swap for another chord that fits';
    b.innerHTML = `<b>${c.ch.rootName}${c.ch.qual}</b><small>${c.roman}</small>`;
    b.onclick = () => swap(i);
    el.appendChild(b);
  });
}
function swap(i) {
  const tokens = S.tokens.slice();
  tokens[i] = CS.swapChord(tokens, i, S.key);
  setStudy(tokens, S.key);
  const chip = $('chips').children[i];
  if (chip) chip.classList.add('flash');
  play(Math.max(0, i - 1));
}
function markChip(i) {
  [...$('chips').children].forEach((b, j) => b.classList.toggle('now', j === i));
}

function seg(el, opts, cur, onPick) {
  el.innerHTML = '';
  Object.entries(opts).forEach(([id, o]) => {
    const b = document.createElement('button');
    b.textContent = o.label;
    b.className = id === cur ? 'on' : '';
    b.onclick = () => { [...el.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); onPick(id); };
    el.appendChild(b);
  });
}

function updateTransport() {
  const p = $('play');
  p.classList.toggle('on', S.playing);
  p.querySelector('.ico').innerHTML = S.playing ? ICON.stop : ICON.play;
  document.querySelectorAll('.mb-play .ico').forEach(e => { e.innerHTML = S.playing ? ICON.stop : ICON.play; });
  document.querySelectorAll('.mb-play .lbl').forEach(e => { e.textContent = S.playing ? 'Stop' : 'Play'; });
  p.querySelector('.lbl').textContent = S.playing ? 'Stop' : 'Play';
  $('playhint').classList.toggle('show', !S.playing && !rec);
  $('rec').textContent = rec ? 'Recording…' : 'Export video';
  $('rec').classList.toggle('rec-on', !!rec);
  ['play', 'generate'].forEach(id => $(id).disabled = !!rec);
}

// ------------------------------------------------------------ library
function snapshot() {
  const c = document.createElement('canvas');
  c.width = 270; c.height = 480;
  const tl = CS.timeline(S.study, D(), S.gFrac, false);
  CS.render(c.getContext('2d'), tl, D() * 0.62, { no: S.no, scale: 0.5, settled: true });
  return c.toDataURL('image/jpeg', 0.78);
}
function saveStudy() {
  const item = {
    id: Date.now().toString(36), title: title(), mood: S.mood, custom: S.custom,
    tokens: S.tokens, key: S.key, level: S.level, dyn: S.dyn, sound: S.sound, speed: S.speed, gFrac: S.gFrac,
    no: S.no, created: Date.now(), thumb: snapshot(),
  };
  const existing = library.findIndex(x => x.no === S.no);
  if (existing >= 0) library[existing] = { ...item, id: library[existing].id };
  else library.unshift(item);
  if (!store.set(LIB_KEY, library)) { toast('Could not save. Browser storage is unavailable.'); return; }
  renderLibraryCount();
  toast(`Saved as Study No. ${String(S.no).padStart(2, '0')}`);
}
function loadItem(x) {
  stop();
  S.mood = x.mood; S.custom = !!x.custom; if (x.level) S.level = x.level;
  S.dyn = { ...DYN_DEFAULT, ...(x.dyn || {}) }; S.sound = x.sound; S.speed = x.speed; S.gFrac = x.gFrac ?? 0.36; S.no = x.no;
  syncControls();
  setStudy(x.tokens, x.key);
}
function renderLibrary() {
  const grid = $('grid');
  grid.innerHTML = '';
  $('empty').hidden = library.length > 0;
  library.forEach(x => {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `<img alt="">
      <div class="meta"><b></b><small></small>
      <div class="row"><button class="btn open">Open</button><button class="btn del">Delete</button></div></div>`;
    el.querySelector('img').src = x.thumb;
    el.querySelector('b').textContent = `No. ${String(x.no).padStart(2, '0')} · ${x.title}`;
    el.querySelector('small').textContent = x.tokens.map(CS.stripHalf).join(' → ');
    const open = () => { loadItem(x); show('create'); play(); };
    el.querySelector('img').onclick = open;
    el.querySelector('.open').onclick = open;
    el.querySelector('.del').onclick = () => {
      if (!confirm(`Delete Study No. ${x.no}? This can't be undone.`)) return;
      library = library.filter(y => y.id !== x.id);
      store.set(LIB_KEY, library);
      renderLibrary(); renderLibraryCount();
    };
    grid.appendChild(el);
  });
}
const renderLibraryCount = () => { $('libCount').textContent = library.length || ''; };

// ------------------------------------------------------------ share links
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function shareURL() {
  const data = { t: S.tokens.join(' '), k: [S.key.letter, S.key.pc, S.key.minor ? 1 : 0], m: S.mood, c: S.custom ? 1 : 0,
                 s: S.sound, v: S.speed, g: S.gFrac, n: S.no, h: S.level, y: S.dyn.mode === 'off' ? undefined : S.dyn };
  return location.href.split('#')[0] + '#s=' + b64e(JSON.stringify(data));
}
function fromHash() {
  const m = location.hash.match(/#s=([\w-]+)/);
  if (!m) return false;
  try {
    const d = JSON.parse(b64d(m[1]));
    S.mood = d.m; S.custom = !!d.c; S.sound = d.s in CS.SOUNDS ? d.s : 'strings'; S.speed = d.v in SPEEDS ? d.v : 'medium';
    S.gFrac = +d.g || 0.36; S.no = d.n || 1; if (d.h in CS.LEVELS) S.level = d.h; S.dyn = { ...DYN_DEFAULT, ...(d.y || {}) };
    setStudy(CS.tokenize(d.t), { letter: d.k[0], pc: d.k[1], minor: !!d.k[2] });
    return true;
  } catch (e) { return false; }
}

// ------------------------------------------------------------ video export
let rec = null, recChunks = [], recType = '';
function startRecording() {
  if (rec) return;
  player.wake();
  if (!player.recDest || !cv.captureStream) { toast('Video export is not supported in this browser.'); return; }
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  recType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!recType) { toast('Video export is not supported in this browser.'); return; }
  stop();
  S.loop = false; $('loop').checked = false;
  rebuildTimeline();
  const stream = new MediaStream([...cv.captureStream(60).getVideoTracks(), ...player.recDest.stream.getAudioTracks()]);
  recChunks = [];
  rec = new MediaRecorder(stream, { mimeType: recType, videoBitsPerSecond: 8e6 });
  rec.ondataavailable = e => e.data.size && recChunks.push(e.data);
  rec.onstop = () => {
    const keep = rec && rec._keep;
    rec = null;
    updateTransport();
    if (!keep) return;
    const blob = new Blob(recChunks, { type: recType });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `chord-study-${String(S.no).padStart(2, '0')}.${recType.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Video saved');
  };
  rec.start();
  player.setLevels(1, 0);
  player.start(S.tl, S.sound, 0, { dyn: S.dyn });
  S.playing = true;
  updateTransport();
  toast('Recording. Let it play to the end.');
}
function finishRecording(keep) {
  if (!rec) return;
  rec._keep = keep;
  if (rec.state !== 'inactive') rec.stop();
}

// ------------------------------------------------------------ views
function show(view) {
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== 'view-' + view; });
  document.body.dataset.view = view;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view !== 'create' && S.playing && !rec) stop();
  if (view === 'library') renderLibrary();
  document.dispatchEvent(new CustomEvent('cs:view', { detail: view }));
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', e => { e.preventDefault(); show(el.dataset.view); }));

// ------------------------------------------------------------ prefs
function savePrefs() { store.set(PREF_KEY, { sound: S.sound, speed: S.speed, mood: S.mood, level: S.level, dyn: S.dyn }); }
const LEVEL_HINTS = {
  smooth: 'Gentle, diatonic colours',
  rich: 'Adds the odd borrowed or altered chord',
  spicy: 'Tritone subs, altered dominants, passing diminished',
};
function syncControls() {
  seg($('level'), CS.LEVELS, S.level, id => { S.level = id; $('levelHint').textContent = LEVEL_HINTS[id]; savePrefs(); generate(); });
  $('levelHint').textContent = LEVEL_HINTS[S.level];
  seg($('sound'), CS.SOUNDS, S.sound, id => { S.sound = id; savePrefs(); restartIfPlaying(); });
  seg($('speed'), SPEEDS, S.speed, id => { S.speed = id; savePrefs(); restartIfPlaying(); });
  $('no').value = S.no;
  $('glide').value = S.gFrac;
  $('loop').checked = S.loop;
}

// ------------------------------------------------------------ wiring
$('generate').onclick = generate;
$('mb-gen').onclick = generate;
$('mb-play').onclick = () => toggle();
$('play').onclick = toggle;
$('card').onclick = toggle;
$('card').onkeydown = e => { if (e.key === 'Enter') toggle(); };
$('save').onclick = saveStudy;
$('share').onclick = async () => {
  const url = shareURL();
  history.replaceState(null, '', url);
  toast(await copy(url) ? 'Link copied. Anyone who opens it hears this study.' : 'Link is in the address bar');
};
$('caption').onclick = async () => {
  const text = `Chord Study No. ${String(S.no).padStart(2, '0')}: ${title()}\n\n` +
    S.study.chords.map(c => c.ch.rootName + c.ch.qual).join(' → ') +
    `\n\n#musictheory #chords #chordstudy #${S.custom ? 'harmony' : S.mood.replace('-', '')} #minimalism`;
  toast(await copy(text) ? 'Caption copied' : 'Could not copy');
};
$('rec').onclick = startRecording;
$('apply').onclick = () => {
  const toks = CS.tokenize($('inp').value);
  try {
    if (!toks.length) throw new Error('Type at least one chord.');
    const first = CS.parseChord(CS.stripHalf(toks[0]));
    if (!first) throw new Error(`Couldn't read "${toks[0]}".`);
    const key = { letter: first.root.letter, pc: first.root.pc, minor: first.isMinor };
    if (toks.length === 1) {
      if (moodOf(S.mood).minor !== key.minor) S.mood = CS.MOODS.find(m => m.minor === key.minor).id;
      S.custom = false;
      S.no = nextNo();
      setStudy(CS.generate(S.mood, key, null, S.level), key);
    } else {
      CS.buildStudy(toks, key); // validate first
      S.custom = true;
      S.no = nextNo();
      setStudy(toks, key);
    }
    $('err').textContent = '';
    play();
  } catch (e) { $('err').textContent = e.message; }
};
$('inp').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('apply').click(); } });
$('no').oninput = () => { S.no = Math.max(1, Math.min(99, parseInt($('no').value || '1', 10))); };
$('glide').oninput = () => { S.gFrac = +$('glide').value; restartIfPlaying(); };
$('loop').onchange = () => { S.loop = $('loop').checked; restartIfPlaying(); };
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (e.code === 'Space' && tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'BUTTON' && !$('view-create').hidden) {
    e.preventDefault(); toggle();
  }
});

// ------------------------------------------------------------ dynamics controls
const DYN_DEFAULT = { mode: 'off', start: 0.3, peak: 1, reach: 0.75, curve: 'smooth' };
S.dyn = { ...DYN_DEFAULT };
const DYN_MODES = { off: { label: 'Off' }, build: { label: 'Build' }, swell: { label: 'Swell' } };
const DYN_CURVES = { smooth: { label: 'Smooth' }, steady: { label: 'Steady' }, late: { label: 'Late burst' } };
const dynViews = [];
function mountDyn(el, spanFn, progFn) {
  el.innerHTML = `
    <div class="seg dyn-mode"></div>
    <canvas class="dyn-graph" width="840" height="160" aria-label="Volume over time"></canvas>
    <div class="dyn-rows">
      <label class="dyn-row"><span>Start</span><input type="range" data-k="start" min="0" max="1" step="0.01"><output></output></label>
      <label class="dyn-row"><span>Peak</span><input type="range" data-k="peak" min="0.3" max="1" step="0.01"><output></output></label>
      <label class="dyn-row"><span>Peak at</span><input type="range" data-k="reach" min="0.05" max="1" step="0.01"><output></output></label>
      <div class="dyn-row"><span>Curve</span><div class="seg dyn-curve"></div></div>
    </div>`;
  const view = { el, spanFn, progFn, canvas: el.querySelector('canvas'), lastU: undefined };
  el.querySelectorAll('input[type=range]').forEach(inp => {
    inp.oninput = () => { S.dyn[inp.dataset.k] = +inp.value; dynChanged(); };
  });
  dynViews.push(view);
  refreshDyn();
  return view;
}
function dynChanged() {
  player.setDyn(S.dyn);
  savePrefs();
  refreshDyn();
}
const pct = v => Math.round(v * 100) + '%';
function refreshDyn() {
  const d = S.dyn;
  for (const v of dynViews) {
    seg(v.el.querySelector('.dyn-mode'), DYN_MODES, d.mode, id => { S.dyn.mode = id; dynChanged(); });
    seg(v.el.querySelector('.dyn-curve'), DYN_CURVES, d.curve, id => { S.dyn.curve = id; dynChanged(); });
    v.el.querySelector('.dyn-rows').classList.toggle('off', d.mode === 'off');
    v.el.querySelectorAll('input[type=range]').forEach(inp => {
      if (document.activeElement !== inp) inp.value = d[inp.dataset.k];
      const out = inp.nextElementSibling;
      const k = inp.dataset.k;
      if (k === 'reach') {
        const span = v.spanFn();
        out.textContent = span ? `${(d.reach * span).toFixed(1)}s` : pct(d.reach);
      } else {
        out.innerHTML = `${pct(d[k])}<i>${CS.dynMarking(d[k])}</i>`;
      }
    });
    drawDynGraph(v, true);
  }
}
function drawDynGraph(v, force) {
  if (v.el.offsetParent === null) return; // hidden tab
  const u = v.progFn();
  if (!force && (u === v.lastU || (u != null && v.lastU != null && Math.abs(u - v.lastU) < 0.002))) return;
  v.lastU = u;
  const c = v.canvas.getContext('2d');
  const W = v.canvas.width, H = v.canvas.height;
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--ink').trim(), accent = css.getPropertyValue('--accent').trim(), muted = css.getPropertyValue('--muted').trim();
  c.clearRect(0, 0, W, H);
  const pad = 14, top = 40, bot = H - 14;
  const env = CS.envelope(S.dyn) || (() => 1);
  const yOf = val => bot - val * (bot - top);
  const xOf = uu => pad + uu * (W - pad * 2);
  // full-scale guide
  c.strokeStyle = muted; c.globalAlpha = 0.3; c.setLineDash([6, 6]); c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(pad, yOf(1)); c.lineTo(W - pad, yOf(1)); c.stroke();
  c.setLineDash([]); c.globalAlpha = 1;
  const path = () => { c.beginPath(); c.moveTo(xOf(0), bot); for (let i = 0; i <= 120; i++) c.lineTo(xOf(i / 120), yOf(env(i / 120))); c.lineTo(xOf(1), bot); c.closePath(); };
  path(); c.fillStyle = accent; c.globalAlpha = 0.14; c.fill(); c.globalAlpha = 1;
  if (u != null) {
    c.save(); c.beginPath(); c.rect(0, 0, xOf(u), H); c.clip();
    path(); c.fillStyle = accent; c.globalAlpha = 0.4; c.fill(); c.restore(); c.globalAlpha = 1;
  }
  c.beginPath();
  for (let i = 0; i <= 120; i++) { const x = xOf(i / 120), y = yOf(env(i / 120)); i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.strokeStyle = accent; c.lineWidth = 3; c.stroke();
  c.font = 'italic 700 22px Georgia, serif'; c.fillStyle = ink; c.textBaseline = 'bottom';
  if (S.dyn.mode === 'off') {
    c.font = '600 20px Inter, sans-serif'; c.fillStyle = muted; c.fillText('Constant level', pad + 4, yOf(1) - 6);
  } else {
    const d = S.dyn;
    c.textAlign = 'left'; c.fillText(CS.dynMarking(d.start), pad + 4, Math.min(bot, yOf(d.start) - 6));
    const px = xOf(d.reach);
    c.fillStyle = accent; c.beginPath(); c.arc(px, yOf(d.peak), 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = ink; c.textAlign = px > W - 80 ? 'right' : 'center';
    if (px - pad > 50) c.fillText(CS.dynMarking(d.peak), Math.min(px, W - pad - 4), yOf(d.peak) - 10);
    c.textAlign = 'left';
  }
  if (u != null) { c.fillStyle = ink; c.fillRect(xOf(u) - 1.5, top - 8, 3, bot - top + 8); }
}
function tickDyn() { for (const v of dynViews) drawDynGraph(v, false); }
const createProgress = () => {
  if (!S.playing || !S.tl) return null;
  return S.loop ? CS.mod(S.t, S.tl.total) / S.tl.total : Math.min(1, S.t / S.tl.total);
};

// ------------------------------------------------------------ frame loop
function frame() {
  if (S.playing) {
    S.t = Math.max(0, player.now());
    if (!S.loop && S.t > S.tl.total + 3.2) {
      S.playing = false;
      S.t = S.tl.total;
      markChip(-1); S.nowIdx = -1;
      if (rec) finishRecording(true);
      updateTransport();
    } else {
      const k = S.t < S.tl.total || S.loop ? CS.mod(S.tl.chordIndexAt(S.t), S.study.N) : -1;
      if (k !== S.nowIdx) { S.nowIdx = k; markChip(k); }
    }
  }
  if (!$('view-create').hidden) CS.render(ctx, S.tl, S.t, { no: S.no, scale: 2, settled: !S.playing && S.t === 0, dyn: S.dyn });
  tickDyn();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ boot
const prefs = store.get(PREF_KEY, {});
if (prefs.sound in CS.SOUNDS) S.sound = prefs.sound;
if (prefs.speed in SPEEDS) S.speed = prefs.speed;
if (prefs.level in CS.LEVELS) S.level = prefs.level;
S.dyn = { ...DYN_DEFAULT, ...(prefs.dyn || {}) };
if (!fromHash()) {
  S.mood = 'dreamy';
  S.no = nextNo();
  const key = keyFor(7, false); // G major — the reel's progression to start
  setStudy(CS.generate('dreamy', key, 0), key);
}
document.body.dataset.view = 'create';
syncControls();
mountDyn($('dyn'), () => S.tl ? S.tl.total : 0, createProgress);
renderLibraryCount();
updateTransport();
$('playhint').classList.add('first');
const fontsReady = document.fonts && document.fonts.load
  ? Promise.all(['800 100px Inter', '500 36px Inter', '600 12px Inter'].map(f => document.fonts.load(f))) : Promise.resolve();
fontsReady.catch(() => {}).finally(() => requestAnimationFrame(frame));
window.__cs = { S, player };
// shared with the Video tab
CS.app = { S, player, toast, seg, mountDyn, refreshDyn, speedD: D, generate: () => CS.generate(S.mood, S.key, null, S.level), stopCreate: () => { if (S.playing) stop(); } };
})();

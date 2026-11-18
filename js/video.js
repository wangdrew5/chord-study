// Chord Study — Video tab: score a clip with your chords, timed to its cuts.
(() => {
const $ = id => document.getElementById(id);
const app = CS.app;
const player = app.player;
const { COLORS, BG, INK, GREY, RED, FONT } = CS.CARD;

const V = {
  ready: false, url: null, dur: 0, w: 1080, h: 1920,
  cuts: [], analyzing: false, scanId: 0,
  mode: 'progression', sel: 0, timing: 'cuts', mix: 0.55, sound: app.S.sound, overlay: 'swiss',
  tokens: null, key: null, st: null, tl: null, D: 3, snapped: 0,
  playing: false, rec: null, lastSync: 0,
};
const vid = $('v-video');
const cv = $('v-canvas');
const ctx = cv.getContext('2d');
const scan = document.createElement('video');
scan.muted = true; scan.playsInline = true; scan.preload = 'auto';

const fmt = s => { s = Math.max(0, s || 0); return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); };
const once = (el, ev, ms = 4000) => new Promise(res => {
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); el.removeEventListener(ev, done); res(); }
  el.addEventListener(ev, done);
});

// ------------------------------------------------------------ loading
async function load(file) {
  if (!file || !file.type.startsWith('video/')) { app.toast('That file is not a video.'); return; }
  pause();
  if (V.url) URL.revokeObjectURL(V.url);
  V.url = URL.createObjectURL(file);
  V.ready = false; V.cuts = []; V.scanId++;
  vid.src = V.url;
  scan.src = V.url;
  await once(vid, 'loadedmetadata', 10000);
  if (!vid.videoWidth) { app.toast('Could not read that video. Try an MP4 or MOV.'); return; }
  // some files (e.g. browser-recorded WebM) report an infinite duration until you seek to the end
  for (const el of [vid, scan]) {
    if (el.readyState < 1) await once(el, 'loadedmetadata', 10000);
    if (!isFinite(el.duration)) {
      el.currentTime = 1e7;
      await once(el, 'durationchange', 5000);
      el.currentTime = 0;
      await once(el, 'seeked', 2000);
    }
  }
  V.dur = vid.duration;
  if (!isFinite(V.dur) || V.dur <= 0) { app.toast('Could not read the length of that video.'); return; }
  // render at native size, capped at 1920 on the long side
  const k = Math.min(1, 1920 / Math.max(vid.videoWidth, vid.videoHeight));
  V.w = Math.round(vid.videoWidth * k / 2) * 2;
  V.h = Math.round(vid.videoHeight * k / 2) * 2;
  cv.width = V.w; cv.height = V.h;
  $('v-seek').max = V.dur;
  $('v-drop').hidden = true;
  $('v-wrap').hidden = false;
  vid.currentTime = 0.01;
  V.ready = true;
  if (!V.tokens) pullFromCreate(false);
  fit();
  updateUI();
  info(file.name);
  detectCuts(V.scanId, file.name);
}

function info(name, progress) {
  const el = $('v-info');
  const parts = [`<b>${name.replace(/[<>&]/g, '')}</b>`, `${fmt(V.dur)} · ${V.w}×${V.h}`];
  if (V.analyzing) parts.push(`Finding cuts… ${Math.round((progress || 0) * 100)}%`);
  else parts.push(V.cuts.length ? `${V.cuts.length} cut${V.cuts.length > 1 ? 's' : ''} found` : 'No hard cuts found, so chords use even timing');
  el.innerHTML = parts.join('<br>') + (V.analyzing ? `<div class="bar"><i style="width:${(progress || 0) * 100}%"></i></div>` : '');
  V.name = name;
}

// Scene-cut detection: sample small frames and look for spikes in frame-to-frame difference.
async function detectCuts(id, name) {
  V.analyzing = true;
  info(name, 0);
  if (scan.readyState < 1) await once(scan, 'loadedmetadata', 10000);
  const w = 64, h = 36;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  const step = Math.max(0.1, V.dur / 450);
  const diffs = [];
  let prev = null;
  for (let t = 0; t < V.dur; t += step) {
    if (id !== V.scanId) return;
    scan.currentTime = t;
    await once(scan, 'seeked', 1500);
    x.drawImage(scan, 0, 0, w, h);
    const px = x.getImageData(0, 0, w, h).data;
    // compare full colour, not just brightness (a red→teal cut can have identical luma)
    const rgb = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; }
    if (prev) {
      let d = 0;
      for (let i = 0; i < rgb.length; i++) d += Math.abs(rgb[i] - prev[i]);
      diffs.push({ t, v: d / rgb.length });
    }
    prev = rgb;
    if (diffs.length % 12 === 0) info(name, t / V.dur);
  }
  if (id !== V.scanId) return;
  const sorted = diffs.map(d => d.v).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] || 0;
  const thr = Math.max(14, med * 4);
  const cuts = [];
  diffs.forEach((d, i) => {
    const l = diffs[i - 1] ? diffs[i - 1].v : 0, r = diffs[i + 1] ? diffs[i + 1].v : 0;
    if (d.v > thr && d.v >= l && d.v >= r && d.t > 0.4 && d.t < V.dur - 0.4 &&
        (!cuts.length || d.t - cuts[cuts.length - 1] > 0.6)) cuts.push(d.t - step / 2);
  });
  V.cuts = cuts;
  V.analyzing = false;
  info(name);
  fit();
}

// ------------------------------------------------------------ fitting chords to the clip
const beatOf = t => CS.isHalf(t) ? 0.5 : 1;
function fit() {
  if (!V.ready || !V.tokens) return;
  const L = V.dur;
  const Dp = app.speedD();
  let seq, key = null;
  if (V.mode === 'single') {
    const t = CS.stripHalf(V.tokens[V.sel] || V.tokens[0]);
    seq = Array(Math.max(1, Math.round(L / Dp))).fill(t);
  } else {
    const base = V.tokens.slice();
    const B = base.reduce((a, t) => a + beatOf(t), 0);
    if (L >= B * Dp * 0.7) {
      const passes = Math.max(1, Math.round(L / (B * Dp)));
      seq = [];
      for (let p = 0; p < passes; p++) seq.push(...base);
    } else {
      // short clip: keep the opening chords and always land on the final (home) chord
      const target = Math.max(2, Math.round(L / Dp));
      seq = [];
      let acc = 0;
      for (const t of base.slice(0, -1)) {
        if (acc + beatOf(t) > target - 1 + 1e-6) break;
        seq.push(t); acc += beatOf(t);
      }
      if (!seq.length) seq.push(base[0]);
      seq.push(base[base.length - 1]);
    }
    key = V.key;
  }
  const beats = seq.map(beatOf);
  const D = L / beats.reduce((a, b) => a + b, 0);
  let bounds = [0], acc = 0;
  for (let i = 0; i < seq.length - 1; i++) { acc += beats[i]; bounds.push(acc * D); }
  V.snapped = 0;
  if (V.timing === 'cuts' && V.cuts.length) bounds = snap(bounds, D, L);

  let st;
  try { st = CS.buildStudy(seq, key); } catch (e) { app.toast(e.message); return; }
  st.chords.forEach((c, i) => { c.beats = ((i + 1 < bounds.length ? bounds[i + 1] : L) - bounds[i]) / D; });
  V.st = st;
  V.D = D;
  V.tl = CS.timeline(st, D, 0.36, false);
  renderChips();
  hints();
  if (V.playing) startAudio();
}
// move each chord change onto the nearest cut, if one is close enough
function snap(bounds, D, L) {
  const out = [0];
  const used = new Set();
  for (let i = 1; i < bounds.length; i++) {
    const b = bounds[i], prev = out[out.length - 1];
    const next = bounds[i + 1] ?? L;
    let best = null;
    for (const c of V.cuts) {
      if (used.has(c) || Math.abs(c - b) > 0.5 * D) continue;
      if (c - prev < 0.45 * D || next - c < 0.3 * D || L - c < 0.45 * D) continue;
      if (best == null || Math.abs(c - b) < Math.abs(best - b)) best = c;
    }
    if (best != null) { used.add(best); V.snapped++; out.push(best); }
    else out.push(Math.max(b, prev + 0.3 * D));
  }
  return out;
}

function pullFromCreate(refit = true) {
  V.tokens = app.S.tokens.slice();
  V.key = { ...app.S.key };
  V.sel = 0;
  if (refit) fit();
}

// ------------------------------------------------------------ playback (video is the clock)
function startAudio() {
  if (!V.tl) return;
  player.attachMedia(vid);
  applyMix();
  player.start(V.tl, V.sound, 0, { offset: vid.currentTime + 0.08, releaseLead: 1.8 });
  V.lastSync = performance.now();
}
function applyMix() {
  const m = V.mix;
  player.setLevels(Math.min(1, m * 2), Math.min(1, (1 - m) * 2));
}
async function play() {
  if (!V.ready || V.rec && !V.recStarting) return;
  app.stopCreate();
  player.ensure();
  player.A.resume();
  player.attachMedia(vid);
  if (vid.ended || vid.currentTime >= V.dur - 0.05) { vid.currentTime = 0; await once(vid, 'seeked', 2000); }
  try { await vid.play(); } catch (e) { app.toast('Could not play this video.'); }
}
function pause() {
  if (!vid.paused) vid.pause();
}
vid.addEventListener('play', () => { V.playing = true; startAudio(); updateUI(); });
vid.addEventListener('pause', () => { V.playing = false; player.stop(0.3); updateUI(); });
vid.addEventListener('ended', () => {
  V.playing = false;
  updateUI();
  if (V.rec) finishExport();
});
vid.addEventListener('seeked', () => { if (V.playing) startAudio(); });
vid.addEventListener('timeupdate', () => {
  $('v-seek').value = vid.currentTime;
  $('v-time').textContent = `${fmt(vid.currentTime)} / ${fmt(V.dur)}`;
});

// ------------------------------------------------------------ export
function finishExport() {
  const r = V.rec;
  if (!r) return;
  setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, 250);
}
async function exportVideo() {
  if (!V.ready || V.rec) return;
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
  const type = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!type) { app.toast('Video export is not supported in this browser.'); return; }
  player.ensure();
  player.A.resume();
  player.attachMedia(vid);
  pause();
  vid.currentTime = 0;
  await once(vid, 'seeked', 2000);
  const stream = new MediaStream([...cv.captureStream(30).getVideoTracks(), ...player.recDest.stream.getAudioTracks()]);
  const chunks = [];
  const r = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 10e6 });
  r.ondataavailable = e => e.data.size && chunks.push(e.data);
  r.onstop = () => {
    V.rec = null;
    updateUI();
    if (r._cancel) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type }));
    a.download = `${(V.name || 'video').replace(/\.[^.]+$/, '')}-chord-study.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    app.toast('Video saved');
  };
  V.rec = r;
  V.recStarting = true;
  r.start();
  updateUI();
  app.toast('Exporting in real time. Let it play to the end.');
  await play();
  V.recStarting = false;
}
function cancelExport() {
  if (!V.rec) return;
  V.rec._cancel = true;
  if (V.rec.state !== 'inactive') V.rec.stop();
  pause();
}

// ------------------------------------------------------------ drawing
function draw() {
  if (!$('view-video').hidden && V.ready) {
    ctx.drawImage(vid, 0, 0, V.w, V.h);
    const t = vid.currentTime;
    if (V.tl && V.overlay !== 'none') (V.overlay === 'swiss' ? swissBar : minimal)(t);
    // keep the chords locked to the video clock
    if (V.playing && performance.now() - V.lastSync > 1000) {
      V.lastSync = performance.now();
      if (Math.abs(player.now() - vid.currentTime) > 0.25) startAudio();
    }
  }
  requestAnimationFrame(draw);
}

function chordState(t) {
  const tl = V.tl;
  const k = tl.indexAt(Math.min(t, tl.total - 0.001));
  const c = tl.chordAt(k);
  const fade = Math.min(1, (t - tl.startOf(k)) / 0.28);
  return { c, fade: k === 0 && t < 0.3 ? 1 : fade };
}

function swissBar(t) {
  const W = V.w, H = V.h;
  const u = Math.min(W, H) / 540;
  const barH = Math.round(Math.min(H * 0.2, 140 * u));
  const y0 = H - barH;
  const pad = 22 * u;
  ctx.fillStyle = BG;
  ctx.globalAlpha = 0.95;
  ctx.fillRect(0, y0, W, barH);
  ctx.globalAlpha = 1;
  // progress rule along the top edge
  ctx.fillStyle = '#D3CFC6';
  ctx.fillRect(0, y0, W, 1.5 * u);
  ctx.fillStyle = INK;
  ctx.fillRect(0, y0, W * Math.min(1, t / V.dur), 3 * u);

  const { c, fade } = chordState(t);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = `600 ${8.5 * u}px ${FONT}`;
  CS.spaced(ctx, 'CHORD STUDY', pad, y0 + pad + 6 * u, 1 * u);

  const kbW = Math.min(W * 0.4, 300 * u), kbH = barH * 0.42;
  const textMax = W - kbW - pad * 3;
  ctx.globalAlpha = fade;
  let big = barH * 0.4;
  ctx.font = `800 ${big}px ${FONT}`;
  let rw = ctx.measureText(c.ch.rootName).width;
  let qs = big * 0.38;
  ctx.font = `500 ${qs}px ${FONT}`;
  while (rw + ctx.measureText(c.ch.qual).width + 6 * u > textMax && qs > 8 * u) { qs -= u; ctx.font = `500 ${qs}px ${FONT}`; }
  const by = y0 + barH * 0.62;
  ctx.font = `800 ${big}px ${FONT}`;
  ctx.fillText(c.ch.rootName, pad - 2 * u, by);
  ctx.font = `500 ${qs}px ${FONT}`;
  ctx.fillText(c.ch.qual, pad + rw + 2 * u, by);
  ctx.font = `500 ${9 * u}px ${FONT}`;
  ctx.fillStyle = GREY;
  const keyName = V.mode === 'single' ? '' : `  ·  ${V.st.key.name}`;
  CS.spaced(ctx, c.roman + keyName, pad, y0 + barH * 0.8, 1.1 * u);
  ctx.fillStyle = RED;
  ctx.font = `600 ${9.5 * u}px ${FONT}`;
  CS.spaced(ctx, c.names.join('  '), pad, y0 + barH * 0.93, 3 * u);
  ctx.globalAlpha = 1;

  CS.drawKeyboard(ctx, V.tl, Math.min(t, V.tl.total - 0.001),
    { x: W - pad - kbW, y: y0 + (barH - kbH) / 2 + 4 * u, w: kbW, h: kbH, lo: 36, hi: 84, lw: Math.max(1, u * 0.8) });
}

function minimal(t) {
  const W = V.w, H = V.h;
  const u = Math.min(W, H) / 540;
  const g = ctx.createLinearGradient(0, H * 0.6, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.6, W, H * 0.4);
  const { c, fade } = chordState(t);
  const pad = 26 * u;
  ctx.globalAlpha = fade;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  const big = 54 * u;
  ctx.font = `800 ${big}px ${FONT}`;
  const rw = ctx.measureText(c.ch.rootName).width;
  const y = H - pad - 26 * u;
  ctx.fillText(c.ch.rootName, pad, y);
  ctx.font = `500 ${big * 0.4}px ${FONT}`;
  ctx.fillText(c.ch.qual, pad + rw + 4 * u, y);
  ctx.font = `600 ${10 * u}px ${FONT}`;
  ctx.fillStyle = '#FF8A6E';
  CS.spaced(ctx, c.names.join('  '), pad, H - pad, 3 * u);
  ctx.globalAlpha = 1;
  // tiny voice dots
  for (let v = 0; v < 5; v++) {
    ctx.fillStyle = v === 0 ? '#fff' : COLORS[v];
    ctx.beginPath();
    ctx.arc(W - pad - (4 - v) * 12 * u, H - pad - 4 * u, 3.5 * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------ UI
function renderChips() {
  const el = $('v-chips');
  el.innerHTML = '';
  el.classList.toggle('static', V.mode !== 'single');
  (V.tokens || []).forEach((tok, i) => {
    const ch = CS.parseChord(CS.stripHalf(tok));
    if (!ch) return;
    const b = document.createElement('button');
    b.className = 'chip' + (V.mode === 'single' && i === V.sel ? ' sel' : '');
    b.innerHTML = `<b>${ch.rootName}${ch.qual}</b>`;
    b.title = V.mode === 'single' ? 'Use this chord under the whole video' : '';
    b.onclick = () => { if (V.mode !== 'single') return; V.sel = i; fit(); };
    el.appendChild(b);
  });
}
function hints() {
  $('v-chordhint').textContent = V.mode === 'single' ? 'Tap the chord to hold' : (V.st ? `${V.st.N} chords fitted to the clip` : '');
  const per = V.D ? `≈${V.D.toFixed(1)}s per chord` : '';
  $('v-timinghint').textContent = V.timing === 'cuts'
    ? (V.analyzing ? 'Scanning for cuts…' : V.cuts.length ? `${V.snapped} of ${Math.max(0, (V.st?.N || 1) - 1)} changes on cuts · ${per}` : `No cuts found · ${per}`)
    : per;
}
function updateUI() {
  const p = $('v-play');
  p.disabled = !V.ready || !!V.rec;
  p.classList.toggle('on', V.playing);
  p.querySelector('.ico').textContent = V.playing ? '❚❚' : '▶';
  p.querySelector('.lbl').textContent = V.playing ? 'Pause' : 'Play';
  $('v-toggle').textContent = V.playing ? '❚❚' : '▶';
  const ex = $('v-export');
  ex.disabled = !V.ready;
  ex.textContent = V.rec ? 'Cancel export' : 'Export video';
  ex.classList.toggle('rec-on', !!V.rec);
  $('v-mixval').textContent = `Chords ${Math.round(V.mix * 100)}%`;
}
const toggle = () => vid.paused ? play() : pause();

app.seg($('v-mode'), { progression: { label: 'Progression' }, single: { label: 'Single chord' } }, V.mode,
  id => { V.mode = id; fit(); renderChips(); hints(); });
app.seg($('v-timing'), { cuts: { label: 'Sync to cuts' }, even: { label: 'Even' } }, V.timing,
  id => { V.timing = id; fit(); });
app.seg($('v-sound'), CS.SOUNDS, V.sound, id => { V.sound = id; if (V.playing) startAudio(); });
app.seg($('v-overlay'), { swiss: { label: 'Swiss bar' }, minimal: { label: 'Minimal' }, none: { label: 'None' } }, V.overlay,
  id => { V.overlay = id; });

$('v-mix').oninput = e => { V.mix = +e.target.value; applyMix(); updateUI(); };
$('v-play').onclick = toggle;
$('v-toggle').onclick = toggle;
cv.onclick = toggle;
$('v-seek').oninput = e => { vid.currentTime = +e.target.value; };
$('v-export').onclick = () => V.rec ? cancelExport() : exportVideo();
$('v-replace').onclick = () => $('v-file').click();
$('v-file').onchange = e => load(e.target.files[0]);
$('v-shuffle').onclick = () => { V.tokens = app.generate(); V.key = { ...app.S.key }; V.sel = 0; fit(); renderChips(); };
$('v-pull').onclick = () => { pullFromCreate(); renderChips(); app.toast('Using the chords from the Create tab'); };

const drop = $('v-drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => load(e.dataTransfer.files[0]));
// allow dropping a new clip onto the player too
cv.addEventListener('dragover', e => e.preventDefault());
cv.addEventListener('drop', e => { e.preventDefault(); load(e.dataTransfer.files[0]); });

document.addEventListener('cs:view', e => {
  if (e.detail !== 'video') { if (V.rec) cancelExport(); pause(); return; }
  if (!V.tokens) { pullFromCreate(false); renderChips(); }
});
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  if (e.code === 'Space' && !$('view-video').hidden && V.ready && !['TEXTAREA', 'INPUT', 'BUTTON'].includes(tag)) {
    e.preventDefault(); toggle();
  }
});

$('v-mix').value = V.mix;
updateUI();
hints();
requestAnimationFrame(draw);
window.__video = V;
})();

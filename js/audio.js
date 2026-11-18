// Chord Study — Web Audio engine. Sustained voices glide between chords; "keys" re-strike each chord.
window.CS = window.CS || {};
(() => {
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const SOUNDS = {
  strings: {
    label: 'Strings', type: 'sustain', wet: 0.55, dip: 0.8,
    upper: { types: ['sawtooth', 'sawtooth', 'sawtooth', 'sawtooth'], det: [-11, -4, 3, 9], gains: [1, 1, 1, 1],
             lp: 2300, breathe: 500, attack: 0.7, vib: 7, level: 0.085 },
    bass:  { types: ['triangle', 'sawtooth'], det: [-4, 4], gains: [1, 0.35], lp: 650, breathe: 80, attack: 0.5, vib: 2, level: 0.15 },
  },
  pad: {
    label: 'Pad', type: 'sustain', wet: 0.85, dip: 0.93,
    upper: { types: ['triangle', 'sawtooth', 'sine', 'sine'], det: [-6, 5, 0, 1200], gains: [1, 0.3, 0.8, 0.16],
             lp: 1400, breathe: 380, attack: 1.3, vib: 3, level: 0.12 },
    bass:  { types: ['sine', 'triangle'], det: [0, 3], gains: [1, 0.5], lp: 420, breathe: 40, attack: 1.0, vib: 0, level: 0.18 },
  },
  keys: { label: 'Keys', type: 'struck', wet: 0.5 },
};

function impulse(ctx, dur, decay) {
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = 0.35 + 0.5 * (i / len);
      lp += ((Math.random() * 2 - 1) - lp) * (1 - k);
      d[i] = lp * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

// Dynamics: level over the piece, u in [0,1]. mode 'build' rises to the peak and holds;
// 'swell' rises to the peak and falls back to the start level by the end.
function envelope(d) {
  if (!d || d.mode === 'off') return null;
  const shapes = {
    smooth: u => u * u * (3 - 2 * u),
    steady: u => u,
    late: u => u * u * u,
  };
  const up = shapes[d.curve] || shapes.smooth;
  const r = Math.max(0.02, Math.min(1, d.reach));
  return u => {
    if (u <= r) return d.start + (d.peak - d.start) * up(u / r);
    if (d.mode === 'build' || r >= 1) return d.peak;
    const w = (u - r) / (1 - r);
    return d.peak + (d.start - d.peak) * shapes.smooth(w);
  };
}
const toneFor = v => 1400 * Math.pow(16000 / 1400, Math.max(0, Math.min(1, v)));
const marking = v => v < 0.2 ? 'pp' : v < 0.38 ? 'p' : v < 0.55 ? 'mp' : v < 0.72 ? 'mf' : v < 0.88 ? 'f' : 'ff';

// ---- mobile audio unlock
// iPhones route Web Audio through the "ambient" channel, which the silent switch mutes.
// Playing a looping, silent <audio> element (and asking for the "playback" session)
// moves the page into the media channel so the chords are heard like a video would be.
let silentEl = null;
function silentWavURL() {
  const rate = 8000, n = rate / 2; // half a second of silence
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
function unlockMediaChannel() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  try {
    if (!silentEl) {
      silentEl = document.createElement('audio');
      silentEl.src = silentWavURL();
      silentEl.loop = true;
      silentEl.setAttribute('playsinline', '');
      silentEl.setAttribute('x-webkit-airplay', 'deny');
      silentEl.preload = 'auto';
    }
    const p = silentEl.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) {}
}

class Player {
  constructor() { this.A = null; this.voices = []; this.notes = []; this.struck = []; this.timer = null; this.t0 = 0; }

  ensure() {
    if (this.A) return;
    const A = this.A = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    const comp = A.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.03; comp.release.value = 0.4;
    const out = A.createGain(); out.gain.value = 0.9;
    // dyn: the crescendo/swell envelope, after the compressor so it isn't flattened
    this.dyn = A.createGain(); this.dyn.gain.value = 1;
    // master: overall fade in/out (used by the Video tab), applies to chords and the clip's own audio
    this.master = A.createGain(); this.master.gain.value = 1;
    comp.connect(this.dyn); this.dyn.connect(out); out.connect(this.master); this.master.connect(A.destination);
    try { this.recDest = A.createMediaStreamDestination(); this.master.connect(this.recDest); }
    catch (e) { this.recDest = null; } // not every mobile browser can record; playback still works

    this.bus = A.createGain(); this.bus.gain.value = 0.75;
    const dry = A.createGain(); dry.gain.value = 0.62;
    this.wet = A.createGain(); this.wet.gain.value = 0.55;
    const pre = A.createDelay(0.2); pre.delayTime.value = 0.035;
    const conv = A.createConvolver(); conv.buffer = impulse(A, 5.5, 2.6);
    const warm = A.createBiquadFilter(); warm.type = 'highshelf'; warm.frequency.value = 5000; warm.gain.value = -6;
    this.bus.connect(dry); dry.connect(warm);
    this.bus.connect(pre); pre.connect(conv); conv.connect(this.wet); this.wet.connect(warm);
    // music and an optional external source (a video's own audio) are mixed separately
    this.music = A.createGain(); this.music.gain.value = 1;
    // dynTone: quieter = darker, louder = brighter, like a real section digging in
    this.dynTone = A.createBiquadFilter(); this.dynTone.type = 'lowpass'; this.dynTone.frequency.value = 20000; this.dynTone.Q.value = 0.5;
    warm.connect(this.dynTone); this.dynTone.connect(this.music); this.music.connect(comp);
    this.external = A.createGain(); this.external.gain.value = 0;
    this.external.connect(out);
    this.out = out;
  }

  // Route a <video>/<audio> element through the mixer (can only be done once per element).
  attachMedia(el) {
    this.ensure();
    if (el._csSource) return;
    el._csSource = this.A.createMediaElementSource(el);
    el._csSource.connect(this.external);
  }
  setLevels(music, external) {
    this.ensure();
    const t = this.A.currentTime;
    this.music.gain.setTargetAtTime(music, t, 0.05);
    this.external.gain.setTargetAtTime(external, t, 0.05);
  }

  now() { return this.A ? this.A.currentTime - this.t0 : 0; }

  // ---- master fade (fade = { in, out, span } in seconds, or null)
  setFade(fade) {
    this.fade = fade;
    if (this.A && this.timer) this.scheduleFade(Math.max(0, this.now() + 0.1), this.A.currentTime + 0.1);
  }
  scheduleFade(fromT, at) {
    const g = this.master.gain, now = this.A.currentTime;
    g.cancelScheduledValues(0);
    g.setValueAtTime(g.value, now);
    const f = this.fade;
    if (!f || (!f.in && !f.out)) { g.setTargetAtTime(1, now, 0.03); return; }
    const level = t => Math.max(0, Math.min(1, f.in ? t / f.in : 1, f.out ? (f.span - t) / f.out : 1));
    const dur = f.span - fromT;
    if (dur < 0.05) { g.setTargetAtTime(level(f.span), now, 0.03); return; }
    g.linearRampToValueAtTime(level(fromT), at);
    const n = Math.max(2, Math.ceil(dur * 30));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = level(fromT + dur * i / (n - 1));
    g.setValueCurveAtTime(curve, at + 0.002, dur);
  }

  // ---- dynamics envelope
  // Change the envelope live (re-schedules from the current playback position).
  setDyn(dyn) {
    this.dynCfg = dyn;
    this.env = envelope(dyn);
    if (this.A && this.timer) this.scheduleDyn(Math.max(0, this.now() + 0.15), this.A.currentTime + 0.15);
  }
  scheduleDyn(fromT, at) {
    const g = this.dyn.gain, f = this.dynTone.frequency;
    const now = this.A.currentTime;
    g.cancelScheduledValues(0); f.cancelScheduledValues(0);
    g.setValueAtTime(g.value, now); f.setValueAtTime(f.value, now);
    this.dynCycleEnd = null;
    if (!this.env) {
      g.setTargetAtTime(1, now, 0.08); f.setTargetAtTime(20000, now, 0.08);
      return;
    }
    const span = this.span;
    const local = this.tl.loop ? CS.mod(fromT, span) : Math.min(fromT, span);
    const dur = span - local;
    if (dur < 0.05) { const v = this.env(1); g.setTargetAtTime(v, now, 0.1); f.setTargetAtTime(toneFor(v), now, 0.1); return; }
    // glide to the envelope's current value, then follow the curve
    const v0 = this.env(local / span);
    g.linearRampToValueAtTime(v0, at); f.linearRampToValueAtTime(toneFor(v0), at);
    this.envCurve(local, at + 0.002, dur);
    this.dynCycleEnd = at + 0.002 + dur;
  }
  envCurve(local, at, dur) {
    const span = this.span;
    const n = Math.max(2, Math.ceil(dur * 24));
    const gs = new Float32Array(n), fs = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = this.env(Math.min(1, (local + dur * i / (n - 1)) / span));
      gs[i] = v; fs[i] = toneFor(v);
    }
    this.dyn.gain.setValueCurveAtTime(gs, at, dur);
    this.dynTone.frequency.setValueCurveAtTime(fs, at, dur);
  }

  // fromK: start playback at chord k (so you can hear a swapped chord right away)
  // opts.offset: start mid-timeline at exactly this time (video sync); opts.releaseLead: fade-out lead
  // Call from inside a tap/click: resumes the audio context and unlocks phone speakers.
  wake() {
    this.ensure();
    unlockMediaChannel();
    if (this.A.state !== 'running') { const p = this.A.resume(); if (p && p.catch) p.catch(() => {}); }
  }

  start(tl, soundId, fromK = 0, opts = {}) {
    this.wake();
    this.stop(0.15);
    this.tl = tl;
    this.sound = SOUNDS[soundId] || SOUNDS.strings;
    const at = this.A.currentTime + 0.08;
    if (opts.offset != null) fromK = tl.indexAt(opts.offset);
    this.t0 = at - (opts.offset != null ? opts.offset : tl.startOf(fromK));
    this.releaseLead = opts.releaseLead ?? 0.4;
    this.span = opts.span || tl.total;
    this.fade = opts.fade || null;
    this.scheduleFade(opts.offset != null ? opts.offset : tl.startOf(fromK), at);
    this.env = envelope(opts.dyn !== undefined ? (this.dynCfg = opts.dyn) : this.dynCfg);
    this.scheduleDyn(opts.offset != null ? opts.offset : tl.startOf(fromK), at);
    this.lastStrike = 0;
    this.nextK = fromK + 1;
    this.endScheduled = false;
    this.wet.gain.setTargetAtTime(this.sound.wet, this.A.currentTime, 0.05);
    if (this.sound.type === 'sustain') {
      this.voices = [0, 1, 2, 3, 4].map(v => this.makeVoice(v, tl.chordAt(fromK).pitches[v], at));
    } else {
      this.strike(fromK, at);
    }
    this.pump();
    this.timer = setInterval(() => this.pump(), 150);
  }

  pump() {
    const tl = this.tl;
    const now = this.now();
    // looping: queue the next cycle of the envelope just before this one ends
    if (tl.loop && this.env && this.dynCycleEnd && this.dynCycleEnd - this.A.currentTime < 1) {
      this.envCurve(0, this.dynCycleEnd + 0.002, this.span);
      this.dynCycleEnd += this.span + 0.002;
    }
    while (this.nextK < tl.Kmax && tl.startOf(this.nextK) - tl.gAt(this.nextK) / 2 < now + 2.5) { this.boundary(this.nextK); this.nextK++; }
    if (!tl.loop && !this.endScheduled && this.nextK >= tl.st.N) {
      this.endScheduled = true;
      const tEnd = this.t0 + tl.total;
      for (const n of [...this.voices, ...this.notes]) {
        n.amp.gain.setTargetAtTime(0, Math.max(tEnd - this.releaseLead, this.lastStrike + 0.3), this.releaseLead > 1 ? 0.6 : 1.1);
        n.srcs.forEach(s => s.stop(tEnd + 7));
      }
    }
  }

  boundary(k) {
    const tl = this.tl;
    const T = this.t0 + tl.startOf(k);
    const g = tl.gAt(k);
    if (this.sound.type === 'struck') { this.strike(k, T); return; }
    for (const n of this.voices) {
      const a = tl.chordAt(k - 1).pitches[n.v], b = tl.chordAt(k).pitches[n.v];
      const s = T - g / 2 + tl.OFF[n.v];
      if (a !== b) {
        const curve = new Float32Array(64);
        for (let i = 0; i < 64; i++) curve[i] = mtof(a + (b - a) * CS.ease(i / 63));
        n.freq.offset.setValueCurveAtTime(curve, s, g);
      }
      n.amp.gain.setTargetAtTime(n.level * this.sound.dip, s, 0.12);
      n.amp.gain.setTargetAtTime(n.level, s + g * 0.55, 0.45);
    }
  }

  makeVoice(v, pitch, t0) {
    const A = this.A, bass = v === 0;
    const cfg = bass ? this.sound.bass : this.sound.upper;
    const pan = [0, -0.4, -0.13, 0.15, 0.4][v];
    const amp = A.createGain(); amp.gain.value = 0;
    const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cfg.lp; lp.Q.value = 0.4;
    const hp = A.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = bass ? 30 : 160;
    const body = A.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = bass ? 180 : 900; body.Q.value = 0.8; body.gain.value = 3;
    const panner = A.createStereoPanner(); panner.pan.value = pan;
    lp.connect(hp); hp.connect(body); body.connect(amp); amp.connect(panner); panner.connect(this.bus);

    const freq = A.createConstantSource();
    freq.offset.setValueAtTime(mtof(pitch), t0);
    const vib = A.createOscillator(); vib.frequency.value = 4.6 + Math.random() * 0.8;
    const vibAmt = A.createGain();
    vibAmt.gain.setValueAtTime(0, t0); vibAmt.gain.linearRampToValueAtTime(cfg.vib, t0 + 2.5);
    vib.connect(vibAmt);
    const br = A.createOscillator(); br.frequency.value = 0.11 + Math.random() * 0.08;
    const brAmt = A.createGain(); brAmt.gain.value = cfg.breathe;
    br.connect(brAmt); brAmt.connect(lp.frequency);

    const total = cfg.gains.reduce((a, b) => a + b, 0);
    const oscs = cfg.types.map((type, i) => {
      const o = A.createOscillator();
      o.type = type;
      o.frequency.value = 0;
      freq.connect(o.frequency);
      o.detune.value = cfg.det[i];
      vibAmt.connect(o.detune);
      const g = A.createGain(); g.gain.value = cfg.gains[i] / total;
      const p = A.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan + (i % 2 ? 0.18 : -0.18)));
      o.connect(g); g.connect(p); p.connect(lp);
      return o;
    });
    amp.gain.setValueAtTime(0, t0);
    amp.gain.setTargetAtTime(cfg.level, t0, cfg.attack);
    const srcs = [freq, vib, br, ...oscs];
    srcs.forEach(s => s.start(t0));
    return { v, amp, freq, srcs, level: cfg.level };
  }

  // Electric-piano-like FM tone, gently rolled from the bass up.
  strike(k, T) {
    const A = this.A, tl = this.tl;
    const prev = this.notes;
    this.lastStrike = Math.max(this.lastStrike, T + 0.2);
    for (const n of prev) {
      n.amp.gain.cancelScheduledValues(T);
      n.amp.gain.setTargetAtTime(0, T, 0.18);
      n.srcs.forEach(s => s.stop(T + 1.5));
    }
    this.notes = tl.chordAt(k).pitches.map((m, v) => {
      // (all struck notes are also tracked in this.struck so stop() can silence pre-scheduled ones)
      const t = T + v * 0.035;
      const f = mtof(m);
      const bass = v === 0;
      const amp = A.createGain(); amp.gain.value = 0;
      const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = bass ? 900 : 4200;
      const pan = A.createStereoPanner(); pan.pan.value = [0, -0.35, -0.12, 0.12, 0.35][v];
      lp.connect(amp); amp.connect(pan); pan.connect(this.bus);
      const car = A.createOscillator(); car.type = 'sine'; car.frequency.value = f;
      const mod = A.createOscillator(); mod.type = 'sine'; mod.frequency.value = f;
      const idx = A.createGain();
      idx.gain.setValueAtTime(f * (bass ? 0.8 : 1.6), t);
      idx.gain.setTargetAtTime(f * 0.18, t, 0.35);
      mod.connect(idx); idx.connect(car.frequency);
      const tine = A.createOscillator(); tine.type = 'sine'; tine.frequency.value = f * 4.01;
      const tg = A.createGain();
      tg.gain.setValueAtTime(bass ? 0 : 0.12, t); tg.gain.setTargetAtTime(0, t, 0.12);
      tine.connect(tg); tg.connect(lp);
      car.connect(lp);
      const L = bass ? 0.2 : 0.11;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(L, t + 0.008);
      amp.gain.setTargetAtTime(L * 0.4, t + 0.008, 1.0);
      const srcs = [car, mod, tine];
      srcs.forEach(s => s.start(t));
      return { amp, srcs };
    });
    this.struck.push(...this.notes);
  }

  stop(fade = 0.25) {
    clearInterval(this.timer);
    this.timer = null;
    if (!this.A) return;
    const now = this.A.currentTime;
    for (const n of [...this.voices, ...this.struck]) {
      n.amp.gain.cancelScheduledValues(now);
      n.amp.gain.setValueAtTime(n.amp.gain.value, now);
      n.amp.gain.setTargetAtTime(0, now, fade / 3);
      n.srcs.forEach(s => { try { s.stop(now + fade + 0.3); } catch (e) {} });
    }
    this.voices = []; this.notes = []; this.struck = [];
  }
}

CS.Player = Player;
CS.envelope = envelope;
CS.dynMarking = marking;
CS.SOUNDS = SOUNDS;
})();

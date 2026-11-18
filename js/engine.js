// Chord Study — music theory engine: parsing, voicing, roman numerals, mood generator.
window.CS = window.CS || {};
(() => {
const LETTERS = ['C','D','E','F','G','A','B'];
const NAT = [0,2,4,5,7,9,11];
const MAJ = [0,2,4,5,7,9,11];
const MIN = [0,2,3,5,7,8,10];
const ROMAN = ['I','II','III','IV','V','VI','VII'];
const mod = (a, n) => ((a % n) + n) % n;
const accStr = a => a > 0 ? '♯'.repeat(a) : a < 0 ? '♭'.repeat(-a) : '';
const nameOf = (letter, pc) => LETTERS[mod(letter, 7)] + accStr(mod(pc - NAT[mod(letter, 7)] + 6, 12) - 6);
// like nameOf, but never produces double sharps/flats (E♭♭ → D)
const spell = (letter, pc) => {
  const acc = l => mod(pc - NAT[mod(l, 7)] + 6, 12) - 6;
  if (Math.abs(acc(letter)) < 2) return nameOf(letter, pc);
  const l2 = acc(letter) > 0 ? letter + 1 : letter - 1;
  return nameOf(l2, pc);
};
const ease = u => u * u * u * (u * (u * 6 - 15) + 10);
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

function parseNote(s) {
  const m = s.match(/^([A-Ga-g])([#b♯♭]*)$/);
  if (!m) return null;
  const letter = LETTERS.indexOf(m[1].toUpperCase());
  let acc = 0;
  for (const ch of m[2]) acc += (ch === '#' || ch === '♯') ? 1 : -1;
  return { letter, pc: mod(NAT[letter] + acc, 12) };
}
const prettyQual = q => q.replace(/#/g, '♯').replace(/b(?=\d)/g, '♭');

function parseChord(tok) {
  const m = tok.match(/^([A-Ga-g])([#♯b♭]?)(.*)$/);
  if (!m) return null;
  const root = parseNote(m[1] + m[2]);
  let rest = m[3];
  let bass = null;
  const sl = rest.match(/^(.*)\/([A-Ga-g][#♯b♭]?)$/);
  if (sl) { bass = parseNote(sl[2]); rest = sl[1]; if (!bass) return null; }
  const typed = rest;

  let s = rest.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/Δ/g, 'maj').replace(/°/g, 'dim').replace(/ø7?/g, 'm7b5')
              .replace(/[()]/g, '').replace(/,/g, '');
  s = s.replace(/^(maj|Maj|MAJ|M(?!in|IN))/, 'maj').replace(/^(min|-)/, 'm');
  const f = { maj: false, minor: false, dim: false, aug: false, num: 0, six: false, sixnine: false,
              sus: null, alts: {}, adds: [], no3: false, power: false };
  if (s.startsWith('maj')) { f.maj = true; s = s.slice(3); }
  else if (s.startsWith('dim')) { f.dim = true; s = s.slice(3); }
  else if (s.startsWith('aug') || s.startsWith('+')) { f.aug = true; s = s.slice(s[0] === '+' ? 1 : 3); }
  else if (/^m(?!aj)/.test(s)) { f.minor = true; s = s.slice(1); }
  if (/^(maj|Maj|M)/.test(s)) { f.maj = true; s = s.replace(/^(maj|Maj|M)/, ''); }
  const n = s.match(/^(6\/9|69|13|11|9|7|6|5)/);
  if (n) {
    s = s.slice(n[0].length);
    if (n[0] === '6/9' || n[0] === '69') f.sixnine = true;
    else if (n[0] === '6') f.six = true;
    else if (n[0] === '5') f.power = true;
    else f.num = +n[0];
  }
  if (f.maj && !f.num && !f.six && !f.sixnine) f.num = 7;
  while (s.length) {
    let t;
    if ((t = s.match(/^sus(2|4)?/))) { f.sus = t[1] ? +t[1] : 4; }
    else if ((t = s.match(/^add(2|4|9|11|13)/))) { f.adds.push(+t[1]); }
    else if ((t = s.match(/^([b#])(5|9|11|13)/))) { f.alts[+t[2]] = t[1] === '#' ? 1 : -1; }
    else if ((t = s.match(/^no3/))) { f.no3 = true; }
    else if ((t = s.match(/^alt/))) { f.alts[9] = -1; f.alts[13] = -1; if (!f.num) f.num = 7; }
    else if ((t = s.match(/^(maj|M)/))) { f.maj = true; }
    else if ((t = s.match(/^(13|11|9|7|6)/))) { if (+t[1] === 6) f.six = true; else f.num = Math.max(f.num, +t[1]); }
    else return null;
    s = s.slice(t[0].length);
  }

  const iv = [{ deg: 1, semi: 0 }];
  if (!f.power && !f.no3) {
    if (f.sus === 4) iv.push({ deg: 4, semi: 5 });
    else if (f.sus === 2) iv.push({ deg: 2, semi: 2 });
    else if (f.minor || f.dim) iv.push({ deg: 3, semi: 3 });
    else iv.push({ deg: 3, semi: 4 });
  }
  let fifth = 7;
  if (f.dim) fifth = 6;
  if (f.aug) fifth = 8;
  if (f.alts[5]) fifth = 7 + f.alts[5];
  iv.push({ deg: 5, semi: fifth, altered: fifth !== 7 });
  if (f.six || f.sixnine) iv.push({ deg: 6, semi: 9 });
  if (f.sixnine) iv.push({ deg: 9, semi: 14 });
  if (f.num >= 7) {
    let sev = 10;
    if (f.maj) sev = 11;
    else if (f.dim && f.num === 7 && !f.alts[5]) sev = 9;
    iv.push({ deg: 7, semi: sev });
  }
  if (f.num >= 9) iv.push({ deg: 9, semi: 14 });
  if (f.num >= 11 && (f.num === 11 || f.minor) && f.sus !== 4) iv.push({ deg: 11, semi: 17 });
  if (f.num >= 13) iv.push({ deg: 13, semi: 21 });
  for (const a of f.adds) {
    const map = { 2: [9, 14], 4: [11, 17], 9: [9, 14], 11: [11, 17], 13: [13, 21] };
    const [deg, semi] = map[a];
    if (!iv.some(x => x.deg === deg)) iv.push({ deg, semi });
  }
  for (const k of [9, 11, 13]) {
    if (!f.alts[k]) continue;
    const base = { 9: 14, 11: 17, 13: 21 }[k];
    const i = iv.findIndex(x => x.deg === k);
    const item = { deg: k, semi: base + f.alts[k], altered: true };
    if (i >= 0) iv[i] = item; else iv.push(item);
  }
  if ((f.alts[9] || f.alts[11] || f.alts[13]) && !iv.some(x => x.deg === 7)) iv.push({ deg: 7, semi: f.maj ? 11 : 10 });

  const tones = iv.map(x => ({ ...x, pc: mod(root.pc + x.semi, 12), name: nameOf(root.letter + x.deg - 1, root.pc + x.semi) }));
  const bassTone = bass ? { deg: 0, pc: bass.pc, name: nameOf(bass.letter, bass.pc) } : tones[0];
  const isMinor = (f.minor || f.dim) && f.sus == null;
  return {
    token: tok, root, bass: bassTone, tones, flags: f, isMinor,
    rootName: nameOf(root.letter, root.pc),
    qual: prettyQual(typed) + (bass ? '/' + bassTone.name : ''),
    rawQual: typed,
  };
}

function upperTones(ch) {
  const pr = t => {
    if (t.deg === 3 || t.deg === 2 || t.deg === 4) return 0;
    if (t.deg === 7 || t.deg === 6) return 1;
    if (t.altered && t.deg !== 5) return 1.5;
    if (t.deg === 13) return 2;
    if (t.deg === 11) return 2.2;
    if (t.deg === 9) return 3;
    if (t.deg === 5) return t.altered ? 1.6 : 4;
    return 5;
  };
  const ts = ch.tones.filter(t => t.deg !== 1 && t.pc !== ch.bass.pc).sort((a, b) => pr(a) - pr(b)).slice(0, 4);
  const fill = [ch.tones[0], ...ch.tones.filter(t => t.deg === 5), ...ch.tones.filter(t => t.deg === 3), ch.tones[0]];
  let i = 0;
  while (ts.length < 4) ts.push(fill[i++ % fill.length]);
  return ts;
}

// Smoothest-possible voice leading: every 4-note placement in range is scored by movement.
const UP_LO = 52, UP_HI = 79;
function voiceUpper(tones, prev) {
  const cands = tones.map(t => { const a = []; for (let m = UP_LO; m <= UP_HI; m++) if (mod(m, 12) === t.pc) a.push({ m, t }); return a; });
  let best = null, bestCost = Infinity;
  const pick = [];
  const rec = i => {
    if (i === tones.length) {
      const v = [...pick].sort((a, b) => a.m - b.m);
      for (let j = 1; j < v.length; j++) if (v[j].m === v[j - 1].m) return;
      const span = v[3].m - v[0].m;
      if (span > 19) return;
      let c = 0;
      for (let j = 1; j < v.length; j++) {
        const gap = v[j].m - v[j - 1].m;
        if (gap < 3 && v[j - 1].m < 57) c += 4;
        if (gap > 9) c += (gap - 9) * 1.5;
      }
      if (v[3].m - v[2].m === 1) c += 2.5;
      const avg = v.reduce((a, x) => a + x.m, 0) / 4;
      if (prev) {
        for (let j = 0; j < 4; j++) c += Math.abs(v[j].m - prev[j]) * (j === 3 ? 1.5 : 1);
        c += Math.abs(avg - 65) * 0.15;
      } else {
        c += Math.abs(avg - 65) + Math.abs(span - 13) * 0.6;
      }
      if (c < bestCost) { bestCost = c; best = v; }
      return;
    }
    for (const x of cands[i]) { pick.push(x); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return best;
}
function voiceBass(pc, prev) {
  let best = null, bc = Infinity;
  for (let m = 36; m <= 50; m++) {
    if (mod(m, 12) !== pc) continue;
    const c = prev == null ? Math.abs(m - 43) : Math.abs(m - prev) + (m < 38 ? 3 : 0);
    if (c < bc) { bc = c; best = m; }
  }
  return best;
}

function romanFor(ch, key) {
  const d = mod(ch.root.letter - key.letter, 7);
  const scale = key.minor ? MIN : MAJ;
  const diff = mod(ch.root.pc - (key.pc + scale[d]) + 6, 12) - 6;
  let num = ROMAN[d];
  if (ch.isMinor) num = num.toLowerCase();
  let q = ch.rawQual.replace(/♯/g, '#').replace(/♭/g, 'b');
  const f = ch.flags;
  if (f.minor && /m7b5|ø/.test(q)) q = 'ø7' + q.replace(/^(min|m|-)?7?b5|ø7?/, '').replace(/^7/, '');
  else if (f.dim) q = '°' + q.replace(/^(dim|°)/, '');
  else if (f.minor) q = q.replace(/^(min|m|-)(?!aj)/, '');
  return accStr(diff) + num + prettyQual(q);
}

const tokenize = text => text.replace(/→|->|–>|=>|\||,|;/g, ' ').trim().split(/\s+/).filter(Boolean);

function keyOf(name, minor) { const n = parseNote(name.replace('♯', '#').replace('♭', 'b')); return { letter: n.letter, pc: n.pc, minor: !!minor }; }
const keyLabel = key => nameOf(key.letter, key.pc);
const keyName = key => keyLabel(key).toUpperCase() + (key.minor ? ' MINOR' : ' MAJOR');

// A trailing "~" on a chord means it lasts half as long (passing chords).
const isHalf = t => /~$/.test(t);
const stripHalf = t => t.replace(/~+$/, '');

function transposeToken(tok, from, to) {
  const half = isHalf(tok);
  tok = stripHalf(tok);
  const dl = to.letter - from.letter, ds = to.pc - from.pc;
  const mv = s => { const n = parseNote(s); return spell(n.letter + dl, n.pc + ds); };
  const m = tok.match(/^([A-Ga-g][#♯b♭]?)(.*?)(?:\/([A-Ga-g][#♯b♭]?))?$/);
  if (!m) return tok + (half ? '~' : '');
  return mv(m[1]) + m[2] + (m[3] ? '/' + mv(m[3]) : '') + (half ? '~' : '');
}

function buildStudy(tokens, key) {
  if (!tokens.length) throw new Error('Add at least one chord.');
  const chords = tokens.map(t => { const c = parseChord(stripHalf(t)); if (!c) throw new Error(`Couldn't read "${t}".`); return c; });
  if (!key) key = { letter: chords[0].root.letter, pc: chords[0].root.pc, minor: chords[0].isMinor };
  let prevU = null, prevB = null, lo = 999, hi = -999;
  const out = chords.map((ch, i) => {
    const v = voiceUpper(upperTones(ch), prevU);
    const b = voiceBass(ch.bass.pc, prevB);
    prevU = v.map(x => x.m); prevB = b;
    const pitches = [b, ...prevU];
    pitches.forEach(p => { lo = Math.min(lo, p); hi = Math.max(hi, p); });
    const roman = romanFor(ch, key) + (ch.bass !== ch.tones[0] ? '/' + ch.bass.name : '');
    return { ch, roman, pitches, names: [ch.bass.name, ...v.map(x => x.t.name)],
             token: tokens[i], beats: isHalf(tokens[i]) ? 0.5 : 1 };
  });
  return { key: { ...key, name: keyName(key) }, chords: out, N: out.length, range: [lo - 3, hi + 3] };
}

// ------------------------------------------------------------ moods
// Spec syntax: [b|#]ROMAN:quality[@bassROMAN][~]   e.g.  bII:7#11   IV:maj7@V   #I:dim7~
// Numerals are measured against the major scale. Templates starting with "!" are the more adventurous ones.
const MOODS = [
  { id: 'dreamy', name: 'Dreamy', blurb: 'Floating, soft, open', color: '#3F9488', minor: false, templates: [
    'I:maj9 vi:m9 IV:maj9 V:13sus4 iii:m11 vi:m9 ii:m9 V:13 I:maj9',
    'I:maj9 iii:m9 IV:maj9 iv:m9 I:maj9 vi:m11 ii:m9 V:9sus4 I:maj9',
    'IV:maj9 V:13sus4 iii:m9 vi:m9 ii:m11 V:13 I:6/9',
    'I:maj9 V:9sus4 vi:m9 IV:maj7#11 iii:m11 vi:m9 ii:m9 V:13sus4 I:maj9',
    '!I:maj9 #IV:m7b5 IV:maj9 iv:m6 iii:m11 VI:7b9 ii:m9 bII:7#11 I:maj9#11',
    '!IV:maj9 IV:maj7@V iii:m9 VI:7b9b13 ii:m11 bII:9#11 I:maj9',
  ]},
  { id: 'nostalgic', name: 'Nostalgic', blurb: 'Warm, bittersweet', color: '#EFB32A', minor: false, templates: [
    'I:maj7 V:9sus4 vi:m9 iii:m7 IV:maj9 I:maj7 ii:m9 V:13sus4 I:maj9',
    'IV:maj9 iv:m6 I:maj9 vi:m9 ii:m9 bVII:9 I:maj9',
    'I:maj9 I:7 IV:maj9 iv:m9 iii:m7 vi:m9 ii:m9 V:13 I:6/9',
    '!I:maj9 III:7b9 vi:m9 I:9@bVII IV:maj9 iv:m6 I:maj7@V ii:m9 V:13b9 I:6/9',
  ]},
  { id: 'hopeful', name: 'Hopeful', blurb: 'Bright, rising', color: '#E2452C', minor: false, templates: [
    'IV:maj9 V:9sus4 vi:m9 I:maj9 IV:maj7#11 V:13sus4 I:maj9',
    'vi:m9 IV:maj9 I:maj9 V:9sus4 vi:m11 IV:maj9 V:13 I:maj9',
    'I:maj9 V:9sus4 vi:m9 IV:maj9 I:6/9 ii:m9 IV:maj9 V:13sus4 I:maj9',
    '!IV:maj9 V:13sus4 iii:m7 VI:7b9 ii:m9 ii:m9@V I:maj9@III IV:maj9 V:13b9 I:maj9',
  ]},
  { id: 'neosoul', name: 'Neo-soul', blurb: 'Lush, jazzy, smooth', color: '#2E5BD6', minor: false, templates: [
    'IV:maj9 iii:m7 vi:m9 ii:m9 V:13sus4 V:7b9 I:maj9',
    'ii:m9 V:13 iii:m7 VI:7b9 ii:m11 V:9sus4 I:maj9',
    'I:maj9 bVII:9 IV:maj9 iv:m9 iii:m9 VI:7#9 ii:m9 V:13 I:6/9',
    '!ii:m11 V:7alt I:maj9 VI:13b9 ii:m9 bII:9#11 I:6/9',
    '!IV:maj9 III:7#9 vi:m11 bVII:13 bVI:maj7#11 V:7alt I:maj9',
  ]},
  { id: 'lofi', name: 'Lo-fi night', blurb: 'Late, mellow, looped', color: '#8C8880', minor: false, templates: [
    'ii:m9 V:13 I:maj9 vi:m9 ii:m11 V:7b9 I:maj9 I:6/9',
    'IV:maj9 iii:m9 ii:m9 I:maj9 IV:maj9 iii:m7 vi:m9 V:13sus4 I:maj9',
    'I:maj9 vi:m9 ii:m9 V:13 iii:m7 VI:7b9 ii:m9 V:13sus4 I:maj9',
    '!ii:m9 bII:7#11 I:maj9 VI:7b9b13 ii:m11 V:13b9 iii:m7 bIII:13 ii:m9 bII:9#11 I:maj9',
  ]},
  { id: 'melancholy', name: 'Melancholy', blurb: 'Rainy, tender', color: '#5B6FA8', minor: true, templates: [
    'i:m9 bVI:maj9 iv:m9 bVII:13sus4 bIII:maj9 bVI:maj9 ii:m7b5 V:7b9 i:m9',
    'i:m11 iv:m9 bVII:9sus4 bIII:maj9 bVI:maj7 ii:m7b5 V:7b13 i:m9',
    'i:m9 v:m9 bVI:maj9 bIII:maj9 iv:m11 bVII:13sus4 i:m9',
    '!i:m9 bVI:maj7#11 iv:m9 V:7b9b13 i:m11 bII:maj7#11 ii:m7b5 V:7alt i:m(maj9)',
  ]},
  { id: 'cinematic', name: 'Cinematic', blurb: 'Wide, slow, epic', color: '#151515', minor: true, templates: [
    'i:madd9 bVI:maj9 bIII:maj9 bVII:6/9 i:m11 iv:m9 bVI:maj7#11 V:7sus4 i:m9',
    'i:madd9 bVI:maj9 bVII:6/9 i:m9 iv:m11 bVI:maj7#11 bVII:13sus4 i:madd9',
    'bVI:maj9 bVII:6/9 i:m9 v:m9 bVI:maj7#11 bIII:maj9 bVII:13sus4 i:m11',
    '!i:madd9 bVI:maj9 bIII:maj7#5 bVII:6/9 iv:m11 bII:maj7#11 V:7alt i:m(maj9)',
    '!bVI:maj7#11 bVII:13sus4 i:m9 bIII:maj9 iv:m11 V:7b9b13 bVI:maj9 bII:maj7#11 i:m11',
  ]},
];

// Equivalent colours that always sound good, used to vary each generation.
const VARIANTS = {
  'maj9': ['maj7', '6/9', 'maj9', 'maj9'],
  'm9': ['m11', 'm7', 'm9', 'm9'],
  'm11': ['m9', 'm11'],
  '13sus4': ['9sus4', '13sus4'],
  '9sus4': ['13sus4', '9sus4'],
  '13': ['9', '13', '13'],
  'maj7#11': ['maj9#11', 'maj7#11'],
};
const pickOne = a => a[Math.floor(Math.random() * a.length)];

function parseRoman(r) {
  const m = r.match(/^([b#]*)([ivIV]+)$/);
  if (!m) throw new Error('bad numeral ' + r);
  const deg = ROMAN.indexOf(m[2].toUpperCase());
  let shift = 0;
  for (const ch of m[1]) shift += ch === '#' ? 1 : -1;
  return { deg, semi: mod(MAJ[deg] + shift, 12) };
}
function parseSpec(sp) {
  const half = sp.endsWith('~');
  if (half) sp = sp.slice(0, -1);
  const [r, rest] = sp.split(':');
  const [q, b] = rest.split('@');
  return { ...parseRoman(r), q, bass: b ? parseRoman(b) : null, half };
}
function specToToken(key, o) {
  return spell(key.letter + o.deg, key.pc + o.semi) + o.q +
    (o.bass ? '/' + spell(key.letter + o.bass.deg, key.pc + o.bass.semi) : '') + (o.half ? '~' : '');
}
function romanToToken(key, spec) { return specToToken(key, parseSpec(spec)); }

// ------------------------------------------------------------ reharmonisation
// Each move rewrites the progression the way a jazz arranger would. Total time never changes:
// inserted chords split an existing slot into two half-length chords.
const isMinQ = q => /^m(?!aj)/.test(q) || /dim/.test(q);
const isDomQ = q => /^(7|9|13)/.test(q);
const fifthDown = (a, b) => b && mod(a.semi - b.semi, 12) === 7;
const resolves = (a, b) => b && (fifthDown(a, b) || mod(a.semi - b.semi, 12) === 1);
const idxs = (a, f) => a.map((_, i) => i).filter(i => f(i));
const MAX_LEN = 12;

const MOVES = {
  // secondary dominant: the chord before a target becomes that target's own V7
  secondary(a) {
    const c = idxs(a, i => i >= 2 && !isDomQ(a[i - 1].q) && !/dim|b5/.test(a[i].q) && !a[i - 1].bass &&
                           a[i - 1].semi !== a[i].semi && mod(a[i].semi + 7, 12) !== a[i - 2].semi &&
                           !(isDomQ(a[i - 2].q) && resolves(a[i - 2], a[i - 1])));
    if (!c.length) return false;
    const i = pickOne(c), t = a[i];
    a[i - 1] = { deg: (t.deg + 4) % 7, semi: mod(t.semi + 7, 12), half: a[i - 1].half, bass: null,
                 q: isMinQ(t.q) ? pickOne(['7b9', '7b9b13']) : pickOne(['13', '7b9', '13b9']) };
    return true;
  },
  // altered dominant: add b9 / #9 / b13 tension to any V7 that resolves
  alter(a) {
    const c = idxs(a, i => isDomQ(a[i].q) && !/sus|#11|alt|b9|#9/.test(a[i].q) && resolves(a[i], a[i + 1]));
    if (!c.length) return false;
    const i = pickOne(c);
    a[i].q = isMinQ(a[i + 1].q) ? pickOne(['7b9b13', '7alt', '7b9']) : pickOne(['13b9', '7#9', '7b9b13', '7alt']);
    return true;
  },
  // tritone substitution: V7 → bII7(#11), giving a chromatic slide in the bass
  tritone(a) {
    const c = idxs(a, i => i > 0 && isDomQ(a[i].q) && !/sus/.test(a[i].q) && fifthDown(a[i], a[i + 1]));
    if (!c.length) return false;
    const i = pickOne(c);
    a[i] = { deg: (a[i].deg + 4) % 7, semi: mod(a[i].semi + 6, 12), half: a[i].half, bass: null,
             q: pickOne(['7#11', '9#11', '13#11']) };
    return true;
  },
  // ii–V: split a dominant's slot into its related ii chord + the dominant
  iiV(a) {
    if (a.length >= MAX_LEN) return false;
    const c = idxs(a, i => i >= 1 && isDomQ(a[i].q) && !a[i].half && fifthDown(a[i], a[i + 1]) &&
                           !(mod(a[i - 1].semi - a[i].semi, 12) === 7 && isMinQ(a[i - 1].q)));
    if (!c.length) return false;
    const i = pickOne(c);
    const ii = { deg: (a[i].deg + 4) % 7, semi: mod(a[i].semi + 7, 12), half: true, bass: null,
                 q: isMinQ(a[i + 1].q) ? 'm7b5' : pickOne(['m9', 'm11']) };
    a[i].half = true;
    a.splice(i, 0, ii);
    return true;
  },
  // passing diminished: bridge a whole-step bass move chromatically (C → C#dim7 → Dm)
  passing(a) {
    if (a.length >= MAX_LEN) return false;
    const c = idxs(a, i => i < a.length - 1 && !a[i].half && !a[i].bass && !isDomQ(a[i].q) &&
                           [2, 10].includes(mod(a[i + 1].semi - a[i].semi, 12)));
    if (!c.length) return false;
    const i = pickOne(c);
    const up = mod(a[i + 1].semi - a[i].semi, 12) === 2;
    a[i].half = true;
    a.splice(i + 1, 0, { deg: up ? a[i].deg : a[i + 1].deg, semi: mod(a[i].semi + (up ? 1 : -1), 12), q: 'dim7', half: true, bass: null });
    return true;
  },
  // backdoor cadence: iv – bVII7 – I instead of V – I (major keys)
  backdoor(a, minor) {
    if (minor) return false;
    const L = a.length - 1, i = L - 1;
    if (i < 1 || !isDomQ(a[i].q) || a[L].semi !== 0) return false;
    a[i] = { deg: 6, semi: 10, q: pickOne(['9', '13']), half: a[i].half, bass: null };
    if (a[i - 1].semi === 5 && !isMinQ(a[i - 1].q)) a[i - 1].q = 'm9';
    return true;
  },
  // slash-chord pedal: V13sus4 → IVmaj7/V (the classic "F over G" sound)
  pedal(a) {
    const c = idxs(a, i => /^(13|9)sus4$/.test(a[i].q) && !a[i].bass);
    if (!c.length) return false;
    const i = pickOne(c);
    a[i] = { deg: (a[i].deg + 6) % 7, semi: mod(a[i].semi - 2, 12), q: pickOne(['maj7', 'maj9']),
             bass: { deg: a[i].deg, semi: a[i].semi }, half: a[i].half };
    return true;
  },
  // a final tonic with an extra shimmer
  tonic(a, minor) {
    const L = a[a.length - 1];
    if (L.semi !== (minor ? 0 : 0) || L.bass) return false;
    L.q = minor ? pickOne(['m(maj9)', 'm6/9', 'm11']) : pickOne(['maj9#11', '6/9', 'maj13']);
    return true;
  },
};

function reharm(a, level, minor) {
  if (level === 'smooth') return a;
  const chance = (p, m) => Math.random() < p ? m : null;
  const plan = level === 'rich'
    ? [pickOne(['alter', 'secondary', 'tonic', 'pedal', 'passing', null])]
    : [chance(0.8, 'secondary'), pickOne(['tritone', 'alter', 'alter']), pickOne(['iiV', 'passing']),
       pickOne(['alter', 'pedal', 'backdoor', 'passing', 'tritone']), chance(0.7, 'tonic')];
  for (const m of plan) if (m) MOVES[m](a, minor);
  return a;
}

const LEVELS = { smooth: { label: 'Smooth' }, rich: { label: 'Rich' }, spicy: { label: 'Spicy' } };
let lastTpl = {};
function generate(moodId, key, templateIndex, level = 'rich') {
  const mood = MOODS.find(m => m.id === moodId) || MOODS[0];
  let idx = templateIndex;
  if (idx == null) {
    const all = mood.templates.map((t, i) => i);
    const plain = all.filter(i => !mood.templates[i].startsWith('!'));
    const spicy = all.filter(i => mood.templates[i].startsWith('!'));
    let pool = level === 'smooth' ? plain : level === 'spicy' && spicy.length && Math.random() < 0.7 ? spicy : all;
    if (pool.length > 1) pool = pool.filter(i => i !== lastTpl[mood.id]);
    idx = pickOne(pool);
  }
  lastTpl[mood.id] = idx;
  const specs = mood.templates[idx].replace(/^!/, '').split(' ').map(parseSpec);
  if (templateIndex == null && level !== 'smooth') {
    specs.forEach((s, i) => {
      if (i > 0 && i < specs.length - 1 && VARIANTS[s.q] && Math.random() < 0.35) s.q = pickOne(VARIANTS[s.q]);
    });
    reharm(specs, level, key.minor);
  }
  return specs.map(s => specToToken(key, s));
}

// Chords that fit the key at any position, for the "tap to swap" feature.
const SWAPS = {
  major: ['I:maj9', 'I:6/9', 'ii:m9', 'ii:m11', 'iii:m9', 'iii:m7', 'IV:maj9', 'IV:maj7#11', 'iv:m9', 'iv:m6',
          'V:13sus4', 'V:9sus4', 'V:13', 'V:13b9', 'V:7alt', 'vi:m9', 'vi:m11', 'bVII:9', 'VI:7b9', 'III:7b9',
          'II:9', 'bII:7#11', 'bVI:maj7#11', 'IV:maj7@V', '#IV:m7b5'],
  minor: ['i:m9', 'i:m11', 'iv:m9', 'iv:m11', 'iv:m6', 'v:m9', 'bIII:maj9', 'bIII:maj7#5', 'bVI:maj9', 'bVI:maj7#11',
          'bVII:13sus4', 'bVII:6/9', 'ii:m7b5', 'V:7b9', 'V:7b9b13', 'V:7alt', 'V:7sus4', 'bII:maj7#11', 'bVI:7#11'],
};
function swapChord(tokens, i, key) {
  const pool = (key.minor ? SWAPS.minor : SWAPS.major).map(s => romanToToken(key, s));
  const rootOf = t => { const c = t && parseChord(stripHalf(t)); return c ? c.root.pc : -1; };
  const avoid = [tokens[i - 1], tokens[i], tokens[i + 1]].map(rootOf);
  const options = pool.filter(t => !avoid.includes(rootOf(t)));
  return pickOne(options.length ? options : pool) + (isHalf(tokens[i]) ? '~' : '');
}

// Shared timeline: where every voice is at time t (visuals and audio both read this).
const OFF = [0, 0.05, 0.025, 0.075, 0.1];
function timeline(st, D, gFrac, loop) {
  const N = st.N;
  const beats = st.chords.map(c => c.beats || 1);
  const starts = [];
  let acc = 0;
  beats.forEach(b => { starts.push(acc); acc += b; });
  const total = acc * D;
  const g = D * gFrac;
  const Kmax = loop ? Infinity : N;
  const chordAt = k => st.chords[mod(k, N)];
  const startOf = k => Math.floor(k / N) * total + starts[mod(k, N)] * D;
  const durOf = k => beats[mod(k, N)] * D;
  const gAt = k => Math.min(g, 0.85 * durOf(k - 1), 0.85 * durOf(k));
  const indexAt = t => {
    if (t <= 0) return 0;
    const cyc = Math.floor(t / total), lt = t - cyc * total;
    let i = N - 1;
    for (let j = 1; j < N; j++) if (starts[j] * D > lt) { i = j - 1; break; }
    return Math.min(cyc * N + i, Kmax - 1);
  };
  const pitchAt = (v, t) => {
    const tt = t - OFF[v];
    const k = indexAt(tt);
    for (const b of [k, k + 1]) {
      if (b < 1 || b > Kmax - 1) continue;
      const gb = gAt(b), dt = tt - startOf(b);
      if (Math.abs(dt) < gb / 2) {
        const a = chordAt(b - 1).pitches[v], c = chordAt(b).pitches[v];
        return a + (c - a) * ease((dt + gb / 2) / gb);
      }
    }
    return chordAt(k).pitches[v];
  };
  return { st, D, g, loop, Kmax, chordAt, pitchAt, startOf, durOf, gAt, indexAt, chordIndexAt: indexAt, total, OFF };
}

Object.assign(CS, {
  mod, ease, mtof, nameOf, parseNote, parseChord, buildStudy, tokenize, keyOf, keyLabel, keyName,
  romanToToken, transposeToken, generate, swapChord, timeline, MOODS, LEVELS, isHalf, stripHalf,
  KEYS_MAJOR: ['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'],
  KEYS_MINOR: ['C','C♯','D','E♭','E','F','F♯','G','G♯','A','B♭','B'],
});
})();

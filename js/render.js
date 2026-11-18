// Chord Study — draws the Swiss-style card onto a canvas (logical size 540×960).
window.CS = window.CS || {};
(() => {
const W = 540, H = 960;
const BG = '#EEEBE4', INK = '#151515', GREY = '#8C8880', RED = '#E0452B';
const COLORS = [INK, '#2E5BD6', '#E2452C', '#EFB32A', '#3F9488']; // bass, then upper voices low→high
const FONT = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const TL_TOP = 292, TL_BOT = 700, PLAY_X = W * 0.34;
const KB = { x: 38, y: 722, w: 464, h: 56, lo: 36, hi: 84 };
const isBlack = m => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

function spaced(c, text, x, y, sp, align = 'left') {
  const chars = [...text];
  const widths = chars.map(ch => c.measureText(ch).width);
  const w = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
  let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
  c.textAlign = 'left';
  chars.forEach((ch, i) => { c.fillText(ch, cx, y); cx += widths[i] + sp; });
  return w;
}

// o: { no, scale, settled }  settled=true shows the chord title without the swap fade
function render(c, tl, t, o) {
  const st = tl.st, D = tl.D;
  const [lo, hi] = st.range;
  const yOf = p => 680 - (p - lo) / (hi - lo) * 350;
  c.setTransform(o.scale, 0, 0, o.scale, 0, 0);
  c.fillStyle = BG;
  c.fillRect(0, 0, W, H);
  c.textBaseline = 'alphabetic';

  // header
  c.fillStyle = INK;
  c.font = `600 10.5px ${FONT}`;
  spaced(c, 'CHORD STUDY', 38, 60, 1.1);
  spaced(c, 'NO. ' + String(o.no).padStart(2, '0'), W - 38, 60, 1.1, 'right');
  c.fillRect(38, 70, W - 76, 1.4);

  // current chord
  const kNow = tl.chordIndexAt(t);
  const cur = tl.chordAt(kNow);
  const since = t - tl.startOf(kNow);
  const fade = o.settled ? 1 : Math.min(1, since / 0.28);
  c.globalAlpha = fade;
  const lift = (1 - CS.ease(fade)) * 6;
  c.fillStyle = INK;
  c.font = `800 100px ${FONT}`;
  const rootW = c.measureText(cur.ch.rootName).width;
  c.textAlign = 'left';
  c.fillText(cur.ch.rootName, 34, 172 + lift);
  let qs = 36;
  c.font = `500 ${qs}px ${FONT}`;
  while (c.measureText(cur.ch.qual).width > W - 76 - rootW && qs > 18) { qs -= 2; c.font = `500 ${qs}px ${FONT}`; }
  c.fillText(cur.ch.qual, 34 + rootW + 6, 172 + lift);

  c.font = `500 12px ${FONT}`;
  c.fillStyle = GREY;
  const x = 38 + spaced(c, cur.roman, 38, 214, 1.4);
  c.fillStyle = RED;
  spaced(c, '·', x + 14, 214, 0);
  c.fillStyle = GREY;
  spaced(c, st.key.name, x + 30, 214, 1.6);

  c.font = `600 13.5px ${FONT}`;
  c.fillStyle = RED;
  spaced(c, cur.names.join('  '), 38, 246, 4.2);
  c.globalAlpha = 1;

  // timeline
  const pps = (W * 0.5) / D;
  const tAtX = px => t + (px - PLAY_X) / pps;
  const xAtT = tt => PLAY_X + (tt - t) * pps;
  const tEnd = tl.loop ? Infinity : tl.total;

  const kFirst = tl.indexAt(Math.max(0, tAtX(-60)));
  c.font = `500 10.5px ${FONT}`;
  for (let k = kFirst; k < tl.Kmax; k++) {
    const gx = xAtT(tl.startOf(k));
    if (gx > W + 60) break;
    if (gx < -60) continue;
    c.fillStyle = '#D8D4CB';
    c.fillRect(gx - 0.5, TL_TOP + 6, 1, TL_BOT - TL_TOP - 6);
    c.fillStyle = k <= kNow ? '#55524C' : '#9C988F';
    const lbl = tl.chordAt(k).ch.rootName + tl.chordAt(k).ch.qual;
    c.fillText(lbl, gx - c.measureText(lbl).width / 2, TL_TOP - 4);
  }

  const x0 = Math.max(0, xAtT(0));
  const x1 = Math.min(W, xAtT(tEnd));
  const step = 2;
  c.lineJoin = 'round';
  for (let v = 0; v < 5; v++) {
    const fs = Math.max(PLAY_X, x0);
    if (x1 > fs) {
      c.beginPath();
      for (let px = fs; px <= x1; px += step) {
        const y = yOf(tl.pitchAt(v, tAtX(px)));
        px === fs ? c.moveTo(px, y) : c.lineTo(px, y);
      }
      c.strokeStyle = '#CFCAC0';
      c.lineWidth = 1.4;
      c.stroke();
    }
    const end = Math.min(PLAY_X, x1);
    if (end > x0) {
      c.beginPath();
      for (let px = x0; px <= end + 0.01; px += step) {
        const pp = Math.min(px, end);
        const y = yOf(tl.pitchAt(v, tAtX(pp)));
        px === x0 ? c.moveTo(pp, y) : c.lineTo(pp, y);
      }
      c.strokeStyle = COLORS[v];
      c.lineWidth = v === 0 ? 2.2 : 2;
      c.stroke();
    }
  }

  c.fillStyle = 'rgba(40,40,40,.75)';
  c.fillRect(PLAY_X - 0.6, TL_TOP + 6, 1.2, TL_BOT - TL_TOP - 6);

  const tc = Math.min(t, tEnd);
  for (let v = 0; v < 5; v++) {
    const y = yOf(tl.pitchAt(v, tc));
    const k0 = tl.indexAt(tc - tl.OFF[v]);
    for (const kb of [k0, k0 + 1]) {
      if (kb < 1 || kb >= tl.Kmax) continue;
      const moved = tl.chordAt(kb).pitches[v] !== tl.chordAt(kb - 1).pitches[v];
      const a = (tc - (tl.startOf(kb) + tl.OFF[v]) + tl.gAt(kb) / 2) / 1.1;
      if (moved && a >= 0 && a <= 1) {
        c.beginPath();
        c.arc(PLAY_X, y, 6 + a * 11, 0, Math.PI * 2);
        c.strokeStyle = COLORS[v];
        c.globalAlpha = (1 - a) * 0.55;
        c.lineWidth = 1.2;
        c.stroke();
        c.globalAlpha = 1;
      }
    }
    c.beginPath();
    c.arc(PLAY_X, y, 4.4, 0, Math.PI * 2);
    c.fillStyle = COLORS[v];
    c.fill();
    c.lineWidth = 1.2;
    c.strokeStyle = BG;
    c.stroke();
  }

  keyboard(c, tl, tc, KB);

  const prog = tl.loop ? CS.mod(t, tl.total) / tl.total : Math.min(1, t / tl.total);
  c.fillStyle = '#D3CFC6';
  c.fillRect(KB.x, 800, KB.w, 1);
  c.fillStyle = INK;
  c.fillRect(KB.x, 799, KB.w * prog, 3);
}

function keyboard(c, tl, t, KB) {
  const lw = KB.lw || 1;
  const active = new Map();
  for (let v = 0; v < 5; v++) active.set(Math.round(tl.pitchAt(v, t)), COLORS[v]);
  const whites = [];
  for (let m = KB.lo; m <= KB.hi; m++) if (!isBlack(m)) whites.push(m);
  const kw = KB.w / whites.length;
  whites.forEach((m, i) => {
    const x = KB.x + i * kw;
    c.fillStyle = active.get(m) || '#FBFAF6';
    c.fillRect(x, KB.y, kw, KB.h);
    c.fillStyle = INK;
    c.fillRect(x, KB.y, lw, KB.h);
  });
  c.fillRect(KB.x + KB.w - lw, KB.y, lw, KB.h);
  c.fillRect(KB.x, KB.y, KB.w, lw);
  c.fillRect(KB.x, KB.y + KB.h - lw, KB.w, lw);
  let wi = 0;
  for (let m = KB.lo; m <= KB.hi; m++) {
    if (!isBlack(m)) { wi++; continue; }
    const bw = kw * 0.62, bh = KB.h * 0.6;
    const x = KB.x + wi * kw - bw / 2;
    c.fillStyle = INK;
    c.fillRect(x, KB.y, bw, bh);
    const col = active.get(m);
    if (col) { c.fillStyle = col; c.fillRect(x + 1.2 * lw, KB.y + lw, bw - 2.4 * lw, bh - 2.2 * lw); }
  }
}

CS.render = render;
CS.drawKeyboard = keyboard;
CS.spaced = spaced;
CS.CARD = { W, H, COLORS, BG, INK, GREY, RED, FONT };
})();

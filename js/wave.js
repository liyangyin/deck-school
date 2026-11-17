// Canvas drawing: the scrolling rhythm display and each deck's song overview.
import { S, pos } from './engine.js';
import { WAVE_RATE } from './synth.js';

export const COL = [
  { base: '#2a9be6', dark: '#0f5f9c', light: '#bfe2fa' },
  { base: '#e8474a', dark: '#a01f25', light: '#fbc9ca' },
];
const PX_PER_SEC = 150;

function fit(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [g, w, h];
}

export function drawRhythm(cv) {
  const [g, W, H] = fit(cv);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#e3e6ea'; g.fillRect(0, H / 2 - 0.5, W, 1);
  if (!S.ctx) return;
  const sr = S.ctx.sampleRate;
  S.decks.forEach((d, i) => {
    if (!d.wave) return;
    const mid = i ? H * 0.76 : H * 0.24, hh = H * 0.22, c = COL[i];
    const top = i ? H / 2 + 1 : 0, half = H / 2 - 1;
    if (S.hide['wave' + i]) {
      g.fillStyle = '#9aa1ab'; g.font = '11px ui-sans-serif, system-ui'; g.textAlign = 'center';
      g.fillText('DECK ' + 'AB'[i] + ' WAVEFORM HIDDEN FOR THIS LESSON: USE YOUR EARS', W / 2, mid + 4);
      return;
    }
    const step = (1 + d.pitch / 100) * WAVE_RATE / PX_PER_SEC;       // analysis points per pixel
    const start = pos(d) / sr * WAVE_RATE - (W / 2) * step;
    const x4 = smp => (smp / sr * WAVE_RATE - start) / step;
    if (d.loop.on) { g.fillStyle = i ? 'rgba(232,71,74,.13)' : 'rgba(42,155,230,.13)'; const a = x4(d.loop.in), b = x4(d.loop.out); g.fillRect(a, top, b - a, half); }
    const { amp, lo, hi } = d.wave, n = amp.length;
    for (const [arr, col, k] of [[amp, c.base, 1], [lo, c.dark, 0.9], [hi, c.light, 0.55]]) {
      g.fillStyle = col; g.beginPath();
      for (let x = 0; x < W; x++) {
        const j = Math.round(start + x * step);
        if (j < 0 || j >= n) continue;
        const a = Math.min(amp[j], arr[j] * k) / 255 * hh;
        if (a > 0.3) g.rect(x, mid - a, 1, a * 2);
      }
      g.fill();
    }
    // beat grid: small tick per beat, taller per bar, full height + bar number per 8-bar phrase
    const b0 = Math.max(0, Math.ceil(((start / WAVE_RATE * sr) - d.grid0) / d.spb));
    const b1 = Math.floor((((start + W * step) / WAVE_RATE * sr) - d.grid0) / d.spb);
    g.font = '9px ui-sans-serif, system-ui'; g.textAlign = 'left';
    for (let k = b0; k <= b1; k++) {
      const x = Math.round(x4(d.grid0 + k * d.spb));
      const bar = k % 4 === 0, phr = k % 32 === 0;
      g.fillStyle = phr ? c.dark : c.base;
      const len = phr ? half : bar ? 11 : 5, w = bar ? 2 : 1;
      if (i) g.fillRect(x, H / 2 + 1, w, len); else g.fillRect(x, H / 2 - 1 - len, w, len);
      if (phr) g.fillText(String(k / 4 + 1), x + 4, i ? H - 3 : 9);
    }
    // cue point and hot cues
    const flag = (smp, col, label) => {
      const x = Math.round(x4(smp)); if (x < -20 || x > W + 20) return;
      g.fillStyle = col; g.fillRect(x, top, 2, half);
      if (label) { g.fillRect(x, top + (i ? half - 12 : 0), 12, 12); g.fillStyle = '#fff'; g.font = 'bold 9px ui-sans-serif, system-ui'; g.fillText(label, x + 3.5, top + (i ? half - 3 : 9)); }
    };
    flag(d.cue, '#8a919b');
    d.hot.forEach((h, k) => h !== null && flag(h, '#f08c00', String(k + 1)));
  });
  g.fillStyle = '#15181c'; g.fillRect(Math.round(W / 2) - 1, 0, 2, H);
}

export function buildOverview(d, w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d'), { amp, lo } = d.wave, n = amp.length, c = COL[d.id];
  for (const [arr, col] of [[amp, c.base], [lo, c.dark]]) {
    g.fillStyle = col;
    for (let x = 0; x < w; x++) {
      let m = 0; const a = Math.floor(x / w * n), b = Math.floor((x + 1) / w * n);
      for (let j = a; j < b; j++) if (arr[j] > m) m = arr[j];
      const y = Math.min(1, m / 255) * h / 2 * (arr === lo ? 0.75 : 1);
      g.fillRect(x, h / 2 - y, 1, y * 2 || 1);
    }
  }
  return cv;
}

export function drawOverview(cv, d) {
  const [g, W, H] = fit(cv);
  g.clearRect(0, 0, W, H);
  if (!d.wave) return;
  const key = d.track.id + W + 'x' + H + cv.width;
  if (cv._key !== key) { cv._img = buildOverview(d, cv.width, cv.height); cv._key = key; }
  g.drawImage(cv._img, 0, 0, W, H);
  const x = p => p / d.len * W, px = x(pos(d));
  g.fillStyle = 'rgba(255,255,255,.62)'; g.fillRect(0, 0, px, H);
  if (d.loop.on) { g.fillStyle = 'rgba(20,24,28,.18)'; g.fillRect(x(d.loop.in), 0, Math.max(2, x(d.loop.out) - x(d.loop.in)), H); }
  g.fillStyle = '#8a919b'; g.fillRect(x(d.cue), 0, 1.5, H);
  d.hot.forEach(h => { if (h !== null) { g.fillStyle = '#f08c00'; g.fillRect(x(h), 0, 2, H); } });
  g.fillStyle = '#15181c'; g.fillRect(px - 1, 0, 2, H);
}

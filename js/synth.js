// Offline house-track synthesizer and audio analysis. Runs inside a Web Worker.
import { STRUCT, PHRASE_BEATS } from './tracks.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hz = n => 440 * 2 ** ((n - 69) / 12);

// ---- one-shot drum samples -------------------------------------------------
function makeKick(sr, base = 47, sweep = 130, decay = 8.5) {
  const n = Math.floor(sr * 0.42), o = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += 2 * Math.PI * (base + sweep * Math.exp(-t * 34)) / sr;
    o[i] = Math.sin(ph) * Math.exp(-t * decay) * Math.min(1, i / 40) + (i < 90 ? (1 - i / 90) * 0.25 * Math.sin(i * 0.9) : 0);
  }
  return o;
}
function makeNoiseHit(sr, r, dur, decay, hp, lp = 0) {
  const n = Math.floor(sr * dur), o = new Float32Array(n);
  const a = Math.exp(-2 * Math.PI * hp / sr), b = lp ? Math.exp(-2 * Math.PI * lp / sr) : 0;
  let l = 0, l2 = 0;
  for (let i = 0; i < n; i++) {
    const x = r() * 2 - 1;
    l = a * l + (1 - a) * x;
    let y = x - l;
    if (lp) { l2 = b * l2 + (1 - b) * y; y = l2; }
    o[i] = y * Math.exp(-(i / sr) * decay);
  }
  return o;
}
function makeClap(sr, r) {
  const n = Math.floor(sr * 0.3), o = new Float32Array(n);
  let lo = 0, bd = 0;
  const f = 2 * Math.sin(Math.PI * 1400 / sr), q = 0.7;
  for (let i = 0; i < n; i++) {
    const t = i / sr, x = r() * 2 - 1;
    const hi = x - lo - q * bd; bd += f * hi; lo += f * bd;
    let env = Math.exp(-Math.max(0, t - 0.03) * 22);
    if (t < 0.03) env = [1, 0.25][Math.floor(t / 0.005) % 2] * (0.6 + t * 13);
    o[i] = bd * env * 1.6;
  }
  return o;
}
function makeRim(sr) {
  const n = Math.floor(sr * 0.06), o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; o[i] = (Math.sin(2 * Math.PI * 1720 * t) + 0.5 * Math.sin(2 * Math.PI * 2440 * t)) * Math.exp(-t * 90) * 0.6; }
  return o;
}
function mix(out, smp, at, gain) {
  at = Math.round(at);
  const n = Math.min(smp.length, out.length - at);
  for (let i = 0; i < n; i++) out[at + i] += smp[i] * gain;
}

// ---- subtractive voice: detuned saws -> state-variable low-pass -> envelope
function voice(out, at, len, freqs, sr, o) {
  at = Math.round(at); len = Math.min(Math.round(len), out.length - at);
  if (len <= 0) return;
  const nOsc = freqs.length * (o.detune ? 2 : 1);
  const ph = new Float32Array(nOsc), inc = new Float32Array(nOsc);
  for (let i = 0; i < freqs.length; i++) {
    if (o.detune) { inc[i * 2] = freqs[i] * (1 - o.detune) / sr; inc[i * 2 + 1] = freqs[i] * (1 + o.detune) / sr; ph[i * 2 + 1] = 0.37; }
    else inc[i] = freqs[i] / sr;
  }
  let lo = 0, bd = 0;
  const q = o.q ?? 0.9, att = Math.max(1, (o.attack ?? 0.003) * sr), rel = Math.max(1, (o.release ?? 0.02) * sr);
  const norm = o.amp / Math.sqrt(nOsc);
  for (let i = 0; i < len; i++) {
    const t = i / sr, gl = o.glide ? 1 + o.glide * Math.exp(-t * 55) : 1;
    let x = 0;
    for (let k = 0; k < nOsc; k++) {
      ph[k] += inc[k] * gl; if (ph[k] >= 1) ph[k] -= 1;
      x += o.square ? (ph[k] < 0.5 ? 1 : -1) : 2 * ph[k] - 1;
    }
    const fc = Math.min(sr * 0.22, o.cut + (o.cutEnv || 0) * Math.exp(-t * (o.cutDecay || 10)));
    const f = 2 * Math.sin(Math.PI * fc / sr);
    const hi = x - lo - q * bd; bd += f * hi; lo += f * bd;
    let env = Math.min(1, i / att) * Math.min(1, (len - i) / rel);
    if (o.decay) env *= Math.exp(-t * o.decay);
    out[at + i] += (o.bp ? bd : lo) * env * norm;
  }
}

const BASS_PATS = [
  // offbeat house bass
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
  // rolling
  [0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 2],
  // syncopated
  [0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 2, 0],
];
const STAB_PATS = [
  [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0],
];

// ---- hype styles: 'tech' (bouncy one-note riffs, vocal chops), 'melodic' (plucks over chords),
// 'rave' (piano stabs, octave bass, hoover). _ = rest, numbers = semitones above the bass note.
const _ = null;
const RIFFS = {
  tech: [[_, _, 0, 0, _, 12, 0, _, _, _, 0, 0, _, 12, _, 10], [_, 0, _, 0, 0, _, 12, 0, _, 0, _, 0, 0, _, 7, 12]],
  melodic: [[_, _, 0, _, _, _, 0, 0, _, _, 0, _, _, 0, 12, _], [_, _, 0, 0, _, _, 0, _, _, 12, 0, _, _, _, 0, 7]],
  rave: [[0, _, 12, 0, _, 0, 12, _, 0, _, 12, 0, _, 0, 12, 3], [0, 0, 12, _, 0, 0, 12, _, 0, 0, 12, _, 0, 3, 12, 7]],
};
const BASS_SND = {
  tech: { amp: 0.46, square: true, cut: 150, cutEnv: 950, cutDecay: 24, q: 0.5, release: 0.014, glide: 0.35 },
  melodic: { amp: 0.66, cut: 170, cutEnv: 700, cutDecay: 14, q: 0.6, release: 0.02 },
  rave: { amp: 0.6, cut: 220, cutEnv: 1900, cutDecay: 18, q: 0.22, release: 0.012 },
};
const STYLE_STABS = {
  tech: [_, _, _, 0, _, _, 0, _, _, _, 3, 0, _, _, -2, _],
  melodic: [0, _, _, 0, _, _, 0, _, 0, _, _, 0, _, _, 0, _],
  rave: [0, _, _, 0, _, _, 0, _, _, _, 0, _, 0, _, _, _],
};
// a sung-vowel "chop": one note through three resonant band-passes (formants)
function chop(buf, at, len, note, sr, amp, oh) {
  const F = oh ? [[420, 1], [860, 0.55], [2500, 0.2]] : [[760, 1], [1180, 0.6], [2700, 0.22]];
  for (const [fc, g] of F) voice(buf, at, len, [hz(note)], sr, { amp: amp * g * 0.3, detune: 0.006, cut: fc, q: 0.12, bp: true, attack: 0.008, release: 0.03, decay: 5 });
}

function renderBlock(spec, flags, sr, blockLen, kit) {
  const spb = blockLen / PHRASE_BEATS, step = spb / 4, tail = Math.round(spb * 2);
  const out = new Float32Array(blockLen + tail), mus = new Float32Array(blockLen + tail);
  const ld = flags.lead ? new Float32Array(blockLen + tail) : null;
  const r = rng(spec.seed * 977 + 5);
  const third = spec.minor ? 3 : 4, seventh = spec.minor ? 10 : 11;
  const chordRoot = bar => spec.root + spec.prog[Math.floor(bar / 2) % 4];
  const percPat = Array.from({ length: 16 }, (_, i) => (i % 4 !== 0 && r() < 0.3 ? 0.5 + r() * 0.5 : 0));
  const leadPat = Array.from({ length: 32 }, () => (r() < 0.62 ? Math.floor(r() * 5) : -1));
  const penta = spec.minor ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
  const fillFrom = 128 - 8;
  const st = spec.style || 'classic', hype = st !== 'classic';
  const riff = hype ? RIFFS[st][spec.bass % RIFFS[st].length] : null;

  for (let s = 0; s < 128; s++) {
    const at = s * step, bar = s >> 4, inBar = s & 15, inFill = flags.fill && s >= fillFrom;
    if (flags.kick && s % 4 === 0 && !(flags.fill && s === 124)) mix(out, kit.kick, at, 0.95);
    if (flags.clap && s % 8 === 4) { mix(out, kit.clap, at, 0.5); if (hype) mix(out, kit.snare, at, 0.2); }
    if (flags.hat) {
      if (s % 4 === 2) mix(out, kit.ohat, at, (hype ? 0.36 : 0.26) * flags.hat);
      else mix(out, kit.hat, at, (hype ? [0.1, 0.07, 0, 0.12][s % 4] : s % 2 ? 0.07 : 0.13) * flags.hat);
    }
    if (hype && flags.fill && s >= 112 && s < fillFrom && s % 2 === 0) mix(out, kit.snare, at, 0.1 + 0.01 * (s - 112));
    if (flags.perc && percPat[inBar]) mix(out, kit.rim, at, 0.3 * percPat[inBar]);
    if (inFill) mix(out, kit.snare, at, 0.16 + 0.05 * (s - fillFrom));
    if (flags.riser && s >= 96 && (s >= 112 || s % 2 === 0)) mix(out, kit.snare, at, 0.08 + 0.3 * ((s - 96) / 32) ** 2);
    if (hype) {
      if (flags.bass && riff[inBar] != null) voice(mus, at, step * (st === 'rave' ? 0.8 : 0.95), [hz((st === 'tech' ? spec.root : chordRoot(bar)) + riff[inBar])], sr, BASS_SND[st]);
      const sv = STYLE_STABS[st][inBar], c = chordRoot(bar) + 36;
      if (flags.stab && sv != null) {
        if (st === 'tech') chop(mus, at, step * 1.7, spec.root + 36 + sv, sr, 0.9 * flags.stab, bar % 2);
        else if (st === 'melodic') voice(mus, at, step * 1.8, [c, c + third, c + 7, c + seventh].map(hz), sr, { amp: 0.3 * flags.stab, detune: 0.003, cut: 420, cutEnv: 3600, cutDecay: 16, decay: 9, q: 0.6 });
        else voice(mus, at, step * 3, [c - 12, c, c + third, c + 7, c + 12].map(hz), sr, { amp: 0.36 * flags.stab, detune: 0.002, cut: 800, cutEnv: 4400, cutDecay: 7, decay: 5, q: 0.7 });
      }
      if (flags.lead) {
        const l = leadPat[s % 32];
        if (st === 'tech') { if (l >= 0 && s % 2 === 0) chop(ld, at, step * 1.5, spec.root + 48 + penta[l], sr, 0.7, l % 2); }
        else if (st === 'melodic') { if (l >= 0) voice(ld, at, step * 0.9, [hz(spec.root + 48 + penta[l])], sr, { amp: 0.17, detune: 0.004, cut: 900, cutEnv: 3200, cutDecay: 18, decay: 8, q: 0.5 }); }
        else if (s % 4 === 2) voice(ld, at, step * 1.8, [c, c + 7, c + 12].map(hz), sr, { amp: 0.24, detune: 0.018, cut: 2800, q: 0.5, attack: 0.004, release: 0.05, glide: -0.12 });
      }
    }
    if (!hype && flags.bass) {
      const b = BASS_PATS[spec.bass][inBar];
      if (b) voice(mus, at, step * 0.92, [hz(chordRoot(bar) + (b === 2 ? 12 : 0))], sr, { amp: 0.62, cut: 110, cutEnv: 520, cutDecay: 16, q: 0.7, release: 0.012 });
    }
    if (!hype && flags.stab && STAB_PATS[spec.stab][inBar]) {
      const c = chordRoot(bar) + 24;
      voice(mus, at, step * 2.6, [c, c + third, c + 7, c + seventh].map(hz), sr, { amp: 0.3 * flags.stab, detune: 0.004, cut: 500, cutEnv: 2600, cutDecay: 9, decay: 7, q: 0.8 });
    }
    if (!hype && flags.lead) {
      const l = leadPat[s % 32];
      if (l >= 0) voice(ld, at, step * 0.85, [hz(spec.root + 36 + penta[l] + (s % 32 > 23 ? 12 : 0))], sr, { amp: 0.16, square: true, cut: 1400, cutEnv: 1800, cutDecay: 20, decay: 9, q: 0.6 });
    }
    if (flags.pad && inBar === 0 && bar % 2 === 0) {
      const c = chordRoot(bar) + 24;
      voice(mus, at, step * 32, [c, c + third, c + 7, c + seventh, c + 12].map(hz), sr, { amp: 0.2 * flags.pad, detune: 0.006, cut: 900, q: 0.5, attack: 0.5, release: 0.6 });
    }
  }
  // tempo-synced echo on the lead
  if (flags.lead) {
    const d = Math.round(step * 3);
    for (let i = d; i < ld.length; i++) ld[i] += ld[i - d] * 0.42;
    for (let i = 0; i < ld.length; i++) mus[i] += ld[i];
  }
  if (flags.riser) {
    let lo = 0, bd = 0;
    const from = Math.round(blockLen / 2);
    for (let i = from; i < blockLen; i++) {
      const p = (i - from) / (blockLen - from), x = r() * 2 - 1;
      const f = 2 * Math.sin(Math.PI * (300 + 7000 * p * p) / sr);
      const hi = x - lo - 0.35 * bd; bd += f * hi; lo += f * bd;
      out[i] += bd * 0.2 * p * p;
    }
  }
  if (flags.crash) mix(out, kit.crash, 0, 0.3);
  // the drop lands with a sub boom on the hype tracks
  if (hype && flags.name === 'drop' && flags.crash) { let ph = 0; for (let i = 0; i < sr * 1.3 && i < out.length; i++) { const t = i / sr; ph += 2 * Math.PI * (36 + 60 * Math.exp(-t * 5)) / sr; out[i] += Math.sin(ph) * 0.45 * Math.exp(-t * 3); } }
  // sidechain the musical parts to the kick
  for (let i = 0; i < mus.length; i++) {
    const g = flags.kick ? 1 - 0.72 * Math.exp(-((i % spb) / spb) * 7) : 1;
    out[i] += mus[i] * g;
  }
  return out;
}

export function renderTrack(spec, sr) {
  const blockLen = Math.round(PHRASE_BEATS * sr * 60 / spec.bpm);
  const r = rng(spec.seed);
  const kit = {
    kick: spec.style ? makeKick(sr, 50, 175, 10.5) : makeKick(sr), hat: makeNoiseHit(sr, r, 0.06, 95, 7000), ohat: makeNoiseHit(sr, r, 0.3, 17, 6000),
    snare: makeNoiseHit(sr, r, 0.16, 30, 900, 6000), crash: makeNoiseHit(sr, r, 2.2, 2.2, 4500), clap: makeClap(sr, r), rim: makeRim(sr),
  };
  const out = new Float32Array(blockLen * STRUCT.length + sr);
  const cache = new Map();
  STRUCT.forEach((flags, b) => {
    const key = JSON.stringify(spec.style ? flags : { ...flags, name: 0 });
    if (!cache.has(key)) cache.set(key, renderBlock(spec, flags, sr, blockLen, kit));
    const blk = cache.get(key), at = b * blockLen;
    for (let i = 0; i < blk.length && at + i < out.length; i++) out[at + i] += blk[i];
  });
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * 1.15) * 0.82;
  return { audio: out, spb: blockLen / PHRASE_BEATS, bpm: 60 * sr * PHRASE_BEATS / blockLen, grid0: 0 };
}

// ---- analysis: waveform overview (150 points per second) --------------------
export const WAVE_RATE = 150;
export function analyse(ch, sr) {
  const hop = sr / WAVE_RATE, n = Math.floor(ch.length / hop);
  const amp = new Uint8Array(n), lo = new Uint8Array(n), hi = new Uint8Array(n);
  const a = Math.exp(-2 * Math.PI * 160 / sr), b = Math.exp(-2 * Math.PI * 4500 / sr);
  let l = 0, h = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.floor(i * hop), e = Math.floor((i + 1) * hop);
    let pk = 0, el = 0, eh = 0;
    for (let j = s; j < e; j++) {
      const x = ch[j], ax = x < 0 ? -x : x;
      if (ax > pk) pk = ax;
      l = a * l + (1 - a) * x; h = b * h + (1 - b) * x;
      el += l * l; const y = x - h; eh += y * y;
    }
    amp[i] = Math.min(255, pk * 300);
    lo[i] = Math.min(255, Math.sqrt(el / (e - s)) * 520);
    hi[i] = Math.min(255, Math.sqrt(eh / (e - s)) * 900);
  }
  return { amp, lo, hi };
}

// ---- tempo estimate for imported files --------------------------------------
export function detectBeat(wave, lenSec) {
  const e = wave.lo, n = e.length, on = new Float32Array(n);
  for (let i = 1; i < n; i++) on[i] = Math.max(0, e[i] - e[i - 1]);
  const score = (bpm) => {
    const per = WAVE_RATE * 60 / bpm;
    let best = 0, bestPh = 0;
    const steps = Math.ceil(per);
    for (let p = 0; p < steps; p++) {
      let s = 0;
      for (let k = p; k < n - 1; k += per) { const i = Math.round(k); s += on[i] + 0.5 * (on[i - 1] || 0) + 0.5 * on[i + 1]; }
      if (s > best) { best = s; bestPh = p; }
    }
    return [best, bestPh];
  };
  let top = 120, topS = 0;
  for (let bpm = 80; bpm <= 160; bpm += 0.5) { const [s] = score(bpm); if (s > topS) { topS = s; top = bpm; } }
  let fine = top; topS = 0; let ph = 0;
  for (let bpm = top - 0.6; bpm <= top + 0.6; bpm += 0.02) { const [s, p] = score(bpm); if (s > topS) { topS = s; fine = bpm; ph = p; } }
  if (Math.abs(fine - Math.round(fine)) < 0.08) { fine = Math.round(fine); ph = score(fine)[1]; }
  return { bpm: fine, grid0Sec: ph / WAVE_RATE, lenSec };
}

// ---- one-shots for the SAMPLER pad page -------------------------------------
export function makeSamples(sr) {
  const r = rng(4242);
  const horn = new Float32Array(Math.floor(sr * 0.8));
  voice(horn, 0, horn.length, [hz(70), hz(74), hz(77)], sr, { amp: 0.7, detune: 0.012, cut: 2600, q: 0.5, attack: 0.01, release: 0.12 });
  const sweep = (dur, f) => { const o = new Float32Array(Math.floor(sr * dur)); let ph = 0; for (let i = 0; i < o.length; i++) { const t = i / sr; ph += 2 * Math.PI * f(t, t / dur) / sr; o[i] = Math.sin(ph) * 0.5 * Math.min(1, i / 200) * Math.min(1, (o.length - i) / 2000); } return o; };
  return [
    ['Kick', makeKick(sr)], ['Clap', makeClap(sr, r)], ['HiHat', makeNoiseHit(sr, r, 0.25, 22, 6000)], ['Snare', makeNoiseHit(sr, r, 0.2, 24, 700, 7000)],
    ['Crash', makeNoiseHit(sr, r, 2.2, 2.2, 4500)], ['Horn', horn],
    ['Siren', sweep(1.4, (t, p) => 700 + 500 * Math.sin(p * Math.PI * 4))], ['Laser', sweep(0.35, (t, p) => 3200 * Math.exp(-p * 3.2) + 120)],
  ].map(([name, data]) => ({ name, data }));
}

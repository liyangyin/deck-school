// Audio engine: two decks, mixer, effects, headphone cue. All state lives in S.
import { trackById } from './tracks.js';
import { makeSamples } from './synth.js';

const mkDeck = id => ({
  id, track: null, loading: false, len: 0, bpm: 120, spb: 22050, grid0: 0, wave: null,
  playing: false, cuePreview: false, pitch: 0, range: 8, bend: 0,
  gain: 0.5, eq: { high: 0.5, mid: 0.5, low: 0.5 }, filter: 0.5, level: 1, pfl: false,
  cue: 0, hot: Array(8).fill(null), loop: { on: false, in: 0, out: 0 }, loopBeats: 4,
  fx: { type: 'echo', on: false, str: 0.5, len: 0.5 },
  keylock: false, padPage: 'hot', roll: null,
  vu: 0, ev: {}, _p: 0, _t: 0, _r: 0, _gen: 0, n: null,
});

export const S = {
  ctx: null, decks: [mkDeck(0), mkDeck(1)], cross: 0.5, master: 0.7, hpVol: 0.7, hpMix: 0.5, out: localStorage.getItem('deckschool.out') || 'speakers', quadOk: false,
  samples: [], ev: { samples: 0 },
  masterVu: 0, noSync: false, hide: {}, local: [],
};
export const LOOP_SIZES = [0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];
export const ROLLS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
export const OUTPUTS = { speakers: 'Speakers only (no headphone cue)', phones: 'Headphones only (you hear the DJ headphone mix)', split: 'Split cable: left = master, right = headphones', quad: 'Sound card: master on 1-2, headphones on 3-4' };
export const FX = { echo: ['STR', 'LEN'], reverb: ['STR', 'SIZE'], flanger: ['STR', 'SPD'] };
const now = () => performance.now();
const D = id => S.decks[id];

// ---------------------------------------------------------------- graph
let worker, jobs = new Map(), jobId = 0, G = {};
export async function init() {
  if (S.ctx) { if (S.ctx.state !== 'running') await S.ctx.resume(); return; }
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('js/deck-processor.js');
  worker = new Worker('js/synth-worker.js', { type: 'module' });
  worker.onmessage = e => { const j = jobs.get(e.data.id); jobs.delete(e.data.id); j && j(e.data); };

  const g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const mono = () => { const n = g(1); n.channelCount = 1; n.channelCountMode = 'explicit'; return n; };
  G.master = g(S.master);
  G.limit = ctx.createDynamicsCompressor();
  Object.assign(G.limit.threshold, { value: -2 }); G.limit.ratio.value = 14; G.limit.attack.value = 0.003; G.limit.release.value = 0.12; G.limit.knee.value = 2;
  G.an = ctx.createAnalyser(); G.an.fftSize = 512;
  G.master.connect(G.limit); G.limit.connect(G.an);
  // Headphone bus: cued (PFL) decks blended with the master by the MIX knob, like a real mixer.
  G.cueBus = g(1); G.cueGain = g(1); G.cueMaster = g(0); G.hp = g(S.hpVol);
  G.cueBus.connect(G.cueGain); G.limit.connect(G.cueMaster); G.cueGain.connect(G.hp); G.cueMaster.connect(G.hp);
  // Output routings, chosen in the OUTPUT menu (only one is audible at a time):
  G.outSpeakers = g(0); G.limit.connect(G.outSpeakers); G.outSpeakers.connect(ctx.destination);   // master only
  G.outPhones = g(0); G.hp.connect(G.outPhones); G.outPhones.connect(ctx.destination);             // headphone bus only
  G.merge = ctx.createChannelMerger(2); G.outSplit = g(0);                                         // Y-cable: L master, R phones
  const mL = mono(), mR = mono();
  G.limit.connect(mL); mL.connect(G.merge, 0, 0); G.hp.connect(mR); mR.connect(G.merge, 0, 1);
  G.merge.connect(G.outSplit); G.outSplit.connect(ctx.destination);
  S.quadOk = ctx.destination.maxChannelCount >= 4;                                                 // DJ sound card: 1-2 master, 3-4 phones
  if (S.quadOk) {
    G.merge4 = ctx.createChannelMerger(4); G.outQuad = g(0);
    const sm = ctx.createChannelSplitter(2), sh = ctx.createChannelSplitter(2);
    const stM = g(1), stH = g(1); for (const n of [stM, stH]) { n.channelCount = 2; n.channelCountMode = 'explicit'; }
    G.limit.connect(stM); stM.connect(sm); G.hp.connect(stH); stH.connect(sh);
    sm.connect(G.merge4, 0, 0); sm.connect(G.merge4, 1, 1); sh.connect(G.merge4, 0, 2); sh.connect(G.merge4, 1, 3);
    G.outQuad.channelCount = 4; G.outQuad.channelCountMode = 'explicit'; G.outQuad.channelInterpretation = 'discrete';
    G.merge4.connect(G.outQuad); G.quadWired = false;
  } else if (S.out === 'quad') S.out = 'speakers';
  // sampler one-shots
  G.smp = g(0.9); G.smp.connect(G.master);
  S.samples = makeSamples(ctx.sampleRate).map(({ name, data }) => { const b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.copyToChannel(data, 0); return { name, buf: b }; });

  // impulse responses for the reverb
  const ir = (sec) => {
    const b = ctx.createBuffer(2, sec * ctx.sampleRate, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / d.length * 6); }
    return b;
  };
  G.irs = [ir(0.9), ir(1.8), ir(3.2)];

  for (const d of S.decks) {
    const n = d.n = {};
    n.src = new AudioWorkletNode(ctx, 'deck', { numberOfInputs: 0, outputChannelCount: [2] });
    n.src.port.onmessage = e => {
      const m = e.data;
      if (m.ended) { d.playing = false; d.cuePreview = false; return; }
      if (m.gen !== d._gen) return;
      d._p = m.pos; d._t = m.t; d._r = m.rate;
    };
    n.trim = g(1);
    const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
    n.low = bq('lowshelf', 200); n.mid = bq('peaking', 1100, 0.6); n.high = bq('highshelf', 5200);
    n.lpf = bq('lowpass', 22000, 1); n.hpf = bq('highpass', 10, 1);
    n.an = ctx.createAnalyser(); n.an.fftSize = 512;
    n.pfl = g(0); n.fader = g(1); n.xf = g(1);
    n.src.connect(n.trim); n.trim.connect(n.low); n.low.connect(n.mid); n.mid.connect(n.high); n.high.connect(n.lpf); n.lpf.connect(n.hpf);
    n.hpf.connect(n.an); n.hpf.connect(n.pfl); n.pfl.connect(G.cueBus);
    n.hpf.connect(n.fader); n.fader.connect(n.xf); n.xf.connect(G.master);
    // effects are post-fader so tails keep ringing after the fader closes
    n.echoSend = g(0); n.echo = ctx.createDelay(2); n.echoFb = g(0.55); n.echoWet = g(0.5);
    n.xf.connect(n.echoSend); n.echoSend.connect(n.echo); n.echo.connect(n.echoFb); n.echoFb.connect(n.echo); n.echo.connect(n.echoWet); n.echoWet.connect(G.master);
    n.revSend = g(0); n.rev = ctx.createConvolver(); n.rev.buffer = G.irs[1]; n.revWet = g(0.5);
    n.xf.connect(n.revSend); n.revSend.connect(n.rev); n.rev.connect(n.revWet); n.revWet.connect(G.master);
    n.flSend = g(0); n.fl = ctx.createDelay(0.05); n.fl.delayTime.value = 0.004; n.flFb = g(0.6); n.flWet = g(0.5);
    n.lfo = ctx.createOscillator(); n.lfo.frequency.value = 0.25; n.lfoAmt = g(0.003); n.lfo.connect(n.lfoAmt); n.lfoAmt.connect(n.fl.delayTime); n.lfo.start();
    n.xf.connect(n.flSend); n.flSend.connect(n.fl); n.fl.connect(n.flFb); n.flFb.connect(n.fl); n.fl.connect(n.flWet); n.flWet.connect(G.master);
  }
  S.ctx = ctx;
  apply();
}

const set = (param, v, tc = 0.012) => param.setTargetAtTime(v, S.ctx.currentTime, tc);
const eqDb = k => (k <= 0.5 ? -40 * Math.pow(1 - 2 * k, 1.5) : 12 * (k - 0.5));
export const eqDbOf = eqDb;

// Push every mixer value in S to the audio graph. Cheap; call after any change.
function setOutput() {
  const o = S.out, dest = S.ctx.destination;
  if (S.quadOk) {
    const want = o === 'quad';
    if (want && !G.quadWired) { dest.channelCount = 4; dest.channelInterpretation = 'discrete'; G.outQuad.connect(dest); G.quadWired = true; }
    if (!want && G.quadWired) { G.outQuad.disconnect(); dest.channelCount = 2; dest.channelInterpretation = 'speakers'; G.quadWired = false; }
    set(G.outQuad.gain, want ? 1 : 0);
  }
  set(G.outSpeakers.gain, o === 'speakers' ? 1 : 0); set(G.outPhones.gain, o === 'phones' ? 1 : 0); set(G.outSplit.gain, o === 'split' ? 1 : 0);
}
export function setOut(o) { S.out = o; localStorage.setItem('deckschool.out', o); S.ev.out = now(); apply(); }
export function sample(i) {
  if (!S.ctx || !S.samples[i]) return;
  const n = S.ctx.createBufferSource(); n.buffer = S.samples[i].buf; n.connect(G.smp); n.start();
  S.ev.samples++; S.ev.sample = now();
}
export function apply() {
  if (!S.ctx) return;
  set(G.master.gain, Math.pow(S.master, 1.5) * 1.3);
  setOutput();
  set(G.cueGain.gain, 1 - S.hpMix); set(G.cueMaster.gain, S.hpMix); set(G.hp.gain, S.hpVol * 1.4);
  const gA = S.cross <= 0.5 ? 1 : Math.cos((S.cross - 0.5) * Math.PI), gB = S.cross >= 0.5 ? 1 : Math.cos((0.5 - S.cross) * Math.PI);
  for (const d of S.decks) {
    const n = d.n;
    set(n.trim.gain, Math.pow(10, (d.gain - 0.5) * 24 / 20));
    set(n.low.gain, eqDb(d.eq.low)); set(n.mid.gain, eqDb(d.eq.mid)); set(n.high.gain, eqDb(d.eq.high));
    const f = d.filter;
    set(n.lpf.frequency, f < 0.47 ? 70 * Math.pow(22000 / 70, f / 0.47) : 22000, 0.02);
    set(n.hpf.frequency, f > 0.53 ? 20 * Math.pow(9000 / 20, (f - 0.53) / 0.47) : 10, 0.02);
    const q = Math.abs(f - 0.5) > 0.03 ? 2.2 : 0.7; set(n.lpf.Q, q); set(n.hpf.Q, q);
    set(n.pfl.gain, d.pfl ? 1 : 0);
    set(n.fader.gain, Math.pow(d.level, 1.7));
    set(n.xf.gain, Math.max(0, d.id ? gB : gA));
    const fx = d.fx, on = t => (fx.on && fx.type === t ? 1 : 0);
    set(n.echoSend.gain, on('echo')); set(n.revSend.gain, on('reverb')); set(n.flSend.gain, on('flanger'));
    set(n.echoWet.gain, fx.str * 0.9); set(n.revWet.gain, fx.str * 1.1); set(n.flWet.gain, on('flanger') * fx.str);
    const beats = [0.25, 0.5, 0.75, 1][Math.min(3, Math.floor(fx.len * 4))];
    set(n.echo.delayTime, Math.min(1.9, beats * 60 / effBpm(d)), 0.05);
    set(n.lfo.frequency, 0.08 + fx.len * 1.5);
    const irb = G.irs[Math.min(2, Math.floor(fx.len * 3))]; if (n.rev.buffer !== irb && !on('reverb')) n.rev.buffer = irb;
  }
}

// ---------------------------------------------------------------- transport helpers
export function pos(d) {
  if (!d.len || !S.ctx) return d._p;
  let p = d._p + (S.ctx.currentTime - d._t) * S.ctx.sampleRate * d._r;
  const lp = d.roll || (d.loop.on ? d.loop : null);
  if (lp && d._r > 0 && p >= lp.out) { const L = lp.out - lp.in; if (L > 0) p = lp.in + ((p - lp.in) % L); }
  return Math.max(0, Math.min(d.len, p));
}
export const effBpm = d => d.bpm * (1 + d.pitch / 100);
export const beat = d => (pos(d) - d.grid0) / d.spb;
export const bpmDiff = () => effBpm(D(1)) - effBpm(D(0));
// how far deck B's beats sit from deck A's, in beats (-0.5..0.5; positive = B is ahead)
export function phase() {
  const f = x => ((x % 1) + 1) % 1;
  let p = f(beat(D(1))) - f(beat(D(0)));
  if (p > 0.5) p -= 1; if (p < -0.5) p += 1;
  return p;
}
const snap = (d, p) => d.grid0 + Math.round((p - d.grid0) / d.spb) * d.spb;
const post = (d, m) => d.n && d.n.src.port.postMessage(m);

export function seek(id, to) {
  const d = D(id); if (!d.len) return;
  to = Math.max(0, Math.min(d.len - 2, to));
  d._gen++; d._p = to; d._t = S.ctx.currentTime;
  post(d, { type: 'seek', v: to, gen: d._gen });
}
export function play(id) {
  const d = D(id), o = D(1 - id); if (!d.len || d.playing) return;
  d.playing = true; post(d, { type: 'play' });
  d.ev.play = now();
  d.ev.start = { t: now(), beat: beat(d), obeat: o.playing ? beat(o) : null };
}
export function pause(id) {
  const d = D(id); if (!d.playing) return;
  d.playing = false; d.cuePreview = false; post(d, { type: 'pause' }); d.ev.pause = now();
}
export const toggle = id => (D(id).playing ? pause(id) : play(id));

// CUE behaves like a CDJ: playing -> jump back to the cue point and stop.
// Paused -> set the cue point here, and play for as long as the button is held.
export function cueDown(id) {
  const d = D(id); if (!d.len) return;
  if (d.playing && !d.cuePreview) { pause(id); seek(id, d.cue); d.ev.cueStop = now(); return; }
  if (Math.abs(pos(d) - d.cue) > 64) d.cue = pos(d);
  play(id); d.cuePreview = true; d.ev.cueHold = now();
}
export function cueUp(id) {
  const d = D(id);
  if (d.cuePreview) { pause(id); seek(id, d.cue); }
}

export function setPitch(id, pct) {
  const d = D(id);
  d.pitch = Math.max(-d.range, Math.min(d.range, pct));
  post(d, { type: 'rate', v: 1 + d.pitch / 100 });
  apply();
}
export function setBend(id, v) { const d = D(id); d.bend = v; post(d, { type: 'bend', v }); if (v) d.ev.bend = now(); }
export function scratch(id, on, v = 0) { post(D(id), { type: 'scratch', on, v }); if (on) D(id).ev.scratch = now(); }

export function setKeylock(id, on) { const d = D(id); d.keylock = on; post(d, { type: 'keylock', v: on }); d.ev.keylock = now(); }

// Loop roll: hold a pad to repeat a short slice while the track keeps running underneath (slip).
export function rollDown(id, beats) {
  const d = D(id); if (!d.len) return;
  const g = Math.min(beats, 1) * d.spb, a = d.grid0 + Math.round((pos(d) - d.grid0) / g) * g;
  d.roll = { in: a, out: a + beats * d.spb }; post(d, { type: 'roll', v: d.roll }); d.ev.roll = now();
}
// Slicer: the current 8 beats are cut into 8 slices; hold a pad to replay that slice.
export function sliceDown(id, k) {
  const d = D(id); if (!d.len) return;
  const a = d.grid0 + (Math.floor(beat(d) / 8) * 8 + k) * d.spb;
  d.roll = { in: a, out: a + d.spb }; post(d, { type: 'roll', v: { ...d.roll, jump: true } });
  d.ev.slices = (d.ev.slices || 0) + 1;
}
export function rollUp(id) { const d = D(id); if (!d.roll) return; d.roll = null; post(d, { type: 'roll', v: null }); d.ev.rollUp = now(); }

export function sync(id) {
  const d = D(id), o = D(1 - id);
  if (S.noSync || !d.len || !o.len) return false;
  const want = (effBpm(o) / d.bpm - 1) * 100;
  if (Math.abs(want) > d.range) d.range = [8, 12, 20, 33, 50].find(r => r >= Math.abs(want)) || 50;
  setPitch(id, want);
  if (d.playing && o.playing) {
    const p = phase() * (id === 1 ? -1 : 1);
    seek(id, pos(d) + p * d.spb);
  }
  d.ev.sync = now();
  return true;
}

// ---------------------------------------------------------------- cues and loops
export function hotcue(id, i) {
  const d = D(id); if (!d.len) return;
  if (d.hot[i] === null) { d.hot[i] = d.playing ? snap(d, pos(d)) : pos(d); d.ev.hotSet = now(); }
  else { seek(id, d.hot[i]); d.ev.hotJump = now(); }
}
export function hotDelete(id, i) { D(id).hot[i] = null; }

function sendLoop(d) { post(d, { type: 'loop', v: d.loop.on ? { in: d.loop.in, out: d.loop.out } : null }); }
export function loopToggle(id) {
  const d = D(id); if (!d.len) return;
  if (d.loop.on) { d.loop.on = false; d.ev.loopOff = { t: now(), beat: beat(d) }; }
  else { d.loop.in = snap(d, pos(d)); d.loop.out = d.loop.in + d.loopBeats * d.spb; d.loop.on = true; d.ev.loopOn = now(); }
  sendLoop(d);
}
export function loopSize(id, dir) {
  const d = D(id);
  const i = LOOP_SIZES.indexOf(d.loopBeats) + dir;
  if (i < 0 || i >= LOOP_SIZES.length) return;
  d.loopBeats = LOOP_SIZES[i];
  if (d.loop.on) { d.loop.out = d.loop.in + d.loopBeats * d.spb; sendLoop(d); }
}
export function loopIn(id) { const d = D(id); if (!d.len) return; d.loop.in = snap(d, pos(d)); d.ev.loopIn = now(); }
export function loopOut(id) {
  const d = D(id); if (!d.len) return;
  if (d.loop.on) { d.loop.on = false; d.ev.loopOff = { t: now(), beat: beat(d) }; sendLoop(d); return; }
  const out = snap(d, pos(d));
  if (out - d.loop.in < d.spb / 8) return;
  d.loop.out = out; d.loop.on = true; d.ev.loopOn = now(); d.ev.loopManual = now();
  const b = (out - d.loop.in) / d.spb; if (LOOP_SIZES.includes(b)) d.loopBeats = b;
  sendLoop(d);
}

// ---------------------------------------------------------------- loading
function job(msg, transfer = []) {
  return new Promise(res => { const id = ++jobId; jobs.set(id, res); worker.postMessage({ ...msg, id }, transfer); });
}
function install(d, track, r) {
  d.track = track; d.len = r.ch[0].length; d.bpm = r.bpm; d.spb = r.spb; d.grid0 = r.grid0; d.wave = r.wave;
  d.cue = Math.max(0, r.grid0); d.hot = Array(8).fill(null); d.loop = { on: false, in: 0, out: 0 };
  d.playing = false; d.cuePreview = false; d.roll = null; d._gen++; d._p = d.cue; d._r = 0; d._t = S.ctx.currentTime;
  d.n.src.port.postMessage({ type: 'load', ch: r.ch }, r.ch.map(c => c.buffer));
  post(d, { type: 'rate', v: 1 + d.pitch / 100 }); post(d, { type: 'keylock', v: d.keylock });
  post(d, { type: 'seek', v: d.cue, gen: d._gen });
  d.loading = false; d.ev.load = now(); d.ev.start = null;
  apply();
}
export async function load(id, trackId) {
  const d = D(id);
  if (d.playing) pause(id);
  d.loading = true;
  const local = S.local.find(t => t.id === trackId);
  if (local) {
    const ch = local.ch.map(c => c.slice());
    install(d, local, await job({ type: 'analyse', ch, sr: S.ctx.sampleRate }, ch.map(c => c.buffer)));
  } else {
    const t = trackById(trackId);
    install(d, t, await job({ type: 'render', spec: t, sr: S.ctx.sampleRate }));
  }
}
export async function importFile(file) {
  const buf = await S.ctx.decodeAudioData(await file.arrayBuffer());
  const ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c).slice());
  const probe = ch.map(c => c.slice());
  const r = await job({ type: 'analyse', ch: probe, sr: S.ctx.sampleRate }, probe.map(c => c.buffer));
  const t = { id: 'local' + Date.now(), title: file.name.replace(/\.[^.]+$/, ''), artist: 'Local file', bpm: Math.round(r.bpm * 100) / 100, key: '', camelot: '', local: true, ch, dur: buf.duration };
  S.local.push(t);
  return t;
}

// Return the mixer and both decks to a neutral state (used at the start of every lesson).
export function reset() {
  S.cross = 0.5; S.noSync = false; S.hide = {}; S.hpMix = 0.5; S.hpVol = 0.7; S.ev = { samples: 0 };
  for (const d of S.decks) {
    pause(d.id); setBend(d.id, 0);
    d.range = 8; d.gain = 0.5; d.eq = { high: 0.5, mid: 0.5, low: 0.5 }; d.filter = 0.5; d.level = 1; d.pfl = false;
    d.fx.on = false; d.fx.str = 0.5; d.fx.len = 0.5;
    if (d.loop.on) loopToggle(d.id);
    rollUp(d.id); setKeylock(d.id, false); d.padPage = 'hot';
    d.loopBeats = 4; d.ev = {};
    setPitch(d.id, 0);
  }
  apply();
}
export function unload(id) {
  const d = D(id); pause(id);
  post(d, { type: 'load', ch: null });
  Object.assign(d, { track: null, len: 0, wave: null, _p: 0, _r: 0, hot: Array(8).fill(null) });
}

// ---------------------------------------------------------------- meters
const tmp = new Float32Array(512);
function peak(an) { an.getFloatTimeDomainData(tmp); let p = 0; for (let i = 0; i < 512; i++) { const a = Math.abs(tmp[i]); if (a > p) p = a; } return p; }
export function meters() {
  if (!S.ctx) return;
  for (const d of S.decks) d.vu = Math.max(peak(d.n.an), d.vu * 0.9);
  S.masterVu = Math.max(peak(G.an), S.masterVu * 0.9);
}
// 0..1: how much of this deck reaches the master
export const audible = d => Math.pow(d.level, 1.7) * (d.id ? (S.cross >= 0.5 ? 1 : Math.cos((0.5 - S.cross) * Math.PI)) : (S.cross <= 0.5 ? 1 : Math.cos((S.cross - 0.5) * Math.PI)));

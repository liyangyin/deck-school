// Builds the VirtualDJ-style interface and keeps it in step with the engine state.
import * as E from './engine.js';
import { S } from './engine.js';
import { TRACKS, TOTAL_BEATS } from './tracks.js';
import { drawRhythm, drawOverview } from './wave.js';

const $ = (s, r = document) => r.querySelector(s);
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const updaters = [];
const txt = (el, s) => { if (el._s !== s) { el._s = s; el.textContent = s; } };
const cls = (el, c, on) => { const k = '_c' + c; if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); } };
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
// Lesson targets: setGoals({ 'fader-0': 0, 'eq-low-1': 0.5 }) draws a marker on each control showing where to move it.
const goals = {};
export function setGoals(map) { for (const t in goals) goals[t](map && t in map ? map[t] : null); }

// ---------------------------------------------------------------- controls
function knob({ t, label, get, set, def = 0.5, bi = true, sm = false }) {
  const C = 2 * Math.PI * 17, ARC = C * 0.75;
  const el = h(`<div class="knob${sm ? ' sm' : ''}" data-t="${t}" tabindex="0" role="slider" aria-label="${label}">
    <svg viewBox="0 0 40 40"><g transform="rotate(135 20 20)"><circle class="k-track" cx="20" cy="20" r="17" stroke-dasharray="${ARC} ${C}"/><circle class="k-val" cx="20" cy="20" r="17"/><circle class="k-goal" cx="20" cy="20" r="17" stroke-dasharray="0 ${C}"/></g>
    <circle class="k-dot" cx="20" cy="3" r="3.2" style="display:none"/>
    <circle class="k-cap" cx="20" cy="20" r="12.5"/><line class="k-tick" x1="20" y1="8.5" x2="20" y2="15"/></svg><label>${label}</label></div>`);
  const val = $('.k-val', el), tick = $('.k-tick', el), gArc = $('.k-goal', el), gDot = $('.k-dot', el);
  let goal = null, lastG; goals[t] = v => goal = v;
  const put = v => { set(clamp(v)); E.apply(); };
  let sy, sx, sv;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); sy = e.clientY; sx = e.clientX; sv = get(); e.preventDefault(); el.focus(); });
  el.addEventListener('pointermove', e => { if (!el.hasPointerCapture(e.pointerId)) return; put(sv + ((sy - e.clientY) + (e.clientX - sx)) / 150 * (e.shiftKey ? 0.2 : 1)); });
  el.addEventListener('dblclick', () => put(def));
  el.addEventListener('wheel', e => { e.preventDefault(); put(get() - Math.sign(e.deltaY) * 0.02); }, { passive: false });
  el.addEventListener('keydown', e => { const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key]; if (k) { put(get() + k * 0.02); e.preventDefault(); } });
  let last;
  updaters.push(() => {
    const v = get(); if (v === last && goal === lastG) return; last = v; lastG = goal;
    if (goal == null) { gArc.setAttribute('stroke-dasharray', `0 ${C}`); gDot.style.display = 'none'; }
    else { gArc.setAttribute('stroke-dasharray', `0 ${Math.min(v, goal) * ARC} ${Math.abs(v - goal) * ARC} ${C}`); gDot.style.display = ''; gDot.setAttribute('transform', `rotate(${-135 + goal * 270} 20 20)`); }
    tick.setAttribute('transform', `rotate(${-135 + v * 270} 20 20)`);
    const a = bi ? Math.min(v, 0.5) : 0, len = bi ? Math.abs(v - 0.5) : v;
    val.setAttribute('stroke-dasharray', `0 ${a * ARC} ${len * ARC} ${C}`);
    el.setAttribute('aria-valuenow', v.toFixed(2));
  });
  return el;
}

// frac() / setFrac(): 0 = top (or left), 1 = bottom (or right)
function fader({ t, cls: c, frac, setFrac, reset, horiz = false, wheel, toFrac = v => v }) {
  const el = h(`<div class="${horiz ? 'hfader' : 'vfader'} ${c || ''}" data-t="${t}" tabindex="0"><div class="rail"></div><div class="goal-line" hidden></div><div class="goal" hidden></div><div class="cap"></div></div>`);
  const cap = $('.cap', el), gEl = $('.goal', el), gLine = $('.goal-line', el);
  let goal = null, lastG; goals[t] = v => goal = v;
  const span = () => { const r = el.getBoundingClientRect(), cr = cap.getBoundingClientRect(); return horiz ? r.width - cr.width : r.height - cr.height; };
  let s0, f0;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); e.preventDefault(); el.focus();
    if (e.target !== cap) { const r = el.getBoundingClientRect(), cr = cap.getBoundingClientRect(); setFrac(clamp(horiz ? (e.clientX - r.left - cr.width / 2) / span() : (e.clientY - r.top - cr.height / 2) / span())); }
    s0 = horiz ? e.clientX : e.clientY; f0 = frac();
  });
  el.addEventListener('pointermove', e => { if (!el.hasPointerCapture(e.pointerId)) return; setFrac(clamp(f0 + ((horiz ? e.clientX : e.clientY) - s0) / span() * (e.shiftKey ? 0.1 : 1))); });
  el.addEventListener('dblclick', () => reset && reset());
  if (wheel) el.addEventListener('wheel', e => { e.preventDefault(); wheel(Math.sign(e.deltaY)); }, { passive: false });
  el.addEventListener('keydown', e => { const k = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key]; if (k) { wheel ? wheel(k) : setFrac(clamp(frac() + k * 0.02)); e.preventDefault(); } });
  let last;
  updaters.push(() => {
    const f = frac(); if (f === last && goal === lastG) return; last = f; lastG = goal;
    const size = horiz ? cap.offsetWidth : cap.offsetHeight, sp = (horiz ? el.clientWidth : el.clientHeight) - size, at = horiz ? 'left' : 'top', ext = horiz ? 'width' : 'height';
    cap.style[at] = f * sp + 'px';
    gEl.hidden = gLine.hidden = goal == null;
    if (goal != null) { const gf = clamp(toFrac(goal)); gEl.style[at] = gf * sp + 'px'; gLine.style[at] = Math.min(f, gf) * sp + size / 2 + 'px'; gLine.style[ext] = Math.abs(f - gf) * sp + 'px'; }
  });
  return el;
}

const hold = (el, down, up) => {
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); down(); });
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
};

// ---------------------------------------------------------------- deck
const PAGES = [['hot', 'HOTCUES'], ['roll', 'LOOP ROLL'], ['slice', 'SLICER'], ['smp', 'SAMPLER']];
const ROLL_LABELS = ['1/16', '1/8', '1/4', '1/2', '1', '2', '4', '8'];
const SAMPLE_NAMES = ['Kick', 'Clap', 'HiHat', 'Snare', 'Crash', 'Horn', 'Siren', 'Laser'];
function buildDeck(i) {
  const d = S.decks[i], L = 'AB'[i], root = $('#deck-' + i);
  root.innerHTML = `
  <div class="deck-head">
    <div class="deck-tab">${L}</div>
    <div class="deck-info"><div class="deck-title"><span class="artist"></span><b class="title">Drag a track here</b></div><canvas class="overview" data-t="overview-${i}"></canvas></div>
    <div class="deck-nums"><div class="bpm" data-t="bpm-${i}"><small>BPM</small><span>---.--</span></div><div class="time"><span class="remain">0:00.0</span><small>KEY</small><span class="key">--</span></div></div>
  </div>
  <div class="deck-body">
    <div class="deck-side">
      <div class="sect"><span>FX</span></div>
      <div class="fx-row"><div class="fx-pick"><button class="btn fx-on" data-t="fx-on-${i}">ECHO</button><select class="fx-sel" aria-label="Effect">${Object.keys(E.FX).map(k => `<option value="${k}">${k.toUpperCase()}</option>`).join('')}</select></div></div>
      <div class="sect"><span>PADS</span></div>
      <div class="pad-tabs">${PAGES.map(([p, l]) => `<button class="ptab" data-page="${p}" data-t="tab-${p}-${i}">${l}</button>`).join('')}</div>
      <div class="pads" data-t="pads-${i}">${Array.from({ length: 8 }, () => `<button class="pad"></button>`).join('')}</div>
      <div class="sect"><span>LOOP</span></div>
      <div class="loop-row" data-t="loop-${i}"><button class="btn" data-t="loop-in-${i}">IN</button><button class="btn" data-t="loop-out-${i}">OUT</button><span class="gap"></span><button class="btn sq" data-t="loop-half-${i}">&#8249;</button><button class="btn loop-size" data-t="loop-toggle-${i}">4</button><button class="btn sq" data-t="loop-double-${i}">&#8250;</button></div>
    </div>
    <div class="deck-mid">
      <div class="jog" data-t="jog-${i}"><div class="platter"><div class="disc"><i></i></div></div></div>
      <div class="transport"><button class="btn big" data-t="cue-${i}">CUE</button><button class="btn big play" data-t="play-${i}" aria-label="Play / pause"><svg viewBox="0 0 10 10"><path d="M2 1l7 4-7 4z"/></svg></button><button class="btn big" data-t="sync-${i}">SYNC</button></div>
    </div>
    <div class="deck-pitch">
      <button class="btn pitch-val" title="Pitch. Double-click the fader to reset.">+0.00%</button>
      <button class="btn keylock" data-t="keylock-${i}" title="Key lock: change the tempo without changing the musical key"><svg viewBox="0 0 12 12"><path d="M3.5 5.5V4a2.5 2.5 0 015 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="5.5" width="7" height="5" rx="1" fill="currentColor"/></svg>KEY</button>
      <div class="pitch-wrap"></div>
      <div class="bend"><button class="btn sq" data-t="bend-minus-${i}" title="Pitch bend: hold to slow down">&minus;</button><button class="btn sq" data-t="bend-plus-${i}" title="Pitch bend: hold to speed up">+</button></div>
    </div>
  </div>`;
  const q = s => $(s, root);
  // effects
  const fxRow = q('.fx-row');
  const k1 = knob({ t: `fx-str-${i}`, label: 'STR', get: () => d.fx.str, set: v => d.fx.str = v, bi: false, sm: true });
  const k2 = knob({ t: `fx-len-${i}`, label: 'LEN', get: () => d.fx.len, set: v => d.fx.len = v, bi: false, sm: true });
  fxRow.append(k1, k2);
  q('.fx-on').onclick = () => { d.fx.on = !d.fx.on; d.ev.fx = performance.now(); E.apply(); };
  q('.fx-sel').onchange = e => { d.fx.type = e.target.value; E.apply(); };
  // pads: four pages, like VirtualDJ's pad section
  let heldPad = -1;
  root.querySelectorAll('.ptab').forEach(b => b.onclick = () => { E.rollUp(i); d.padPage = b.dataset.page; d.ev.page = performance.now(); });
  root.querySelectorAll('.pad').forEach((p, k) => {
    p.addEventListener('pointerdown', e => {
      if (e.button) return;
      p.setPointerCapture(e.pointerId); heldPad = k;
      if (d.padPage === 'hot') E.hotcue(i, k);
      else if (d.padPage === 'roll') E.rollDown(i, E.ROLLS[k]);
      else if (d.padPage === 'slice') E.sliceDown(i, k);
      else E.init().then(() => E.sample(k));
    });
    const up = () => { if (heldPad === k) { heldPad = -1; E.rollUp(i); } };
    p.addEventListener('pointerup', up); p.addEventListener('pointercancel', up);
    p.oncontextmenu = e => { e.preventDefault(); if (d.padPage === 'hot') E.hotDelete(i, k); };
  });
  q('.keylock').onclick = () => E.setKeylock(i, !d.keylock);
  q(`[data-t="loop-in-${i}"]`).onclick = () => E.loopIn(i);
  q(`[data-t="loop-out-${i}"]`).onclick = () => E.loopOut(i);
  q(`[data-t="loop-half-${i}"]`).onclick = () => E.loopSize(i, -1);
  q(`[data-t="loop-double-${i}"]`).onclick = () => E.loopSize(i, 1);
  q(`[data-t="loop-toggle-${i}"]`).onclick = () => E.loopToggle(i);
  // transport
  q(`[data-t="play-${i}"]`).onclick = () => E.toggle(i);
  hold(q(`[data-t="cue-${i}"]`), () => E.cueDown(i), () => E.cueUp(i));
  const syncBtn = q(`[data-t="sync-${i}"]`);
  syncBtn.onclick = () => { if (!E.sync(i)) { syncBtn.classList.add('nope'); setTimeout(() => syncBtn.classList.remove('nope'), 300); } };
  hold(q(`[data-t="bend-minus-${i}"]`), () => E.setBend(i, -0.04), () => E.setBend(i, 0));
  hold(q(`[data-t="bend-plus-${i}"]`), () => E.setBend(i, 0.04), () => E.setBend(i, 0));
  // pitch fader: top = slower, bottom = faster (like a turntable)
  q('.pitch-wrap').append(fader({
    t: `pitch-${i}`, cls: 'pitch',
    toFrac: v => (v + d.range) / (2 * d.range),
    frac: () => (d.pitch + d.range) / (2 * d.range), setFrac: f => E.setPitch(i, (f * 2 - 1) * d.range),
    reset: () => E.setPitch(i, 0), wheel: s => E.setPitch(i, d.pitch + s * 0.02),
  }));
  q('.pitch-val').onclick = () => { const r = [8, 12, 20]; d.range = r[(r.indexOf(d.range) + 1) % r.length] || 8; E.setPitch(i, d.pitch); };
  // jog wheel: centre = scratch, outer ring = nudge
  const jog = q('.jog'), disc = q('.disc');
  let jm = null, idle;
  jog.addEventListener('pointerdown', e => {
    if (!d.len) return;
    jog.setPointerCapture(e.pointerId); e.preventDefault();
    const r = jog.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const rad = Math.hypot(e.clientX - cx, e.clientY - cy) / (r.width / 2);
    jm = { cx, cy, a: Math.atan2(e.clientY - cy, e.clientX - cx), t: performance.now(), ring: rad > 0.74 };
    if (!jm.ring) E.scratch(i, true, 0);
    jog.classList.add(jm.ring ? 'nudging' : 'scratching');
  });
  jog.addEventListener('pointermove', e => {
    if (!jm) return;
    const a = Math.atan2(e.clientY - jm.cy, e.clientX - jm.cx), t = performance.now();
    let da = a - jm.a; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
    const w = da / Math.max(4, t - jm.t) * 1000 / 3.49;   // in platter revolutions at 33rpm
    jm.a = a; jm.t = t;
    clearTimeout(idle);
    if (jm.ring) { E.setBend(i, clamp(w * 0.12, -0.25, 0.25)); idle = setTimeout(() => E.setBend(i, 0), 70); }
    else { E.scratch(i, true, clamp(w, -6, 6)); idle = setTimeout(() => jm && E.scratch(i, true, 0), 70); }
  });
  const jend = () => { if (!jm) return; clearTimeout(idle); jm.ring ? E.setBend(i, 0) : E.scratch(i, false); jm = null; jog.classList.remove('nudging', 'scratching'); };
  jog.addEventListener('pointerup', jend); jog.addEventListener('pointercancel', jend);
  // overview click = seek
  const ov = q('.overview');
  ov.addEventListener('pointerdown', e => { if (!d.len) return; const r = ov.getBoundingClientRect(); E.seek(i, (e.clientX - r.left) / r.width * d.len); d.ev.seek = performance.now(); });
  // drop target
  root.addEventListener('dragover', e => { e.preventDefault(); root.classList.add('drop'); });
  root.addEventListener('dragleave', () => root.classList.remove('drop'));
  root.addEventListener('drop', e => { e.preventDefault(); root.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); if (id) loadTo(i, id); });

  const el = { title: q('.title'), artist: q('.artist'), bpm: q('.bpm span'), remain: q('.remain'), key: q('.key'), pv: q('.pitch-val'), play: q('.play'), cue: q(`[data-t="cue-${i}"]`),
    sync: syncBtn, kl: q('.keylock'), tabs: [...root.querySelectorAll('.ptab')], loop: q('.loop-size'), fx: q('.fx-on'), sel: q('.fx-sel'), pads: [...root.querySelectorAll('.pad')], l1: $('label', k1), l2: $('label', k2) };
  updaters.push(() => {
    const p = E.pos(d), sr = S.ctx ? S.ctx.sampleRate : 44100;
    txt(el.title, d.loading ? 'Loading…' : d.track ? d.track.title : 'Drag a track here');
    txt(el.artist, d.track && !d.loading ? d.track.artist + ' - ' : '');
    txt(el.bpm, !d.track ? '---.--' : S.hide['bpm' + i] ? '???.??' : E.effBpm(d).toFixed(2));
    const rem = d.len ? (d.len - p) / sr / (1 + d.pitch / 100) : 0;
    txt(el.remain, `${Math.floor(rem / 60)}:${(rem % 60).toFixed(1).padStart(4, '0')}`);
    txt(el.key, d.track?.camelot || '--');
    txt(el.pv, S.hide['bpm' + i] ? '?.??%' : `${d.pitch >= 0 ? '+' : ''}${d.pitch.toFixed(2)}%`);
    cls(el.play, 'on', d.playing && !d.cuePreview); cls(el.cue, 'on', d.cuePreview);
    cls(el.sync, 'off', S.noSync);
    txt(el.loop, d.loopBeats < 1 ? '1/' + 1 / d.loopBeats : String(d.loopBeats)); cls(el.loop, 'on', d.loop.on);
    txt(el.fx, d.fx.type.toUpperCase()); cls(el.fx, 'on', d.fx.on);
    if (el.sel.value !== d.fx.type) el.sel.value = d.fx.type;
    txt(el.l1, E.FX[d.fx.type][0]); txt(el.l2, E.FX[d.fx.type][1]);
    cls(el.kl, 'on', d.keylock);
    const pg = d.padPage, sl = pg === 'slice' && d.len ? ((Math.floor(E.beat(d)) % 8) + 8) % 8 : -1;
    el.tabs.forEach(b => cls(b, 'on', b.dataset.page === pg));
    el.pads.forEach((b, k) => {
      const tt = `${pg}-${i}-${k + 1}`; if (b._tt !== tt) { b._tt = tt; b.dataset.t = tt; b.dataset.page = pg; }
      cls(b, 'set', pg === 'hot' && d.hot[k] !== null);
      cls(b, 'held', (pg === 'roll' || pg === 'slice') && heldPad === k && !!d.roll);
      cls(b, 'cur', sl === k);
      txt(b, pg === 'hot' ? (d.hot[k] !== null ? 'Cue ' + (k + 1) : '') : pg === 'roll' ? ROLL_LABELS[k] : pg === 'slice' ? String(k + 1) : (S.samples[k]?.name || SAMPLE_NAMES[k]));
    });
    disc.style.transform = `rotate(${(p / sr) * 200}deg)`;
    cls(root, 'loaded', !!d.track);
    drawOverview(ov, d);
  });
}

// ---------------------------------------------------------------- mixer
function buildMixer() {
  const m = $('#mixer');
  m.innerHTML = `<div class="mix-tabs"><span class="on">AUDIO</span><span>VIDEO</span><span>SCRATCH</span><span>MASTER</span></div>
  <div class="mix-body"><div class="eqcol" id="eq-0"></div>
    <div class="mix-mid"><div class="gains"></div><div class="faders"></div><div class="pfls"></div></div>
  <div class="eqcol" id="eq-1"></div></div>
  <div class="xf-row"><span>A</span><div class="xf-wrap"></div><span>B</span></div>`;
  S.decks.forEach((d, i) => {
    const col = $('#eq-' + i);
    for (const b of ['high', 'mid', 'low']) col.append(knob({ t: `eq-${b}-${i}`, label: b.toUpperCase(), get: () => d.eq[b], set: v => d.eq[b] = v }));
    col.append(knob({ t: `filter-${i}`, label: 'FILTER', get: () => d.filter, set: v => d.filter = Math.abs(v - 0.5) < 0.025 ? 0.5 : v }));
  });
  const gains = $('.gains', m), fd = $('.faders', m), pf = $('.pfls', m);
  gains.append(
    knob({ t: 'gain-0', label: 'GAIN', get: () => S.decks[0].gain, set: v => S.decks[0].gain = v }),
    knob({ t: 'master', label: 'MASTER', get: () => S.master, set: v => S.master = v, def: 0.7, bi: false }),
    knob({ t: 'gain-1', label: 'GAIN', get: () => S.decks[1].gain, set: v => S.decks[1].gain = v }));
  const lev = i => fader({ t: `fader-${i}`, cls: 'level', toFrac: v => 1 - v, frac: () => 1 - S.decks[i].level, setFrac: f => { S.decks[i].level = 1 - f; E.apply(); } });
  const vu = h(`<div class="vus"><div class="vu" id="vu-0"><i></i></div><div class="vu" id="vu-1"><i></i></div></div>`);
  fd.append(lev(0), vu, lev(1));
  [0, 1].forEach(i => {
    const b = h(`<button class="btn pfl" data-t="pfl-${i}" aria-label="Headphone cue deck ${'AB'[i]}"><svg viewBox="0 0 16 16"><path d="M3 9V8a5 5 0 0110 0v1M3 9h2v4H3zM11 9h2v4h-2z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></button>`);
    b.onclick = () => { S.decks[i].pfl = !S.decks[i].pfl; E.apply(); };
    pf.append(b);
    updaters.push(() => cls(b, 'on', S.decks[i].pfl));
  });
  $('.xf-wrap', m).append(fader({ t: 'cross', cls: 'cross', horiz: true, frac: () => S.cross, setFrac: f => { S.cross = Math.abs(f - 0.5) < 0.02 ? 0.5 : f; E.apply(); }, reset: () => { S.cross = 0.5; E.apply(); } }));
  const bars = [$('#vu-0 i'), $('#vu-1 i')];
  updaters.push(() => bars.forEach((b, i) => { b.style.height = clamp(Math.pow(S.decks[i].vu, 0.6) * 100, 0, 100) + '%'; }));
}

function buildTop() {
  const hp = $('#hp');
  const vol = knob({ t: 'hpvol', label: 'VOL', get: () => S.hpVol, set: v => S.hpVol = v, def: 0.7, bi: false, sm: true });
  const mix = knob({ t: 'hpmix', label: 'CUE·MIX·MST', get: () => S.hpMix, set: v => S.hpMix = v, def: 0.5, sm: true });
  vol.title = 'Headphone volume'; mix.title = 'Headphone mix: fully left = cued decks only, fully right = master only';
  hp.append(vol, mix);
  const out = $('#out');
  out.innerHTML = Object.entries(E.OUTPUTS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
  out.onchange = async () => { const v = out.value; await E.init(); E.setOut(v); };
  const quadOpt = out.querySelector('[value="quad"]');
  const mm = $('#master-meter i'), clock = $('#clock');
  updaters.push(() => {
    if (out.value !== S.out && document.activeElement !== out) out.value = S.out;
    const dis = !!S.ctx && !S.quadOk; if (quadOpt.disabled !== dis) { quadOpt.disabled = dis; if (dis) quadOpt.textContent = E.OUTPUTS.quad + ' (no 4-channel device found)'; }
    mm.style.width = clamp(Math.pow(S.masterVu, 0.6) * 100, 0, 100) + '%';
    cls(mm, 'hot', S.masterVu > 0.95);
    txt(clock, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
  });
}

// ---------------------------------------------------------------- browser
let folder = 'crate', query = '', selected = null;
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export async function loadTo(i, id) { await E.init(); await E.load(i, id); renderFiles(); }
function autoDeck() {
  const [a, b] = S.decks;
  if (!a.track) return 0; if (!b.track) return 1;
  if (!a.playing) return 0; if (!b.playing) return 1;
  return -1;
}
export function renderFiles() {
  const list = (folder === 'crate' ? TRACKS : S.local).filter(t => (t.title + t.artist).toLowerCase().includes(query));
  $('#file-count').textContent = `${list.length} file${list.length === 1 ? '' : 's'}`;
  const body = $('#files tbody'); body.innerHTML = '';
  for (const t of list) {
    const on = S.decks.map((d, i) => (d.track?.id === t.id ? 'AB'[i] : '')).join('');
    const len = t.local ? t.dur : TOTAL_BEATS * 60 / t.bpm;
    const tr = h(`<table><tr draggable="true" data-t="track-${t.id}" class="${selected === t.id ? 'sel' : ''}"><td class="note">${on ? `<b class="on-deck d${on[0]}">${on}</b>` : '&#9834;'}</td><td>${t.title}</td><td>${t.artist}</td><td class="num">${Number(t.bpm).toFixed(1)}</td><td class="num">${t.camelot || '-'}</td><td class="num">${fmt(len)}</td></tr></table>`).querySelector('tr');
    tr.ondragstart = e => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'copy'; };
    tr.onclick = () => { selected = t.id; body.querySelectorAll('tr').forEach(r => r.classList.toggle('sel', r === tr)); };
    tr.ondblclick = () => { const i = autoDeck(); if (i >= 0) loadTo(i, t.id); };
    body.append(tr);
  }
  document.querySelectorAll('#folders [data-f]').forEach(f => f.classList.toggle('sel', f.dataset.f === folder));
  $('#local-count').textContent = S.local.length ? ` (${S.local.length})` : '';
}
function buildBrowser() {
  document.querySelectorAll('#folders [data-f]').forEach(f => f.onclick = () => { folder = f.dataset.f; renderFiles(); });
  $('#search').oninput = e => { query = e.target.value.toLowerCase(); renderFiles(); };
  $('#add-files').onclick = () => $('#file-input').click();
  $('#file-input').onchange = async e => {
    await E.init();
    for (const f of e.target.files) { try { await E.importFile(f); } catch { alert(`Could not read ${f.name}`); } }
    folder = 'local'; renderFiles(); e.target.value = '';
  };
  renderFiles();
}

export function build() {
  buildDeck(0); buildDeck(1); buildMixer(); buildTop(); buildBrowser();
  const rc = $('#rhythm-canvas');
  return function frame() {
    E.meters();
    for (const u of updaters) u();
    drawRhythm(rc);
  };
}

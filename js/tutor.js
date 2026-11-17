// Lesson runner: shows one step at a time, highlights the control to touch,
// polls the step's check() and moves on when the learner has done it.
import * as E from './engine.js';
import { LESSONS } from './lessons.js';
import { renderFiles, setGoals } from './ui.js';

const $ = s => document.querySelector(s);
const KEY = 'deckschool.done';
const done = new Set(JSON.parse(localStorage.getItem(KEY) || '[]'));
let li = -1, si = 0, L = null, t0 = 0, m = {}, held = null, doneAt = 0, busy = false, finished = false, n = 0;
let panel, callout, overlay, liveEl, holdEl;

const ctx = () => ({ S: E.S, A: E.S.decks[0], B: E.S.decks[1], E, m, t0, since: ts => !!ts && ts > t0 });
const val = (v, c) => (typeof v === 'function' ? v(c) : v);
const targets = c => (L && !finished && !doneAt ? (val(L.steps[si].target, c) || []) : []).map(t => document.querySelector(`[data-t="${t}"]`)).filter(Boolean);
const clearMarks = () => { document.querySelectorAll('.tut').forEach(e => e.classList.remove('tut')); setGoals(null); };

function foot(buttons) {
  return `<div class="ls-foot">${buttons.map(([id, label, primary]) => `<button class="btn${primary ? ' primary' : ''}" data-act="${id}">${label}</button>`).join('')}</div>`;
}
function renderStep() {
  const s = L.steps[si];
  panel.innerHTML = `<div class="ls-top"><span>Lesson ${li + 1} · ${L.title}</span><span class="grow"></span><span>Step ${si + 1} of ${L.steps.length}</span></div>
    <div class="ls-bar"><i style="width:${(si / L.steps.length) * 100}%"></i></div>
    <h2>${s.title}</h2><p>${s.text}</p>
    <div class="ls-live" hidden></div><div class="ls-hold" hidden><i></i></div><div class="ls-done" hidden></div>
    ${foot([...(s.manual ? [['next', 'Next →', true]] : []), ...(si > 0 ? [['back', '← Back']] : []), ...(s.manual ? [] : [['skip', 'Skip step']]), ['restart', 'Restart lesson'], ['menu', 'All lessons']])}`;
  liveEl = panel.querySelector('.ls-live'); holdEl = panel.querySelector('.ls-hold');
}
function enter(i) {
  si = i; t0 = performance.now(); held = null; doneAt = 0; finished = false;
  clearMarks();
  L.steps[i].enter?.(ctx());
  renderStep();
}
function complete() {
  const s = L.steps[si];
  doneAt = performance.now(); clearMarks(); callout.hidden = true;
  liveEl.hidden = true; holdEl.hidden = true;
  const d = panel.querySelector('.ls-done'); d.hidden = false; d.textContent = '✓ ' + (s.done || 'Done.');
}
function next() {
  if (si + 1 < L.steps.length) return enter(si + 1);
  finished = true; done.add(L.id); localStorage.setItem(KEY, JSON.stringify([...done]));
  clearMarks(); callout.hidden = true; E.S.hide = {}; E.S.noSync = false;
  const more = li + 1 < LESSONS.length;
  panel.innerHTML = `<div class="ls-top"><span>Lesson ${li + 1} complete</span></div><div class="ls-bar"><i style="width:100%"></i></div>
    <h2>${L.title}: done</h2><p>${more ? `Next up: <b>${LESSONS[li + 1].title}</b>. ${LESSONS[li + 1].sum}` : 'You have finished the course. Free Play keeps every control live, with your own music if you like.'}</p>
    ${foot([...(more ? [['nextlesson', 'Next lesson →', true]] : []), ['restart', 'Repeat this lesson'], ['menu', 'All lessons'], ['free', 'Free play']])}`;
}

export async function start(i) {
  hideMenu();
  busy = true; li = i; L = LESSONS[i]; m = {}; finished = false; clearMarks(); callout.hidden = true;
  panel.innerHTML = `<div class="ls-top"><span>Lesson ${i + 1}</span></div><h2>${L.title}</h2><p>Setting up the decks…</p>`;
  await L.setup(E);
  renderFiles();
  busy = false;
  enter(0);
}
export function freePlay() {
  hideMenu(); L = null; li = -1; clearMarks(); callout.hidden = true; E.S.hide = {}; E.S.noSync = false; E.init();
  panel.innerHTML = `<div class="ls-top"><span>Free play</span></div><h2>Free play</h2><p>Every control is live. Drag tracks from the browser onto a deck, or add your own files in the left column (their beat grid is estimated automatically).</p>
    <p>Double-click any knob or fader to reset it. Hold <kbd>Shift</kbd> while dragging for fine control. Right-click a pad to delete its hot cue.</p>${foot([['menu', 'All lessons', true]])}`;
}

function showMenu() {
  const groups = [...new Set(LESSONS.map(l => l.level))];
  overlay.innerHTML = `<div class="ov"><h1><svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="13" cy="19" r="7" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="13" cy="19" r="1.7" fill="currentColor"/><rect x="20" y="3" width="4" height="25" rx="2" fill="currentColor"/></svg>deck school</h1>
    <p class="sub">Learn to DJ on a two-deck layout that works like club-standard DJ software. Each lesson tells you exactly which control to touch and checks that you did it. ${done.size ? `${done.size} of ${LESSONS.length} lessons complete.` : 'Start at lesson 1; each one builds on the last.'}</p>
    ${groups.map(g => `<h3>${g}</h3><div class="ov-list">${LESSONS.map((l, i) => (l.level !== g ? '' : `<button class="ov-item${done.has(l.id) ? ' done' : ''}" data-lesson="${i}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span>${l.title}<small>${l.sum}</small></span><span class="st">${done.has(l.id) ? '✓ Done' : `${l.steps.length} steps`}</span></button>`)).join('')}</div>`).join('')}
    <div class="ov-foot"><button class="btn" data-act="free">Free play</button>${L ? '<button class="btn" data-act="close">Back to lesson</button>' : ''}<span>Sound starts when you pick a lesson. Headphones or speakers both work.</span></div></div>`;
  overlay.classList.add('show');
}
function hideMenu() { overlay.classList.remove('show'); }

function act(a) {
  if (a === 'next') next();
  else if (a === 'back') enter(si - 1);
  else if (a === 'skip') next();
  else if (a === 'restart') start(li);
  else if (a === 'nextlesson') start(li + 1);
  else if (a === 'menu') showMenu();
  else if (a === 'free') freePlay();
  else if (a === 'close') hideMenu();
}

export function mount() {
  panel = $('#lesson'); callout = $('#callout'); overlay = $('#overlay');
  panel.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
  overlay.addEventListener('click', e => {
    const l = e.target.closest('[data-lesson]'); if (l) return start(+l.dataset.lesson);
    const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act);
  });
  $('#btn-lessons').onclick = showMenu;
  showMenu();
}

export function tick() {
  if (!L || busy || finished) return;
  const now = performance.now(), s = L.steps[si], c = ctx();
  // keep lesson decks alive: near the end of a track, hop back four phrases (stays in phase)
  for (const d of E.S.decks) if (d.playing && d.len && d.len - E.pos(d) < d.spb * 3 + E.S.ctx.sampleRate) E.seek(d.id, E.pos(d) - 128 * d.spb);
  if (doneAt) { if (now - doneAt > (s.done && s.done.length > 60 ? 3200 : 1700)) next(); return; }
  // light up exactly the controls this step needs right now, and show where sliders should go
  const els = targets(c);
  document.querySelectorAll('.tut').forEach(e => { if (!els.includes(e)) e.classList.remove('tut'); });
  els.forEach(e => e.classList.add('tut'));
  setGoals(val(s.goal, c) || null);
  if (s.live) { const t = s.live(c); if (liveEl._t !== t) { liveEl._t = t; liveEl.textContent = t; liveEl.hidden = false; } }
  if (!s.manual) {
    const ok = !!s.check(c);
    if (liveEl && s.live) liveEl.classList.toggle('good', ok);
    if (ok) {
      held ??= now;
      const need = s.hold ?? 150;
      if (need >= 1000) { holdEl.hidden = false; holdEl.firstChild.style.width = Math.min(100, (now - held) / need * 100) + '%'; }
      if (now - held >= need) return complete();
    } else { held = null; if (!holdEl.hidden) holdEl.firstChild.style.width = '0%'; }
  }
  // callout bubble beside the first highlighted control
  const el = els[0], hint = val(s.hint, c);
  if (!el || !hint) { callout.hidden = true; return; }
  const r = el.getBoundingClientRect(), above = r.top > 70;
  callout.hidden = false; if (callout._t !== hint) { callout._t = hint; callout.textContent = hint; }
  callout.className = above ? 'above' : 'below';
  callout.style.left = Math.max(70, Math.min(innerWidth - 70, r.left + r.width / 2)) + 'px';
  callout.style.top = (above ? r.top - 40 : r.bottom + 12) + 'px';
}

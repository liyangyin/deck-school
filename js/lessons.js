// The course. Each step says exactly what to do and has a check() the tutor polls.
//   target: data-t names of the controls to light up (array, or c => array so only the
//           control needed right now is lit)
//   goal:   { 'data-t': value } (or c => that): draws a marker on a knob/fader showing where to move it.
//           Values are in the control's own units: faders 0..1 (1 = top), knobs 0..1 (0.5 = 12 o'clock),
//           pitch in %, crossfader 0..1 (0 = A side).
//   hint:   short text for the bubble beside the first lit control (string or c => string)
// c = { S, A, B, E, m (per-lesson scratch memory), t0 (step start, ms), since(ts) }
import { compatible } from './tracks.js';

const ctr = v => Math.abs(v - 0.5) < 0.04;
const mod32 = x => ((x % 32) + 32) % 32;
const toPhrase = (E, d) => 32 - mod32(E.beat(d));
const onPhrase = st => !!st && st.obeat != null && (mod32(st.obeat) <= 1.25 || mod32(st.obeat) >= 30.75);
const count = (E, d) => { const b = Math.max(0, Math.floor(E.beat(d))); return `bar ${Math.floor(b / 4) + 1} · beat ${b % 4 + 1}`; };
const phraseLive = c => `A: ${count(c.E, c.A)} · next phrase in ${Math.ceil(toPhrase(c.E, c.A))} beats`;
const diffLive = c => { const d = c.E.bpmDiff(); return Math.abs(d) < 0.05 ? `B ${c.E.effBpm(c.B).toFixed(2)} BPM: matched` : `B ${c.E.effBpm(c.B).toFixed(2)} BPM: ${Math.abs(d).toFixed(2)} too ${d > 0 ? 'fast (move the fader up)' : 'slow (move the fader down)'}`; };
const phaseLive = c => { const p = c.E.phase(); return Math.abs(p) < 0.06 ? 'Beats lined up' : `B is ${Math.abs(p).toFixed(2)} beat ${p > 0 ? 'ahead: hold − to pull it back' : 'behind: hold + to push it forward'}`; };
const matched = (c, bpmTol = 0.06, phTol = 0.06) => c.A.playing && c.B.playing && Math.abs(c.E.bpmDiff()) < bpmTol && Math.abs(c.E.phase()) < phTol;
const matchPitch = c => (c.E.effBpm(c.A) / c.B.bpm - 1) * 100;       // pitch % that puts B at A's tempo
const bendBtn = c => (c.E.phase() > 0 ? 'bend-minus-1' : 'bend-plus-1');
const pct = v => Math.round(v * 100) + '%';

// f(c) returns [[control, goalValueOrNull, isDone], ...]. need(): light every control not done yet.
// seq(): light only the first one not done, so multi-part steps walk you through in order.
const pick = (f, first) => {
  const todo = c => { const a = f(c).filter(x => !x[2]); return first ? a.slice(0, 1) : a; };
  return { target: c => todo(c).map(x => x[0]), goal: c => Object.fromEntries(todo(c).filter(x => x[1] != null).map(x => [x[0], x[1]])) };
};
const need = f => pick(f, false), seq = f => pick(f, true);

export async function stage(E, a, b) {
  await E.init(); E.reset();
  const specs = [a, b];
  for (let i = 0; i < 2; i++) {
    const sp = specs[i], d = E.S.decks[i];
    if (!sp) { if (d.track) E.unload(i); continue; }
    if (d.track?.id !== sp.id) await E.load(i, sp.id);
    d.hot.fill(null); d.cue = d.grid0 + (sp.cue || 0) * d.spb;
    E.seek(i, d.grid0 + (sp.at ?? sp.cue ?? 0) * d.spb);
    if (sp.pitch != null) E.setPitch(i, sp.pitch);
    if (sp.level != null) d.level = sp.level;
  }
  for (let i = 0; i < 2; i++) if (specs[i]?.match) E.setPitch(i, (E.effBpm(E.S.decks[1 - i]) / E.S.decks[i].bpm - 1) * 100);
  E.apply();
  for (let i = 0; i < 2; i++) if (specs[i]?.play) E.play(i);
  for (const d of E.S.decks) d.ev = {};
}

// reusable steps -------------------------------------------------------------
const syncB = {
  title: 'Match the tempo', target: ['sync-1'], hint: 'Click SYNC',
  text: `Deck B is loaded and paused with its fader down. Press the lit <kbd>SYNC</kbd> button on deck B. Because B is paused, SYNC only copies A's tempo: watch B's BPM change to match A.`,
  check: c => Math.abs(c.E.bpmDiff()) < 0.06, done: 'Tempos match.',
};
const startOnPhrase = (extra = '') => ({
  title: 'Start B on the first beat of a phrase',
  target: c => (c.B.playing && !onPhrase(c.B.ev.start) ? ['cue-1'] : ['play-1']),
  hint: c => (c.B.playing ? 'Mid-phrase: press CUE to rewind' : toPhrase(c.E, c.A) <= 1 ? 'NOW' : `Press ▶ in ${Math.ceil(toPhrase(c.E, c.A)) - 1}`),
  text: `Music changes every 8 bars. Start the new track exactly when A begins a new phrase and the two tracks will change together. The bubble on deck B's <kbd>▶</kbd> counts down the beats: press it when it says <b>NOW</b>.${extra} Missed it? Press <kbd>CUE</kbd> on B to rewind and try again.`,
  live: c => (c.B.playing ? (onPhrase(c.B.ev.start) ? 'Started on the phrase' : 'B started mid-phrase. Press CUE on B and try again') : phraseLive(c)),
  check: c => c.B.playing && !c.B.cuePreview && onPhrase(c.B.ev.start), done: 'Right on the phrase.',
});
const tighten = {
  title: 'Tighten the beats', target: c => ['sync-1', bendBtn(c)], hint: 'Click SYNC to snap the beats',
  text: `Your click was probably a few milliseconds off, so the kicks may "flam" (sound doubled). Press <kbd>SYNC</kbd> on B once more to snap the beats together. Or do it by hand: hold whichever pitch-bend button is lit (<kbd>−</kbd> or <kbd>+</kbd>) until the red and blue beat ticks line up.`,
  live: phaseLive, check: c => matched(c), hold: 600, done: 'Locked.',
};

export const LESSONS = [
  // ------------------------------------------------------------------ 1
  {
    id: 'play', level: 'Basics', title: 'Load and play a track', sum: 'Browser, play, cue, volume fader.',
    setup: E => stage(E, null, null),
    steps: [
      { title: 'Load a track onto deck A', target: ['track-t120'], hint: 'Double-click, or drag to deck A',
        text: `The bottom of the screen is the <b>browser</b>, your music library. Double-click the highlighted track, <b>Warm Up</b>, or drag it onto the left deck. The left deck is <b>deck A</b> (blue), the right deck is <b>deck B</b> (red).`,
        check: c => c.A.track?.id === 't120' && !c.A.loading, done: 'Loaded. The strip under the title is the whole song at a glance.' },
      { title: 'Press play', target: ['play-0'], hint: 'Click ▶',
        text: `Press the flashing <kbd>▶</kbd> button under deck A's jog wheel. The same button pauses.`,
        check: c => c.A.playing && !c.A.cuePreview, done: 'Playing.' },
      { title: 'Read the wave display', target: ['rhythm'], manual: true,
        text: `The strip across the top is the <b>rhythm wave</b>. The music scrolls right to left and the dark line in the middle is "now". Tall spikes are kick drums. The small ticks on the centre line mark every beat, taller ticks mark the first beat of each bar.` },
      { title: 'Pull the volume fader down', target: ['fader-0'], goal: { 'fader-0': 0 }, hint: 'Drag down to the dashed box',
        text: `In the centre <b>mixer</b>, each deck has a vertical <b>volume fader</b>. Drag deck A's fader (the left one) down to the dashed box at the bottom. The track keeps playing, you just can't hear it.`,
        live: c => `Deck A volume ${pct(c.A.level)}`, check: c => c.A.level < 0.03, done: 'Silent, but still running.' },
      { title: 'Bring it back up', target: ['fader-0'], goal: { 'fader-0': 1 }, hint: 'Drag up to the dashed box',
        text: `Push deck A's volume fader back to the top. This fader is how you bring tracks in and out of the mix.`,
        live: c => `Deck A volume ${pct(c.A.level)}`, check: c => c.A.level > 0.97, done: 'Full volume.' },
      { title: 'CUE: jump back to the start', target: ['cue-0'], hint: 'Click CUE',
        text: `While the track plays, press <kbd>CUE</kbd>. The deck stops and jumps back to the <b>cue point</b> (the grey marker, here the first beat of the track).`,
        check: c => !c.A.playing && c.since(c.A.ev.cueStop), done: 'Back at the cue point.' },
      { title: 'CUE: preview while held', target: ['cue-0'], hint: 'Press and hold',
        text: `Now the deck is paused on its cue point. <b>Press and hold</b> <kbd>CUE</kbd> for two seconds: the track plays only while you hold, and snaps back when you let go. DJs use this to check a starting point.`,
        check: c => c.A.cuePreview, hold: 1500, done: 'That is cue-play.' },
      { title: 'Play again', target: ['play-0'], hint: 'Click ▶',
        text: `Let go of CUE, then press <kbd>▶</kbd> to play for real. That is every transport button you need.`,
        check: c => c.A.playing && !c.A.cuePreview, hold: 400, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 2
  {
    id: 'mixer', level: 'Basics', title: 'The mixer: EQ, filter, gain, crossfader', sum: 'Hear what every mixer knob does.',
    setup: E => stage(E, { id: 't120', at: 160, play: true }, null),
    steps: [
      { title: 'Kill the bass', target: ['eq-low-0'], goal: { 'eq-low-0': 0 }, hint: 'Drag down until the amber arc is gone',
        text: `Each deck has three EQ knobs: <kbd>HIGH</kbd>, <kbd>MID</kbd>, <kbd>LOW</kbd>. Drag deck A's <kbd>LOW</kbd> knob downward until its pointer reaches the amber dot (fully left). Drag up or down on a knob to turn it.`,
        live: c => `LOW ${c.E.eqDbOf(c.A.eq.low).toFixed(0)} dB`, check: c => c.A.eq.low < 0.04, done: 'The kick and bassline are gone. Hats and chords remain.' },
      { title: 'Reset the knob', target: ['eq-low-0'], goal: { 'eq-low-0': 0.5 }, hint: 'Double-click',
        text: `<b>Double-click</b> the <kbd>LOW</kbd> knob. Every knob and fader snaps back to its default when you double-click it. 12 o'clock means "unchanged".`,
        check: c => ctr(c.A.eq.low), done: 'Bass is back.' },
      { title: 'Leave only the bass', ...need(c => [['eq-high-0', 0, c.A.eq.high < 0.04], ['eq-mid-0', 0, c.A.eq.mid < 0.04]]), hint: 'Turn fully left',
        text: `Turn <kbd>HIGH</kbd> and <kbd>MID</kbd> fully left, to their amber dots. HIGH holds the hi-hats and sparkle. MID holds chords, vocals and claps. What is left is the kick and bass.`,
        check: c => c.A.eq.high < 0.04 && c.A.eq.mid < 0.04, done: 'Only low end remains.' },
      { title: 'Reset HIGH and MID', ...need(c => [['eq-high-0', 0.5, ctr(c.A.eq.high)], ['eq-mid-0', 0.5, ctr(c.A.eq.mid)]]), hint: 'Double-click',
        text: `Double-click <kbd>HIGH</kbd> and <kbd>MID</kbd> to return them to 12 o'clock.`,
        check: c => ctr(c.A.eq.high) && ctr(c.A.eq.mid), done: 'Flat EQ.' },
      { title: 'Filter: sweep right', target: ['filter-0'], goal: { 'filter-0': 0.88 }, hint: 'Turn right to the dot',
        text: `<kbd>FILTER</kbd> is one knob with two jobs. Turn it <b>right</b>, to the amber dot: this is a high-pass filter, it removes bass and then mids, leaving a thin, airy sound.`,
        check: c => c.A.filter > 0.8, done: 'High-pass.' },
      { title: 'Filter: sweep left', target: ['filter-0'], goal: { 'filter-0': 0.12 }, hint: 'Turn left to the dot',
        text: `Now turn <kbd>FILTER</kbd> <b>left</b>, to the amber dot: a low-pass filter. The track sounds like it is playing in the next room.`,
        check: c => c.A.filter < 0.2, done: 'Low-pass.' },
      { title: 'Filter off', target: ['filter-0'], goal: { 'filter-0': 0.5 }, hint: 'Double-click',
        text: `Double-click <kbd>FILTER</kbd>. At 12 o'clock the filter does nothing.`,
        check: c => ctr(c.A.filter), done: 'Filter off.' },
      { title: 'Gain and the level meter', target: ['gain-0'], goal: { 'gain-0': 0.68 }, hint: 'Turn right to the dot',
        text: `<kbd>GAIN</kbd> sets how loud the track enters the mixer, before the fader. Turn deck A's <kbd>GAIN</kbd> to the amber dot (about 2 o'clock) and watch the meter between the faders climb. Keep meters out of the red: red means distortion.`,
        check: c => c.A.gain > 0.62, done: 'Louder. In a real set you use GAIN to make two tracks equally loud.' },
      { title: 'Reset gain', target: ['gain-0'], goal: { 'gain-0': 0.5 }, hint: 'Double-click',
        text: `Double-click <kbd>GAIN</kbd>.`, check: c => ctr(c.A.gain), done: 'Unity gain.' },
      { title: 'Crossfader to B', target: ['cross'], goal: { cross: 1 }, hint: 'Drag right to the dashed box',
        text: `The horizontal <b>crossfader</b> at the bottom fades between decks. Drag it fully <b>right</b> to the B side. Deck A goes silent even though its volume fader is up.`,
        check: c => c.S.cross > 0.97, done: 'Only deck B would be heard now.' },
      { title: 'Crossfader to centre', target: ['cross'], goal: { cross: 0.5 }, hint: 'Double-click',
        text: `Double-click the crossfader to centre it. In the centre both decks play at full volume. Most house DJs leave it here and mix with the volume faders and EQ.`,
        check: c => ctr(c.S.cross), done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 3
  {
    id: 'phrases', level: 'Basics', title: 'Beats, bars and phrases', sum: 'Count the music and place a hot cue.',
    setup: E => stage(E, { id: 't120' }, null),
    steps: [
      { title: 'How dance music is built', manual: true,
        text: `House music is counted in fours. One kick drum = one <b>beat</b>. Four beats = one <b>bar</b>. Eight bars (32 beats) = one <b>phrase</b>. Something changes at the start of almost every phrase: a new sound enters, the bass drops, the drums stop. Mixing well means lining up your phrases, not only your beats.` },
      { title: 'Count the beats', target: c => (c.A.playing ? ['rhythm'] : ['play-0']), hint: c => (c.A.playing ? '' : 'Click ▶'),
        text: `Press <kbd>▶</kbd> on deck A and count out loud with the kick: <b>1, 2, 3, 4, 1, 2, 3, 4</b>. The counter below shows where you are. Keep counting until bar 5.`,
        live: c => count(c.E, c.A), check: c => c.A.playing && c.E.beat(c.A) >= 16, done: 'That was four bars.' },
      { title: 'Hear the phrase change', target: ['rhythm'],
        text: `Keep counting. At <b>bar 9</b> the first phrase ends and a new one begins: listen for claps joining the drums. In the wave display, phrase starts have a full-height line with the bar number.`,
        live: c => `${count(c.E, c.A)} · phrase change at bar 9`, check: c => c.E.beat(c.A) >= 33, done: 'New phrase, new sound.' },
      { title: 'Mark a phrase with a hot cue', target: ['hot-0-1'], hint: c => (c.A.hot[0] !== null ? 'Right-click to delete, then retry' : toPhrase(c.E, c.A) <= 1 ? 'NOW' : `Click in ${Math.ceil(toPhrase(c.E, c.A)) - 1}`),
        text: `The 8 <b>pads</b> store <b>hot cues</b>: bookmarks you can jump to instantly. The bubble on the first pad counts down to the next phrase: click the pad when it says <b>NOW</b>. If you miss, right-click the pad to delete it and try again.`,
        live: c => (c.A.hot[0] === null ? phraseLive(c) : (mod32((c.A.hot[0] - c.A.grid0) / c.A.spb) < 1.5 || mod32((c.A.hot[0] - c.A.grid0) / c.A.spb) > 30.5 ? 'Cue 1 is on a phrase start' : `Cue 1 landed on bar ${Math.floor((c.A.hot[0] - c.A.grid0) / c.A.spb / 4) + 1}, not a phrase start. Right-click pad 1 and retry`)),
        check: c => { if (c.A.hot[0] === null) return false; const b = mod32((c.A.hot[0] - c.A.grid0) / c.A.spb); return b < 1.5 || b > 30.5; }, done: 'Cue 1 marks the start of a phrase.' },
      { title: 'Jump to the hot cue', target: ['hot-0-1'], hint: 'Click Cue 1',
        text: `Let the track run for a few bars, then click <kbd>Cue 1</kbd>. Playback jumps straight back to your marker without stopping.`,
        check: c => c.since(c.A.ev.hotJump), done: 'Instant jump.' },
      { title: 'Read the song overview', target: ['overview-0'], hint: 'Click the thin section',
        text: `The strip under the track title shows the whole song. Fat sections have kick and bass. The <b>thin section</b> about a third of the way in is a <b>breakdown</b> (no drums). Click inside that thin section to jump there and listen.`,
        check: c => c.E.beat(c.A) >= 128 && c.E.beat(c.A) < 160, done: 'That is the breakdown. The fat part after it is the drop. Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 4
  {
    id: 'tempo', level: 'Beatmatching', title: 'Tempo and the pitch fader', sum: 'Make two tracks the same speed.',
    setup: E => stage(E, { id: 't120', at: 64, play: true }, { id: 't124', level: 0 }),
    steps: [
      { title: 'Two tracks, two speeds', target: ['bpm-0', 'bpm-1'], manual: true,
        text: `Each deck shows its tempo in <b>BPM</b> (beats per minute). Deck A plays at <b>120.00</b>. Deck B is loaded with a track at <b>124.00</b>. Played together, their kicks would drift apart within a second. Step one of every mix: make the tempos equal.` },
      { title: 'Slow deck B down to 120', target: ['pitch-1'], goal: c => ({ 'pitch-1': matchPitch(c) }), hint: 'Drag up to the dashed box',
        text: `The tall fader beside each jog wheel is the <b>pitch fader</b>. <b>Up = slower, down = faster.</b> Drag deck B's pitch fader <b>up</b> to the dashed box, until its BPM reads <b>120.00</b>. For the last fine steps hold <kbd>Shift</kbd> while dragging, or scroll the mouse wheel over the fader.`,
        live: diffLive, check: c => Math.abs(c.E.bpmDiff()) < 0.05, hold: 500, done: 'Both decks at 120 BPM.' },
      { title: 'See it in the grid', target: c => (c.B.playing ? ['rhythm'] : ['play-1']), hint: c => (c.B.playing ? '' : 'Click ▶ on B'),
        text: `Deck B's volume fader is down, so nobody hears it. Press <kbd>▶</kbd> on deck B and look at the wave display: blue ticks (A) and red ticks (B) now move at the same speed. They are probably not lined up yet. That is the next lesson.`,
        check: c => c.B.playing, hold: 2500, done: 'Same speed.' },
      { title: 'Reset the pitch', target: ['pitch-1'], goal: { 'pitch-1': 0 }, hint: 'Double-click',
        text: `Double-click deck B's pitch fader to return it to 0%. Watch the red ticks start sliding past the blue ones again: that is what a tempo mismatch looks like.`,
        check: c => Math.abs(c.B.pitch) < 0.01, hold: 1500, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 5
  {
    id: 'beatmatch', level: 'Beatmatching', title: 'Beatmatching: line up the kicks', sum: 'Pitch bend, jog nudge and SYNC.',
    setup: E => stage(E, { id: 't120', at: 64, play: true }, { id: 't124', match: true, level: 0.75 }),
    steps: [
      { title: 'Start deck B', target: ['play-1'], hint: 'Press on a kick',
        text: `Deck A is playing. Deck B is already slowed to 120 BPM and, for practice, you can hear it (the next lesson moves this into headphones). Press <kbd>▶</kbd> on deck B, aiming for one of A's kicks.`,
        check: c => c.B.playing && !c.B.cuePreview, done: 'Both decks are running.' },
      { title: 'Nudge the beats together', target: c => (Math.abs(c.E.phase()) < 0.06 ? [] : [bendBtn(c)]), hint: c => (c.E.phase() > 0 ? 'Hold − : B is ahead' : 'Hold + : B is behind'),
        text: `If the kicks sound doubled or galloping, B is early or late. Under B's pitch fader, the button you need is lit: hold <kbd>+</kbd> to push B forward or <kbd>−</kbd> to pull it back. It only changes speed while held. You can also drag the <b>outer edge of the jog wheel</b>. Line the red ticks up exactly under the blue ticks and keep them there for 8 beats.`,
        live: phaseLive, check: c => matched(c), hold: 4000, done: 'One clean kick. That is a beatmatch.' },
      { title: 'Fix a drifting mix',
        target: c => (Math.abs(c.E.bpmDiff()) >= 0.05 ? ['pitch-1'] : Math.abs(c.E.phase()) < 0.06 ? [] : [bendBtn(c)]),
        goal: c => (Math.abs(c.E.bpmDiff()) >= 0.05 ? { 'pitch-1': matchPitch(c) } : null),
        hint: c => (Math.abs(c.E.bpmDiff()) >= 0.05 ? 'Speed first: move to the dashed box' : 'Now nudge'),
        enter: c => c.E.setPitch(1, c.B.pitch + 0.45),
        text: `Deck B's tempo has just been knocked slightly off, so it keeps drifting. Nudging alone will not hold. <b>First</b> fix the speed with B's pitch fader (Shift-drag or mouse wheel for fine steps), <b>then</b> nudge the beats back together.`,
        live: c => (Math.abs(c.E.bpmDiff()) >= 0.05 ? diffLive(c) : phaseLive(c)), check: c => matched(c, 0.05), hold: 5000, done: 'Speed first, then position. Always in that order.' },
      { title: 'What SYNC does', target: ['sync-1'], hint: 'Click SYNC',
        enter: c => c.E.setPitch(1, c.B.pitch + 2),
        text: `Deck B has been thrown off again. Press <kbd>SYNC</kbd> on deck B: it matches the tempo and lines up the beats in one click. Use it freely, but now you know what it is doing, and you can fix a mix when it gets it wrong.`,
        check: c => c.since(c.B.ev.sync) && matched(c), hold: 800, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 6
  {
    id: 'cue', level: 'Beatmatching', title: 'Headphone cue: prepare in private', sum: 'Hear the next track before the crowd does.',
    setup: E => stage(E, { id: 't120', at: 64, play: true }, { id: 't124', match: true, level: 0 }),
    steps: [
      { title: 'Two mixes at once', manual: true,
        text: `A DJ mixer makes two separate mixes. The <b>master</b> goes to the speakers: it is what the crowd hears. The <b>headphone</b> mix is private: it carries whichever decks you have <b>cued</b>, even with their volume fader fully down. That is how you find the beat of the next track without anyone hearing it.` },
      { title: 'Tell the simulator how you are listening', target: ['out'], hint: 'Pick an output',
        text: `Open the <kbd>OUTPUT</kbd> menu in the top bar and choose:<br>• <b>Headphones only</b>: wearing headphones plugged into this computer. You hear exactly what a DJ hears in their headphones.<br>• <b>Split cable</b>: a DJ splitter cable. Left channel = master to the speakers, right channel = headphones.<br>• <b>Sound card</b>: a DJ controller or 4-channel interface. Master on outputs 1-2, headphones on 3-4.`,
        check: c => c.S.out !== 'speakers', done: 'Output set. The MASTER meter in the top bar always shows what the crowd hears.' },
      { title: 'Cue deck B', target: ['pfl-1'], hint: 'Click the headphone button',
        text: `Under each volume fader is a <b>headphone button</b> (often labelled CUE or PFL). Press the one under deck B's fader. It lights up: deck B is now sent to your headphones.`,
        check: c => c.B.pfl, done: 'Deck B is cued.' },
      { title: 'Listen to the cue only', target: ['hpmix'], goal: { hpmix: 0 }, hint: 'Turn fully left',
        text: `In the top bar, the headphone <kbd>MIX</kbd> knob blends what you hear: fully left = cued decks only, fully right = master only. Turn it fully <b>left</b>. Deck B is paused, so your headphones go quiet, while the MASTER meter shows deck A still playing to the room.`,
        check: c => c.S.hpMix < 0.06, done: 'Headphones: cue only.' },
      { title: 'Play deck B, in secret', target: ['play-1'], hint: 'Click ▶',
        text: `Press <kbd>▶</kbd> on deck B. You hear it in your headphones, but its volume fader is at zero: the crowd hears nothing of it. Look at the MASTER meter: unchanged.`,
        check: c => c.B.playing && c.B.level < 0.05, hold: 2500, done: 'Only you can hear deck B.' },
      { title: 'Hear both: MIX to the middle', target: ['hpmix'], goal: { hpmix: 0.5 }, hint: 'Double-click',
        text: `Double-click the <kbd>MIX</kbd> knob to centre it. Now your headphones carry deck B (cue) and deck A (master) together, so you can compare their beats.`,
        check: c => Math.abs(c.S.hpMix - 0.5) < 0.08, done: 'Cue and master together.' },
      { title: 'Beatmatch in the headphones', target: c => (Math.abs(c.E.phase()) < 0.06 ? [] : [bendBtn(c)]), hint: c => (c.E.phase() > 0 ? 'Hold − : B is ahead' : 'Hold + : B is behind'),
        text: `Line up deck B with the lit pitch-bend button until the two kicks become one. Keep B's volume fader down: this all happens in private. Hold it in time for 8 beats.`,
        live: phaseLive, check: c => matched(c) && c.B.level < 0.05, hold: 4000, done: 'Matched before the crowd heard a thing.' },
      { title: 'Bring it to the room', ...seq(c => [['fader-1', 1, c.B.level > 0.97], ['pfl-1', null, !c.B.pfl]]), hint: c => (c.B.level > 0.97 ? 'Switch the cue off' : 'Raise to the dashed box'),
        text: `Now raise deck B's volume fader to the top: the crowd hears it for the first time, already in time. Then press deck B's headphone button again to switch its cue off.`,
        check: c => c.B.level > 0.97 && !c.B.pfl, done: 'That is the real DJ workflow: cue, match, then mix. Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 7
  {
    id: 'ear', level: 'Beatmatching', title: 'Beatmatch by ear', sum: 'No BPM numbers, no waveform, no SYNC.',
    setup: async E => { await stage(E, { id: 't122', at: 64, play: true }, { id: 't126', level: 0.75 }); E.S.hide = { bpm1: true, wave1: true }; E.S.noSync = true; if (E.S.out !== 'speakers') { E.S.decks[1].level = 0; E.S.decks[1].pfl = true; E.apply(); } },
    steps: [
      { title: 'The method', manual: true,
        text: `Deck B's BPM, pitch value and waveform are hidden, and SYNC is off. You only have your ears. If you set up headphones in the last lesson, deck B is cued and its fader is down; otherwise you hear it on the speakers. The loop is: <b>1.</b> Start B on a kick. <b>2.</b> Listen: if B's kick starts arriving <i>before</i> A's, B is too fast, so move its pitch fader up. If it falls behind, move it down. <b>3.</b> Nudge back in line and listen again. Each round the drift gets slower.` },
      { title: 'Start B on a kick', target: ['play-1'], hint: 'Click ▶',
        text: `Press <kbd>▶</kbd> on deck B in time with A's kick.`,
        check: c => c.B.playing && !c.B.cuePreview, done: 'Listen to the two kicks.' },
      { title: 'Match it by ear', target: ['pitch-1', 'bend-minus-1', 'bend-plus-1'], hint: 'Listen, adjust, nudge',
        text: `Adjust B's pitch fader until the kicks stop drifting, nudging with <kbd>−</kbd> / <kbd>+</kbd> to re-align as you go. Hold the two tracks in time for <b>8 seconds</b>. No markers this time: that is the point. Stuck? Deck B starts out faster than A.`,
        live: c => (matched(c, 0.12, 0.08) ? 'In time. Hold it…' : (performance.now() - c.t0 > 60000 ? `Hint: B is ${c.E.bpmDiff() > 0 ? 'too fast (fader up)' : 'too slow (fader down)'}` : 'Listening…')),
        check: c => matched(c, 0.12, 0.08), hold: 8000, done: 'Matched with nothing but your ears.' },
      { title: 'Check your work', target: ['bpm-1'], manual: true, enter: c => { c.S.hide = {}; c.S.noSync = false; },
        text: `The numbers are back. Look at how close deck B's BPM is to deck A's. Within 0.1 BPM is a solid beatmatch: it holds for a full 8-bar blend with only a nudge or two.` },
    ],
  },
  // ------------------------------------------------------------------ 8
  {
    id: 'blend', level: 'Transitions', title: 'Your first transition: the fader blend', sum: 'Bring B in on the phrase, take A out.',
    setup: E => stage(E, { id: 't120', at: 324, play: true }, { id: 't124', level: 0 }),
    steps: [
      syncB,
      startOnPhrase(` A is in its last big section, so any of the next few phrase starts is a good moment.`),
      tighten,
      { title: 'Bring B in', target: ['fader-1'], goal: { 'fader-1': 1 }, hint: 'Raise slowly to the dashed box',
        text: `Slowly raise deck B's <b>volume fader</b> to the top. Take about 4 bars. B is on its drum intro, so it layers neatly over A.`,
        live: c => `Deck B volume ${pct(c.B.level)}`, check: c => c.B.level > 0.97, done: 'Two tracks, one groove.' },
      { title: 'Take A out', target: ['fader-0'], goal: { 'fader-0': 0 }, hint: 'Lower slowly to the dashed box',
        text: `Now slowly lower deck A's volume fader to the bottom, again over a few bars. Ideally you finish as a phrase ends.`,
        live: c => `Deck A volume ${pct(c.A.level)} · ${phraseLive(c)}`, check: c => c.A.level < 0.03, done: 'Deck B is now the only track playing.' },
      { title: 'Stop the old track', target: ['play-0'], hint: 'Pause A',
        text: `Press <kbd>▶</kbd> on deck A to stop it. Deck A is now free for the next track. That is a complete transition.`,
        check: c => !c.A.playing && c.B.playing, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 9
  {
    id: 'eqmix', level: 'Transitions', title: 'EQ mixing: swap the bass', sum: 'Never let two basslines play together.',
    setup: E => stage(E, { id: 't124', at: 164, play: true }, { id: 't122', at: 64, cue: 64, level: 0 }),
    steps: [
      { title: 'Why EQ?', manual: true,
        text: `Two kicks and two basslines at once sound muddy and loud. The fix is the most important move in house mixing: bring the new track in <b>without its bass</b>, then <b>swap</b> the bass from the old track to the new one on a phrase change. This time deck B is cued at a section that already has a bassline.` },
      { title: 'Cut the bass on B before it comes in', target: ['eq-low-1'], goal: { 'eq-low-1': 0 }, hint: 'Turn fully left',
        text: `Turn deck B's <kbd>LOW</kbd> knob fully left, to the amber dot.`, check: c => c.B.eq.low < 0.04, done: 'B has no bass.' },
      syncB,
      startOnPhrase(),
      tighten,
      { title: 'Bring B in without bass', target: ['fader-1'], goal: { 'fader-1': 1 }, hint: 'Raise to the dashed box',
        text: `Raise deck B's volume fader to the top. You hear B's hats, claps and percussion on top of A, but A still owns the low end.`,
        check: c => c.B.level > 0.97, done: 'B is in, bass-free.' },
      { title: 'Swap the bass', ...need(c => [['eq-low-0', 0, c.A.eq.low < 0.06], ['eq-low-1', 0.5, ctr(c.B.eq.low)]]),
        hint: c => (toPhrase(c.E, c.A) <= 1 ? 'NOW' : `Swap in ${Math.ceil(toPhrase(c.E, c.A)) - 1}`),
        text: `The bubble counts down to the next phrase. When it says <b>NOW</b>, do both at once: turn deck A's <kbd>LOW</kbd> fully <b>left</b> and double-click deck B's <kbd>LOW</kbd> to bring it <b>back to centre</b>. The bassline changes hands.`,
        live: phraseLive, check: c => c.A.eq.low < 0.06 && ctr(c.B.eq.low), done: 'B now carries the bass.' },
      { title: 'Fade A out', target: ['fader-0'], goal: { 'fader-0': 0 }, hint: 'Lower to the dashed box',
        text: `Deck A is now just hats and mids. Lower its volume fader to zero over a few bars.`,
        check: c => c.A.level < 0.03, done: 'Clean exit.' },
      { title: 'Reset deck A', ...seq(c => [['eq-low-0', 0.5, ctr(c.A.eq.low)], ['play-0', null, !c.A.playing]]), hint: c => (ctr(c.A.eq.low) ? 'Pause A' : 'Double-click LOW'),
        text: `Good habits: double-click deck A's <kbd>LOW</kbd> to reset it and press <kbd>▶</kbd> on A to stop it, so the deck is neutral for the next track.`,
        check: c => ctr(c.A.eq.low) && !c.A.playing, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 10
  {
    id: 'loops', level: 'Transitions', title: 'Loops: buy yourself time', sum: 'Auto loops, halving, manual in/out.',
    setup: E => stage(E, { id: 't120', at: 388, play: true }, { id: 't124', level: 0 }),
    steps: [
      { title: 'The track is running out', target: ['loop-0'], manual: true,
        text: `Deck A is in its outro: under a minute left. A <b>loop</b> repeats a section for as long as you like, giving you time to mix. The LOOP row has <kbd>IN</kbd> and <kbd>OUT</kbd>, and a size box with <kbd>‹</kbd> <kbd>›</kbd> arrows. The number is the loop length in beats.` },
      { title: 'Set the loop size to 8 beats', target: c => [c.A.loopBeats < 8 ? 'loop-double-0' : 'loop-half-0'], hint: c => (c.A.loopBeats < 8 ? 'Click ›' : 'Click ‹'),
        text: `Click the lit arrow on deck A until the loop size reads <b>8</b> beats (two bars).`,
        check: c => c.A.loopBeats === 8, done: '8 beats.' },
      { title: 'Turn the loop on', target: ['loop-toggle-0'], hint: 'Click the number',
        text: `Click the <b>number</b> itself. The box lights up and deck A now repeats those two bars forever. The shaded area in the wave display is the loop.`,
        check: c => c.A.loop.on, hold: 2000, done: 'Looping. The track will never run out.' },
      { title: 'Halve it: 4, 2, 1', target: c => (c.A.loop.on ? ['loop-half-0'] : ['loop-toggle-0']), hint: c => (c.A.loop.on ? `Click ‹ (${c.A.loopBeats} → 1)` : 'Turn the loop back on'),
        text: `With the loop running, click <kbd>‹</kbd> three times: 4 beats, 2 beats, 1 beat. This stutter is a classic way to build tension.`,
        check: c => c.A.loop.on && c.A.loopBeats <= 1, done: 'A one-beat roll.' },
      { title: 'Back to 8', target: ['loop-double-0'], hint: c => `Click › (${c.A.loopBeats < 1 ? '1/' + 1 / c.A.loopBeats : c.A.loopBeats} → 8)`,
        text: `Click <kbd>›</kbd> until the loop is 8 beats again.`, check: c => c.A.loop.on && c.A.loopBeats === 8, done: 'Steady loop.' },
      { title: 'Mix B in under the loop',
        ...seq(c => [['sync-1', null, Math.abs(c.E.bpmDiff()) < 0.06], ['play-1', null, c.B.playing], ['sync-1', null, Math.abs(c.E.phase()) < 0.06], ['fader-1', 1, c.B.level > 0.97]]),
        hint: c => (Math.abs(c.E.bpmDiff()) >= 0.06 ? 'Click SYNC' : !c.B.playing ? 'Click ▶ on a 1' : Math.abs(c.E.phase()) >= 0.06 ? 'SYNC again to tighten' : 'Raise to the dashed box'),
        text: `Now use the time you bought. Follow the lit controls on deck B, one after another: <kbd>SYNC</kbd>, then <kbd>▶</kbd> on a "1", then <kbd>SYNC</kbd> again to tighten, then raise B's volume fader to the top.`,
        live: c => (!c.B.playing ? 'Deck B is paused' : Math.abs(c.E.phase()) > 0.06 ? phaseLive(c) : `Deck B volume ${pct(c.B.level)}`),
        check: c => matched(c) && c.B.level > 0.97, done: 'B is in.' },
      { title: 'Fade A and release the loop', ...seq(c => [['fader-0', 0, c.A.level < 0.03], ['loop-toggle-0', null, !c.A.loop.on]]), hint: c => (c.A.level < 0.03 ? 'Click to switch the loop off' : 'Lower to the dashed box'),
        text: `Lower deck A's volume fader to zero, then click A's loop number again to switch the loop off.`,
        check: c => c.A.level < 0.03 && !c.A.loop.on, done: 'Transition done.' },
      { title: 'Manual loop: IN and OUT',
        target: c => (c.B.loop.on ? ['loop-out-1'] : c.since(c.B.ev.loopIn) ? ['loop-out-1'] : ['loop-in-1']),
        hint: c => (c.B.loop.on ? 'Click OUT again to leave the loop' : c.since(c.B.ev.loopIn) ? 'Click OUT one or two bars later' : 'Click IN on a 1'),
        text: `You can also set a loop by hand. On deck B, press <kbd>IN</kbd> on the first beat of a bar, then <kbd>OUT</kbd> exactly one or two bars later. Both snap to the nearest beat. Press <kbd>OUT</kbd> again to leave the loop.`,
        check: c => c.since(c.B.ev.loopManual) && !c.B.loop.on, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 11
  {
    id: 'fx', level: 'Advanced', title: 'Filter fades and the echo out', sum: 'Two effect-based exits.',
    setup: E => stage(E, { id: 't126', at: 324, play: true }, { id: 't123', at: 64, cue: 64, level: 0, match: true }),
    steps: [
      startOnPhrase(` Deck B is already tempo-matched.`),
      tighten,
      { title: 'Filter fade: thin out A while B rises', ...need(c => [['filter-0', 0.85, c.A.filter > 0.78], ['fader-1', 1, c.B.level > 0.97]]), hint: 'Turn right to the dot',
        text: `Do these together over about 8 bars: slowly turn deck A's <kbd>FILTER</kbd> to the <b>right</b> (to the amber dot) while you raise deck B's volume fader to the top. A's bass melts away as B's arrives.`,
        live: c => `A filter ${Math.round(Math.max(0, c.A.filter - 0.5) * 200)}% · B volume ${pct(c.B.level)}`,
        check: c => c.A.filter > 0.78 && c.B.level > 0.97, done: 'A is now a thin layer on top of B.' },
      { title: 'Arm the echo on A', target: ['fx-on-0'], hint: 'Click ECHO',
        text: `Deck A's FX slot is set to <b>ECHO</b>. Click the lit <kbd>ECHO</kbd> button to switch it on. You will hear A's sounds repeating in time with the beat. <kbd>STR</kbd> sets how loud the echoes are, <kbd>LEN</kbd> sets the gap between them.`,
        check: c => c.A.fx.on && c.A.fx.type === 'echo', hold: 1500, done: 'Echo is on.' },
      { title: 'Echo out', target: ['fader-0'], goal: { 'fader-0': 0 }, hint: c => { const b = 4 - (((c.E.beat(c.A) % 4) + 4) % 4); return b <= 1 ? 'NOW: slam it down' : `Slam down in ${Math.ceil(b) - 1}`; },
        text: `On the first beat of a bar (the bubble counts you in), pull deck A's volume fader <b>straight down to zero</b> in one move. The track is cut, but its echo keeps repeating and fades away on its own. That tail is the "echo out".`,
        live: phraseLive, check: c => c.A.level < 0.03 && c.A.fx.on, hold: 2500, done: 'Hear the tail ring out over B.' },
      { title: 'Clean up deck A', ...seq(c => [['fx-on-0', null, !c.A.fx.on], ['filter-0', 0.5, ctr(c.A.filter)], ['play-0', null, !c.A.playing]]),
        hint: c => (c.A.fx.on ? 'Switch ECHO off' : !ctr(c.A.filter) ? 'Double-click FILTER' : 'Pause A'),
        text: `Follow the lit controls: switch <kbd>ECHO</kbd> off, double-click deck A's <kbd>FILTER</kbd>, and pause deck A. Leaving an effect or filter on is the most common beginner mistake: the next track comes in sounding wrong.`,
        check: c => !c.A.fx.on && ctr(c.A.filter) && !c.A.playing, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 12
  {
    id: 'pads', level: 'Advanced', title: 'Performance pads: loop roll, slicer, sampler', sum: 'The other three pad pages.',
    setup: E => stage(E, { id: 't122', at: 164, play: true }, null),
    steps: [
      { title: 'Open LOOP ROLL', target: ['tab-roll-0'], hint: 'Click the tab',
        text: `Above the pads are four tabs. You have used <kbd>HOTCUES</kbd>. Click <kbd>LOOP ROLL</kbd> on deck A.`,
        check: c => c.A.padPage === 'roll', done: 'The pads now show loop lengths in beats.' },
      { title: 'Hold a roll', target: ['roll-0-3'], hint: 'Press and hold, then let go',
        text: `<b>Press and hold</b> the <kbd>1/4</kbd> pad for a bar, then release. While held, a quarter-beat stutters. Underneath, the track keeps moving silently, so when you let go it carries on exactly where it would have been: you never fall out of time.`,
        check: c => c.since(c.A.ev.roll) && c.since(c.A.ev.rollUp) && !c.A.roll && c.A.ev.rollUp - c.A.ev.roll > 400, done: 'A roll that lands back on the beat.' },
      { title: 'Build with shorter rolls', target: ['roll-0-4', 'roll-0-3', 'roll-0-2'], hint: 'Hold 1/2, then 1/4, then 1/8',
        text: `The classic build-up: hold <kbd>1/2</kbd>, slide to <kbd>1/4</kbd>, then <kbd>1/8</kbd>, and release on the first beat of the next bar. Try it a couple of times, then finish by holding <kbd>1/8</kbd>.`,
        enter: c => { c.m.r0 = c.A.ev.roll || 0; }, check: c => c.A.roll && Math.abs((c.A.roll.out - c.A.roll.in) / c.A.spb - 0.125) < 0.01, done: 'Tension built.' },
      { title: 'Open SLICER', target: ['tab-slice-0'], hint: 'Click the tab',
        text: `Click <kbd>SLICER</kbd>. The current two bars are cut into 8 one-beat slices, one per pad. The highlighted pad shows which slice is playing now.`,
        check: c => c.A.padPage === 'slice', done: 'Eight slices.' },
      { title: 'Rearrange the beat', target: ['pads-0'], hint: 'Tap a few pads in rhythm',
        enter: c => { c.m.s0 = c.A.ev.slices || 0; },
        text: `Tap different pads in time with the music. Each press replays that slice for as long as you hold it; on release the track continues where it would have been. Play at least four slices.`,
        live: c => `${Math.min(4, (c.A.ev.slices || 0) - c.m.s0)} of 4 slices played`, check: c => (c.A.ev.slices || 0) - c.m.s0 >= 4 && !c.A.roll, done: 'You remixed the bar live.' },
      { title: 'Open SAMPLER', target: ['tab-smp-0'], hint: 'Click the tab',
        text: `Click <kbd>SAMPLER</kbd>. These pads fire one-shot sounds over the mix: drums, a crash, a horn, a siren.`,
        check: c => c.A.padPage === 'smp', done: 'Eight samples.' },
      { title: 'Drop some samples', target: ['smp-0-5', 'smp-0-6'], hint: 'Click on a 1',
        enter: c => { c.m.n0 = c.S.ev.samples; },
        text: `Fire the <kbd>Crash</kbd> on the first beat of a bar, and try the <kbd>Horn</kbd>. Trigger at least three samples. Less is more: one well-placed crash on a phrase change beats ten horns.`,
        live: c => `${Math.min(3, c.S.ev.samples - c.m.n0)} of 3 samples fired`, check: c => c.S.ev.samples - c.m.n0 >= 3, done: 'Samples fired.' },
      { title: 'Back to HOTCUES', target: ['tab-hot-0'], hint: 'Click the tab',
        text: `Click <kbd>HOTCUES</kbd> to return the pads to their usual job.`,
        check: c => c.A.padPage === 'hot', done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 13
  {
    id: 'cut', level: 'Advanced', title: 'The drop swap: cutting with the crossfader', sum: 'Hot cue on the drop, hard cut on the 1.',
    setup: E => stage(E, { id: 't122', at: 164, play: true }, { id: 't126', at: 160, cue: 160, level: 0 }),
    steps: [
      { title: 'A different kind of mix', manual: true,
        text: `Blends are smooth. A <b>cut</b> is instant: one track out, the other in, exactly on the first beat of a phrase. It works best going <b>straight into a drop</b>. Deck B is parked on the first beat of its drop (look at its overview: the playhead sits where the fat section starts).` },
      { title: 'Save the drop as a hot cue', target: ['hot-1-1'], hint: 'Click pad 1',
        text: `Click the lit pad on deck B to store this exact spot as <kbd>Cue 1</kbd>.`,
        check: c => c.B.hot[0] !== null && Math.abs((c.B.hot[0] - c.B.grid0) / c.B.spb - 160) < 0.5, done: 'The drop is one click away.' },
      { title: 'Crossfader hard left', target: ['cross'], goal: { cross: 0 }, hint: 'Drag left to the dashed box',
        text: `Drag the <b>crossfader</b> fully <b>left</b>. Now only deck A reaches the speakers, whatever B's volume fader does.`,
        check: c => c.S.cross < 0.03, done: 'B is muted by the crossfader.' },
      { title: 'Prepare B', ...seq(c => [['sync-1', null, Math.abs(c.E.bpmDiff()) < 0.06], ['fader-1', 1, c.B.level > 0.97]]), hint: c => (Math.abs(c.E.bpmDiff()) >= 0.06 ? 'Click SYNC' : 'Raise to the dashed box'),
        text: `Press <kbd>SYNC</kbd> on deck B to match the tempo, then push B's volume fader to the top. It stays silent because of the crossfader.`,
        check: c => Math.abs(c.E.bpmDiff()) < 0.06 && c.B.level > 0.97, done: 'Loaded and armed.' },
      { ...startOnPhrase(), title: 'Start the drop on the phrase',
        text: `The bubble on deck B's <kbd>▶</kbd> counts down to A's next phrase. Press it on <b>NOW</b>. Missed it? Press <kbd>CUE</kbd> on B (it returns to the drop) and wait for the next phrase.`, done: 'B is running silently. Cut!' },
      { title: 'Cut', target: ['cross'], goal: { cross: 1 }, hint: 'Snap right, fast',
        text: `Snap the crossfader all the way to the <b>right</b> in one fast move. If the beats flam, tap <kbd>SYNC</kbd> on B first.`,
        check: c => c.S.cross > 0.97 && c.B.playing, done: 'A is gone, B is on its drop.' },
      { title: 'Tidy up', ...seq(c => [['play-0', null, !c.A.playing], ['cross', 0.5, ctr(c.S.cross)]]), hint: c => (c.A.playing ? 'Pause A first' : 'Double-click to centre'),
        text: `Pause deck A, <b>then</b> double-click the crossfader to centre it (in that order, or A would jump back in).`,
        check: c => !c.A.playing && ctr(c.S.cross), done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 14
  {
    id: 'key', level: 'Advanced', title: 'Harmonic mixing and key lock', sum: 'Read the Key column, pick a match, lock the key.',
    setup: E => stage(E, { id: 't120', at: 164, play: true }, null),
    steps: [
      { title: 'Why some mixes sound sour', target: ['browser'], manual: true,
        text: `Two beatmatched tracks can still clash if their melodies are in unrelated keys. The <b>Key</b> column shows each track's key as a code such as <b>08A</b>. A track mixes cleanly with another when the code is: <b>the same</b> (08A + 08A), <b>one number up or down</b> with the same letter (08A + 07A or 09A), or <b>the same number with the other letter</b> (08A + 08B).` },
      { title: 'Pick a compatible track for deck B', target: ['browser'], hint: 'Load a matching key onto B',
        text: `Deck A is playing <b>Warm Up</b> in <b>08A</b>. Find another track in the browser whose key fits the rule and load it onto deck B (double-click it, or drag it to the right deck).`,
        live: c => (!c.B.track ? 'Deck B is empty' : compatible(c.A.track.camelot, c.B.track.camelot) ? `${c.B.track.camelot} works with 08A` : `${c.B.track.camelot} clashes with 08A. Try another track`),
        check: c => c.B.track && !c.B.loading && c.B.track.id !== c.A.track.id && compatible(c.A.track.camelot, c.B.track.camelot), done: 'A harmonic match.' },
      { title: 'Hear tempo change the key', target: ['pitch-1', 'play-1'], goal: { 'pitch-1': -8 }, hint: 'Play B, then drag the pitch fader up',
        enter: c => { c.B.level = 1; c.A.level = 0; c.E.apply(); },
        text: `Deck A is turned down for a moment. Press <kbd>▶</kbd> on deck B, then drag its pitch fader all the way <b>up</b>. Like a record slowing down, the whole track drops in pitch as well as speed. A big tempo change would wreck your key match.`,
        check: c => c.B.playing && c.B.pitch < -7, hold: 1500, done: 'Slower and lower.' },
      { title: 'Switch on KEY LOCK', target: ['keylock-1'], hint: 'Click KEY',
        text: `Above the pitch fader is the <kbd>KEY</kbd> lock button. Click it on deck B. The tempo stays slow but the pitch jumps back up to the original key. With key lock on, the pitch fader changes speed only.`,
        check: c => c.B.keylock, hold: 2500, done: 'Tempo and key are now independent.' },
      { title: 'Reset and get ready', ...seq(c => [['play-1', null, !c.B.playing], ['fader-1', 0, c.B.level < 0.03], ['fader-0', 1, c.A.level > 0.97]]),
        hint: c => (c.B.playing ? 'Pause B' : c.B.level >= 0.03 ? 'B fader down' : 'A fader back up'),
        text: `Follow the lit controls: pause deck B, pull B's volume fader down, and bring deck A's volume fader back to the top. Leave KEY lock on.`,
        check: c => !c.B.playing && c.B.level < 0.03 && c.A.level > 0.97, done: 'Ready to mix.' },
      { title: 'Mix it', target: ['sync-1', 'play-1', 'eq-low-1', 'fader-1', 'fader-0'], hint: 'Your full routine',
        enter: c => { c.E.seek(1, c.B.cue); },
        text: `Put it all together with no hand-holding: cut B's <kbd>LOW</kbd>, <kbd>SYNC</kbd>, start B on a phrase, bring its fader up, swap the bass, and fade A out. Listen to how the chords of the two tracks sit together. Done when B is at full volume with its bass back and A is silent.`,
        live: c => (!c.B.playing ? phraseLive(c) : Math.abs(c.E.phase()) > 0.08 ? phaseLive(c) : `A ${pct(c.A.level)} · B ${pct(c.B.level)}`),
        check: c => c.B.playing && c.B.level > 0.97 && ctr(c.B.eq.low) && c.A.level < 0.03 && Math.abs(c.E.bpmDiff()) < 0.1, done: 'Lesson complete.' },
    ],
  },
  // ------------------------------------------------------------------ 15
  {
    id: 'set', level: 'Advanced', title: 'Capstone: a three-track mini set', sum: 'Two transitions, your choices, no SYNC on the first.',
    setup: E => stage(E, null, null),
    steps: [
      { title: 'Open your set', target: c => (c.A.track ? ['play-0'] : ['browser']), hint: c => (c.A.track ? 'Click ▶' : 'Load any track onto deck A'),
        text: `Choose any track, load it onto deck A and press play. Let it run past its first breakdown while you plan the next track.`,
        check: c => c.A.track && c.A.playing && !c.A.cuePreview, done: 'Set started.' },
      { title: 'Transition 1: beatmatch by hand', target: c => (c.B.track ? ['pitch-1'] : ['browser']), hint: 'No SYNC this time',
        text: `Load a key-compatible track onto deck B and mix into it <b>without pressing SYNC</b>: match the BPM with the pitch fader, start on a phrase, nudge into time, and use EQ. Done when deck B is at full volume, in time, and deck A is silent.`,
        live: c => (!c.B.track ? 'Load a track onto deck B' : c.since(c.B.ev.sync) ? 'You pressed SYNC. Double-click B\'s pitch fader and match it by hand' : !c.B.playing ? diffLive(c) : `${phaseLive(c)} · A ${pct(c.A.level)} · B ${pct(c.B.level)}`),
        enter: c => { c.m.aId = c.A.track?.id; },
        check: c => c.B.track && c.B.playing && !c.since(c.B.ev.sync) && c.B.level > 0.97 && c.E.audible(c.A) < 0.03 && (c.A.playing ? matched(c, 0.12, 0.1) : true), hold: 500, done: 'First transition done by hand.' },
      { title: 'Reload deck A', target: ['browser'], hint: 'New track onto A',
        text: `Stop deck A, reset its EQ, filter and effects, and load a <b>third</b> track onto it. Bring A's volume fader down, ready to mix in.`,
        check: c => c.A.track && !c.A.loading && c.A.track.id !== c.m.aId && c.A.track.id !== c.B.track?.id, done: 'Track three is ready.' },
      { title: 'Transition 2: use a different technique', target: ['loop-1', 'fx-on-1', 'filter-1', 'cross'], hint: 'Loop, echo, filter or cut',
        text: `Mix from B back to A, and this time use at least one of: a <b>loop</b> on B, an <b>echo out</b> on B, a <b>filter fade</b> on B, or a <b>crossfader cut</b>. SYNC is allowed. Done when deck A is playing at full volume and deck B is silent.`,
        live: c => `${c.m.used ? 'Technique used' : 'No loop, echo, filter or cut yet'} · A ${pct(c.E.audible(c.A))} · B ${pct(c.E.audible(c.B))}`,
        check: c => { if (c.B.loop.on || c.B.fx.on || Math.abs(c.B.filter - 0.5) > 0.2 || Math.abs(c.S.cross - 0.5) > 0.4) c.m.used = true; return c.m.used && c.A.playing && c.E.audible(c.A) > 0.95 && c.E.audible(c.B) < 0.03; }, hold: 500,
        done: 'Three tracks, two transitions. You can DJ. Keep practising in Free Play.' },
    ],
  },
];

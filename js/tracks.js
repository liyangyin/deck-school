// Built-in practice crate. Every track is synthesized in the browser (see synth.js),
// so the beat grid is exact: beat 1 is at sample 0 and every phrase is 8 bars (32 beats).

// Arrangement shared by all practice tracks, one entry per 8-bar phrase.
export const STRUCT = [
  { name: 'intro', kick: 1, hat: 1 },
  { name: 'intro', kick: 1, hat: 1, clap: 1, perc: 1, fill: 1 },
  { name: 'build', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, crash: 1 },
  { name: 'build', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, fill: 1 },
  { name: 'breakdown', pad: 1, stab: 1, riser: 1, crash: 1 },
  { name: 'drop', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, pad: 0.5, crash: 1 },
  { name: 'drop', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, pad: 0.5, fill: 1 },
  { name: 'main', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, lead: 1, crash: 1 },
  { name: 'main', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, lead: 1, fill: 1 },
  { name: 'breakdown', pad: 1, lead: 1, riser: 1, crash: 1 },
  { name: 'drop', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, lead: 1, pad: 0.5, crash: 1 },
  { name: 'drop', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, stab: 1, lead: 1, pad: 0.5, fill: 1 },
  { name: 'outro', kick: 1, hat: 1, clap: 1, perc: 1, bass: 1, crash: 1 },
  { name: 'outro', kick: 1, hat: 1, clap: 1 },
  { name: 'outro', kick: 1, hat: 1 },
];
export const PHRASE_BEATS = 32;
export const TOTAL_BEATS = STRUCT.length * PHRASE_BEATS;

// root = MIDI note of the tonic (bass octave). prog = chord roots in semitones above the tonic.
export const TRACKS = [
  { id: 't120', title: 'Warm Up', artist: 'Practice Crate', bpm: 120, key: 'Am', camelot: '08A', root: 45, minor: true, seed: 11, prog: [0, 8, 3, 10], bass: 0, stab: 0 },
  { id: 't124', title: 'Second Record', artist: 'Practice Crate', bpm: 124, key: 'Am', camelot: '08A', root: 45, minor: true, seed: 23, prog: [0, 5, 8, 7], bass: 1, stab: 1 },
  { id: 't122', title: 'Night Drive', artist: 'Practice Crate', bpm: 122, key: 'Em', camelot: '09A', root: 40, minor: true, seed: 37, prog: [0, 3, 8, 10], bass: 2, stab: 2 },
  { id: 't126', title: 'Glass Hour', artist: 'Practice Crate', bpm: 126, key: 'Dm', camelot: '07A', root: 38, minor: true, seed: 41, prog: [0, 8, 5, 7], bass: 1, stab: 0 },
  { id: 't125', title: 'Open Air', artist: 'Practice Crate', bpm: 125, key: 'C', camelot: '08B', root: 36, minor: false, seed: 53, prog: [0, 9, 5, 7], bass: 0, stab: 2 },
  { id: 't123', title: 'Cellar Door', artist: 'Practice Crate', bpm: 123, key: 'Gm', camelot: '06A', root: 43, minor: true, seed: 67, prog: [0, 10, 8, 7], bass: 2, stab: 1 },
  { id: 't128', title: 'Pressure Plate', artist: 'Practice Crate', bpm: 128, key: 'F#m', camelot: '11A', root: 42, minor: true, seed: 79, prog: [0, 8, 3, 5], bass: 1, stab: 2 },
  // hype crate: tech house, melodic house and piano rave, in the spirit of current festival sets
  { id: 'h126', title: 'Back Room Bounce', artist: 'Hype Crate · tech house', bpm: 126, key: 'Gm', camelot: '06A', root: 31, minor: true, seed: 101, prog: [0, 0, 0, 0], bass: 0, stab: 0, style: 'tech' },
  { id: 'h127', title: 'Say Less', artist: 'Hype Crate · tech house', bpm: 127, key: 'Am', camelot: '08A', root: 33, minor: true, seed: 113, prog: [0, 0, 0, 0], bass: 1, stab: 0, style: 'tech' },
  { id: 'h125', title: 'Top Floor', artist: 'Hype Crate · melodic house', bpm: 125, key: 'Dm', camelot: '07A', root: 38, minor: true, seed: 127, prog: [0, 8, 3, 10], bass: 0, stab: 0, style: 'melodic' },
  { id: 'h124', title: 'After Hours Only', artist: 'Hype Crate · melodic house', bpm: 124, key: 'Em', camelot: '09A', root: 40, minor: true, seed: 139, prog: [0, 5, 8, 7], bass: 1, stab: 0, style: 'melodic' },
  { id: 'h130', title: 'Rave Signal', artist: 'Hype Crate · piano rave', bpm: 130, key: 'Am', camelot: '08A', root: 33, minor: true, seed: 151, prog: [0, 8, 3, 10], bass: 0, stab: 0, style: 'rave' },
  { id: 'h128', title: 'Want It More', artist: 'Hype Crate · piano rave', bpm: 128, key: 'C', camelot: '08B', root: 36, minor: false, seed: 163, prog: [0, 9, 5, 7], bass: 1, stab: 0, style: 'rave' },
];

export const trackById = id => TRACKS.find(t => t.id === id);

// Camelot compatibility: same code, +/-1 on the wheel with the same letter, or same number other letter.
export function compatible(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10), la = a.slice(-1), lb = b.slice(-1);
  if (na === nb) return true;
  if (la !== lb) return false;
  const d = Math.abs(na - nb);
  return d === 1 || d === 11;
}

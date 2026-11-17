import { renderTrack, analyse, detectBeat } from './synth.js';

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'render') {
    const r = renderTrack(m.spec, m.sr);
    const wave = analyse(r.audio, m.sr);
    self.postMessage({ id: m.id, ch: [r.audio], spb: r.spb, bpm: r.bpm, grid0: r.grid0, wave },
      [r.audio.buffer, wave.amp.buffer, wave.lo.buffer, wave.hi.buffer]);
  } else if (m.type === 'analyse') {
    let src = m.ch[0];
    if (m.ch[1]) { const a = new Float32Array(src.length), b = m.ch[1]; for (let i = 0; i < a.length; i++) a[i] = (src[i] + b[i]) * 0.5; src = a; }
    const wave = analyse(src, m.sr);
    const beat = detectBeat(wave, src.length / m.sr);
    self.postMessage({ id: m.id, ch: m.ch, spb: m.sr * 60 / beat.bpm, bpm: beat.bpm, grid0: beat.grid0Sec * m.sr, wave },
      [...m.ch.map(c => c.buffer), wave.amp.buffer, wave.lo.buffer, wave.hi.buffer]);
  }
};

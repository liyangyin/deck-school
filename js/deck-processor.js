// Sample-accurate deck player: variable speed, scratch, loops, slip (loop roll / slicer),
// click-free jumps, and key lock (WSOLA time-stretch: tempo changes without changing pitch).
const N = 2048, HO = N / 2, SEARCH = 480, CORR = 512;
const HANN = new Float32Array(N);
for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

class DeckProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ch = null; this.len = 0;
    this.pos = 0; this.cur = 0;          // logical read head (samples) and actual speed
    this.rate = 1; this.bend = 0; this.playing = false;
    this.scratching = false; this.scratchRate = 0;
    this.loop = null; this.roll = null; this.ghost = 0;
    this.old = 0; this.oldRate = 0; this.xf = 0; // crossfade tail after a jump
    this.keylock = false; this.st = false; this.s0 = 0; this.s1 = 0; this.gk = 0; // stretch grains
    this.gen = 0; this.count = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'load': this.ch = m.ch; this.len = m.ch ? m.ch[0].length : 0; this.pos = 0; this.cur = 0; this.playing = false; this.loop = null; this.roll = null; this.xf = 0; this.st = false; break;
        case 'play': this.playing = true; break;
        case 'pause': this.playing = false; break;
        case 'rate': this.rate = m.v; break;
        case 'bend': this.bend = m.v; break;
        case 'seek': this.jump(m.v); this.gen = m.gen; if (this.roll) this.ghost = this.pos; break;
        case 'loop': this.loop = m.v; break;
        case 'keylock': this.keylock = m.v; break;
        case 'scratch': this.scratching = m.on; this.scratchRate = m.v || 0; break;
        case 'roll':   // slip mode: the track keeps running silently (ghost) while a short loop plays
          if (m.v) { if (!this.roll) this.ghost = this.pos; this.roll = m.v; if (m.v.jump) this.jump(m.v.in); }
          else if (this.roll) { this.roll = null; this.jump(this.ghost); }
          break;
      }
    };
  }
  head() { return this.st ? this.s1 + this.gk : this.pos; }
  jump(to) {
    this.old = this.head(); this.oldRate = this.st ? 1 : this.cur; this.xf = 160;
    this.pos = Math.max(0, Math.min(this.len - 1, to));
    if (this.st) { this.s1 = this.pos; this.s0 = this.pos - HO; this.gk = 0; }
  }
  read(c, p) {
    const i = p | 0;
    if (i < 0 || i >= this.len - 1) return 0;
    return c[i] + (c[i + 1] - c[i]) * (p - i);
  }
  // find the grain start near `ideal` that best continues the audio at `nat`
  align(c, nat, ideal) {
    nat |= 0; ideal |= 0;
    if (nat < 0 || ideal - SEARCH < 0 || Math.max(nat, ideal + SEARCH) + CORR >= this.len) return ideal;
    let best = 0, bestV = -1e9;
    for (let d = -SEARCH; d <= SEARCH; d += 3) {
      let s = 0, e = 1e-9; const o = ideal + d;
      for (let j = 0; j < CORR; j += 4) { const y = c[o + j]; s += c[nat + j] * y; e += y * y; }
      const v = s / Math.sqrt(e);
      if (v > bestV) { bestV = v; best = d; }
    }
    return ideal + best;
  }
  process(_, outputs) {
    const L = outputs[0][0], R = outputs[0][1] || L;
    if (!this.ch) return true;
    const c0 = this.ch[0], c1 = this.ch[1] || c0, stereo = c1 !== c0;
    const target = this.scratching ? this.scratchRate : (this.playing ? this.rate * (1 + this.bend) : 0);
    const k = this.scratching ? 0.004 : 0.012;
    const wantSt = this.keylock && this.playing && !this.scratching && Math.abs(this.rate - 1) > 0.0005;
    for (let i = 0; i < L.length; i++) {
      this.cur += (target - this.cur) * k;
      if (Math.abs(this.cur) < 1e-5 && target === 0) this.cur = 0;
      let a, b;
      if (wantSt && Math.abs(this.cur - target) < 0.02) {
        if (!this.st) { this.st = true; this.s1 = this.pos; this.s0 = this.pos - HO; this.gk = 0; }
        if (this.gk >= HO) { const nat = this.s1 + HO; this.s0 = this.s1; this.s1 = this.align(c0, nat, this.pos); this.gk = 0; }
        const w1 = HANN[this.gk], w0 = HANN[HO + this.gk], p1 = this.s1 + this.gk, p0 = this.s0 + HO + this.gk;
        a = this.read(c0, p1) * w1 + this.read(c0, p0) * w0;
        b = stereo ? this.read(c1, p1) * w1 + this.read(c1, p0) * w0 : a;
        this.gk++;
      } else {
        if (this.st) { this.old = this.s1 + this.gk; this.oldRate = 1; this.xf = 160; this.st = false; }
        a = this.read(c0, this.pos); b = stereo ? this.read(c1, this.pos) : a;
      }
      if (this.xf > 0) {
        const g = this.xf / 160;
        a = a * (1 - g) + this.read(c0, this.old) * g;
        b = b * (1 - g) + this.read(c1, this.old) * g;
        this.old += this.oldRate; this.xf--;
      }
      L[i] = a; R[i] = b;
      this.pos += this.cur;
      if (this.roll) this.ghost += this.cur;
      const lp = this.roll || this.loop;
      if (lp && this.cur > 0 && this.pos >= lp.out) {
        const len = lp.out - lp.in;
        if (len > 8) {
          if (!this.st) { this.old = this.pos; this.oldRate = this.cur; this.xf = 160; }
          this.pos = lp.in + ((this.pos - lp.in) % len);
        }
      }
      if (this.pos < 0) this.pos = 0;
      if (this.pos >= this.len - 1) { this.pos = this.len - 1; if (this.playing) { this.playing = false; this.port.postMessage({ ended: true }); } }
    }
    if (++this.count % 3 === 0) this.port.postMessage({ pos: this.pos, rate: this.cur, t: currentTime + L.length / sampleRate, gen: this.gen });
    return true;
  }
}
registerProcessor('deck', DeckProcessor);

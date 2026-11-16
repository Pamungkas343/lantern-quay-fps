// audio.js — all sounds are synthesized with WebAudio. No audio assets.
// Created lazily on the first user gesture; silent in headless/autotest.

export function createAudio() {
  let ctx = null, noiseBuf = null;
  function ensure() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  function noise(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(ctx.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }
  function tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
    shot(kind, dist = 0) {
      const v = Math.max(0.12, 1 - dist / 60);
      if (kind === 'shotgun') { noise(0.22, 900, 0.5 * v); tone(90, 0.18, 0.4 * v, 'sine', 45); }
      else if (kind === 'smg') { noise(0.09, 1800, 0.32 * v); tone(220, 0.06, 0.16 * v, 'square', 120); }
      else if (kind === 'pistol') { noise(0.12, 1400, 0.4 * v); tone(180, 0.08, 0.2 * v, 'square', 90); }
      else if (kind === 'knife') { noise(0.08, 3200, 0.12, 'bandpass'); }
      else { noise(0.14, 1200, 0.42 * v); tone(160, 0.1, 0.22 * v, 'square', 70); }
    },
    dryClick() { tone(1200, 0.04, 0.12, 'square'); },
    reload() { tone(500, 0.05, 0.12, 'square'); tone(340, 0.05, 0.12, 'square'); },
    hit() { tone(1900, 0.05, 0.16, 'sine'); },
    headshot() { tone(2400, 0.07, 0.2, 'sine'); tone(1900, 0.06, 0.14, 'sine'); },
    kill() { tone(660, 0.09, 0.18, 'sine'); tone(990, 0.12, 0.18, 'sine'); },
    hurt() { noise(0.1, 500, 0.2); },
    step() { noise(0.05, 700, 0.05); },
    plantBeep() { tone(1200, 0.09, 0.16, 'square'); },
    defuseBeep() { tone(900, 0.09, 0.14, 'square'); },
    explosion() {
      noise(1.1, 300, 0.9); tone(55, 0.9, 0.7, 'sine', 28);
      noise(0.4, 2400, 0.3, 'highpass');
    },
    radio() { tone(880, 0.05, 0.1, 'sine'); tone(1170, 0.05, 0.1, 'sine'); },
    roundWin() { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.16, 'triangle'), i * 120)); },
    roundLose() { [392, 330, 262].forEach((f, i) => setTimeout(() => tone(f, 0.18, 0.15, 'triangle'), i * 140)); },
    buy() { tone(740, 0.06, 0.14, 'sine'); },
    flash() { tone(3000, 0.3, 0.1, 'sine', 800); },
  };
}

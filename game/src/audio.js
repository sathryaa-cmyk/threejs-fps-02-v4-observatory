// audio.js — synthesized sound: every effect is an oscillator or filtered noise.
// One job: make the dome sound alive with zero audio files.
export function makeAudio() {
  let ctx = null;
  let master = null;
  let hum = null;
  const A = {
    ensure() {
      if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
        // Dome hum: a low drone with a slow tremolo, always on once started.
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 52;
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 52.7;
        const g = ctx.createGain(); g.gain.value = 0.035;
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.13;
        const lg = ctx.createGain(); lg.gain.value = 0.015;
        lfo.connect(lg); lg.connect(g.gain);
        o1.connect(g); o2.connect(g); g.connect(master);
        o1.start(); o2.start(); lfo.start();
        hum = g;
      } catch { return false; }
      return true;
    },
    noiseBuf(dur = 0.5) {
      const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    },
    shot(kind, dist = 0) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const vol = Math.max(0.04, 0.5 - dist * 0.012);
      const src = ctx.createBufferSource();
      src.buffer = A.noiseBuf(0.18);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = kind === 'awp' ? 320 : kind === 'rifle' ? 900 : kind === 'smg' ? 1300 : 700;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.16);
      // Body thump.
      const o = ctx.createOscillator();
      o.type = 'sine'; o.frequency.setValueAtTime(kind === 'awp' ? 120 : 170, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vol * 0.7, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.11);
    },
    dryClick() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1400;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.04);
    },
    reload() {
      if (!ctx) return;
      const t = ctx.currentTime;
      [0, 0.22].forEach((off, i) => {
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.value = i === 0 ? 900 : 620;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.07, t + off);
        g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.05);
        o.connect(g); g.connect(master); o.start(t + off); o.stop(t + off + 0.06);
      });
    },
    step(run) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = A.noiseBuf(0.07);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = run ? 500 : 320;
      const g = ctx.createGain();
      g.gain.setValueAtTime(run ? 0.06 : 0.035, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.08);
    },
    beep(freq = 880, dur = 0.09, vol = 0.12) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    },
    explosion() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = A.noiseBuf(1.4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(90, t + 1.2);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.85, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 1.4);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.9);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.7, t); og.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 1.0);
    },
    sting(win) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.13);
        g.gain.exponentialRampToValueAtTime(0.14, t + i * 0.13 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.5);
        o.connect(g); g.connect(master); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.55);
      });
    },
    hit(head) {
      if (!ctx) return;
      A.beep(head ? 1320 : 990, 0.05, head ? 0.14 : 0.09);
    },
    hurt() {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.2);
    },
  };
  return A;
}

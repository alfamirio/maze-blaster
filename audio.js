// ====================== AUDIO / SFX (Web Audio API, no assets) ======================
// Same asset-free spirit as the graphics: every sound is synthesized on the
// fly with oscillators/noise buffers rather than loaded from a file.
const SFX = (() => {
  let ctx = null;
  let enabled = true;
  function setEnabled(v){ enabled = v; }
  function getCtx(){
    if (!enabled) return null;
    if (!ctx){
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    // Autoplay policies start the context suspended until a user gesture;
    // resume it opportunistically every time a sound is requested.
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers require a user gesture before audio can play, so kick the
  // context awake on the very first pointer/key interaction anywhere on
  // the page (lobby buttons, movement keys, touch controls, etc).
  const unlock = () => getCtx();
  window.addEventListener('pointerdown', unlock, { once:true });
  window.addEventListener('keydown', unlock, { once:true });

  // Subtle descending "plop": a quiet, short sine dip, low enough in the mix
  // that it doesn't compete with movement. A touch of random pitch/level
  // variance keeps repeated placements (e.g. bots spamming bombs) from
  // sounding like the exact same clip looping.
  function bombPlaced(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const jitter = 0.92 + Math.random()*0.16; // ~±8%
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300*jitter, t0);
    osc.frequency.exponentialRampToValueAtTime(140*jitter, t0 + 0.08);
    gain.gain.setValueAtTime(0.065, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.12);
  }

  // White noise burst run through a low-pass filter that sweeps rapidly
  // downward (so the crack fizzles into a dull thud), plus a sine "thump"
  // underneath for low-end body. Trimmed down from the original version so
  // a chain of several bombs going off doesn't wall-of-noise the mix.
  function explosion(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const dur = 0.32;
    const buffer = ac.createBuffer(1, Math.floor(ac.sampleRate*dur), ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = Math.random()*2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buffer;

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, t0);
    filter.frequency.exponentialRampToValueAtTime(100, t0 + dur);

    const noiseGain = ac.createGain();
    noiseGain.gain.setValueAtTime(0.22, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

    noise.connect(filter).connect(noiseGain).connect(ac.destination);
    noise.start(t0);
    noise.stop(t0 + dur);

    const thump = ac.createOscillator();
    const thumpGain = ac.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(110, t0);
    thump.frequency.exponentialRampToValueAtTime(30, t0 + 0.22);
    thumpGain.gain.setValueAtTime(0.18, t0);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.24);
    thump.connect(thumpGain).connect(ac.destination);
    thump.start(t0);
    thump.stop(t0 + 0.24);
  }

  // Soft two-note sine "bell" for a power-up pickup. Replaced the earlier
  // 4-note triangle-wave arpeggio, which (even quiet) had a bright, buzzy
  // timbre that got fatiguing fast when pickups happen often. A sine wave
  // is much gentler on repeat, a filter rounds off what little harshness
  // sine still has, and a soft linear attack avoids the "click" a hard
  // onset produces. Slight pitch drift keeps back-to-back pickups from
  // sounding identical.
  function powerup(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const jitter = 0.97 + Math.random()*0.06; // ~±3%
    const notes = [660, 880]; // E5, A5 — a soft rising fourth
    notes.forEach((freq, i) => {
      const t = t0 + i*0.08;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2200;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq*jitter, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.045, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(filter).connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  // Soft two-note major rise for winning the match — a gentle "lift" rather
  // than a full fanfare.
  function win(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const notes = [523.25, 659.25]; // C5 E5
    notes.forEach((freq, i) => {
      const t = t0 + i*0.13;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.37);
    });
  }

  // Soft two-note minor dip for losing — a quiet, low-key "aw" rather than a
  // full descending sequence.
  function lose(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const notes = [349.23, 311.13]; // F4 Eb4
    notes.forEach((freq, i) => {
      const t = t0 + i*0.15;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  }

  // Quick bright-to-dull "clink" for a shield absorbing a hit — distinct from
  // both the soft powerup pickup chime and the boomy explosion so players can
  // tell at a glance that they survived instead of dying.
  function shieldBreak(){
    const ac = getCtx(); if (!ac) return;
    const t0 = ac.currentTime;
    const notes = [1046.5, 523.25]; // C6 down to C5 — a little "crack"
    notes.forEach((freq, i) => {
      const t = t0 + i*0.045;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.1, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  }

  return { bombPlaced, explosion, powerup, win, lose, shieldBreak, setEnabled };
})();


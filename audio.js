// ====================== AUDIO / SFX (Web Audio API, no assets) ======================
// Same asset-free spirit as the graphics: every sound is synthesized on the
// fly with oscillators/noise buffers rather than loaded from a file.
const SFX = (() => {
  let ctx = null;
  // Sound effects and music are independent toggles (separate Options rows),
  // so each gets its own enabled flag rather than sharing one.
  let sfxEnabled = true;
  let musicEnabled = true;
  function setSfxEnabled(v){ sfxEnabled = v; }
  function setMusicEnabled(v){
    musicEnabled = v;
    // Music is started once (on match start) and left "wanted" thereafter;
    // toggling the Music option here just starts/stops actual playback in
    // step with the option, rather than forgetting the loop was on.
    if (!v) actuallyStopMusic();
    else if (musicWanted) actuallyStartMusic();
  }
  function getCtx(){
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
    if (!sfxEnabled) return;
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
    if (!sfxEnabled) return;
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
    if (!sfxEnabled) return;
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
    if (!sfxEnabled) return;
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
    if (!sfxEnabled) return;
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
    if (!sfxEnabled) return;
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

  // ================== BACKGROUND MUSIC ==================
  // Built the same asset-free way as the SFX above (plain oscillators +
  // filters, no audio files), and independent of the SFX on/off toggle —
  // its own Options row, its own gain stage.
  //
  // Rather than looping one fixed phrase, the chord progression is chosen
  // on the fly by a weighted random walk over a small set of diatonic
  // chords (a lightweight "Markov chain" — each chord has a few likely
  // next chords, weighted toward the ones that resolve nicely). Because
  // every chord stays within the same C-major scale, any transition is
  // guaranteed to sound consonant, so the wandering never hits a wrong
  // note — it just keeps finding new (and very unlikely to repeat exactly)
  // paths through the same harmony. On top of that, the melodic line is
  // also chosen per-beat from a weighted pool of chord tones (with
  // occasional rests and octave leaps), and a soft bell flourish drops in
  // at randomized intervals. All of it stays within a narrow, quiet
  // dynamic range — this is meant to be felt more than heard.
  let musicGain = null;
  let musicPlaying = false;   // scheduler is actually ticking right now
  let musicWanted = false;    // caller wants music playing (survives mute)
  let musicSchedulerId = null;
  let nextNoteTime = 0;
  let currentChordKey = 'Am';
  let beatsLeftInChord = 0;
  let beatsUntilBell = 4 + Math.floor(Math.random()*6);

  const MUSIC_BPM = 90;
  const BEAT_SEC = 60 / MUSIC_BPM;
  const SCHEDULE_AHEAD_SEC = 0.2;  // how far ahead of "now" we schedule notes
  const SCHEDULER_INTERVAL_MS = 50; // how often the lookahead check runs
  const ARP_PROBABILITY = 0.78;     // chance any given beat plays a melody note (rest otherwise)

  // Full note table spanning the octaves used by the pad/bass/melody/bell
  // layers below.
  const NOTE_FREQS = {
    C2:65.41, D2:73.42, E2:82.41, F2:87.31, G2:98.00, A2:110.00, B2:123.47,
    C3:130.81, D3:146.83, E3:164.81, F3:174.61, G3:196.00, A3:220.00, B3:246.94,
    C4:261.63, D4:293.66, E4:329.63, F4:349.23, G4:392.00, A4:440.00, B4:493.88,
    C5:523.25, D5:587.33, E5:659.25, F5:698.46, G5:783.99, A5:880.00, B5:987.77,
    C6:1046.50,
  };
  function octaveShift(note, delta){
    const m = note.match(/^([A-G])(\d)$/);
    if (!m) return note;
    return m[1] + (parseInt(m[2], 10) + delta);
  }

  // Every diatonic triad in C major (skipping only the dissonant B-diminished),
  // each carrying one extra "color" tone (a 6th or 7th) so the melody pool has
  // more than the bare triad to draw from — this is most of where the added
  // richness over a plain arpeggio comes from. `pad` = low sustained voicing,
  // `tones` = the pool the melody/bell layers pick from, `weights` biases
  // that pick toward the root/3rd so it still centers on the chord.
  const MUSIC_CHORDS = {
    Am: { pad:['A3','C4','E4'], tones:['A4','C5','E4','G4'], weights:[3,3,2,1.5] },
    F:  { pad:['F3','A3','C4'], tones:['F4','A4','C5','D5'], weights:[3,3,2,1.5] },
    C:  { pad:['C3','E3','G3'], tones:['C4','E4','G4','B4'], weights:[3,3,2,1.5] },
    G:  { pad:['G3','B3','D4'], tones:['G4','B4','D5','F5'], weights:[3,3,2,1.5] },
    Dm: { pad:['D3','F3','A3'], tones:['D4','F4','A4','C5'], weights:[3,3,2,1.5] },
    Em: { pad:['E3','G3','B3'], tones:['E4','G4','B4','D5'], weights:[3,3,2,1.5] },
  };
  // Weighted "where can we go from here" table — favors classic resolutions
  // (V/vi -> I or vi, ii -> V, etc.) so the wandering still feels purposeful
  // rather than random, while never being fully predictable.
  const MUSIC_TRANSITIONS = {
    Am: [['F',3], ['Dm',2], ['C',2], ['Em',1]],
    F:  [['C',3], ['G',3], ['Am',2], ['Dm',1]],
    C:  [['Am',3], ['F',2], ['G',2], ['Em',1]],
    G:  [['Am',3], ['C',3], ['F',1], ['Em',1]],
    Dm: [['G',3], ['Am',2], ['F',1]],
    Em: [['Am',3], ['F',2], ['C',1]],
  };

  function weightedPick(items, weights){
    const total = weights.reduce((a,b) => a+b, 0);
    let r = Math.random()*total;
    for (let i=0;i<items.length;i++){
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length-1];
  }
  function pickNextChord(fromKey){
    const options = MUSIC_TRANSITIONS[fromKey] || MUSIC_TRANSITIONS.C;
    return weightedPick(options.map(o => o[0]), options.map(o => o[1]));
  }
  // Chords mostly hold for a bar (2 beats), but occasionally linger for two
  // bars or turn over after just one beat — that irregular phrasing is a
  // big part of why the loop doesn't feel like it's marching in lockstep.
  function pickChordLengthBeats(){
    const r = Math.random();
    if (r < 0.15) return 4;
    if (r < 0.28) return 1;
    return 2;
  }

  // Music gets its own gain stage (rather than being folded into each
  // oscillator's own envelope peak) so muting/unmuting in Options can fade
  // the whole mix in/out with one ramp instead of touching every note.
  function getMusicGain(ac){
    if (!musicGain){
      musicGain = ac.createGain();
      musicGain.gain.value = 1;
      musicGain.connect(ac.destination);
    }
    return musicGain;
  }

  // Long, soft, lowpass-filtered pad — slow attack and slower release so
  // successive chords blend into one another instead of stepping abruptly.
  function playPadChord(ac, notes, t0, dur){
    const g = getMusicGain(ac);
    notes.forEach(n => {
      const freq = NOTE_FREQS[n]; if (!freq) return;
      const osc = ac.createOscillator();
      const filter = ac.createBiquadFilter();
      const gain = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.frequency.value = 1100;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.026, t0 + dur*0.4);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(filter).connect(gain).connect(g);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    });
  }

  // A very quiet sub-octave root note under each chord change — felt more
  // than heard, it's what gives the pad some body instead of sounding thin.
  function playBassNote(ac, padRoot, t0, dur){
    const freq = NOTE_FREQS[octaveShift(padRoot, -1)]; if (!freq) return;
    const g = getMusicGain(ac);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.02, t0 + dur*0.3);
    gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  // A single soft "pluck" for the improvised melody line sitting above the
  // pad. Gain/filter get a little per-note jitter so repeated notes don't
  // sound stamped-out identical.
  function playMelodyNote(ac, note, t0){
    const freq = NOTE_FREQS[note]; if (!freq) return;
    const g = getMusicGain(ac);
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    const peak = 0.015 + Math.random()*0.008;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = 2200 + Math.random()*600;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    osc.connect(filter).connect(gain).connect(g);
    osc.start(t0);
    osc.stop(t0 + 0.55);
  }

  // Occasional high, longer-ringing "twinkle" — a slow upward pitch drift
  // (rather than a static tone) gives it a shimmering, non-mechanical
  // quality. Sparse and randomly spaced so it reads as an improvised
  // flourish rather than a repeating hook.
  function playBellNote(ac, note, t0){
    const freq = NOTE_FREQS[note]; if (!freq) return;
    const g = getMusicGain(ac);
    const osc = ac.createOscillator();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.linearRampToValueAtTime(freq*1.004, t0 + 1.1);
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(0.02, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
    osc.connect(filter).connect(gain).connect(g);
    osc.start(t0);
    osc.stop(t0 + 1.35);
  }

  // Standard "lookahead" scheduler: on a steady timer, queue up any notes
  // that fall within the next SCHEDULE_AHEAD_SEC using the Web Audio clock
  // (not setTimeout's own timing, which drifts/stutters under load), so the
  // loop stays musically tight over a long play session.
  function musicSchedulerTick(){
    const ac = getCtx(); if (!ac) return;
    while (nextNoteTime < ac.currentTime + SCHEDULE_AHEAD_SEC){
      if (beatsLeftInChord <= 0){
        currentChordKey = pickNextChord(currentChordKey);
        beatsLeftInChord = pickChordLengthBeats();
        const chord = MUSIC_CHORDS[currentChordKey];
        const chordDur = BEAT_SEC*beatsLeftInChord*0.97;
        playPadChord(ac, chord.pad, nextNoteTime, chordDur);
        playBassNote(ac, chord.pad[0], nextNoteTime, chordDur);
      }
      const chord = MUSIC_CHORDS[currentChordKey];
      // A little timing humanization (±15ms) keeps the melody from landing
      // on a rigid grid every single beat.
      const jitter = (Math.random()-0.5)*0.03;
      if (Math.random() < ARP_PROBABILITY){
        let note = weightedPick(chord.tones, chord.weights);
        if (Math.random() < 0.12) note = octaveShift(note, 1); // occasional octave leap
        playMelodyNote(ac, note, nextNoteTime + BEAT_SEC*0.5 + jitter);
      }
      beatsUntilBell--;
      if (beatsUntilBell <= 0){
        const bellNote = octaveShift(weightedPick(chord.tones, chord.weights), 1);
        playBellNote(ac, bellNote, nextNoteTime + BEAT_SEC*0.25);
        beatsUntilBell = 5 + Math.floor(Math.random()*8);
      }
      nextNoteTime += BEAT_SEC;
      beatsLeftInChord--;
    }
  }

  function actuallyStartMusic(){
    if (musicPlaying) return;
    const ac = getCtx(); if (!ac) return;
    getMusicGain(ac);
    musicPlaying = true;
    currentChordKey = 'Am';
    beatsLeftInChord = 0;
    beatsUntilBell = 4 + Math.floor(Math.random()*6);
    nextNoteTime = ac.currentTime + 0.1;
    musicSchedulerTick();
    musicSchedulerId = setInterval(musicSchedulerTick, SCHEDULER_INTERVAL_MS);
  }
  function actuallyStopMusic(){
    musicPlaying = false;
    if (musicSchedulerId){ clearInterval(musicSchedulerId); musicSchedulerId = null; }
  }
  // Called once when a match starts. Remembers the intent (musicWanted) so
  // that toggling the Music option off and back on resumes the loop rather
  // than requiring the caller to start it again.
  function startMusic(){
    musicWanted = true;
    if (musicEnabled) actuallyStartMusic();
  }
  function stopMusic(){
    musicWanted = false;
    actuallyStopMusic();
  }

  return { bombPlaced, explosion, powerup, win, lose, shieldBreak, setSfxEnabled, setMusicEnabled, startMusic, stopMusic };
})();

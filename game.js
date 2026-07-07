/*
  MAZE BLASTER ONLINE — Phaser 4 + PeerJS
  -----------------------------------------------------------------
  Architecture: host-authoritative.
    - One browser is the HOST: it runs the real game (movement,
      collisions, bomb timers, explosions, win condition) and
      broadcasts a state snapshot to everyone ~12x/second.
    - Everyone else is a CLIENT: their browser just renders whatever
      snapshot arrives and sends its own input to the host. Clients
      do zero collision/physics locally, so there's nothing to get
      out of sync.
    - Every player controls their OWN device, so all devices use the
      identical control scheme (WASD/Arrows + Space/Enter, plus
      on-screen touch buttons for phones).

  To test: open this file on two devices (or two browser tabs/
  windows). One clicks "Host Game" and shares the room code, the
  other pastes it into "Join Game". Needs an internet connection
  (PeerJS's public signaling server) even for two tabs on one
  machine, since Peer IDs are allocated there.
  -----------------------------------------------------------------
*/

// ====================== SHARED CONFIG ======================
// Board is rendered at native resolution (not stretched up from a small
// buffer via Phaser's `resolution` config). TILE is chosen so that on the
// default map size, ROWS*TILE+HUD_H lands close to 2160px tall — matching
// 4K UHD's vertical pixel count for a native, non-upscaled canvas.
const TILE = 185;
// COLS/ROWS are mutable (not const) so the Options menu's map-size choice
// can resize the board before a game starts. Everything else in the file
// already reads these as variables rather than hardcoding 15/11, so
// reassigning them here is enough to resize the whole board, HUD, and
// canvas — see applyMapSize() below.
let COLS = 15;
let ROWS = 11;
// HUD_H only needs to cover a single per-player stats row; the win/status
// message shows as a big overlay banner on top of the maze itself instead
// (see buildHUD), so the rest of the canvas height goes straight to the maze.
const HUD_H = 120;
const MAP_SIZES = {
  vsmall:  { cols:11, rows:7  },
  small:   { cols:13, rows:9  },
  default: { cols:15, rows:11 },
  large:   { cols:17, rows:13 },
  xlarge:  { cols:19, rows:15 },
};
let SELECTED_MAP_SIZE = 'default'; // set from the Options menu, applied when a game starts
// A scenario tweaks how the board is generated: whether the indestructible
// pillar grid is present, how many tiles get a destructible crate, and how
// likely a destroyed crate is to drop a power-up. The host generates the
// board and broadcasts the layout (crate grid, pillar flag, teleporter
// pairs), so any scenario works for Solo, Host, or Join alike.
const SCENARIOS = {
  standard:        { label:'Standard',        desc:'The classic maze — indestructible pillars plus destructible crates.', pillars:true,  blockFillChance:0.7,  powerupSpawnChance:0.35 },
  custom:          { label:'Custom',          desc:'Fully custom map — tweak all.', pillars:true, blockFillChance:0.7, powerupSpawnChance:0.35, teleporterPairs:0, fuseMult:1, extraBlastRange:0, fogOfWar:false, shrinkingArena:false, dayNightCycle:false, isCustom:true },  
  open_arena:      { label:'Open Arena',      desc:'No pillars — just the border and crates. Fast, open, and chaotic.',    pillars:false, blockFillChance:0.7,  powerupSpawnChance:0.35 },
  sudden_death:    { label:'Sudden Death',    desc:'Bombs fuse in half the time and everyone starts with a bigger blast.', pillars:true, blockFillChance:0.7, powerupSpawnChance:0.35, fuseMult:0.5, extraBlastRange:1 },  
  crate_rush:      { label:'Crate Rush',      desc:'A much denser crate maze — more to clear, more power-ups to find.',    pillars:true,  blockFillChance:0.92, powerupSpawnChance:0.35 },
  minimalist:      { label:'Minimalist',      desc:'No pillars and hardly any crates.', pillars:false, blockFillChance:0.20, powerupSpawnChance:0.35 },  
  teleporters:     { label:'Teleporters',     desc:'A few glowing portal pairs are scattered on the maze.', pillars:true, blockFillChance:0.7, powerupSpawnChance:0.35, teleporterPairs:1 },
  portal_chaos:    { label:'Portal Chaos',    desc:'No pillars and many portal pairs flood the open maze.',  pillars:false, blockFillChance:0.25,  powerupSpawnChance:0.35, teleporterPairs:3 },
  fog_of_war:      { label:'Fog of War',      desc:'Classic maze, but you can only see a radius around your own player.', pillars:true, blockFillChance:0.7, powerupSpawnChance:0.35, fogOfWar:true },
  day_night_cycle: { label:'Day/Night Cycle', desc:'The map alternates between normal and a fog-of-war.', pillars:true, blockFillChance:0.7, powerupSpawnChance:0.35, dayNightCycle:true },
  shrinking_arena: { label:'Shrinking Arena', desc:'Battle-royale style, the playable area shrinks.', pillars:true, blockFillChance:0.6, powerupSpawnChance:0.4, shrinkingArena:true },
  powerup_frenzy:  { label:'Power-up Frenzy', desc:'Minimalist maze, but battle-royale style.',     pillars:true,  blockFillChance:0.20,  powerupSpawnChance:0.85, shrinkingArena:true },
};
let SELECTED_SCENARIO = 'standard'; // set by the map picker, applied when a Solo game starts

// ---- Deterministic map seed --------------------------------------------
// Turns an arbitrary string into a reproducible board layout: the same seed
// always yields the same crate/teleporter placement for a given scenario,
// map size, and player count. xmur3 hashes the string down to a 32-bit
// int; mulberry32 is a small, fast seeded PRNG driven by that int. Only
// board-shape randomness (crate fill, teleporter placement) is seeded —
// in-match randomness (power-up drops, bot decisions) stays on Math.random
// so replaying a seed reproduces the map, not a scripted match.
function xmur3(str){
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function(){
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}
function mulberry32(seed){
  let a = seed;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRng(str){ return mulberry32(xmur3(String(str))()); }
function randomSeedString(){ return Math.random().toString(36).slice(2, 8).toUpperCase(); }
let MAP_SEED = randomSeedString(); // shown (read-only) in the map picker so a layout can be shared/reproduced
// A handful of UI elements (fonts, dot radii, stroke widths, offsets) are
// specified in fixed pixels rather than as a fraction of TILE. UI_SCALE
// keeps those visually proportional to TILE.
const UI_SCALE = TILE / 48;
// ---- Game speed option ------------------------------------------------
// All gameplay timings below (move interval, bomb fuse, curse durations,
// flame lifetime) are expressed as BASE_* values tuned for "Normal" speed.
// The Options menu's Speed choice scales all of them at once via a single
// multiplier, so "Very fast" isn't just quicker movement — bombs also fuse
// faster, curses expire sooner, etc. Lower multiplier = faster game.
const SPEED_LEVELS = {
  vslow:  { label: 'Very slow', mult: 1.45 },
  slow:   { label: 'Slow',      mult: 1.2  },
  normal: { label: 'Normal',    mult: 1.0  },
  fast:   { label: 'Fast',      mult: 0.8  },
  vfast:  { label: 'Very fast', mult: 0.6  },
};
let SELECTED_SPEED = 'normal'; // set from the Options menu, applied when a game starts

const BASE_MOVE_INTERVAL = 130;
// Each "speed" power-up shaves this many ms off a player's own move interval,
// down to a hard floor so movement never becomes unreadable or breaks the
// fixed-step netcode assumptions elsewhere (bomb timers, tween durations).
const BASE_SPEED_STEP_MS = 16;
const BASE_MIN_MOVE_INTERVAL = 60;
// Curse power-up: picking one up applies a random temporary debuff instead of
// a permanent stat. Kept separate from the permanent stats (speed, bombs,
// range) so it always expires on its own timer regardless of what else the
// player has collected.
const BASE_CURSE_DURATION = 7000;
const CURSE_SLOW_MULT = 1.9;      // move interval multiplier while 'slow' (unaffected by game speed)
const BASE_CURSE_AUTOBOMB_EVERY = 600; // ms between forced bomb attempts while 'autobomb'
const CURSE_TYPES = ['reverse', 'slow', 'autobomb'];
const BASE_BOMB_FUSE = 1700;
const BASE_FLAME_TIME = 300;
const STATE_INTERVAL = 80; // ms between host -> client snapshots (~12Hz) — not scaled, it's a network rate, not gameplay pace

// Kick power-up: a kicked/punched bomb slides one tile every BOMB_SLIDE_MS
// until it hits a wall, a block, another bomb, or a player, matching the
// pace of the game's overall speed setting like everything else.
const BASE_BOMB_SLIDE_MS = 90;
let BOMB_SLIDE_MS = BASE_BOMB_SLIDE_MS;
// Heart/Shield power-up: stacks up to this many absorbed hits.
const MAX_SHIELD = 3;
// Brief invulnerability after a shield absorbs a hit, so the same lingering
// flame doesn't burn through every stacked shield in a single instant.
const SHIELD_HIT_IFRAME_MS = 500;

// Fog of War scenario: how many tiles around the local player are fully lit,
// plus one extra ring of partial visibility before the fog goes fully dark.
// Distance is Chebyshev (max of row/col delta), so the lit area is a square
// centered on the player rather than a circle — cheap to compute per-tile
// every frame and reads cleanly against the grid.
const FOG_VISIBLE_RADIUS = 2;
const FOG_PARTIAL_ALPHA = 0.55;
const FOG_DARK_ALPHA = 1;

// Shrinking Arena scenario: the play area starts as the full board, then
// every SHRINK_INTERVAL_MS the safe zone contracts by one ring (border tiles
// on all four sides), after an initial SHRINK_GRACE_MS with no shrinking at
// all so early-game movement isn't affected. Anyone caught outside the
// current safe zone takes damage the same way a lingering flame would
// (respecting shields/i-frames), on every tick rather than only once, so
// straying back out after a shield pops still hurts.
const SHRINK_GRACE_MS = 14000;
const SHRINK_INTERVAL_MS = 9000;

// Day/Night Cycle scenario: alternates between a normal "day" phase (no fog)
// and a "night" phase (same fog-of-war visuals as the Fog of War scenario)
// every DAY_NIGHT_PHASE_MS, starting with day. The host is authoritative for
// which phase it currently is (broadcast each tick as data.isNight) so every
// viewer's screen switches at the same moment, even though — like regular
// Fog of War — each viewer's fog is still centered on their own player.
const DAY_NIGHT_PHASE_MS = 20000;

// Mutable, speed-scaled versions of the BASE_* values above. These are what
// the rest of the game actually reads; applySpeedSetting() recomputes them
// from SELECTED_SPEED whenever a game is (re)started, on both host and
// client, so the two stay in lockstep.
let MOVE_INTERVAL = BASE_MOVE_INTERVAL;
let SPEED_STEP_MS = BASE_SPEED_STEP_MS;
let MIN_MOVE_INTERVAL = BASE_MIN_MOVE_INTERVAL;
let CURSE_DURATION = BASE_CURSE_DURATION;
let CURSE_AUTOBOMB_EVERY = BASE_CURSE_AUTOBOMB_EVERY;
let BOMB_FUSE = BASE_BOMB_FUSE;
let FLAME_TIME = BASE_FLAME_TIME;

function applySpeedSetting(key){
  const lvl = SPEED_LEVELS[key] || SPEED_LEVELS.normal;
  const m = lvl.mult;
  MOVE_INTERVAL = Math.round(BASE_MOVE_INTERVAL * m);
  SPEED_STEP_MS = Math.round(BASE_SPEED_STEP_MS * m);
  MIN_MOVE_INTERVAL = Math.round(BASE_MIN_MOVE_INTERVAL * m);
  CURSE_DURATION = Math.round(BASE_CURSE_DURATION * m);
  CURSE_AUTOBOMB_EVERY = Math.round(BASE_CURSE_AUTOBOMB_EVERY * m);
  BOMB_FUSE = Math.round(BASE_BOMB_FUSE * m);
  FLAME_TIME = Math.round(BASE_FLAME_TIME * m);
  BOMB_SLIDE_MS = Math.round(BASE_BOMB_SLIDE_MS * m);
}
function playerMoveInterval(p){
  let ms = Math.max(MIN_MOVE_INTERVAL, MOVE_INTERVAL - (p.speed||0)*SPEED_STEP_MS);
  if (p.curse && p.curse.type === 'slow') ms = Math.round(ms * CURSE_SLOW_MULT);
  return ms;
}

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f];
// Spawn corners depend on the current COLS/ROWS, so this is a rebuildable
// value (not a fixed literal) — buildSpawns() re-reads COLS/ROWS each time
// it's called, and applyMapSize() calls it right after resizing the board.
function buildSpawns(){
  return [
    { r:1,       c:1,       dr:1,  dc:1  },
    { r:ROWS-2,  c:COLS-2,  dr:-1, dc:-1 },
    { r:1,       c:COLS-2,  dr:1,  dc:-1 },
    { r:ROWS-2,  c:1,       dr:-1, dc:1  },
  ];
}
let SPAWNS = buildSpawns();
function applyMapSize(key){
  const sz = MAP_SIZES[key] || MAP_SIZES.default;
  COLS = sz.cols; ROWS = sz.rows;
  SPAWNS = buildSpawns();
}

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

// ====================== POWER-UP VISUALS (shared) ======================
// Power-ups are drawn as icon-only (no background circle) so the shape
// itself communicates the effect: a bomb for "+1 bomb", a fire for "+1
// blast range", and a lightning bolt for "+move speed".
function drawPoly(g, pts, fillColor, strokeColor){
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i=1;i<pts.length;i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fillStyle(fillColor, 1);
  g.fillPath();
  if (strokeColor !== undefined){
    g.lineStyle(Math.max(1.5, 0.7*UI_SCALE), strokeColor, 0.7);
    g.strokePath();
  }
}
function drawBombIcon(g){
  const s = UI_SCALE * 1.7;
  // thin white halo so the dark body still pops with no background circle
  g.lineStyle(Math.max(2, 1.6*s), 0xffffff, 0.9);
  g.strokeCircle(0, 2*s, 7*s);
  // body
  g.fillStyle(0x1c1c1c, 1);
  g.fillCircle(0, 2*s, 7*s);
  g.lineStyle(Math.max(1, 0.8*s), 0x000000, 1);
  g.strokeCircle(0, 2*s, 7*s);
  // highlight
  g.fillStyle(0x4a4a4a, 1);
  g.fillCircle(-2.2*s, -0.8*s, 2.2*s);
  // fuse
  g.lineStyle(Math.max(1.5, 1.6*s), 0x8b5a2b, 1);
  g.beginPath();
  g.moveTo(4*s, -4*s);
  g.lineTo(7.5*s, -9.5*s);
  g.strokePath();
  // spark
  g.fillStyle(0xffcc00, 1);
  g.fillCircle(7.5*s, -10.5*s, 2.6*s);
  g.fillStyle(0xfff3b0, 1);
  g.fillCircle(7.5*s, -10.5*s, 1.2*s);
}
function drawFlameIcon(g){
  const s = UI_SCALE * 1.9;
  // two small flickering side tongues, drawn first so the main body overlaps them
  const tongueL = [{x:-6.5,y:2*s},{x:-9.5,y:-2*s},{x:-8,y:-8*s},{x:-4.5,y:-4*s},{x:-5,y:1*s}];
  drawPoly(g, tongueL, 0xff4500, 0x7a1f00);
  const tongueR = [{x:6.5,y:1*s},{x:9.5,y:-3*s},{x:7.5,y:-9*s},{x:4,y:-4*s},{x:5,y:0}];
  drawPoly(g, tongueR, 0xff4500, 0x7a1f00);
  // main flame body (deep orange-red, outlined for visibility)
  const outer = [
    {x:0,y:-13*s},{x:5.5,y:-7*s},{x:7.5,y:0},{x:6,y:6*s},
    {x:2.5,y:10*s},{x:0,y:12*s},{x:-2.5,y:10*s},{x:-6.5,y:5*s},
    {x:-7.5,y:-1*s},{x:-4,y:-8*s}
  ];
  drawPoly(g, outer, 0xff4500, 0x7a1f00);
  // middle layer (bright orange)
  const mid = [
    {x:0,y:-8*s},{x:4,y:-3*s},{x:5,y:2*s},{x:3,y:7*s},
    {x:0,y:8.5*s},{x:-3,y:7*s},{x:-4.5,y:1*s},{x:-2.5,y:-4*s}
  ];
  drawPoly(g, mid, 0xffa500);
  // inner core (hot yellow-white)
  const core = [
    {x:0,y:-3.5*s},{x:2.2*s,y:0},{x:2.6*s,y:3.5*s},{x:0,y:6*s},
    {x:-2.6*s,y:3.5*s},{x:-2*s,y:0}
  ];
  drawPoly(g, core, 0xfff2a8);
}
function drawSpeedIcon(g){
  const s = UI_SCALE * 1.9;
  // classic zig-zag bolt, drawn slightly tilted; thin bright halo first so
  // it still pops against a busy floor with no background circle
  const bolt = [
    {x:1.5*s,y:-12*s}, {x:-6*s,y:1*s}, {x:-0.5*s,y:1*s}, {x:-2.5*s,y:12*s},
    {x:6.5*s,y:-2*s}, {x:1*s,y:-2*s}
  ];
  g.lineStyle(Math.max(2, 1.4*s), 0xffffff, 0.9);
  g.beginPath();
  g.moveTo(bolt[0].x, bolt[0].y);
  for (let i=1;i<bolt.length;i++) g.lineTo(bolt[i].x, bolt[i].y);
  g.closePath();
  g.strokePath();
  drawPoly(g, bolt, 0xffd700, 0xb8860b);
  // hot white core sliver down the middle for a bit of "electric" shine
  const core = [
    {x:0.6*s,y:-8*s}, {x:-2.8*s,y:1*s}, {x:-0.2*s,y:1*s}, {x:-1.2*s,y:7*s},
    {x:3*s,y:-1*s}, {x:0.4*s,y:-1*s}
  ];
  drawPoly(g, core, 0xfff9c4);
}
function drawSkullIcon(g){
  const s = UI_SCALE * 1.7;
  // thin white halo, same trick as the other icons, so it still pops with
  // no background circle — but on a cursed item it reads as "cold" against
  // the deep violet body instead of warm like the others
  g.lineStyle(Math.max(2, 1.5*s), 0xffffff, 0.85);
  g.fillStyle(0x6c3483, 1);
  // cranium (rounded dome)
  g.beginPath();
  g.arc(0, -1*s, 7.2*s, Math.PI, 0, false);
  g.lineTo(6.2*s, 4*s);
  g.lineTo(-6.2*s, 4*s);
  g.closePath();
  g.strokePath();
  g.fillPath();
  // jaw
  g.fillStyle(0x5b2c6f, 1);
  g.fillRoundedRect(-4.6*s, 3.2*s, 9.2*s, 4.4*s, 1.6*s);
  g.lineStyle(Math.max(1, 0.8*s), 0x2c123a, 1);
  g.strokeRoundedRect(-4.6*s, 3.2*s, 9.2*s, 4.4*s, 1.6*s);
  // teeth notches
  g.fillStyle(0x2c123a, 1);
  g.fillRect(-1.1*s, 3.6*s, 0.9*s, 3.6*s);
  g.fillRect(0.6*s, 3.6*s, 0.9*s, 3.6*s);
  // eye sockets (deep black) with a faint sickly-green glow
  g.fillStyle(0x120a17, 1);
  g.fillCircle(-3.1*s, -0.8*s, 2.5*s);
  g.fillCircle(3.1*s, -0.8*s, 2.5*s);
  g.fillStyle(0x7dff8a, 0.55);
  g.fillCircle(-3.1*s, -0.8*s, 1.1*s);
  g.fillCircle(3.1*s, -0.8*s, 1.1*s);
  // nasal cavity
  g.fillStyle(0x120a17, 1);
  const nose = [{x:0,y:0.8*s},{x:-1.3*s,y:2.6*s},{x:1.3*s,y:2.6*s}];
  drawPoly(g, nose, 0x120a17);
}
// Kick/Punch power-up: a stylized boot mid-swing with a couple of motion
// lines trailing behind it, so it reads as "movement/impact" at a glance.
function drawKickIcon(g){
  const s = UI_SCALE * 1.5;
  g.lineStyle(Math.max(2, 1.5*s), 0xffffff, 0.9);
  const bootHalo = [
    {x:-6.5*s,y:-6*s},{x:-1.5*s,y:-7.5*s},{x:2.5*s,y:-5*s},{x:3*s,y:-1*s},
    {x:8.5*s,y:1.5*s},{x:8.5*s,y:5*s},{x:-2*s,y:5*s},{x:-4*s,y:2.5*s},{x:-6.5*s,y:2*s}
  ];
  g.beginPath();
  g.moveTo(bootHalo[0].x, bootHalo[0].y);
  for (let i=1;i<bootHalo.length;i++) g.lineTo(bootHalo[i].x, bootHalo[i].y);
  g.closePath();
  g.strokePath();
  // boot body (leather upper + sole)
  const upper = [
    {x:-6*s,y:-6*s},{x:-1.5*s,y:-7*s},{x:2*s,y:-4.5*s},{x:2.5*s,y:-1*s},{x:-4.5*s,y:2*s},{x:-6*s,y:1.5*s}
  ];
  drawPoly(g, upper, 0x8b5a2b, 0x4a2f16);
  const sole = [
    {x:2.5*s,y:-1*s},{x:8*s,y:1.5*s},{x:8*s,y:4.5*s},{x:-2*s,y:4.5*s},{x:-4.5*s,y:2*s}
  ];
  drawPoly(g, sole, 0x2c2c2c, 0x111111);
  // laces
  g.lineStyle(Math.max(1, 0.8*s), 0xe0c9a6, 1);
  g.beginPath(); g.moveTo(-4.5*s,-4*s); g.lineTo(-1.5*s,-2.5*s); g.strokePath();
  g.beginPath(); g.moveTo(-4*s,-2*s); g.lineTo(-1*s,-0.8*s); g.strokePath();
  // motion lines trailing the kick
  g.lineStyle(Math.max(1.5, 1.2*s), 0xffe066, 0.85);
  g.beginPath(); g.moveTo(-9.5*s,-3*s); g.lineTo(-13*s,-3*s); g.strokePath();
  g.beginPath(); g.moveTo(-9.5*s,0.5*s); g.lineTo(-13.5*s,0.5*s); g.strokePath();
  g.beginPath(); g.moveTo(-9*s,4*s); g.lineTo(-12*s,4*s); g.strokePath();
}
// Heart/Shield power-up: a plain red heart with a small white shine, reading
// clearly as "protection/health" against the floor.
function drawHeartIcon(g){
  const s = UI_SCALE * 1.7;
  g.lineStyle(Math.max(2, 1.6*s), 0xffffff, 0.9);
  g.beginPath();
  g.arc(-3.3*s, -3*s, 4.3*s, Math.PI, 0, false);
  g.arc(3.3*s, -3*s, 4.3*s, Math.PI, 0, false);
  g.lineTo(0, 8*s);
  g.closePath();
  g.strokePath();
  g.fillStyle(0xe74c3c, 1);
  g.beginPath();
  g.arc(-3.3*s, -3*s, 4.2*s, Math.PI, 0, false);
  g.arc(3.3*s, -3*s, 4.2*s, Math.PI, 0, false);
  g.lineTo(0, 7.6*s);
  g.closePath();
  g.fillPath();
  g.lineStyle(Math.max(1, 0.8*s), 0x8e1c14, 1);
  g.strokePath();
  // shine
  g.fillStyle(0xffffff, 0.55);
  g.fillEllipse(-3.6*s, -4.2*s, 2.6*s, 1.6*s);
}
// Pierce Bomb power-up: a bomb body with a bright spike driven straight
// through it, reading as "this blast punches through obstacles".
function drawPierceIcon(g){
  const s = UI_SCALE * 1.6;
  // halo behind the spike so it pops before the dark bomb body is drawn
  g.lineStyle(Math.max(2, 1.6*s), 0xffffff, 0.9);
  g.strokeCircle(0, 1.5*s, 6.6*s);
  g.fillStyle(0x1c1c1c, 1);
  g.fillCircle(0, 1.5*s, 6.6*s);
  g.lineStyle(Math.max(1, 0.8*s), 0x000000, 1);
  g.strokeCircle(0, 1.5*s, 6.6*s);
  g.fillStyle(0x4a4a4a, 1);
  g.fillCircle(-1.9*s, -0.4*s, 1.9*s);
  // the piercing spike, driven diagonally through the whole icon
  const spike = [
    {x:-11*s,y:6*s}, {x:-3*s,y:-2*s}, {x:1.5*s,y:-9.5*s}, {x:3*s,y:-9.5*s},
    {x:-1*s,y:-1*s}, {x:9*s,y:5.5*s}, {x:6.5*s,y:8*s}, {x:-3.5*s,y:2.5*s}
  ];
  drawPoly(g, spike, 0xffe066, 0xb8860b);
  // hot core sliver down the middle of the spike
  const core = [
    {x:-8.5*s,y:5*s}, {x:-1.5*s,y:-3.5*s}, {x:0.5*s,y:-3.5*s}, {x:-6.5*s,y:6.5*s}
  ];
  drawPoly(g, core, 0xfff9c4);
}
// Remote Detonator power-up: a classic plunger-box trigger, with a couple of
// motion lines to sell "just pressed" so it reads as active/remote control.
function drawDetonatorIcon(g){
  const s = UI_SCALE * 1.6;
  g.lineStyle(Math.max(2, 1.5*s), 0xffffff, 0.9);
  // base box
  const box = [
    {x:-7*s,y:2*s}, {x:7*s,y:2*s}, {x:6*s,y:9*s}, {x:-6*s,y:9*s}
  ];
  g.beginPath();
  g.moveTo(box[0].x, box[0].y);
  for (let i=1;i<box.length;i++) g.lineTo(box[i].x, box[i].y);
  g.closePath();
  g.strokePath();
  drawPoly(g, box, 0x2c2c2c, 0x111111);
  // handle stem
  g.fillStyle(0x555555, 1);
  g.fillRect(-1.6*s, -6*s, 3.2*s, 9*s);
  g.lineStyle(Math.max(1, 0.7*s), 0x111111, 1);
  g.strokeRect(-1.6*s, -6*s, 3.2*s, 9*s);
  // red plunger knob
  g.fillStyle(0xe74c3c, 1);
  g.fillCircle(0, -7.5*s, 3.6*s);
  g.lineStyle(Math.max(1, 0.8*s), 0x7a1f1a, 1);
  g.strokeCircle(0, -7.5*s, 3.6*s);
  g.fillStyle(0xff8c7a, 0.8);
  g.fillCircle(-1.1*s, -8.6*s, 1.1*s);
  // little signal arcs off to the side, showing it's a remote trigger
  g.lineStyle(Math.max(1.3, 1.1*s), 0xffe066, 0.85);
  g.beginPath(); g.arc(9*s, -2*s, 3*s, Math.PI*0.9, Math.PI*1.6, false); g.strokePath();
  g.beginPath(); g.arc(9*s, -2*s, 5.5*s, Math.PI*0.9, Math.PI*1.6, false); g.strokePath();
}
// Proximity Mine power-up: a squat studded disc (classic landmine silhouette)
// with a small blinking warning light on top, reading as "hidden hazard"
// rather than "carry and throw" like the other pickups.
function drawMineIcon(g){
  const s = UI_SCALE * 1.6;
  g.lineStyle(Math.max(2, 1.5*s), 0xffffff, 0.9);
  g.strokeEllipse(0, 3*s, 13*s, 6*s);
  g.fillStyle(0x3a3a3a, 1);
  g.fillEllipse(0, 3*s, 12.6*s, 5.6*s);
  g.lineStyle(Math.max(1, 0.8*s), 0x151515, 1);
  g.strokeEllipse(0, 3*s, 12.6*s, 5.6*s);
  // top plate, slightly raised
  g.fillStyle(0x545454, 1);
  g.fillEllipse(0, 1*s, 9*s, 4*s);
  g.lineStyle(Math.max(1, 0.7*s), 0x1c1c1c, 1);
  g.strokeEllipse(0, 1*s, 9*s, 4*s);
  // studs ringing the plate
  g.fillStyle(0x232323, 1);
  const studAngles = [0.2, 1.0, 1.8, 2.6, 3.4, 4.2, 5.0, 5.8];
  for (const a of studAngles) g.fillCircle(Math.cos(a)*6*s, 1*s + Math.sin(a)*2.6*s, 0.9*s);
  // warning light on top
  g.fillStyle(0xff3b30, 1);
  g.fillCircle(0, -0.6*s, 2.1*s);
  g.fillStyle(0xffb3ac, 0.85);
  g.fillCircle(-0.6*s, -1.2*s, 0.8*s);
}
// Builds the power-up visual (icon only, no background circle) as a
// container, and makes it float (gentle vertical bob) so it stands out on
// the floor.
function createPowerupVisual(scene, x, y, type){
  const icon = scene.add.graphics();
  if (type === 'bomb') drawBombIcon(icon);
  else if (type === 'flame') drawFlameIcon(icon);
  else if (type === 'speed') drawSpeedIcon(icon);
  else if (type === 'kick') drawKickIcon(icon);
  else if (type === 'heart') drawHeartIcon(icon);
  else if (type === 'pierce') drawPierceIcon(icon);
  else if (type === 'detonator') drawDetonatorIcon(icon);
  else if (type === 'mine') drawMineIcon(icon);
  else drawSkullIcon(icon);
  // Shadow stays put on the tile while only the icon bobs above it — the
  // growing/shrinking gap between the two is what actually reads as "floating".
  const shadow = scene.add.ellipse(0, TILE*0.22, TILE*0.34, TILE*0.12, 0x000000, 0.32);
  const container = scene.add.container(x, y, [shadow, icon]);
  container.floatTween = scene.tweens.add({
    targets: icon,
    y: -6*UI_SCALE,
    duration: 650 + Math.random()*150,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
  return container;
}
function destroyPowerupVisual(gfx){
  if (gfx.floatTween) gfx.floatTween.stop();
  gfx.destroy();
}

// ====================== TELEPORTER VISUALS (Teleporters scenario) ======================
// Each portal pair gets its own color so it's obvious at a glance which two
// tiles are linked. A slowly pulsing inner disc reads as "active" without
// being as distracting as the powerups' bob (these sit on the floor and are
// walked over repeatedly, not picked up once).
const TELEPORT_COLORS = [0x00e5ff, 0xffd700, 0xff5da2, 0x7cfc00];
function createTeleporterVisual(scene, x, y, color){
  const outer = scene.add.circle(0, 0, TILE*0.38, color, 0.16).setStrokeStyle(Math.round(2.5*UI_SCALE), color, 0.9);
  const inner = scene.add.circle(0, 0, TILE*0.18, color, 0.4);
  const container = scene.add.container(x, y, [outer, inner]);
  container.pulseTween = scene.tweens.add({
    targets: inner, scale: 0.55, alpha: 0.7, duration: 750 + Math.random()*150,
    yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
  return container;
}

// ====================== BOMB VISUALS (shared) ======================
// Bombs must read as clearly different from power-ups (no icon shape, just
// a pulsing disc) and communicate urgency in a way that's actually legible:
// a countdown number does the heavy lifting, and the pulse/flash underneath
// starts slow enough to notice speeding up rather than being frantic from
// the start.
function lerpColorInt(c1, c2, t){
  const r = Math.round(c1.r + (c2.r-c1.r)*t);
  const g = Math.round(c1.g + (c2.g-c1.g)*t);
  const b = Math.round(c1.b + (c2.b-c1.b)*t);
  return (r<<16) | (g<<8) | b;
}
const BOMB_BASE_COLOR = { r:0x1c, g:0x1c, b:0x1c };
const BOMB_HOT_COLOR  = { r:0x5a, g:0x10, b:0x10 };
const BOMB_FLASH_COLOR= { r:0xff, g:0x40, b:0x40 };
const REMOTE_BOMB_COLOR      = 0x9b59b6; // matches the Detonator power-up/button color
const REMOTE_BOMB_BASE_COLOR = { r:0x24, g:0x18, b:0x2c };
const REMOTE_BOMB_FLASH_COLOR= { r:0xaf, g:0x5a, b:0xd6 };
const MINE_COLOR       = 0xff9800; // warning orange, distinct from remote purple and normal red
const MINE_BASE_COLOR  = { r:0x2c, g:0x1e, b:0x10 };
const MINE_FLASH_COLOR = { r:0xff, g:0x98, b:0x00 };
const MINE_ARM_DELAY   = 500;   // ms before a freshly placed mine can be tripped, so the placer can step off it
const MINE_TRIGGER_RADIUS = 1;  // Manhattan distance that trips the mine (0 = same tile only)
const MINE_FUSE_MS = 15000;     // safety fallback so an untouched mine doesn't sit forever
function createBombVisual(scene, x, y, isRemote, isMine){
  const strokeColor = isMine ? MINE_COLOR : (isRemote ? REMOTE_BOMB_COLOR : 0xff5555);
  // Mines sit low-profile and small — they're meant to be easy to miss
  // underfoot, unlike a normal bomb's big obvious body.
  const radius = isMine ? TILE*0.16 : TILE*0.3;
  const circle = scene.add.circle(0, 0, radius, 0x1c1c1c).setStrokeStyle(Math.round(2*UI_SCALE), strokeColor);
  // Remote bombs show a fixed radio glyph instead of a countdown, since they
  // have no fuse — they only go off when the owner detonates them. Mines
  // show nothing at all (no countdown, no glyph) to stay stealthy.
  const text = scene.add.text(0, 1*UI_SCALE, isMine ? '' : (isRemote ? '\u{1F4E1}' : ''), {
    fontFamily: 'system-ui, sans-serif',
    fontSize: Math.round((isRemote?13:17)*UI_SCALE)+'px',
    fontStyle: 'bold',
    color: '#ffffff',
    stroke: '#000000',
    strokeThickness: Math.round(3.5*UI_SCALE),
  }).setOrigin(0.5);
  // Shadow lives outside the pulsing sub-container so it stays a calm,
  // fixed ellipse on the ground while the bomb body scales/flashes above it.
  const shadow = scene.add.ellipse(0, TILE*0.27, isMine ? TILE*0.28 : TILE*0.5, isMine ? TILE*0.1 : TILE*0.16, 0x000000, 0.35);
  const pulse = scene.add.container(0, 0, [circle, text]);
  const container = scene.add.container(x, y, [shadow, pulse]);
  container.circleGfx = circle;
  container.textGfx = text;
  container.pulseGfx = pulse;
  container.isRemote = !!isRemote;
  container.isMine = !!isMine;
  return container;
}
function updateBombVisual(container, placedAt, now){
  if (container.isMine){
    // A slow amber blink — "armed and waiting", but subtler than the remote
    // bomb's pulse so it still reads as something you could step past
    // without noticing.
    const flash = (Math.sin((now/1000) * 1.4 * Math.PI*2) + 1) / 2; // 0..1
    const color = lerpColorInt(MINE_BASE_COLOR, MINE_FLASH_COLOR, flash*0.55);
    container.circleGfx.setFillStyle(color);
    container.pulseGfx.setScale(1 + flash*0.08);
    return;
  }
  if (container.isRemote){
    // No fuse to count down — just a slow, steady "armed and waiting" pulse
    // so it's clearly distinct from a ticking normal bomb.
    const flash = (Math.sin((now/1000) * 1.1 * Math.PI*2) + 1) / 2; // 0..1
    const color = lerpColorInt(REMOTE_BOMB_BASE_COLOR, REMOTE_BOMB_FLASH_COLOR, flash*0.6);
    container.circleGfx.setFillStyle(color);
    container.pulseGfx.setScale(1 + flash*0.06);
    return;
  }
  const elapsed = now - placedAt;
  const progress = Phaser.Math.Clamp(elapsed / BOMB_FUSE, 0, 1);
  const remaining = Math.max(0, BOMB_FUSE - elapsed);
  // blink frequency ramps from a calm ~0.8Hz (clearly one blink at a time)
  // up to ~5Hz right before detonation, so the acceleration itself is easy
  // to perceive instead of looking the same throughout
  const freq = 0.8 + progress*progress*4.2;
  const flash = (Math.sin((now/1000) * freq * Math.PI*2) + 1) / 2; // 0..1
  // base color creeps from neutral black toward hot red as time runs out,
  // then the flash flickers brighter red on top of that
  const base = lerpColorInt(BOMB_BASE_COLOR, BOMB_HOT_COLOR, progress);
  const baseC = { r:(base>>16)&255, g:(base>>8)&255, b:base&255 };
  const color = lerpColorInt(baseC, BOMB_FLASH_COLOR, flash*(0.35+progress*0.55));
  container.circleGfx.setFillStyle(color);
  const scaleAmt = 1 + flash * (0.04 + progress*0.28);
  container.pulseGfx.setScale(scaleAmt);
  // countdown number: whole seconds remaining (fuse is BOMB_FUSE ms), so it
  // ticks down in a way that matches what the player can actually count
  const secondsLeft = Math.max(1, Math.ceil(remaining/1000));
  const label = String(secondsLeft);
  if (container.textGfx.text !== label) container.textGfx.setText(label);
}

// ====================== EXPLOSION FLAME VISUALS (shared) ======================
// Classic-Bomberman style: one continuous cross/plus shape per bomb blast
// (center + one rod per open direction) instead of separate blobs per cell,
// built from layered fills that go red (outer, jagged) -> orange -> yellow
// -> hot cream (innermost), with small flame-lick spikes along the rods and
// at the tips, plus a fast opacity flicker for its short (FLAME_TIME) life.
function drawJaggedPoly(g, pts, color){
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(pts[0].x, pts[0].y);
  for (let i=1;i<pts.length;i++) g.lineTo(pts[i].x, pts[i].y);
  g.closePath();
  g.fillPath();
}
function drawBurstStar(g, cx, cy, radius, spikes, color){
  const points = [];
  for (let i=0;i<spikes*2;i++){
    const angle = (Math.PI*i)/spikes - Math.PI/2;
    let r = (i % 2 === 0) ? radius : radius*0.55;
    r *= 0.82 + Math.random()*0.36; // irregular, jagged edge rather than a perfect star
    points.push({ x: cx+Math.cos(angle)*r, y: cy+Math.sin(angle)*r });
  }
  drawJaggedPoly(g, points, color);
}
// Small triangular flame licks along the long edges of one rod (arm), for
// the jagged/irregular border look. `axis` is 'v' (up/down, edges run
// left/right) or 'h' (left/right, edges run top/bottom).
function addArmSpikes(g, axis, halfW, from, to, color){
  if (to <= from) return;
  const len = to - from;
  const count = Math.max(1, Math.round(len / (TILE*0.3)));
  for (let i=0;i<count;i++){
    const t = (i+0.5)/count;
    const pos = from + t*len + (Math.random()-0.5)*(len/count)*0.4;
    const spikeLen = halfW*0.35 + Math.random()*halfW*0.3;
    const half = halfW*0.55;
    for (const side of [-1,1]){
      let pts;
      if (axis === 'v'){
        const edgeX = side*halfW;
        pts = [ {x:edgeX,y:pos-half}, {x:edgeX+side*spikeLen,y:pos}, {x:edgeX,y:pos+half} ];
      } else {
        const edgeY = side*halfW;
        pts = [ {x:pos-half,y:edgeY}, {x:pos,y:edgeY+side*spikeLen}, {x:pos+half,y:edgeY} ];
      }
      drawJaggedPoly(g, pts, color);
    }
  }
}
// armLen = {up,down,left,right} in pixels (0 = that direction is blocked).
function createExplosionCrossVisual(scene, x, y, armLen){
  const W = TILE*0.6; // overall cross width
  const g = scene.add.graphics();
  const layers = [
    { wf:1.00, color:0xdd2200 }, // outer red-orange, jagged border
    { wf:0.80, color:0xff6a00 }, // orange band
    { wf:0.54, color:0xffb300 }, // warm yellow-orange fill
    { wf:0.26, color:0xffe27a }, // hot cream core
  ];
  layers.forEach(({wf,color}) => {
    const w = W*wf, h = w/2;
    g.fillStyle(color, 1);
    g.fillRect(-h, -h, w, w); // center square
    if (armLen.up)    g.fillRect(-h, -h-armLen.up,   w, armLen.up + h);
    if (armLen.down)  g.fillRect(-h, h,               w, armLen.down + h);
    if (armLen.left)  g.fillRect(-h-armLen.left, -h,  armLen.left + h, w);
    if (armLen.right) g.fillRect(h, -h,               armLen.right + h, w);
  });
  const outerHalf = W/2;
  addArmSpikes(g, 'v', outerHalf, -outerHalf-armLen.up, -outerHalf, 0xdd2200);
  addArmSpikes(g, 'v', outerHalf, outerHalf, outerHalf+armLen.down, 0xdd2200);
  addArmSpikes(g, 'h', outerHalf, -outerHalf-armLen.left, -outerHalf, 0xdd2200);
  addArmSpikes(g, 'h', outerHalf, outerHalf, outerHalf+armLen.right, 0xdd2200);
  if (armLen.up)    drawBurstStar(g, 0, -outerHalf-armLen.up,   outerHalf*0.9, 7, 0xdd2200);
  if (armLen.down)  drawBurstStar(g, 0, outerHalf+armLen.down,  outerHalf*0.9, 7, 0xdd2200);
  if (armLen.left)  drawBurstStar(g, -outerHalf-armLen.left, 0, outerHalf*0.9, 7, 0xdd2200);
  if (armLen.right) drawBurstStar(g, outerHalf+armLen.right, 0, outerHalf*0.9, 7, 0xdd2200);
  return scene.add.container(x, y, [g]);
}
function updateExplosionFlameVisual(container, createdAt, now){
  const t = (now - createdAt) / 1000;
  const freq = 13; // Hz -- fast flicker across the flame's short life
  const flicker = 0.55 + 0.45 * ((Math.sin(t*freq*Math.PI*2) + 1) / 2);
  container.setAlpha(flicker);
}

// ====================== TOUCH INPUT (shared) ======================
const localTouch = { up:false, down:false, left:false, right:false };
let localBombTapped = false;
let localKickTapped = false;
let localDetonateTapped = false;
let localMineTapped = false;

function setupTouchControls(){
  const bind = (id, key) => {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', e => { e.preventDefault(); localTouch[key] = true; });
    el.addEventListener('pointerup',   e => { e.preventDefault(); localTouch[key] = false; });
    el.addEventListener('pointerleave',e => { localTouch[key] = false; });
    el.addEventListener('pointercancel', e => { localTouch[key] = false; });
  };
  bind('btn-up','up'); bind('btn-down','down'); bind('btn-left','left'); bind('btn-right','right');
  document.getElementById('btn-bomb').addEventListener('pointerdown', e => { e.preventDefault(); localBombTapped = true; });
  document.getElementById('btn-kick').addEventListener('pointerdown', e => { e.preventDefault(); localKickTapped = true; });
  document.getElementById('btn-detonate').addEventListener('pointerdown', e => { e.preventDefault(); localDetonateTapped = true; });
  document.getElementById('btn-mine').addEventListener('pointerdown', e => { e.preventDefault(); localMineTapped = true; });
}
function consumeLocalBombTap(){
  if (localBombTapped){ localBombTapped = false; return true; }
  return false;
}
function consumeLocalKickTap(){
  if (localKickTapped){ localKickTapped = false; return true; }
  return false;
}
function consumeLocalDetonateTap(){
  if (localDetonateTapped){ localDetonateTapped = false; return true; }
  return false;
}
function consumeLocalMineTap(){
  if (localMineTapped){ localMineTapped = false; return true; }
  return false;
}
function readLocalDirection(keys){
  const anyDown = arr => arr.some(k => k.isDown);
  return {
    up:    anyDown(keys.up)    || localTouch.up,
    down:  anyDown(keys.down)  || localTouch.down,
    left:  anyDown(keys.left)  || localTouch.left,
    right: anyDown(keys.right) || localTouch.right,
  };
}
function makeLocalKeys(scene){
  const kb = scene.input.keyboard;
  return {
    up:    [kb.addKey('W'), kb.addKey('UP')],
    down:  [kb.addKey('S'), kb.addKey('DOWN')],
    left:  [kb.addKey('A'), kb.addKey('LEFT')],
    right: [kb.addKey('D'), kb.addKey('RIGHT')],
    space: kb.addKey('SPACE'),
    enter: kb.addKey('ENTER'),
    kick:  kb.addKey('K'),
    detonate: kb.addKey('F'),
    mine: kb.addKey('M'),
  };
}
function localBombJustPressed(keys){
  return Phaser.Input.Keyboard.JustDown(keys.space) ||
         Phaser.Input.Keyboard.JustDown(keys.enter) ||
         consumeLocalBombTap();
}
// Explicit "punch/kick" input: shoves a live bomb one tile in the direction
// the player is currently facing without requiring them to step into it
// (walking into a bomb while holding the Kick power-up does the same thing,
// see HostScene.tryMove).
function localKickJustPressed(keys){
  return Phaser.Input.Keyboard.JustDown(keys.kick) || consumeLocalKickTap();
}
// Remote Bomb input: places the player's one remote bomb if they don't have
// one out yet, or detonates it right now if they do.
function localDetonateJustPressed(keys){
  return Phaser.Input.Keyboard.JustDown(keys.detonate) || consumeLocalDetonateTap();
}
// Proximity Mine input: places the player's one active mine (if they have
// the ability and don't already have one out). Dedicated key/button, kept
// separate from the bomb button so it can't be triggered by accident.
function localMineJustPressed(keys){
  return Phaser.Input.Keyboard.JustDown(keys.mine) || consumeLocalMineTap();
}

// ====================== BOARD HELPERS (shared, deterministic) ======================
// Tiny deterministic PRNG (per-tile seed) so grass speckles/stone seams are
// stable across redraws instead of re-randomizing every time the board builds.
function tileRand(seed){
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Grass floor tile: base color plus a scattering of subtle darker/lighter
// speckles so it reads as mottled turf instead of a flat color swatch.
function drawFloorTile(scene, r, c){
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const shade = (r+c) % 2 === 0 ? 0x2f6b2f : 0x276227;
  scene.add.rectangle(x, y, TILE-2, TILE-2, shade);

  const rand = tileRand(r*73856093 ^ c*19349663);
  const speck = scene.add.graphics();
  speck.x = x; speck.y = y;
  const lightColor = (r+c) % 2 === 0 ? 0x3d7d3d : 0x347334;
  const darkColor  = (r+c) % 2 === 0 ? 0x255525 : 0x1f4a1f;
  const dotCount = 7 + Math.floor(rand()*5);
  for (let i = 0; i < dotCount; i++){
    const px = (rand()-0.5) * (TILE-10);
    const py = (rand()-0.5) * (TILE-10);
    const rad = (1.2 + rand()*1.6) * UI_SCALE;
    speck.fillStyle(rand() < 0.5 ? lightColor : darkColor, 0.3);
    speck.fillCircle(px, py, rad);
  }
}

// Indestructible wall/pillar block: beveled "solid stone" look — light
// top/left bevel faces, dark bottom/right bevel faces, a slightly recessed
// inner face, and faint seam lines suggesting a carved stone block.
function drawWallBlock(scene, r, c){
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const s = TILE - 2;
  const half = s / 2;
  const bevel = Math.max(4, Math.round(TILE * 0.1));
  const baseColor  = 0x656b76;
  const lightColor = 0x9aa1ac;
  const darkColor  = 0x35383e;
  const innerColor = 0x5a5f69;

  const container = scene.add.container(x, y);

  const body = scene.add.rectangle(0, 0, s, s, baseColor)
    .setStrokeStyle(Math.round(2*UI_SCALE), 0x24262b);
  container.add(body);

  const bevelGfx = scene.add.graphics();
  // top face (light)
  bevelGfx.fillStyle(lightColor, 0.95);
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, -half);
  bevelGfx.lineTo(half, -half);
  bevelGfx.lineTo(half-bevel, -half+bevel);
  bevelGfx.lineTo(-half+bevel, -half+bevel);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  // left face (light)
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, -half);
  bevelGfx.lineTo(-half+bevel, -half+bevel);
  bevelGfx.lineTo(-half+bevel, half-bevel);
  bevelGfx.lineTo(-half, half);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  // bottom face (dark)
  bevelGfx.fillStyle(darkColor, 0.95);
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, half);
  bevelGfx.lineTo(half, half);
  bevelGfx.lineTo(half-bevel, half-bevel);
  bevelGfx.lineTo(-half+bevel, half-bevel);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  // right face (dark)
  bevelGfx.beginPath();
  bevelGfx.moveTo(half, -half);
  bevelGfx.lineTo(half-bevel, -half+bevel);
  bevelGfx.lineTo(half-bevel, half-bevel);
  bevelGfx.lineTo(half, half);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  container.add(bevelGfx);

  const inner = scene.add.rectangle(0, 0, s - bevel*2, s - bevel*2, innerColor);
  container.add(inner);

  const seam = scene.add.graphics();
  seam.lineStyle(Math.max(1, Math.round(1.5*UI_SCALE)), 0x484c54, 0.6);
  seam.beginPath();
  seam.moveTo(-half+bevel, 0); seam.lineTo(half-bevel, 0);
  seam.moveTo(0, -half+bevel); seam.lineTo(0, half-bevel);
  seam.strokePath();
  container.add(seam);
}

function buildStaticBoard(scene, pillars = true){
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      drawFloorTile(scene, r, c);
    }
  }
  const solid = [];
  for (let r = 0; r < ROWS; r++){
    solid.push(new Array(COLS).fill(false));
    for (let c = 0; c < COLS; c++){
      const isBorder = r === 0 || c === 0 || r === ROWS-1 || c === COLS-1;
      const isPillar = pillars && r % 2 === 0 && c % 2 === 0;
      if (isBorder || isPillar){
        solid[r][c] = true;
        drawWallBlock(scene, r, c);
      }
    }
  }
  return solid;
}
// A handful of crack layouts (as fractions of the crate's half-width), picked
// deterministically per-tile so neighboring crates don't all look identical.
// Each crack is a 3-point jagged line (start -> kink -> end).
const CRACK_VARIANTS = [
  [[-0.55,-0.6, -0.1,-0.05, 0.35,0.2], [0.5,-0.5, 0.05,0.15, -0.3,0.55]],
  [[-0.3,-0.65, 0.05,-0.1, -0.35,0.4], [0.55,-0.2, 0.1,0.05, 0.4,0.6]],
  [[-0.6,0.1, -0.1,0.0, 0.3,-0.45],   [0.15,0.6, -0.05,0.1, -0.55,-0.25]],
  [[-0.15,-0.6, 0.1,-0.1, 0.55,0.15], [-0.5,0.5, -0.15,0.05, 0.2,-0.35]],
];
function drawBlock(scene, r, c){
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const container = scene.add.container(x, y);

  const s = TILE - 4;
  const half = s / 2;
  const bevel = Math.max(3, Math.round(TILE * 0.07)); // shallower than the stone walls' bevel

  const body = scene.add.rectangle(0, 0, s, s, 0x8a5a2e).setStrokeStyle(Math.round(2*UI_SCALE), 0x5c3b1e);
  container.add(body);

  // Beveled crate faces (lighter top/left catching light, darker bottom/right
  // in shadow) give the crate a raised, chunky look — but kept shallow and
  // paired with the cracks below so it still reads as breakable wood, not a
  // solid stone block.
  const bevelGfx = scene.add.graphics();
  bevelGfx.fillStyle(0xb07a3e, 0.9); // lit top/left faces
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, -half);
  bevelGfx.lineTo(half, -half);
  bevelGfx.lineTo(half-bevel, -half+bevel);
  bevelGfx.lineTo(-half+bevel, -half+bevel);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, -half);
  bevelGfx.lineTo(-half+bevel, -half+bevel);
  bevelGfx.lineTo(-half+bevel, half-bevel);
  bevelGfx.lineTo(-half, half);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  bevelGfx.fillStyle(0x5c3b1e, 0.9); // shadowed bottom/right faces
  bevelGfx.beginPath();
  bevelGfx.moveTo(-half, half);
  bevelGfx.lineTo(half, half);
  bevelGfx.lineTo(half-bevel, half-bevel);
  bevelGfx.lineTo(-half+bevel, half-bevel);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  bevelGfx.beginPath();
  bevelGfx.moveTo(half, -half);
  bevelGfx.lineTo(half-bevel, -half+bevel);
  bevelGfx.lineTo(half-bevel, half-bevel);
  bevelGfx.lineTo(half, half);
  bevelGfx.closePath();
  bevelGfx.fillPath();
  container.add(bevelGfx);

  // Recessed inner plank face, slightly different tone from the bevel edges
  // so the crate reads as a raised block rather than a flat sticker.
  const inner = scene.add.rectangle(0, 0, s - bevel*2, s - bevel*2, 0x8a5a2e);
  container.add(inner);

  // Crack lines make it obvious at a glance that this block can be broken
  // (as opposed to the solid indestructible pillars/walls).
  const variant = CRACK_VARIANTS[Math.abs(r*3 + c*7) % CRACK_VARIANTS.length];
  const cracks = scene.add.graphics();
  cracks.lineStyle(Math.max(1, Math.round(2*UI_SCALE)), 0x4a2f18, 0.9);
  variant.forEach(pts => {
    cracks.beginPath();
    cracks.moveTo(pts[0]*half, pts[1]*half);
    cracks.lineTo(pts[2]*half, pts[3]*half);
    cracks.lineTo(pts[4]*half, pts[5]*half);
    cracks.strokePath();
  });
  container.add(cracks);

  // A chipped-off corner sells "damaged / breakable" even faster than the
  // crack lines alone, especially at a glance or small size.
  const chip = TILE*0.16;
  const chipGfx = scene.add.graphics();
  chipGfx.fillStyle(0x5c3b1e, 1);
  chipGfx.beginPath();
  chipGfx.moveTo(half - chip, -half);
  chipGfx.lineTo(half, -half);
  chipGfx.lineTo(half, -half + chip);
  chipGfx.closePath();
  chipGfx.fillPath();
  container.add(chipGfx);

  return container;
}
// Eyes are two small dots whose position within the face shifts toward
// whatever direction the player is currently facing (last direction moved),
// so at a glance you can tell where everyone's headed without any sprite
// animation — just geometry.
function positionPlayerEyes(p){
  let dr = p.facingDr || 0, dc = p.facingDc || 0;
  if (dr === 0 && dc === 0){ dr = 1; dc = 0; } // fallback: look "down" toward camera
  const mag = Math.hypot(dc, dr) || 1;
  const dx = dc/mag, dy = dr/mag; // forward direction in screen space
  const forward = TILE*0.11;   // how far the eye pair shifts toward the facing side
  const spacing = TILE*0.17;   // distance between the two eyes
  const cx = dx*forward, cy = dy*forward;
  const px = -dy*(spacing/2), py = dx*(spacing/2); // perpendicular to facing
  p.eyeL.setPosition(cx + px, cy + py);
  p.eyeR.setPosition(cx - px, cy - py);
}
function setPlayerFacing(p, dr, dc){
  if (dr === 0 && dc === 0) return; // stayed put: keep last facing
  if (p.facingDr === dr && p.facingDc === dc) return;
  p.facingDr = dr; p.facingDc = dc;
  positionPlayerEyes(p);
}
// Shows/hides and pulses the purple curse ring around a player based on
// whether they currently have an active curse — same helper works on both
// the host (driven by the real p.curse) and clients (driven by the synced
// p.cursed boolean from the snapshot).
function updateCurseRingVisual(p, time){
  const active = p.curse ? true : !!p.cursed;
  if (!active){ p.curseRing.setVisible(false); return; }
  p.curseRing.setVisible(true);
  const pulse = 0.35 + 0.65*((Math.sin(time/130)+1)/2);
  p.curseRing.setStrokeStyle(Math.max(2, Math.round(3*UI_SCALE)), 0x8e44ad, pulse);
}
// Shows/hides the rosy shield ring based on how many Heart/Shield charges a
// player currently has banked. Works on both host (real p.shieldCount) and
// client (mirrored from the snapshot into the same field).
function updateShieldRingVisual(p){
  p.shieldRing.setVisible((p.shieldCount || 0) > 0);
}
function makePlayers(scene, numPlayers){
  const players = [];
  for (let i = 0; i < numPlayers; i++){
    const s = SPAWNS[i];
    const x = s.c*TILE + TILE/2, y = HUD_H + s.r*TILE + TILE/2;
    const container = scene.add.container(x, y);
    // Soft elliptical shadow, drawn first so it sits under everything else,
    // to ground the flat circle players on the tile instead of floating.
    const shadow = scene.add.ellipse(0, TILE*0.30, TILE*0.56, TILE*0.20, 0x000000, 0.35);
    const body = scene.add.circle(0, 0, TILE*0.32, PLAYER_COLORS[i]).setStrokeStyle(Math.round(3*UI_SCALE), 0x111111);
    // Purple curse ring: sits just outside the body, invisible until a curse
    // power-up is active, then pulses to nag the player that something is
    // currently wrong with them.
    const curseRing = scene.add.circle(0, 0, TILE*0.40, 0x000000, 0)
      .setStrokeStyle(Math.max(2, Math.round(3*UI_SCALE)), 0x8e44ad, 1)
      .setVisible(false);
    // Rosy shield ring: sits just outside the curse ring, shown whenever the
    // player has at least one Heart/Shield charge banked.
    const shieldRing = scene.add.circle(0, 0, TILE*0.46, 0x000000, 0)
      .setStrokeStyle(Math.max(2, Math.round(3*UI_SCALE)), 0xff5da2, 1)
      .setVisible(false);
    const eyeRad = Math.max(1.5, TILE*0.045);
    const eyeL = scene.add.circle(0, 0, eyeRad, 0x161616);
    const eyeR = scene.add.circle(0, 0, eyeRad, 0x161616);
    const label = scene.add.text(0, -TILE*0.55, playerDisplayName(i), { fontSize:Math.round(12*UI_SCALE)+'px', color:'#fff' }).setOrigin(0.5);
    container.add([shadow, body, curseRing, shieldRing, eyeL, eyeR, label]);
    const player = { id:i, row:s.r, col:s.c, container, body, label, shadow, eyeL, eyeR, curseRing, shieldRing, alive:true, maxBombs:1, blastRange:2, speed:0, curse:null, hasKick:false, shieldCount:0, pierce:false, hasDetonator:false, remoteBomb:null, hasMine:false, activeMine:null, invulnerableUntil:0, facingDr:s.dr, facingDc:s.dc };
    positionPlayerEyes(player);
    players.push(player);
  }
  return players;
}
// Formats a duration in milliseconds as "M:SS" (or "MM:SS" past 9:59) for the
// match timer. Clamped at 0 so a slightly-negative rounding blip (possible in
// the first frame or two after create()) never flashes a "-0:01".
// Ping quality indicator: green under ~40ms (great), yellow 40-160ms (typical
// home wifi — still fine to play on), red above 160ms (noticeably laggy).
function pingQualityEmoji(ms){
  if (ms < 40) return '\u{1F7E2}';   // 🟢
  if (ms <= 160) return '\u{1F7E1}'; // 🟡
  return '\u{1F534}';                // 🔴
}

function formatMatchTime(ms){
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

// ====================== FOG OF WAR (visual only, per-viewer) ======================
// One Graphics object, redrawn every frame: fully dark everywhere except a
// small square around the given player's current tile, with one soft
// in-between ring. Runs independently on the host's own screen and on each
// client's own screen — every viewer sees fog centered on *their own*
// player, not a shared board-wide reveal.
function createFogOverlay(scene){
  return scene.add.graphics().setDepth(900);
}
function updateFogOverlay(gfx, player){
  gfx.clear();
  if (!player || !player.alive) return; // eliminated/spectating players see the whole board
  const pr = player.row, pc = player.col;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      const dist = Math.max(Math.abs(r-pr), Math.abs(c-pc));
      if (dist <= FOG_VISIBLE_RADIUS) continue;
      const alpha = dist <= FOG_VISIBLE_RADIUS+1 ? FOG_PARTIAL_ALPHA : FOG_DARK_ALPHA;
      gfx.fillStyle(0x000000, alpha);
      gfx.fillRect(c*TILE, HUD_H + r*TILE, TILE, TILE);
    }
  }
}

// ====================== SHRINKING ARENA (visual + host-authoritative damage) ======================
// bounds = {minR,maxR,minC,maxC}: the inclusive tile range still "safe".
// Everything outside gets a red danger-zone tint; the host alone decides
// when it shrinks and who it hurts, clients just render whatever bounds the
// host broadcasts.
function createArenaOverlay(scene){
  return scene.add.graphics().setDepth(850);
}
function updateArenaOverlay(gfx, bounds){
  gfx.clear();
  if (!bounds) return;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      if (r >= bounds.minR && r <= bounds.maxR && c >= bounds.minC && c <= bounds.maxC) continue;
      gfx.fillStyle(0xcc2222, 0.38);
      gfx.fillRect(c*TILE, HUD_H + r*TILE, TILE, TILE);
    }
  }
}
// Shrinks the safe zone by one ring on each side, leaving at least a 3x3
// core so the match always has some playable space left even if the timer
// runs long. Returns true if it actually shrank (bounds changed).
function shrinkArenaBounds(bounds){
  if (bounds.maxR - bounds.minR <= 2 || bounds.maxC - bounds.minC <= 2) return false;
  bounds.minR++; bounds.maxR--; bounds.minC++; bounds.maxC--;
  return true;
}

function buildHUD(scene, numPlayers){
  scene.add.rectangle(COLS*TILE/2, HUD_H/2, COLS*TILE, HUD_H, 0x15181d);
  const hudTexts = [];
  const statsY = 20 * UI_SCALE; // only row left in the HUD bar: per-player stats
  const slotW = (COLS*TILE) / numPlayers; // even spacing regardless of player count
  for (let i = 0; i < numPlayers; i++){
    const x = (12*UI_SCALE) + i*slotW;
    scene.add.circle(x, statsY, 9*UI_SCALE, PLAYER_COLORS[i]);
    hudTexts.push(scene.add.text(x+15*UI_SCALE, statsY-8*UI_SCALE, '', { fontSize:Math.round(12*UI_SCALE)+'px', color:'#eee' }));
  }

  // Match timer: top-right corner of the HUD bar, right-aligned so it grows
  // toward the left rather than shifting off the edge as digits change.
  const timerText = scene.add.text(COLS*TILE - 10*UI_SCALE, statsY-8*UI_SCALE, '0:00', { fontSize:Math.round(13*UI_SCALE)+'px', color:'#9fd3ff', fontStyle:'bold' }).setOrigin(1, 0);

  // Win/status message: used to be a permanent second row inside the HUD
  // bar, taking up board space the entire game even though it's empty
  // until someone actually wins. It's now a big banner overlaid on the
  // maze itself (dark strip + bold centered text), created hidden and only
  // shown once endGame() (or a client snapshot) calls winText.setText(...)
  // with a real message. `this.winText.setText()` is called from several
  // places in the file, so this object exposes the same setText() method as
  // a drop-in replacement for the old Phaser Text object.
  const bannerY = HUD_H + (ROWS*TILE)/2;
  const bannerH = Math.round(70 * UI_SCALE);
  const winBg = scene.add.rectangle(COLS*TILE/2, bannerY, COLS*TILE, bannerH, 0x000000, 0.65).setVisible(false).setDepth(1000);
  const winLabel = scene.add.text(COLS*TILE/2, bannerY, '', { fontSize:Math.round(34*UI_SCALE)+'px', color:'#fff', fontStyle:'bold' }).setOrigin(0.5).setVisible(false).setDepth(1001);
  const winText = {
    setText(msg){
      winLabel.setText(msg);
      const show = !!msg;
      winBg.setVisible(show);
      winLabel.setVisible(show);
    }
  };
  return { hudTexts, winText, timerText };
}

// ====================== BOT AI (host-only, drives non-local players in solo mode) ======================
const BOT_DIRS = [
  { name:'left',  dr:0,  dc:-1 },
  { name:'right', dr:0,  dc:1  },
  { name:'up',    dr:-1, dc:0  },
  { name:'down',  dr:1,  dc:0  },
];

function botCellOpen(scene, r, c){
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  if (scene.solid[r][c]) return false;
  if (scene.blocks[r][c]) return false;
  if (scene.bombs[r][c]) return false;
  // O(1) lookup instead of scanning scene.flames on every BFS node.
  // computeDangerSet() (always called before pathfinding in botDecide) keeps
  // this map fresh; fall back to a linear scan only if it's somehow missing.
  const flameMap = scene._flameMap;
  if (flameMap) {
    if (flameMap.has(r * COLS + c)) return false;
  } else if (scene.flames.some(f => f.r === r && f.c === c)) {
    return false;
  }
  return true;
}

// Cells currently on fire, or that a live bomb's blast will reach.
// Spatial keys here are packed as r*COLS+c (plain numbers) rather than "r,c"
// strings: Set/Map lookups on numbers avoid a string allocation per call and
// hash noticeably faster in V8, which matters since these sets get probed on
// every BFS node during pathfinding.
function computeDangerSet(scene){
  const danger = new Set();
  // Build the flame lookup map alongside the danger set in the same pass,
  // so botCellOpen can do O(1) lookups instead of Array.some() scans.
  const flameMap = new Set();
  for (const f of scene.flames){
    const k = f.r * COLS + f.c;
    flameMap.add(k);
    danger.add(k);
  }
  scene._flameMap = flameMap;
  // Walk only the bombs that actually exist instead of scanning every one of
  // ROWS*COLS grid cells looking for them (scene.activeBombs is kept in sync
  // by placeBomb/explodeBomb).
  for (const bomb of scene.activeBombs){
    const r = bomb.row, c = bomb.col;
    danger.add(r * COLS + c);
    for (const d of BOT_DIRS){
      for (let i = 1; i <= bomb.range; i++){
        const rr = r + d.dr*i, cc = c + d.dc*i;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
        if (scene.solid[rr][cc]) break;
        danger.add(rr * COLS + cc);
        if (scene.blocks[rr][cc]) break; // blast stops at (and destroys) the first block
      }
    }
  }
  return danger;
}

// BFS from (sr,sc) over open cells to the nearest cell matching isTarget. Returns
// the name of the first-step direction to take, or null if unreachable.
function botFirstStepTo(scene, sr, sc, isTarget, avoidSet){
  const startKey = sr * COLS + sc;
  const visited = new Set([startKey]);
  const prev = new Map();
  const queue = [{ r:sr, c:sc }];
  let target = null;
  while (queue.length){
    const cur = queue.shift();
    const curKey = cur.r * COLS + cur.c;
    if (curKey !== startKey && isTarget(cur.r, cur.c)){ target = cur; break; }
    for (const d of BOT_DIRS){
      const nr = cur.r + d.dr, nc = cur.c + d.dc;
      // Bounds-check before packing the key: an out-of-range nr/nc would
      // otherwise alias a different in-bounds cell's numeric key.
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      const key = nr * COLS + nc;
      if (visited.has(key)) continue;
      if (!botCellOpen(scene, nr, nc)) continue;
      if (avoidSet && avoidSet.has(key)) continue;
      visited.add(key);
      prev.set(key, { r:cur.r, c:cur.c, dirName:d.name });
      queue.push({ r:nr, c:nc });
    }
  }
  if (!target) return null;
  let node = target, firstDir = null;
  while (true){
    const key = node.r * COLS + node.c;
    const p = prev.get(key);
    if (!p) break;
    firstDir = p.dirName;
    node = { r:p.r, c:p.c };
  }
  return firstDir;
}

function botRandomSafeStep(scene, p, danger){
  const options = BOT_DIRS.filter(d => {
    const nr = p.row+d.dr, nc = p.col+d.dc;
    // botCellOpen's bounds check runs first, so danger.has() below never
    // sees an out-of-range nr/nc (short-circuited by the `&&`).
    return botCellOpen(scene, nr, nc) && !danger.has(nr*COLS+nc);
  });
  if (!options.length) return null;
  return options[Math.floor(Math.random() * options.length)].name;
}

// Decide this bot's action. Thinking is throttled (cached direction is reused
// between thinks) so bots don't recompute pathfinding every single frame.
function botDecide(scene, i, time){
  const p = scene.players[i];
  let mem = scene.botMemory[i];
  if (!mem) mem = scene.botMemory[i] = { nextThink:0, dir:{up:false,down:false,left:false,right:false}, waitingForClear:false };
  if (time < mem.nextThink) return { dir: mem.dir, bombPressed: false };

  const danger = computeDangerSet(scene);
  const here = p.row * COLS + p.col;
  const dir = { up:false, down:false, left:false, right:false };
  let bombPressed = false;
  const inDanger = danger.has(here);

  // Once the bomb we planted has actually gone off AND its fire has died
  // down, we're allowed to consider planting another one.
  if (mem.waitingForClear && scene.countActiveBombs(p) === 0 && scene.flames.length === 0){
    mem.waitingForClear = false;
  }

  // React quickly whenever something dangerous is nearby OR we're still
  // watching over a bomb we just planted (so we notice the instant we need
  // to move, instead of coasting on a stale cached direction); think more
  // leisurely only while fully safe and idle, so bots aren't twitchy while
  // just exploring.
  const urgent = inDanger || mem.waitingForClear;
  mem.nextThink = time + (urgent ? 80 + Math.random()*60 : 220 + Math.random()*140);

  if (inDanger){
    // Elimina 'danger' como argumento final en botFirstStepTo para que pueda cruzar la zona de explosión inminente
    const step = botRandomSafeStep(scene, p, danger)
      || botFirstStepTo(scene, p.row, p.col, (r,c) => !danger.has(r*COLS+c));
    if (step) dir[step] = true;
  } else if (mem.waitingForClear){
    // We already have a bomb armed (or its fire hasn't finished yet) and
    // we're currently standing somewhere safe — hold this position and just
    // watch, rather than wandering back toward the blast while we wait for
    // the all-clear. (dir stays all-false: the bot stands still.)
  } else {
    // Hard cap of exactly one bomb on the field at a time for this bot, no
    // matter how many bomb powerups it has picked up.
    const canBomb = !scene.bombs[p.row][p.col] && scene.countActiveBombs(p) < 1;
    let wantsBomb = false;
    let fleeStep = null;
    if (canBomb){
      outer: for (const d of BOT_DIRS){
        for (let step = 1; step <= p.blastRange; step++){
          const rr = p.row + d.dr*step, cc = p.col + d.dc*step;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
          if (scene.solid[rr][cc]) break;
          if (scene.blocks[rr][cc]){ wantsBomb = true; break outer; }
          if (scene.players.some(pl => pl.alive && pl !== p && pl.row === rr && pl.col === cc)){ wantsBomb = true; break outer; }
        }
      }
      if (wantsBomb){
        // Only bomb if there's a cell to escape to afterwards — and remember
        // which way that escape route starts, so the bot can take that very
        // step the instant it drops the bomb instead of standing on it.
        const hypothetical = new Set(danger);
        hypothetical.add(here);
        for (const d of BOT_DIRS){
          for (let step = 1; step <= p.blastRange; step++){
            const rr = p.row + d.dr*step, cc = p.col + d.dc*step;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
            if (scene.solid[rr][cc]) break;
            hypothetical.add(rr*COLS+cc);
            if (scene.blocks[rr][cc]) break;
          }
        }
        fleeStep = botFirstStepTo(scene, p.row, p.col, (r,c) => !hypothetical.has(r*COLS+c), danger);
        if (!fleeStep) wantsBomb = false; // no escape route — don't bomb at all
      }
    }

    if (wantsBomb){
      bombPressed = true;
      mem.waitingForClear = true; // don't even consider another bomb until this one is fully resolved
      if (fleeStep) dir[fleeStep] = true; // start fleeing the same instant the bomb drops
    } else {
      const isNearBlock = (r, c) => BOT_DIRS.some(d => {
        const rr = r+d.dr, cc = c+d.dc;
        return rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && scene.blocks[rr][cc];
      });
      const step = botFirstStepTo(scene, p.row, p.col, isNearBlock, danger) || botRandomSafeStep(scene, p, danger);
      if (step) dir[step] = true;
    }
  }

  mem.dir = dir;
  return { dir, bombPressed };
}

// ====================== NETWORKING ======================
class NetManager {
  constructor(){
    this.peer = null;
    this.isHost = false;
    this.myIndex = 0;
    this.myToken = null;    // client: this browser's persistent reconnect token
    // Host keeps fixed 3-slot bookkeeping (slot i => player index i+1) instead
    // of an append-only list, so a returning player can be matched back to
    // their original slot by token rather than always taking a fresh one.
    this.conns = [null, null, null];         // host: live DataConnection per slot (or null)
    this.tokens = [null, null, null];        // host: the token that "owns" each slot once claimed
    this.reconnectDeadline = [0, 0, 0];      // host: wall-clock ms deadline while a slot's conn is down (0 = not pending)
    this.RECONNECT_GRACE_MS = 20000;
    this.hostConn = null;  // client: connection to host
    this.names = [null, null, null, null]; // display name per player index (null = use default P1/P2/...)
    this.onPlayerJoined = null;
    this.onReconnect = null; // host: (playerIndex) — fired when a previously-dropped slot returns
    this.onNameUpdate = null; // host: (playerIndex) — fired when a client's name arrives/changes
    this.onDisconnect = null;
    this.onInput = null;   // host: (playerIndex, data)
    this.onStart = null;   // client: (data)
    this.onState = null;   // client: (data)
    this.onHostLost = null;     // client: () — fired when the connection to the host drops unexpectedly
    this.onHostRestored = null; // client: () — fired once auto-reconnect succeeds
    this._reconnecting = false;
    this._lastHostId = null;
    // Network stats: only the host actively measures latency (it pings each
    // client and times the reply), then piggybacks the results onto the
    // state snapshot it's already broadcasting so clients can see everyone's
    // ping — including their own — without running a second ping loop.
    this.pingMs = [null, null, null]; // host: latest RTT (ms) per slot 0-2, null until first measurement lands
    this._pingIntervalId = null;
  }

  connectedCount(){ return this.conns.filter(c => !!c).length; }

  hostGame(onReady, onError){
    this.isHost = true;
    this.myIndex = 0;
    this.names = [null, null, null, null];
    this.names[0] = (typeof PLAYER_NAME !== 'undefined' && PLAYER_NAME) ? PLAYER_NAME : null;
    this.conns = [null, null, null];
    this.tokens = [null, null, null];
    this.reconnectDeadline = [0, 0, 0];
    this.pingMs = [null, null, null];
    if (this._pingIntervalId) clearInterval(this._pingIntervalId);
    // Every 2s, ping whichever slots currently have a live connection. Each
    // client just echoes the timestamp straight back (see the 'ping' branch
    // below), so this measures true round-trip time over the DataConnection.
    this._pingIntervalId = setInterval(() => {
      for (const c of this.conns) if (c && c.open) c.send({ t:'ping', ts: Date.now() });
    }, 2000);
    this.peer = new Peer();
    this.peer.on('open', id => onReady(id));
    this.peer.on('error', err => onError && onError(err));
    this.peer.on('connection', conn => {
      conn.on('data', data => {
        if (data.t === 'join'){
          // Seat this connection by token: a token already on file means a
          // previously-dropped player reclaiming their old slot rather than
          // a brand-new arrival taking the next open one.
          const token = data.token;
          let slot = token ? this.tokens.findIndex(t => t === token) : -1;
          const isReconnect = slot !== -1;
          if (!isReconnect){
            slot = this.tokens.findIndex(t => t === null);
            if (slot === -1){ conn.close(); return; } // room full (max 3 clients)
            this.tokens[slot] = token || null;
          }
          conn._slot = slot;
          this.conns[slot] = conn;
          this.reconnectDeadline[slot] = 0;
          const idx = slot + 1;
          const nm = data.name && String(data.name).trim();
          this.names[idx] = nm ? nm.slice(0, 16) : (this.names[idx] || null);
          conn.send({ t:'welcome', index: idx });
          if (isReconnect){ if (this.onReconnect) this.onReconnect(idx); }
          else if (this.onPlayerJoined) this.onPlayerJoined(idx);
          if (this.onNameUpdate) this.onNameUpdate(idx);
        } else if (data.t === 'input' && this.onInput){
          if (conn._slot != null) this.onInput(conn._slot + 1, data);
        } else if (data.t === 'pong'){
          if (conn._slot != null) this.pingMs[conn._slot] = Date.now() - data.ts;
        }
      });
      conn.on('close', () => {
        const slot = conn._slot;
        if (slot == null) return;
        if (this.conns[slot] === conn) this.conns[slot] = null;
        // Don't eliminate them yet — give them a grace window to reconnect
        // (same token) before treating the slot as truly abandoned.
        this.reconnectDeadline[slot] = Date.now() + this.RECONNECT_GRACE_MS;
        if (this.onDisconnect) this.onDisconnect(slot + 1);
      });
    });
  }

  joinGame(hostId, onReady, onError){
    this.isHost = false;
    this._lastHostId = hostId;
    this.peer = new Peer();
    this.peer.on('error', err => onError && onError(err));
    this.peer.on('open', () => this._connectToHost(hostId, onReady, onError));
  }

  _connectToHost(hostId, onReady, onError, isRetryAttempt){
    const conn = this.peer.connect(hostId, { reliable: true });
    this.hostConn = conn;
    let settled = false; // true once this attempt actually opens
    conn.on('open', () => {
      settled = true;
      const nm = (typeof PLAYER_NAME !== 'undefined' && PLAYER_NAME) ? PLAYER_NAME : null;
      conn.send({ t:'join', name: nm, token: this.myToken });
      const wasReconnecting = this._reconnecting;
      this._reconnecting = false;
      if (wasReconnecting && this.onHostRestored) this.onHostRestored();
      onReady();
    });
    conn.on('data', data => {
      if (data.t === 'welcome') this.myIndex = data.index;
      else if (data.t === 'start' && this.onStart){ if (data.names) this.names = data.names; this.onStart(data); }
      else if (data.t === 'state' && this.onState) this.onState(data);
      else if (data.t === 'ping') conn.send({ t:'pong', ts: data.ts });
    });
    conn.on('close', () => {
      // A connection that was genuinely open and then dropped kicks off (or
      // continues) the auto-reconnect loop. A retry attempt that never even
      // managed to open just needs to try again — reported straight back to
      // whoever's driving the retry loop, not through _handleHostDrop (which
      // would otherwise no-op since we're already mid-retry and stall it).
      if (settled) this._handleHostDrop(onError);
      else if (isRetryAttempt && onError) onError(new Error('connection closed before opening'));
    });
    conn.on('error', err => {
      if (settled) return; // 'close' already covers the genuinely-open case
      if (onError) onError(err);
    });
  }

  // Fired when the DataConnection to the host closes mid-game (e.g. a wifi
  // blip). Rather than surfacing this as a fatal error, quietly retries the
  // connection for a while — matching the host's own reconnect grace period
  // — using the same persistent token so the host seats us back in our old
  // slot instead of treating us as a new player.
  _handleHostDrop(onError){
    if (this._reconnecting) return; // already retrying
    if (this.myIndex === 0) return; // hosts don't join themselves
    this._reconnecting = true;
    if (this.onHostLost) this.onHostLost();
    this._retryReconnect(0, onError);
  }

  _retryReconnect(attempt, onError){
    if (!this._reconnecting) return; // reconnect already succeeded elsewhere
    if (attempt >= 10){ // ~20s of retries, matching RECONNECT_GRACE_MS
      this._reconnecting = false;
      if (this.onHostLost) this.onHostLost('failed');
      return;
    }
    setTimeout(() => {
      if (!this._reconnecting) return;
      const retryAgain = () => this._retryReconnect(attempt + 1, onError);
      try {
        if (this.peer && !this.peer.destroyed && this.peer.open){
          this._connectToHost(this._lastHostId, () => {}, retryAgain, true);
        } else {
          this.peer = new Peer();
          this.peer.on('open', () => this._connectToHost(this._lastHostId, () => {}, retryAgain, true));
          this.peer.on('error', retryAgain);
        }
      } catch (e){ retryAgain(); }
    }, 2000);
  }

  broadcastStart(payload){ for (const c of this.conns) if (c) c.send(Object.assign({ t:'start', names: this.names.slice() }, payload)); }
  broadcastState(payload){ for (const c of this.conns) if (c) c.send(Object.assign({ t:'state' }, payload)); }
  sendInput(data){ if (this.hostConn) this.hostConn.send(Object.assign({ t:'input' }, data)); }
}

const net = new NetManager();
// A persistent per-browser id so that if this tab's connection to the host
// drops and reconnects, the host recognizes it as the same returning player
// instead of a brand-new one. Survives page reloads (but is unique enough
// that joining an unrelated game later is never mistaken for a reconnect).
(function initReconnectToken(){
  const KEY = 'mb_reconnect_token';
  let t;
  try { t = localStorage.getItem(KEY); } catch (e){ t = null; }
  if (!t){
    t = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(KEY, t); } catch (e){ /* ignore (private browsing etc.) */ }
  }
  net.myToken = t;
})();
// Returns a player's custom display name if one was set (host, in-game
// broadcast to all clients), otherwise the default 'P1'/'P2'/etc label.
function playerDisplayName(i){
  const nm = net.names && net.names[i];
  return (nm && String(nm).trim()) ? String(nm).trim() : 'P'+(i+1);
}
let NET_NUM_PLAYERS = 1;
let NET_BOT_COUNT = 0; // solo mode only: players 1..NET_BOT_COUNT are AI-controlled
let NET_BLOCKS_GRID = null;
let NET_PILLARS = true;     // client-side mirror of the host's scenario.pillars flag
let NET_TELEPORTERS = [];   // client-side mirror of the host's _teleporterPairsList (visuals only)
let NET_FOG_OF_WAR = false;      // client-side mirror of the host's scenario.fogOfWar flag
let NET_SHRINKING_ARENA = false; // client-side mirror of the host's scenario.shrinkingArena flag
let NET_DAY_NIGHT_CYCLE = false; // client-side mirror of the host's scenario.dayNightCycle flag
let NET_IS_SOLO = false;    // true only for "Play Solo" runs — enables move recording/export
let MATCH_SEED_CONSUMED = false; // reset to false whenever a fresh match is (re)launched from the lobby
let activeHostScene = null; // reference to the live HostScene instance, for the export button
let currentGame = null; // reference to the live Phaser.Game instance, so we can force a re-fit on resize/rotate
window.addEventListener('resize', () => { if (currentGame) currentGame.scale.refresh(); });
window.addEventListener('orientationchange', () => { if (currentGame) setTimeout(() => currentGame.scale.refresh(), 100); });

// ====================== HOST SCENE (authoritative) ======================
class HostScene extends Phaser.Scene {
  constructor(){ super('host'); }

  create(){
    const scenario = SCENARIOS[SELECTED_SCENARIO] || SCENARIOS.standard;
    this.scenario = SELECTED_SCENARIO;
    this.scenarioConfig = scenario;
    // The very first create() of a match uses the seed shown/copied in the
    // lobby, so that seed reliably reproduces this exact layout. Restarting
    // mid-session (R) re-rolls a fresh seed each time, same as the old
    // unseeded behavior, so restarts still give you a new map rather than
    // replaying the same one.
    this.currentSeed = MATCH_SEED_CONSUMED ? randomSeedString() : MAP_SEED;
    this.rng = seededRng(this.currentSeed);
    MATCH_SEED_CONSUMED = true;
    updateGameSeedDisplay(this.currentSeed);
    // BOMB_FUSE was already set fresh for this match by applySpeedSetting()
    // just before the scene was created, so scaling it here on top is safe —
    // it can't compound across matches or scenarios.
    if (scenario.fuseMult && scenario.fuseMult !== 1) BOMB_FUSE = Math.round(BOMB_FUSE * scenario.fuseMult);
    this.solid = buildStaticBoard(this, scenario.pillars);
    this.blocks = [];       // rect or null
    this.blocksGridBool = [];
    this.bombs = [];        // bomb object or null
    this.activeBombs = [];  // flat list mirroring this.bombs, kept in sync so
                            // hot paths (per-frame visuals, per-bot-think danger
                            // calc, active-bomb counting) don't need to scan the
                            // whole ROWS*COLS grid to find the handful of live bombs
    this.powerups = [];     // {type,gfx} or null
    this.flames = [];       // {r,c,expire} -- logical, host-only (damage + bot AI)
    this.explosionVisuals = []; // {gfx,createdAt,expire,row,col,arm} -- one per bomb blast
    this.teleporters = [];  // {toRow,toCol,gfx,pairId} or null -- Teleporters scenario only
    const protectedCells = new Set();
    for (let i = 0; i < NET_NUM_PLAYERS; i++){
      const s = SPAWNS[i];
      protectedCells.add(s.r+','+s.c);
      protectedCells.add((s.r+s.dr)+','+s.c);
      protectedCells.add(s.r+','+(s.c+s.dc));
    }
    for (let r = 0; r < ROWS; r++){
      this.blocks.push(new Array(COLS).fill(null));
      this.blocksGridBool.push(new Array(COLS).fill(false));
      this.bombs.push(new Array(COLS).fill(null));
      this.powerups.push(new Array(COLS).fill(null));
      this.teleporters.push(new Array(COLS).fill(null));
    }
    // Teleporter pairs (if this scenario has any): pick random non-solid,
    // non-spawn-protected tiles, pair them up, and mark both permanently —
    // they're excluded below from destructible-block placement so a portal
    // tile is always walkable and visible for the whole match.
    this._teleporterPairsList = [];
    if (scenario.teleporterPairs){
      const candidates = [];
      for (let r = 1; r < ROWS-1; r++){
        for (let c = 1; c < COLS-1; c++){
          if (this.solid[r][c]) continue;
          if (protectedCells.has(r+','+c)) continue;
          candidates.push({ r, c });
        }
      }
      for (let k = candidates.length - 1; k > 0; k--){
        const j = Math.floor(this.rng() * (k+1));
        [candidates[k], candidates[j]] = [candidates[j], candidates[k]];
      }
      const pairCount = Math.min(scenario.teleporterPairs, Math.floor(candidates.length / 2));
      for (let p = 0; p < pairCount; p++){
        const a = candidates[p*2], b = candidates[p*2 + 1];
        const color = TELEPORT_COLORS[p % TELEPORT_COLORS.length];
        const ax = a.c*TILE + TILE/2, ay = HUD_H + a.r*TILE + TILE/2;
        const bx = b.c*TILE + TILE/2, by = HUD_H + b.r*TILE + TILE/2;
        this.teleporters[a.r][a.c] = { toRow:b.r, toCol:b.c, gfx: createTeleporterVisual(this, ax, ay, color), pairId:p };
        this.teleporters[b.r][b.c] = { toRow:a.r, toCol:a.c, gfx: createTeleporterVisual(this, bx, by, color), pairId:p };
        this._teleporterPairsList.push({ pairId:p, aRow:a.r, aCol:a.c, bRow:b.r, bCol:b.c });
      }
    }
    // A teleporter tile's diagonal neighbors are always pillars (portals only
    // ever land on odd-row/odd-col cells), so if crates happen to fill in all
    // four orthogonal neighbors too, the tile becomes a sealed 1x1 box —
    // anyone who warps in is stuck with no way out except bombing themselves.
    // Reserve one orthogonal neighbor per portal (in-bounds, non-solid) as a
    // guaranteed gap so every teleporter always has an escape route.
    const keepClear = new Set();
    for (let r = 0; r < ROWS; r++){
      for (let c = 0; c < COLS; c++){
        if (!this.teleporters[r][c]) continue;
        const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
        for (let k = dirs.length - 1; k > 0; k--){
          const j = Math.floor(this.rng() * (k+1));
          [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
        }
        for (const [dr, dc] of dirs){
          const nr = r+dr, nc = c+dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (this.solid[nr][nc]) continue;
          keepClear.add(nr+','+nc);
          break;
        }
      }
    }
    for (let r = 1; r < ROWS-1; r++){
      for (let c = 1; c < COLS-1; c++){
        if (this.solid[r][c]) continue;
        if (protectedCells.has(r+','+c)) continue;
        if (this.teleporters[r][c]) continue;
        if (keepClear.has(r+','+c)) continue;
        if (this.rng() < scenario.blockFillChance){
          this.blocks[r][c] = drawBlock(this, r, c);
          this.blocksGridBool[r][c] = true;
        }
      }
    }

    this.players = makePlayers(this, NET_NUM_PLAYERS);
    if (scenario.extraBlastRange) this.players.forEach(p => p.blastRange += scenario.extraBlastRange);
    const hud = buildHUD(this, NET_NUM_PLAYERS);
    this.hudTexts = hud.hudTexts; this.winText = hud.winText; this.timerText = hud.timerText;

    // Fog of War: fog is drawn around the host's own player (index 0) —
    // each remote client independently draws its own fog around whichever
    // player it controls, so nobody actually loses a shared view; every
    // screen just centers the darkness differently. Day/Night Cycle reuses
    // the exact same overlay, just toggling it on and off on a timer instead
    // of leaving it on the whole match.
    this.fogOfWar = !!scenario.fogOfWar;
    this.dayNightCycle = !!scenario.dayNightCycle;
    this.isNight = false; // only meaningful while dayNightCycle is active; starts as day
    this.fogGfx = (this.fogOfWar || this.dayNightCycle) ? createFogOverlay(this) : null;
    this.dayNightText = this.dayNightCycle
      ? this.add.text(10*UI_SCALE, HUD_H + 10*UI_SCALE, '\u2600\uFE0F Day', { fontSize:Math.round(14*UI_SCALE)+'px', color:'#ffe9a8', fontStyle:'bold' }).setDepth(950)
      : null;

    // Shrinking Arena: bounds start as the whole board and contract toward
    // the center every SHRINK_INTERVAL_MS, after an initial SHRINK_GRACE_MS
    // with no shrinking. Scheduling uses Date.now() rather than the Phaser
    // scene clock, matching the match timer above, since the scene clock
    // isn't guaranteed to reset to 0 on a mid-session restart (R).
    this.shrinkingArena = !!scenario.shrinkingArena;
    if (this.shrinkingArena){
      this.arenaBounds = { minR:0, maxR:ROWS-1, minC:0, maxC:COLS-1 };
      this.nextShrinkAt = Date.now() + SHRINK_GRACE_MS;
      this.arenaGfx = createArenaOverlay(this);
    } else {
      this.arenaBounds = null;
      this.arenaGfx = null;
    }

    // Player 0 is always the local human. In solo mode, players 1..NET_BOT_COUNT
    // are AI bots; any remaining players are real network clients (multiplayer).
    this.controllers = [];
    for (let i = 0; i < NET_NUM_PLAYERS; i++){
      if (i === 0) this.controllers.push('local');
      else if (i <= NET_BOT_COUNT) this.controllers.push('bot');
      else this.controllers.push('remote');
    }
    this.botMemory = [];
    this.players.forEach((p, i) => {
      if (this.controllers[i] === 'bot') p.label.setText(playerDisplayName(i)+' \u{1F916}');
    });

    activeHostScene = this;
    this.recording = null;
    if (NET_IS_SOLO){
      this.recording = {
        // Bump this whenever the schema below changes shape, so a future
        // replay engine can detect and reject/adapt to older exports instead
        // of silently misinterpreting them.
        schemaVersion: 3,
        startedAt: Date.now(),
        // ---- Board / match setup (everything needed to rebuild the exact
        // starting state, with zero reliance on re-rolling any randomness) ----
        mapSize: SELECTED_MAP_SIZE,
        speed: SELECTED_SPEED,
        scenario: SELECTED_SCENARIO, // 'standard' | 'open_arena' | 'crate_rush' | ...
        scenarioConfig: { pillars: scenario.pillars, blockFillChance: scenario.blockFillChance, powerupSpawnChance: scenario.powerupSpawnChance, fuseMult: scenario.fuseMult || 1, extraBlastRange: scenario.extraBlastRange || 0, fogOfWar: !!scenario.fogOfWar, shrinkingArena: !!scenario.shrinkingArena, dayNightCycle: !!scenario.dayNightCycle },
        cols: COLS, rows: ROWS, tile: TILE, hudHeight: HUD_H,
        numPlayers: NET_NUM_PLAYERS,
        botCount: NET_BOT_COUNT,
        controllers: this.controllers.slice(), // 'local' | 'bot' per player index
        playerNames: Array.from({length: NET_NUM_PLAYERS}, (_, i) => playerDisplayName(i)),
        spawns: SPAWNS.slice(0, NET_NUM_PLAYERS),
        // Full initial destructible-block layout (row-major bool grid). Blocks
        // are only ever removed during a match (never added), and every
        // removal is captured by an 'explode' event below, so this snapshot
        // plus the event log fully determines the board at any point in time.
        blocksGrid: this.blocksGridBool.map(row => row.slice()),
        // Speed-scaled timing constants in effect for this match, captured so
        // a replay reproduces the same pacing even if defaults change later.
        timing: {
          moveInterval: MOVE_INTERVAL, speedStepMs: SPEED_STEP_MS, minMoveInterval: MIN_MOVE_INTERVAL,
          bombFuse: BOMB_FUSE, flameTime: FLAME_TIME, bombSlideMs: BOMB_SLIDE_MS,
          curseDuration: CURSE_DURATION, curseAutobombEvery: CURSE_AUTOBOMB_EVERY,
          curseSlowMult: CURSE_SLOW_MULT, shieldHitIframeMs: SHIELD_HIT_IFRAME_MS, maxShield: MAX_SHIELD,
        },
        // events: one entry per discrete game-state-changing event, in
        // chronological order (t = ms since match start, this.time.now).
        // Every source of randomness (block-destruction powerup rolls, curse
        // type picks) is resolved and recorded as its actual outcome here —
        // nothing about replaying this log should require re-rolling RNG.
        //   move          -> { t, type, player, row, col }
        //   bomb          -> { t, type, player, row, col, range }              (normal bomb placed)
        //   remoteBomb    -> { t, type, player, row, col, range }              (remote bomb armed)
        //   detonate      -> { t, type, player, row, col }                    (remote bomb manually triggered)
        //   kick          -> { t, type, player, row, col, dr, dc }            (bomb push/kick initiated; row/col = bomb's tile before the push)
        //   explode       -> { t, type, player, remote, row, col, range, pierce,
        //                       destroyed:[{row,col}], powerups:[{row,col,type}] } (bomb detonation: blocks destroyed + any powerups it spawned)
        //   powerupPickup -> { t, type, player, row, col, powerup }
        //   curse         -> { t, type, player, curse }
        //   shieldBreak   -> { t, type, player }
        //   death         -> { t, type, player }
        //   gameOver      -> { t, type, winner }
        events: []
      };
    }

    this.remoteInput = {};      // idx -> {up,down,left,right}
    this.remoteBombQueue = {};  // idx -> pending count
    this.remoteKickQueue = {};  // idx -> pending count
    this.remoteDetonateQueue = {}; // idx -> pending count
    this.remoteMineQueue = {}; // idx -> pending count
    net.onInput = (idx, data) => {
      this.remoteInput[idx] = { up:data.up, down:data.down, left:data.left, right:data.right };
      if (data.bombPressed) this.remoteBombQueue[idx] = (this.remoteBombQueue[idx] || 0) + 1;
      if (data.kickPressed) this.remoteKickQueue[idx] = (this.remoteKickQueue[idx] || 0) + 1;
      if (data.detonatePressed) this.remoteDetonateQueue[idx] = (this.remoteDetonateQueue[idx] || 0) + 1;
      if (data.minePressed) this.remoteMineQueue[idx] = (this.remoteMineQueue[idx] || 0) + 1;
    };
    net.onDisconnect = (idx) => {
      // Don't eliminate immediately — just stop reacting to their stale last
      // input so they freeze in place rather than sliding/bombing on their
      // own while we wait out the reconnect grace period (see net.reconnectDeadline).
      this.remoteInput[idx] = { up:false, down:false, left:false, right:false };
    };

    this.localKeys = makeLocalKeys(this);
    this.keyR = this.input.keyboard.addKey('R');
    this.playerMoveTime = new Array(NET_NUM_PLAYERS).fill(0);
    this.playerMoving = new Array(NET_NUM_PLAYERS).fill(false);
    this.aliveCount = NET_NUM_PLAYERS;
    this.gameOver = false;
    this.lastBroadcast = 0;

    // Match timer: measured against the wall clock (Date.now()) rather than
    // this.time.now. Phaser's scene clock is NOT guaranteed to reset to 0
    // when a scene restarts (this.scene.restart()) — it can carry over time
    // already elapsed since the Game booted, including any time the user
    // spent sitting in the lobby before ever pressing Play. That previously
    // made the on-screen timer start already showing several seconds
    // elapsed instead of 0:00. Date.now() captured fresh right here, at the
    // moment the match actually begins, sidesteps that entirely. Frozen at
    // whatever value it hit once the match ends, both on-screen
    // (this.timerText) and in the broadcast snapshot, so clients' clocks
    // stop in sync with the host's.
    this.matchStartTime = Date.now();
    this.frozenElapsed = 0;

    net.broadcastStart({ blocksGrid: this.blocksGridBool, pillars: !!scenario.pillars, teleporters: this._teleporterPairsList, fogOfWar: this.fogOfWar, shrinkingArena: this.shrinkingArena, dayNightCycle: this.dayNightCycle, numPlayers: NET_NUM_PLAYERS, cols: COLS, rows: ROWS, speed: SELECTED_SPEED, seed: this.currentSeed });
  }

  // Walls and destructible blocks always block movement, regardless of any
  // power-up — only a live bomb can potentially be walked through (with the
  // Kick power-up, by shoving it out of the way first).
  isBlockedByTerrain(r, c){
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return true;
    if (this.solid[r][c]) return true;
    if (this.blocks[r][c]) return true;
    return false;
  }

  isBlocked(r, c){
    return this.isBlockedByTerrain(r, c) || !!this.bombs[r][c];
  }

  tryMove(i, dr, dc){
    const p = this.players[i];
    const nr = p.row + dr, nc = p.col + dc;
    if (this.isBlockedByTerrain(nr, nc)) return;
    const bombAhead = this.bombs[nr][nc];
    if (bombAhead){
      // Kick/Punch power-up: walking straight into a live bomb shoves it
      // one tile further down the line (which then keeps sliding on its
      // own — see slideBombStep) and the player steps into the tile it
      // just vacated. Without the power-up, a bomb still blocks like a wall.
      if (!p.hasKick) return;
      if (!this.pushBomb(bombAhead, dr, dc, i)) return;
    }
    setPlayerFacing(p, dr, dc);
    p.row = nr; p.col = nc; this.playerMoving[i] = true;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'move', player:i, row:nr, col:nc });
    const x = nc*TILE + TILE/2, y = HUD_H + nr*TILE + TILE/2;
    this.tweens.add({
      targets: p.container, x, y, duration: playerMoveInterval(p) - 10,
      onComplete: () => { this.playerMoving[i] = false; this.checkTeleport(p); this.checkPowerupPickup(p); }
    });
  }

  // Teleporters scenario: stepping onto a portal tile instantly warps the
  // player to its paired tile. The destination is itself a portal tile, but
  // this only runs once per move (not recursively), so it doesn't bounce
  // the player back and forth.
  checkTeleport(p){
    const tp = this.teleporters[p.row][p.col];
    if (!tp) return;
    const fromRow = p.row, fromCol = p.col;
    p.row = tp.toRow; p.col = tp.toCol;
    p.container.x = p.col*TILE + TILE/2;
    p.container.y = HUD_H + p.row*TILE + TILE/2;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'teleport', player:p.id, fromRow, fromCol, toRow:p.row, toCol:p.col });
  }

  // Can a bomb currently slide onto tile (r,c)? Blocked by the board edge,
  // walls, destructible blocks, another bomb, or a player standing there —
  // kicked bombs stop dead rather than overlapping any of those.
  canBombEnter(r, c){
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
    if (this.solid[r][c]) return false;
    if (this.blocks[r][c]) return false;
    if (this.bombs[r][c]) return false;
    if (this.players.some(pl => pl.alive && pl.row === r && pl.col === c)) return false;
    return true;
  }

  // Kicks off a slide in direction (dr,dc); returns true if the bomb was
  // able to take at least one step. Used both by walking into a bomb
  // (tryMove) and by the explicit Kick key/button (doKick).
  pushBomb(bomb, dr, dc, playerId){
    if (bomb.exploded) return false;
    if (!this.canBombEnter(bomb.row + dr, bomb.col + dc)) return false;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'kick', player: playerId, row:bomb.row, col:bomb.col, dr, dc });
    this.slideBombStep(bomb, dr, dc);
    return true;
  }

  // Moves a sliding bomb exactly one tile, then — as long as nothing stops
  // it — schedules the next tile once the tween finishes, so it reads as a
  // continuous slide down the line rather than a single shove.
  slideBombStep(bomb, dr, dc){
    const nr = bomb.row + dr, nc = bomb.col + dc;
    this.bombs[bomb.row][bomb.col] = null;
    bomb.row = nr; bomb.col = nc;
    this.bombs[nr][nc] = bomb;
    const x = nc*TILE + TILE/2, y = HUD_H + nr*TILE + TILE/2;
    this.tweens.add({
      targets: bomb.gfx, x, y, duration: BOMB_SLIDE_MS,
      onComplete: () => {
        if (bomb.exploded) return;
        if (this.canBombEnter(bomb.row + dr, bomb.col + dc)) this.slideBombStep(bomb, dr, dc);
      }
    });
  }

  // Explicit Kick/Punch action: shoves a bomb sitting directly in front of
  // the player (their current facing direction) without requiring the
  // player to step into its tile.
  doKick(p){
    if (!p.alive || !p.hasKick) return;
    const dr = p.facingDr, dc = p.facingDc;
    if (dr === 0 && dc === 0) return;
    const r = p.row + dr, c = p.col + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const bomb = this.bombs[r][c];
    if (!bomb) return;
    this.pushBomb(bomb, dr, dc, p.id);
  }

  // Remote Bomb: a separate bomb type from the stackable normal bombs.
  // Capped at exactly one live at a time no matter how many Detonator
  // power-ups a player has picked up (picking up extras is a no-op), it has
  // no fuse, and doesn't consume a normal maxBombs slot. The same button
  // does double duty: with none out, it places one; with one already out,
  // it detonates it.
  detonate(p){
    if (!p.alive || !p.hasDetonator) return;
    if (p.remoteBomb){
      if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'detonate', player:p.id, row:p.remoteBomb.row, col:p.remoteBomb.col });
      this.explodeBomb(p.remoteBomb);
    }
    else this.placeRemoteBomb(p);
  }

  placeRemoteBomb(p){
    if (this.bombs[p.row][p.col]) return; // tile already holds a bomb
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'remoteBomb', player:p.id, row:p.row, col:p.col, range:p.blastRange });
    SFX.bombPlaced();
    const x = p.col*TILE + TILE/2, y = HUD_H + p.row*TILE + TILE/2;
    const gfx = createBombVisual(this, x, y, true);
    const bomb = { row:p.row, col:p.col, owner:p, exploded:false, gfx, range:p.blastRange, pierce:!!p.pierce, placedAt:this.time.now, remote:true };
    this.bombs[p.row][p.col] = bomb;
    this.activeBombs.push(bomb);
    p.remoteBomb = bomb;
    // No delayedCall here — unlike a normal bomb, this one only goes off
    // when detonate() is called again.
  }

  checkPowerupPickup(p){
    const pu = this.powerups[p.row][p.col];
    if (!pu) return;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'powerupPickup', player:p.id, row:p.row, col:p.col, powerup:pu.type });
    if (pu.type === 'bomb') p.maxBombs++;
    else if (pu.type === 'flame') p.blastRange++;
    else if (pu.type === 'speed') p.speed++;
    else if (pu.type === 'kick') p.hasKick = true;
    else if (pu.type === 'heart') p.shieldCount = Math.min((p.shieldCount||0) + 1, MAX_SHIELD);
    else if (pu.type === 'pierce') p.pierce = true;
    else if (pu.type === 'detonator') p.hasDetonator = true;
    else if (pu.type === 'mine') p.hasMine = true;
    else this.applyCurse(p);
    SFX.powerup();
    destroyPowerupVisual(pu.gfx);
    this.powerups[p.row][p.col] = null;
  }

  applyCurse(p){
    const type = CURSE_TYPES[Math.floor(Math.random()*CURSE_TYPES.length)];
    p.curse = { type, expiresAt: this.time.now + CURSE_DURATION, nextAutobomb: this.time.now + CURSE_AUTOBOMB_EVERY };
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'curse', player:p.id, curse:type });
  }

  placeBomb(p){
    if (!p.alive) return;
    if (this.bombs[p.row][p.col]) return;
    const active = this.countActiveBombs(p);
    if (active >= p.maxBombs) return;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'bomb', player:p.id, row:p.row, col:p.col, range:p.blastRange });
    SFX.bombPlaced();
    const x = p.col*TILE + TILE/2, y = HUD_H + p.row*TILE + TILE/2;
    const gfx = createBombVisual(this, x, y);
    const bomb = { row:p.row, col:p.col, owner:p, exploded:false, gfx, range:p.blastRange, pierce:!!p.pierce, placedAt:this.time.now };
    this.bombs[p.row][p.col] = bomb;
    this.activeBombs.push(bomb);
    this.time.delayedCall(BOMB_FUSE, () => this.explodeBomb(bomb));
  }

  // Proximity Mine: works like the Remote Bomb power-up — picking it up
  // grants the permanent ability, but only one mine can be out on the field
  // at once (tracked via p.activeMine). It's placed with its own action
  // (the M key / mine button) rather than the normal bomb button, and has
  // no fuse countdown: it sits silent and nearly invisible until any player
  // (owner included) wanders within MINE_TRIGGER_RADIUS tiles of it, at
  // which point checkMines() detonates it. A long safety fuse still applies
  // so an untouched mine can't camp a tile forever.
  placeMine(p){
    if (!p.alive || !p.hasMine || p.activeMine) return;
    if (this.bombs[p.row][p.col]) return;
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'mine', player:p.id, row:p.row, col:p.col, range:p.blastRange });
    SFX.bombPlaced();
    const x = p.col*TILE + TILE/2, y = HUD_H + p.row*TILE + TILE/2;
    const gfx = createBombVisual(this, x, y, false, true);
    const bomb = { row:p.row, col:p.col, owner:p, exploded:false, gfx, range:p.blastRange, pierce:!!p.pierce, placedAt:this.time.now, mine:true, armAt:this.time.now + MINE_ARM_DELAY };
    this.bombs[p.row][p.col] = bomb;
    this.activeBombs.push(bomb);
    p.activeMine = bomb;
    this.time.delayedCall(MINE_FUSE_MS, () => this.explodeBomb(bomb));
  }

  // Called every update() tick: trips any armed mine that has a player
  // (any player, including its own owner) within its trigger radius.
  checkMines(time){
    for (const bomb of this.activeBombs){
      if (!bomb.mine || bomb.exploded) continue;
      if (time < bomb.armAt) continue;
      for (const p of this.players){
        if (!p.alive) continue;
        const dist = Math.abs(p.row - bomb.row) + Math.abs(p.col - bomb.col);
        if (dist <= MINE_TRIGGER_RADIUS){ this.explodeBomb(bomb); break; }
      }
    }
  }

  countActiveBombs(p){
    // activeBombs is typically just a handful of entries, vs. a ROWS*COLS scan.
    // Remote bombs and mines are excluded — they're each a separate,
    // always-cap-1 pool and don't eat into a player's normal maxBombs supply.
    let n = 0;
    for (const bomb of this.activeBombs) if (bomb.owner === p && !bomb.remote && !bomb.mine) n++;
    return n;
  }

  explodeBomb(bomb){
    if (bomb.exploded) return;
    bomb.exploded = true;
    this.bombs[bomb.row][bomb.col] = null;
    const idx = this.activeBombs.indexOf(bomb);
    if (idx !== -1) this.activeBombs.splice(idx, 1);
    if (bomb.remote && bomb.owner.remoteBomb === bomb) bomb.owner.remoteBomb = null;
    if (bomb.mine && bomb.owner.activeMine === bomb) bomb.owner.activeMine = null;
    bomb.gfx.destroy();
    SFX.explosion();

    const cells = [{ r: bomb.row, c: bomb.col }];
    const dirs = [
      { key:'left',  dr:0,  dc:-1 },
      { key:'right', dr:0,  dc:1  },
      { key:'up',    dr:-1, dc:0  },
      { key:'down',  dr:1,  dc:0  },
    ];
    const armTiles = { up:0, down:0, left:0, right:0 };
    // Every block this blast destroys, and any powerup that spawns from it,
    // is logged below (in destroyedBlocks/spawnedPowerups) with its actual
    // resolved outcome — so a replay never needs to re-roll this randomness,
    // it just applies the same recorded result.
    const destroyedBlocks = [];
    const spawnedPowerups = [];
    for (const d of dirs){
      for (let i = 1; i <= bomb.range; i++){
        const r = bomb.row + d.dr*i, c = bomb.col + d.dc*i;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
        if (this.solid[r][c]) break;
        cells.push({ r, c });
        armTiles[d.key] = i;
        if (this.blocks[r][c]){
          this.blocks[r][c].destroy();
          this.blocks[r][c] = null;
          this.blocksGridBool[r][c] = false;
          destroyedBlocks.push({ row:r, col:c });
          if (Math.random() < this.scenarioConfig.powerupSpawnChance){
            const roll = Math.random();
            // Mine gets a deliberately thin 5% slice (borrowed from curse's
            // share) — it should be a rare, surprising find in the crates,
            // not a reliable pickup like the others.
            const type = roll < 0.15 ? 'bomb'
                       : roll < 0.30 ? 'flame'
                       : roll < 0.42 ? 'speed'
                       : roll < 0.54 ? 'kick'
                       : roll < 0.66 ? 'heart'
                       : roll < 0.78 ? 'pierce'
                       : roll < 0.88 ? 'detonator'
                       : roll < 0.93 ? 'mine'
                       : 'curse';
            const px = c*TILE+TILE/2, py = HUD_H+r*TILE+TILE/2;
            this.powerups[r][c] = { type, gfx: createPowerupVisual(this, px, py, type) };
            spawnedPowerups.push({ row:r, col:c, type });
          }
          // Pierce Bomb: the blast punches through the block it just
          // destroyed and keeps going, instead of stopping here like a
          // normal bomb's blast would.
          if (!bomb.pierce) break;
        }
        if (this.bombs[r][c]){
          this.explodeBomb(this.bombs[r][c]);
          if (!bomb.pierce) break;
        }
      }
    }
    if (this.recording){
      this.recording.events.push({
        t: Math.round(this.time.now), type:'explode',
        player: bomb.owner ? bomb.owner.id : null, remote: !!bomb.remote, mine: !!bomb.mine,
        row: bomb.row, col: bomb.col, range: bomb.range, pierce: !!bomb.pierce,
        destroyed: destroyedBlocks, powerups: spawnedPowerups,
      });
    }
    const now = this.time.now;
    for (const cell of cells) this.flames.push({ r:cell.r, c:cell.c, expire: now+FLAME_TIME });

    const cx = bomb.col*TILE+TILE/2, cy = HUD_H+bomb.row*TILE+TILE/2;
    const armLenPx = { up:armTiles.up*TILE, down:armTiles.down*TILE, left:armTiles.left*TILE, right:armTiles.right*TILE };
    const gfx = createExplosionCrossVisual(this, cx, cy, armLenPx);
    this.explosionVisuals.push({ gfx, createdAt: now, expire: now+FLAME_TIME, row:bomb.row, col:bomb.col, arm:armTiles });
  }

  checkFlameDamage(time){
    const now = time !== undefined ? time : this.time.now;
    if (this.flames.length){
      this.flames = this.flames.filter(f => f.expire > now);
      for (const p of this.players){
        if (!p.alive) continue;
        if (p.invulnerableUntil && now < p.invulnerableUntil) continue;
        if (this.flames.some(f => f.r === p.row && f.c === p.col)) this.hitPlayer(p, now);
      }
    }
    if (this.explosionVisuals.length){
      this.explosionVisuals = this.explosionVisuals.filter(ev => {
        if (ev.expire <= now){ ev.gfx.destroy(); return false; }
        updateExplosionFlameVisual(ev.gfx, ev.createdAt, now);
        return true;
      });
    }
  }

  // Called whenever flame touches a living player. If they have a banked
  // Heart/Shield charge it's consumed and they merely "break" (a visible
  // flash + sound, briefly invulnerable) rather than being eliminated;
  // otherwise it's a normal elimination.
  hitPlayer(p, now){
    if (!p.alive) return;
    if (p.shieldCount > 0){
      p.shieldCount--;
      p.invulnerableUntil = (now !== undefined ? now : this.time.now) + SHIELD_HIT_IFRAME_MS;
      SFX.shieldBreak();
      this.tweens.add({ targets: p.body, alpha: 0.25, duration: 90, yoyo: true, repeat: 1 });
      if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'shieldBreak', player:p.id });
      return;
    }
    this.killPlayer(p);
  }

  killPlayer(p){
    if (!p.alive) return;
    // A dead player can no longer press detonate, so clear out any remote
    // bomb they left armed rather than leaving a permanent dud on the board.
    if (p.remoteBomb) this.explodeBomb(p.remoteBomb);
    p.alive = false;
    p.curse = null;
    p.curseRing.setVisible(false);
    p.shieldCount = 0;
    p.shieldRing.setVisible(false);
    p.body.setFillStyle(0x333333);
    p.container.setAlpha(0.55);
    const tag = this.controllers[p.id] === 'bot' ? ' \u{1F916}' : '';
    p.label.setText(playerDisplayName(p.id)+tag+' X');
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type:'death', player:p.id });
    this.aliveCount--;
    const threshold = NET_NUM_PLAYERS > 1 ? 1 : 0;
    if (this.aliveCount <= threshold) this.endGame();
  }

  endGame(){
    if (this.gameOver) return;
    this.gameOver = true;
    this.frozenElapsed = Date.now() - this.matchStartTime;
    if (this.recording){
      const winner = this.players.find(p => p.alive);
      this.recording.events.push({ t: Math.round(this.time.now), type:'gameOver', winner: winner ? winner.id : null });
    }
    if (NET_NUM_PLAYERS === 1){
      this.winText.setText('You died! (R to retry)');
      SFX.lose();
      return;
    }
    const winner = this.players.find(p => p.alive);
    this.winText.setText(winner ? `${playerDisplayName(winner.id)} wins! (R to restart)` : `Draw! (R to restart)`);
    if (winner && winner.id === net.myIndex) SFX.win();
    else SFX.lose();
  }

  // Bundles the recorded events into a downloadable JSON file.
  exportRecording(){
    if (!this.recording) return;
    const payload = Object.assign({}, this.recording, { exportedAt: Date.now() });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maze-blaster-moves-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // True while a networked player's connection is down but still inside its
  // reconnect grace window (see net.reconnectDeadline / net.RECONNECT_GRACE_MS).
  isPendingReconnect(i){
    return this.controllers[i] === 'remote' && net.reconnectDeadline[i-1] > 0;
  }

  updateHUD(){
    for (let i = 0; i < NET_NUM_PLAYERS; i++){
      const p = this.players[i];
      const tag = this.controllers[i] === 'bot' ? '\u{1F916}' : '';
      const curseTag = p.curse ? ' \u{1F480}' : '';
      const kickTag = p.hasKick ? ' \u{1F45F}' : '';
      const shieldTag = p.shieldCount > 0 ? ` \u{1F6E1}${p.shieldCount}` : '';
      const pierceTag = p.pierce ? ' \u{1F4A5}' : '';
      const detonatorTag = p.hasDetonator ? ' \u{1F4E1}' : '';
      const mineTag = p.hasMine ? (p.activeMine ? ' \u{1F7E0}' : ' \u26AB') : '';
      const reconnectTag = this.isPendingReconnect(i) ? ' \u23F3' : '';
      // Ping only applies to real network players — solo/bot slots have no
      // connection to measure — and only once a slot's first ping reply has
      // actually landed (net.pingMs[i-1] starts out null).
      const pingVal = (this.controllers[i] === 'remote' && !this.isPendingReconnect(i)) ? net.pingMs[i-1] : null;
      const pingTag = (pingVal != null) ? ` ${pingQualityEmoji(pingVal)}${pingVal}ms` : '';
      this.hudTexts[i].setText(`${playerDisplayName(i)}${tag} ` + (p.alive ? `B${p.maxBombs}/R${p.blastRange}/S${p.speed}${curseTag}${kickTag}${shieldTag}${pierceTag}${detonatorTag}${mineTag}${reconnectTag}${pingTag}` : 'OUT'));
      this.hudTexts[i].setColor(p.alive ? (this.isPendingReconnect(i) ? '#f5b041' : (p.curse ? '#c39bd3' : '#eee')) : '#666');
      // Dim the sprite itself while frozen/pending so it's clear at a glance
      // on the board, not just in the HUD text.
      p.container.setAlpha(p.alive ? (this.isPendingReconnect(i) ? 0.55 : 1) : 0.55);
    }
  }

  buildSnapshot(){
    const bombsList = this.activeBombs.map(b => ({ row:b.row, col:b.col, remote:!!b.remote, mine:!!b.mine }));
    const powerupsList = [];
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (this.powerups[r][c]) powerupsList.push({row:r,col:c,type:this.powerups[r][c].type});
    return {
      players: this.players.map((p,i) => ({ row:p.row, col:p.col, alive:p.alive, maxBombs:p.maxBombs, blastRange:p.blastRange, speed:p.speed, cursed:!!p.curse, hasKick:!!p.hasKick, shieldCount:p.shieldCount||0, pierce:!!p.pierce, hasDetonator:!!p.hasDetonator, hasMine:!!p.hasMine, mineArmed:!!p.activeMine, reconnecting:this.isPendingReconnect(i) })),
      bombs: bombsList,
      explosions: this.explosionVisuals.map(ev => ({ row:ev.row, col:ev.col, up:ev.arm.up, down:ev.arm.down, left:ev.arm.left, right:ev.arm.right })),
      blocksGrid: this.blocksGridBool,
      powerups: powerupsList,
      elapsed: this.frozenElapsed,
      pings: net.pingMs.slice(),
      arena: this.shrinkingArena ? this.arenaBounds : null,
      isNight: this.dayNightCycle ? this.isNight : null,
      over: this.gameOver ? { winner: (this.players.find(p=>p.alive) || {}).id } : null
    };
  }

  update(time){
    // A dropped remote player's grace window is tracked in wall-clock time
    // (net.reconnectDeadline) since it's set from a PeerJS event outside the
    // Phaser clock. Once it lapses without them coming back, eliminate them
    // for real so the match can still resolve.
    for (let i = 1; i < NET_NUM_PLAYERS; i++){
      if (this.controllers[i] !== 'remote') continue;
      const slot = i - 1;
      const deadline = net.reconnectDeadline[slot];
      if (deadline && Date.now() > deadline){
        net.reconnectDeadline[slot] = 0;
        const p = this.players[i];
        if (p && p.alive) this.killPlayer(p);
      }
    }
    this.updateHUD();
    if (!this.gameOver) this.frozenElapsed = Date.now() - this.matchStartTime;
    this.timerText.setText(formatMatchTime(this.frozenElapsed));
    this.checkFlameDamage(time);
    this.checkMines(time);
    for (const bomb of this.activeBombs) updateBombVisual(bomb.gfx, bomb.placedAt, time);

    if (this.shrinkingArena && !this.gameOver){
      if (Date.now() >= this.nextShrinkAt){
        if (shrinkArenaBounds(this.arenaBounds)) SFX.explosion(); // reuse an existing cue as a rumble/warning sound
        this.nextShrinkAt = Date.now() + SHRINK_INTERVAL_MS;
      }
      const b = this.arenaBounds;
      for (const p of this.players){
        if (!p.alive) continue;
        if (p.invulnerableUntil && time < p.invulnerableUntil) continue;
        if (p.row < b.minR || p.row > b.maxR || p.col < b.minC || p.col > b.maxC) this.hitPlayer(p, time);
      }
      updateArenaOverlay(this.arenaGfx, this.arenaBounds);
    }
    if (this.dayNightCycle && !this.gameOver){
      const elapsed = Date.now() - this.matchStartTime;
      const wasNight = this.isNight;
      this.isNight = Math.floor(elapsed / DAY_NIGHT_PHASE_MS) % 2 === 1;
      if (this.isNight !== wasNight){
        this.dayNightText.setText(this.isNight ? '\u{1F319} Night' : '\u2600\uFE0F Day');
        SFX.powerup(); // reuse an existing cue as a phase-change chime
      }
    }
    const fogActive = this.fogOfWar || (this.dayNightCycle && this.isNight);
    if (fogActive) updateFogOverlay(this.fogGfx, this.players[0]);
    else if (this.fogGfx) this.fogGfx.clear();

    if (Phaser.Input.Keyboard.JustDown(this.keyR)){ this.scene.restart(); this.gameOver=false; return; }

    if (!this.gameOver){
      for (let i = 0; i < NET_NUM_PLAYERS; i++){
        const p = this.players[i];
        if (!p.alive) continue;

        if (p.curse && time >= p.curse.expiresAt) p.curse = null;
        updateCurseRingVisual(p, time);
        updateShieldRingVisual(p);

        let dir, bombPressed, kickPressed = false, detonatePressed = false, minePressed = false;
        if (i === 0){
          dir = readLocalDirection(this.localKeys);
          bombPressed = localBombJustPressed(this.localKeys);
          kickPressed = localKickJustPressed(this.localKeys);
          detonatePressed = localDetonateJustPressed(this.localKeys);
          minePressed = localMineJustPressed(this.localKeys);
        } else if (this.controllers[i] === 'bot'){
          const action = botDecide(this, i, time);
          dir = action.dir;
          bombPressed = action.bombPressed;
        } else {
          dir = this.remoteInput[i] || { up:false, down:false, left:false, right:false };
          bombPressed = false;
          if (this.remoteBombQueue[i] > 0){ this.remoteBombQueue[i]--; bombPressed = true; }
          if (this.remoteKickQueue[i] > 0){ this.remoteKickQueue[i]--; kickPressed = true; }
          if (this.remoteDetonateQueue[i] > 0){ this.remoteDetonateQueue[i]--; detonatePressed = true; }
          if (this.remoteMineQueue[i] > 0){ this.remoteMineQueue[i]--; minePressed = true; }
        }

        if (p.curse && p.curse.type === 'reverse'){
          dir = { up:dir.down, down:dir.up, left:dir.right, right:dir.left };
        }
        if (p.curse && p.curse.type === 'autobomb' && time >= p.curse.nextAutobomb){
          bombPressed = true;
          p.curse.nextAutobomb = time + CURSE_AUTOBOMB_EVERY;
        }

        if (bombPressed) this.placeBomb(p);
        if (kickPressed) this.doKick(p);
        if (detonatePressed) this.detonate(p);
        if (minePressed) this.placeMine(p);

        if (this.playerMoving[i]) continue;
        if (time - this.playerMoveTime[i] < playerMoveInterval(p)) continue;
        let dr=0, dc=0;
        if (dir.up) dr=-1; else if (dir.down) dr=1; else if (dir.left) dc=-1; else if (dir.right) dc=1;
        if (dr!==0 || dc!==0){ this.tryMove(i, dr, dc); this.playerMoveTime[i] = time; }
      }
    }

    if (time - this.lastBroadcast > STATE_INTERVAL){
      this.lastBroadcast = time;
      net.broadcastState(this.buildSnapshot());
    }
  }
}

// ====================== CLIENT SCENE (rendering + input only) ======================
class ClientScene extends Phaser.Scene {
  constructor(){ super('client'); }

  create(){
    this.solid = buildStaticBoard(this, NET_PILLARS);
    this.blocksGridBool = NET_BLOCKS_GRID.map(row => row.slice());
    this.blockRects = [];
    for (let r=0;r<ROWS;r++){
      this.blockRects.push(new Array(COLS).fill(null));
      for (let c=0;c<COLS;c++) if (this.blocksGridBool[r][c]) this.blockRects[r][c] = drawBlock(this, r, c);
    }
    // Teleporter portals are host-authoritative (the host resolves the actual
    // warp and just streams the resulting position), so the client only
    // needs to draw the matching visuals in the same spots/colors.
    (NET_TELEPORTERS || []).forEach(tp => {
      const color = TELEPORT_COLORS[tp.pairId % TELEPORT_COLORS.length];
      const ax = tp.aCol*TILE + TILE/2, ay = HUD_H + tp.aRow*TILE + TILE/2;
      const bx = tp.bCol*TILE + TILE/2, by = HUD_H + tp.bRow*TILE + TILE/2;
      createTeleporterVisual(this, ax, ay, color);
      createTeleporterVisual(this, bx, by, color);
    });

    this.players = makePlayers(this, NET_NUM_PLAYERS);
    const hud = buildHUD(this, NET_NUM_PLAYERS);
    this.hudTexts = hud.hudTexts; this.winText = hud.winText; this.timerText = hud.timerText;

    // Fog of War / Shrinking Arena / Day-Night Cycle: purely visual here —
    // the host is authoritative for both what's actually visible-worthy
    // (fog is only ever cosmetic anyway) and, for the arena, which bounds
    // are safe and who it hurts. This scene just renders whatever it's told.
    this.fogGfx = (NET_FOG_OF_WAR || NET_DAY_NIGHT_CYCLE) ? createFogOverlay(this) : null;
    this.arenaGfx = NET_SHRINKING_ARENA ? createArenaOverlay(this) : null;
    this.isNight = false;
    this.dayNightText = NET_DAY_NIGHT_CYCLE
      ? this.add.text(10*UI_SCALE, HUD_H + 10*UI_SCALE, '\u2600\uFE0F Day', { fontSize:Math.round(14*UI_SCALE)+'px', color:'#ffe9a8', fontStyle:'bold' }).setDepth(950)
      : null;

    this.bombGfxMap = {};
    this.bombPlacedMap = {};
    this.explosionVisualMap = {}; // key "row,col" (bomb origin) -> {gfx, createdAt}
    this.powerupGfxMap = {};
    this.gameOver = false;

    this.localKeys = makeLocalKeys(this);
    this.lastSentMove = null;
    this.sendTimer = 0;

    net.onState = data => this.applyState(data);
  }

  applyState(data){
    if (typeof data.elapsed === 'number') this.timerText.setText(formatMatchTime(data.elapsed));
    data.players.forEach((pd, i) => {
      const p = this.players[i];
      if (!p) return;
      const dr = pd.row - p.row, dc = pd.col - p.col;
      if (dr !== 0 || dc !== 0) setPlayerFacing(p, Math.sign(dr), Math.sign(dc));
      p.row = pd.row; p.col = pd.col;
      const x = pd.col*TILE + TILE/2, y = HUD_H + pd.row*TILE + TILE/2;
      // Slightly longer than STATE_INTERVAL (80ms) so a tween is still
      // finishing (and gets smoothly retargeted) when the next snapshot
      // arrives, rather than sitting idle waiting for it. Kept comfortably
      // above the send interval on purpose: this margin is what absorbs
      // real-world WebRTC jitter (the reliable/ordered channel means a
      // delayed packet holds up everything behind it, so snapshots can
      // arrive in bursts). A tighter margin (tried 40ms/50ms) looked
      // smoother in theory but was visibly worse in practice once that
      // jitter showed up.
      this.tweens.add({ targets: p.container, x, y, duration: 90 });
      if (!pd.alive && p.alive){ p.alive = false; p.cursed = false; p.curseRing.setVisible(false); p.shieldCount = 0; p.shieldRing.setVisible(false); p.body.setFillStyle(0x333333); p.container.setAlpha(0.55); p.label.setText(playerDisplayName(i)+' X'); }
      // A shield count that dropped (but the player is still alive) means a
      // shield just absorbed a hit — play the same flash/sound the host does.
      if (pd.alive && p.alive && (pd.shieldCount||0) < (p.shieldCount||0)){
        SFX.shieldBreak();
        this.tweens.add({ targets: p.body, alpha: 0.25, duration: 90, yoyo: true, repeat: 1 });
      }
      p.maxBombs = pd.maxBombs; p.blastRange = pd.blastRange; p.speed = pd.speed; p.cursed = pd.cursed;
      p.hasKick = !!pd.hasKick; p.shieldCount = pd.shieldCount||0;
      p.pierce = !!pd.pierce; p.hasDetonator = !!pd.hasDetonator; p.hasMine = !!pd.hasMine; p.mineArmed = !!pd.mineArmed;
      updateShieldRingVisual(p);
      const curseTag = pd.cursed ? ' \u{1F480}' : '';
      const kickTag = pd.hasKick ? ' \u{1F45F}' : '';
      const shieldTag = pd.shieldCount > 0 ? ` \u{1F6E1}${pd.shieldCount}` : '';
      const pierceTag = pd.pierce ? ' \u{1F4A5}' : '';
      const detonatorTag = pd.hasDetonator ? ' \u{1F4E1}' : '';
      const mineTag = pd.hasMine ? (pd.mineArmed ? ' \u{1F7E0}' : ' \u26AB') : '';
      const reconnectTag = pd.reconnecting ? ' \u23F3' : '';
      // data.pings is indexed by host slot (player index - 1); player 0 is
      // always the host itself, which has no connection to measure.
      const pingVal = (i > 0 && data.pings) ? data.pings[i-1] : null;
      const pingTag = (pingVal != null && !pd.reconnecting) ? ` ${pingQualityEmoji(pingVal)}${pingVal}ms` : '';
      this.hudTexts[i].setText(playerDisplayName(i)+': '+(pd.alive ? `bombs ${pd.maxBombs} / range ${pd.blastRange} / speed ${pd.speed}${curseTag}${kickTag}${shieldTag}${pierceTag}${detonatorTag}${mineTag}${reconnectTag}${pingTag}` : 'OUT'));
      this.hudTexts[i].setColor(pd.alive ? (pd.reconnecting ? '#f5b041' : (pd.cursed ? '#c39bd3' : '#eee')) : '#666');
      if (pd.alive) p.container.setAlpha(pd.reconnecting ? 0.55 : 1);
    });

    for (let r=0;r<ROWS;r++){
      for (let c=0;c<COLS;c++){
        if (this.blocksGridBool[r][c] && !data.blocksGrid[r][c]){
          if (this.blockRects[r][c]) this.blockRects[r][c].destroy();
          this.blockRects[r][c] = null;
          this.blocksGridBool[r][c] = false;
        }
      }
    }

    const bombKeys = new Set(data.bombs.map(b => b.row+','+b.col));
    for (const key in this.bombGfxMap){
      if (!bombKeys.has(key)){ this.bombGfxMap[key].destroy(); delete this.bombGfxMap[key]; delete this.bombPlacedMap[key]; }
    }
    data.bombs.forEach(b => {
      const key = b.row+','+b.col;
      if (!this.bombGfxMap[key]){
        SFX.bombPlaced();
        const x = b.col*TILE+TILE/2, y = HUD_H+b.row*TILE+TILE/2;
        this.bombGfxMap[key] = createBombVisual(this, x, y, b.remote, b.mine);
        // Client doesn't know the real placement time from the host, so it
        // approximates "now" as the fuse start; this is off by at most one
        // network round-trip, which isn't visually noticeable.
        this.bombPlacedMap[key] = this.time.now;
      }
    });

    const explosionKeys = new Set(data.explosions.map(e => e.row+','+e.col));
    for (const key in this.explosionVisualMap){
      if (!explosionKeys.has(key)){ this.explosionVisualMap[key].gfx.destroy(); delete this.explosionVisualMap[key]; }
    }
    data.explosions.forEach(e => {
      const key = e.row+','+e.col;
      if (!this.explosionVisualMap[key]){
        SFX.explosion();
        const x = e.col*TILE+TILE/2, y = HUD_H+e.row*TILE+TILE/2;
        const armLenPx = { up:e.up*TILE, down:e.down*TILE, left:e.left*TILE, right:e.right*TILE };
        this.explosionVisualMap[key] = { gfx: createExplosionCrossVisual(this, x, y, armLenPx), createdAt: this.time.now };
      }
    });

    const puKeys = new Set(data.powerups.map(p => p.row+','+p.col));
    for (const key in this.powerupGfxMap){
      if (!puKeys.has(key)){ SFX.powerup(); destroyPowerupVisual(this.powerupGfxMap[key]); delete this.powerupGfxMap[key]; }
    }
    data.powerups.forEach(p => {
      const key = p.row+','+p.col;
      if (!this.powerupGfxMap[key]){
        const x = p.col*TILE+TILE/2, y = HUD_H+p.row*TILE+TILE/2;
        this.powerupGfxMap[key] = createPowerupVisual(this, x, y, p.type);
      }
    });

    if (NET_SHRINKING_ARENA) updateArenaOverlay(this.arenaGfx, data.arena);
    if (NET_DAY_NIGHT_CYCLE){
      const wasNight = this.isNight;
      this.isNight = !!data.isNight;
      if (this.isNight !== wasNight) this.dayNightText.setText(this.isNight ? '\u{1F319} Night' : '\u2600\uFE0F Day');
    }

    if (data.over && !this.gameOver){
      this.gameOver = true;
      this.winText.setText(`Player ${data.over.winner+1} wins!`);
      if (data.over.winner === net.myIndex) SFX.win();
      else SFX.lose();
    } else if (!data.over && this.gameOver){
      this.gameOver = false;
      this.winText.setText('');
    }
  }

  update(time, delta){
    for (const p of this.players) updateCurseRingVisual(p, time);
    for (const key in this.bombGfxMap){
      updateBombVisual(this.bombGfxMap[key], this.bombPlacedMap[key], time);
    }
    for (const key in this.explosionVisualMap){
      const ev = this.explosionVisualMap[key];
      updateExplosionFlameVisual(ev.gfx, ev.createdAt, time);
    }
    if (NET_FOG_OF_WAR || (NET_DAY_NIGHT_CYCLE && this.isNight)) updateFogOverlay(this.fogGfx, this.players[net.myIndex]);
    else if (this.fogGfx) this.fogGfx.clear();
    const dir = readLocalDirection(this.localKeys);
    const bombPressed = localBombJustPressed(this.localKeys);
    const kickPressed = localKickJustPressed(this.localKeys);
    const detonatePressed = localDetonateJustPressed(this.localKeys);
    const minePressed = localMineJustPressed(this.localKeys);
    this.sendTimer += delta;

    const changed = !this.lastSentMove ||
      dir.up !== this.lastSentMove.up || dir.down !== this.lastSentMove.down ||
      dir.left !== this.lastSentMove.left || dir.right !== this.lastSentMove.right;

    if (changed || bombPressed || kickPressed || detonatePressed || minePressed || this.sendTimer > 250){
      net.sendInput({ up:dir.up, down:dir.down, left:dir.left, right:dir.right, bombPressed, kickPressed, detonatePressed, minePressed });
      this.lastSentMove = dir;
      this.sendTimer = 0;
    }
  }
}

// ====================== LOBBY WIRING ======================
setupTouchControls();

// Options are saved locally (map size + speed + sound on/off) so the choice
// survives a page reload without needing any server/account.
const SETTINGS_KEY = 'mazeBlasterSettings';
let SOUND_ENABLED = true;
// Empty string means "no custom name" — playerDisplayName() falls back to the
// default P1/P2/etc label in that case, so leaving this blank is intentional,
// not a bug.
let PLAYER_NAME = '';
function loadSettings(){
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && MAP_SIZES[saved.mapSize]){
      SELECTED_MAP_SIZE = saved.mapSize;
      const sel = document.getElementById('map-size');
      if (sel) sel.value = SELECTED_MAP_SIZE;
    }
    if (saved && SPEED_LEVELS[saved.gameSpeed]){
      SELECTED_SPEED = saved.gameSpeed;
      const spdSel = document.getElementById('game-speed');
      if (spdSel) spdSel.value = SELECTED_SPEED;
    }
    if (saved && typeof saved.soundEnabled === 'boolean'){
      SOUND_ENABLED = saved.soundEnabled;
      const sndSel = document.getElementById('sound-toggle');
      if (sndSel) sndSel.value = SOUND_ENABLED ? 'on' : 'off';
    }
    if (saved && typeof saved.playerName === 'string'){
      PLAYER_NAME = saved.playerName.trim().slice(0, 16);
      const nameInput = document.getElementById('player-name');
      if (nameInput) nameInput.value = PLAYER_NAME;
    }
  } catch (e) {
    // Corrupted JSON or storage blocked (private browsing, etc) — just
    // fall back to the defaults instead of breaking the lobby.
  }
  SFX.setEnabled(SOUND_ENABLED);
}
function saveSettings(){
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ mapSize: SELECTED_MAP_SIZE, gameSpeed: SELECTED_SPEED, soundEnabled: SOUND_ENABLED, playerName: PLAYER_NAME }));
  } catch (e) {
    // Storage full or unavailable — the choice just won't persist this time.
  }
}
loadSettings();

document.getElementById('btn-options').onclick = () => {
  document.getElementById('lobby-main').classList.add('hidden');
  document.getElementById('options-panel').classList.remove('hidden');
};
document.getElementById('btn-options-back').onclick = () => {
  document.getElementById('options-panel').classList.add('hidden');
  document.getElementById('lobby-main').classList.remove('hidden');
};
document.getElementById('map-size').onchange = e => {
  SELECTED_MAP_SIZE = e.target.value;
  saveSettings();
};
document.getElementById('game-speed').onchange = e => {
  SELECTED_SPEED = e.target.value;
  saveSettings();
};
document.getElementById('sound-toggle').onchange = e => {
  SOUND_ENABLED = e.target.value === 'on';
  SFX.setEnabled(SOUND_ENABLED);
  saveSettings();
};
document.getElementById('player-name').onchange = e => {
  PLAYER_NAME = e.target.value.trim().slice(0, 16);
  e.target.value = PLAYER_NAME;
  saveSettings();
};

function makeConfig(SceneClass){
  // Phaser 4 defaults roundPixels to false (it was true in v3). This game is a
  // flat-shaded tile grid with adjacent rectangles, so we restore the old
  // behavior explicitly to avoid sub-pixel seams between tiles.
  // Scale.FIT keeps the fixed logical resolution (COLS*TILE x ROWS*TILE+HUD_H)
  // but scales the canvas up or down via CSS to fill its container while
  // preserving aspect ratio, so the board looks right on a wide 16:9 laptop
  // screen and a narrow 20:9 phone screen alike.
  //
  // The board is natively sized close to 4K height (see TILE/HUD_H above:
  // on the default map size, COLS*TILE x ROWS*TILE+HUD_H = 2775x2155), so on
  // a 4K display the canvas renders close to 1:1 with no upscaling blur.
  // `resolution` here only needs to cover devicePixelRatio, for sharpness on
  // retina/high-DPI screens beyond that.
  return {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#111',
    scene: SceneClass,
    resolution: window.devicePixelRatio || 1,
    render: { roundPixels: true },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: COLS*TILE,
      height: ROWS*TILE + HUD_H,
    },
  };
}
function showGameUI(){
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game-wrap').classList.remove('hidden');
  document.getElementById('touch-controls').classList.remove('hidden');
  if (isTouchDevice()) document.getElementById('btn-fullscreen').classList.remove('hidden');
}
// Shows the seed for the match currently in progress, top-left of the game
// screen, as plain (copyable) HTML rather than canvas text — matches the
// lobby's seed control so it can be shared the same way once a match is live.
function updateGameSeedDisplay(seed){
  document.getElementById('game-seed-value').textContent = seed;
  document.getElementById('game-seed-display').classList.remove('hidden');
}
document.getElementById('game-seed-display').onclick = () => {
  const seed = document.getElementById('game-seed-value').textContent;
  if (!seed) return;
  navigator.clipboard.writeText(seed);
  const el = document.getElementById('game-seed-copied');
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 1200);
};
function isTouchDevice(){
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}
function isFullscreen(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}
function updateFullscreenBtn(){
  document.getElementById('btn-fullscreen').textContent = isFullscreen() ? '⤡' : '⛶';
}
function toggleFullscreen(){
  const el = document.documentElement;
  if (!isFullscreen()){
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el).catch(()=>{});
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document).catch(()=>{});
  }
}
document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', updateFullscreenBtn);
document.addEventListener('webkitfullscreenchange', updateFullscreenBtn);
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]));
}
function refreshPlayerList(){
  let html = `<div>${escapeHtml(playerDisplayName(0))} (you, host)</div>`;
  // Walk each of the 3 fixed host slots directly (rather than assuming the
  // first `connectedCount()` indices are the connected ones) since a slot in
  // the middle can go empty on disconnect while a later slot stays filled.
  for (let slot=0; slot<3; slot++){
    const claimed = net.conns[slot] || net.tokens[slot] !== null;
    if (!claimed) continue; // nobody has ever occupied this slot
    const idx = slot + 1;
    const name = escapeHtml(playerDisplayName(idx));
    if (net.conns[slot]){
      html += `<div>${name} connected</div>`;
    } else if (net.reconnectDeadline[slot] && Date.now() < net.reconnectDeadline[slot]){
      html += `<div style="color:#f5b041">${name} disconnected — waiting to reconnect…</div>`;
    } else {
      html += `<div style="color:#888">${name} left the game</div>`;
    }
  }
  document.getElementById('player-list').innerHTML = html;
}

// While the lobby is showing (room created, match not started yet), the only
// events that trigger a refresh are join/reconnect/name-update — a slot's
// grace period silently expiring wouldn't otherwise flip the "waiting to
// reconnect" text over to "left the game". Poll while the lobby is visible so
// that transition still shows up without needing its own dedicated event.
let lobbyPollTimer = null;
function startLobbyPoll(){
  stopLobbyPoll();
  lobbyPollTimer = setInterval(refreshPlayerList, 1000);
}
function stopLobbyPoll(){
  if (lobbyPollTimer){ clearInterval(lobbyPollTimer); lobbyPollTimer = null; }
}

// ====================== QR JOIN ======================
// Hosted URL for this game. The QR code encodes this page's address with the
// room code attached as a query param, so scanning it on another device
// opens the game and joins the room automatically (no typing the code in).
const SITE_URL = 'https://alfamirio.github.io/maze-blaster/';

function buildJoinUrl(roomId){
  return `${SITE_URL}?room=${encodeURIComponent(roomId)}`;
}

function showJoinQR(roomId){
  const qrEl = document.getElementById('qr-code');
  qrEl.innerHTML = ''; // clear any previous code before drawing a new one
  new QRCode(qrEl, {
    text: buildJoinUrl(roomId),
    width: 180,
    height: 180,
    colorDark: '#0e1013',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
  qrEl.classList.remove('hidden');
  document.getElementById('qr-hint').classList.remove('hidden');
}

// Shared by the Join mode and by auto-join-via-URL below.
function attemptJoin(code){
  code = (code || '').trim();
  if (!code) return;
  document.getElementById('lobby-msg').textContent = 'Connecting...';
  net.joinGame(
    code,
    () => {
      document.getElementById('lobby-main').classList.add('hidden');
      document.getElementById('lobby-status').classList.remove('hidden');
      document.getElementById('lobby-msg').textContent = 'Connected! Waiting for host to start...';
    },
    err => { document.getElementById('lobby-msg').textContent = 'Connection failed: ' + (err.message || err); }
  );
}

// If this page was opened from a scanned QR code (or any shared join link),
// the room code arrives as ?room=CODE — join it automatically instead of
// making the player type it in.
function tryAutoJoinFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (!room) return;
  setLobbyMode('join');
  document.getElementById('join-code').value = room;
  attemptJoin(room);
  // Strip the param so a manual refresh/restart doesn't try to rejoin the
  // same (possibly stale) room automatically.
  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, cleanUrl);
}

// Starts a local, unrecorded-to-network, bots-allowed match with whichever
// scenario is currently selected in the map picker.
function startSoloGame(scenarioId){
  SELECTED_SCENARIO = SCENARIOS[scenarioId] ? scenarioId : 'standard';
  const botCount = parseInt(document.getElementById('bot-count').value, 10) || 0;
  NET_BOT_COUNT = Math.min(botCount, 3);
  NET_NUM_PLAYERS = 1 + NET_BOT_COUNT;
  NET_IS_SOLO = true;
  MATCH_SEED_CONSUMED = false;
  // Bots always keep their default P2/P3/... labels; only the local human
  // player (index 0) gets the custom name from Options, if any was set.
  net.names = [PLAYER_NAME || null, null, null, null];
  applyMapSize(SELECTED_MAP_SIZE);
  applySpeedSetting(SELECTED_SPEED);
  showGameUI();
  document.getElementById('btn-export').classList.remove('hidden');
  currentGame = new Phaser.Game(makeConfig(HostScene));
}

// ---- Map picker: single-select cards, always visible in the lobby ----
function renderScenarioList(){
  const list = document.getElementById('scenario-list');
  list.innerHTML = '';
  Object.keys(SCENARIOS).forEach(id => {
    const s = SCENARIOS[id];
    const card = document.createElement('div');
    card.className = 'map-card' + (id === SELECTED_SCENARIO ? ' selected' : '');
    const title = document.createElement('div');
    title.className = 'map-card-title';
    title.textContent = s.label;
    const hint = document.createElement('div');
    hint.className = 'map-card-hint';
    hint.textContent = s.desc.split('.')[0] + '.'; // short version in the card itself
    card.append(title, hint);
    card.onclick = () => {
      SELECTED_SCENARIO = id;
      list.querySelectorAll('.map-card').forEach(el => el.classList.remove('selected'));
      card.classList.add('selected');
      document.getElementById('map-desc').textContent = s.desc;
      regenerateMapSeed();
      renderMapParams();
    };
    list.appendChild(card);
  });
  document.getElementById('map-desc').textContent = (SCENARIOS[SELECTED_SCENARIO] || SCENARIOS.standard).desc;
}
renderScenarioList();

// ---- Map parameters panel: readonly summary for every built-in map, or an
// editable form for the 'custom' map (which live-writes into SCENARIOS.custom
// so starting a game just reads it like any other scenario). ----
function renderMapParams(){
  const s = SCENARIOS[SELECTED_SCENARIO] || SCENARIOS.standard;
  const readonly = document.getElementById('map-params-readonly');
  const custom = document.getElementById('map-params-custom');
  if (s.isCustom){
    readonly.classList.add('hidden');
    custom.classList.remove('hidden');
    return;
  }
  custom.classList.add('hidden');
  readonly.classList.remove('hidden');
  readonly.innerHTML = '';
  const rows = [
    ['Pillars', s.pillars ? 'Yes' : 'No'],
    ['Crate density', Math.round(s.blockFillChance*100) + '%'],
    ['Power-up chance', Math.round(s.powerupSpawnChance*100) + '%'],
  ];
  if (s.teleporterPairs) rows.push(['Teleporter pairs', String(s.teleporterPairs)]);
  if (s.fuseMult && s.fuseMult !== 1) rows.push(['Fuse speed', s.fuseMult + '\u00D7']);
  if (s.extraBlastRange) rows.push(['Extra blast range', '+' + s.extraBlastRange]);
  rows.push(['Fog of War', s.fogOfWar ? 'Yes' : 'No']);
  rows.push(['Shrinking Arena', s.shrinkingArena ? 'Yes' : 'No']);
  rows.push(['Day/Night Cycle', s.dayNightCycle ? 'Yes' : 'No']);
  rows.forEach(([label, val]) => {
    const row = document.createElement('div');
    row.className = 'map-param-row';
    const l = document.createElement('span'); l.textContent = label;
    const v = document.createElement('span'); v.textContent = val;
    row.append(l, v);
    readonly.appendChild(row);
  });
}

// Writes the current form values into SCENARIOS.custom, which is exactly
// what startSoloGame/doHostGame read from once 'custom' is the selected
// scenario — no separate storage or start-time translation needed.
function applyCustomParamsFromForm(){
  const c = SCENARIOS.custom;
  c.pillars = document.getElementById('cp-pillars').checked;
  c.blockFillChance = Math.min(1, Math.max(0, parseFloat(document.getElementById('cp-blockfill').value)));
  if (isNaN(c.blockFillChance)) c.blockFillChance = 0.7;
  c.powerupSpawnChance = Math.min(1, Math.max(0, parseFloat(document.getElementById('cp-powerup').value)));
  if (isNaN(c.powerupSpawnChance)) c.powerupSpawnChance = 0.35;
  c.teleporterPairs = Math.max(0, parseInt(document.getElementById('cp-teleporters').value, 10) || 0);
  c.fuseMult = parseFloat(document.getElementById('cp-fusemult').value);
  if (isNaN(c.fuseMult) || c.fuseMult <= 0) c.fuseMult = 1;
  c.extraBlastRange = Math.max(0, parseInt(document.getElementById('cp-blastrange').value, 10) || 0);
  c.fogOfWar = document.getElementById('cp-fog').checked;
  c.shrinkingArena = document.getElementById('cp-shrink').checked;
  c.dayNightCycle = document.getElementById('cp-daynight').checked;
  if (SELECTED_SCENARIO === 'custom') regenerateMapSeed();
}
['cp-pillars','cp-blockfill','cp-powerup','cp-teleporters','cp-fusemult','cp-blastrange','cp-fog','cp-shrink','cp-daynight']
  .forEach(id => document.getElementById(id).addEventListener('change', applyCustomParamsFromForm));
applyCustomParamsFromForm(); // seed SCENARIOS.custom from the form's own default values
renderMapParams();


// The seed shown here reproduces this exact crate/teleporter layout (for
// the same scenario, map size, and player count) — copy it to share a map,
// or open ?seed=CODE to load one someone else shared.
function regenerateMapSeed(){
  MAP_SEED = randomSeedString();
  document.getElementById('map-seed-value').textContent = MAP_SEED;
}
function applyMapSeedFromUrl(){
  const params = new URLSearchParams(window.location.search);
  const seed = params.get('seed');
  if (!seed) return;
  MAP_SEED = seed.trim().slice(0, 24).toUpperCase();
  document.getElementById('map-seed-value').textContent = MAP_SEED;
}
document.getElementById('map-seed-value').textContent = MAP_SEED;
applyMapSeedFromUrl();
document.getElementById('btn-reroll-seed').onclick = regenerateMapSeed;
document.getElementById('map-seed-value').onclick = () => {
  navigator.clipboard.writeText(MAP_SEED);
  const el = document.getElementById('map-seed-copied');
  el.classList.remove('hidden');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.add('hidden'), 1200);
};

// Lets a player load a seed someone shared with them (typed or pasted),
// picking up the same MAP_SEED that ?seed=CODE in the URL would set.
function applyCustomSeed(){
  const input = document.getElementById('map-seed-input');
  const val = input.value.trim();
  if (!val) return;
  MAP_SEED = val.slice(0, 24).toUpperCase();
  document.getElementById('map-seed-value').textContent = MAP_SEED;
  input.value = '';
}
document.getElementById('btn-apply-seed').onclick = applyCustomSeed;
document.getElementById('map-seed-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') applyCustomSeed();
});

// ---- Mode picker: Solo / Host / Join, each revealing its own small extra
// control, all sharing one CTA button at the bottom ----
let LOBBY_MODE = 'solo';
const PLAY_LABELS = { solo: 'Play solo', host: 'Host game', join: 'Join game' };
function setLobbyMode(mode){
  if (LOBBY_MODE === 'host' && mode !== 'host') resetHostPanel();
  LOBBY_MODE = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('mode-extra-solo').classList.toggle('hidden', mode !== 'solo');
  document.getElementById('mode-extra-join').classList.toggle('hidden', mode !== 'join');
  document.getElementById('btn-play').textContent = PLAY_LABELS[mode];
}
// Clears the room-code/QR/player-list panel and brings back the Host game
// button, so leaving Host mode doesn't leave stale info sitting there.
// Also tears down the actual hosted PeerJS room (if one was ever created),
// rather than leaving it running silently in the background.
function resetHostPanel(){
  document.getElementById('host-panel').classList.add('hidden');
  document.getElementById('room-code-display').textContent = '';
  document.getElementById('qr-code').innerHTML = '';
  document.getElementById('qr-code').classList.add('hidden');
  document.getElementById('qr-hint').classList.add('hidden');
  document.getElementById('btn-copy').classList.add('hidden');
  document.getElementById('btn-start').classList.add('hidden');
  document.getElementById('player-list').innerHTML = '';
  document.getElementById('host-msg').textContent = '';
  document.getElementById('btn-play').classList.remove('hidden');
  stopLobbyPoll();
  if (net.isHost){
    if (net._pingIntervalId){ clearInterval(net._pingIntervalId); net._pingIntervalId = null; }
    if (net.peer && !net.peer.destroyed) net.peer.destroy();
    net.isHost = false;
  }
}
document.querySelectorAll('.mode-btn').forEach(b => b.onclick = () => setLobbyMode(b.dataset.mode));
setLobbyMode('solo');

function doHostGame(){
  NET_BOT_COUNT = 0; // bots are solo-only; hosting is always real players
  NET_IS_SOLO = false;
  // SELECTED_SCENARIO stays whatever was picked in the map section — the
  // host generates the board and broadcasts it (pillars flag, crate grid,
  // teleporter layout) so ClientScene mirrors it instead of guessing.
  document.getElementById('host-msg').textContent = 'Creating room...';
  net.hostGame(
    id => {
      // Fill in the mode-spacer (previously just empty flex space below the
      // mode toggle) with the room-code/QR panel — the map picker, seed
      // controls, options gear, and mode toggle all stay visible exactly as
      // they were, since we're not hiding or navigating away from anything.
      document.getElementById('host-panel').classList.remove('hidden');
      document.getElementById('room-code-display').textContent = id;
      document.getElementById('btn-copy').classList.remove('hidden');
      document.getElementById('btn-start').classList.remove('hidden');
      document.getElementById('host-msg').textContent = '';
      // Room's already created — hide Play so a stray click doesn't spin
      // up a second one.
      document.getElementById('btn-play').classList.add('hidden');
      showJoinQR(id);
      refreshPlayerList();
      startLobbyPoll();
    },
    err => { document.getElementById('host-msg').textContent = 'Error: ' + (err.message || err); }
  );
  net.onPlayerJoined = () => { NET_NUM_PLAYERS = net.connectedCount() + 1; refreshPlayerList(); };
  net.onNameUpdate = () => refreshPlayerList();
  // These previously weren't wired up at all during the lobby, so a player
  // who dropped before the host hit Start just silently vanished from the
  // list instead of showing as disconnected/reconnecting.
  net.onDisconnect = () => refreshPlayerList();
  net.onReconnect = () => refreshPlayerList();
}

document.getElementById('btn-play').onclick = () => {
  if (LOBBY_MODE === 'solo') startSoloGame(SELECTED_SCENARIO);
  else if (LOBBY_MODE === 'host') doHostGame();
  else attemptJoin(document.getElementById('join-code').value);
};

document.getElementById('btn-copy').onclick = () => {
  navigator.clipboard.writeText(document.getElementById('room-code-display').textContent);
  document.getElementById('host-msg').textContent = 'Copied!';
};

document.getElementById('btn-start').onclick = () => {
  stopLobbyPoll(); // HostScene takes over net.onDisconnect/onReconnect from here
  MATCH_SEED_CONSUMED = false;
  applyMapSize(SELECTED_MAP_SIZE);
  applySpeedSetting(SELECTED_SPEED);
  showGameUI();
  currentGame = new Phaser.Game(makeConfig(HostScene));
};

net.onStart = data => {
  NET_NUM_PLAYERS = data.numPlayers;
  NET_BLOCKS_GRID = data.blocksGrid;
  NET_PILLARS = data.pillars !== false;
  NET_TELEPORTERS = data.teleporters || [];
  NET_FOG_OF_WAR = !!data.fogOfWar;
  NET_SHRINKING_ARENA = !!data.shrinkingArena;
  NET_DAY_NIGHT_CYCLE = !!data.dayNightCycle;
  COLS = data.cols; ROWS = data.rows; SPAWNS = buildSpawns();
  applySpeedSetting(data.speed);
  showGameUI();
  if (data.seed) updateGameSeedDisplay(data.seed);
  // The host sends a fresh 'start' message both for the very first match AND
  // for every subsequent restart (R re-runs HostScene.create(), which calls
  // net.broadcastStart(...) again). Previously this always spun up a brand
  // new Phaser.Game on top of whatever was already running, so on restart
  // the client ended up with a stale, undestroyed game instance still
  // showing the old map while a new one rendered underneath it. Destroy any
  // existing instance first so the client always ends up with exactly one
  // live game, in sync with the host's new map.
  if (currentGame){ currentGame.destroy(true); currentGame = null; }
  currentGame = new Phaser.Game(makeConfig(ClientScene));
};

// If our connection to the host drops mid-match (e.g. a brief wifi blip),
// NetManager quietly retries in the background using the same reconnect
// token so the host seats us back in our old slot. Surface that as a small
// banner rather than a fatal error, since the running ClientScene itself
// needs no changes — it just resumes rendering as soon as state messages
// start arriving again.
net.onHostLost = (result) => {
  const banner = document.getElementById('reconnect-banner');
  if (result === 'failed'){
    banner.textContent = '⚠️ Could not reconnect to host — please refresh to try again.';
    banner.classList.remove('hidden');
  } else {
    banner.textContent = '⚠️ Connection to host lost — reconnecting…';
    banner.classList.remove('hidden');
  }
};
net.onHostRestored = () => {
  document.getElementById('reconnect-banner').classList.add('hidden');
};

tryAutoJoinFromUrl();

document.getElementById('btn-export').onclick = () => {
  if (activeHostScene && activeHostScene.recording) activeHostScene.exportRecording();
};

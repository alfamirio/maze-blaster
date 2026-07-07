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

// ====================== POWER-UP DROP WEIGHTS ======================
// Relative chance that a destroyed crate drops each power-up type. Shares
// must sum to 1 — pickPowerupType() walks them in this same insertion
// order to build the cumulative thresholds each time it rolls.
const POWERUP_WEIGHTS = {
  bomb:      0.15,
  flame:     0.15,
  speed:     0.12,
  kick:      0.12,
  heart:     0.12,
  pierce:    0.12,
  detonator: 0.10,
  mine:      0.05,
  curse:     0.07
};
function pickPowerupType(){
  const roll = Math.random();
  let cumulative = 0;
  for (const type in POWERUP_WEIGHTS){
    cumulative += POWERUP_WEIGHTS[type];
    if (roll < cumulative) return type;
  }
  // Floating-point safety net in case the weights don't sum to exactly 1.
  const types = Object.keys(POWERUP_WEIGHTS);
  return types[types.length - 1];
}


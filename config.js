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
// buffer via Phaser's `resolution` config, which is now pinned to 1 — see
// makeConfig() in lobby.js). TILE is chosen so that on the default map
// size, ROWS*TILE+HUD_H comfortably fits within a 1080p-class screen
// (1920x1080 laptop, or a 1080-wide phone) without the canvas backing
// buffer being larger than the display can actually show.
const TILE = 86;
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
// Expressed as a multiple of TILE/48 (the same ratio UI_SCALE uses) rather
// than a flat pixel value, so it shrinks/grows along with TILE instead of
// eating a disproportionate chunk of a smaller board (at the old TILE=185
// this formula still lands on the same ~120px as before).
const HUD_H = 56;
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
  standard:        { label:'Standard',        desc:'The classic maze — indestructible pillars plus destructible crates.', pillars:true,  blockFillChance:0.66,  powerupSpawnChance:0.33 },
  custom:          { label:'Custom',          desc:'Fully custom map — tweak all.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, teleporterPairs:0, fuseMult:1, extraBlastRange:0, fogOfWar:false, shrinkingArena:false, dayNightCycle:false, isCustom:true },  
  open_arena:      { label:'Open Arena',      desc:'No pillars — just the border and crates. Fast, open, and chaotic.',    pillars:false, blockFillChance:0.66,  powerupSpawnChance:0.33 },
  sudden_death:    { label:'Sudden Death',    desc:'Bombs fuse in half the time and everyone starts with a bigger blast.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, fuseMult:0.5, extraBlastRange:1 },  
  crate_rush:      { label:'Crate Rush',      desc:'A much denser crate maze — more to clear, more power-ups to find.',    pillars:true,  blockFillChance:0.90, powerupSpawnChance:0.33 },
  minimalist:      { label:'Minimalist',      desc:'No pillars and hardly any crates.', pillars:false, blockFillChance:0.20, powerupSpawnChance:0.33 },  
  teleporters:     { label:'Teleporters',     desc:'A few glowing portal pairs are scattered on the maze.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, teleporterPairs:1 },
  portal_chaos:    { label:'Portal Chaos',    desc:'No pillars and many portal pairs flood the open maze.',  pillars:false, blockFillChance:0.20,  powerupSpawnChance:0.33, teleporterPairs:3 },
  fog_of_war:      { label:'Fog of War',      desc:'Classic maze, but you can only see a radius around your own player.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, fogOfWar:true },
  day_night_cycle: { label:'Day/Night Cycle', desc:'The map alternates between normal and a fog-of-war.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, dayNightCycle:true },
  shrinking_arena: { label:'Shrinking Arena', desc:'Battle-royale style, the playable area shrinks.', pillars:true, blockFillChance:0.66, powerupSpawnChance:0.33, shrinkingArena:true },
  powerup_frenzy:  { label:'Power-up Frenzy', desc:'Minimalist maze, but battle-royale style.',     pillars:false,  blockFillChance:0.20,  powerupSpawnChance:0.90, shrinkingArena:true },
};
let SELECTED_SCENARIO = 'standard'; // set by the map picker, applied when a Solo game starts

// ---- Visual scenery themes ---------------------------------------------
// A theme is purely cosmetic — it swaps the palette (and speckle/particle
// style) that drawFloorTile/drawWallBlock/drawBlock in board.js paint the
// floor, walls, and crates with. It never touches board *shape* (that's
// still SCENARIOS/pillars/etc.), so any theme works with any scenario.
// 'speckle' selects which little decorative mark scatters across each
// floor tile (see drawSpeckleMark in board.js) so each theme reads as a
// distinct kind of ground, not just a recolored copy of the grass tile.
const THEMES = {
  default: {
    label: 'Grassland',
    speckle: 'dot',
    floor:  { even:0x2f6b2f, odd:0x276227, light:[0x3d7d3d,0x347334], dark:[0x255525,0x1f4a1f] },
    wall:   { base:0x656b76, light:0x9aa1ac, dark:0x35383e, inner:0x5a5f69, stroke:0x24262b, seam:0x484c54 },
    crate:  { body:0x8a5a2e, bevelLight:0xb07a3e, bevelDark:0x5c3b1e, inner:0x8a5a2e, stroke:0x5c3b1e, crack:0x4a2f18 },
  },
  desert: {
    label: 'Desert',
    speckle: 'grain',
    floor:  { even:0xcda06a, odd:0xc0925a, light:[0xe0bd8a,0xd4ae78], dark:[0xa9814f,0x9c7444] },
    wall:   { base:0xb08a55, light:0xd9b884, dark:0x6e5330, inner:0x9c7746, stroke:0x4d3a20, seam:0x8a6a3e },
    crate:  { body:0xc9a15b, bevelLight:0xe6c485, bevelDark:0x8a6a35, inner:0xc9a15b, stroke:0x6e5320, crack:0x5c4620 },
  },
  snow: {
    label: 'Snow',
    speckle: 'fleck',
    floor:  { even:0xdce8f0, odd:0xcedbe6, light:[0xf5fbff,0xe9f3fa], dark:[0xb7c9d6,0xa8bcca] },
    wall:   { base:0x9fb4c2, light:0xe6f3fa, dark:0x536878, inner:0x8398a8, stroke:0x33434e, seam:0x6f8898 },
    crate:  { body:0xa9c6d6, bevelLight:0xd6ecf5, bevelDark:0x5f7a89, inner:0xa9c6d6, stroke:0x415662, crack:0x3d5560 },
  },
  jungle: {
    label: 'Jungle',
    speckle: 'vine',
    floor:  { even:0x1f5c33, odd:0x184e2a, light:[0x2c7a44,0x226637], dark:[0x123d21,0x0d331a] },
    wall:   { base:0x5c6b52, light:0x8a9e78, dark:0x2f3a29, inner:0x4d5b45, stroke:0x1f271c, seam:0x445140 },
    crate:  { body:0x5e4326, bevelLight:0x7d5c34, bevelDark:0x3a2916, inner:0x5e4326, stroke:0x2c1f10, crack:0x241a0c },
  },
  lava: {
    label: 'Lava',
    speckle: 'ember',
    floor:  { even:0x2a1614, odd:0x24110f, light:[0xe8622a,0xd94f1c], dark:[0x140a09,0x0f0706] },
    wall:   { base:0x3a2422, light:0x6b3a28, dark:0x1a0f0e, inner:0x2e1c1a, stroke:0x120a09, seam:0xc0431f },
    crate:  { body:0x4a2a1c, bevelLight:0x8a4a26, bevelDark:0x241209, inner:0x4a2a1c, stroke:0x180d06, crack:0xe8622a },
  },
  space_station: {
    label: 'Space Station',
    speckle: 'rivet',
    floor:  { even:0x1b2530, odd:0x161e27, light:[0x3a4d5e,0x33445a], dark:[0x0e141b,0x0a0f14] },
    wall:   { base:0x7a8896, light:0xc3d1dc, dark:0x3f4a54, inner:0x66727d, stroke:0x252b31, seam:0x8fa0ac },
    crate:  { body:0x5a6570, bevelLight:0x8a99a6, bevelDark:0x333d47, inner:0x5a6570, stroke:0x262c33, crack:0xffcc00 },
  },
  candy_land: {
    label: 'Candy Land',
    speckle: 'swirl',
    floor:  { even:0xffd0e6, odd:0xc8f2df, light:[0xffe8f2,0xe0faf0], dark:[0xe6a8c8,0x9fd9c0] },
    wall:   { base:0xe74c6f, light:0xffe0e8, dark:0x9c1f3f, inner:0xd23a5c, stroke:0x7a1530, seam:0xffffff },
    crate:  { body:0x9b59d0, bevelLight:0xd9b3f5, bevelDark:0x5e2f80, inner:0x9b59d0, stroke:0x4a2266, crack:0xffe066 },
  },
  swamp: {
    label: 'Swamp',
    speckle: 'bubble',
    floor:  { even:0x3a3f24, odd:0x2f331d, light:[0x565c33,0x484d2b], dark:[0x222514,0x1b1d10] },
    wall:   { base:0x4a4530, light:0x726a44, dark:0x2a2618, inner:0x3e3a24, stroke:0x1c1a10, seam:0x5c5636 },
    crate:  { body:0x4f3d22, bevelLight:0x6f5936, bevelDark:0x2c2113, inner:0x4f3d22, stroke:0x241b0f, crack:0x6b8f3f },
  },
  cave: {
    label: 'Cave',
    speckle: 'crystal',
    floor:  { even:0x141416, odd:0x101012, light:[0x2c2e33,0x26282c], dark:[0x08080a,0x060607] },
    wall:   { base:0x3a3a3e, light:0x5c5c62, dark:0x1c1c1f, inner:0x2e2e32, stroke:0x101012, seam:0x4a4a50 },
    crate:  { body:0x35363c, bevelLight:0x53555e, bevelDark:0x1e1f23, inner:0x35363c, stroke:0x141416, crack:0x4fd3ff },
  },
  cyber: {
    label: 'Cyber',
    speckle: 'spark',
    floor:  { even:0x0b0e17, odd:0x080a12, light:[0x1c2a4a,0x162238], dark:[0x05060a,0x040508] },
    wall:   { base:0x1a1f2e, light:0x6be0ff, dark:0x0c0f18, inner:0x232a3d, stroke:0x080a10, seam:0xb066ff },
    crate:  { body:0x232838, bevelLight:0x4fd3ff, bevelDark:0x11141d, inner:0x232838, stroke:0x0a0c12, crack:0xff4fd3 },
  },
  graveyard: {
    label: 'Graveyard',
    speckle: 'bone',
    floor:  { even:0x352f3a, odd:0x2c2732, light:[0x4d4655,0x413a48], dark:[0x1e1a22,0x18151c] },
    wall:   { base:0x5a5860, light:0x8a8790, dark:0x2e2c32, inner:0x4a484e, stroke:0x1a191d, seam:0x6e6c74 },
    crate:  { body:0x3d2e35, bevelLight:0x5c4650, bevelDark:0x211920, inner:0x3d2e35, stroke:0x160f14, crack:0x2a1e24 },
  },
  factory: {
    label: 'Factory',
    speckle: 'gear',
    floor:  { even:0x3a3d42, odd:0x33363b, light:[0x4f5359,0x484c52], dark:[0x24262a,0x1e2023] },
    wall:   { base:0x6b6f76, light:0xa8adb5, dark:0x35383d, inner:0x5a5e65, stroke:0x1f2124, seam:0xf1c40f },
    crate:  { body:0x6a6047, bevelLight:0x9a8f68, bevelDark:0x3a3424, inner:0x6a6047, stroke:0x2a2519, crack:0xf1c40f },
  },
  alien: {
    label: 'Alien',
    speckle: 'ooze',
    floor:  { even:0x1a0f2e, odd:0x150c26, light:[0x3a1f5c,0x2f1a4d], dark:[0x0d0718,0x0a0513] },
    wall:   { base:0x3d2a5c, light:0x7a4fd9, dark:0x1f1533, inner:0x4a3470, stroke:0x120c1f, seam:0x39ff8f },
    crate:  { body:0x2e4a2a, bevelLight:0x4a7a3f, bevelDark:0x1a2b18, inner:0x2e4a2a, stroke:0x0f1a0d, crack:0x39ff8f },
  },
  underwater: {
    label: 'Underwater',
    speckle: 'wave',
    floor:  { even:0x0d3b4f, odd:0x0a3242, light:[0x1a5a75,0x154d64], dark:[0x062430,0x051d27] },
    wall:   { base:0x1e5f78, light:0x4fb8d9, dark:0x0e2e3a, inner:0x1a4f63, stroke:0x081b22, seam:0x7fe0ff },
    crate:  { body:0x2a5a4a, bevelLight:0x4a8a70, bevelDark:0x163a2e, inner:0x2a5a4a, stroke:0x0e2019, crack:0xff7f50 },
  },
  temple: {
    label: 'Temple',
    speckle: 'glyph',
    floor:  { even:0x4a3a24, odd:0x3f301d, light:[0x6b5636,0x5c4a2e], dark:[0x2e2314,0x261c10] },
    wall:   { base:0x8a7248, light:0xc9a862, dark:0x4a3c22, inner:0x7a6440, stroke:0x2a2110, seam:0xe0c060 },
    crate:  { body:0x6b4a2a, bevelLight:0x9a7038, bevelDark:0x3e2916, inner:0x6b4a2a, stroke:0x241a0e, crack:0xe0c060 },
  },
  island: {
    label: 'Island',
    speckle: 'shell',
    floor:  { even:0xe8d4a0, odd:0xdcc68e, light:[0xf5e8c0,0xece0ae], dark:[0xc9ae74,0xbca066] },
    wall:   { base:0xd9b877, light:0xf0dca0, dark:0x8a6f3e, inner:0xc4a468, stroke:0x5c4826, seam:0x4fc9e8 },
    crate:  { body:0x7a5a3a, bevelLight:0xa3805a, bevelDark:0x4a331d, inner:0x7a5a3a, stroke:0x2e2010, crack:0x2e2010 },
  },
};
// Insertion order above also drives the lobby's theme dropdown option order.
const THEME_ORDER = Object.keys(THEMES);
// 'random' is a sentinel meaning "resolve to a random real theme when the
// match starts" — it's never itself a key into THEMES.
let SELECTED_THEME = 'random'; // set by the lobby's Theme dropdown
// The theme actually in effect for the current match. Only the host ever
// *picks* this (resolving 'random' via applyTheme); clients just receive
// whatever key the host broadcasts and store it here directly so every
// viewer's board.js draw calls agree, the same way NET_PILLARS etc. work.
let ACTIVE_THEME = 'default';
// Resolves SELECTED_THEME (which may be 'random') to a concrete THEMES key,
// stores it in ACTIVE_THEME, and returns it so the host can broadcast the
// resolved value to clients (see buildStaticBoard's callers in
// host-scene.js / client-scene.js).
function applyTheme(key){
  const resolved = (key === 'random')
    ? THEME_ORDER[Math.floor(Math.random() * THEME_ORDER.length)]
    : (THEMES[key] ? key : 'default');
  ACTIVE_THEME = resolved;
  return resolved;
}

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

const BASE_MOVE_INTERVAL = 120;
// Each "speed" power-up shaves this many ms off a player's own move interval,
// down to a hard floor so movement never becomes unreadable or breaks the
// fixed-step netcode assumptions elsewhere (bomb timers, tween durations).
const BASE_SPEED_STEP_MS = 16;
const BASE_MIN_MOVE_INTERVAL = 60;
// Curse power-up: picking one up applies a random temporary debuff instead of
// a permanent stat. Kept separate from the permanent stats (speed, bombs,
// range) so it always expires on its own timer regardless of what else the
// player has collected.
const BASE_CURSE_DURATION = 8000;
const CURSE_SLOW_MULT = 2.0;      // move interval multiplier while 'slow' (unaffected by game speed)
const BASE_CURSE_AUTOBOMB_EVERY = 600; // ms between forced bomb attempts while 'autobomb'
const CURSE_TYPES = ['reverse', 'slow', 'autobomb'];
const BASE_BOMB_FUSE = 1500;
const BASE_FLAME_TIME = 300;
const STATE_INTERVAL = 80; // ms between host -> client snapshots (~12Hz) — not scaled, it's a network rate, not gameplay pace

// Kick power-up: a kicked/punched bomb slides one tile every BOMB_SLIDE_MS
// until it hits a wall, a block, another bomb, or a player, matching the
// pace of the game's overall speed setting like everything else.
const BASE_BOMB_SLIDE_MS = 90;
let BOMB_SLIDE_MS = BASE_BOMB_SLIDE_MS;
// Proximity Mine power-up: how long after being placed before it can be
// tripped (gives the placer a beat to step off it first), how close another
// player has to wander (Manhattan distance, 0 = same tile only) to set it
// off, and a safety-fuse fallback so an untouched mine doesn't just sit on
// the field forever.
const MINE_ARM_DELAY = 1000;
const MINE_TRIGGER_RADIUS = 1;
const MINE_FUSE_MS = 30000;
// Heart/Shield power-up: stacks up to this many absorbed hits.
const MAX_SHIELD = 3;
// A fresh player's starting bomb blast range (in tiles, per direction)
// before any Flame power-ups are picked up (each Flame adds +1 — see
// checkPowerupPickup in host-scene.js).
const INITIAL_BLAST_RANGE = 1;
// The rest of a fresh player's starting loadout, before any power-ups are
// picked up. Numeric stats grow via power-ups (each Bomb power-up adds +1
// maxBombs, each Speed power-up adds +1 speed, each Heart adds +1
// shieldCount up to MAX_SHIELD); the boolean abilities are permanently
// off until their matching power-up is collected once. Extracted here so
// starting balance (e.g. for a "everyone starts faster" variant) can be
// tuned in one place instead of hunting through the player object literal.
const INITIAL_MAX_BOMBS = 1;
const INITIAL_SPEED = 0;
const INITIAL_SHIELD_COUNT = 0;
const INITIAL_HAS_KICK = false;
const INITIAL_PIERCE = false;
const INITIAL_HAS_DETONATOR = false;
const INITIAL_HAS_MINE = false;
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
// How long a player can stand outside the current safe zone before the
// arena actually starts hurting them. Gives a beat to scramble back in
// rather than being punished the instant a shrink catches them out — a
// pulsing ring + on-screen countdown (see updateArenaWarningVisual in
// board.js) warns them the whole time this is ticking down.
const ARENA_GRACE_MS = 5000;

// Day/Night Cycle scenario: alternates between a normal "day" phase (no fog)
// and a "night" phase (same fog-of-war visuals as the Fog of War scenario)
// every DAY_NIGHT_PHASE_MS, starting with day. The host is authoritative for
// which phase it currently is (broadcast each tick as data.isNight) so every
// viewer's screen switches at the same moment, even though — like regular
// Fog of War — each viewer's fog is still centered on their own player.
const DAY_NIGHT_PHASE_MS = 8000;

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

// ====================== NETWORKING TIMING ======================
// Host-authoritative connection handling. Kept here alongside the other
// tunable constants rather than buried inside NetManager, so reconnect
// behavior can be tweaked in one place.
// How long a dropped player's slot stays reserved, waiting for them to
// reconnect with the same token, before the slot is treated as abandoned.
const RECONNECT_GRACE_MS = 20000;
// How often the host pings each connected client to measure latency (the
// result is what shows up as everyone's ping in the HUD).
const PING_INTERVAL_MS = 2000;
// How long a client waits between its own reconnect attempts after losing
// the host connection.
const RECONNECT_RETRY_INTERVAL_MS = 2000;
// How many reconnect attempts a client makes before giving up. At
// RECONNECT_RETRY_INTERVAL_MS apart, this should cover roughly the same
// span as RECONNECT_GRACE_MS so a client doesn't stop retrying while the
// host is still holding its slot open (or vice versa).
const RECONNECT_MAX_ATTEMPTS = 10;

// Client-side networking feel: how long a remote player's position tween
// takes to interpolate a freshly-arrived snapshot. Kept a bit above
// STATE_INTERVAL (80ms) so a tween is still finishing — and gets smoothly
// retargeted — when the next snapshot arrives, rather than sitting idle
// waiting for it; this margin is what absorbs real-world WebRTC jitter.
const NET_INTERP_MS = 90;
// How often a client re-sends its current input to the host even when
// nothing has changed, as a keepalive/resync on top of the immediate
// resends that happen whenever a key/button state actually changes.
const INPUT_RESEND_MS = 250;

// ====================== BOT AI ======================
// How often a bot re-evaluates its next move ("thinks"). Reacts quickly
// (short interval) whenever something dangerous is nearby or it's watching
// a bomb it just planted, so it notices the instant it needs to move;
// thinks more leisurely (long interval) only while fully safe and idle, so
// bots read as responsive without being twitchy while just exploring. Each
// tier adds a random jitter on top so bots don't all re-think in lockstep.
const BOT_THINK_URGENT_MS = 80;
const BOT_THINK_URGENT_JITTER_MS = 60;
const BOT_THINK_IDLE_MS = 220;
const BOT_THINK_IDLE_JITTER_MS = 140;
// Bot personalities: each is a distinct decision-making style layered on top
// of the same shared danger-avoidance/pathfinding core in bot-ai.js (nobody
// walks into fire on purpose, regardless of personality). 'classic' is the
// original/default behavior — everything else is a variant. Label/emoji are
// shared between the lobby's per-bot dropdown and the in-game player label.
// Object key order also drives the lobby dropdown's option order, so
// 'classic' is listed first.
const BOT_PERSONALITIES = {
  classic:  { label:'Classic (default)', emoji:'\u{1F916}', desc:'Breaks blocks for power-ups, only fights when a bomb is convenient.' },
  hunter:   { label:'Hunter',           emoji:'\u{1F3F9}', desc:'Actively chases down other players and bombs aggressively.' },
  camper:   { label:'Camper',           emoji:'\u{1F3D5}\uFE0F', desc:'Holds its spawn corner and bombs anyone who wanders into range.' },
  chaotic:  { label:'Chaotic',          emoji:'\u{1F32A}\uFE0F', desc:'Thinks fast, moves erratically, spams bombs with little planning.' },
  coward:   { label:'Coward',           emoji:'\u{1F430}', desc:'Runs from players anywhere on the map, no home base to retreat to.' },
  hoarder:  { label:'Hoarder',          emoji:'\u{1F9F2}', desc:'Beelines for power-ups on the field instead of hunting players.' },
  ambusher: { label:'Ambusher',         emoji:'\u{1FAA4}', desc:'Sets Remote Bomb or Mine traps and waits, rather than fighting head-on.' },
};
const DEFAULT_BOT_PERSONALITY_ORDER = ['classic', 'hunter', 'camper']; // default pick for bot slots 1/2/3 in the lobby

// ====================== SHARED VISUAL FEEL ======================
// Flash duration when a shield absorbs a hit — the same tween runs on the
// host's own view and is mirrored on every client's view, so it lives here
// once instead of as two copies that could quietly drift apart.
const SHIELD_BREAK_FLASH_MS = 90;

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


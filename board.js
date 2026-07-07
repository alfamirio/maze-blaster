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

// Draws one decorative speckle mark at a tile-local (px,py) offset, in
// whichever shape the active theme calls for — this is what makes desert
// sand, snow, jungle floor, and lava each read as a distinct kind of
// ground rather than just a recolored copy of the grass tile's dots.
function drawSpeckleMark(gfx, shape, px, py, rad, rand, color, alpha){
  gfx.fillStyle(color, alpha);
  gfx.lineStyle(Math.max(1, rad*0.6), color, alpha);
  switch (shape){
    case 'grain': { // desert: short diagonal sand-grain line
      const len = rad * 2.2;
      const ang = (rand() * 0.6 - 0.3) + Math.PI*0.25;
      const dx = Math.cos(ang)*len/2, dy = Math.sin(ang)*len/2;
      gfx.beginPath();
      gfx.moveTo(px-dx, py-dy);
      gfx.lineTo(px+dx, py+dy);
      gfx.strokePath();
      break;
    }
    case 'fleck': { // snow: tiny diamond crystal
      const s = rad * 1.4;
      gfx.beginPath();
      gfx.moveTo(px, py-s);
      gfx.lineTo(px+s, py);
      gfx.lineTo(px, py+s);
      gfx.lineTo(px-s, py);
      gfx.closePath();
      gfx.fillPath();
      break;
    }
    case 'vine': { // jungle: small curved hook, like a stray vine/leaf
      const s = rad * 2.4;
      gfx.beginPath();
      gfx.moveTo(px-s*0.5, py+s*0.4);
      gfx.lineTo(px, py-s*0.3);
      gfx.lineTo(px+s*0.5, py+s*0.2);
      gfx.strokePath();
      break;
    }
    case 'ember': { // lava: glowing ember dot, brighter/hotter than a plain speckle
      gfx.fillCircle(px, py, rad*1.15);
      break;
    }
    case 'rivet': { // space station: tiny bolt head, a circle with a cross slot
      const r2 = rad*1.1, cross = rad*0.9;
      gfx.fillCircle(px, py, r2);
      gfx.beginPath();
      gfx.moveTo(px-cross, py); gfx.lineTo(px+cross, py);
      gfx.moveTo(px, py-cross); gfx.lineTo(px, py+cross);
      gfx.strokePath();
      break;
    }
    case 'swirl': { // candy land: small S-curve, like a swirled candy stripe
      const s = rad*1.8;
      gfx.beginPath();
      gfx.moveTo(px-s, py-s*0.4);
      gfx.lineTo(px-s*0.2, py-s*0.4);
      gfx.lineTo(px, py);
      gfx.lineTo(px+s*0.2, py+s*0.4);
      gfx.lineTo(px+s, py+s*0.4);
      gfx.strokePath();
      break;
    }
    case 'bubble': { // swamp/bog: small ring, like a rising gas bubble
      gfx.strokeCircle(px, py, rad*1.2);
      break;
    }
    case 'crystal': { // cave: small angular mineral shard
      const s = rad*1.6;
      gfx.beginPath();
      gfx.moveTo(px, py-s*1.3);
      gfx.lineTo(px+s*0.6, py-s*0.1);
      gfx.lineTo(px+s*0.2, py+s*1.1);
      gfx.lineTo(px-s*0.5, py+s*0.3);
      gfx.closePath();
      gfx.fillPath();
      break;
    }
    case 'spark': { // neon/cyber: short jagged electric line, like 'grain' but zigzagged
      const len = rad*2.4;
      gfx.beginPath();
      gfx.moveTo(px-len/2, py);
      gfx.lineTo(px-len/6, py-rad*0.8);
      gfx.lineTo(px+len/6, py+rad*0.6);
      gfx.lineTo(px+len/2, py-rad*0.3);
      gfx.strokePath();
      break;
    }
    case 'bone': { // graveyard: small X mark, like crossed bones
      const s = rad*1.3;
      gfx.beginPath();
      gfx.moveTo(px-s, py-s); gfx.lineTo(px+s, py+s);
      gfx.moveTo(px+s, py-s); gfx.lineTo(px-s, py+s);
      gfx.strokePath();
      break;
    }
    default: // 'dot': classic grass speckle
      gfx.fillCircle(px, py, rad);
  }
}

// Floor tile: base color plus a scattering of subtle darker/lighter
// speckles (shape depends on the active theme) so it reads as mottled
// ground instead of a flat color swatch.
function drawFloorTile(scene, r, c, themeKey){
  const theme = THEMES[themeKey || ACTIVE_THEME] || THEMES.default;
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const parity = (r+c) % 2 === 0 ? 0 : 1;
  const shade = parity === 0 ? theme.floor.even : theme.floor.odd;
  scene.add.rectangle(x, y, TILE-2, TILE-2, shade);

  const rand = tileRand(r*73856093 ^ c*19349663);
  const speck = scene.add.graphics();
  speck.x = x; speck.y = y;
  const lightColor = theme.floor.light[parity];
  const darkColor  = theme.floor.dark[parity];
  // Lava's embers are sparser but punchier than the other themes' speckles.
  const dotCount = theme.speckle === 'ember' ? 4 + Math.floor(rand()*4) : 7 + Math.floor(rand()*5);
  const baseAlpha = theme.speckle === 'ember' ? 0.55 : 0.3;
  for (let i = 0; i < dotCount; i++){
    const px = (rand()-0.5) * (TILE-10);
    const py = (rand()-0.5) * (TILE-10);
    const rad = (1.2 + rand()*1.6) * UI_SCALE;
    const color = rand() < 0.5 ? lightColor : darkColor;
    drawSpeckleMark(speck, theme.speckle, px, py, rad, rand, color, baseAlpha);
  }
}

// Indestructible wall/pillar block: beveled "solid stone" look — light
// top/left bevel faces, dark bottom/right bevel faces, a slightly recessed
// inner face, and faint seam lines suggesting a carved stone block.
function drawWallBlock(scene, r, c, themeKey){
  const theme = THEMES[themeKey || ACTIVE_THEME] || THEMES.default;
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const s = TILE - 2;
  const half = s / 2;
  const bevel = Math.max(4, Math.round(TILE * 0.1));
  const baseColor  = theme.wall.base;
  const lightColor = theme.wall.light;
  const darkColor  = theme.wall.dark;
  const innerColor = theme.wall.inner;

  const container = scene.add.container(x, y);

  const body = scene.add.rectangle(0, 0, s, s, baseColor)
    .setStrokeStyle(Math.round(2*UI_SCALE), theme.wall.stroke);
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
  seam.lineStyle(Math.max(1, Math.round(1.5*UI_SCALE)), theme.wall.seam, 0.6);
  seam.beginPath();
  seam.moveTo(-half+bevel, 0); seam.lineTo(half-bevel, 0);
  seam.moveTo(0, -half+bevel); seam.lineTo(0, half-bevel);
  seam.strokePath();
  container.add(seam);
}

function buildStaticBoard(scene, pillars = true, themeKey){
  // themeKey defaults to the module-level ACTIVE_THEME (set via applyTheme()
  // before the match starts, and synced host->client alongside the pillar
  // flag/teleporter count); an explicit key can still be passed for things
  // like a themed lobby preview thumbnail without touching global state.
  const theme = themeKey || ACTIVE_THEME;
  for (let r = 0; r < ROWS; r++){
    for (let c = 0; c < COLS; c++){
      drawFloorTile(scene, r, c, theme);
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
        drawWallBlock(scene, r, c, theme);
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
function drawBlock(scene, r, c, themeKey){
  const theme = THEMES[themeKey || ACTIVE_THEME] || THEMES.default;
  const x = c*TILE + TILE/2, y = HUD_H + r*TILE + TILE/2;
  const container = scene.add.container(x, y);

  const s = TILE - 4;
  const half = s / 2;
  const bevel = Math.max(3, Math.round(TILE * 0.07)); // shallower than the stone walls' bevel

  const body = scene.add.rectangle(0, 0, s, s, theme.crate.body).setStrokeStyle(Math.round(2*UI_SCALE), theme.crate.stroke);
  container.add(body);

  // Beveled crate faces (lighter top/left catching light, darker bottom/right
  // in shadow) give the crate a raised, chunky look — but kept shallow and
  // paired with the cracks below so it still reads as breakable, not a
  // solid stone block.
  const bevelGfx = scene.add.graphics();
  bevelGfx.fillStyle(theme.crate.bevelLight, 0.9); // lit top/left faces
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
  bevelGfx.fillStyle(theme.crate.bevelDark, 0.9); // shadowed bottom/right faces
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

  // Recessed inner face, slightly different tone from the bevel edges so
  // the crate reads as a raised block rather than a flat sticker.
  const inner = scene.add.rectangle(0, 0, s - bevel*2, s - bevel*2, theme.crate.inner);
  container.add(inner);

  // Crack lines make it obvious at a glance that this block can be broken
  // (as opposed to the solid indestructible pillars/walls).
  const variant = CRACK_VARIANTS[Math.abs(r*3 + c*7) % CRACK_VARIANTS.length];
  const cracks = scene.add.graphics();
  cracks.lineStyle(Math.max(1, Math.round(2*UI_SCALE)), theme.crate.crack, 0.9);
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
  chipGfx.fillStyle(theme.crate.bevelDark, 1);
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
    // Arena-warning ring: sits just outside the shield ring, invisible until
    // the Shrinking Arena scenario catches this player outside the safe
    // zone, then flashes red for the grace period before it actually hurts
    // them (see updateArenaWarningVisual below).
    const arenaWarnRing = scene.add.circle(0, 0, TILE*0.52, 0x000000, 0)
      .setStrokeStyle(Math.max(2, Math.round(4*UI_SCALE)), 0xff3b30, 1)
      .setVisible(false);
    const eyeRad = Math.max(1.5, TILE*0.045);
    const eyeL = scene.add.circle(0, 0, eyeRad, 0x161616);
    const eyeR = scene.add.circle(0, 0, eyeRad, 0x161616);
    const label = scene.add.text(0, -TILE*0.55, playerDisplayName(i), { fontSize:Math.round(12*UI_SCALE)+'px', color:'#fff' }).setOrigin(0.5);
    // Countdown number shown above the player's name while the arena-warning
    // ring is active (e.g. "5", "4", "3"...).
    const arenaWarnText = scene.add.text(0, -TILE*0.85, '', { fontSize:Math.round(20*UI_SCALE)+'px', color:'#ff3b30', fontStyle:'bold' }).setOrigin(0.5).setVisible(false);
    container.add([shadow, body, curseRing, shieldRing, arenaWarnRing, eyeL, eyeR, label, arenaWarnText]);
    const player = { id:i, row:s.r, col:s.c, container, body, label, shadow, eyeL, eyeR, curseRing, shieldRing, arenaWarnRing, arenaWarnText, alive:true, maxBombs:INITIAL_MAX_BOMBS, blastRange:INITIAL_BLAST_RANGE, speed:INITIAL_SPEED, curse:null, hasKick:INITIAL_HAS_KICK, shieldCount:INITIAL_SHIELD_COUNT, pierce:INITIAL_PIERCE, hasDetonator:INITIAL_HAS_DETONATOR, remoteBomb:null, hasMine:INITIAL_HAS_MINE, activeMine:null, invulnerableUntil:0, facingDr:s.dr, facingDc:s.dc, arenaOutsideSince:0, arenaWarnMs:null, arenaWarnAt:0 };
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

// Builds the "<curse><kick><shield><pierce><detonator><mine><reconnect><ping>"
// tag suffix shown after a player's stat line in the HUD. HostScene (driven
// by the live player object) and ClientScene (driven by the synced snapshot)
// both show the exact same set of tags derived from what is structurally the
// same state, just under different field names/shapes — so building the
// suffix lives here once instead of as two copies that could quietly drift
// apart (e.g. someone adding a new power-up's tag to only one side).
// `o` fields: cursed, hasKick, shieldCount, pierce, hasDetonator, hasMine,
// mineActive (true = armed/orange, false = unarmed/black), reconnecting,
// pingVal (ms, or null/undefined if not applicable).
function buildStatusTagSuffix(o){
  const curseTag = o.cursed ? ' \u{1F480}' : '';
  const kickTag = o.hasKick ? ' \u{1F45F}' : '';
  const shieldTag = o.shieldCount > 0 ? ` \u{1F6E1}${o.shieldCount}` : '';
  const pierceTag = o.pierce ? ' \u{1F4A5}' : '';
  const detonatorTag = o.hasDetonator ? ' \u{1F4E1}' : '';
  const mineTag = o.hasMine ? (o.mineActive ? ' \u{1F7E0}' : ' \u26AB') : '';
  const reconnectTag = o.reconnecting ? ' \u23F3' : '';
  const pingTag = (o.pingVal != null && !o.reconnecting) ? ` ${pingQualityEmoji(o.pingVal)}${o.pingVal}ms` : '';
  return curseTag + kickTag + shieldTag + pierceTag + detonatorTag + mineTag + reconnectTag + pingTag;
}
// Same idea for the HUD text color and sprite alpha: both host and client
// derive them from the same three inputs (alive / reconnecting / cursed).
function statusColor(alive, reconnecting, cursed){
  if (!alive) return '#666';
  return reconnecting ? '#f5b041' : (cursed ? '#c39bd3' : '#eee');
}
function statusAlpha(alive, reconnecting){
  if (!alive) return 0.55;
  return reconnecting ? 0.55 : 1;
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
// The fog only actually needs to change shape when the viewed player steps
// onto a new tile, but this used to run a full ROWS*COLS clear+refill every
// single frame regardless (called from each scene's update(), i.e. up to
// 60x/sec on both the host and every client). Stamping a cache key of the
// last tile/alive-state we drew for and bailing out when it's unchanged
// turns that into a no-op the vast majority of frames.
function updateFogOverlay(gfx, player){
  const alive = !!(player && player.alive);
  const key = alive ? (player.row * 100000 + player.col) : -1;
  if (gfx._fogLastKey === key) return;
  gfx._fogLastKey = key;
  gfx.clear();
  if (!alive) return; // eliminated/spectating players see the whole board
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
// Bounds only actually shrink on a slow timer (SHRINK_INTERVAL_MS), but this
// gets called from update() every frame on the host and every incoming
// snapshot on clients. Skip the ROWS*COLS clear+refill whenever the bounds
// are the same rectangle as last time we drew it.
function updateArenaOverlay(gfx, bounds){
  const key = bounds ? (bounds.minR+','+bounds.maxR+','+bounds.minC+','+bounds.maxC) : null;
  if (gfx._arenaLastKey === key) return;
  gfx._arenaLastKey = key;
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
// Per-player "you're outside the safe zone" warning: a flashing red ring
// plus a whole-seconds countdown overhead, shown for as long as
// remainingMs is non-null. Pass null to hide it (back inside, dead, or the
// scenario isn't active). Pulse speed ramps up as remainingMs shrinks, so
// the last second or so reads as an urgent, fast flash rather than the same
// lazy pulse the whole way down. Works identically on the host's own view
// (driven by the real countdown) and every client's view (driven by the
// remaining time synced in from the state snapshot).
function updateArenaWarningVisual(p, remainingMs, time){
  if (remainingMs == null){
    p.arenaWarnRing.setVisible(false);
    p.arenaWarnText.setVisible(false);
    return;
  }
  p.arenaWarnRing.setVisible(true);
  p.arenaWarnText.setVisible(true);
  p.arenaWarnText.setText(String(Math.max(1, Math.ceil(remainingMs / 1000))));
  const urgency = 1 - Math.min(1, remainingMs / ARENA_GRACE_MS); // 0 (just stepped out) -> 1 (about to be hit)
  const pulsePeriod = 130 - urgency*90; // slows to a fast ~40ms-period flash near the end
  const pulse = 0.35 + 0.65*((Math.sin(time/Math.max(35,pulsePeriod))+1)/2);
  p.arenaWarnRing.setStrokeStyle(Math.max(2, Math.round(4*UI_SCALE)), 0xff3b30, pulse);
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


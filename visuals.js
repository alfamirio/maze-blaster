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


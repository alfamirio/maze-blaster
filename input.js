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


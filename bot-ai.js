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
  // Shrinking Arena: any tile currently outside the safe zone counts as
  // danger too, same as fire or a live bomb's blast. Folding it in here
  // (rather than teaching each personality about arena bounds separately)
  // means every existing behavior gets this for free: botRandomSafeStep and
  // botFirstStepTo's avoidSet already steer clear of danger cells, and
  // botDecide's "inDanger" branch already reacts urgently and paths a bot
  // straight back to the nearest non-danger cell — which, if a bot gets
  // caught outside by a shrink, is now the nearest cell back inside the
  // safe zone, exactly mirroring the scramble-back-in grace window a human
  // player gets.
  if (scene.shrinkingArena && scene.arenaBounds){
    const b = scene.arenaBounds;
    for (let r = 0; r < ROWS; r++){
      for (let c = 0; c < COLS; c++){
        if (r < b.minR || r > b.maxR || c < b.minC || c > b.maxC) danger.add(r * COLS + c);
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
  // Index cursor instead of Array.shift(): shift() is O(n) per call (it
  // re-indexes the whole remaining array), which makes a full-board BFS
  // O(n^2) in the worst case. A cursor into a plain array keeps each pop O(1).
  const queue = [{ r:sr, c:sc }];
  let head = 0;
  let target = null;
  while (head < queue.length){
    const cur = queue[head++];
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

// ---- Personality tuning -------------------------------------------------
const CAMPER_RADIUS = 4;       // camper won't wander further than this from its spawn tile
const CHAOTIC_BOMB_CHANCE = 0.05; // per-think chance a chaotic bot tries to drop a bomb with no real target
const COWARD_SAFE_RADIUS = 6;  // coward avoids bombing/engaging while a player is within this distance

// Nearest other living player to p (Manhattan distance — good enough for
// picking a chase/flee target without the cost of a full BFS per candidate).
function botNearestPlayer(scene, p){
  let best = null, bestDist = Infinity;
  for (const other of scene.players){
    if (other === p || !other.alive) continue;
    const dist = Math.abs(other.row-p.row) + Math.abs(other.col-p.col);
    if (dist < bestDist){ bestDist = dist; best = other; }
  }
  return best;
}

// Shared bomb-then-flee evaluation used by every personality: scans outward
// in all 4 directions up to the bot's blast range, and wants to bomb if
// targetPredicate(rr,cc) matches some cell along the way (blast stops at the
// first block either way, matching how the real explosion resolves). If it
// wants to bomb, also checks a real escape route exists *after* dropping —
// same one-bomb-at-a-time cap and "don't bomb without an out" rule for every
// personality. Returns the first-step direction to flee toward, or null if
// this bot shouldn't/can't bomb right now.
function botEvaluateBomb(scene, p, danger, targetPredicate){
  if (scene.bombs[p.row][p.col] || scene.countActiveBombs(p) >= 1) return null;
  let wantsBomb = false;
  outer: for (const d of BOT_DIRS){
    for (let step = 1; step <= p.blastRange; step++){
      const rr = p.row + d.dr*step, cc = p.col + d.dc*step;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
      if (scene.solid[rr][cc]) break;
      if (targetPredicate(rr, cc)){ wantsBomb = true; break outer; }
      if (scene.blocks[rr][cc]) break;
    }
  }
  if (!wantsBomb) return null;
  const hypothetical = new Set(danger);
  hypothetical.add(p.row * COLS + p.col);
  for (const d of BOT_DIRS){
    for (let step = 1; step <= p.blastRange; step++){
      const rr = p.row + d.dr*step, cc = p.col + d.dc*step;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
      if (scene.solid[rr][cc]) break;
      hypothetical.add(rr*COLS+cc);
      if (scene.blocks[rr][cc]) break;
    }
  }
  return botFirstStepTo(scene, p.row, p.col, (r,c) => !hypothetical.has(r*COLS+c), danger); // null if no escape
}
function botIsNearBlock(scene){
  return (r, c) => BOT_DIRS.some(d => {
    const rr = r+d.dr, cc = c+d.dc;
    return rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && scene.blocks[rr][cc];
  });
}
function botAnyPlayerAt(scene, p){
  return (rr, cc) => scene.players.some(pl => pl.alive && pl !== p && pl.row === rr && pl.col === cc);
}

// Nearest power-up currently sitting on the board (Manhattan distance, same
// "good enough" tradeoff as botNearestPlayer). 'curse' is excluded by
// default since it's a trap disguised as a pickup, not something a bot
// hunting for power-ups actually wants.
function botFindPowerup(scene, p, excludeTypes){
  const exclude = excludeTypes || ['curse'];
  let best = null, bestDist = Infinity;
  for (let r=0;r<ROWS;r++){
    for (let c=0;c<COLS;c++){
      const pu = scene.powerups[r][c];
      if (!pu || exclude.includes(pu.type)) continue;
      const dist = Math.abs(r-p.row) + Math.abs(c-p.col);
      if (dist < bestDist){ bestDist = dist; best = { r, c }; }
    }
  }
  return best;
}

// Cells a bomb sitting at (row,col) with the given range would actually
// reach right now — mirrors explodeBomb()'s real resolution (stops at the
// first solid tile, or at-and-including the first block it would destroy).
function botBombBlastCells(scene, row, col, range){
  const cells = [{ r: row, c: col }];
  for (const d of BOT_DIRS){
    for (let i = 1; i <= range; i++){
      const rr = row + d.dr*i, cc = col + d.dc*i;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
      if (scene.solid[rr][cc]) break;
      cells.push({ r: rr, c: cc });
      if (scene.blocks[rr][cc]) break;
    }
  }
  return cells;
}

// ---- Personality behaviors ----------------------------------------------
// Each is called only in the "safe & idle" branch — fleeing immediate danger
// and standing pat while waiting for a just-placed bomb to clear are handled
// identically for every personality in botDecide() below, since nobody
// behaves differently about literally not dying. Each returns
// { dirName, bombPressed, wantsBomb }.

// The original/default bot: hunts destructible blocks, bombs opportunistically
// whenever a block or player ends up in range with an escape available.
function botBehaviorClassic(scene, p, danger){
  const target = botAnyPlayerAt(scene, p);
  const fleeStep = botEvaluateBomb(scene, p, danger, (rr,cc) => scene.blocks[rr][cc] || target(rr,cc));
  if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };
  const step = botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// BFS from (sr,sc) to (tr,tc) that treats destructible blocks as passable
// (only solid pillars/border block it) — used to find the conceptual
// shortest route to a target through the maze, independent of whether that
// route is actually walkable right now. Returns the ordered list of cells
// from just after the start to the target (inclusive), or null if genuinely
// unreachable even through blocks (walled off by pillars).
function botPathIgnoringBlocks(scene, sr, sc, tr, tc){
  const startKey = sr*COLS+sc, targetKey = tr*COLS+tc;
  if (startKey === targetKey) return [];
  const visited = new Set([startKey]);
  const prev = new Map();
  const queue = [{ r:sr, c:sc }];
  let head = 0;
  while (head < queue.length){
    const cur = queue[head++];
    if (cur.r*COLS+cur.c === targetKey) break;
    for (const d of BOT_DIRS){
      const nr = cur.r+d.dr, nc = cur.c+d.dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      if (scene.solid[nr][nc]) continue; // pillars/border are the only true walls here
      const key = nr*COLS+nc;
      if (visited.has(key)) continue;
      visited.add(key);
      prev.set(key, { r:cur.r, c:cur.c });
      queue.push({ r:nr, c:nc });
    }
  }
  if (!visited.has(targetKey)) return null;
  const path = [];
  let node = { r:tr, c:tc };
  while (node.r !== sr || node.c !== sc){
    path.push(node);
    const key = node.r*COLS+node.c;
    const p = prev.get(key);
    if (!p) return null;
    node = p;
  }
  path.reverse();
  return path;
}

// Actively closes distance on the nearest other player and bombs aggressively
// once they're in range. If no open route to them exists yet, it bombs
// through whichever block is actually in the way rather than wandering off
// to clear an unrelated one and waiting for the maze to happen to open up.
function botBehaviorHunter(scene, p, danger){
  const target = botAnyPlayerAt(scene, p);
  const fleeStep = botEvaluateBomb(scene, p, danger, target);
  if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };
  const nearest = botNearestPlayer(scene, p);
  if (nearest){
    const step = botFirstStepTo(scene, p.row, p.col, (r,c) => r === nearest.row && c === nearest.col, danger);
    if (step) return { dirName: step, bombPressed: false, wantsBomb: false };
    const path = botPathIgnoringBlocks(scene, p.row, p.col, nearest.row, nearest.col);
    const blocker = path && path.find(cell => scene.blocks[cell.r][cell.c]);
    if (blocker){
      const bombStep = botEvaluateBomb(scene, p, danger, (rr,cc) => rr === blocker.r && cc === blocker.c);
      if (bombStep) return { dirName: bombStep, bombPressed: true, wantsBomb: true };
      const isAdjacentToBlocker = (r,c) => Math.abs(r-blocker.r)+Math.abs(c-blocker.c) === 1;
      const approachStep = botFirstStepTo(scene, p.row, p.col, isAdjacentToBlocker, danger);
      if (approachStep) return { dirName: approachStep, bombPressed: false, wantsBomb: false };
    }
  }
  // No living target, or genuinely stuck even accounting for the above —
  // fall back to Classic-style block clearing so it still makes progress.
  const step = botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// Sticks close to its spawn corner and holds it: bombs to clear a nearby
// block, or bombs any player who wanders into its blast range while it's
// home (a real territorial turret, not just a shy bot that happens to bomb
// when touched) — and retreats home if it's wandered too far. Never leaves
// its corner looking for a fight; unlike Coward, it never runs from one
// that comes to it.
function botBehaviorCamper(scene, p, mem, danger){
  if (!mem.spawn) mem.spawn = { r: p.row, c: p.col };
  const spawn = mem.spawn;
  const distFromSpawn = Math.abs(p.row-spawn.r) + Math.abs(p.col-spawn.c);
  const fleeStep = botEvaluateBomb(scene, p, danger, (rr,cc) => scene.blocks[rr][cc] || botAnyPlayerAt(scene, p)(rr,cc));
  if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };
  if (distFromSpawn > CAMPER_RADIUS){
    const step = botFirstStepTo(scene, p.row, p.col, (r,c) => r === spawn.r && c === spawn.c, danger);
    if (step) return { dirName: step, bombPressed: false, wantsBomb: false };
  }
  const isNearBlockInRange = (r, c) => {
    if (Math.abs(r-spawn.r)+Math.abs(c-spawn.c) > CAMPER_RADIUS) return false;
    return botIsNearBlock(scene)(r, c);
  };
  const step = botFirstStepTo(scene, p.row, p.col, isNearBlockInRange, danger);
  // No step found just means nothing to do nearby — stands still, camper-style.
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// No target-seeking at all: wanders randomly and occasionally drops a bomb
// wherever it happens to be standing (as long as it can still escape), with
// a much twitchier think interval (applied in botDecide) than the others.
function botBehaviorChaotic(scene, p, danger){
  if (Math.random() < CHAOTIC_BOMB_CHANCE){
    const fleeStep = botEvaluateBomb(scene, p, danger, () => true);
    if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };
  }
  const step = botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// A true fugitive, not a turtle: has no home base and will run from a
// player anywhere on the map, from farther away than Camper ever reacts to
// one. Only bombs a block (never a player, even one it's fleeing past) when
// nobody's close enough to notice — or when genuinely cornered, where a
// bomb may be the only way to open an escape route.
function botBehaviorCoward(scene, p, danger){
  const target = botNearestPlayer(scene, p);
  const targetDist = target ? Math.abs(target.row-p.row)+Math.abs(target.col-p.col) : Infinity;
  const cornered = botRandomSafeStep(scene, p, danger) === null;
  if (targetDist > COWARD_SAFE_RADIUS || cornered){
    const fleeStep = botEvaluateBomb(scene, p, danger, (rr,cc) => scene.blocks[rr][cc]);
    if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };
  }
  if (target && targetDist <= COWARD_SAFE_RADIUS){
    // Flee directly away: prefer whichever open, safe neighboring cell
    // increases distance to the nearest player the most.
    let bestStep = null, bestDist = targetDist;
    for (const d of BOT_DIRS){
      const nr = p.row+d.dr, nc = p.col+d.dc;
      if (!botCellOpen(scene, nr, nc) || danger.has(nr*COLS+nc)) continue;
      const dist = Math.abs(target.row-nr) + Math.abs(target.col-nc);
      if (dist > bestDist){ bestDist = dist; bestStep = d.name; }
    }
    if (bestStep) return { dirName: bestStep, bombPressed: false, wantsBomb: false };
  }
  const step = botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// Beelines for whatever power-up is currently on the board instead of
// hunting players or blocks for their own sake. Only bombs reactively, to
// clear a block that's blocking its route to the prize or to defend itself
// if someone's standing right next to it — never to pick a fight.
function botBehaviorHoarder(scene, p, danger){
  const fleeStep = botEvaluateBomb(scene, p, danger, (rr,cc) => {
    const adjacentPlayer = Math.abs(rr-p.row)+Math.abs(cc-p.col) === 1 && botAnyPlayerAt(scene, p)(rr,cc);
    return adjacentPlayer;
  });
  if (fleeStep) return { dirName: fleeStep, bombPressed: true, wantsBomb: true };

  const pu = botFindPowerup(scene, p);
  if (pu){
    const step = botFirstStepTo(scene, p.row, p.col, (r,c) => r === pu.r && c === pu.c, danger);
    if (step) return { dirName: step, bombPressed: false, wantsBomb: false };
    // Reachable in principle but a block is in the way right now — bomb
    // through it exactly like Hunter does for a fleeing player, just aimed
    // at a crate between here and the pickup instead.
    const path = botPathIgnoringBlocks(scene, p.row, p.col, pu.r, pu.c);
    const blocker = path && path.find(cell => scene.blocks[cell.r][cell.c]);
    if (blocker){
      const bombStep = botEvaluateBomb(scene, p, danger, (rr,cc) => rr === blocker.r && cc === blocker.c);
      if (bombStep) return { dirName: bombStep, bombPressed: true, wantsBomb: true };
      const isAdjacentToBlocker = (r,c) => Math.abs(r-blocker.r)+Math.abs(c-blocker.c) === 1;
      const approachStep = botFirstStepTo(scene, p.row, p.col, isAdjacentToBlocker, danger);
      if (approachStep) return { dirName: approachStep, bombPressed: false, wantsBomb: false };
    }
  }
  // Nothing worth collecting on the field right now — clear blocks Classic-
  // style so something eventually drops.
  const step = botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// How close an enemy needs to be before the Ambusher (without a Detonator
// yet) considers a Proximity Mine worth dropping right where it's standing.
const AMBUSH_MINE_RADIUS = 3;

// Remote Bomb half of the Ambusher: stalks the nearest player the same way
// Hunter does, but once they're lined up within blast range it plants a
// no-fuse remote bomb instead of an instant one, then holds its ground and
// watches — pulling the trigger the moment anyone (not necessarily the same
// player that lined it up) actually steps into the blast footprint.
function botAmbushWithDetonator(scene, p, danger){
  if (p.remoteBomb){
    const cells = botBombBlastCells(scene, p.remoteBomb.row, p.remoteBomb.col, p.remoteBomb.range);
    const someoneInBlast = scene.players.some(pl => pl.alive && cells.some(cell => cell.r === pl.row && cell.c === pl.col));
    if (someoneInBlast) return { dirName: null, bombPressed: false, wantsBomb: false, detonatePressed: true };
    // Nobody's wandered in yet — sit tight and keep watching. (If we're
    // actually standing inside our own trap's footprint, botDecide's shared
    // danger check already caught that before this function is even called
    // and routed us to safety instead.)
    return { dirName: null, bombPressed: false, wantsBomb: false, detonatePressed: false };
  }
  const target = botNearestPlayer(scene, p);
  if (!target) return { dirName: null, bombPressed: false, wantsBomb: false, detonatePressed: false };
  // botEvaluateBomb's own escape check doesn't matter here (a remote bomb
  // never explodes until we choose to), but it's still the exact "is
  // someone in range from where I'm standing" test we want, so reuse it.
  const placeStep = botEvaluateBomb(scene, p, danger, botAnyPlayerAt(scene, p));
  if (placeStep) return { dirName: placeStep, bombPressed: false, wantsBomb: false, detonatePressed: true };
  // Not lined up on anyone yet — close the distance like Hunter, bombing
  // through a blocking crate with an instant bomb if needed (no sense
  // wasting the ambush trap just to clear rubble).
  const step = botFirstStepTo(scene, p.row, p.col, (r,c) => r === target.row && c === target.col, danger);
  if (step) return { dirName: step, bombPressed: false, wantsBomb: false, detonatePressed: false };
  const path = botPathIgnoringBlocks(scene, p.row, p.col, target.row, target.col);
  const blocker = path && path.find(cell => scene.blocks[cell.r][cell.c]);
  if (blocker){
    const bombStep = botEvaluateBomb(scene, p, danger, (rr,cc) => rr === blocker.r && cc === blocker.c);
    if (bombStep) return { dirName: bombStep, bombPressed: true, wantsBomb: true };
    const isAdjacentToBlocker = (r,c) => Math.abs(r-blocker.r)+Math.abs(c-blocker.c) === 1;
    const approachStep = botFirstStepTo(scene, p.row, p.col, isAdjacentToBlocker, danger);
    if (approachStep) return { dirName: approachStep, bombPressed: false, wantsBomb: false, detonatePressed: false };
  }
  return { dirName: null, bombPressed: false, wantsBomb: false, detonatePressed: false };
}

// Proximity Mine half of the Ambusher: drops a mine as soon as an enemy is
// generally nearby, then leans on the shared danger-avoidance in botDecide
// (every armed bomb, remote bomb, and mine already counts as danger there)
// to carry it clear before the mine finishes arming — no watch-and-detonate
// step needed since the mine trips itself.
function botAmbushWithMine(scene, p, danger){
  if (p.activeMine){
    const step = botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
    return { dirName: step, bombPressed: false, wantsBomb: false };
  }
  const target = botNearestPlayer(scene, p);
  const targetDist = target ? Math.abs(target.row-p.row)+Math.abs(target.col-p.col) : Infinity;
  if (target && targetDist <= AMBUSH_MINE_RADIUS && !scene.bombs[p.row][p.col]){
    const flee = botRandomSafeStep(scene, p, danger);
    return { dirName: flee, bombPressed: false, wantsBomb: false, minePressed: true };
  }
  const towardsTarget = target && botFirstStepTo(scene, p.row, p.col, (r,c) => r === target.row && c === target.col, danger);
  const step = towardsTarget || botFirstStepTo(scene, p.row, p.col, botIsNearBlock(scene), danger) || botRandomSafeStep(scene, p, danger);
  return { dirName: step, bombPressed: false, wantsBomb: false };
}

// Sets traps rather than fighting head-on: uses whichever of the Remote Bomb
// or Proximity Mine abilities it's picked up, preferring the Remote Bomb
// (a deliberate, aimed trigger) over the Mine (a fire-and-forget one) since
// it's the more controllable of the two. Before it has either, it hunts
// like Hunter so it's actually threatening enough to be worth ambushing
// around once the power-up drops.
function botBehaviorAmbusher(scene, p, danger){
  if (p.hasDetonator) return botAmbushWithDetonator(scene, p, danger);
  if (p.hasMine) return botAmbushWithMine(scene, p, danger);
  return botBehaviorHunter(scene, p, danger);
}

const BOT_BEHAVIORS = {
  classic:  (scene, p, mem, danger) => botBehaviorClassic(scene, p, danger),
  hunter:   (scene, p, mem, danger) => botBehaviorHunter(scene, p, danger),
  camper:   (scene, p, mem, danger) => botBehaviorCamper(scene, p, mem, danger),
  chaotic:  (scene, p, mem, danger) => botBehaviorChaotic(scene, p, danger),
  coward:   (scene, p, mem, danger) => botBehaviorCoward(scene, p, danger),
  hoarder:  (scene, p, mem, danger) => botBehaviorHoarder(scene, p, danger),
  ambusher: (scene, p, mem, danger) => botBehaviorAmbusher(scene, p, danger),
};

// Decide this bot's action. Thinking is throttled (cached direction is reused
// between thinks) so bots don't recompute pathfinding every single frame.
// Danger-avoidance is identical for every personality; which personality
// only changes what happens once the bot is safe and idle (see
// BOT_BEHAVIORS above).
function botDecide(scene, i, time){
  const p = scene.players[i];
  let mem = scene.botMemory[i];
  if (!mem) mem = scene.botMemory[i] = { nextThink:0, dir:{up:false,down:false,left:false,right:false}, waitingForClear:false };
  const personality = (scene.botPersonalities && BOT_PERSONALITIES[scene.botPersonalities[i]]) ? scene.botPersonalities[i] : 'classic';
  if (time < mem.nextThink) return { dir: mem.dir, bombPressed: false };

  // Every bot that thinks on the same host tick sees the same board state at
  // the moment the tick started (bombs a bot places this tick take a frame
  // to show up for bots that think after it — imperceptible at any of the
  // FPS caps this game offers, and far cheaper than every bot rescanning
  // flames/bombs independently). Cached per `time` value, which every bot
  // is called with the same number for within a single update() tick.
  let danger;
  if (scene._dangerCacheTime === time && scene._dangerCache){
    danger = scene._dangerCache;
  } else {
    danger = computeDangerSet(scene);
    scene._dangerCacheTime = time;
    scene._dangerCache = danger;
  }
  const here = p.row * COLS + p.col;
  const dir = { up:false, down:false, left:false, right:false };
  let bombPressed = false, detonatePressed = false, minePressed = false;
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
  // just exploring. Chaotic bots think faster across the board; campers
  // think a bit slower while idle since they're mostly just holding
  // position; cowards think faster than usual (though not as fast as
  // chaotic's constant twitchiness) specifically while a player is within
  // their fear radius, so they read as visibly jumpy rather than merely
  // slow to notice they should be running.
  const urgent = inDanger || mem.waitingForClear;
  const urgentMs = personality === 'chaotic' ? BOT_THINK_URGENT_MS * 0.8 : BOT_THINK_URGENT_MS;
  const cowardSpooked = personality === 'coward' && (() => {
    const nearest = botNearestPlayer(scene, p);
    return !!nearest && (Math.abs(nearest.row-p.row) + Math.abs(nearest.col-p.col)) <= COWARD_SAFE_RADIUS;
  })();
  const idleMs = personality === 'chaotic' ? BOT_THINK_IDLE_MS * 0.8
    : personality === 'camper' ? BOT_THINK_IDLE_MS * 1.4
    : cowardSpooked ? BOT_THINK_IDLE_MS * 0.6
    : BOT_THINK_IDLE_MS;
  mem.nextThink = time + (urgent ? urgentMs + Math.random()*BOT_THINK_URGENT_JITTER_MS : idleMs + Math.random()*BOT_THINK_IDLE_JITTER_MS);

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
    const behavior = BOT_BEHAVIORS[personality] || BOT_BEHAVIORS.classic;
    const result = behavior(scene, p, mem, danger);
    if (result.dirName) dir[result.dirName] = true;
    bombPressed = result.bombPressed;
    detonatePressed = !!result.detonatePressed;
    minePressed = !!result.minePressed;
    if (result.wantsBomb) mem.waitingForClear = true;
  }

  mem.dir = dir;
  return { dir, bombPressed, detonatePressed, minePressed };
}

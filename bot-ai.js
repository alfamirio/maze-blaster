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
  mem.nextThink = time + (urgent ? BOT_THINK_URGENT_MS + Math.random()*BOT_THINK_URGENT_JITTER_MS : BOT_THINK_IDLE_MS + Math.random()*BOT_THINK_IDLE_JITTER_MS);

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


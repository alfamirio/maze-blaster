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

  // Shared by placeBomb/placeRemoteBomb/placeMine below: all three do the
  // exact same setup (record the event, play the placement sound, draw the
  // bomb visual, build the bomb object, and register it into this.bombs /
  // this.activeBombs) and only differ in which optional flags apply and
  // what happens right after — a normal bomb schedules its own fuse, a
  // remote bomb waits on the owner's detonate button, and a mine waits on
  // checkMines(). Centralizing this means a new bomb-object field (or a
  // change to how placement gets recorded) only needs to happen in one place.
  spawnBomb(p, { type, remote=false, mine=false, armAt=null } = {}){
    if (this.recording) this.recording.events.push({ t: Math.round(this.time.now), type, player:p.id, row:p.row, col:p.col, range:p.blastRange });
    SFX.bombPlaced();
    const x = p.col*TILE + TILE/2, y = HUD_H + p.row*TILE + TILE/2;
    const gfx = createBombVisual(this, x, y, remote, mine);
    const bomb = { row:p.row, col:p.col, owner:p, exploded:false, gfx, range:p.blastRange, pierce:!!p.pierce, placedAt:this.time.now };
    if (remote) bomb.remote = true;
    if (mine){ bomb.mine = true; bomb.armAt = armAt; }
    this.bombs[p.row][p.col] = bomb;
    this.activeBombs.push(bomb);
    return bomb;
  }

  placeRemoteBomb(p){
    if (this.bombs[p.row][p.col]) return; // tile already holds a bomb
    // No delayedCall here — unlike a normal bomb, this one only goes off
    // when detonate() is called again.
    p.remoteBomb = this.spawnBomb(p, { type:'remoteBomb', remote:true });
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
    if (this.countActiveBombs(p) >= p.maxBombs) return;
    const bomb = this.spawnBomb(p, { type:'bomb' });
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
    const bomb = this.spawnBomb(p, { type:'mine', mine:true, armAt: this.time.now + MINE_ARM_DELAY });
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
            const type = pickPowerupType();
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
      this.tweens.add({ targets: p.body, alpha: 0.25, duration: SHIELD_BREAK_FLASH_MS, yoyo: true, repeat: 1 });
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
  // reconnect grace window (see net.reconnectDeadline / RECONNECT_GRACE_MS).
  isPendingReconnect(i){
    return this.controllers[i] === 'remote' && net.reconnectDeadline[i-1] > 0;
  }

  updateHUD(){
    for (let i = 0; i < NET_NUM_PLAYERS; i++){
      const p = this.players[i];
      const tag = this.controllers[i] === 'bot' ? '\u{1F916}' : '';
      const reconnecting = this.isPendingReconnect(i);
      // Ping only applies to real network players — solo/bot slots have no
      // connection to measure — and only once a slot's first ping reply has
      // actually landed (net.pingMs[i-1] starts out null).
      const pingVal = (this.controllers[i] === 'remote' && !reconnecting) ? net.pingMs[i-1] : null;
      const suffix = buildStatusTagSuffix({
        cursed: !!p.curse, hasKick: p.hasKick, shieldCount: p.shieldCount,
        pierce: p.pierce, hasDetonator: p.hasDetonator, hasMine: p.hasMine,
        mineActive: !!p.activeMine, reconnecting, pingVal,
      });
      this.hudTexts[i].setText(`${playerDisplayName(i)}${tag} ` + (p.alive ? `B${p.maxBombs}/R${p.blastRange}/S${p.speed}${suffix}` : 'OUT'));
      this.hudTexts[i].setColor(statusColor(p.alive, reconnecting, !!p.curse));
      // Dim the sprite itself while frozen/pending so it's clear at a glance
      // on the board, not just in the HUD text.
      p.container.setAlpha(statusAlpha(p.alive, reconnecting));
    }
  }

  buildSnapshot(){
    const bombsList = this.activeBombs.map(b => ({ row:b.row, col:b.col, remote:!!b.remote, mine:!!b.mine }));
    const powerupsList = [];
    for (let r=0;r<ROWS;r++) for (let c=0;c<COLS;c++) if (this.powerups[r][c]) powerupsList.push({row:r,col:c,type:this.powerups[r][c].type});
    return {
      players: this.players.map((p,i) => ({ row:p.row, col:p.col, alive:p.alive, maxBombs:p.maxBombs, blastRange:p.blastRange, speed:p.speed, cursed:!!p.curse, hasKick:!!p.hasKick, shieldCount:p.shieldCount||0, pierce:!!p.pierce, hasDetonator:!!p.hasDetonator, hasMine:!!p.hasMine, mineArmed:!!p.activeMine, reconnecting:this.isPendingReconnect(i), arenaWarnMs: (this.shrinkingArena && p.arenaOutsideSince) ? Math.max(0, ARENA_GRACE_MS - (this.time.now - p.arenaOutsideSince)) : null })),
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
        if (!p.alive){ p.arenaOutsideSince = 0; updateArenaWarningVisual(p, null, time); continue; }
        const outside = (p.row < b.minR || p.row > b.maxR || p.col < b.minC || p.col > b.maxC);
        if (outside){
          // Start (or keep running) this player's grace window the moment
          // they're caught outside the safe zone — they only actually take
          // a hit once the whole window has elapsed, giving them a chance
          // to dash back in first instead of dying the instant a shrink
          // catches them.
          if (!p.arenaOutsideSince) p.arenaOutsideSince = time;
          const remaining = ARENA_GRACE_MS - (time - p.arenaOutsideSince);
          if (remaining <= 0){
            if (!(p.invulnerableUntil && time < p.invulnerableUntil)) this.hitPlayer(p, time);
            p.arenaOutsideSince = time; // still outside: restart the window for the next hit
          }
          updateArenaWarningVisual(p, Math.max(0, remaining), time);
        } else {
          p.arenaOutsideSince = 0;
          updateArenaWarningVisual(p, null, time);
        }
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

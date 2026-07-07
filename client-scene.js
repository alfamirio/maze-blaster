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


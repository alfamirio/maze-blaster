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
  // `resolution` is pinned to 1 (not window.devicePixelRatio) on purpose:
  // TILE is now tuned for a 1080p-class logical canvas (see config.js), and
  // multiplying that by devicePixelRatio (2-3 on most phones) would make the
  // backing buffer several times larger than the screen can actually show —
  // pure wasted fill-rate with no visible sharpness benefit for a flat-shaded
  // arcade board like this one. Scale.FIT still upscales via CSS to fill
  // whatever screen it's on; this only controls the canvas's own buffer size.
  return {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#111',
    scene: SceneClass,
    resolution: 1,
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
// Live FPS readout, shown next to the seed once a match is on screen. Reads
// Phaser's own smoothed frame-rate counter (currentGame.loop.actualFps)
// rather than hand-rolling one, and polls it on an interval independent of
// any scene's update() so it keeps working across host/client scene swaps.
function updateFpsDisplay(){
  const el = document.getElementById('fps-display');
  if (!currentGame || document.getElementById('game-wrap').classList.contains('hidden')){
    el.classList.add('hidden');
    return;
  }
  const fps = Math.round(currentGame.loop.actualFps);
  el.textContent = fps + ' FPS';
  el.classList.remove('hidden');
  el.classList.toggle('fps-low', fps < 50 && fps >= 30);
  el.classList.toggle('fps-critical', fps < 30);
}
setInterval(updateFpsDisplay, 500);
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

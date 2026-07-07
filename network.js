// ====================== NETWORKING ======================
class NetManager {
  constructor(){
    this.peer = null;
    this.isHost = false;
    this.myIndex = 0;
    this.myToken = null;    // client: this browser's persistent reconnect token
    // Host keeps fixed 3-slot bookkeeping (slot i => player index i+1) instead
    // of an append-only list, so a returning player can be matched back to
    // their original slot by token rather than always taking a fresh one.
    this.conns = [null, null, null];         // host: live DataConnection per slot (or null)
    this.tokens = [null, null, null];        // host: the token that "owns" each slot once claimed
    this.reconnectDeadline = [0, 0, 0];      // host: wall-clock ms deadline while a slot's conn is down (0 = not pending)
    this.hostConn = null;  // client: connection to host
    this.names = [null, null, null, null]; // display name per player index (null = use default P1/P2/...)
    this.onPlayerJoined = null;
    this.onReconnect = null; // host: (playerIndex) — fired when a previously-dropped slot returns
    this.onNameUpdate = null; // host: (playerIndex) — fired when a client's name arrives/changes
    this.onDisconnect = null;
    this.onInput = null;   // host: (playerIndex, data)
    this.onStart = null;   // client: (data)
    this.onState = null;   // client: (data)
    this.onHostLost = null;     // client: () — fired when the connection to the host drops unexpectedly
    this.onHostRestored = null; // client: () — fired once auto-reconnect succeeds
    this._reconnecting = false;
    this._lastHostId = null;
    // Network stats: only the host actively measures latency (it pings each
    // client and times the reply), then piggybacks the results onto the
    // state snapshot it's already broadcasting so clients can see everyone's
    // ping — including their own — without running a second ping loop.
    this.pingMs = [null, null, null]; // host: latest RTT (ms) per slot 0-2, null until first measurement lands
    this._pingIntervalId = null;
  }

  connectedCount(){ return this.conns.filter(c => !!c).length; }

  hostGame(onReady, onError){
    this.isHost = true;
    this.myIndex = 0;
    this.names = [null, null, null, null];
    this.names[0] = (typeof PLAYER_NAME !== 'undefined' && PLAYER_NAME) ? PLAYER_NAME : null;
    this.conns = [null, null, null];
    this.tokens = [null, null, null];
    this.reconnectDeadline = [0, 0, 0];
    this.pingMs = [null, null, null];
    if (this._pingIntervalId) clearInterval(this._pingIntervalId);
    // Every 2s, ping whichever slots currently have a live connection. Each
    // client just echoes the timestamp straight back (see the 'ping' branch
    // below), so this measures true round-trip time over the DataConnection.
    this._pingIntervalId = setInterval(() => {
      for (const c of this.conns) if (c && c.open) c.send({ t:'ping', ts: Date.now() });
    }, PING_INTERVAL_MS);
    this.peer = new Peer();
    this.peer.on('open', id => onReady(id));
    this.peer.on('error', err => onError && onError(err));
    this.peer.on('connection', conn => {
      conn.on('data', data => {
        if (data.t === 'join'){
          // Seat this connection by token: a token already on file means a
          // previously-dropped player reclaiming their old slot rather than
          // a brand-new arrival taking the next open one.
          const token = data.token;
          let slot = token ? this.tokens.findIndex(t => t === token) : -1;
          const isReconnect = slot !== -1;
          if (!isReconnect){
            slot = this.tokens.findIndex(t => t === null);
            if (slot === -1){ conn.close(); return; } // room full (max 3 clients)
            this.tokens[slot] = token || null;
          }
          conn._slot = slot;
          this.conns[slot] = conn;
          this.reconnectDeadline[slot] = 0;
          const idx = slot + 1;
          const nm = data.name && String(data.name).trim();
          this.names[idx] = nm ? nm.slice(0, 16) : (this.names[idx] || null);
          conn.send({ t:'welcome', index: idx });
          if (isReconnect){ if (this.onReconnect) this.onReconnect(idx); }
          else if (this.onPlayerJoined) this.onPlayerJoined(idx);
          if (this.onNameUpdate) this.onNameUpdate(idx);
        } else if (data.t === 'input' && this.onInput){
          if (conn._slot != null) this.onInput(conn._slot + 1, data);
        } else if (data.t === 'pong'){
          if (conn._slot != null) this.pingMs[conn._slot] = Date.now() - data.ts;
        }
      });
      conn.on('close', () => {
        const slot = conn._slot;
        if (slot == null) return;
        if (this.conns[slot] === conn) this.conns[slot] = null;
        // Don't eliminate them yet — give them a grace window to reconnect
        // (same token) before treating the slot as truly abandoned.
        this.reconnectDeadline[slot] = Date.now() + RECONNECT_GRACE_MS;
        if (this.onDisconnect) this.onDisconnect(slot + 1);
      });
    });
  }

  joinGame(hostId, onReady, onError){
    this.isHost = false;
    this._lastHostId = hostId;
    this.peer = new Peer();
    this.peer.on('error', err => onError && onError(err));
    this.peer.on('open', () => this._connectToHost(hostId, onReady, onError));
  }

  _connectToHost(hostId, onReady, onError, isRetryAttempt){
    const conn = this.peer.connect(hostId, { reliable: true });
    this.hostConn = conn;
    let settled = false; // true once this attempt actually opens
    conn.on('open', () => {
      settled = true;
      const nm = (typeof PLAYER_NAME !== 'undefined' && PLAYER_NAME) ? PLAYER_NAME : null;
      conn.send({ t:'join', name: nm, token: this.myToken });
      const wasReconnecting = this._reconnecting;
      this._reconnecting = false;
      if (wasReconnecting && this.onHostRestored) this.onHostRestored();
      onReady();
    });
    conn.on('data', data => {
      if (data.t === 'welcome') this.myIndex = data.index;
      else if (data.t === 'start' && this.onStart){ if (data.names) this.names = data.names; this.onStart(data); }
      else if (data.t === 'state' && this.onState) this.onState(data);
      else if (data.t === 'ping') conn.send({ t:'pong', ts: data.ts });
    });
    conn.on('close', () => {
      // A connection that was genuinely open and then dropped kicks off (or
      // continues) the auto-reconnect loop. A retry attempt that never even
      // managed to open just needs to try again — reported straight back to
      // whoever's driving the retry loop, not through _handleHostDrop (which
      // would otherwise no-op since we're already mid-retry and stall it).
      if (settled) this._handleHostDrop(onError);
      else if (isRetryAttempt && onError) onError(new Error('connection closed before opening'));
    });
    conn.on('error', err => {
      if (settled) return; // 'close' already covers the genuinely-open case
      if (onError) onError(err);
    });
  }

  // Fired when the DataConnection to the host closes mid-game (e.g. a wifi
  // blip). Rather than surfacing this as a fatal error, quietly retries the
  // connection for a while — matching the host's own reconnect grace period
  // — using the same persistent token so the host seats us back in our old
  // slot instead of treating us as a new player.
  _handleHostDrop(onError){
    if (this._reconnecting) return; // already retrying
    if (this.myIndex === 0) return; // hosts don't join themselves
    this._reconnecting = true;
    if (this.onHostLost) this.onHostLost();
    this._retryReconnect(0, onError);
  }

  _retryReconnect(attempt, onError){
    if (!this._reconnecting) return; // reconnect already succeeded elsewhere
    if (attempt >= RECONNECT_MAX_ATTEMPTS){ // matches RECONNECT_GRACE_MS at RECONNECT_RETRY_INTERVAL_MS apart
      this._reconnecting = false;
      if (this.onHostLost) this.onHostLost('failed');
      return;
    }
    setTimeout(() => {
      if (!this._reconnecting) return;
      const retryAgain = () => this._retryReconnect(attempt + 1, onError);
      try {
        if (this.peer && !this.peer.destroyed && this.peer.open){
          this._connectToHost(this._lastHostId, () => {}, retryAgain, true);
        } else {
          this.peer = new Peer();
          this.peer.on('open', () => this._connectToHost(this._lastHostId, () => {}, retryAgain, true));
          this.peer.on('error', retryAgain);
        }
      } catch (e){ retryAgain(); }
    }, RECONNECT_RETRY_INTERVAL_MS);
  }

  broadcastStart(payload){ for (const c of this.conns) if (c) c.send(Object.assign({ t:'start', names: this.names.slice() }, payload)); }
  broadcastState(payload){ for (const c of this.conns) if (c) c.send(Object.assign({ t:'state' }, payload)); }
  sendInput(data){ if (this.hostConn) this.hostConn.send(Object.assign({ t:'input' }, data)); }
}

const net = new NetManager();
// A persistent per-browser id so that if this tab's connection to the host
// drops and reconnects, the host recognizes it as the same returning player
// instead of a brand-new one. Survives page reloads (but is unique enough
// that joining an unrelated game later is never mistaken for a reconnect).
(function initReconnectToken(){
  const KEY = 'mb_reconnect_token';
  let t;
  try { t = localStorage.getItem(KEY); } catch (e){ t = null; }
  if (!t){
    t = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(KEY, t); } catch (e){ /* ignore (private browsing etc.) */ }
  }
  net.myToken = t;
})();
// Returns a player's custom display name if one was set (host, in-game
// broadcast to all clients), otherwise the default 'P1'/'P2'/etc label.
function playerDisplayName(i){
  const nm = net.names && net.names[i];
  return (nm && String(nm).trim()) ? String(nm).trim() : 'P'+(i+1);
}
let NET_NUM_PLAYERS = 1;
let NET_BOT_COUNT = 0; // solo mode only: players 1..NET_BOT_COUNT are AI-controlled
// solo mode only: personality key per bot slot (index 0 = bot slot 1 = player
// index 1, etc.), chosen per-bot in the lobby. Falls back to 'classic' for any
// slot left unset.
let NET_BOT_PERSONALITIES = [];
let NET_BLOCKS_GRID = null;
let NET_PILLARS = true;     // client-side mirror of the host's scenario.pillars flag
let NET_TELEPORTERS = [];   // client-side mirror of the host's _teleporterPairsList (visuals only)
let NET_FOG_OF_WAR = false;      // client-side mirror of the host's scenario.fogOfWar flag
let NET_SHRINKING_ARENA = false; // client-side mirror of the host's scenario.shrinkingArena flag
let NET_DAY_NIGHT_CYCLE = false; // client-side mirror of the host's scenario.dayNightCycle flag
let NET_IS_SOLO = false;    // true only for "Play Solo" runs — enables move recording/export
let MATCH_SEED_CONSUMED = false; // reset to false whenever a fresh match is (re)launched from the lobby
let activeHostScene = null; // reference to the live HostScene instance, for the export button
let currentGame = null; // reference to the live Phaser.Game instance, so we can force a re-fit on resize/rotate
window.addEventListener('resize', () => { if (currentGame) currentGame.scale.refresh(); });
window.addEventListener('orientationchange', () => { if (currentGame) setTimeout(() => currentGame.scale.refresh(), 100); });

// ====================== HOST SCENE (authoritative) ======================

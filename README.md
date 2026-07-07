# Maze Blaster Online

A host-authoritative, multiplayer Bomberman-style grid game built with Phaser 4 and PeerJS.
It features real-time network play via WebRTC, twelve selectable map scenarios (including
teleporters, fog of war, a shrinking arena, and a day/night cycle), seven distinct bot
personalities, and reconnect-aware networking.

---

## Features

* **Multiplayer & solo modes:** Play against up to three local AI bots, or host a room for up
  to three other real players (four total) over the internet.
* **Host-authoritative architecture:** Prevents desyncs by executing all game logic (movement
  validation, collision, bomb timers, explosions, and power-up collection) on the host browser.
  Clients only render snapshots and send input.
* **Map scenarios:** Twelve built-in map presets — Standard, Open Arena, Sudden Death, Crate
  Rush, Minimalist, Teleporters, Portal Chaos, Fog of War, Day/Night Cycle, Shrinking Arena,
  Power-up Frenzy, and a fully **Custom** scenario with adjustable pillars, crate density,
  power-up chance, teleporter pairs, fuse speed, extra blast range, fog of war, and shrinking
  arena toggles.
* **Deterministic map seeds:** Every map is generated from a shareable seed string — reroll a
  new one, or paste someone else's to reproduce their exact crate/teleporter layout for a given
  scenario, map size, and player count.
* **Bot AI with 7 personalities:** Classic, Hunter, Camper, Chaotic, Coward, Hoarder, and
  Ambusher — each layered on the same shared BFS pathfinding and danger-avoidance core, so no
  bot ever walks into fire on purpose, but each pursues, defends, or sets traps differently.
* **Dynamic power-ups (and power-downs):** Destroying wooden blocks can drop extra bombs, blast
  range, speed, a heart (extra life/shield), kick, pierce, a Remote Bomb detonator, a
  Proximity Mine, or — less happily — a curse that temporarily reverses your controls, slows
  you down, or forces you to drop bombs automatically.
* **Extra combat abilities:** Kick a placed bomb to send it sliding, or use a Remote Bomb
  (place-then-detonate on command) or a Proximity Mine (place-and-forget) as alternatives to
  the standard bomb.
* **Cross-platform support:** Fully playable on desktop via keyboard and mobile devices via
  built-in virtual touch controls (D-pad plus bomb/kick/remote-detonate/mine buttons).
* **Configurable options menu:** Set your display name, map size (11×7 up to 19×15), overall
  game speed (very slow to very fast), sound on/off, and an FPS cap (10/15/20/30) for lower-end
  devices. Choices are saved locally in the browser and persist between sessions.
* **QR code join:** Hosting a room shows a scannable QR code alongside the room code, so other
  players on mobile can join instantly without typing anything.
* **Resilient networking:** Dropped clients get a grace window to automatically reconnect into
  their original player slot using a persistent per-browser token, with a banner shown while
  reconnecting. A live ping readout for each connected player is shown in the HUD.
* **Sound effects:** Built entirely with the Web Audio API — no external audio assets required.
* **Move export (solo mode):** Solo games can be exported as a JSON recording of every move,
  bomb, curse, and death event, timestamped against the match clock.

---

## Technical Architecture

* **Framework:** Phaser 4.2.0 for canvas rendering, tweening, and input handling.
* **Networking:** PeerJS 1.5.4 for peer-to-peer WebRTC data channels.
* **State synchronization:** The host broadcasts state snapshots to all clients at roughly 12Hz
  (`80ms` intervals). Clients interpolate between snapshots for smooth visual rendering and send
  raw inputs back to the host. The host also pings each client every 2 seconds to measure and
  display round-trip latency.
* **Reconnection:** Each browser tab persists a random token in `localStorage`. If a client's
  connection drops mid-match, the host holds their slot open for a grace period, and the client
  automatically retries the connection using the same token so it's reseated into its original
  player slot rather than treated as a new join.
* **Bot AI:** Driven by a Breadth-First Search (BFS) pathfinding algorithm combined with a
  threat map matrix. Bots dynamically identify safe cells, run away from active bomb blast
  lines, and — depending on personality — hunt players, camp a home corner, chase power-ups,
  set ambush traps, or flee unpredictably. Think intervals are throttled (faster while in
  danger, slower while idle) and vary slightly by personality so bots don't all react in
  lockstep.
* **Rendering resolution:** The board is drawn at a fixed logical resolution close to native 4K
  height and scaled to fit the viewport (`Phaser.Scale.FIT`), so it looks sharp on everything
  from a phone to a large monitor.
* **QR codes:** Generated client-side with qrcodejs; encodes a joinable URL with the room code
  as a query parameter for one-scan joining.

---

## Controls

| Action | Keyboard | Touch UI |
| --- | --- | --- |
| **Movement** | `WASD` / Arrow keys | On-screen directional D-pad |
| **Drop bomb** | `Space` / `Enter` | Red bomb button |
| **Kick bomb** | `K` | Yellow kick button |
| **Remote Bomb (place / detonate)** | `F` | Purple RMT button |
| **Proximity Mine (place / detonate)** | `M` | Orange mine button |
| **Restart game** | `Alt+R` *(Host / Solo only)* | — |

---

## Project Structure

The game is split into a small set of static files that all need to stay together in the same folder:

| File | Contents |
| --- | --- |
| `index.html` | Page markup, links to `styles.css`, loads the CDN libraries and the JS modules below in order |
| `styles.css` | All styling for the lobby, HUD, and touch controls |
| `config.js` | Shared config, map scenarios, seed helpers, speed/FPS settings, power-up drop weights, bot personality definitions |
| `audio.js` | Web Audio API sound effects (synthesized, no audio files) |
| `visuals.js` | Power-up, teleporter, bomb, and explosion graphics |
| `input.js` | Touch control state and keyboard input helpers |
| `board.js` | Board/tile drawing, fog of war, shrinking arena, HUD |
| `bot-ai.js` | Solo-mode bot pathfinding and personality-driven decision-making |
| `network.js` | `NetManager` — PeerJS connection handling, reconnect logic, ping measurement |
| `host-scene.js` | `HostScene` — authoritative game logic (the host browser) |
| `client-scene.js` | `ClientScene` — rendering + input only (non-host browsers) |
| `lobby.js` | Lobby UI wiring: map/mode pickers, QR join, options, FPS display |

The JS files are plain (non-module) scripts that share a global scope, so `index.html` loads
them in the exact order listed above — later files depend on globals defined earlier.

---

## How to Run

1. Download the full set of files listed above into a single folder (they must sit alongside
   each other — `index.html` references the rest by relative path).
2. Open `index.html` directly in any modern web browser (requires an active internet connection
   to contact the public PeerJS signaling server, and to load Phaser/PeerJS/qrcodejs from their
   CDNs).
3. **To play solo:** Pick a map scenario and seed, choose the number of bots and a personality
   for each, then click **Play Solo**. An **Export moves (JSON)** button appears in-game to
   download a recording of the match once it's over.
4. **To play multiplayer:** One player clicks **Host Game** and shares the generated room code
   or QR code. Client players enter the code into the input field (or scan the QR code, which
   joins automatically) and click **Join Game**. Once all players join, the host clicks
   **Start Game**.
5. **Options:** Click **⚙ Options** from the lobby to set your display name, map size, game
   speed, sound, and FPS cap before starting a Solo or Hosted game.

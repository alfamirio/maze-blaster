# Maze Blaster Online

A host-authoritative, multiplayer Bomberman-style grid game built with Phaser 4 and PeerJS.
It features real-time network play via WebRTC and an autonomous pathfinding bot AI for solo play.

---

## Features

* **Multiplayer & solo modes:** Play against up to three local AI bots or host a room for up to four real players over the internet.
* **Host-authoritative architecture:** Prevents desyncs by executing all game logic (movement validation, collision, bomb timers, and power-up collection) on the host browser.
* **Cross-platform support:** Fully playable on desktop via keyboard and mobile devices via built-in virtual touch controls.
* **Dynamic power-ups (and power-downs):** Destroying wooden blocks randomly drops items that increase bomb capacity, blast radius, or move speed — or, less happily, a "curse" pickup that temporarily reverses your controls, slows you down, or forces you to drop bombs automatically.
* **Configurable options menu:** Choose map size (from 11×7 up to 19×15), overall game speed (very slow to very fast), and toggle sound on/off. Choices are saved locally in the browser and persist between sessions.
* **QR code join:** Hosting a room shows a scannable QR code alongside the room code, so other players on mobile can join instantly without typing anything.
* **Sound effects:** Built entirely with the Web Audio API — no external audio assets required.
* **Move export (solo mode):** Solo games can be exported as a JSON recording of every move, bomb, curse, and death event, timestamped against the match clock.

---

## Technical Architecture

* **Framework:** Phaser 4.2.0 for canvas rendering, tweening, and input handling.
* **Networking:** PeerJS 1.5.4 for peer-to-peer WebRTC data channels.
* **State synchronization:** The host broadcasts state snapshots to all clients at roughly 12Hz (`80ms` intervals). Clients handle smooth visual rendering based on snapshots and send raw inputs back to the host.
* **Bot AI:** Driven by a Breadth-First Search (BFS) pathfinding algorithm combined with a threat map matrix. Bots dynamically identify safe cells, run away from active bomb radius lines, and actively hunt down nearby blocks and players.
* **Rendering resolution:** The board is drawn at a fixed logical resolution close to native 4K height and scaled to fit the viewport (`Phaser.Scale.FIT`), so it looks sharp on everything from a phone to a large monitor.
* **QR codes:** Generated client-side with qrcodejs; encodes a joinable URL with the room code as a query parameter for one-scan joining.

---

## Controls

| Action | Keyboard | Touch UI |
| --- | --- | --- |
| **Movement** | `WASD` / Arrow keys | On-screen directional D-pad |
| **Drop bomb** | `Space` / `Enter` | Virtual red bomb button |
| **Restart game** | `Alt+R` *(Host / Solo only)* | — |

---

## Project Structure

The game is split into a small set of static files that all need to stay together in the same folder:

| File | Contents |
| --- | --- |
| `index.html` | Page markup, links to `styles.css`, loads the CDN libraries and the JS modules below in order |
| `styles.css` | All styling for the lobby, HUD, and touch controls |
| `config.js` | Shared config, map scenarios, RNG/seed helpers, speed settings, power-up drop weights |
| `audio.js` | Web Audio API sound effects (synthesized, no audio files) |
| `visuals.js` | Power-up, teleporter, bomb, and explosion graphics |
| `input.js` | Touch control state and keyboard input helpers |
| `board.js` | Board/tile drawing, fog of war, shrinking arena, HUD |
| `bot-ai.js` | Solo-mode bot pathfinding and decision-making |
| `network.js` | `NetManager` — PeerJS connection handling |
| `host-scene.js` | `HostScene` — authoritative game logic (the host browser) |
| `client-scene.js` | `ClientScene` — rendering + input only (non-host browsers) |
| `lobby.js` | Lobby UI wiring: map/mode pickers, QR join, options |

The JS files are plain (non-module) scripts that share a global scope, so `index.html` loads them in the exact order listed above — later files depend on globals defined earlier.

---

## How to Run

1. Download the full set of files listed above into a single folder (they must sit alongside each other — `index.html` references the rest by relative path).
2. Open `index.html` directly in any modern web browser (requires an active internet connection to contact the public PeerJS signaling server, and to load Phaser/PeerJS/qrcodejs from their CDNs).
3. **To play solo:** Select the number of bots and click **Play Solo**. An **Export moves (JSON)** button appears in-game to download a recording of the match once it's over.
4. **To play multiplayer:** One player clicks **Host Game** and shares the generated room code or QR code. Client players enter the code into the input field (or scan the QR code, which joins automatically) and click **Join Game**. Once all players join, the host clicks **Start Game**.
5. **Options:** Click **⚙ Options** from the lobby to set map size, game speed, and sound before starting a Solo or Hosted game.

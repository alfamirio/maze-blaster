# Maze Blaster Online

A host-authoritative, multiplayer Bomberman-style grid game built with Phaser 4 and PeerJS. 
It features real-time network play via WebRTC and an autonomous pathfinding bot AI for solo play.

---

## Features

* **Multiplayer & solo modes:** Play against up to three local AI bots or host a room for up to four real players over the internet.
* **Host-authoritative architecture:** Prevents desyncs by executing all game logic (movement validation, collision, bomb timers, and power-up collection) on the host browser.
* **Cross-platform support:** Fully playable on desktop via keyboard and mobile devices via built-in virtual touch controls.
* **Dynamic power-ups:** Destroying wooden blocks randomly drops items to increase bomb capacity or blast radius.

---

## Technical Architecture

* **Framework:** Phaser 4 for canvas rendering, tweening, and input handling.
* **Networking:** PeerJS for peer-to-peer WebRTC data channels.
* **State synchronization:** The host broadcasts state snapshots to all clients at roughly 12Hz (`80ms` intervals). Clients handle smooth visual rendering based on snapshots and send raw inputs back to the host.
* **Bot AI:** Driven by a Breadth-First Search (BFS) pathfinding algorithm combined with a threat map matrix. Bots dynamically identify safe cells, run away from active bomb radius lines, and actively hunt down nearby blocks and players.

---

## Controls

| Action | Keyboard | Touch UI |
| --- | --- | --- |
| **Movement** | `WASD` / Arrow keys | On-screen directional D-pad |
| **Drop bomb** | `Space` / `Enter` | Virtual red bomb button |
| **Restart game** | `R` *(Host / Solo only)* | — |

---

## How to Run

1. Save the source code into an `index.html` file.
2. Open the file directly in any modern web browser (requires an active internet connection to contact the public PeerJS signaling server).
3. **To play solo:** Select the number of bots and click **Play Solo**.
4. **To play multiplayer:** One player clicks **Host Game** and shares the generated room code. Client players enter the code into the input field and click **Join Game**. Once all players join, the host clicks **Start Game**.

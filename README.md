# Rumble Isle

An original, browser-based, top-down multiplayer battle royale. Drop onto the island, loot up, outlast the storm, be the last one standing.

- **Solo / Duos** (knock + revive), quick-play matchmaking, private lobbies with invite code + link
- **Authoritative server** — clients only send inputs; movement, hits, ammo, inventory, health and the win are decided on the server
- Client-side prediction with reconciliation, snapshot interpolation, reconnection, spectating
- 8 configurable weapons in 5 classes × 5 rarities, ammo, heals, shields, grenades, dash
- Procedural island with 10 named locations, enterable buildings, bushes that hide you, a river and bridges
- Bots fill empty slots, so a match is always playable
- All art is drawn on canvas and all audio is synthesised — no asset files

## Run it

```bash
npm install
npm run dev      # server on :3000 + Vite client on http://localhost:5173
```

Production (one Node process serves the game and the client):

```bash
npm run build
npm start        # http://localhost:3000   (PORT env var to change)
```

Or `docker build -t rumble-isle . && docker run -p 3000:3000 rumble-isle`. Any host that runs a Node container with WebSockets works (Render, Railway, Fly.io…). To play with friends, deploy it, open the site, **Create private lobby**, and share the invite link.

```bash
npm test         # 24 tests: simulation rules, full bot matches, real-socket multiplayer
npm run typecheck
```

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Mouse / Left click | Aim / Shoot |
| R | Reload |
| E | Pick up · hold to revive a teammate |
| Space | Dash (6 s cooldown) |
| 1 · 2 · Q · wheel | Switch weapon |
| 3 · 4 · 5 | Bandage · Medkit · Shield Cell |
| G | Throw Boom Berry (grenade) at the cursor |
| X | Drop weapon |
| M / Tab | Map |

## Architecture

```
shared/   pure TypeScript, no I/O — imported by both sides
  config.ts    every tunable number: weapons, items, storm stages, speeds
  map.ts       seeded island generator + collision grid + raycasts
  sim.ts       the Game class: the entire rule set, tick-based and deterministic
  bots.ts      bot AI (plays through the same input API as humans)
  protocol.ts  wire types
server/   Node + Express + Socket.IO
  app.ts       sessions, matchmaking, message validation, rate limiting
  room.ts      lobby + 30 Hz match loop, per-player snapshots (interest + bush visibility)
client/   React + Zustand + Canvas 2D
  game/client.ts  input, prediction/reconciliation, interpolation, effects, rendering
  game/draw.ts    all artwork        game/audio.ts  all sound
  ui/             menu, lobby, HUD, landing map, end screen
tests/    vitest
```

**Netcode.** The server ticks at 30 Hz and sends each player a 15 Hz snapshot containing only what they are allowed to see. Clients send one input per tick; the server applies at most a small budget of inputs per tick, so flooding inputs cannot speed you up. The local player is predicted with the same `applyMove()` the server runs and reconciled on every snapshot; other players are interpolated ~100 ms in the past. Bullets are simulated on the server only.

**Tuning.** Change weapon stats, loot weights, storm timing or player speed in `shared/config.ts` — both sides pick it up.

**Persistence.** There are no accounts and no database: profile, cosmetics and career stats live in the browser's localStorage. PostgreSQL would be the place for accounts, friends lists and leaderboards if you add them.

**Scaling.** Each match is an isolated `Room` (~0.05 ms CPU per tick for 16 players). One process comfortably hosts many rooms; to go beyond one machine, run several instances behind a load balancer with sticky sessions and route invite codes to the instance that owns the room.

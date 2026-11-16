# Battleship — Working Specification v0.1

## Decisions
- Host: Colossus home server, trusted LAN only.
- Stack: PHP 8.2+, PDO SQLite, vanilla HTML/CSS/JavaScript.
- Style: Modern Naval Command; dark navy, cyan grids, tactical status, clear shot feedback.
- Players: passwordless Chess Club-style named player selection; identity stored per browser tab and supplied in request header (LAN-only trust model).
- Game creation defaults: **North Atlantic**, **human**, **Classic (10×10)**.
- Two human browsers may create/join and resume a game.
- Adjacent ships allowed; overlap prohibited.
- One shot per turn (including following hits); server determines winner.
- Fleets: Classic 10×10 = 5,4,3,3,2; Skirmish 8×8 = 4,3,2; Grand Fleet 12×12 = 5,4,4,3,3,2.
- Target board cannot reveal enemy fleet until game finishes.
- Human-vs-human game flow: waiting -> deployment -> active -> finished.
- Host can ready while waiting; game begins when guest joins and both are ready.
- No premature forfeits for lost browser connections.
- Future: 6 generic AI levels, flexible custom fleets, stats including accuracy, AI-only tournaments, AI probability heatmaps.

## Server API
GET `public/api.php?action=players`: list player names and current session.
POST `?action=select` `{"name":"Dad"}`: set player identity.
GET `?action=lobby`: waiting games and games belonging to current player.
POST `?action=create` `{"name":"North Atlantic","size":10}`.
POST `?action=join` `{"id":1}`.
GET `?action=game&id=1`: filtered player-visible state.
POST `?action=randomize` `{"id":1}`: reroll own fleet before ready.
POST `?action=place` `{"id":1,"ship":0,"x":2,"y":4,"direction":"horizontal"}`: reposition one own ship before Ready; server validates length, bounds and overlaps.\nPOST `?action=ready` `{"id":1}`: lock own fleet.
POST `?action=fire` `{"id":1,"x":3,"y":5}`: fire one shot, zero-indexed.
GET `?action=stats`: player finished-game counts and wins.

## Model
- `players`: name and id.
- `games`: players, status, turn, winner, serialized private fleet state.
- `shots`: shot coordinate, shooter, result, unique by shooter/coordinate/game.

The server never uses browser-submitted fleet state. SQLite writers use IMMEDIATE transactions when joining or firing to avoid race conditions. All HTML-bound names are escaped.

## Development stages
1. **Current:** minimal two-human game, auto-placement, rules and persistence.
2. **Current:** manual ship placement via left-drag, Space rotation, live validity preview, server validation. Automated integration testing still needed.
3. Six AI levels behind the same legal-shot interface; human-vs-AI games.
4. Custom board sizes and fleet editor with validation.
5. Tournament batch runner, telemetry and probability heatmap.
6. Deployment hardening, cleanup, service configuration, backup plan.

## Non-goals for initial milestone
- Password accounts, Internet exposure, chat, sounds, custom ship imagery, synchronous WebSockets, spectator accounts.
- AI opponents and tournaments are deliberately **not yet available**.

# Battleship — Naval Command

Browser-based Battleship for Colossus, using PHP 8.2+, SQLite, and vanilla JavaScript.

## Status
**v0.1 foundation (work in progress).** Human-versus-human games with server-controlled turns, automatic fleet deployment, lobby, and basic statistics. AI, custom fleets, tournaments, and heatmaps are planned, not yet implemented.

## Run locally
Requires PHP with the `pdo_sqlite` extension.

```bash
git clone https://github.com/Arnbargler/battleship.git
cd battleship
php -S 0.0.0.0:8090 -t public
```

Visit `http://colossus.local:8090` (or your server IP). Storage is initialized automatically under `data/`; the database is deliberately **outside the web root**. Do not expose the prototype to the public Internet: player selection is passwordless and intended for a trusted LAN.

## Usage
Choose or create a player name. Create a new operation (default **North Atlantic**, 10×10 Classic, human opponent). Open another browser using a different player to join. Each player automatically receives a valid random fleet and clicks **Ready**; then alternate shots. Revisit the game to resume. Finished games remain available for results and statistics.

## Agreed roadmap
- Naval-command dark/cyan user interface
- Human players plus six generic AI levels (1–6)
- Flexible board sizes and fleets; classic five ships on 10×10 by default
- Ships may touch, but not overlap; one shot per turn
- Persistent games, player statistics
- AI-only tournaments and heatmap of AI target probabilities

See [docs/SPEC.md](docs/SPEC.md) for more detail.

## Security
The server validates all shots and ship positions, prevents self-joining, hides opponents' placements, and uses parameterized SQLite queries. Passwordless player selection is by design and does not establish strong player identity. Keep this behind a LAN/VPN.

## Deployment note
The PHP built-in server is for development, not a production deployment. Use an Apache/Nginx + PHP-FPM deployment for long-running hosting.

TERRITORY — FINAL NEW GAME START

This is the ONE-TIME fresh-game initialization.

Upload/replace ONLY these two files in the server GitHub repository:
  bootstrap.js
  wrangler.toml

Do NOT upload or execute the previous SQL reset packages.
Delete the old SQL reset file from GitHub if it is still there:
  TERRITORY-NEW-GAME-START-ONCE.zip
  RESET-ALL-PLAYERS.sql
  RESET-NEW-GAME-FOUNDATION-V2.sql

How it works:
- GitHub -> Cloudflare deploys automatically.
- bootstrap.js calls the existing TerritoryDB through Durable Object RPC.
- On the first request after this deployment, the DB is reset exactly once.
- The marker is stored inside the same SQLite Durable Object.
- Existing Telegram identity fields are preserved.
- Existing players become Level 1 / XP 0 / VIP 0 / Coins 0 / Gems 0 / HP 100/100.
- Player-specific test data is cleared.
- New players automatically receive the same clean initial game state.
- The reset cannot run again because the persistent marker is checked before every attempt.

No Cloudflare Data Studio action is required.

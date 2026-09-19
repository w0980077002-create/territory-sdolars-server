Territory G83 — SERVER AUTHORITY CORE

BASE: G82 SERVER.

GLOBAL PASS:
- Adds idempotent action IDs for server economy actions.
- Stores recent action responses in Durable Object SQLite to make retries safe.
- Protects server-authoritative economy fields from being overwritten by a generic client /api/save:
  coins, gems, combatStone, inventory.
- Keeps Telegram auth, /api/auth, /api/save, /api/action, /api/shop, webhook, Presence and Party.
- Server version: 1.4.0.

IMPORTANT:
- This does NOT make PvE or Arena server-authoritative yet.
- TELEGRAM_BOT_TOKEN remains a Cloudflare secret and is not included.

INSTALL:
Upload worker.js and wrangler.toml to the SERVER repository:
w0980077002-create/territory-sdolars-server

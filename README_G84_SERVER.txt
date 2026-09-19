Territory G84 — REAL MULTIPLAYER CORE

BASE: G83 SERVER AUTHORITY.

Adds a separate RoomHub Durable Object for real-time Arena rooms:
- 1x1, chaos and group rooms;
- up to 20 players for group/chaos;
- server-side room roster, teams and ready state;
- 3-minute room countdown metadata;
- owner-controlled start;
- server-side turn ownership;
- server-side attack/defense/target validation;
- individual HP and defeated-player lockout;
- server-side victory/defeat state and battle log;
- reconnect-safe room state persisted in Durable Object storage.

Keeps existing GameHub economy/auth and PresenceHub social realtime.
TELEGRAM_BOT_TOKEN remains a Cloudflare secret.

INSTALL to SERVER repo:
- worker.js
- wrangler.toml

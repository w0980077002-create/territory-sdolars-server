Territory G77 — REAL SERVER PRESENCE / PARTY FOUNDATION

BASE: existing territory-sdolars-server main.

CHANGED SERVER FILES:
- worker.js
- wrangler.toml

What G77 adds:
- WebSocket endpoint: /api/ws
- Telegram initData authentication over the socket
- real server-side online presence in a global Durable Object
- online player list with ready state
- ready/unready broadcast
- heartbeat ping/pong
- server-routed party_invite messages
- server-routed chat messages (prototype)
- /api/health now reports realtime=true and version 1.1.0

Existing server functions are preserved:
- /api/auth
- /api/save
- /api/health
- Telegram webhook endpoints
- Telegram initData verification
- GameHub per-player SQLite storage

IMPORTANT:
- This is a SERVER package. Upload these files to the SERVER repo:
  w0980077002-create/territory-sdolars-server
- Do NOT upload this ZIP to the GAME repo.
- TELEGRAM_BOT_TOKEN remains a Cloudflare secret and must NOT be committed.
- G76 client does not automatically use WebSocket yet; the next GAME bridge will connect it to /api/ws.
- Presence/Party are now real server infrastructure, but Arena gameplay is not yet moved server-authoritative.

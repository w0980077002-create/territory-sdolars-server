Territory G80 — SERVER AUTHORITATIVE ACTION GATEWAY

BASE: G77 SERVER.

This is a SERVER patch for territory-sdolars-server, not GAME.

Added:
- POST /api/action
- Telegram initData authentication remains mandatory.
- Server-side daily reward claim with one claim per UTC day.
- Server-side shop purchase for a small fixed prototype catalog.
- State mutation happens inside the player's Durable Object.
- Unsupported actions are rejected.

Prototype shop catalog:
- axe = 150 coins
- sword = 350 coins

Important:
- The client still has /api/save for compatibility.
- This does NOT yet make PvE/Arena authoritative; those require server-side battle state and validation.
- TELEGRAM_BOT_TOKEN remains a Cloudflare secret and must not be added to GitHub.
- Deploy this archive to SERVER repo territory-sdolars-server.

Next step: connect GAME to /api/action, then move battle results to server-controlled battle sessions.

Territory G82 — SERVER SHOP

BASE: G80 SERVER AUTH + G77 REALTIME.

SERVER ONLY.

Changes:
- Expanded authoritative shop catalog on the Worker.
- Added /api/shop read-only catalog endpoint.
- Server shop now supports weapon and equipment entries: axe, sword, helmet, armor, gloves, boots.
- /api/action with shop_buy remains Telegram-authenticated and deducts currency on the server.
- Purchase result returns the updated authoritative state and item metadata.
- Health version raised to 1.3.0 and reports serverShop=true.
- Existing Telegram auth, /api/auth, /api/save, /api/action daily reward, webhook, Durable Object and PresenceHub remain intact.

IMPORTANT:
- Upload this package to the SERVER repository: w0980077002-create/territory-sdolars-server.
- Do NOT upload it to GAME.
- TELEGRAM_BOT_TOKEN remains a Cloudflare secret and is not included here.
- G81 GAME can continue working; the existing shop_buy action remains compatible.

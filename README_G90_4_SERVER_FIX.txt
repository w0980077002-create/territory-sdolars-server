Territory G90.4 — SERVER DURABLE OBJECT COMPATIBILITY FIX

BASE: G90.3 server.

FIX:
- Keeps legacy Durable Object exports GameHub, PresenceHub and RoomHub so existing deployed namespaces remain valid.
- Keeps migrations v1-v3.
- Adds TerritoryDB as the new DB Durable Object with migration v4.
- Keeps the DB binding used by the current G90 server code.
- Keeps the daily tournament cron at 03:00 UTC.

INSTALL:
Upload/replace worker.js and wrangler.toml in:
w0980077002-create/territory-sdolars-server

IMPORTANT:
- Do NOT delete the Worker.
- Do NOT delete old Durable Objects.
- TELEGRAM_BOT_TOKEN / BOT_TOKEN and ADMIN_PASSWORD remain Cloudflare secrets and are not included here.

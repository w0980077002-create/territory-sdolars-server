Territory G90.5 — SERVER FIX

Purpose:
- Keep existing Durable Object class exports GameHub, PresenceHub, RoomHub so Cloudflare does not reject the Worker because existing namespaces are no longer exported.
- Add TerritoryDB as the new SQLite Durable Object.
- Preserve v1-v4 legacy migration history.
- Keep the 03:00 UTC cron.

FILES:
- worker.js
- wrangler.toml

INSTALL:
Replace worker.js and wrangler.toml in:
w0980077002-create/territory-sdolars-server

IMPORTANT:
Do not delete the old Worker or Durable Objects.
After uploading, wait for the Cloudflare build to appear. Do not manually retry a failed build until the build log is checked.

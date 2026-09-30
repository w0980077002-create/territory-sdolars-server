TERRITORY CLOUDFLARE FIX — v5 SQLite Durable Object migration

Cloudflare build log showed the real blocker:
new KV-backed Durable Object namespace was requested by migration v5 (new_classes = ["RoomHub"]).
The account/build is on Workers Free, where new Durable Objects must use SQLite storage.

Changed ONLY:
  v5: new_classes = ["RoomHub"]
into:
  v5: new_sqlite_classes = ["RoomHub"]

Do not change secrets or worker.js for this fix.
Commit this wrangler.toml to main and let Cloudflare Build deploy automatically.

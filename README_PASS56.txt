TERRITORY CLOUDFLARE FIX — PASS56

This package contains the corrected wrangler.toml only.

Reason:
- RoomHub was previously declared as legacy-kv in the known-good configuration.
- A later edit changed RoomHub to sqlite. Cloudflare Durable Object storage is immutable.
- That change can trigger storage_type_mismatch.
- RoomHubSQLite is the separate SQLite Arena namespace and remains bound to ARENA_HUB.
- GameHub and PresenceHub are preserved as existing legacy-kv namespaces.
- TerritoryDB remains SQLite.

Important:
worker.js on GitHub already contains the syntax correction for the earlier
`].join("");(request) {` error. This package intentionally does not replace
worker.js with an older attached copy.

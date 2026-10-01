TERRITORY — NEW GAME START / CORRECTED PASS 01

IMPORTANT:
Do not delete the repository.
Do not replace worker.js.

Replace ONLY:
  bootstrap.js
  wrangler.toml

This pass fixes the previous bootstrap issue by creating
territory_runtime_meta before the first SELECT.

It also normalizes NEW players created after the one-time reset
to the same clean starting values:
Level 1, XP 0, VIP 0, coins 0, gems 0, HP 100/100,
strength 5, agility 5, defense 0, weapon "Кулаки",
and the fresh initial game state.

The reset is protected by a persistent marker in the same
Durable Object SQLite database and is intended to run once only.

Do not perform any manual Cloudflare deployment.
GitHub -> Cloudflare handles deployment according to the
existing Git integration.

This package was statically checked with Node syntax validation.

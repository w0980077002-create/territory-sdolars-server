TERRITORY SERVER PRO — DEPLOY-SAFE

Rebuilt from the cumulative server worker.
The embedded admin JavaScript is now encoded as base64 at runtime instead of being stored as a giant escaped JS string. This removes the exact parser failure seen in Cloudflare builds (Unterminated string literal / Expected ';' but found 'card').

Changed: worker.js only.
No Durable Object bindings, migrations, secrets, routes, or game logic intentionally changed.

Validation:
- node --check worker.js: PASS
- ZIP integrity: PASS

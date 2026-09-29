TERRITORY SERVER — PASS55 WEBAPP FIX

Replace these two files in the root of GitHub repository:
- worker.js
- wrangler.toml

Do not upload this README if you do not want it.

Why this build exists:
- fixes the malformed giant ADMIN_APP_JS string that caused Cloudflare:
  worker.js:60:2341 — Unterminated string literal
- keeps PASS55 player_state API
- keeps Telegram Mini App web_app button
- worker.js passes node --check

TERRITORY PASS 54 — AUTH SERVER FOUNDATION

Node 18+; no external runtime dependencies.

ENV
TELEGRAM_BOT_TOKEN=...
PORT=10001
CORS_ORIGINS=https://your-game-domain.example
TERRITORY_DB_FILE=./data/players.json

RUN
npm start

ENDPOINTS
GET /health
GET /api/auth — validates Telegram initData and returns/creates the player.
POST /api/migrate — one-time compatibility import of the existing local guest profile.
GET /api/progress — returns server-authoritative profile state.

SECURITY
Telegram initData is HMAC-validated on the server using the bot token. Client POST /api/progress is intentionally NOT implemented: the next progression pass must add server-authoritative reward/progression mutations rather than trusting client balances.

LEGACY MIGRATION
The first localStorage import cannot be cryptographically proven because the old game was client-only. The server therefore marks it as a one-time legacy import. Do not use this migration path for purchases or future economy grants.

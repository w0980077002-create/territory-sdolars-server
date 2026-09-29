# Territory FOUNDATION-01A

This patch establishes the canonical player/state contract between Client and Server.

## Install

### Server
Copy the contents of `territory-sdolars-server/` over the server repository.

Required environment:
- `TELEGRAM_BOT_TOKEN`
- optional `PORT`
- optional `TERRITORY_DB_FILE`
- optional `CORS_ORIGINS`

Run:
`npm start`

### Client
Replace the existing:
`territory-telegram-auth-pass54.js`

with the patched file from this ZIP.

No `index.html` change is required because the existing project already loads that filename.

## What changed

- Server schema upgraded to version 3.
- One canonical player record.
- Explicit server-owned economy container.
- `/api/player` added.
- Existing `/api/auth`, `/api/state`, `/api/progress`, `/api/migrate` remain compatible.
- Client migration keeps local gameplay state on first login.
- Client never sends coins/gems/redGems as authoritative economy data.
- Server state sanitizer preserves more of the real Territory state.
- Telegram HMAC validation remains server-side.
- HTTP errors are no longer all returned as 401.
- No combat math was changed.
- No PvE rules were changed.
- No Arena rules were changed.

## Important

This is FOUNDATION-01A, not the final economy system.

The next foundation block should move rewards/purchases to explicit server events:
`FOUNDATION-01B — Economy Ledger`.

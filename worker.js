Territory G109 — DB diagnostic fix

Target file: worker.js

This package contains the exact DB diagnostic patch prepared against the current
GitHub worker.js. Apply the two marked insertions from the included patch text.

1) Add /db/test-simple inside TerritoryDB.fetch().
2) Add public /admin/db-test-simple before Telegram authentication.

The existing routes and bindings remain unchanged.

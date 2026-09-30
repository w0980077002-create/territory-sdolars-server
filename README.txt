TERRITORY SERVER FIX 15 — FOLLOWERS + ARENA STATE AUTHORITY

Based on SERVER FIX 14.

Changes:
- normal /api/state sync can no longer overwrite followers/activeFollower/arena state;
- fresh server state initializes Liabro as the owned active follower;
- Arena live result now updates server-owned arena battles/wins/losses/rating (+25 win / -20 loss), matching the existing client Arena result math;
- live Arena result still uses the existing server reward values and combat math;
- arena reward is idempotent by room_id + telegram_id;
- no PvE/battle math changes.

Upload worker.js to the Cloudflare Worker when ready.

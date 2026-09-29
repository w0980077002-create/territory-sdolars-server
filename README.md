# Territory — Cloudflare Hardening 10STEP

## Реальная база
Это пакет поверх найденного Cloudflare Worker G123/PASS55. Production URL из найденного manifest: `https://territory-sdolars-server.w0660077702.workers.dev`.

### 10 шагов
1. Клиентские `coins` больше не принимаются через `/api/progress`.
2. Клиентские `gems` больше не принимаются через `/api/progress`.
3. Серверный баланс возвращается после legacy sync.
4. Добавлен read-only `/api/economy`.
5. Arena reward остаётся серверным и идемпотентным по `room_id + telegram_id`.
6. Mail claim остаётся серверным.
7. Shop purchase остаётся серверным.
8. Telegram WebApp HMAC auth остаётся обязательным перед игровыми API.
9. Existing Durable Object bindings/migrations не изменяются.
10. Build marker поднят до G124 для проверки именно этой версии после выкладки.
11. Legacy `/api/progress` больше не принимает `level`/`exp` от клиента.
12. Добавлен серверный `/api/xp/award`.
13. XP-награды получают обязательный уникальный `reference` и становятся идемпотентными.
14. Формула уровня сохранена: `100 × текущий уровень` XP на следующий уровень.
15. Arena XP теперь также фиксируется в общем XP ledger.

## Важно
Production deployment НЕ выполнялся. Этот пакет — подготовленный source для ручной загрузки в Cloudflare. Secrets не меняются.

`level/exp` теперь серверные. Старый `/api/progress` принимает только совместимые боевые/profile-поля и игнорирует `level`/`exp`.

### Новый XP API
`POST /api/xp/award` после Telegram auth:
`{"amount":15,"source":"pve","reference":"pve:chapter:1:stage:1"}`

`reference` обязателен и уникален на игрока. Повтор той же награды возвращает `awarded:0` и `duplicate:true`.

Важно: клиент сам по себе не получает права назначать себе XP — источник должен вызывать этот endpoint как игровой event-контур; в следующем интеграционном пакете конкретные PvE/quest/reward источники будут переведены на него.

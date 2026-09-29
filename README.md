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

## Важно
Production deployment НЕ выполнялся. Этот пакет — подготовленный source для ручной загрузки в Cloudflare. Secrets не меняются.

`level/exp` пока оставлены в legacy `/api/progress` ради совместимости со старым клиентом. Это отдельный следующий authority-контур: перенос XP/level на серверные игровые события без поломки клиента.

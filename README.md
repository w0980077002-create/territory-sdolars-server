# Territory — FIRST LIVE TEST 01

Цель: довести первый живой тест до цепочки Telegram → Render → Cloudflare → игрок → PvE/Arena → сохранение.

## Что исправлено
- Telegram `/start` и `/game`: исправлена ссылка на реального бота `@TeritoryGameBot` (ранее была опечатка `@TeritoryGameBot`).
- Добавлен CORS для Render → Cloudflare WebApp API.
- Добавлены совместимые `/api/player`, `/api/economy`, `/api/state`, `/api/migrate`.
- `/api/progress` больше не принимает coins/gems/level/exp от клиента.
- Добавлены серверные PvE session/start/action/complete с nonce, таймаутом, минимальной длительностью, серверным уроном/победой, XP, наградой и loot.
- Добавлен `/api/health` с маркером FIRST-TEST-01.
- Сохранена текущая Cloudflare Arena RoomHub: живые игроки имеют приоритет, боты заполняют свободные места.

## Telegram
После деплоя один раз открыть:
`https://territory-sdolars-server.w0660077002.workers.dev/api/setup-telegram-webhook`

Проверка:
`https://territory-sdolars-server.w0660077002.workers.dev/api/telegram-webhook-info`

Ожидаем webhook:
`https://territory-sdolars-server.w0660077002.workers.dev/telegram/webhook`

## Cloudflare secrets
Не менять и не удалять существующие secrets. Нужен действующий `BOT_TOKEN` (или `TELEGRAM_BOT_TOKEN`) как в текущем Worker.

## Client
Файлы из `territory-game/` кладутся в корень Render-репозитория с заменой одноимённых файлов.
`territory-telegram-auth-pass54.js` по умолчанию направляет API на:
`https://territory-sdolars-server.w0660077002.workers.dev`

Новый `territory-live-arena-bridge.js` автоматически подключается после Telegram auth и перехватывает `ArenaGame.open()`, поэтому для первого теста не требуется менять index.html.

## Важно
Production deployment здесь НЕ выполнен. Сначала загрузить Worker в Cloudflare и дождаться успешного deploy, затем проверить webhook и Render.

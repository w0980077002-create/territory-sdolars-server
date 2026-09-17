SERVER2 — Telegram /start и /game

Заменить worker.js в репозитории:
w0980077002-create/territory-sdolars-server

После публикации Cloudflare должен автоматически задеплоить Worker.

Новый webhook endpoint:
https://territory-sdolars-server.w0660077702.workers.dev/telegram/webhook

Проверка текущего webhook:
https://territory-sdolars-server.w0660077702.workers.dev/api/telegram-webhook-info

Важно: TELEGRAM_BOT_TOKEN уже должен оставаться секретом Cloudflare и не добавляться в GitHub.

\nSERVER2 setup:
1. Replace worker.js in the SERVER repo.
2. Wait for Cloudflare deployment.
3. Open this address once in a browser:
https://territory-sdolars-server.w0660077702.workers.dev/api/setup-telegram-webhook
4. Then open @TerritoryGameBot and send /start.
5. The bot should answer with a 🎮 ИГРАТЬ button.

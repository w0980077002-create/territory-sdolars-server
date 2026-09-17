SERVER3 — исправление кнопки ИГРАТЬ

Что изменено:
- Исправлено имя Telegram-бота: TeritoryGameBot (одна r).
- Кнопка 🎮 ИГРАТЬ теперь использует:
  https://t.me/TeritoryGameBot?startapp

GAME не меняется.

Установка:
1. В репозитории SERVER замените worker.js этим файлом.
2. Дождитесь деплоя Cloudflare.
3. Откройте один раз:
   https://territory-sdolars-server.w0660077702.workers.dev/api/setup-telegram-webhook
4. В @TeritoryGameBot отправьте /start.
5. Нажмите 🎮 ИГРАТЬ и проверьте запуск Territory.

Секрет TELEGRAM_BOT_TOKEN в GitHub не добавлять.

# Territory Sdolars Server

Отдельный сервер для Telegram Mini App **Territory / Sdolars**.

## Что уже есть

- Проверка `Telegram.WebApp.initData` на сервере.
- Telegram ID используется как постоянный ID игрока.
- Получение имени, username и `photo_url` из проверенных Telegram-данных.
- Сохранение игрового состояния игрока.
- SQLite-хранилище внутри Cloudflare Durable Object.
- Отдельный объект хранения для каждого Telegram-пользователя.
- `/api/health`, `/api/auth`, `/api/save`.
- CORS для подключения фронтенда из GitHub Pages.

## Важно

Этот репозиторий содержит **сервер**, а не фронтенд игры.

`territory-game` остаётся главным репозиторием игры.

## Секрет Telegram

Токен бота **не записывается в GitHub**.

После подключения Worker нужно добавить секрет:

```text
TELEGRAM_BOT_TOKEN
```

Значение — токен твоего Telegram-бота.

Никогда не добавляй токен в `worker.js`, `index.html`, `app.js` или другие файлы фронтенда.

## API

### GET `/api/health`

Проверка сервера.

Пример ответа:

```json
{
  "ok": true,
  "service": "Territory Sdolars Server",
  "version": "1.0.0",
  "telegramConfigured": true
}
```

### POST `/api/auth`

Тело:

```json
{
  "initData": "Telegram.WebApp.initData"
}
```

Сервер проверяет подпись Telegram и возвращает игрока и его сохранение.

### POST `/api/save`

Тело:

```json
{
  "initData": "Telegram.WebApp.initData",
  "state": {
    "coins": 1000,
    "level": 1
  }
}
```

Сервер снова проверяет Telegram-подпись и сохраняет состояние именно для проверенного Telegram ID.

## Следующий этап

После загрузки этого репозитория в GitHub:

1. Развернуть Worker.
2. Добавить `TELEGRAM_BOT_TOKEN` как секрет.
3. Получить URL сервера.
4. Подключить URL к рабочему `territory-game`.
5. Сделать загрузку профиля при старте.
6. Сделать автоматическое сохранение прогресса.
7. Позже перенести важные игровые действия на сервер, чтобы клиент не мог просто изменить монеты/опыт через JavaScript.

# Territory PASS55 — Full State Sync Server

Готовая серверная версия PASS55 поверх текущего G123 worker.js.

Что добавлено:
- CORS для игрового API.
- OPTIONS preflight.
- Таблица `player_state` в TerritoryDB.
- `/db/state` GET/POST.
- `/api/state` GET/POST с существующей Telegram WebApp авторизацией.
- Полный снимок состояния игрока сохраняется в Durable Object SQLite.
- Размер снимка ограничен 1 MB.
- Базовые поля прогресса/экономики принудительно берутся из `players`, а не из клиентского snapshot:
  level, xp/exp, coins, gems, hp, maxHp, strength, agility, defense, weapon.

Важно:
- UI/Render не меняется этим серверным пакетом.
- Existing G123 Arena / RoomHub / migration v5 сохранены.
- Production deployment этим пакетом НЕ выполнялся.
- `BOT_TOKEN`, `ADMIN_PASSWORD` и существующие bindings/secrets не меняются.
- Текущий `/api/progress` оставлен совместимым с существующей игрой; полноценная server-authoritative экономика — отдельный следующий этап.

Проверка:
- `node --check worker.js` — OK.

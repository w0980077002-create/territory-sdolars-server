# Territory — FOUNDATION COMPLETE 01

Это единый cumulative-пакет. Не надо собирать 01A/01B/01C по отдельности.

## Куда копировать
- `territory-sdolars-server/*` -> содержимое репозитория `territory-sdolars-server`
- `teritory-game/territory-telegram-auth-pass54.js` -> одноимённый файл в `teritory-game`
- `teritory-game/territory-pve-authority-01c.js` -> новый файл в `teritory-game`

`index.html` менять не требуется: auth bridge сам подключает PvE authority после успешного Telegram auth.

## Что закрывает пакет
1. Telegram initData проверяется сервером.
2. Telegram ID является каноническим идентификатором игрока.
3. Первый вход может один раз импортировать игровое состояние без клиентской экономики.
4. localStorage остаётся кэшем, а не источником истины для экономики.
5. coins/gems/red_gems/VIP хранятся в server economy.
6. Economy mutations идут через idempotent ledger.
7. PvE start получает серверную battle session.
8. Battle stone списывается сервером.
9. PvE reward выдаётся сервером один раз по session id.
10. Existing combat math не переписывается.

## Важное ограничение
Это ещё не полноценная server simulation каждого удара. Клиентская PvE математика пока сохраняется. Следующий большой этап — server-side verification combat result / anti-cheat, затем покупки/VIP и остальные серверные операции.

## Проверка сервера
`npm test`
`npm start`

Нужны:
- Node >= 18
- `TELEGRAM_BOT_TOKEN`
- при раздельном хостинге клиента/сервера: `CORS_ORIGINS`

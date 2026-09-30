TERRITORY CLOUDFLARE ARENA FIX 01

Готовый worker.js из загруженного пользователем файла.
Исправлена подтверждённая ошибка RoomHub.attack():

БЫЛО: const actionId=s(String(m.actionId||"")).slice(0,80);
СТАЛО: const actionId=String(m.actionId||"").slice(0,80);

Причина: параметр s — объект состояния Arena, а не функция. На первом ударе старый код вызывал объект как функцию и получал TypeError.

Заменять нужно worker.js целиком этим файлом.
Другие файлы сервера этим пакетом не изменялись.

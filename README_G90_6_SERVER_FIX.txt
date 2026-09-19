G90.6 SERVER FIX

Причина G90.5: Cloudflare build #24d3b044 завершился ошибкой ReferenceError: DurableObject, потому что compatibility-классы GameHub/PresenceHub/RoomHub расширяли DurableObject без импорта.

Исправление: добавлен import { DurableObject } from "cloudflare:workers"; в начало worker.js.

Загрузить в backend GitHub: worker.js и wrangler.toml поверх существующих. Старые Durable Objects не удалять. После commit дождаться автоматического Cloudflare Build. Retry вручную пока не нужен.

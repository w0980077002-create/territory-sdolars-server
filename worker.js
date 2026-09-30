import { DurableObject } from "cloudflare:workers";

/**
 * Territory G112 — Cloudflare Worker + Durable Object SQLite backend
 *
 * Required:
 *   BOT_TOKEN          Telegram bot token (Worker secret)
 *   ADMIN_PASSWORD     owner password (Worker secret)
 *
 * Optional:
 *   ADMIN_LOGIN        owner login (defaults to "owner")
 *   MODERATOR_LOGIN    moderator login
 *   MODERATOR_PASSWORD moderator password
 *
 * Moderator role is intentionally unconfigured until its Cloudflare secrets
 * are added. Owner uses the existing ADMIN_PASSWORD secret.
 *
 * Durable Object binding:
 *   DB -> TerritoryDB
 *
 * Cron:
 *   0 3 * * *   (03:00 UTC; Cloudflare Cron is UTC)
 *
 * Set the requested admin password securely with:
 *   wrangler secret put ADMIN_PASSWORD
 * and enter: MySecretPassword123
 *
 * The source deliberately does not hard-code the admin password.
 */

const ADMIN_COOKIE = "territory_admin";
const MAX_INIT_AGE = 24 * 60 * 60;
const MIN_ACTION_MS = 150;
const ARENA_TURN_TIMEOUT_MS = 45000;
const ARENA_MAX_ACTION_CACHE = 64;

const corsHeaders = () => ({"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,x-telegram-init-data","access-control-max-age":"86400","vary":"Origin"});

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(),
    ...headers
  }
});

const page = (body, status = 200) => new Response(body, {
  status,
  headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store",...corsHeaders()}
});

const now = () => Math.floor(Date.now() / 1000);
const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0,10);
const n = (v, d=0) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d;
const clamp = (v,a,b) => Math.max(a, Math.min(b, n(v)));
const s = v => String(v ?? "");

const ADMIN_APP_JS = atob([
  "KCgpID0+IHsKICBjb25zdCAkID0geCA9PiBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCh4KTsKICBjb25zdCBlc2MgPSB4ID0+IFN0cmluZyh4ID8/ICcnKS5y",
  "ZXBsYWNlKC9bJjw+IiddL2csIGMgPT4gKHsnJic6JyZhbXA7JywnPCc6JyZsdDsnLCc+JzonJmd0OycsJyInOicmcXVvdDsnLCInIjonJiMzOTsnfVtjXSkp",
  "OwogIGNvbnN0IG1zZyA9IHRleHQgPT4geyBjb25zdCBlbCA9ICQoJ21zZycpOyBpZiAoZWwpIGVsLnRleHRDb250ZW50ID0gJyAnICsgdGV4dDsgfTsKICBj",
  "b25zdCBlcnJvckJveCA9IChpZCwgZSkgPT4geyBjb25zdCBlbCA9ICQoaWQpOyBpZiAoZWwpIGVsLmlubmVySFRNTCA9ICc8ZGl2IGNsYXNzPSJjYXJkIGRh",
  "bmdlclRleHQiPtCe0YjQuNCx0LrQsCDQt9Cw0LPRgNGD0LfQutC4OiAnK2VzYyhlPy5tZXNzYWdlIHx8IGUpKyc8L2Rpdj4nOyB9OwoKICBhc3luYyBmdW5j",
  "dGlvbiBhcGkodSwgbyA9IHt9KSB7CiAgICBjb25zdCByID0gYXdhaXQgZmV0Y2godSwgeyAuLi5vLCBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOidhcHBs",
  "aWNhdGlvbi9qc29uJywgLi4uKG8uaGVhZGVycyB8fCB7fSkgfSB9KTsKICAgIGNvbnN0IGQgPSBhd2FpdCByLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKTsK",
  "ICAgIGlmICghci5vaykgdGhyb3cgRXJyb3IoZC5lcnJvciB8fCByLnN0YXR1c1RleHQgfHwgKCdIVFRQICcrci5zdGF0dXMpKTsKICAgIHJldHVybiBkOwog",
  "IH0KCiAgd2luZG93LmFkbWluTG9naW4gPSBhc3luYyBmdW5jdGlvbihyb2xlLCBldmVudCkgewogICAgaWYgKGV2ZW50KSBldmVudC5wcmV2ZW50RGVmYXVs",
  "dCgpOwogICAgdHJ5IHsKICAgICAgY29uc3QgbG9naW5WYWx1ZSA9IHJvbGUgPT09ICdvd25lcicgPyAkKCdvd25lckxvZ2luJykudmFsdWUudHJpbSgpIDog",
  "JCgnbW9kTG9naW4nKS52YWx1ZS50cmltKCk7CiAgICAgIGNvbnN0IHBhc3N3b3JkID0gcm9sZSA9PT0gJ293bmVyJyA/ICQoJ293bmVyUHcnKS52YWx1ZSA6",
  "ICQoJ21vZFB3JykudmFsdWU7CiAgICAgIGNvbnN0IGQgPSBhd2FpdCBhcGkoJy9hZG1pbi9sb2dpbicsIHsgbWV0aG9kOidQT1NUJywgYm9keTpKU09OLnN0",
  "cmluZ2lmeSh7cm9sZSwgbG9naW46bG9naW5WYWx1ZSwgcGFzc3dvcmR9KSB9KTsKICAgICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnW2RhdGEtcGVy",
  "bV0nKS5mb3JFYWNoKGVsID0+IGVsLnN0eWxlLmRpc3BsYXkgPSBkLnBlcm1pc3Npb25zLmluY2x1ZGVzKGVsLmRhdGFzZXQucGVybSkgPyAnJyA6ICdub25l",
  "Jyk7CiAgICAgICQoJ2xvZ2luJykuc3R5bGUuZGlzcGxheSA9ICdub25lJzsKICAgICAgJCgnYXBwJykuc3R5bGUuZGlzcGxheSA9ICdibG9jayc7CiAgICAg",
  "ICQoJ3N0YXR1cycpLnRleHRDb250ZW50ID0gJyDCtyAnICsgZC5sYWJlbCArICc6ICcgKyBkLmxvZ2luOwogICAgICBtc2coJycpOwogICAgICBsb2FkUGxh",
  "eWVycygpOwogICAgfSBjYXRjaCAoZSkgeyBtc2coZS5tZXNzYWdlKTsgfQogIH07CgogIGZ1bmN0aW9uIHRhYihpZCkgewogICAgZG9jdW1lbnQucXVlcnlT",
  "ZWxlY3RvckFsbCgnLnBhbmVsJykuZm9yRWFjaCh4ID0+IHguY2xhc3NMaXN0LnJlbW92ZSgnYWN0aXZlJykpOwogICAgY29uc3QgcGFuZWwgPSAkKGlkKTsK",
  "ICAgIGlmICghcGFuZWwpIHJldHVybjsKICAgIHBhbmVsLmNsYXNzTGlzdC5hZGQoJ2FjdGl2ZScpOwogICAgY29uc3QgbG9hZGVycyA9IHtwbGF5ZXJzOmxv",
  "YWRQbGF5ZXJzLCBmaW5hbmNlOmxvYWRGaW5hbmNlLCBwcmljZXM6bG9hZFByaWNlcywgYW50aTpsb2FkQW50aSwgbG9nczpsb2FkTG9ncywgYnJvYWRjYXN0",
  "OmxvYWRCcm9hZGNhc3QsIGFyZW5hQm90czpsb2FkQXJlbmFCb3RzfTsKICAgIGNvbnN0IGZuID0gbG9hZGVyc1tpZF07CiAgICBpZiAodHlwZW9mIGZuICE9",
  "PSAnZnVuY3Rpb24nKSByZXR1cm47CiAgICBjb25zdCBib3ggPSBwYW5lbC5xdWVyeVNlbGVjdG9yKCdbaWQkPWJdJyk7CiAgICBpZiAoYm94ICYmIGlkICE9",
  "PSAncGxheWVycycgJiYgaWQgIT09ICdicm9hZGNhc3QnKSBib3guaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9ImNhcmQgbXV0ZWQiPtCX0LDQs9GA0YPQt9C6",
  "0LDigKY8L2Rpdj4nOwogICAgUHJvbWlzZS5yZXNvbHZlKGZuKCkpLmNhdGNoKGUgPT4geyBpZiAoYm94KSBib3guaW5uZXJIVE1MID0gJzxkaXYgY2xhc3M9",
  "ImNhcmQgZGFuZ2VyVGV4dCI+0J7RiNC40LHQutCwINC30LDQs9GA0YPQt9C60Lg6ICcrZXNjKGU/Lm1lc3NhZ2UgfHwgZSkrJzwvZGl2Pic7IH0pOwogIH0K",
  "ICB3aW5kb3cudGFiID0gdGFiOwogIGFzeW5jIGZ1bmN0aW9uIGxvYWRBcmVuYUJvdHMoKXsKICAgIGNvbnN0IGQ9YXdhaXQgYXBpKCcvYWRtaW4vYXBpL2Fy",
  "ZW5hLWJvdHMnKTsgY29uc3QgYz1kLmNvbmZpZ3x8e307CiAgICAkKCdhYkVuYWJsZWQnKS52YWx1ZT1TdHJpbmcoISFjLmVuYWJsZWQpOyAkKCdhYkJhY2tn",
  "cm91bmQnKS52YWx1ZT1TdHJpbmcoISFjLmJhY2tncm91bmQpOwogICAgJCgnYWJTdGFydCcpLnZhbHVlPWMuc3RhcnR8fCcwNTowMCc7ICQoJ2FiRW5kJyku",
  "dmFsdWU9Yy5lbmR8fCcwMjowMCc7CiAgICAkKCdhYk1pbicpLnZhbHVlPWMuaW50ZXJ2YWxNaW58fDMwOyAkKCdhYk1heCcpLnZhbHVlPWMuaW50ZXJ2YWxN",
  "YXh8fDEyMDsgJCgnYWJCZ01heCcpLnZhbHVlPWMubWF4QmFja2dyb3VuZHx8MTA7CiAgICAkKCdhcmVuYUFjdGl2aXR5JykuaW5uZXJIVE1MPSc8ZGl2IGNs",
  "YXNzPSJjYXJkIj48Yj7QodC10YDQstC10YDQvdGL0LUg0L3QsNGB0YLRgNC+0LnQutC4INCw0LrRgtC40LLQvdGLLjwvYj48ZGl2IGNsYXNzPSJtdXRlZCI+",
  "McOXMSArIDPDlzMgwrcgJytlc2MoYy5zdGFydHx8JzA1OjAwJykrJ+KAkycrZXNjKGMuZW5kfHwnMDI6MDAnKSsnPC9kaXY+PC9kaXY+JzsKICB9CiAgYXN5",
  "bmMgZnVuY3Rpb24gc2F2ZUFyZW5hQm90cygpewogICAgY29uc3QgZD1hd2FpdCBhcGkoJy9hZG1pbi9hcGkvYXJlbmEtYm90cycse21ldGhvZDonUE9TVCcs",
  "Ym9keTpKU09OLnN0cmluZ2lmeSh7CiAgICAgIGVuYWJsZWQ6JCgnYWJFbmFibGVkJykudmFsdWU9PT0ndHJ1ZScsYmFja2dyb3VuZDokKCdhYkJhY2tncm91",
  "bmQnKS52YWx1ZT09PSd0cnVlJywKICAgICAgc3RhcnQ6JCgnYWJTdGFydCcpLnZhbHVlLGVuZDokKCdhYkVuZCcpLnZhbHVlLGludGVydmFsTWluOk51bWJl",
  "cigkKCdhYk1pbicpLnZhbHVlKXx8MzAsCiAgICAgIGludGVydmFsTWF4Ok51bWJlcigkKCdhYk1heCcpLnZhbHVlKXx8MTIwLG1heEJhY2tncm91bmQ6TnVt",
  "YmVyKCQoJ2FiQmdNYXgnKS52YWx1ZSl8fDEwCiAgICB9KX0pOwogICAgJCgnYWJSZXN1bHQnKS50ZXh0Q29udGVudD0nIMK3INGB0L7RhdGA0LDQvdC10L3Q",
  "vic7IHNldFRpbWVvdXQoKCk9PntpZigkKCdhYlJlc3VsdCcpKSQoJ2FiUmVzdWx0JykudGV4dENvbnRlbnQ9Jyd9LDIwMDApOwogICAgbG9hZEFyZW5hQm90",
  "cygpOwogIH0KCgogIGZ1bmN0aW9uIG9wZW5CeUlkKCkgeyBjb25zdCBpZCA9ICQoJ3EnKT8udmFsdWUudHJpbSgpOyBpZiAoaWQpIG9wZW5QbGF5ZXIoaWQp",
  "OyB9CiAgd2luZG93Lm9wZW5CeUlkID0gb3BlbkJ5SWQ7CgogIGFzeW5jIGZ1bmN0aW9uIGxvYWRQbGF5ZXJzKG9mZnNldCA9IDApIHsKICAgIHRyeSB7CiAg",
  "ICAgIGNvbnN0IHEgPSAkKCdxJyk/LnZhbHVlLnJlcGxhY2UoL15ALywgJycpIHx8ICcnOwogICAgICBjb25zdCBkID0gYXdhaXQgYXBpKCcvYWRtaW4vYXBp",
  "L3BsYXllcnM/cT0nK2VuY29kZVVSSUNvbXBvbmVudChxKSsnJm9mZnNldD0nK29mZnNldCk7CiAgICAgIGxldCBoID0gJzxkaXYgY2xhc3M9ImNhcmQiPjxz",
  "cGFuIGNsYXNzPSJtdXRlZCI+0J3QsNC50LTQtdC90L46ICcrZC50b3RhbCsnPC9zcGFuPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmQiPjx0YWJsZT48dHI+PHRo",
  "PlRlbGVncmFtIElEPC90aD48dGg+0JjQs9GA0L7QujwvdGg+PHRoPtCj0YAuPC90aD48dGg+0JzQvtC90LXRgtGLPC90aD48dGg+0JrRgNC40YHRgtCw0LvQ",
  "u9GLPC90aD48dGg+0KHRgtCw0YLRg9GBPC90aD48dGg+PC90aD48L3RyPic7CiAgICAgIGZvciAoY29uc3QgcCBvZiBkLnJvd3MpIHsKICAgICAgICBoICs9",
  "ICc8dHIgY2xhc3M9ImNsaWNrIiBkYXRhLXBsYXllci1pZD0iJytlc2MocC5pZCkrJyI+PHRkPicrZXNjKHAuaWQpKyc8L3RkPjx0ZD4nK2VzYyhwLmZpcnN0",
  "X25hbWUgfHwgcC51c2VybmFtZSB8fCAnJykrJzxicj48c3BhbiBjbGFzcz0ibXV0ZWQiPkAnK2VzYyhwLnVzZXJuYW1lIHx8ICcnKSsnPC9zcGFuPjwvdGQ+",
  "PHRkPicrcC5sZXZlbCsnPC90ZD48dGQ+JytwLmNvaW5zKyc8L3RkPjx0ZD4nK3AuZ2VtcysnPC90ZD48dGQ+JysocC5iYW5uZWQ/JzxzcGFuIGNsYXNzPSJw",
  "aWxsIGRhbmdlclRleHQiPkJBTjwvc3Bhbj4nOic8c3BhbiBjbGFzcz0icGlsbCI+T0s8L3NwYW4+JykrJzwvdGQ+PHRkPjxidXR0b24gdHlwZT0iYnV0dG9u",
  "IiBkYXRhLWFjdGlvbj0ib3Blbi1wbGF5ZXIiIGRhdGEtcGxheWVyLWlkPSInK2VzYyhwLmlkKSsnIj7QntGC0LrRgNGL0YLRjDwvYnV0dG9uPjwvdGQ+PC90",
  "cj4nOwogICAgICB9CiAgICAgIGggKz0gJzwvdGFibGU+PC9kaXY+PGRpdiBjbGFzcz0icm93Ij4nOwogICAgICBpZiAoZC5vZmZzZXQgPiAwKSBoICs9ICc8",
  "YnV0dG9uIHR5cGU9ImJ1dHRvbiIgZGF0YS1hY3Rpb249InBsYXllcnMtcGFnZSIgZGF0YS1vZmZzZXQ9IicrTWF0aC5tYXgoMCxkLm9mZnNldC1kLmxpbWl0",
  "KSsnIj7ihpAg0J3QsNC30LDQtDwvYnV0dG9uPic7CiAgICAgIGlmIChkLm9mZnNldCArIGQubGltaXQgPCBkLnRvdGFsKSBoICs9ICc8YnV0dG9uIHR5cGU9",
  "ImJ1dHRvbiIgZGF0YS1hY3Rpb249InBsYXllcnMtcGFnZSIgZGF0YS1vZmZzZXQ9IicrKGQub2Zmc2V0K2QubGltaXQpKyciPtCU0LDQu9C10LUg4oaSPC9i",
  "dXR0b24+JzsKICAgICAgaCArPSAnPC9kaXY+JzsKICAgICAgJCgncGInKS5pbm5lckhUTUwgPSBoOwogICAgfSBjYXRjaCAoZSkgeyBlcnJvckJveCgncGIn",
  "LCBlKTsgfQogIH0KICB3aW5kb3cubG9hZFBsYXllcnMgPSBsb2FkUGxheWVyczsKCiAgYXN5bmMgZnVuY3Rpb24gb3BlblBsYXllcihpZCkgewogICAgdHJ5",
  "IHsKICAgICAgY29uc3QgZCA9IGF3YWl0IGFwaSgnL2FkbWluL2FwaS9wbGF5ZXIvJytlbmNvZGVVUklDb21wb25lbnQoaWQpKTsKICAgICAgaWYgKCFkKSB7",
  "IGFsZXJ0KCfQmNCz0YDQvtC6INC90LUg0L3QsNC50LTQtdC9Jyk7IHJldHVybjsgfQogICAgICAkKCdtdCcpLnRleHRDb250ZW50ID0gJ9CY0LPRgNC+0Log",
  "JyArIGlkOwogICAgICByZW5kZXJQbGF5ZXIoZCk7CiAgICAgICQoJ21vZGFsJykuY2xhc3NMaXN0LmFkZCgnc2hvdycpOwogICAgfSBjYXRjaCAoZSkgeyBh",
  "bGVydChlLm1lc3NhZ2UpOyB9CiAgfQogIHdpbmRvdy5vcGVuUGxheWVyID0gb3BlblBsYXllcjsKCiAgZnVuY3Rpb24gcmVuZGVyUGxheWVyKGQpIHsKICAg",
  "IGNvbnN0IHAgPSBkLnBsYXllcjsKICAgIGxldCBoID0gJzxkaXYgY2xhc3M9ImdyaWQiPjxkaXYgY2xhc3M9ImNhcmQiPjxoMz7Qn9GA0L7RhNC40LvRjDwv",
  "aDM+PGRpdiBjbGFzcz0ia3YiPjxkaXY+SUQ8YnI+PGI+Jytlc2MocC50ZWxlZ3JhbV9pZCkrJzwvYj48L2Rpdj48ZGl2PtCY0LzRjzxicj48Yj4nK2VzYyhw",
  "LmZpcnN0X25hbWUpKycgJytlc2MocC5sYXN0X25hbWUpKyc8L2I+PC9kaXY+PGRpdj5Vc2VybmFtZTxicj48Yj5AJytlc2MocC51c2VybmFtZSkrJzwvYj48",
  "L2Rpdj48ZGl2PtCj0YDQvtCy0LXQvdGMPGJyPjxiPicrcC5sZXZlbCsnPC9iPjwvZGl2PjxkaXY+WFA8YnI+PGI+JytwLmV4cCsnPC9iPjwvZGl2PjxkaXY+",
  "0KHRgtCw0YLRg9GBPGJyPjxiPicrKHAuYmFubmVkPydCQU4nOifQkNC60YLQuNCy0LXQvScpKyc8L2I+PC9kaXY+PGRpdj7QnNC+0L3QtdGC0Ys8YnI+PGI+",
  "JytwLmNvaW5zKyc8L2I+PC9kaXY+PGRpdj7QmtGA0LjRgdGC0LDQu9C70Ys8YnI+PGI+JytwLmdlbXMrJzwvYj48L2Rpdj48L2Rpdj48L2Rpdj4nOwogICAg",
  "aCArPSAnPGRpdiBjbGFzcz0iY2FyZCI+PGgzPtCj0L/RgNCw0LLQu9C10L3QuNC1PC9oMz48ZGl2IGNsYXNzPSJhY3Rpb25zIj48YnV0dG9uIHR5cGU9ImJ1",
  "dHRvbiIgZGF0YS1hY3Rpb249ImFkanVzdCIgZGF0YS1raW5kPSJjb2lucyI+0JzQvtC90LXRgtGLIMKxPC9idXR0b24+PGJ1dHRvbiB0eXBlPSJidXR0b24i",
  "IGRhdGEtYWN0aW9uPSJhZGp1c3QiIGRhdGEta2luZD0iZ2VtcyI+0JrRgNC40YHRgtCw0LvQu9GLIMKxPC9idXR0b24+PGJ1dHRvbiB0eXBlPSJidXR0b24i",
  "IGRhdGEtYWN0aW9uPSJhZGp1c3QiIGRhdGEta2luZD0iZXhwIj5YUCDCsTwvYnV0dG9uPjxidXR0b24gdHlwZT0iYnV0dG9uIiBkYXRhLWFjdGlvbj0iYWRq",
  "dXN0IiBkYXRhLWtpbmQ9ImxldmVsIj7Qo9GA0L7QstC10L3RjDwvYnV0dG9uPjxidXR0b24gdHlwZT0iYnV0dG9uIiBkYXRhLWFjdGlvbj0iYWRqdXN0IiBk",
  "YXRhLWtpbmQ9ImhwIj5IUCDCsTwvYnV0dG9uPjxidXR0b24gdHlwZT0iYnV0dG9uIiBkYXRhLWFjdGlvbj0iZ2lmdCI+0J/QvtC00LDRgNC+0Log0LIg0L/Q",
  "vtGH0YLRgzwvYnV0dG9uPjxidXR0b24gdHlwZT0iYnV0dG9uIiBjbGFzcz0iJysocC5iYW5uZWQ/J2dvb2QnOidkYW5nZXInKSsnIiBkYXRhLWFjdGlvbj0i",
  "YmFuIiBkYXRhLWJhbm5lZD0iJysocC5iYW5uZWQ/MDoxKSsnIj4nKyhwLmJhbm5lZD8n0KDQsNC30LHQsNC9Jzon0JHQsNC9JykrJzwvYnV0dG9uPjwvZGl2",
  "PjwvZGl2PjwvZGl2Pic7CiAgICBoICs9ICc8ZGl2IGNsYXNzPSJjYXJkIj48aDM+0JjQvdCy0LXQvdGC0LDRgNGMPC9oMz48dGFibGU+PHRyPjx0aD7Qn9GA",
  "0LXQtNC80LXRgjwvdGg+PHRoPtCa0L7Qu9C40YfQtdGB0YLQstC+PC90aD48L3RyPicrKGQuaW52ZW50b3J5Lmxlbmd0aD9kLmludmVudG9yeS5tYXAoeD0+",
  "Jzx0cj48dGQ+Jytlc2MoeC5pY29uKSsnICcrZXNjKHgubmFtZSkrJzwvdGQ+PHRkPicreC5xdWFudGl0eSsnPC90ZD48L3RyPicpLmpvaW4oJycpOic8dHI+",
  "PHRkIGNvbHNwYW49IjIiIGNsYXNzPSJtdXRlZCI+0J/Rg9GB0YLQvjwvdGQ+PC90cj4nKSsnPC90YWJsZT48L2Rpdj4nOwogICAgaCArPSAnPGRpdiBjbGFz",
  "cz0iY2FyZCI+PGgzPtCY0YHRgtC+0YDQuNGPINC00LXQudGB0YLQstC40Lk8L2gzPjxkaXYgY2xhc3M9InJvdyI+PHNlbGVjdCBpZD0iaGYiPjxvcHRpb24g",
  "dmFsdWU9IiI+0JLRgdC1PC9vcHRpb24+PG9wdGlvbj5BZG1pbjwvb3B0aW9uPjxvcHRpb24+U2hvcDwvb3B0aW9uPjxvcHRpb24+TWFpbDwvb3B0aW9uPjxv",
  "cHRpb24+QXJlbmE8L29wdGlvbj48b3B0aW9uPkFudGktY2hlYXQ8L29wdGlvbj48b3B0aW9uPkF1dGg8L29wdGlvbj48b3B0aW9uPlRvdXJuYW1lbnQ8L29w",
  "dGlvbj48L3NlbGVjdD48L2Rpdj48ZGl2IGlkPSJoaXN0IiBjbGFzcz0iaGlzdG9yeSI+PC9kaXY+PC9kaXY+JzsKICAgIGggKz0gJzxkaXYgY2xhc3M9ImNh",
  "cmQiPjxoMz7QrdC60L7QvdC+0LzQuNC60LA8L2gzPjx0YWJsZT48dHI+PHRoPtCS0LDQu9GO0YLQsDwvdGg+PHRoPtCY0LfQvNC10L3QtdC90LjQtTwvdGg+",
  "PHRoPtCU0L48L3RoPjx0aD7Qn9C+0YHQu9C1PC90aD48dGg+0J/RgNC40YfQuNC90LA8L3RoPjwvdHI+JytkLmxlZGdlci5tYXAoeD0+Jzx0cj48dGQ+Jytl",
  "c2MoeC5jdXJyZW5jeSkrJzwvdGQ+PHRkPicreC5hbW91bnQrJzwvdGQ+PHRkPicreC5iYWxhbmNlX2JlZm9yZSsnPC90ZD48dGQ+Jyt4LmJhbGFuY2VfYWZ0",
  "ZXIrJzwvdGQ+PHRkPicrZXNjKHgucmVhc29uKSsnPC90ZD48L3RyPicpLmpvaW4oJycpKyc8L3RhYmxlPjwvZGl2Pic7CiAgICBoICs9ICc8ZGl2IGNsYXNz",
  "PSJjYXJkIj48aDM+0J/QvtGH0YLQsDwvaDM+PHRhYmxlPjx0cj48dGg+0J/QuNGB0YzQvNC+PC90aD48dGg+0JLQu9C+0LbQtdC90LjRjzwvdGg+PHRoPtCh",
  "0YLQsNGC0YPRgTwvdGg+PC90cj4nK2QubWFpbC5tYXAoeD0+Jzx0cj48dGQ+Jytlc2MoeC5zdWJqZWN0KSsnPC90ZD48dGQ+8J+qmSAnK3guY29pbnMrJyDw",
  "n5KOICcreC5nZW1zKycgJytlc2MoeC53ZWFwb25faWQgfHwgJycpKyc8L3RkPjx0ZD4nKyh4LmNsYWltZWQ/J9Cf0L7Qu9GD0YfQtdC90L4nOifQntC20LjQ",
  "tNCw0LXRgicpKyc8L3RkPjwvdHI+Jykuam9pbignJykrJzwvdGFibGU+PC9kaXY+JzsKICAgICQoJ21iJykuaW5uZXJIVE1MID0gaDsKICAgICQoJ2hmJyku",
  "YWRkRXZlbnRMaXN0ZW5lcignY2hhbmdlJywgaGlzdG9yeUZpbHRlcik7CiAgICBoaXN0b3J5RmlsdGVyKCk7CiAgfQoKICBhc3luYyBmdW5jdGlvbiBoaXN0",
  "b3J5RmlsdGVyKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgaWQgPSAkKCdtdCcpLnRleHRDb250ZW50LnJlcGxhY2UoJ9CY0LPRgNC+0LogJywnJykudHJp",
  "bSgpOwogICAgICBjb25zdCBkID0gYXdhaXQgYXBpKCcvYWRtaW4vYXBpL3BsYXllci8nK2VuY29kZVVSSUNvbXBvbmVudChpZCkrJy9oaXN0b3J5P2NhdGVn",
  "b3J5PScrZW5jb2RlVVJJQ29tcG9uZW50KCQoJ2hmJyk/LnZhbHVlIHx8ICcnKSk7CiAgICAgICQoJ2hpc3QnKS5pbm5lckhUTUwgPSAnPHRhYmxlPjx0cj48",
  "dGg+0JLRgNC10LzRjzwvdGg+PHRoPtCa0LDRgtC10LPQvtGA0LjRjzwvdGg+PHRoPtCU0LXQudGB0YLQstC40LU8L3RoPjx0aD7QlNC10YLQsNC70Lg8L3Ro",
  "PjwvdHI+JytkLm1hcCh4PT4nPHRyPjx0ZD4nK25ldyBEYXRlKHguY3JlYXRlZF9hdCoxMDAwKS50b0xvY2FsZVN0cmluZygpKyc8L3RkPjx0ZD4nK2VzYyh4",
  "LmNhdGVnb3J5KSsnPC90ZD48dGQ+Jytlc2MoeC5hY3Rpb24pKyc8L3RkPjx0ZD4nK2VzYyh4LmRldGFpbHMpKyc8L3RkPjwvdHI+Jykuam9pbignJykrJzwv",
  "dGFibGU+JzsKICAgIH0gY2F0Y2goZSkgeyBlcnJvckJveCgnaGlzdCcsIGUpOyB9CiAgfQogIHdpbmRvdy5oaXN0b3J5RmlsdGVyID0gaGlzdG9yeUZpbHRl",
  "cjsKCiAgYXN5bmMgZnVuY3Rpb24gYWRqdXN0KGFjdGlvbikgewogICAgY29uc3QgYW1vdW50ID0gcHJvbXB0KGFjdGlvbiA9PT0gJ2xldmVsJyA/ICfQndC+",
  "0LLRi9C5INGD0YDQvtCy0LXQvdGMJyA6ICfQmNC30LzQtdC90LXQvdC40LUg0LrQvtC70LjRh9C10YHRgtCy0LAnLCcwJyk7CiAgICBpZiAoYW1vdW50ID09",
  "PSBudWxsKSByZXR1cm47CiAgICBjb25zdCByZWFzb24gPSBwcm9tcHQoJ9Cf0YDQuNGH0LjQvdCwICjQvtCx0Y/Qt9Cw0YLQtdC70YzQvdC+KScsJ9Ca0L7R",
  "gNGA0LXQutGG0LjRjyDQsNC00LzQuNC90LjRgdGC0YDQsNGC0L7RgNCwJyk7CiAgICBpZiAoIXJlYXNvbikgcmV0dXJuOwogICAgY29uc3QgaWQgPSAkKCdt",
  "dCcpLnRleHRDb250ZW50LnJlcGxhY2UoJ9CY0LPRgNC+0LogJywnJykudHJpbSgpOwogICAgYXdhaXQgYXBpKCcvYWRtaW4vYXBpL2FkanVzdCcse21ldGhv",
  "ZDonUE9TVCcsYm9keTpKU09OLnN0cmluZ2lmeSh7aWQsYWN0aW9uLGFtb3VudCxyZWFzb259KX0pOwogICAgYXdhaXQgb3BlblBsYXllcihpZCk7CiAgfQoK",
  "ICBhc3luYyBmdW5jdGlvbiBnaWZ0UGxheWVyKCkgewogICAgY29uc3QgaWQgPSAkKCdtdCcpLnRleHRDb250ZW50LnJlcGxhY2UoJ9CY0LPRgNC+0LogJywn",
  "JykudHJpbSgpOwogICAgY29uc3QgY29pbnMgPSBwcm9tcHQoJ9Cc0L7QvdC10YLRiycsJzAnKTsgaWYgKGNvaW5zID09PSBudWxsKSByZXR1cm47CiAgICBj",
  "b25zdCBnZW1zID0gcHJvbXB0KCfQmtGA0LjRgdGC0LDQu9C70YsnLCcwJyk7IGlmIChnZW1zID09PSBudWxsKSByZXR1cm47CiAgICBjb25zdCB3ZWFwb25f",
  "aWQgPSBwcm9tcHQoJ0lEINC+0YDRg9C20LjRjyAo0L3QtdC+0LHRj9C30LDRgtC10LvRjNC90L4pJywnJykgfHwgJyc7CiAgICBjb25zdCByZWFzb24gPSBw",
  "cm9tcHQoJ9Cf0YDQuNGH0LjQvdCwJywn0J/QvtC00LDRgNC+0Log0L7RgiDQsNC00LzQuNC90LjRgdGC0YDQsNGG0LjQuCcpOyBpZiAoIXJlYXNvbikgcmV0",
  "dXJuOwogICAgYXdhaXQgYXBpKCcvYWRtaW4vYXBpL2dpZnQnLHttZXRob2Q6J1BPU1QnLGJvZHk6SlNPTi5zdHJpbmdpZnkoe2lkLGNvaW5zLGdlbXMsd2Vh",
  "cG9uX2lkLHJlYXNvbixzdWJqZWN0OifQn9C+0LTQsNGA0L7QuiDQvtGCINCw0LTQvNC40L3QuNGB0YLRgNCw0YbQuNC4Jyxib2R5OnJlYXNvbn0pfSk7CiAg",
  "ICBhbGVydCgn0J/QuNGB0YzQvNC+INC+0YLQv9GA0LDQstC70LXQvdC+Jyk7IG9wZW5QbGF5ZXIoaWQpOwogIH0KCiAgYXN5bmMgZnVuY3Rpb24gdG9nZ2xl",
  "QmFuKGIpIHsKICAgIGNvbnN0IGlkID0gJCgnbXQnKS50ZXh0Q29udGVudC5yZXBsYWNlKCfQmNCz0YDQvtC6ICcsJycpLnRyaW0oKTsKICAgIGNvbnN0IHJl",
  "YXNvbiA9IHByb21wdCgn0J/RgNC40YfQuNC90LAnLGI/J9Cd0LDRgNGD0YjQtdC90LjQtSDQv9GA0LDQstC40LsnOifQodC90Y/RgtC40LUg0LHQu9C+0LrQ",
  "uNGA0L7QstC60LgnKTsgaWYgKCFyZWFzb24pIHJldHVybjsKICAgIGF3YWl0IGFwaSgnL2FkbWluL2FwaS9iYW4nLHttZXRob2Q6J1BPU1QnLGJvZHk6SlNP",
  "Ti5zdHJpbmdpZnkoe2lkLGJhbm5lZDpiLHJlYXNvbn0pfSk7CiAgICBvcGVuUGxheWVyKGlkKTsgbG9hZFBsYXllcnMoKTsKICB9CgogIGZ1bmN0aW9uIGNs",
  "b3NlTW9kYWwoKSB7ICQoJ21vZGFsJykuY2xhc3NMaXN0LnJlbW92ZSgnc2hvdycpOyB9CiAgd2luZG93LmNsb3NlTW9kYWwgPSBjbG9zZU1vZGFsOwoKICBm",
  "dW5jdGlvbiBsb2FkQnJvYWRjYXN0KCkgewogICAgY29uc3QgYSA9ICQoJ2JjQXVkaWVuY2UnKTsKICAgIGlmIChhKSAkKCdiY0xldmVsQm94Jykuc3R5bGUu",
  "ZGlzcGxheSA9IGEudmFsdWUgPT09ICdsZXZlbCcgPyAnYmxvY2snIDogJ25vbmUnOwogICAgbG9hZEJyb2FkY2FzdEhpc3RvcnkoKTsKICB9CgogIGFzeW5j",
  "IGZ1bmN0aW9uIHNlbmRCcm9hZGNhc3QoKSB7CiAgICB0cnkgewogICAgICBjb25zdCBhdWRpZW5jZT0kKCdiY0F1ZGllbmNlJykudmFsdWUsIG1pbkxldmVs",
  "PU1hdGgubWF4KDEsTnVtYmVyKCQoJ2JjTWluTGV2ZWwnKS52YWx1ZXx8MSkpOwogICAgICBjb25zdCBjb2lucz1NYXRoLm1heCgwLE51bWJlcigkKCdiY0Nv",
  "aW5zJykudmFsdWV8fDApKSwgZ2Vtcz1NYXRoLm1heCgwLE51bWJlcigkKCdiY0dlbXMnKS52YWx1ZXx8MCkpOwogICAgICBjb25zdCBzdWJqZWN0PSQoJ2Jj",
  "U3ViamVjdCcpLnZhbHVlLnRyaW0oKSwgYm9keT0kKCdiY0JvZHknKS52YWx1ZS50cmltKCksIHJlYXNvbj0kKCdiY1JlYXNvbicpLnZhbHVlLnRyaW0oKSwg",
  "d2VhcG9uX2lkPSQoJ2JjV2VhcG9uJykudmFsdWUudHJpbSgpOwogICAgICBpZighc3ViamVjdHx8IWJvZHl8fCFyZWFzb24pe2FsZXJ0KCfQotC10LzQsCwg",
  "0YLQtdC60YHRgiDQuCDQv9GA0LjRh9C40L3QsCDQvtCx0Y/Qt9Cw0YLQtdC70YzQvdGLJyk7cmV0dXJuO30KICAgICAgY29uc3QgcHJldmlldz1hd2FpdCBh",
  "cGkoJy9hZG1pbi9hcGkvYnJvYWRjYXN0L3ByZXZpZXc/YXVkaWVuY2U9JytlbmNvZGVVUklDb21wb25lbnQoYXVkaWVuY2UpKycmbWluX2xldmVsPScrbWlu",
  "TGV2ZWwpOwogICAgICBjb25zdCB0b3RhbD1wcmV2aWV3LnRvdGFsfHwwOwogICAgICBpZighY29uZmlybSgn0J/QvtC70YPRh9Cw0YLQtdC70LXQuTogJyt0",
  "b3RhbCsnXFRFTVBfQkFDS1NMQVNIClxURU1QX0JBQ0tTTEFTSArQndCw0LPRgNCw0LTQsCDQutCw0LbQtNC+0LzRgzogJytjb2lucysnINC80L7QvdC10YIg",
  "KyAnK2dlbXMrJyDQutGA0LjRgdGC0LDQu9C70L7QsicrKHdlYXBvbl9pZD8nICsgJyt3ZWFwb25faWQ6JycpKydcVEVNUF9CQUNLU0xBU0gKXFRFTVBfQkFD",
  "S1NMQVNICtCe0YLQv9GA0LDQstC40YLRjCDRgdC10LnRh9Cw0YE/JykpcmV0dXJuOwogICAgICBjb25zdCBkPWF3YWl0IGFwaSgnL2FkbWluL2FwaS9icm9h",
  "ZGNhc3QnLHttZXRob2Q6J1BPU1QnLGJvZHk6SlNPTi5zdHJpbmdpZnkoe2F1ZGllbmNlLG1pbl9sZXZlbDptaW5MZXZlbCxjb2lucyxnZW1zLHdlYXBvbl9p",
  "ZCxzdWJqZWN0LGJvZHkscmVhc29ufSl9KTsKICAgICAgJCgnYmNSZXN1bHQnKS50ZXh0Q29udGVudD0n0JPQvtGC0L7QstC+OiDQvtGC0L/RgNCw0LLQu9C1",
  "0L3QviAnK2Quc2VudCsnINC40LPRgNC+0LrQsNC8LiBJRCDRgNCw0YHRgdGL0LvQutC4OiAnK2QuYnJvYWRjYXN0X2lkOwogICAgICBsb2FkQnJvYWRjYXN0",
  "SGlzdG9yeSgpOwogICAgfSBjYXRjaChlKSB7IGFsZXJ0KGUubWVzc2FnZSk7IH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIGxvYWRCcm9hZGNhc3RIaXN0b3J5",
  "KCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgZD1hd2FpdCBhcGkoJy9hZG1pbi9hcGkvYnJvYWRjYXN0cycpOwogICAgICAkKCdiY2hpc3RvcnknKS5pbm5l",
  "ckhUTUw9JzxkaXYgY2xhc3M9ImNhcmQiPjxoMz7QmNGB0YLQvtGA0LjRjyDQvNCw0YHRgdC+0LLRi9GFINGA0LDRgdGB0YvQu9C+0Lo8L2gzPjx0YWJsZT48",
  "dHI+PHRoPtCU0LDRgtCwPC90aD48dGg+0J3QsNC30LLQsNC90LjQtTwvdGg+PHRoPtCf0L7Qu9GD0YfQsNGC0LXQu9C10Lk8L3RoPjx0aD7QndCw0LPRgNCw",
  "0LTQsDwvdGg+PHRoPtCf0YDQuNGH0LjQvdCwPC90aD48L3RyPicrZC5tYXAoeD0+Jzx0cj48dGQ+JytuZXcgRGF0ZSh4LmNyZWF0ZWRfYXQqMTAwMCkudG9M",
  "b2NhbGVTdHJpbmcoKSsnPC90ZD48dGQ+Jytlc2MoeC5zdWJqZWN0KSsnPC90ZD48dGQ+Jyt4LnJlY2lwaWVudF9jb3VudCsnPC90ZD48dGQ+8J+qmSAnK3gu",
  "Y29pbnMrJyDwn5KOICcreC5nZW1zKyh4LndlYXBvbl9pZD8nIPCfjoEgJytlc2MoeC53ZWFwb25faWQpOicnKSsnPC90ZD48dGQ+Jytlc2MoeC5yZWFzb24p",
  "Kyc8L3RkPjwvdHI+Jykuam9pbignJykrJzwvdGFibGU+PC9kaXY+JzsKICAgIH0gY2F0Y2goZSkgeyBlcnJvckJveCgnYmNoaXN0b3J5JywgZSk7IH0KICB9",
  "CgogIGFzeW5jIGZ1bmN0aW9uIGxvYWRGaW5hbmNlKCkgewogICAgdHJ5IHsKICAgICAgY29uc3QgZD1hd2FpdCBhcGkoJy9hZG1pbi9hcGkvZmluYW5jZScp",
  "OwogICAgICAkKCdmYicpLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iZ3JpZCI+PGRpdiBjbGFzcz0iY2FyZCI+0JTQvtGF0L7QtCDQt9CwIDI00Yc6IDxiPicr",
  "ZC5kYWlseUluY29tZSsnPC9iPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmQiPtCf0L7QtNGC0LLQtdGA0LbQtNGR0L3QvdGL0LUg0L/Qu9Cw0YLQtdC20Lg6IDxi",
  "PicrZC5wYXltZW50Q291bnQrJzwvYj48L2Rpdj48L2Rpdj48ZGl2IGNsYXNzPSJjYXJkIj48aDM+0KLQvtC/INC00L7QvdCw0YLQtdGA0L7QsjwvaDM+PHRh",
  "YmxlPjx0cj48dGg+SUQ8L3RoPjx0aD7QodGD0LzQvNCwPC90aD48dGg+0J/Qu9Cw0YLQtdC20LXQuTwvdGg+PC90cj4nK2QudG9wRG9ub3JzLm1hcCh4PT4n",
  "PHRyPjx0ZD4nK2VzYyh4LmlkKSsnPC90ZD48dGQ+Jyt4LnRvdGFsKyc8L3RkPjx0ZD4nK3gucGF5bWVudHMrJzwvdGQ+PC90cj4nKS5qb2luKCcnKSsnPC90",
  "YWJsZT48L2Rpdj4nOwogICAgfSBjYXRjaChlKSB7IGVycm9yQm94KCdmYicsIGUpOyB9CiAgfQoKICBhc3luYyBmdW5jdGlvbiBsb2FkUHJpY2VzKCkgewog",
  "ICAgdHJ5IHsKICAgICAgY29uc3QgZD1hd2FpdCBhcGkoJy9hZG1pbi9hcGkvcHJpY2VzJyk7CiAgICAgICQoJ3ByYicpLmlubmVySFRNTD0nPGRpdiBjbGFz",
  "cz0iY2FyZCI+PHRhYmxlPjx0cj48dGg+0J7RgNGD0LbQuNC1PC90aD48dGg+0KbQtdC90LA8L3RoPjx0aD7Qo9GA0L7QvTwvdGg+PHRoPjwvdGg+PC90cj4n",
  "K2QubWFwKHg9Pic8dHI+PHRkPicrZXNjKHguaWNvbikrJyAnK2VzYyh4Lm5hbWUpKyc8L3RkPjx0ZD48aW5wdXQgaWQ9InBfJytlc2MoeC5pdGVtX2lkKSsn",
  "IiB2YWx1ZT0iJyt4LnByaWNlKyciPjwvdGQ+PHRkPicreC5kYW1hZ2UrJzwvdGQ+PHRkPjxidXR0b24gdHlwZT0iYnV0dG9uIiBkYXRhLWFjdGlvbj0icHJp",
  "Y2UiIGRhdGEtaXRlbS1pZD0iJytlc2MoeC5pdGVtX2lkKSsnIj7QodC+0YXRgNCw0L3QuNGC0Yw8L2J1dHRvbj48L3RkPjwvdHI+Jykuam9pbignJykrJzwv",
  "dGFibGU+PC9kaXY+JzsKICAgIH0gY2F0Y2goZSkgeyBlcnJvckJveCgncHJiJywgZSk7IH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIHByaWNlKGlkKSB7CiAg",
  "ICBjb25zdCByZWFzb249cHJvbXB0KCfQn9GA0LjRh9C40L3QsCDQuNC30LzQtdC90LXQvdC40Y8g0YbQtdC90YsnLCfQmtC+0YDRgNC10LrRhtC40Y8g0LzQ",
  "sNCz0LDQt9C40L3QsCcpOyBpZighcmVhc29uKXJldHVybjsKICAgIGF3YWl0IGFwaSgnL2FkbWluL2FwaS9wcmljZScse21ldGhvZDonUE9TVCcsYm9keTpK",
  "U09OLnN0cmluZ2lmeSh7aXRlbV9pZDppZCxwcmljZTokKCdwXycraWQpLnZhbHVlLHJlYXNvbn0pfSk7CiAgICBsb2FkUHJpY2VzKCk7CiAgfQoKICBhc3lu",
  "YyBmdW5jdGlvbiBsb2FkQW50aSgpIHsKICAgIHRyeSB7CiAgICAgIGNvbnN0IGQ9YXdhaXQgYXBpKCcvYWRtaW4vYXBpL2FudGljaGVhdCcpOwogICAgICAk",
  "KCdhYicpLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iY2FyZCI+PHRhYmxlPjx0cj48dGg+SUQ8L3RoPjx0aD7QmNCz0YDQvtC6PC90aD48dGg+0J3QsNGA0YPR",
  "iNC10L3QuNGPPC90aD48dGg+0J/QvtGB0LvQtdC00L3QtdC1PC90aD48dGg+0KHRgtCw0YLRg9GBPC90aD48L3RyPicrZC5tYXAoeD0+Jzx0cj48dGQ+Jytl",
  "c2MoeC5pZCkrJzwvdGQ+PHRkPicrZXNjKHguZmlyc3RfbmFtZXx8eC51c2VybmFtZXx8JycpKyc8L3RkPjx0ZD4nK3guc3RyaWtlcysnPC90ZD48dGQ+Jyt4",
  "Lmxhc3RfYWN0aW9uX21zKyc8L3RkPjx0ZD4nKyh4LmJhbm5lZD8nQkFOJzonT0snKSsnPC90ZD48L3RyPicpLmpvaW4oJycpKyc8L3RhYmxlPjwvZGl2Pic7",
  "CiAgICB9IGNhdGNoKGUpIHsgZXJyb3JCb3goJ2FiJywgZSk7IH0KICB9CgogIGFzeW5jIGZ1bmN0aW9uIGxvYWRMb2dzKCkgewogICAgdHJ5IHsKICAgICAg",
  "Y29uc3QgZD1hd2FpdCBhcGkoJy9hZG1pbi9hcGkvbG9ncycpOwogICAgICAkKCdsYicpLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iY2FyZCI+PHRhYmxlPjx0",
  "cj48dGg+0JLRgNC10LzRjzwvdGg+PHRoPtCY0LPRgNC+0Lo8L3RoPjx0aD7QlNC10LnRgdGC0LLQuNC1PC90aD48dGg+0J/RgNC40YfQuNC90LA8L3RoPjwv",
  "dHI+JytkLm1hcCh4PT4nPHRyPjx0ZD4nK25ldyBEYXRlKHguY3JlYXRlZF9hdCoxMDAwKS50b0xvY2FsZVN0cmluZygpKyc8L3RkPjx0ZD4nK2VzYyh4LnRl",
  "bGVncmFtX2lkKSsnPC90ZD48dGQ+Jytlc2MoeC5hY3Rpb24pKyc8L3RkPjx0ZD4nK2VzYyh4LnJlYXNvbikrJzwvdGQ+PC90cj4nKS5qb2luKCcnKSsnPC90",
  "YWJsZT48L2Rpdj4nOwogICAgfSBjYXRjaChlKSB7IGVycm9yQm94KCdsYicsIGUpOyB9CiAgfQoKICBmdW5jdGlvbiBiaW5kRXZlbnRzKCkgewogICAgZG9j",
  "dW1lbnQucXVlcnlTZWxlY3RvckFsbCgnI2xvZ2luIGZvcm0nKS5mb3JFYWNoKGZvcm0gPT4gewogICAgICBmb3JtLmFkZEV2ZW50TGlzdGVuZXIoJ3N1Ym1p",
  "dCcsIGUgPT4geyBlLnByZXZlbnREZWZhdWx0KCk7IGNvbnN0IHJvbGU9Zm9ybS5xdWVyeVNlbGVjdG9yKCdpbnB1dFtuYW1lPSJyb2xlIl0nKT8udmFsdWUg",
  "fHwgJ293bmVyJzsgYWRtaW5Mb2dpbihyb2xlLGUpOyB9KTsKICAgIH0pOwogICAgZG9jdW1lbnQucXVlcnlTZWxlY3RvckFsbCgnW2RhdGEtcGVybV0nKS5m",
  "b3JFYWNoKGJ0biA9PiBidG4uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2snLCAoKSA9PiB0YWIoYnRuLmRhdGFzZXQudGFiIHx8IGJ0bi5kYXRhc2V0LnBlcm0p",
  "KSk7CiAgICAkKCdxJyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBlID0+IHsgaWYoZS5rZXkgPT09ICdFbnRlcicpIGxvYWRQbGF5ZXJzKCk7IH0p",
  "OwogICAgJCgnYmNBdWRpZW5jZScpPy5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoKSA9PiB7ICQoJ2JjTGV2ZWxCb3gnKS5zdHlsZS5kaXNwbGF5PSQo",
  "J2JjQXVkaWVuY2UnKS52YWx1ZT09PSdsZXZlbCc/J2Jsb2NrJzonbm9uZSc7IH0pOwogICAgJCgnbW9kYWwnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xpY2sn",
  "LCBlID0+IHsgaWYoZS50YXJnZXQgPT09ICQoJ21vZGFsJykpIGNsb3NlTW9kYWwoKTsgfSk7CiAgICAkKCdhcHAnKT8uYWRkRXZlbnRMaXN0ZW5lcignY2xp",
  "Y2snLCBhc3luYyBlID0+IHsKICAgICAgY29uc3QgYnRuPWUudGFyZ2V0LmNsb3Nlc3QoJ1tkYXRhLWFjdGlvbl0nKTsKICAgICAgaWYoIWJ0bikgcmV0dXJu",
  "OwogICAgICBjb25zdCBhY3Rpb249YnRuLmRhdGFzZXQuYWN0aW9uOwogICAgICB0cnkgewogICAgICAgIGlmKGFjdGlvbj09PSdzZWFyY2gtcGxheWVycycp",
  "IHJldHVybiBsb2FkUGxheWVycygpOwogICAgICAgIGlmKGFjdGlvbj09PSdvcGVuLWJ5LWlkJykgcmV0dXJuIG9wZW5CeUlkKCk7CiAgICAgICAgaWYoYWN0",
  "aW9uPT09J29wZW4tcGxheWVyJykgcmV0dXJuIG9wZW5QbGF5ZXIoYnRuLmRhdGFzZXQucGxheWVySWQpOwogICAgICAgIGlmKGFjdGlvbj09PSdwbGF5ZXJz",
  "LXBhZ2UnKSByZXR1cm4gbG9hZFBsYXllcnMoTnVtYmVyKGJ0bi5kYXRhc2V0Lm9mZnNldHx8MCkpOwogICAgICAgIGlmKGFjdGlvbj09PSdhZGp1c3QnKSBy",
  "ZXR1cm4gYWRqdXN0KGJ0bi5kYXRhc2V0LmtpbmQpOwogICAgICAgIGlmKGFjdGlvbj09PSdnaWZ0JykgcmV0dXJuIGdpZnRQbGF5ZXIoKTsKICAgICAgICBp",
  "ZihhY3Rpb249PT0nYmFuJykgcmV0dXJuIHRvZ2dsZUJhbihOdW1iZXIoYnRuLmRhdGFzZXQuYmFubmVkKSk7CiAgICAgICAgaWYoYWN0aW9uPT09J3ByaWNl",
  "JykgcmV0dXJuIHByaWNlKGJ0bi5kYXRhc2V0Lml0ZW1JZCk7CiAgICAgICAgaWYoYWN0aW9uPT09J2Nsb3NlLW1vZGFsJykgcmV0dXJuIGNsb3NlTW9kYWwo",
  "KTsKICAgICAgICBpZihhY3Rpb249PT0nYnJvYWRjYXN0JykgcmV0dXJuIHNlbmRCcm9hZGNhc3QoKTsKICAgICAgICBpZihhY3Rpb249PT0nc2F2ZS1hcmVu",
  "YS1ib3RzJykgcmV0dXJuIHNhdmVBcmVuYUJvdHMoKTsKICAgICAgfSBjYXRjaChlcnIpIHsgYWxlcnQoZXJyLm1lc3NhZ2UgfHwgU3RyaW5nKGVycikpOyB9",
  "CiAgICB9KTsKICAgICQoJ3BiJyk/LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgZSA9PiB7CiAgICAgIGlmKGUudGFyZ2V0LmNsb3Nlc3QoJ1tkYXRhLWFj",
  "dGlvbl0nKSkgcmV0dXJuOwogICAgICBjb25zdCByb3c9ZS50YXJnZXQuY2xvc2VzdCgnW2RhdGEtcGxheWVyLWlkXScpOwogICAgICBpZihyb3cpIG9wZW5Q",
  "bGF5ZXIocm93LmRhdGFzZXQucGxheWVySWQpOwogICAgfSk7CiAgfQoKICBmdW5jdGlvbiBib290KCkgewogICAgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50",
  "LmRhdGFzZXQudGVycml0b3J5QWRtaW5Kcz0nRzEyMCc7CiAgICBiaW5kRXZlbnRzKCk7CiAgICBjb25zdCBhcHA9JCgnYXBwJyk7CiAgICBpZihhcHAgJiYg",
  "YXBwLnN0eWxlLmRpc3BsYXkgIT09ICdub25lJykgbG9hZFBsYXllcnMoKTsKICB9CgogIGlmKGRvY3VtZW50LnJlYWR5U3RhdGUgPT09ICdsb2FkaW5nJykg",
  "ZG9jdW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignRE9NQ29udGVudExvYWRlZCcsIGJvb3QsIHtvbmNlOnRydWV9KTsgZWxzZSBib290KCk7Cn0pKCk7Cg=="
].join(""));

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0,i).trim()] = decodeURIComponent(part.slice(i+1).trim());
  }
  return out;
}

async function hmac(key, message) {
  const k = await crypto.subtle.importKey(
    "raw", key instanceof Uint8Array ? key : new TextEncoder().encode(key),
    {name:"HMAC",hash:"SHA-256"}, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign(
    "HMAC", k, new TextEncoder().encode(message)
  ));
}

function hex(bytes) {
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
}

function equal(a,b) {
  const x = typeof a === "string" ? new TextEncoder().encode(a) : a;
  const y = typeof b === "string" ? new TextEncoder().encode(b) : b;
  if (x.length !== y.length) return false;
  let z = 0;
  for (let i=0;i<x.length;i++) z |= x[i]^y[i];
  return z === 0;
}

async function telegramAuth(initData, botToken) {
  if (!initData || !botToken) throw new Error("Telegram auth is not configured");
  const p = new URLSearchParams(initData);
  const hash = (p.get("hash") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid Telegram hash");

  const authDate = n(p.get("auth_date"));
  if (!authDate || Math.abs(now()-authDate) > MAX_INIT_AGE) {
    throw new Error("Telegram initData expired");
  }

  const data = [...p.entries()]
    .filter(([k])=>k!=="hash")
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([k,v])=>`${k}=${v}`)
    .join("\n");

  // Telegram Web Apps validation:
  // secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
  // hash = HMAC_SHA256(key=secret_key, message=data_check_string)
  const secret = await hmac("WebAppData", botToken);
  const expected = await hmac(secret, data);
  const supplied = new Uint8Array(
    (hash.match(/../g) || []).map(x=>parseInt(x,16))
  );
  if (!equal(expected,supplied)) throw new Error("Invalid Telegram initData");

  let user;
  try { user = JSON.parse(p.get("user") || "{}"); } catch { user = {}; }
  if (!user?.id) throw new Error("Telegram user is missing");
  return {user, authDate};
}

const ADMIN_ROLE_LABELS = {
  owner: "Владелец",
  moderator: "Модератор"
};

const ADMIN_ROLE_PERMS = {
  owner: ["players","finance","prices","anti","logs","broadcast","gift","adjust","ban","arena_bots"],
  moderator: ["players","anti","logs","ban"]
};

function adminSecretForRole(env, role) {
  if (role === "owner") return {
    login: s(env.ADMIN_LOGIN || "owner"),
    password: s(env.ADMIN_PASSWORD)
  };
  if (role === "moderator") return {
    login: s(env.MODERATOR_LOGIN),
    password: s(env.MODERATOR_PASSWORD)
  };
  return {login:"",password:""};
}

function b64url(value) {
  const bytes = new TextEncoder().encode(value);
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}

function fromB64url(value) {
  const raw = atob(String(value).replace(/-/g,"+").replace(/_/g,"/") + "===".slice((String(value).length + 3) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function signedAdminToken(secret, role, login) {
  const body = `${role}.${b64url(login)}.${now()}.${crypto.randomUUID()}`;
  const sig = hex(await hmac(secret, body));
  return `${body}.${sig}`;
}

async function verifyAdminToken(token, env) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 5) return null;
  const [role, encodedLogin, issuedRaw, nonce, sig] = parts;
  if (!ADMIN_ROLE_PERMS[role]) return null;
  const issued = n(issuedRaw);
  if (!issued || issued > now() + 60 || now() - issued > 8*60*60) return null;

  let login = "";
  try { login = fromB64url(encodedLogin); } catch { return null; }

  const cfg = adminSecretForRole(env, role);
  if (!cfg.password || !cfg.login || !equal(login,cfg.login)) return null;

  const expected = hex(await hmac(cfg.password,parts.slice(0,4).join(".")));
  if (!equal(expected,sig)) return null;

  return {
    role,
    login,
    permissions: ADMIN_ROLE_PERMS[role],
    label: ADMIN_ROLE_LABELS[role]
  };
}

function adminCan(auth, permission) {
  return !!auth && auth.permissions.includes(permission);
}

async function bodyJSON(request) {
  try { return await request.json(); } catch { return {}; }
}
async function bodyForm(request) {
  try {
    const f = await request.formData();
    return {role:f.get("role"),login:f.get("login"),password:f.get("password")};
  } catch { return {}; }
}

async function dbCall(stub, path, method="GET", body=null, headers={}) {
  return stub.fetch(new Request(`https://territory-db${path}`, {
    method,
    headers: {"content-type":"application/json",...headers},
    body: method==="GET" || method==="HEAD" ? undefined : JSON.stringify(body ?? {})
  }));
}

async function dbJSON(stub, path, method="GET", body=null) {
  const r = await dbCall(stub,path,method,body);
  const d = await r.json().catch(()=>({error:"Database error"}));
  if (!r.ok) throw new Error(d.error || "Database error");
  return d;
}

async function playerFromTelegram(request, env, stub) {
  // Telegram WebApp sends initData either in the dedicated header or as
  // JSON { initData: "..." }. Read JSON from a clone so the original body
  // remains available to /api/progress and other handlers.
  let initData = request.headers.get("x-telegram-init-data") || "";
  if (!initData) {
    try {
      const body = await request.clone().json();
      initData = String(body?.initData || body?.init_data || "");
    } catch {}
  }

  if (!initData) throw new Response(JSON.stringify({error:"Authentication required"}),{
    status:401,headers:{"content-type":"application/json",...corsHeaders()}
  });

  let auth;
  try { auth = await telegramAuth(initData, env.BOT_TOKEN); }
  catch (e) {
    throw new Response(JSON.stringify({error:e.message}),{
      status:401,headers:{"content-type":"application/json",...corsHeaders()}
    });
  }

  const p = await dbJSON(stub,"/db/upsert","POST",{user:auth.user});
  if (p.banned) throw new Response(JSON.stringify({error:"Account banned"}),{
    status:403,headers:{"content-type":"application/json",...corsHeaders()}
  });
  return p;
}

function adminHTML(auth=null) {
const authed = !!auth;
return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Territory Admin G112</title>
<style>body{margin:0;background:#0a1016;color:#edf4f7;font-family:system-ui,-apple-system,sans-serif}header{padding:15px;background:#111b24;position:sticky;top:0;z-index:3;border-bottom:1px solid #263642}main{max-width:1180px;margin:auto;padding:14px}.tabs{display:flex;gap:7px;overflow:auto;margin-bottom:12px}button,input,select,textarea{font:inherit}button{padding:9px 12px;border:1px solid #3b4d59;border-radius:9px;background:#182630;color:#fff;cursor:pointer}button:hover{background:#243640}.danger{background:#632522}.good{background:#24502e}.muted{color:#91a2ab;font-size:12px}.panel{display:none}.panel.active{display:block}.card{background:#111b23;border:1px solid #273742;border-radius:12px;padding:13px;margin:9px 0}.row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}input,select,textarea{box-sizing:border-box;width:100%;padding:9px;background:#0d151c;border:1px solid #394b56;border-radius:8px;color:#fff}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #26343d;text-align:left;font-size:13px;vertical-align:top}.click{cursor:pointer}.click:hover{background:#17242c}.pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#24343e;font-size:11px}.modal{position:fixed;inset:0;background:#000b;display:none;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;z-index:10}.modal.show{display:flex}.modalbox{width:min(1050px,100%);background:#101a22;border:1px solid #334752;border-radius:14px;padding:14px}.actions button{margin:3px}.history{max-height:380px;overflow:auto}.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px}.kv div{background:#0c141a;padding:8px;border-radius:8px}.small{font-size:12px}.dangerText{color:#ff8f86}</style></head><body>
<header><b>⚔️ Territory · G112 Admin</b><span id="status" class="muted">${authed ? ` · ${auth.label}: ${auth.login}` : ""}</span></header><main>
<div id="login" class="card" style="display:${authed ? "none" : "block"}"><h2>Вход в панель</h2><div class="grid">
<div class="card"><h3>👑 Владелец</h3><p class="muted">Полный доступ. Используется текущий секрет ADMIN_PASSWORD.</p>
<form method="POST" action="/admin/login">
<input id="ownerLogin" name="login" value="owner" placeholder="Логин владельца"><br><br>
<input id="ownerPw" name="password" type="password" placeholder="Пароль владельца"><input type="hidden" name="role" value="owner"><br><br>
<button type="submit">Войти как владелец</button></form></div>
<div class="card"><h3>🛡️ Модератор</h3><p class="muted">Роль подготовлена, но пароль в Cloudflare пока не настроен.</p>
<form method="POST" action="/admin/login">
<input id="modLogin" name="login" placeholder="Логин модератора"><br><br>
<input id="modPw" name="password" type="password" placeholder="Пароль модератора"><input type="hidden" name="role" value="moderator"><br><br>
<button type="submit">Войти как модератор</button></form></div>
</div><span id="msg" class="dangerText"></span></div>
<div id="app" style="display:${authed ? "block" : "none"}"><div class="tabs">
<button data-perm="players" data-tab="players">Игроки</button>
<button data-perm="finance" data-tab="finance">Финансы</button>
<button data-perm="prices" data-tab="prices">Магазин</button>
<button data-perm="anti" data-tab="anti">Античит</button>
<button data-perm="logs" data-tab="logs">Логи</button>
<button data-perm="broadcast" data-tab="broadcast">🎁 Всем</button>
<button data-perm="arena_bots" data-tab="arenaBots">🤖 Боты Арены</button>
</div>
<section id="players" class="panel active"><div class="card"><div class="row"><div style="flex:1;min-width:220px"><input id="q" placeholder="Telegram ID / username / имя"></div><button data-action="search-players">Поиск</button><button data-action="open-by-id">Открыть ID</button></div></div><div id="pb"></div></section>
<section id="finance" class="panel"><div id="fb"></div></section><section id="broadcast" class="panel"><div class="card"><h2>🎁 Массовый подарок</h2><p class="muted">Отправляет подарок через игровую почту. Баланс игроков напрямую не изменяется.</p><div class="grid"><div><label>Кому</label><select id="bcAudience"><option value="all">Всем игрокам</option><option value="active">Активным игрокам (30 дней)</option><option value="level">По уровню</option></select></div><div id="bcLevelBox" style="display:none"><label>Минимальный уровень</label><input id="bcMinLevel" type="number" min="1" value="1"></div><div><label>Тема</label><input id="bcSubject" value="🎉 Подарок от Territory"></div><div><label>Монеты</label><input id="bcCoins" type="number" min="0" value="1000"></div><div><label>Кристаллы</label><input id="bcGems" type="number" min="0" value="0"></div><div><label>ID оружия/предмета (необязательно)</label><input id="bcWeapon" placeholder="например weapon_01"></div></div><br><label>Текст письма</label><textarea id="bcBody" rows="5">🎉 Поздравляем с праздником! Это подарок от команды Territory.</textarea><br><br><label>Причина/название рассылки</label><input id="bcReason" value="Праздничная рассылка"><br><br><button class="good" data-action="broadcast">📨 Отправить подарок</button><div id="bcResult" class="muted"></div></div><div id="bchistory"></div></section><section id="arenaBots" class="panel"><div class="card"><h2>🤖 Боты Арены</h2><p class="muted">Боты только для 1×1 и 3×3. Время активности: можно задать период через полночь. Фоновые бои бот↔бот создают живую активность.</p><div class="grid">
<div><label>Боты</label><select id="abEnabled"><option value="true">ВКЛ</option><option value="false">ВЫКЛ</option></select></div>
<div><label>Фоновые бои</label><select id="abBackground"><option value="true">ВКЛ</option><option value="false">ВЫКЛ</option></select></div>
<div><label>С</label><input id="abStart" type="time" value="05:00"></div>
<div><label>До</label><input id="abEnd" type="time" value="02:00"></div>
<div><label>Заявки: минимум, мин.</label><input id="abMin" type="number" min="1" value="30"></div>
<div><label>Заявки: максимум, мин.</label><input id="abMax" type="number" min="1" value="120"></div>
<div><label>Макс. фоновых боёв</label><input id="abBgMax" type="number" min="1" value="10"></div>
</div><br><button class="good" data-action="save-arena-bots">💾 Сохранить</button><span id="abResult" class="muted"></span></div><div id="arenaActivity"></div></section><section id="prices" class="panel"><div id="prb"></div></section><section id="anti" class="panel"><div id="ab"></div></section><section id="logs" class="panel"><div id="lb"></div></section></div></main>
<div id="modal" class="modal"><div class="modalbox"><div class="row"><h2 id="mt" style="flex:1">Игрок</h2><button data-action="close-modal">Закрыть</button></div><div id="mb"></div></div></div>
<script src="/admin/app.js"></script></body></html>`}


/**
 * Legacy Durable Object compatibility exports.
 * These classes are kept because wrangler.toml preserves the already-deployed
 * GameHub / PresenceHub / RoomHub namespaces and migration history.
 */
export class GameHub extends DurableObject {
  async fetch() { return new Response(JSON.stringify({ok:true,hub:"game",legacy:true}), {headers:{"content-type":"application/json",...corsHeaders()}}); }
}

export class PresenceHub extends DurableObject {
  async fetch() { return new Response(JSON.stringify({ok:true,hub:"presence",legacy:true}), {headers:{"content-type":"application/json",...corsHeaders()}}); }
}


const ARENA_MODES = ["duel","group","chaos"]; // group = 3×3; chaos is real-player only
const BOT_NAMES = [
 ["Michael","Carter"],["James","Wilson"],["Alex","Miller"],["Daniel","Brooks"],["Ryan","Cooper"],
 ["Wang","Wei"],["Li","Jun"],["Zhang","Hao"],["Chen","Ming"],["Liu","Yang"],
 ["Omar","Hassan"],["Ahmed","Nasser"],["Khalid","Al-Farsi"],["Youssef","Mansour"],["Karim","Saleh"],
 ["Александр","Волков"],["Дмитрий","Орлов"],["Тимур","Ахметов"],["Никита","Соколов"],["Роман","Белов"],
 ["Marco","Rossi"],["Lucas","Martin"],["Daniel","Weber"],["Leon","Keller"],["Victor","Dubois"]
];
const BOT_ROLES=[
 {id:"tank",title:"Танк",hp:1.28,dmg:.78,def:.28,crit:.05,dodge:.04},
 {id:"berserker",title:"Берсерк",hp:.92,dmg:1.24,def:.05,crit:.22,dodge:.06},
 {id:"assassin",title:"Ассасин",hp:.86,dmg:1.12,def:.02,crit:.30,dodge:.24},
 {id:"duelist",title:"Дуэлянт",hp:1,dmg:1.02,def:.12,crit:.14,dodge:.13},
 {id:"support",title:"Поддержка",hp:1.08,dmg:.76,def:.16,crit:.08,dodge:.10}
];
const arenaDefaultConfig=()=>({enabled:true,start:"05:00",end:"02:00",background:true,fillDuel:true,fillGroup:true,intervalMin:30,intervalMax:120,maxBackground:10});
const rand=(a,b)=>Math.floor(a+Math.random()*(b-a+1));
function botWindow(c){
 const parse=v=>{const m=/^(\d{1,2}):(\d{2})$/.exec(String(v||""));return m?Number(m[1])*60+Number(m[2]):null};
 const a=parse(c.start),b=parse(c.end),d=new Date(),x=d.getHours()*60+d.getMinutes();
 return a===null||b===null?(true):(a<=b?x>=a&&x<=b:x>=a||x<=b);
}
function makeBot(seed,level,team){
 const r=BOT_ROLES[seed%BOT_ROLES.length], nm=BOT_NAMES[seed%BOT_NAMES.length];
 const hp=Math.round(120*r.hp+level*4);
 return {id:`bot:${Date.now()}:${seed}:${Math.random().toString(36).slice(2,6)}`,name:nm.join(" "),level:Math.max(1,level+rand(-2,2)),bot:true,role:r.id,roleTitle:r.title,team,
 hp,maxHp:hp,strength:Math.round((10+level)*r.dmg),defense:Math.round(5+level*r.def),crit:r.crit,dodge:r.dodge};
}
function makeHuman(id,name,level,team){
 const l=Math.max(1,Number(level)||1),hp=Math.round(120+l*5);
 return {id:String(id),name:String(name||"Игрок"),level:l,bot:false,team,hp,maxHp:hp,strength:10+l,defense:5+Math.floor(l*.4),crit:.10,dodge:.08};
}
function publicRoom(r){return {id:r.id,mode:r.mode,createdAt:r.createdAt,endsAt:r.endsAt,round:r.round,log:r.log.slice(-30),result:r.result,
 players:r.players.map(p=>({id:p.id,name:p.name,level:p.level,bot:!!p.bot,team:p.team,role:p.roleTitle||"",hp:p.hp,maxHp:p.maxHp,defeated:!!p.defeated,left:!!p.left}))};}

export class RoomHub extends DurableObject{
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.sockets=new Map();}
 async state(){let s=await this.ctx.storage.get("arena");if(!s)s={config:arenaDefaultConfig(),queues:{duel:[],group:[],chaos:[]},rooms:{},left:{},recent:[]};
  s.config={...arenaDefaultConfig(),...(s.config||{})};s.queues=s.queues||{duel:[],group:[],chaos:[]}; s.queues.chaos=s.queues.chaos||[];s.rooms=s.rooms||{};s.left=s.left||{};s.recent=s.recent||[];
  for(const r of Object.values(s.rooms)){r.actions=r.actions||[];r.rewardsClaimed=r.rewardsClaimed||{};r.turnSeq=Number(r.turnSeq||1);r.lastActionAt=Number(r.lastActionAt||r.createdAt||Date.now());}
  return s;}
 async save(s){await this.ctx.storage.put("arena",s);}
 send(id,data){const ws=this.sockets.get(String(id));if(ws)try{ws.send(JSON.stringify(data))}catch{}}
 broadcast(ids,data){ids.forEach(id=>this.send(id,data))}
 async fetch(req){
  const u=new URL(req.url);
  if(u.pathname==="/admin/config"){const s=await this.state();if(req.method==="GET")return new Response(JSON.stringify({ok:true,config:s.config}),{headers:{"content-type":"application/json",...corsHeaders()}});
   const b=await req.json().catch(()=>({}));s.config={...s.config,...b};await this.save(s);return new Response(JSON.stringify({ok:true,config:s.config}),{headers:{"content-type":"application/json",...corsHeaders()}});}
  if(req.headers.get("Upgrade")?.toLowerCase()!=="websocket")return new Response("WebSocket required",{status:426});
  const id=u.searchParams.get("telegram_id");if(!id)return new Response("Unauthorized",{status:401});
  const pair=new WebSocketPair(),ws=pair[1];ws.accept();this.sockets.set(String(id),ws);
  ws.addEventListener("message",e=>this.message(String(id),String(e.data)));
  ws.addEventListener("close",()=>{if(this.sockets.get(String(id))===ws)this.sockets.delete(String(id));});
  const st=await this.state(); this.send(id,{type:"hello",config:st.config});
  const room=Object.values(st.rooms).find(r=>!r.ended&&r.players.some(p=>p.id===String(id)&&!p.left));
  if(room) this.send(id,{type:"reconnect_state",selfId:String(id),room:publicRoom(room),turnSeq:room.turnSeq,activeId:room.activeId||null});
  else {const queued=Object.entries(st.queues).find(([,q])=>q.some(x=>x.id===String(id)));if(queued)this.send(id,{type:"queued",mode:queued[0],eta:15});}
  return new Response(null,{status:101,webSocket:pair[0]});
 }
 async message(id,raw){let m;try{m=JSON.parse(raw)}catch{return}const s=await this.state();
  try{
   if(m.type==="queue")await this.queue(s,id,m);
   else if(m.type==="leave")await this.leave(s,id);
   else if(m.type==="attack")await this.attack(s,id,m);
   else if(m.type==="team")await this.team(s,id,m.team);
  }catch(e){this.send(id,{type:"error",message:e.message||"Arena error"});}
 }
 async queue(s,id,m){
  const mode=m.mode==="duel"?"duel":m.mode==="group"?"group":m.mode==="chaos"?"chaos":null;if(!mode)throw Error("Неизвестный режим");
  if(s.left[id])throw Error("Повторный вход в этот бой запрещён");
  const active=Object.values(s.rooms).find(r=>!r.ended&&r.players.some(p=>p.id===id&&!p.left));if(active)throw Error("Игрок уже находится в бою");
  const db=this.env.DB.get(this.env.DB.idFromName("global"));
  const pr=await dbCall(db,`/db/player?id=${encodeURIComponent(String(id))}`);
  const pd=await pr.json().catch(()=>({}));
  if(!pr.ok||!pd||pd.ok===false)throw Error("Профиль игрока не найден");
  const item={id,name:String(pd.first_name||pd.username||"Игрок"),level:Math.max(1,Number(pd.level)||1),joinedAt:Date.now()};
  for(const q of Object.values(s.queues))q.splice(0,q.length,...q.filter(x=>x.id!==id));
  s.queues[mode].push(item);
  if(mode==="duel"&&s.queues.duel.length>=2){const q=s.queues.duel.splice(0,2);await this.start(s,mode,[makeHuman(q[0].id,q[0].name,q[0].level,1),makeHuman(q[1].id,q[1].name,q[1].level,2)]);return;}
  if(mode==="group"&&s.queues.group.length>=2){const q=s.queues.group.splice(0,2),lv=Math.round((q[0].level+q[1].level)/2),p=[makeHuman(q[0].id,q[0].name,q[0].level,1),makeHuman(q[1].id,q[1].name,q[1].level,2)];
   let z=0;for(const t of [1,1,2,2])p.push(makeBot(z++,lv,t));await this.start(s,mode,p);return;}
  if(mode==="chaos"&&s.queues.chaos.length>=2){const q=s.queues.chaos.splice(0,Math.min(2,s.queues.chaos.length)),p=[makeHuman(q[0].id,q[0].name,q[0].level,1)];if(q[1])p.push(makeHuman(q[1].id,q[1].name,q[1].level,2));await this.start(s,mode,p);return;}
  this.send(id,{type:"queued",mode,eta:mode==="duel"?15:20});await this.save(s);await this.ctx.storage.setAlarm(Date.now()+15000);
 }
 async start(s,mode,players){
  const first=players.find(p=>!p.defeated&&!p.left);
  const r={id:`${mode}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,mode,createdAt:Date.now(),endsAt:Date.now()+180000,round:1,turnSeq:1,activeId:first?.id||null,lastActionAt:Date.now(),actions:[],rewardsClaimed:{},players,log:[],ended:false};
  s.rooms[r.id]=r;await this.save(s);for(const p of players.filter(p=>!p.bot))this.send(p.id,{type:"room_start",selfId:p.id,turnSeq:r.turnSeq,activeId:r.activeId,room:publicRoom(r)});await this.ctx.storage.setAlarm(Date.now()+8000);
 }
 async leave(s,id){for(const r of Object.values(s.rooms)){const p=r.players.find(x=>x.id===id);if(p&&!r.ended){p.left=true;s.left[id]=r.id;this.broadcast(r.players.filter(x=>!x.bot&&!x.left).map(x=>x.id),{type:"player_left",id});}}
  for(const q of Object.values(s.queues))q.splice(0,q.length,...q.filter(x=>x.id!==id));await this.save(s);}
 async team(s,id,t){for(const q of Object.values(s.queues))for(const x of q)if(x.id===id)x.team=Number(t)===2?2:1;await this.save(s);}
 async attack(s,id,m){
  const r=Object.values(s.rooms).find(x=>!x.ended&&x.players.some(p=>p.id===id&&!p.left));if(!r)throw Error("Бой не найден");
  const me=r.players.find(p=>p.id===id);if(!me||me.bot)throw Error("Недоступный игрок");
  if(r.activeId!==String(id))throw Error("Сейчас ход другого игрока");
  const actionId=String(m.actionId||"").slice(0,80);if(!actionId)throw Error("actionId обязателен");
  if(r.actions.includes(actionId)){this.send(id,{type:"duplicate_ignored",actionId,turnSeq:r.turnSeq});return;}
  const seq=n(m.turnSeq,0);if(seq!==r.turnSeq)throw Error("Устаревший ход");
  if(Date.now()-r.lastActionAt>ARENA_TURN_TIMEOUT_MS){await this.advanceTurn(s,r,true);throw Error("Ход просрочен");}
  r.actions.push(actionId);if(r.actions.length>ARENA_MAX_ACTION_CACHE)r.actions=r.actions.slice(-ARENA_MAX_ACTION_CACHE);
  const targetId=s(m.targetId),target=r.players.find(p=>p.id===targetId&&!p.left&&!p.defeated&&p.team!==me.team);if(!target)throw Error("Недопустимая цель");
  const allowed=new Set(["head","chest","waist","legs"]),defense=Array.isArray(m.defense)?m.defense.filter(x=>allowed.has(String(x))).slice(0,4):[];
  let hit=Math.max(4,Math.round((me.strength+me.level*.8)*(.88+Math.random()*.28))),crit=false;const enemyAttack=["head","chest","waist","legs"][rand(0,3)];
  if(Math.random()<me.crit){hit=Math.round(hit*1.8);crit=true;}if(defense.includes(enemyAttack))hit=Math.round(hit*.18);if(Math.random()<target.dodge)hit=0;hit=Math.max(0,hit-Math.round(target.defense*.35));
  target.hp=Math.max(0,target.hp-hit);r.log.push(`⚔️ ${me.name} → ${target.name}: −${hit} HP${crit?" 💥 КРИТ":""}`);if(target.hp<=0){target.defeated=true;r.log.push(`💀 ${target.name} повержен`);}
  await this.botTurns(r,me.team===1?2:1);const a=r.players.filter(p=>p.team===1&&!p.left&&!p.defeated).length,b=r.players.filter(p=>p.team===2&&!p.left&&!p.defeated).length;
  if(!a||!b){r.ended=true;r.result=a?"Победа":"Поражение";await this.finish(s,r);return;}
  await this.advanceTurn(s,r,false);
 }
 async advanceTurn(s,r,timedOut=false){
  const living=r.players.filter(p=>!p.left&&!p.defeated);if(!living.length)return;const humans=living.filter(p=>!p.bot);const pool=humans.length?humans:living;const idx=Math.max(-1,pool.findIndex(p=>p.id===r.activeId));let next=pool[(idx+1+pool.length)%pool.length]||pool[0];r.activeId=next.id;r.turnSeq=Number(r.turnSeq||0)+1;r.lastActionAt=Date.now();if(timedOut)r.log.push(`⏱️ Ход пропущен по таймауту`);
  await this.save(s);for(const p of r.players.filter(p=>!p.bot&&!p.left))this.send(p.id,{type:"state",selfId:p.id,turnSeq:r.turnSeq,activeId:r.activeId,room:publicRoom(r)});
 }
 async botTurns(r,team){const actors=r.players.filter(p=>p.bot&&p.team===team&&!p.defeated&&!p.left),targets=r.players.filter(p=>!p.defeated&&!p.left&&p.team!==team);
  for(const a of actors){if(!targets.length)break;const t=targets[rand(0,targets.length-1)];let hit=Math.max(3,Math.round(a.strength*(.86+Math.random()*.28)));if(Math.random()<a.crit)hit=Math.round(hit*1.8);if(Math.random()<t.dodge)hit=0;hit=Math.max(0,hit-Math.round(t.defense*.3));t.hp=Math.max(0,t.hp-hit);r.log.push(`🤖 ${a.name} · ${a.roleTitle} → ${t.name}: −${hit} HP`);if(t.hp<=0){t.defeated=true;r.log.push(`💀 ${t.name} повержен`);}}
 }
 async finish(s,r){const win=r.result==="Победа"?1:2,humans=r.players.filter(p=>!p.bot&&!p.left),ids=humans.map(p=>p.id);s.recent.push({mode:r.mode,at:Date.now(),result:r.result,players:r.players.map(p=>({name:p.name,bot:p.bot,role:p.roleTitle||""}))});s.recent=s.recent.slice(-30);
  for(const p of humans){
   const reward=p.team===win?{coins:50,xp:15}:{coins:0,xp:0};
   const personal=p.team===win?"Победа":"Поражение";
   if((reward.coins||reward.xp)&&!r.rewardsClaimed[p.id]){try{const db=this.env.DB.get(this.env.DB.idFromName("global"));await dbCall(db,"/db/arena-reward","POST",{id:p.id,room_id:r.id,result:personal,...reward});r.rewardsClaimed[p.id]=true;}catch(e){console.error("arena reward",e);}}this.send(p.id,{type:"result",selfId:p.id,result:personal,rewards:reward,room:publicRoom(r)});
  }
  await this.save(s);}
 async tick(){
  const s=await this.state();
  for(const r of Object.values(s.rooms)){if(r.ended)continue;if(Date.now()>r.endsAt){r.ended=true;r.result="Время вышло";await this.finish(s,r);continue;}
   if(r.activeId&&Date.now()-Number(r.lastActionAt||r.createdAt)>ARENA_TURN_TIMEOUT_MS){await this.advanceTurn(s,r,true);continue;}
   if(r.players.every(p=>p.bot)&&Date.now()-r.createdAt>7000){await this.botTurns(r,1);await this.botTurns(r,2);const a=r.players.some(p=>p.team===1&&!p.defeated),b=r.players.some(p=>p.team===2&&!p.defeated);if(!a||!b){r.ended=true;r.result=a?"Победа":"Поражение";await this.finish(s,r);}}
  }
  const cutoff=Date.now()-15*60*1000;for(const [rid,r] of Object.entries(s.rooms)){if(r.ended&&Number(r.endsAt||0)<cutoff)delete s.rooms[rid];}for(const [id,rid] of Object.entries(s.left)){const r=s.rooms[rid];if(!r||Number(r.endsAt||0)<cutoff)delete s.left[id];}
  for(const mode of ["duel","group"]){const q=s.queues[mode]||[];if(!q.length||!s.config.enabled||!botWindow(s.config))continue;if(Date.now()-q[0].joinedAt<15000)continue;
   const h=q.shift();if(mode==="duel"&&s.config.fillDuel){const b=makeBot(rand(0,100000),h.level,2);await this.start(s,mode,[makeHuman(h.id,h.name,h.level,1),b]);}
   if(mode==="group"&&s.config.fillGroup){const p=[makeHuman(h.id,h.name,h.level,1)];let z=0;for(const t of [1,1,2,2,2])p.push(makeBot(z++,h.level,t));await this.start(s,mode,p);}
  }
  if(s.config.enabled&&s.config.background&&botWindow(s.config)){const active=Object.values(s.rooms).filter(r=>!r.ended&&r.players.every(p=>p.bot)).length;if(active<Number(s.config.maxBackground||10)&&Math.random()<.6){
    const mode=Math.random()<.55?"duel":"group",p=[];if(mode==="duel"){p.push(makeBot(rand(0,100000),10,1),makeBot(rand(0,100000),10,2));}else{for(const t of [1,1,1,2,2,2])p.push(makeBot(rand(0,100000),10,t));}await this.start(s,mode,p);}
  }
  await this.save(s);await this.ctx.storage.setAlarm(Date.now()+15000);
 }
 async alarm(){await this.tick();}
}


export class TerritoryDB extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx=ctx; this.env=env; this.sql=ctx.storage.sql; this.ready=false;
  }

  init() {
    if (this.ready) return;

    // Create the current schema first. Existing Durable Object databases may
    // come from an earlier backend version, so CREATE TABLE IF NOT EXISTS alone
    // is not enough: we also add any columns that were introduced later.
    this.sql.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS players(
        telegram_id TEXT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '', photo_url TEXT DEFAULT '', level INTEGER NOT NULL DEFAULT 1,
        exp INTEGER NOT NULL DEFAULT 0, hp INTEGER NOT NULL DEFAULT 120,
        max_hp INTEGER NOT NULL DEFAULT 100, coins INTEGER NOT NULL DEFAULT 0,
        gems INTEGER NOT NULL DEFAULT 0, red_gems INTEGER NOT NULL DEFAULT 0, vip INTEGER NOT NULL DEFAULT 0, strength INTEGER NOT NULL DEFAULT 5,
        agility INTEGER NOT NULL DEFAULT 5, defense INTEGER NOT NULL DEFAULT 0,
        weapon TEXT DEFAULT 'Кулаки', banned INTEGER NOT NULL DEFAULT 0,
        ban_reason TEXT DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS shop_catalog(
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '⚔️',
        price_coins INTEGER NOT NULL DEFAULT 0, damage INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS inventory(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        item_id TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
        UNIQUE(telegram_id,item_id)
      );
      CREATE TABLE IF NOT EXISTS player_mail(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        sender TEXT NOT NULL DEFAULT 'system', subject TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '', coins INTEGER NOT NULL DEFAULT 0,
        gems INTEGER NOT NULL DEFAULT 0, weapon_id TEXT DEFAULT '',
        claimed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0,
        claimed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS daily_scores(
        day TEXT NOT NULL, telegram_id TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,telegram_id)
      );
      CREATE TABLE IF NOT EXISTS tournament_awards(
        day TEXT NOT NULL, telegram_id TEXT NOT NULL, place INTEGER NOT NULL,
        gold INTEGER NOT NULL, PRIMARY KEY(day,telegram_id), UNIQUE(day,place)
      );
      CREATE TABLE IF NOT EXISTS finance(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS anti_cheat(
        telegram_id TEXT PRIMARY KEY, strikes INTEGER NOT NULL DEFAULT 0,
        last_action_ms INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS economy_ledger(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        currency TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL DEFAULT 0, balance_before INTEGER, balance_after INTEGER,
        kind TEXT NOT NULL DEFAULT '', reference TEXT DEFAULT '', reason TEXT DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS player_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '', details TEXT DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS mail_broadcasts(
        broadcast_id TEXT PRIMARY KEY, admin_id TEXT NOT NULL DEFAULT 'admin', audience TEXT NOT NULL DEFAULT 'all',
        min_level INTEGER NOT NULL DEFAULT 1, subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
        coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, weapon_id TEXT DEFAULT '',
        reason TEXT NOT NULL DEFAULT '', recipient_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS admin_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT NOT NULL DEFAULT 'admin',
        telegram_id TEXT DEFAULT '', action TEXT NOT NULL DEFAULT '', before_json TEXT DEFAULT '', after_json TEXT DEFAULT '',
        reason TEXT DEFAULT '', created_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS arena_reward_claims(
        room_id TEXT NOT NULL, telegram_id TEXT NOT NULL, coins INTEGER NOT NULL DEFAULT 0,
        xp INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(room_id,telegram_id)
      );
      CREATE TABLE IF NOT EXISTS pve_sessions(
        session_id TEXT PRIMARY KEY, telegram_id TEXT NOT NULL, chapter INTEGER NOT NULL, stage INTEGER NOT NULL,
        boss INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, nonce TEXT NOT NULL,
        hero_hp INTEGER NOT NULL, max_hp INTEGER NOT NULL, enemy_hp INTEGER NOT NULL, enemy_max_hp INTEGER NOT NULL,
        damage INTEGER NOT NULL, actions INTEGER NOT NULL DEFAULT 0, ended INTEGER NOT NULL DEFAULT 0, result TEXT DEFAULT '',
        state_json TEXT NOT NULL DEFAULT '{}'
      );
    `);

    const ensure = (table, defs) => {
      const cols = new Set(this.sql.exec(`PRAGMA table_info(${table})`).toArray().map(x => x.name));
      for (const [name, definition] of Object.entries(defs)) {
        if (!cols.has(name)) this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    };

    // Compatibility migration for databases created by older Territory builds.
    ensure('players', {
      state_json:"TEXT NOT NULL DEFAULT '{}'",
      username:"TEXT DEFAULT ''", first_name:"TEXT DEFAULT ''", last_name:"TEXT DEFAULT ''", photo_url:"TEXT DEFAULT ''",
      level:"INTEGER NOT NULL DEFAULT 1", exp:"INTEGER NOT NULL DEFAULT 0", hp:"INTEGER NOT NULL DEFAULT 120",
      max_hp:"INTEGER NOT NULL DEFAULT 100", coins:"INTEGER NOT NULL DEFAULT 0", gems:"INTEGER NOT NULL DEFAULT 0",
      red_gems:"INTEGER NOT NULL DEFAULT 0", vip:"INTEGER NOT NULL DEFAULT 0", strength:"INTEGER NOT NULL DEFAULT 5", agility:"INTEGER NOT NULL DEFAULT 5", defense:"INTEGER NOT NULL DEFAULT 0",
      weapon:"TEXT DEFAULT 'Кулаки'", banned:"INTEGER NOT NULL DEFAULT 0", ban_reason:"TEXT DEFAULT ''",
      created_at:"INTEGER NOT NULL DEFAULT 0", updated_at:"INTEGER NOT NULL DEFAULT 0"
    });
    ensure('shop_catalog', {name:"TEXT NOT NULL DEFAULT ''", icon:"TEXT NOT NULL DEFAULT '⚔️'", price_coins:"INTEGER NOT NULL DEFAULT 0", damage:"INTEGER NOT NULL DEFAULT 0", active:"INTEGER NOT NULL DEFAULT 1", updated_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('inventory', {telegram_id:"TEXT NOT NULL DEFAULT ''", item_id:"TEXT NOT NULL DEFAULT ''", quantity:"INTEGER NOT NULL DEFAULT 1"});
    ensure('player_mail', {telegram_id:"TEXT NOT NULL DEFAULT ''", sender:"TEXT NOT NULL DEFAULT 'system'", subject:"TEXT NOT NULL DEFAULT ''", body:"TEXT NOT NULL DEFAULT ''", coins:"INTEGER NOT NULL DEFAULT 0", gems:"INTEGER NOT NULL DEFAULT 0", weapon_id:"TEXT DEFAULT ''", claimed:"INTEGER NOT NULL DEFAULT 0", created_at:"INTEGER NOT NULL DEFAULT 0", claimed_at:"INTEGER"});
    ensure('daily_scores', {day:"TEXT NOT NULL DEFAULT ''", telegram_id:"TEXT NOT NULL DEFAULT ''", score:"INTEGER NOT NULL DEFAULT 0", updated_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('tournament_awards', {day:"TEXT NOT NULL DEFAULT ''", telegram_id:"TEXT NOT NULL DEFAULT ''", place:"INTEGER NOT NULL DEFAULT 0", gold:"INTEGER NOT NULL DEFAULT 0"});
    ensure('finance', {telegram_id:"TEXT NOT NULL DEFAULT ''", kind:"TEXT NOT NULL DEFAULT ''", amount:"INTEGER NOT NULL DEFAULT 0", created_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('anti_cheat', {telegram_id:"TEXT NOT NULL DEFAULT ''", strikes:"INTEGER NOT NULL DEFAULT 0", last_action_ms:"INTEGER NOT NULL DEFAULT 0", banned:"INTEGER NOT NULL DEFAULT 0", updated_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('economy_ledger', {telegram_id:"TEXT NOT NULL DEFAULT ''", currency:"TEXT NOT NULL DEFAULT ''", amount:"INTEGER NOT NULL DEFAULT 0", balance_before:"INTEGER", balance_after:"INTEGER", kind:"TEXT NOT NULL DEFAULT ''", reference:"TEXT DEFAULT ''", reason:"TEXT DEFAULT ''", created_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('player_events', {telegram_id:"TEXT NOT NULL DEFAULT ''", category:"TEXT NOT NULL DEFAULT ''", action:"TEXT NOT NULL DEFAULT ''", details:"TEXT DEFAULT ''", created_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('mail_broadcasts', {admin_id:"TEXT NOT NULL DEFAULT 'admin'", audience:"TEXT NOT NULL DEFAULT 'all'", min_level:"INTEGER NOT NULL DEFAULT 1", subject:"TEXT NOT NULL DEFAULT ''", body:"TEXT NOT NULL DEFAULT ''", coins:"INTEGER NOT NULL DEFAULT 0", gems:"INTEGER NOT NULL DEFAULT 0", weapon_id:"TEXT DEFAULT ''", reason:"TEXT NOT NULL DEFAULT ''", recipient_count:"INTEGER NOT NULL DEFAULT 0", created_at:"INTEGER NOT NULL DEFAULT 0"});
    ensure('admin_audit', {admin_id:"TEXT NOT NULL DEFAULT 'admin'", telegram_id:"TEXT DEFAULT ''", action:"TEXT NOT NULL DEFAULT ''", before_json:"TEXT DEFAULT ''", after_json:"TEXT DEFAULT ''", reason:"TEXT DEFAULT ''", created_at:"INTEGER NOT NULL DEFAULT 0"});

    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_player ON player_events(telegram_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_player ON economy_ledger(telegram_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_arena_reward_player ON arena_reward_claims(telegram_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_player ON admin_audit(telegram_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mail ON player_mail(telegram_id,claimed,created_at);
      CREATE INDEX IF NOT EXISTS idx_score ON daily_scores(day,score DESC);
      CREATE INDEX IF NOT EXISTS idx_players_username ON players(username);
      CREATE INDEX IF NOT EXISTS idx_players_updated ON players(updated_at DESC);
    `);

    if (!this.sql.exec(`SELECT 1 FROM shop_catalog LIMIT 1`).toArray().length) {
      const t=now();
      for (const x of [
        ["axe","Боевой топор","🪓",300,12],
        ["sword","Стальной меч","⚔️",650,18],
        ["hammer","Молот","🔨",1000,25],
        ["crossbow","Арбалет","🏹",1500,31]
      ]) this.sql.exec(
        `INSERT INTO shop_catalog(item_id,name,icon,price_coins,damage,active,updated_at)
         VALUES(?,?,?,?,?,1,?)`,...x,t
      );
    }
    this.ready=true;
  }

  player(id){this.init();return this.sql.exec(`SELECT * FROM players WHERE telegram_id=?`,id).toArray()[0]||null}

  upsert(user){
    this.init(); const id=s(user.id),t=now();
    this.sql.exec(`INSERT INTO players
      (telegram_id,username,first_name,last_name,photo_url,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET
      username=excluded.username,first_name=excluded.first_name,
      last_name=excluded.last_name,photo_url=excluded.photo_url,updated_at=excluded.updated_at`,
      id,s(user.username),s(user.first_name),s(user.last_name),s(user.photo_url),t,t);
    this.event(id,'Auth','login','Telegram WebApp authentication');
    return this.player(id);
  }

  progress(id,p){
    this.init();
    // Client-side progress/stat writes are intentionally disabled.
    // Combat/economy/progression must be changed by server-owned actions only.
    return this.player(id);
  }

  gameState(id){this.init();const p=this.player(id);if(!p)return null;try{return p.state_json?JSON.parse(p.state_json):null}catch{return null;}}
  saveGameState(id,raw,allowProtected=false){this.init();const p=this.player(id);if(!p)throw Error("Player not found");const incoming=(raw&&typeof raw==='object'&&!Array.isArray(raw))?{...raw}:{};const economyKeys=["coins","gems","redGems","red_gems"];for(const k of economyKeys)delete incoming[k];const protectedKeys=["level","xp","xpNext","currentChapter","chapterStage","chapterProgress","chapterBossUnlocked","chapterBossDefeated","chapterCompleted","battleStones","battleStonesBonus","battleStonesDate","battleStonesCap","pve","lootFound","totalChaptersCompleted","chapterRewardsClaimed","rewardProgress","rewardClaims","daily","weekly","story","achievementClaims","chapterEvents","npcRelations","npcInteractionLog","npcRewards","npcQuests","npcStories","npcStoryAftermath","npcEndings","worldUnlocks","worldLocationActions","worldLocationRewards","worldMemories","worldEchoes","worldConvergence","worldBranchEvents","worldPathFrontiers","worldFrontierAftermath","worldFinale","heroChronicle","followers","activeFollower","arena"];if(!allowProtected)for(const k of protectedKeys)delete incoming[k];const old=this.gameState(id)||{};const x={...old,...incoming};x.currentChapter=clamp(x.currentChapter,1,240,1);x.chapterStage=clamp(x.chapterStage,1,4,1);x.chapterProgress=clamp(x.chapterProgress,0,100,0);x.battleStones=clamp(x.battleStones,0,1000000,30);x.battleStonesBonus=clamp(x.battleStonesBonus,0,1000000,0);x.pve=(x.pve&&typeof x.pve==='object')?x.pve:{chapter:x.currentChapter,stage:x.chapterStage,progress:x.chapterProgress};x.followers=(x.followers&&typeof x.followers==='object')?x.followers:{activeFollower:"liabro",items:{liabro:{id:"liabro",owned:true,level:1,xp:0,awakened:false,awakeningClaimed:false}}};x.followers.activeFollower=x.followers.activeFollower||"liabro";x.arena=(x.arena&&typeof x.arena==='object')?x.arena:{rating:1000,wins:0,losses:0,battles:0};x.arena.rating=Math.max(0,Number(x.arena.rating)||1000);x.arena.wins=Math.max(0,Number(x.arena.wins)||0);x.arena.losses=Math.max(0,Number(x.arena.losses)||0);x.arena.battles=Math.max(0,Number(x.arena.battles)||0);const serverItems=Array.isArray(old.inventoryItems)?old.inventoryItems.slice(0,100):[];x.inventoryItems=serverItems;const incomingEquipment=Array.isArray(incoming.equipment)?incoming.equipment:[];if(incomingEquipment.length){const byId=new Map(serverItems.filter(it=>it&&it.id).map(it=>[String(it.id),it]));x.equipment=incomingEquipment.slice(0,7).map(it=>{const id=it&&it.id?String(it.id):'';return byId.get(id)||null;});while(x.equipment.length<7)x.equipment.push(null);}else if(!Array.isArray(x.equipment))x.equipment=Array(7).fill(null);const oldForge=(old.forge&&typeof old.forge==='object')?old.forge:{};const selected=incoming.forge&&typeof incoming.forge==='object'&&incoming.forge.selectedId?String(incoming.forge.selectedId):'';x.forge={...oldForge,materials:Math.max(0,Number(oldForge.materials)||0),successes:Math.max(0,Number(oldForge.successes)||0),failStreak:Math.max(0,Number(oldForge.failStreak)||0),selectedId:selected&&serverItems.some(it=>String(it?.id||'')===selected)?selected:(oldForge.selectedId||null)};const oldConsumables=(old.consumables&&typeof old.consumables==='object')?old.consumables:{};const incomingConsumables=(incoming.consumables&&typeof incoming.consumables==='object')?incoming.consumables:{};if(allowProtected){x.consumables=incomingConsumables;}else{const consumables={...oldConsumables};for(const [key,val] of Object.entries(incomingConsumables)){const prev=Math.max(0,Number(oldConsumables[key])||0);const next=Math.max(0,Math.floor(Number(val)||0));consumables[key]=Math.min(prev,next);}x.consumables=consumables;}this.sql.exec(`UPDATE players SET state_json=?,updated_at=? WHERE telegram_id=?`,JSON.stringify(x).slice(0,500000),now(),id);return x;}
  playerPayload(id){const p=this.player(id);if(!p)throw Error("Player not found");return {schema_version:1,telegram_id:p.telegram_id,username:p.username,first_name:p.first_name,last_name:p.last_name,photo_url:p.photo_url,level:p.level,xp:p.exp,xp_next:Math.max(100,100*p.level),hp:p.hp,max_hp:p.max_hp,coins:p.coins,gems:p.gems,red_gems:Math.max(0,Number(p.red_gems)||0),vip:Math.max(0,Number(p.vip)||0),has_server_progress:!!p.state_json&&p.state_json!=='{}',legacy_imported:false,banned:!!p.banned};}
  economySnapshot(id){const p=this.player(id);if(!p)throw Error("Player not found");return {coins:p.coins,gems:p.gems,red_gems:Math.max(0,Number(p.red_gems)||0),vip:Math.max(0,Number(p.vip)||0)};}
  pveStart(id,chapter,stage,boss){this.init();const p=this.player(id);if(!p)throw Error("Player not found");const s=this.gameState(id)||{currentChapter:1,chapterStage:1,chapterProgress:0,battleStones:30,battleStonesBonus:0,pve:{chapter:1,stage:1,progress:0}};chapter=clamp(chapter,1,240,1);stage=clamp(stage,1,4,1);boss=!!boss;if(chapter!==clamp(s.currentChapter,1,240,1))throw Error("Chapter mismatch");if(!boss&&stage!==clamp(s.chapterStage,1,4,1))throw Error("Stage mismatch");if(boss&&!s.chapterBossUnlocked&&!(s.pve&&s.pve.bossPending))throw Error("Boss is not unlocked");const active=this.sql.exec(`SELECT session_id FROM pve_sessions WHERE telegram_id=? AND ended=0 AND created_at>? LIMIT 1`,id,Date.now()-1800000).toArray()[0];if(active)throw Error("A PvE battle is already active");let bonus=clamp(s.battleStonesBonus,0,1000000,0),stones=clamp(s.battleStones,0,1000000,30);if(bonus>0)s.battleStonesBonus=bonus-1;else{if(stones<=0)throw Error("No battle stones");s.battleStones=stones-1;}const sid=crypto.randomUUID(),nonce=crypto.randomUUID().replace(/-/g,''),created=Date.now(),maxHp=Math.max(100,Number(p.max_hp)||100),heroHp=Math.max(1,Number(p.hp)||maxHp),level=Math.max(1,Number(p.level)||1),enemyMax=boss?2600:Math.round([1100,1250,1400,1600][stage-1]*(1+(chapter-1)*0.055)),damage=Math.max(boss?24:20,Math.floor((125+level*2+Number(p.strength||0))/(boss?4:5))),c={heroHp,maxHp,enemyHp:enemyMax,enemyMaxHp:enemyMax,damage,turn:0,guard:0,elixirCaps:{hp:Math.max(0,Number(s.consumables?.elixir_hp)||0),energy:Math.max(0,Number(s.consumables?.elixir_energy)||0),attack:Math.max(0,Number(s.consumables?.elixir_attack)||0),guard:Math.max(0,Number(s.consumables?.elixir_guard)||0)},elixirUses:{hp:0,energy:0,attack:0,guard:0}};this.sql.exec(`INSERT INTO pve_sessions(session_id,telegram_id,chapter,stage,boss,created_at,nonce,hero_hp,max_hp,enemy_hp,enemy_max_hp,damage,actions,ended,result,state_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,sid,id,chapter,stage,boss?1:0,created,nonce,heroHp,maxHp,enemyMax,enemyMax,damage,0,0,'',JSON.stringify(c));this.saveGameState(id,s,true);this.event(id,'PvE','start',JSON.stringify({session_id:sid,chapter,stage,boss}));return {session_id:sid,nonce,seed:crypto.randomUUID(),state:s,combat:c};}
  pveAction(id,sid,nonce,action){this.init();const r=this.sql.exec(`SELECT * FROM pve_sessions WHERE session_id=? AND telegram_id=?`,sid,id).toArray()[0];if(!r||r.ended)throw Error("Invalid or completed battle session");if(String(nonce)!==String(r.nonce))throw Error("Invalid battle nonce");if(Date.now()-Number(r.created_at)>1800000)throw Error("Battle session expired");const a=String(action||'');if(!/^(attack|skill:(power|guard|fire|burst|crown)|elixir_(hp|energy|attack|guard))$/.test(a))throw Error("Invalid battle action");const c=JSON.parse(r.state_json||'{}');c.elixirCaps=c.elixirCaps||{};c.elixirUses=c.elixirUses||{};const elKey=a.startsWith('elixir_')?a.slice(7):'';if(elKey){const cap=Math.max(0,Number(c.elixirCaps[elKey])||0),used=Math.max(0,Number(c.elixirUses[elKey])||0);if(used>=cap)throw Error('No '+elKey+' elixirs available');c.elixirUses[elKey]=used+1;}let dmg=0;if(a==='elixir_hp')c.heroHp=Math.min(c.maxHp,c.heroHp+30);else if(a==='elixir_energy'){}else if(a==='elixir_attack')c.damage+=5;else if(a==='elixir_guard')c.guard=Math.min(.55,(c.guard||0)+.08);else if(a==='skill:guard')c.heroHp=Math.min(c.maxHp,c.heroHp+Math.floor(c.maxHp*.12));else if(a==='skill:crown')c.heroHp=Math.min(c.maxHp,c.heroHp+Math.floor(c.maxHp*.2));else{dmg=a==='skill:power'?Math.floor(c.damage*1.8):a==='skill:fire'?Math.floor(c.damage*1.45):a==='skill:burst'?0:c.damage;if(a==='skill:burst')c.damage+=4;c.enemyHp=Math.max(0,c.enemyHp-dmg);}c.turn=Number(c.turn||0)+1;if(c.enemyHp<=0){r.ended=1;r.result='win';}else{const incoming=Math.max(1,Math.round((r.boss?26:12)*(1-(c.guard||0))));c.heroHp=Math.max(0,c.heroHp-incoming);if(c.heroHp<=0){r.ended=1;r.result='lose';}}r.actions=Number(r.actions||0)+1;r.hero_hp=c.heroHp;r.enemy_hp=c.enemyHp;r.state_json=JSON.stringify(c);if(elKey){const gs=this.gameState(id)||{};gs.consumables=gs.consumables&&typeof gs.consumables==='object'?gs.consumables:{};gs.consumables['elixir_'+elKey]=Math.max(0,(Number(gs.consumables['elixir_'+elKey])||0)-1);this.saveGameState(id,gs,true)}this.sql.exec(`UPDATE pve_sessions SET hero_hp=?,enemy_hp=?,actions=?,ended=?,result=?,state_json=? WHERE session_id=?`,c.heroHp,c.enemyHp,r.actions,r.ended,r.result,r.state_json,sid);return {accepted:true,index:r.actions,combat:{heroHp:c.heroHp,maxHp:c.maxHp,enemyHp:c.enemyHp,enemyMaxHp:c.enemyMaxHp,turn:c.turn,ended:!!r.ended,result:r.result||null,bossTime:r.boss?Math.max(0,20-Math.floor((Date.now()-r.created_at)/1000)):null}};}
  pveComplete(id,sid){this.init();const r=this.sql.exec(`SELECT * FROM pve_sessions WHERE session_id=? AND telegram_id=?`,sid,id).toArray()[0];if(!r||r.ended===2)throw Error("Invalid or already completed battle session");const age=Date.now()-Number(r.created_at);if(age>1800000)throw Error("Battle session expired");if(r.result!=='win')throw Error("Server has not confirmed the battle victory");if(Number(r.actions)<(r.boss?3:2))throw Error("Battle transcript is incomplete");if(age<(r.boss?5000:1500))throw Error("Battle completed too quickly");const s=this.gameState(id)||{};const chapter=Number(r.chapter),stage=Number(r.stage),boss=!!r.boss,reward=boss?{coins:chapter%10===0?1250:500,gems:chapter%10===0?25:5}:{coins:25,gems:0},p=this.player(id),beforeCoins=p.coins,beforeGems=p.gems;let xp=Number(p.exp)||0,lv=Math.max(1,Number(p.level)||1),add=boss?60:20;while(lv<240&&xp+add>=xpTarget(lv)){add-=xpTarget(lv)-xp;lv++;xp=0;}xp+=add;this.sql.exec(`UPDATE players SET coins=coins+?,gems=gems+?,exp=?,level=?,updated_at=? WHERE telegram_id=?`,reward.coins,reward.gems,xp,lv,now(),id);this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',reward.coins,beforeCoins,beforeCoins+reward.coins,'pve_reward',sid,boss?'PvE boss reward':'PvE stage reward',now());if(reward.gems)this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'gems',reward.gems,beforeGems,beforeGems+reward.gems,'pve_reward',sid,'PvE boss gems',now());const loot={id:`loot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:(boss?'Героический ':'Воинский ')+['Оружие','Шлем','Доспех','Пояс'][Math.max(0,stage-1)],title:'PvE loot',slot:['weapon','helmet','armor','belt'][Math.max(0,stage-1)],type:'equipment',rarity:boss?'epic':'rare',level:lv,enhance:0,attack:stage*4+(boss?18:0),defense:stage*3,setId:boss?'warchief':'tide',source:'pve'};s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems.unshift(loot);s.inventoryItems=s.inventoryItems.slice(0,100);s.lootFound=(Number(s.lootFound)||0)+1;s.rewardProgress=s.rewardProgress&&typeof s.rewardProgress==='object'?s.rewardProgress:{};s.rewardProgress.dailyDate=new Date().toISOString().slice(0,10);s.rewardProgress.daily=s.rewardProgress.daily||{wins:0,loot:0,forge:0,bosses:0,chapters:0};s.rewardProgress.daily.loot++;s.rewardProgress.weekly=s.rewardProgress.weekly||{wins:0,loot:0,forge:0,bosses:0,chapters:0};s.rewardProgress.weekly.loot++;if(!boss){s.rewardProgress.daily.wins++;s.rewardProgress.weekly.wins++;}else{s.pve.bossDefeated=(Number(s.pve?.bossDefeated)||0)+1;s.rewardProgress.daily.bosses++;s.rewardProgress.weekly.bosses++;}if(boss){s.chapterBossUnlocked=false;s.chapterBossDefeated=true;s.chapterCompleted=true;s.totalChaptersCompleted=(Number(s.totalChaptersCompleted)||0)+1;s.rewardProgress.daily.chapters++;s.rewardProgress.weekly.chapters++;s.forge=s.forge||{};s.forge.materials=(Number(s.forge.materials)||0)+(10+chapter);if(chapter<240){s.currentChapter=chapter+1;s.chapterStage=1;s.chapterProgress=0;s.chapterBossUnlocked=false;s.chapterBossDefeated=false;s.chapterCompleted=false;s.pve={chapter:chapter+1,stage:1,progress:0,bossPending:false,bossActive:false};}}else{s.chapterProgress=Math.min(100,(Number(s.chapterProgress)||0)+25);s.chapterStage=Math.min(4,stage+1);s.pve={...(s.pve||{}),chapter,stage:s.chapterStage,progress:s.chapterProgress,wins:(Number(s.pve?.wins)||0)+1};if(s.chapterProgress>=100){s.chapterBossUnlocked=true;s.pve.bossPending=true;}}this.saveGameState(id,s,true);this.sql.exec(`UPDATE pve_sessions SET ended=2 WHERE session_id=?`,sid);this.event(id,'PvE','complete',JSON.stringify({session_id:sid,chapter,stage,boss,reward}));const np=this.player(id);return {reward,economy:{coins:np.coins,gems:np.gems,red_gems:0,vip:0},player:this.playerPayload(id),state:s,loot,xp:{level:np.level,xp:np.exp,xpNext:xpTarget(np.level)}};}

  buyConsumable(id,itemId){
    this.init();
    const catalog={elixir_hp:{price:80,max:10},elixir_energy:{price:70,max:10},elixir_attack:{price:120,max:10},elixir_guard:{price:120,max:10},adrenaline:{price:300,max:5},speed_scroll:{price:180,max:10},anti_speed_scroll:{price:180,max:10}};
    const item=catalog[String(itemId||'')]; if(!item)throw Error('Consumable not found');
    const p=this.player(id); if(!p)throw Error('Player not found');
    const state=this.gameState(id)||{}; const c=state.consumables&&typeof state.consumables==='object'?state.consumables:{};
    const qty=Math.max(0,Number(c[itemId])||0); if(qty>=item.max)throw Error('Consumable stock is full');
    if(Number(p.coins)<item.price)throw Error('Not enough coins');
    const before=p.coins; c[itemId]=qty+1; state.consumables=c;
    this.sql.exec(`UPDATE players SET coins=?,updated_at=? WHERE telegram_id=?`,before-item.price,now(),id);
    this.saveGameState(id,state,true);
    this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',-item.price,before,before-item.price,'consumable_purchase',String(itemId),'Consumable purchase',now());
    this.event(id,'Shop','buy_consumable',JSON.stringify({item_id:itemId,price:item.price}));
    const np=this.player(id); return {player:this.playerPayload(id),state:this.gameState(id),economy:this.economySnapshot(id),item_id:itemId,quantity:c[itemId]};
  }

  forgeUpgrade(id,itemId){
    this.init();
    const state=this.gameState(id)||{},items=Array.isArray(state.inventoryItems)?state.inventoryItems:[],item=items.find(x=>x&&String(x.id)===String(itemId));
    if(!item)throw Error('Предмет не найден на сервере');
    const level=Math.max(1,Number(item.level)||1),rank=String(item.rarity||'common').toLowerCase()==='legendary'?5:String(item.rarity||'common').toLowerCase()==='epic'?4:String(item.rarity||'common').toLowerCase()==='rare'?3:String(item.rarity||'common').toLowerCase()==='uncommon'?2:1,enh=Math.max(0,Number(item.enhance)||0);
    const forgeMult=Math.min(3.2,1+Math.max(0,level-1)/55),coinCost=Math.floor(35*level*(1+rank*.35)*(1+enh*.18)*forgeMult),matCost=Math.max(1,Math.ceil((level+enh)*forgeMult/2));
    const p=this.player(id);if(!p)throw Error('Player not found');if(Number(p.coins)<coinCost)throw Error('Недостаточно монет');
    state.forge=state.forge&&typeof state.forge==='object'?state.forge:{};if(Number(state.forge.materials||0)<matCost)throw Error('Недостаточно материалов');
    const before=p.coins;state.forge.materials=Math.max(0,Number(state.forge.materials)||0)-matCost;
    const baseChance=enh<3?1:Math.max(.35,1-(enh-2)*.12),pity=Math.min(.18,Math.max(0,Number(state.forge.failStreak)||0)*.06),chance=Math.min(.95,baseChance+pity),ok=Math.random()<chance;
    if(ok){item.enhance=enh+1;item.level=level+1;const gain=Math.max(1,Math.floor(item.level*(1+rank*.12)));if(item.attack)item.attack+=Math.max(1,Math.floor(gain*.45));if(item.defense)item.defense+=Math.max(1,Math.floor(gain*.4));if(item.agility)item.agility+=Math.max(1,Math.floor(gain*.18));if(item.maxHp)item.maxHp+=Math.max(2,gain*2);state.forge.successes=Math.max(0,Number(state.forge.successes)||0)+1;state.rewardProgress=state.rewardProgress&&typeof state.rewardProgress==='object'?state.rewardProgress:{};state.rewardProgress.daily=state.rewardProgress.daily||{wins:0,loot:0,forge:0,bosses:0,chapters:0};state.rewardProgress.weekly=state.rewardProgress.weekly||{wins:0,loot:0,forge:0,bosses:0,chapters:0};state.rewardProgress.daily.forge++;state.rewardProgress.weekly.forge++;state.forge.failStreak=0;}else state.forge.failStreak=Math.max(0,Number(state.forge.failStreak)||0)+1;
    this.sql.exec(`UPDATE players SET coins=?,updated_at=? WHERE telegram_id=?`,before-coinCost,now(),id);this.saveGameState(id,state,true);this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',-coinCost,before,before-coinCost,'forge',String(itemId),ok?'Forge upgrade':'Forge attempt',now());this.event(id,'Forge',ok?'upgrade_success':'upgrade_fail',JSON.stringify({item_id:itemId,coinCost,matCost,chance:Math.round(chance*100)}));
    return {ok:true,success:ok,player:this.playerPayload(id),state:this.gameState(id),item,coinCost,matCost,chance:Math.round(chance*100)};
  }
  forgeSalvage(id,itemId){
    this.init();const state=this.gameState(id)||{},items=Array.isArray(state.inventoryItems)?state.inventoryItems:[],idx=items.findIndex(x=>x&&String(x.id)===String(itemId));if(idx<0)throw Error('Предмет не найден на сервере');const item=items[idx],rank=String(item.rarity||'common').toLowerCase()==='legendary'?5:String(item.rarity||'common').toLowerCase()==='epic'?4:String(item.rarity||'common').toLowerCase()==='rare'?3:String(item.rarity||'common').toLowerCase()==='uncommon'?2:1,level=Math.max(1,Number(item.level)||1),mats=Math.max(1,rank+Math.floor(level/3)),coins=Math.max(5,rank*8+Math.floor(level*2));state.forge=state.forge&&typeof state.forge==='object'?state.forge:{};state.forge.materials=Math.max(0,Number(state.forge.materials)||0)+mats;if(String(state.forge.selectedId||'')===String(itemId))state.forge.selectedId=null;state.inventoryItems=items.slice(0,idx).concat(items.slice(idx+1));if(Array.isArray(state.equipment))state.equipment=state.equipment.map(x=>String(x?.id||'')===String(itemId)?null:x);const p=this.player(id),before=p.coins;this.sql.exec(`UPDATE players SET coins=?,updated_at=? WHERE telegram_id=?`,before+coins,now(),id);this.saveGameState(id,state,true);this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',coins,before,before+coins,'forge_salvage',String(itemId),'Forge salvage',now());this.event(id,'Forge','salvage',JSON.stringify({item_id:itemId,coins,mats}));return {ok:true,player:this.playerPayload(id),state:this.gameState(id),coins,mats};
  }

  rewardClaim(id,kind,itemId){
    this.init(); const p=this.player(id); if(!p)throw Error('Player not found');
    const state=this.gameState(id)||{};
    const rp=state.rewardProgress&&typeof state.rewardProgress==='object'?state.rewardProgress:{};
    const today=new Date().toISOString().slice(0,10), nowDate=new Date(), day=(nowDate.getUTCDay()+6)%7;
    const monday=new Date(Date.UTC(nowDate.getUTCFullYear(),nowDate.getUTCMonth(),nowDate.getUTCDate()-day));
    const week=monday.toISOString().slice(0,10);
    if(rp.dailyDate!==today){rp.dailyDate=today;rp.daily={wins:0,loot:0,forge:0,bosses:0,chapters:0};rp.dailyClaims={};}
    if(rp.week!==week){rp.week=week;rp.weekly={wins:0,loot:0,forge:0,bosses:0,chapters:0};rp.weeklyClaims={};}
    rp.daily=rp.daily||{wins:0,loot:0,forge:0,bosses:0,chapters:0};rp.weekly=rp.weekly||{wins:0,loot:0,forge:0,bosses:0,chapters:0};
    rp.storyClaims=rp.storyClaims||{};rp.achievementClaims=rp.achievementClaims||{};
    const addReward=(r)=>{r=r||{};const beforeC=p.coins,beforeG=p.gems;let xp=Number(p.exp)||0,lv=Math.max(1,Number(p.level)||1),gain=Math.max(0,Number(r.xp)||0);while(gain>0&&lv<240){const need=xpTarget(lv)-xp;if(gain>=need){gain-=need;lv++;xp=0}else{xp+=gain;gain=0}}this.sql.exec(`UPDATE players SET coins=coins+?,gems=gems+?,exp=?,level=?,updated_at=? WHERE telegram_id=?`,Number(r.coins)||0,Number(r.gems)||0,xp,lv,now(),id);if(r.coins)this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',Number(r.coins),beforeC,beforeC+Number(r.coins),'reward',String(itemId||kind),'Authoritative reward',now());if(r.gems)this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'gems',Number(r.gems),beforeG,beforeG+Number(r.gems),'reward',String(itemId||kind),'Authoritative reward',now());state.forge=state.forge&&typeof state.forge==='object'?state.forge:{};state.forge.materials=Math.max(0,Number(state.forge.materials)||0)+(Number(r.materials)||0);state.rewardProgress=rp;return {xp:xp,level:lv};};
    let reward=null,claimKey=String(itemId||'current');
    const daily={daily_wins:{key:'wins',need:3,reward:{coins:300,xp:20}},daily_loot:{key:'loot',need:2,reward:{coins:250,materials:5}},daily_forge:{key:'forge',need:1,reward:{coins:350,gems:3}},daily_boss:{key:'bosses',need:1,reward:{coins:500,gems:5}}};
    const weekly={weekly_wins:{key:'wins',need:15,reward:{coins:1800,gems:12,xp:120}},weekly_loot:{key:'loot',need:10,reward:{coins:1400,materials:20}},weekly_forge:{key:'forge',need:5,reward:{coins:2200,gems:15,materials:15}},weekly_boss:{key:'bosses',need:2,reward:{coins:2600,gems:18,xp:150}},weekly_chapters:{key:'chapters',need:2,reward:{coins:3000,gems:20,materials:20}}};
    const achievements={first_win:{check:()=>Number(state.pve?.wins||0)>=1,reward:{coins:150,xp:25}},first_boss:{check:()=>Number(state.pve?.bossDefeated||0)>=1,reward:{coins:500,gems:5,materials:5}},chapters_5:{check:()=>Number(state.totalChaptersCompleted||0)>=5,reward:{coins:750,gems:10}},chapters_10:{check:()=>Number(state.totalChaptersCompleted||0)>=10,reward:{coins:1500,gems:20,materials:15}},chapters_25:{check:()=>Number(state.totalChaptersCompleted||0)>=25,reward:{coins:3000,gems:35,materials:30}},level_10:{check:()=>Number(p.level||1)>=10,reward:{coins:1000,gems:10}},loot_20:{check:()=>Number(state.lootFound||0)>=20,reward:{coins:1000,materials:20}},forge_5:{check:()=>Number(state.forge?.successes||0)>=5,reward:{coins:1200,gems:15,materials:10}}};
    if(kind==='daily'){const m=daily[claimKey];if(!m)throw Error('Unknown daily reward');if(rp.dailyClaims[claimKey])throw Error('Награда уже получена');if(Number(rp.daily[m.key]||0)<m.need)throw Error('Задание ещё не выполнено');reward=m.reward;rp.dailyClaims[claimKey]=true;state.daily={...(state.daily||{}),date:today,claims:{...(state.daily?.claims||{}),[claimKey]:true},wins:rp.daily.wins,loot:rp.daily.loot,forge:rp.daily.forge,bosses:rp.daily.bosses};}
    else if(kind==='weekly'){const m=weekly[claimKey];if(!m)throw Error('Unknown weekly reward');if(rp.weeklyClaims[claimKey])throw Error('Награда уже получена');if(Number(rp.weekly[m.key]||0)<m.need)throw Error('Задание ещё не выполнено');reward=m.reward;rp.weeklyClaims[claimKey]=true;state.weekly={...(state.weekly||{}),week,claims:{...(state.weekly?.claims||{}),[claimKey]:true},wins:rp.weekly.wins,loot:rp.weekly.loot,forge:rp.weekly.forge,bosses:rp.weekly.bosses,chapters:rp.weekly.chapters};}
    else if(kind==='achievement'){const a=achievements[claimKey];if(!a)throw Error('Unknown achievement');if(rp.achievementClaims[claimKey])throw Error('Награда уже получена');if(!a.check())throw Error('Достижение ещё не выполнено');reward=a.reward;rp.achievementClaims[claimKey]=true;state.achievementClaims={...(state.achievementClaims||{}),[claimKey]:true};}
    else if(kind==='story'){const chain=[{id:'story_1',need:2,key:'wins',reward:{coins:450,xp:35}},{id:'story_2',need:3,key:'loot',reward:{coins:600,gems:3,materials:5}},{id:'story_3',need:2,key:'forge',reward:{coins:800,gems:5,materials:10}},{id:'story_4',need:1,key:'bosses',reward:{coins:1200,gems:8,xp:80}},{id:'story_5',need:1,key:'chapters',reward:{coins:1800,gems:12,materials:20,xp:120}}];const st=state.story&&typeof state.story==='object'?state.story:{step:0,claimed:{},started:false};const m=chain[Math.min(chain.length-1,Math.max(0,Number(st.step)||0))];if(!m)throw Error('Story unavailable');if(st.claimed?.[m.id]||rp.storyClaims[m.id])throw Error('История уже получена');if(Number(rp[m.key]||0)<m.need)throw Error('Шаг истории ещё не выполнен');reward=m.reward;st.claimed={...(st.claimed||{}),[m.id]:true};st.step=Math.min(chain.length-1,(Number(st.step)||0)+1);st.started=true;state.story=st;rp.storyClaims[m.id]=true;}
    else throw Error('Unknown reward kind');
    addReward(reward); this.saveGameState(id,state,true); const np=this.player(id); return {ok:true,reward,player:this.playerPayload(id),state:this.gameState(id)};
  }


  worldClaim(id,kind,data={}){
    this.init();const p=this.player(id);if(!p)throw Error('Player not found');
    const s=this.gameState(id)||{};const n=v=>Math.max(0,Number(v)||0), add=(r)=>{
      r=r||{};const bc=p.coins,bg=p.gems;let xp=n(p.exp),lv=Math.max(1,n(p.level)||1),gain=n(r.xp);
      while(gain>0&&lv<240){const need=xpTarget(lv)-xp;if(gain>=need){gain-=need;lv++;xp=0}else{xp+=gain;gain=0}}
      this.sql.exec(`UPDATE players SET coins=coins+?,gems=gems+?,exp=?,level=?,updated_at=? WHERE telegram_id=?`,n(r.coins),n(r.gems),xp,lv,now(),id);
      if(n(r.coins))this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',n(r.coins),bc,bc+n(r.coins),'world_reward',kind,kind,now());
      if(n(r.gems))this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'gems',n(r.gems),bg,bg+n(r.gems),'world_reward',kind,kind,now());
      s.forge=s.forge&&typeof s.forge==='object'?s.forge:{};s.forge.materials=n(s.forge.materials)+n(r.materials);return {level:lv,xp};
    };
    const key=(a,b)=>`${a}:${b}`;
    const ch=Math.max(1,n(s.currentChapter)||1);
    const relations=(m)=>{s.npcRelations=s.npcRelations&&typeof s.npcRelations==='object'?s.npcRelations:{};for(const [k,v] of Object.entries(m||{}))s.npcRelations[k]=Math.min(100,n(s.npcRelations[k])+n(v));};
    const memory=(k,v)=>{s.worldMemories=s.worldMemories&&typeof s.worldMemories==='object'?s.worldMemories:{};s.worldMemories[k]={...v,at:now()};};
    let reward=null;

    if(kind==='world_event'){
      const events={camp:{rest:{coins:120,xp:20},search:{coins:220,materials:3}},trader:{trade:{gems:2,materials:5},help:{coins:300,xp:30}},shrine:{honor:{gems:4,xp:45},study:{coins:180,materials:8}}};
      const eid=String(data.event_id||''),cid=String(data.choice_id||''),r=events[eid]?.[cid];if(!r)throw Error('Unknown world event');
      s.chapterEvents=s.chapterEvents||{};const k=key(ch,eid);if(s.chapterEvents[k])throw Error('Событие уже выбрано в этой главе');s.chapterEvents[k]={choice:cid,at:now()};reward=r;
    } else if(kind==='npc_interact'){
      const npc=String(data.npc_id||''),action=String(data.action||'');if(!['bjorn','astrid','einar'].includes(npc)||!['talk','help','gift'].includes(action))throw Error('Unknown NPC action');
      s.npcInteractionLog=s.npcInteractionLog&&typeof s.npcInteractionLog==='object'?s.npcInteractionLog:{};const k=`${ch}:${npc}:${action}`;if(s.npcInteractionLog[k])throw Error('Действие уже выполнено в этой главе');
      if(action==='help'&&n(p.coins)<100)throw Error('Недостаточно монет');if(action==='gift'&&n(s.forge?.materials)<2)throw Error('Недостаточно материалов');
      if(action==='help')this.sql.exec(`UPDATE players SET coins=coins-100,updated_at=? WHERE telegram_id=?`,now(),id);if(action==='gift')s.forge.materials=n(s.forge.materials)-2;
      const before=Math.floor(n(s.npcRelations?.[npc])/25),gain=action==='talk'?5:action==='help'?10:8;s.npcRelations=s.npcRelations||{};s.npcRelations[npc]=Math.min(100,n(s.npcRelations[npc])+gain);const after=Math.floor(n(s.npcRelations[npc])/25);s.npcInteractionLog[k]=true;
      const rewards={bjorn:[{coins:250,materials:5},{coins:500,gems:3},{coins:900,materials:12},{coins:1600,gems:10,materials:20,xp:80}],astrid:[{coins:220,xp:25},{coins:450,gems:3},{coins:800,gems:6},{coins:1400,gems:12,xp:90}],einar:[{coins:200,materials:4},{coins:450,xp:35},{coins:750,gems:5},{coins:1500,gems:15,xp:110}]};
      s.npcRewards=s.npcRewards||{};if(after>before&&after<=4&&!s.npcRewards[`${npc}:${after}`]){const rr=rewards[npc][after-1]||{};s.npcRewards[`${npc}:${after}`]=true;add(rr);}
    } else if(kind==='npc_quest'){
      const qs={bjorn_axe:{npc:'bjorn',tier:1,key:'loot',need:3,reward:{coins:700,materials:8,xp:45}},bjorn_forge:{npc:'bjorn',tier:2,key:'forge',need:3,reward:{coins:1200,gems:5,materials:12,xp:70}},astrid_tracks:{npc:'astrid',tier:1,key:'wins',need:5,reward:{coins:800,gems:4,xp:55}},astrid_hunt:{npc:'astrid',tier:2,key:'bosses',need:1,reward:{coins:1600,gems:8,xp:100}},einar_runes:{npc:'einar',tier:1,key:'chapters',need:1,reward:{coins:900,materials:10,xp:65}},einar_oath:{npc:'einar',tier:2,key:'chapters',need:3,reward:{coins:2200,gems:12,materials:15,xp:130}}};
      const q=qs[String(data.quest_id||'')];if(!q)throw Error('Unknown NPC quest');const tier=Math.floor(n(s.npcRelations?.[q.npc])/25);if(tier<q.tier)throw Error('Квест ещё закрыт');
      const val=q.key==='wins'?n(s.pve?.wins):q.key==='loot'?n(s.lootFound):q.key==='forge'?n(s.forge?.successes):q.key==='bosses'?n(s.pve?.bossDefeated):Math.max(0,ch-1);if(val<q.need)throw Error('Квест ещё не выполнен');
      s.npcQuests=s.npcQuests||{claimed:{},progress:{}};s.npcQuests.claimed=s.npcQuests.claimed||{};if(s.npcQuests.claimed[q.quest_id])throw Error('Квест уже получен');s.npcQuests.claimed[String(data.quest_id)]=true;reward=q.reward;
      const unlocks={bjorn_forge:'bjorn_forge',astrid_hunt:'astrid_hunt',einar_ruins:'einar_ruins'};const u=unlocks[String(data.quest_id)];if(u){s.worldUnlocks=s.worldUnlocks||{};s.worldUnlocks[u]={unlockedAt:now(),source:String(data.quest_id)};}
    } else if(kind==='npc_story'){
      const defs={bjorn:{need:25,reward:{coins:300,materials:3,xp:25}},astrid:{need:50,reward:{coins:350,gems:2,xp:30}},einar:{need:75,reward:{coins:400,gems:3,materials:2,xp:40}}};const npc=String(data.npc_id||''),d=defs[npc];if(!d)throw Error('Unknown NPC story');if(n(s.npcRelations?.[npc])<d.need)throw Error('История ещё закрыта');s.npcStories=s.npcStories||{};if(s.npcStories[npc])throw Error('История уже открыта');s.npcStories[npc]={at:now(),chapter:ch};reward=d.reward;
    } else if(kind==='npc_after'){
      const defs={bjorn:{need:40,reward:{coins:520,materials:5,xp:55},relation:8},astrid:{need:60,reward:{coins:560,gems:2,xp:65},relation:8},einar:{need:85,reward:{gems:6,materials:4,xp:80},relation:8}};const npc=String(data.npc_id||''),d=defs[npc],st=s.npcStories?.[npc];if(!d||!st||ch<=n(st.chapter)||n(s.npcRelations?.[npc])<d.need)throw Error('Продолжение истории ещё закрыто');s.npcStoryAftermath=s.npcStoryAftermath||{};const k=key(ch,npc);if(s.npcStoryAftermath[k])throw Error('Продолжение уже пройдено');s.npcStoryAftermath[k]={at:now(),chapter:ch};s.npcRelations=s.npcRelations||{};s.npcRelations[npc]=Math.min(100,n(s.npcRelations[npc])+d.relation);reward=d.reward;
    } else if(kind==='npc_ending'){
      const npc=String(data.npc_id||'');const defs={bjorn:{need:90,variants:{blade:{coins:1200,gems:5,materials:15,xp:120},armor:{coins:1000,gems:8,materials:18,xp:110}}},astrid:{need:90,variants:{track:{coins:1100,gems:7,xp:125},ambush:{coins:950,gems:9,xp:120}}},einar:{need:90,variants:{read:{coins:900,gems:15,materials:10,xp:140},touch:{coins:800,gems:18,materials:8,xp:135}}}};const d=defs[npc];if(!d||n(s.npcRelations?.[npc])<d.need||!s.npcStories?.[npc])throw Error('Финал истории ещё закрыт');const hasAfter=Object.keys(s.npcStoryAftermath||{}).some(k=>k.endsWith(':'+npc));if(!hasAfter||ch<=n(s.npcStories[npc].chapter))throw Error('Финал истории ещё закрыт');s.npcEndings=s.npcEndings||{};if(s.npcEndings[npc])throw Error('Финал уже пройден');let variant=String(data.variant||'');if(!variant)variant=Object.keys(d.variants)[0];if(!d.variants[variant])variant=Object.keys(d.variants)[0];s.npcEndings[npc]={at:now(),chapter:ch,title:variant,variant};reward=d.variants[variant];
    } else if(kind==='location'){
      const defs={bjorn_forge:{unlock:'bjorn_forge',cost:{materials:5},choices:{weapon:{coins:520,gems:1,xp:45,rel:['bjorn',12]},armor:{coins:380,gems:3,materials:1,xp:40,rel:['bjorn',8]}}},astrid_hunt:{unlock:'astrid_hunt',cost:{energy:10},choices:{track:{coins:430,xp:38,loot:1,rel:['astrid',12]},ambush:{coins:300,gems:1,xp:48,loot:1,rel:['astrid',8]}}},einar_ruins:{unlock:'einar_ruins',cost:{energy:5},choices:{read:{gems:7,materials:3,xp:65,rel:['einar',12]},touch:{gems:4,materials:6,xp:50,rel:['einar',8]}}}};
      const lid=String(data.location_id||''),d=defs[lid],choice=String(data.choice_id||'');if(!d||!s.worldUnlocks?.[d.unlock])throw Error('Место ещё закрыто');const k=key(ch,lid);s.worldLocationActions=s.worldLocationActions||{};if(s.worldLocationActions[k])throw Error('Место уже использовано в этой главе');const r=d.choices[choice]||Object.values(d.choices)[0];if(d.cost.materials&&n(s.forge?.materials)<d.cost.materials)throw Error('Недостаточно материалов');if(d.cost.energy&&n(s.energy)<d.cost.energy)throw Error('Недостаточно энергии');s.forge=s.forge||{};s.forge.materials=n(s.forge.materials)-(d.cost.materials||0);s.energy=n(s.energy)-(d.cost.energy||0);s.worldLocationActions[k]={at:now(),choice};s.worldLocationRewards=s.worldLocationRewards||{};s.worldLocationRewards[k]={...r,loot:r.loot||0};if(r.rel){relations({[r.rel[0]]:r.rel[1]});}if(r.loot){const types=[['Охотничий клинок','🪓','weapon'],['Шкура северного волка','🛡️','armor'],['Амулет следопыта','🔮','amulet']];const [nm,ic,tp]=types[(ch-1)%types.length],pl=Math.max(1,n(p.level)),pw=6+Math.floor(ch/2);const item={id:`loc_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:nm,title:nm,slot:tp,icon:ic,rarity:'rare',level:pl,enhance:0,attack:tp==='weapon'?pw:0,defense:tp==='armor'?pw:0,agility:tp==='amulet'?Math.max(1,Math.floor(pw/2)):0,maxHp:tp==='armor'?pw*2:0,setId:'territory',setName:'Пути Territory',source:'world-location'};s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems.unshift(item);s.inventoryItems=s.inventoryItems.slice(0,100);s.lootFound=n(s.lootFound)+1;}reward=r;
    } else if(kind==='npc_convergence'){
      const paths={unite:{reward:{coins:1800,gems:12,materials:12,xp:180},relations:{bjorn:6,astrid:6,einar:6}},forge:{reward:{coins:2200,gems:8,materials:20,xp:170},relations:{bjorn:10,astrid:4,einar:4}},rune:{reward:{coins:1600,gems:18,materials:8,xp:200},relations:{bjorn:4,astrid:8,einar:10}}};const path=String(data.path||''),d=paths[path];if(!d||s.worldConvergence?.claimed)throw Error('Общая история недоступна');for(const npc of ['bjorn','astrid','einar'])if(!s.npcEndings?.[npc])throw Error('Личные истории не завершены');const maxEnd=Math.max(...['bjorn','astrid','einar'].map(x=>n(s.npcEndings[x]?.chapter)));if(ch<=maxEnd)throw Error('Перейди в следующую главу');s.worldConvergence={stage:2,path,claimed:true,chapter:ch,at:now()};relations(d.relations);reward=d.reward;
    } else if(kind==='branch'){
      const paths={unite:{council:{reward:{coins:900,gems:5,xp:90},relations:{bjorn:4,astrid:4,einar:4}},mission:{reward:{coins:1100,materials:5,xp:100},relations:{bjorn:3,astrid:5,einar:3}}},forge:{blade:{reward:{coins:1200,gems:3,materials:8,xp:105},relations:{bjorn:7,astrid:2,einar:2}},shield:{reward:{coins:950,gems:5,materials:10,xp:95},relations:{bjorn:5,astrid:4,einar:3}}},rune:{open:{reward:{gems:10,materials:5,xp:120},relations:{bjorn:2,astrid:5,einar:8}},mark:{reward:{coins:700,gems:8,xp:110},relations:{bjorn:3,astrid:6,einar:6}}}};const path=String(s.worldConvergence?.path||''),choice=String(data.choice_id||''),d=paths[path]?.[choice];if(!d||!s.worldConvergence?.claimed||ch<=n(s.worldConvergence.chapter))throw Error('Общее последствие ещё закрыто');s.worldBranchEvents=s.worldBranchEvents||{};const k=key(ch,path);if(s.worldBranchEvents[k])throw Error('Событие уже завершено');s.worldBranchEvents[k]={at:now(),path,choice,title:choice,chapter:ch};relations(d.relations);reward=d.reward;
    } else if(kind==='frontier'){
      const paths={unite:{welcome:{reward:{coins:1400,gems:6,xp:130},relations:{bjorn:3,astrid:4,einar:3}},guard:{reward:{coins:1700,materials:7,xp:140},relations:{bjorn:4,astrid:3,einar:2}}},forge:{trade:{reward:{coins:2100,gems:4,materials:8,xp:135},relations:{bjorn:6,astrid:2,einar:2}},arm:{reward:{coins:1500,gems:6,materials:10,xp:145},relations:{bjorn:5,astrid:4,einar:2}}},rune:{scout:{reward:{gems:12,xp:155},relations:{bjorn:2,astrid:7,einar:7}},cross:{reward:{coins:900,gems:15,materials:5,xp:170},relations:{bjorn:2,astrid:5,einar:9}}}};const path=String(s.worldConvergence?.path||''),choice=String(data.choice_id||''),d=paths[path]?.[choice];if(!d||!s.worldConvergence?.claimed||ch<=n(s.worldConvergence.chapter))throw Error('Граница ещё закрыта');const hasBranch=Object.values(s.worldBranchEvents||{}).some(v=>v&&v.path===path&&n(v.chapter)===ch);if(!hasBranch)throw Error('Сначала заверши последствие общего пути');s.worldPathFrontiers=s.worldPathFrontiers||{};const k=key(ch,path);if(s.worldPathFrontiers[k])throw Error('Граница уже определена');s.worldPathFrontiers[k]={at:now(),chapter:ch,path,choice,title:choice};relations(d.relations);reward=d.reward;
    } else if(kind==='frontier_after'){
      const paths={unite:{welcome:{share:{reward:{coins:1800,gems:5,xp:145},relations:{bjorn:4,astrid:5,einar:4}},reserve:{reward:{coins:2200,materials:6,xp:150},relations:{bjorn:5,astrid:3,einar:3}}},guard:{signal:{reward:{coins:1600,gems:7,xp:155},relations:{bjorn:3,astrid:5,einar:5}},watch:{reward:{coins:1900,gems:4,materials:5,xp:165},relations:{bjorn:4,astrid:6,einar:4}}}},forge:{trade:{quality:{reward:{coins:2600,gems:6,xp:165},relations:{bjorn:7,astrid:2,einar:2}},volume:{reward:{coins:3200,materials:9,xp:155},relations:{bjorn:6,astrid:3,einar:2}}},arm:{test:{reward:{coins:2100,gems:7,materials:8,xp:175},relations:{bjorn:7,astrid:5,einar:2}},march:{reward:{coins:2400,gems:5,xp:185},relations:{bjorn:5,astrid:7,einar:3}}}},rune:{scout:{map:{reward:{gems:14,xp:180},relations:{bjorn:3,astrid:8,einar:8}},follow:{reward:{coins:1300,gems:10,materials:4,xp:195},relations:{bjorn:3,astrid:9,einar:7}}},cross:{decode:{reward:{gems:18,materials:5,xp:205},relations:{bjorn:3,astrid:6,einar:10}},advance:{reward:{coins:1800,gems:12,xp:215},relations:{bjorn:3,astrid:8,einar:9}}}}};const path=String(s.worldConvergence?.path||''),choice=String(data.choice_id||'');const entries=Object.values(s.worldPathFrontiers||{}).filter(v=>v&&v.path===path&&n(v.chapter)<ch).sort((a,b)=>n(a.chapter)-n(b.chapter));if(!entries.length)throw Error('Отголосок границы ещё закрыт');const old=entries[entries.length-1],d=paths[path]?.[old.choice]?.[choice];if(!d)throw Error('Unknown frontier aftermath');s.worldFrontierAftermath=s.worldFrontierAftermath||{};const k=`${ch}:${path}:${old.choice}`;if(s.worldFrontierAftermath[k])throw Error('Продолжение уже пройдено');s.worldFrontierAftermath[k]={at:now(),chapter:ch,path,sourceChoice:old.choice,choice,title:choice};relations(d.relations);reward=d.reward;
    } else if(kind==='world_echo'){
      const defs={bjorn_blade_echo:{loc:'bjorn_forge',choices:['blade','weapon'],reward:{coins:700,materials:6,xp:65},npc:'bjorn',rel:15},bjorn_armor_echo:{loc:'bjorn_forge',choices:['armor','guard'],reward:{coins:520,gems:2,materials:8,xp:55},npc:'bjorn',rel:12},astrid_track_echo:{loc:'astrid_hunt',choices:['track'],reward:{coins:650,gems:2,xp:70,loot:1},npc:'astrid',rel:15},astrid_ambush_echo:{loc:'astrid_hunt',choices:['ambush'],reward:{coins:480,xp:78,loot:1},npc:'astrid',rel:12},einar_rune_echo:{loc:'einar_ruins',choices:['runes','read'],reward:{gems:5,materials:6,xp:85},npc:'einar',rel:15},einar_stone_echo:{loc:'einar_ruins',choices:['stone','touch'],reward:{gems:7,xp:95,materials:3},npc:'einar',rel:12}};const eid=String(data.echo_id||''),d=defs[eid];if(!d)throw Error('Unknown world echo');s.worldEchoes=s.worldEchoes||{};const k=key(ch,eid);if(s.worldEchoes[k])throw Error('Отголосок уже принят');const ok=Object.values(s.worldMemories||{}).some(m=>n(m.chapter)<ch&&m.location===d.loc&&d.choices.includes(m.choice));if(!ok)throw Error('Отголосок ещё не открыт');s.worldEchoes[k]={at:now(),source:d.loc};if(d.loot){const item={id:`echo_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,name:'Редкая добыча',title:'Редкая добыча',slot:'weapon',icon:'🎁',rarity:'rare',level:Math.max(1,n(p.level)),enhance:0,attack:7+Math.floor(ch/2),setId:'territory',source:'world-echo'};s.inventoryItems=Array.isArray(s.inventoryItems)?s.inventoryItems:[];s.inventoryItems.unshift(item);s.inventoryItems=s.inventoryItems.slice(0,100);s.lootFound=n(s.lootFound)+1;}relations({[d.npc]:d.rel});reward=d.reward;
    } else if(kind==='finale'){
      const base={unite:{reward:{coins:4200,gems:30,materials:25,xp:420}},forge:{reward:{coins:5000,gems:24,materials:35,xp:400}},rune:{reward:{coins:3600,gems:42,materials:18,xp:460}}};const endings={unite_trust:{reward:{coins:1800,gems:12,xp:180}},unite_courage:{reward:{coins:2200,gems:8,xp:190}},forge_guardian:{reward:{coins:2400,gems:10,materials:8,xp:210}},forge_flame:{reward:{coins:2800,gems:8,materials:6,xp:220}},rune_crossing:{reward:{coins:1900,gems:18,xp:240}},rune_keeper:{reward:{coins:1700,gems:22,materials:5,xp:250}}};const path=String(s.worldConvergence?.path||''),d=base[path];if(!d||!s.worldConvergence?.claimed||s.worldFinale?.claimed)throw Error('Финал ещё закрыт');const hasBranch=Object.values(s.worldBranchEvents||{}).some(v=>v&&v.path===path&&n(v.chapter)>n(s.worldConvergence.chapter));const hasFront=Object.values(s.worldPathFrontiers||{}).some(v=>v&&v.path===path&&n(v.chapter)>n(s.worldConvergence.chapter));const hasAfter=Object.values(s.worldFrontierAftermath||{}).some(v=>v&&n(v.chapter)>=ch);if(ch<=n(s.worldConvergence.chapter)||!hasBranch||!hasFront||!hasAfter)throw Error('Финал ещё закрыт');const fronts=Object.values(s.worldPathFrontiers||{}).filter(v=>v&&v.path===path).sort((a,b)=>n(b.chapter)-n(a.chapter));const fc=fronts[0]?.choice||'';const ending=path==='unite'?(fc==='trust'?'unite_trust':'unite_courage'):path==='forge'?(fc==='shield'?'forge_guardian':'forge_flame'):(fc==='cross'?'rune_crossing':'rune_keeper');s.worldFinale={claimed:true,chapter:ch,path,ending,at:now()};reward=endings[ending]?.reward||d.reward;
    } else throw Error('Unknown world action');
    if(reward)add(reward);this.saveGameState(id,s,true);const np=this.player(id);return {ok:true,kind,player:this.playerPayload(id),state:this.gameState(id),reward:reward||null};
  }

  catalog(){this.init();return this.sql.exec(
    `SELECT item_id,name,icon,price_coins AS price,damage FROM shop_catalog
     WHERE active=1 ORDER BY id`).toArray();}

  buy(id,itemId){
    this.init();
    const p=this.player(id), w=this.sql.exec(
      `SELECT * FROM shop_catalog WHERE item_id=? AND active=1`,itemId
    ).toArray()[0];
    if(!p||!w)throw Error("Item not found");
    if(p.coins<w.price_coins)throw Error("Not enough coins");
    const before=p.coins, after=before-w.price_coins;
    this.sql.exec(`UPDATE players SET coins=?,weapon=?,updated_at=? WHERE telegram_id=?`,after,w.name,now(),id);
    this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,'coins',-w.price_coins,before,after,'shop_purchase',w.item_id,'Shop purchase',now());
    this.event(id,'Shop','buy',JSON.stringify({item_id:w.item_id,price:w.price_coins}));
    this.sql.exec(`INSERT INTO inventory(telegram_id,item_id,quantity) VALUES(?,?,1)
      ON CONFLICT(telegram_id,item_id) DO UPDATE SET quantity=quantity+1`,id,w.item_id);
    return this.player(id);
  }

  mail(id){this.init();return this.sql.exec(
    `SELECT id,sender,subject,body,coins,gems,weapon_id,claimed,created_at
     FROM player_mail WHERE telegram_id=? ORDER BY id DESC LIMIT 100`,id).toArray();}

  addMail(id,m){
    this.init();
    this.sql.exec(`INSERT INTO player_mail
      (telegram_id,sender,subject,body,coins,gems,weapon_id,claimed,created_at)
      VALUES(?,?,?,?,?,?,?,0,?)`,
      id,s(m.sender||"system").slice(0,80),s(m.subject||"Подарок").slice(0,120),
      s(m.body||"").slice(0,2000),Math.max(0,n(m.coins)),Math.max(0,n(m.gems)),
      s(m.weapon_id||"").slice(0,80),now());
  }

  claimMail(id,mailId){
    this.init();
    const m=this.sql.exec(`SELECT * FROM player_mail WHERE id=? AND telegram_id=?`,
      n(mailId),id).toArray()[0];
    if(!m)throw Error("Mail not found");
    if(m.claimed)throw Error("Already claimed");
    if(m.weapon_id&&!this.sql.exec(
      `SELECT item_id FROM shop_catalog WHERE item_id=?`,m.weapon_id).toArray()[0]
    )throw Error("Invalid weapon attachment");

    this.sql.exec(`UPDATE players SET coins=coins+?,gems=gems+?,updated_at=? WHERE telegram_id=?`,
      m.coins,m.gems,now(),id);
    if(m.weapon_id)this.sql.exec(`INSERT INTO inventory(telegram_id,item_id,quantity)
      VALUES(?,?,1) ON CONFLICT(telegram_id,item_id) DO UPDATE SET quantity=quantity+1`,
      id,m.weapon_id);
    this.sql.exec(`UPDATE player_mail SET claimed=1,claimed_at=? WHERE id=? AND telegram_id=?`,now(),m.id,id);
    this.event(id,'Mail','claim',JSON.stringify({mail_id:m.id,coins:m.coins,gems:m.gems,weapon_id:m.weapon_id}));
    return this.player(id);
  }

  top100(){this.init();return this.sql.exec(`SELECT telegram_id AS id,username,
    first_name,last_name,photo_url,level,exp FROM players WHERE banned=0
    ORDER BY level DESC,exp DESC,telegram_id ASC LIMIT 100`).toArray();}

  profile(id){this.init();return this.sql.exec(`SELECT telegram_id AS id,username,
    first_name,last_name,photo_url,level,exp,hp,max_hp,strength,agility,defense,weapon
    FROM players WHERE telegram_id=? AND banned=0`,id).toArray()[0]||null;}

  score(id,delta){
    this.init(); const d=day(),v=clamp(delta,0,10000);
    this.sql.exec(`INSERT INTO daily_scores(day,telegram_id,score,updated_at)
      VALUES(?,?,?,?) ON CONFLICT(day,telegram_id)
      DO UPDATE SET score=score+excluded.score,updated_at=excluded.updated_at`,
      d,id,v,now());
  }

  tournament(d){
    this.init();
    if(this.sql.exec(`SELECT 1 FROM tournament_awards WHERE day=? LIMIT 1`,d).toArray().length)
      return {day:d,already:true};
    const top=this.sql.exec(`SELECT telegram_id,score FROM daily_scores WHERE day=?
      ORDER BY score DESC,telegram_id ASC LIMIT 3`,d).toArray();
    const gold=[1000,700,500],result=[];
    for(let i=0;i<top.length;i++){
      const id=top[i].telegram_id,goldReward=gold[i];
      this.sql.exec(`UPDATE players SET coins=coins+?,updated_at=? WHERE telegram_id=?`,goldReward,now(),id);
      this.sql.exec(`INSERT INTO tournament_awards(day,telegram_id,place,gold) VALUES(?,?,?,?)`,
        d,id,i+1,goldReward);
      this.addMail(id,{sender:"Territory Tournament",subject:`Турнир — место #${i+1}`,
        body:`Награда за дневной турнир: ${goldReward} золота.`,coins:goldReward});
      result.push({id,place:i+1,gold:goldReward});
    }
    return {day:d,already:false,result};
  }

  antiAction(id){
    this.init();
    const t=Date.now(),r=this.sql.exec(
      `SELECT * FROM anti_cheat WHERE telegram_id=?`,id).toArray()[0];
    if(r?.banned)throw Error("Banned by anti-cheat");
    if(r?.last_action_ms && t-r.last_action_ms<MIN_ACTION_MS){
      const strikes=(r.strikes||0)+1,banned=strikes>=3?1:0;
      this.sql.exec(`INSERT INTO anti_cheat
        (telegram_id,strikes,last_action_ms,banned,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET strikes=excluded.strikes,
        last_action_ms=excluded.last_action_ms,banned=excluded.banned,updated_at=excluded.updated_at`,
        id,strikes,t,banned,now());
      if(banned){
        this.sql.exec(`UPDATE players SET banned=1,ban_reason=? WHERE telegram_id=?`,
          "Anti-cheat: action interval below 150ms",id);
        throw Error("Banned by anti-cheat");
      }
      throw Error("Action too fast");
    }
    this.sql.exec(`INSERT INTO anti_cheat
      (telegram_id,strikes,last_action_ms,banned,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(telegram_id) DO UPDATE SET last_action_ms=excluded.last_action_ms,
      updated_at=excluded.updated_at`,id,0,t,0,now());
  }

  event(id,category,action,details='') {
    this.sql.exec(`INSERT INTO player_events(telegram_id,category,action,details,created_at) VALUES(?,?,?,?,?)`,
      id,s(category).slice(0,40),s(action).slice(0,80),s(details).slice(0,2000),now());
  }

  audit(adminId,id,action,before,after,reason='') {
    this.sql.exec(`INSERT INTO admin_audit(admin_id,telegram_id,action,before_json,after_json,reason,created_at) VALUES(?,?,?,?,?,?,?)`,
      s(adminId||'admin'),s(id||''),s(action).slice(0,80),JSON.stringify(before||{}),JSON.stringify(after||{}),s(reason).slice(0,500),now());
  }

  playerDetail(id) {
    this.init();
    const p=this.player(id);
    if(!p) return null;
    const inv=this.sql.exec(`SELECT i.item_id,i.quantity,COALESCE(s.name,i.item_id) name,COALESCE(s.icon,'') icon FROM inventory i LEFT JOIN shop_catalog s ON s.item_id=i.item_id WHERE i.telegram_id=? ORDER BY i.id`,id).toArray();
    const mail=this.sql.exec(`SELECT id,subject,coins,gems,weapon_id,claimed,created_at,claimed_at FROM player_mail WHERE telegram_id=? ORDER BY id DESC LIMIT 50`,id).toArray();
    const ledger=this.sql.exec(`SELECT currency,amount,balance_before,balance_after,kind,reference,reason,created_at FROM economy_ledger WHERE telegram_id=? ORDER BY id DESC LIMIT 100`,id).toArray();
    const events=this.sql.exec(`SELECT category,action,details,created_at FROM player_events WHERE telegram_id=? ORDER BY id DESC LIMIT 200`,id).toArray();
    const anti=this.sql.exec(`SELECT strikes,last_action_ms,banned,updated_at FROM anti_cheat WHERE telegram_id=?`,id).toArray()[0]||null;
    return {player:p,inventory:inv,mail,ledger,events,anti};
  }

  playerHistory(id,category='') {
    this.init();
    const q=s(category).slice(0,40);
    if(q) return this.sql.exec(`SELECT category,action,details,created_at FROM player_events WHERE telegram_id=? AND category=? ORDER BY id DESC LIMIT 300`,id,q).toArray();
    return this.sql.exec(`SELECT category,action,details,created_at FROM player_events WHERE telegram_id=? ORDER BY id DESC LIMIT 300`,id).toArray();
  }

  adminAdjust(id,m) {
    this.init();
    const p=this.player(id); if(!p) throw Error('Player not found');
    const reason=s(m.reason).trim().slice(0,500); if(!reason) throw Error('Reason is required');
    const action=s(m.action).trim();
    const before={coins:p.coins,gems:p.gems,level:p.level,exp:p.exp,hp:p.hp};
    let sets=[],args=[];
    if(action==='coins' || action==='gems' || action==='exp' || action==='level' || action==='hp') {
      const key=action, delta=n(m.amount);
      if(!Number.isFinite(delta) || Math.abs(delta)>1000000000) throw Error('Invalid amount');
      if(key==='coins' || key==='gems') {
        const old=n(p[key]); const next=Math.max(0,old+delta); sets.push(`${key}=?`); args.push(next);
        this.sql.exec(`INSERT INTO economy_ledger(telegram_id,currency,amount,balance_before,balance_after,kind,reference,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,id,key,delta,old,next,'admin_adjust','admin',reason,now());
      } else if(key==='level') { const next=Math.max(1,Math.min(10000,n(m.value??delta))); sets.push('level=?'); args.push(next); }
      else if(key==='exp') { const next=Math.max(0,Math.min(1000000000,n(p.exp)+delta)); sets.push('exp=?'); args.push(next); }
      else if(key==='hp') { const next=Math.max(0,Math.min(n(p.max_hp),n(p.hp)+delta)); sets.push('hp=?'); args.push(next); }
    } else if(action==='energy') { throw Error('Energy is not yet in the backend schema'); }
    else throw Error('Unknown admin action');
    if(!sets.length) throw Error('Nothing to change');
    sets.push('updated_at=?'); args.push(now(),id);
    this.sql.exec(`UPDATE players SET ${sets.join(',')} WHERE telegram_id=?`,...args);
    const after=this.player(id); this.audit(m.admin_id,id,'adjust_'+action,before,after,reason); this.event(id,'Admin','adjust_'+action,JSON.stringify({amount:m.amount,value:m.value,reason}));
    return after;
  }

  adminGift(id,m,adminId='admin') {
    const p=this.player(id); if(!p) throw Error('Player not found');
    const reason=s(m.reason||'Admin gift').trim().slice(0,500); if(!reason) throw Error('Reason is required');
    this.addMail(id,{sender:'Territory Administration',subject:s(m.subject||'Подарок от администрации').slice(0,120),body:s(m.body||reason).slice(0,2000),coins:Math.max(0,n(m.coins)),gems:Math.max(0,n(m.gems)),weapon_id:s(m.weapon_id||'').slice(0,80)});
    this.audit(adminId,id,'send_gift',{},m,reason); this.event(id,'Mail','admin_gift',JSON.stringify({coins:m.coins,gems:m.gems,weapon_id:m.weapon_id,reason}));
  }

  adminPlayers(q='',limit=50,offset=0){
    this.init();const x='%'+s(q).slice(0,80)+'%';
    const lim=Math.max(1,Math.min(100,n(limit,50))), off=Math.max(0,n(offset));
    const rows=this.sql.exec(`SELECT telegram_id AS id,username,first_name,last_name,level,coins,gems,banned,ban_reason,updated_at,created_at FROM players WHERE username LIKE ? OR first_name LIKE ? OR telegram_id LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`,x,x,x,lim,off).toArray();
    const total=this.sql.exec(`SELECT COUNT(*) total FROM players WHERE username LIKE ? OR first_name LIKE ? OR telegram_id LIKE ?`,x,x,x).toArray()[0]?.total||0;
    return {rows,total,limit:lim,offset:off};
  }

  ban(id,b,reason,adminId='admin'){
    this.init(); const p=this.player(id); if(!p) throw Error('Player not found');
    const before={banned:p.banned,ban_reason:p.ban_reason}; const rr=s(reason||(b?'Admin ban':'Unbanned')).slice(0,250);
    this.sql.exec(`UPDATE players SET banned=?,ban_reason=?,updated_at=? WHERE telegram_id=?`,b?1:0,rr,now(),id);
    const after=this.player(id); this.audit(adminId,id,b?'ban':'unban',before,after,rr); this.event(id,'Admin',b?'ban':'unban',rr);
  }

  gift(id,m,adminId='admin'){this.adminGift(id,m,adminId);}

  broadcastPreview(audience='all',minLevel=1){
    this.init(); const ml=Math.max(1,n(minLevel,1)); let q='SELECT COUNT(*) total FROM players WHERE 1=1',args=[];
    if(audience==='active'){q+=' AND updated_at>=?';args.push(now()-30*86400)}
    if(audience==='level'){q+=' AND level>=?';args.push(ml)}
    return this.sql.exec(q,...args).toArray()[0]||{total:0};
  }

  broadcastMail(m,adminId='admin'){
    this.init();
    const audience=['all','active','level'].includes(s(m.audience))?s(m.audience):'all';
    const minLevel=Math.max(1,n(m.min_level,1));
    const subject=s(m.subject).trim().slice(0,120), body=s(m.body).trim().slice(0,2000), reason=s(m.reason).trim().slice(0,500);
    const coins=Math.max(0,n(m.coins)), gems=Math.max(0,n(m.gems)), weapon_id=s(m.weapon_id||'').trim().slice(0,80);
    if(!subject||!body||!reason)throw Error('Subject, body and reason are required');
    if(!coins&&!gems&&!weapon_id)throw Error('At least one reward is required');
    if(coins>1000000000||gems>1000000000)throw Error('Reward is too large');
    if(weapon_id && !this.sql.exec('SELECT 1 FROM shop_catalog WHERE item_id=? AND active=1',weapon_id).toArray().length)throw Error('Invalid weapon/item');
    const broadcast_id=crypto.randomUUID();
    let where='1=1',args=[]; if(audience==='active'){where+=' AND updated_at>=?';args.push(now()-30*86400)} if(audience==='level'){where+=' AND level>=?';args.push(minLevel)}
    const players=this.sql.exec(`SELECT telegram_id FROM players WHERE ${where} AND banned=0`,...args).toArray();
    const t=now();
    try{
      for(const p of players){this.sql.exec(`INSERT INTO player_mail(telegram_id,sender,subject,body,coins,gems,weapon_id,claimed,created_at) VALUES(?,?,?,?,?,?,?,0,?)`,p.telegram_id,'Territory Administration',subject,body,coins,gems,weapon_id,t); this.event(p.telegram_id,'Mail','broadcast',JSON.stringify({broadcast_id,coins,gems,weapon_id,subject}));}
      this.sql.exec(`INSERT INTO mail_broadcasts(broadcast_id,admin_id,audience,min_level,subject,body,coins,gems,weapon_id,reason,recipient_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,broadcast_id,s(adminId||'admin'),audience,minLevel,subject,body,coins,gems,weapon_id,reason,players.length,t);
      this.audit(adminId,'','mass_mail',{}, {broadcast_id,recipient_count:players.length,coins,gems,weapon_id,subject,audience,min_level:minLevel},reason);
      this.sql.exec('COMMIT');
    }catch(e){throw e}
    return {ok:true,broadcast_id,sent:players.length};
  }

  broadcasts(){this.init();return this.sql.exec(`SELECT broadcast_id,created_at,subject,recipient_count,coins,gems,weapon_id,reason,audience,min_level FROM mail_broadcasts ORDER BY created_at DESC LIMIT 100`).toArray();}

  finance(){
    this.init();const since=now()-86400;
    const daily=this.sql.exec(`SELECT COALESCE(SUM(amount),0) total FROM finance
      WHERE created_at>=? AND amount>0`,since).toArray()[0]?.total||0;
    const donors=this.sql.exec(`SELECT telegram_id id,SUM(amount) total,COUNT(*) payments
      FROM finance WHERE amount>0 GROUP BY telegram_id ORDER BY total DESC LIMIT 20`).toArray();
    const paymentCount=this.sql.exec(`SELECT COUNT(*) total FROM finance WHERE created_at>=? AND amount>0`,since).toArray()[0]?.total||0;
    return {dailyIncome:daily,paymentCount,topDonors:donors};
  }

  prices(){this.init();return this.sql.exec(`SELECT item_id,name,icon,
    price_coins price,damage,active FROM shop_catalog ORDER BY id`).toArray();}

  setPrice(id,price,reason='Price change',adminId='admin'){
    this.init(); const w=this.sql.exec(`SELECT * FROM shop_catalog WHERE item_id=?`,id).toArray()[0]; if(!w) throw Error('Item not found');
    const next=clamp(price,0,100000000); this.sql.exec(`UPDATE shop_catalog SET price_coins=?,updated_at=? WHERE item_id=?`,next,now(),id);
    this.audit(adminId,'','shop_price_change',{item_id:id,price:w.price_coins},{item_id:id,price:next},s(reason).slice(0,500));
  }

  antiList(){
    this.init();return this.sql.exec(`SELECT a.telegram_id id,a.strikes,
      a.last_action_ms,a.banned,p.username,p.first_name
      FROM anti_cheat a LEFT JOIN players p ON p.telegram_id=a.telegram_id
      ORDER BY a.strikes DESC,a.updated_at DESC LIMIT 200`).toArray();
  }

  recordFinance(id,kind,amount){
    this.init();this.sql.exec(`INSERT INTO finance(telegram_id,kind,amount,created_at)
      VALUES(?,?,?,?)`,id,s(kind).slice(0,50),n(amount),now());
  }

  arenaReward(id,coins,xp,roomId,result){
    this.init(); const p=this.sql.exec(`SELECT coins,exp,level FROM players WHERE telegram_id=?`,id).toArray()[0];
    if(!p) throw Error("Player not found");
    const room=s(roomId).slice(0,160); if(!room) throw Error("Arena room id is required");
    const c=Math.max(0,n(coins)), e=Math.max(0,n(xp));
    const claim=this.sql.exec(`INSERT OR IGNORE INTO arena_reward_claims(room_id,telegram_id,coins,xp,created_at) VALUES(?,?,?,?,?)`,room,id,c,e,now());
    if(!claim.meta?.changes) return this.player(id);
    let level=Math.max(1,n(p.level,1)), exp=Math.max(0,n(p.exp))+e;
    while(exp>=level*100){exp-=level*100;level++;}
    this.sql.exec(`UPDATE players SET coins=coins+?,exp=?,level=?,updated_at=? WHERE telegram_id=?`,c,exp,level,now(),id);
    const st=this.gameState(id)||{};st.arena=st.arena&&typeof st.arena==='object'?st.arena:{rating:1000,wins:0,losses:0,battles:0};st.arena.battles=Math.max(0,Number(st.arena.battles)||0)+1;if(String(result)==="Победа"){st.arena.wins=Math.max(0,Number(st.arena.wins)||0)+1;st.arena.rating=Math.max(0,(Number(st.arena.rating)||1000)+25);}else if(String(result)==="Поражение"){st.arena.losses=Math.max(0,Number(st.arena.losses)||0)+1;st.arena.rating=Math.max(0,(Number(st.arena.rating)||1000)-20);}this.saveGameState(id,st,true);
    this.recordFinance(id,"arena_reward",c);
    return this.player(id);
  }

  async fetch(request){
    const u=new URL(request.url);
    try{
      if(u.pathname==="/db/test-admin-query"){
        try {
          this.init();
          const q = "%";
          const lim = 50, off = 0;
          const sql = `SELECT telegram_id AS id,username,first_name,last_name,level,coins,gems,banned,ban_reason,updated_at,created_at FROM players WHERE username LIKE ? OR first_name LIKE ? OR telegram_id LIKE ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
          const rows = this.sql.exec(sql,q,q,q,lim,off).toArray();
          let safeRows = [];
          try { safeRows = JSON.parse(JSON.stringify(rows, (k,v)=>typeof v === "bigint" ? Number(v) : v)); } catch(e) {}
          const totalRow = this.sql.exec(`SELECT COUNT(*) total FROM players WHERE username LIKE ? OR first_name LIKE ? OR telegram_id LIKE ?`,q,q,q).toArray()[0] || {};
          const total = Number(totalRow.total ?? 0);
          return json({ok:true,diagnostic:"admin-query",rows_count:rows.length,total,rows:safeRows});
        } catch(e) {
          return json({ok:false,diagnostic:"admin-query",error:String(e?.message||e),stack:String(e?.stack||"")},500);
        }
      }
      if(u.pathname==="/db/test-simple"){
        try {
          this.init();
          const info=this.sql.exec("PRAGMA table_info(players)").toArray();
          const names=info.map(x=>String(x.name));
          const required=["telegram_id","username","first_name","last_name","level","coins","gems","banned","ban_reason","updated_at","created_at"];
          const missing=required.filter(k=>!names.includes(k));
          let count=null, countError="";
          try { count=Number(this.sql.exec("SELECT COUNT(*) AS total FROM players").toArray()[0]?.total ?? 0); } catch(e) { countError=String(e?.message||e); }
          let selectOk=false, selectError="", sampleCount=0;
          if(!countError){
            try {
              const rows=this.sql.exec("SELECT telegram_id,username,first_name,last_name,level,coins,gems,banned,ban_reason,updated_at,created_at FROM players ORDER BY updated_at DESC LIMIT 50").toArray();
              sampleCount=rows.length;
              selectOk=true;
            } catch(e) { selectError=String(e?.message||e); }
          }
          return json({ok:!missing.length&&!countError&&selectOk,diagnostic:"players-query-simple",columns:names,missing,count,count_error:countError,select_ok:selectOk,select_error:selectError,sample_count:sampleCount});
        } catch(e) {
          return json({ok:false,diagnostic:"players-query-simple",error:String(e?.message||e),stage:"init-or-schema"},500);
        }
      }
      if(u.pathname==="/db/health"){
        this.init();
        const tables=this.sql.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").toArray();
        return json({ok:true,tables,sqlite:true,ready:this.ready});
      }
      this.init();
      const b=()=>bodyJSON(request);
      if(u.pathname==="/db/upsert"){const x=await b();return json(this.upsert(x.user));}
      if(u.pathname==="/db/player"){return json(this.playerPayload(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/progress"){const x=await b();return json(this.progress(x.id,x.patch||{}));}
      if(u.pathname==="/db/state" && request.method==="GET"){return json(this.gameState(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/state" && request.method==="POST"){const x=await b();return json(this.saveGameState(x.id,x.state||{}));}
      if(u.pathname==="/db/economy"){return json(this.economySnapshot(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/pve/start" && request.method==="POST"){const x=await b();return json(this.pveStart(x.id,x.chapter,x.stage,!!x.boss));}
      if(u.pathname==="/db/pve/action" && request.method==="POST"){const x=await b();return json(this.pveAction(x.id,x.session_id,x.nonce,x.action));}
      if(u.pathname==="/db/pve/complete" && request.method==="POST"){const x=await b();return json(this.pveComplete(x.id,x.session_id));}
      if(u.pathname==="/db/shop"){return json(this.catalog());}
      if(u.pathname==="/db/consumable/buy" && request.method==="POST"){const x=await b();return json(this.buyConsumable(x.id,x.item_id));}
      if(u.pathname==="/db/reward/claim" && request.method==="POST"){const x=await bodyJSON(request);return json(this.rewardClaim(x.id,x.kind,x.item_id));}
      if(u.pathname==="/db/world/claim" && request.method==="POST"){const x=await bodyJSON(request);return json(this.worldClaim(x.id,x.kind,x.data||{}));}
      if(u.pathname==="/db/forge/upgrade" && request.method==="POST"){const x=await b();return json(this.forgeUpgrade(x.id,x.item_id));}
      if(u.pathname==="/db/forge/salvage" && request.method==="POST"){const x=await b();return json(this.forgeSalvage(x.id,x.item_id));}
      if(u.pathname==="/db/buy"){const x=await b();return json(this.buy(x.id,x.item_id));}
      if(u.pathname==="/db/mail"){return json(this.mail(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/mail/claim"){const x=await b();return json(this.claimMail(x.id,x.mail_id));}
      if(u.pathname==="/db/mail/add"){const x=await b();this.addMail(x.id,x);return json({ok:true});}
      if(u.pathname==="/db/top"){return json(this.top100());}
      if(u.pathname==="/db/profile"){return json(this.profile(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/score"){const x=await b();this.score(x.id,x.delta);return json({ok:true});}
      if(u.pathname==="/db/tournament"){const x=await b();return json(this.tournament(x.day));}
      if(u.pathname==="/db/anticheat/action"){const x=await b();this.antiAction(x.id);return json({ok:true});}
      if(u.pathname==="/db/arena-reward"){const x=await b();return json({ok:true,player:this.arenaReward(x.id,x.coins,x.xp,x.room_id,x.result)});}
      if(u.pathname==="/db/players"){return json(this.adminPlayers(u.searchParams.get("q")||"",u.searchParams.get("limit")||50,u.searchParams.get("offset")||0));}
      if(u.pathname==="/db/player-detail"){return json(this.playerDetail(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/player-history"){return json(this.playerHistory(u.searchParams.get("id")||"",u.searchParams.get("category")||""));}
      if(u.pathname==="/db/ban"){const x=await b();this.ban(x.id,x.banned,x.reason,x.admin_id||'admin');return json({ok:true});}
      if(u.pathname==="/db/gift"){const x=await b();this.gift(x.id,x,x.admin_id||'admin');return json({ok:true});}
      if(u.pathname==="/db/adjust"){const x=await b();return json({ok:true,player:this.adminAdjust(x.id,x)});}
      if(u.pathname==="/db/finance"){return json(this.finance());}
      if(u.pathname==="/db/prices"){return json(this.prices());}
      if(u.pathname==="/db/price"){const x=await b();this.setPrice(x.item_id,x.price,x.reason||'Shop price change',x.admin_id||'admin');return json({ok:true});}
      if(u.pathname==="/db/logs"){return json(this.sql.exec(`SELECT * FROM admin_audit ORDER BY id DESC LIMIT 300`).toArray());}
      if(u.pathname==="/db/broadcast-preview"){return json(this.broadcastPreview(u.searchParams.get("audience")||"all",u.searchParams.get("min_level")||1));}
      if(u.pathname==="/db/broadcasts"){return json(this.broadcasts());}
      if(u.pathname==="/db/broadcast"){const x=await b();return json(this.broadcastMail(x,x.admin_id||"admin"));}
      if(u.pathname==="/db/anti"){return json(this.antiList());}
      return json({error:"Not found"},404);
    }catch(e){return json({error:e?.message||"Database error"},400);}
  }
}

const TELEGRAM_GAME_LINK = "https://t.me/TeritoryGameBot?startapp";

async function telegramBotApi(env, method, payload={}) {
  const token = s(env.BOT_TOKEN || env.TELEGRAM_BOT_TOKEN);
  if (!token) throw new Error("Telegram bot token is not configured");
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {"content-type":"application/json"},
    body: JSON.stringify(payload)
  });
  const d = await r.json().catch(()=>({ok:false,error_code:r.status,description:"Invalid Telegram response"}));
  if (!r.ok || !d.ok) throw new Error(d.description || `Telegram API HTTP ${r.status}`);
  return d;
}

async function telegramSendGame(env, chatId) {
  return telegramBotApi(env,"sendMessage",{
    chat_id: chatId,
    text: "🏰 Territory — Sdolars\nДобро пожаловать! Открой игру и продолжай свой путь.",
    reply_markup: {
      inline_keyboard: [[{text:"🎮 ИГРАТЬ", url: TELEGRAM_GAME_LINK}]]
    }
  });
}

async function telegramWebhookUpdate(env, update) {
  const message = update?.message;
  const text = s(message?.text).trim();
  const chatId = message?.chat?.id;
  if (!chatId) return {ok:true,ignored:true};
  if (/^\/start(?:@[^ ]+)?(?:\s|$)/i.test(text) || /^\/game(?:@[^ ]+)?(?:\s|$)/i.test(text)) {
    await telegramSendGame(env,chatId);
    return {ok:true,handled:true,command:text};
  }
  return {ok:true,ignored:true};
}

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);

    try{
      if(request.method==="OPTIONS") return new Response(null,{status:204,headers:corsHeaders()});
      if(u.pathname==="/api/health" && request.method==="GET") return json({ok:true,service:"territory-sdolars-server",build:"FIRST-TEST-01"});
      if(u.pathname==="/api/setup-telegram-webhook" && request.method==="GET"){
        const webhook = `${u.origin}/telegram/webhook`;
        const result = await telegramBotApi(env,"setWebhook",{url:webhook,allowed_updates:["message"],drop_pending_updates:false});
        return json({ok:true,webhook,result});
      }

      if(u.pathname==="/api/telegram-webhook-info" && request.method==="GET"){
        const result = await telegramBotApi(env,"getWebhookInfo",{});
        return json({ok:true,result});
      }

      if(u.pathname==="/telegram/webhook" && request.method==="POST"){
        const update = await bodyJSON(request);
        try { await telegramWebhookUpdate(env,update); }
        catch(e) { console.error("Telegram webhook error",e); }
        return json({ok:true});
      }

      // G120 Arena WebSocket: Telegram-authenticated realtime matchmaking/combat.
      if(u.pathname==="/api/arena/ws"){
        if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket") return json({error:"WebSocket upgrade required"},426);
        const initData=u.searchParams.get("initData")||"";
        let auth;
        try { auth=await telegramAuth(initData,env.BOT_TOKEN); }
        catch(e) { return json({error:e.message||"Authentication failed"},401); }
        const hub=env.ARENA_HUB.get(env.ARENA_HUB.idFromName("global"));
        const target=new URL("https://arena-hub.internal/ws");
        target.searchParams.set("telegram_id",String(auth.user.id));
        target.searchParams.set("first_name",String(auth.user.first_name||""));
        target.searchParams.set("last_name",String(auth.user.last_name||""));
        target.searchParams.set("username",String(auth.user.username||""));
        return hub.fetch(new Request(target,{method:"GET",headers:request.headers}));
      }

      if(u.pathname==="/admin/health" && request.method==="GET"){
        return json({ok:true,service:"admin",version:"G112"},200,{"cache-control":"no-store","x-territory-build":"G112"});
      }
      // Admin login is deliberately handled before the Durable Object lookup.
      // This keeps the login page independent from the game database and makes
      // the native HTML form work even when browser JavaScript is unavailable.
      if(u.pathname==="/admin/app.js" && request.method==="GET"){
        return new Response(ADMIN_APP_JS,{status:200,headers:{"content-type":"text/javascript; charset=utf-8","cache-control":"no-store","x-territory-build":"G112"}});
      }

      if(u.pathname==="/admin" && request.method==="GET"){
        const auth=await verifyAdminToken(cookies(request)[ADMIN_COOKIE],env);
        return new Response(adminHTML(auth),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-territory-build":"G112"}});
      }

      if(u.pathname==="/admin/login" && request.method==="POST"){
        const ct=(request.headers.get("content-type")||"").toLowerCase();
        const x=ct.includes("application/json") ? await bodyJSON(request) : await bodyForm(request);
        const role=s(x.role).toLowerCase();
        if(!ADMIN_ROLE_PERMS[role])return json({error:"Unknown role"},400);
        const cfg=adminSecretForRole(env,role);
        if(!cfg.password||!cfg.login)return json({error:"Эта роль пока не настроена в Cloudflare"},503);
        if(!equal(s(x.login),cfg.login)||!equal(s(x.password),cfg.password))return json({error:"Неверный логин или пароль"},401);
        const token=await signedAdminToken(cfg.password,role,cfg.login);
        const cookie=`${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`;
        if(!ct.includes("application/json")){
          return new Response(adminHTML({role,login:cfg.login,label:ADMIN_ROLE_LABELS[role],permissions:ADMIN_ROLE_PERMS[role]}),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","set-cookie":cookie}});
        }
        return json({ok:true,role,label:ADMIN_ROLE_LABELS[role],login:cfg.login,permissions:ADMIN_ROLE_PERMS[role]},200,{"set-cookie":cookie});
      }

      if(u.pathname==="/admin/db-test-admin-query" && request.method==="GET"){
        try{
          const stub=env.DB.get(env.DB.idFromName("global"));
          const r=await dbCall(stub,"/db/test-admin-query");
          const text=await r.text();
          return new Response(text,{status:r.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-territory-build":"G112"}});
        }catch(e){
          return json({ok:false,error:String(e?.message||e),stage:"worker-call"},500,{"cache-control":"no-store","x-territory-build":"G112"});
        }
      }

      if(u.pathname==="/admin/db-test-simple" && request.method==="GET"){
        try{
          const stub=env.DB.get(env.DB.idFromName("global"));
          const r=await dbCall(stub,"/db/test-simple");
          const text=await r.text();
          return new Response(text,{status:r.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-territory-build":"G112"}});
        }catch(e){
          return json({ok:false,error:String(e?.message||e),stage:"worker-call"},500,{"cache-control":"no-store","x-territory-build":"G112"});
        }
      }

      if(u.pathname==="/admin/db-health" && request.method==="GET"){
        // Temporary diagnostic endpoint: intentionally public so the browser can
        // show the exact SQLite/DO initialization error without an admin cookie.
        try{
          const stub=env.DB.get(env.DB.idFromName("global"));
          const result=await dbJSON(stub,"/db/health");
          return json({ok:true,diagnostic:"db-health",...result},200,{"cache-control":"no-store","x-territory-build":"G112"});
        }catch(e){
          return json({ok:false,diagnostic:"db-health",error:e?.message||String(e),stack:e?.stack||""},500,{"cache-control":"no-store","x-territory-build":"G112"});
        }
      }

      const stub=env.DB.get(env.DB.idFromName("global"));


      if(u.pathname==="/admin/api/arena-bots" && (request.method==="GET" || request.method==="POST")){
        const auth=await verifyAdminToken(cookies(request)[ADMIN_COOKIE],env);
        if(!auth || !adminCan(auth,"arena_bots")) return json({error:"Unauthorized"},401);
        const hub=env.ARENA_HUB.get(env.ARENA_HUB.idFromName("global"));
        if(request.method==="GET") return new Response(await (await hub.fetch(new Request("https://arena-hub.internal/admin/config"))).text(),{headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
        const cfg=await bodyJSON(request);
        const r=await hub.fetch(new Request("https://arena-hub.internal/admin/config",{method:"POST",headers:{"content-type":"application/json",...corsHeaders()},body:JSON.stringify(cfg)}));
        return new Response(await r.text(),{status:r.status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
      }

      if(u.pathname.startsWith("/admin/api/")){
        const auth=await verifyAdminToken(cookies(request)[ADMIN_COOKIE],env);
        if(!auth)return json({error:"Unauthorized"},401);

        const requirePerm=(perm)=>{
          if(!adminCan(auth,perm)) throw new Response(
            JSON.stringify({error:"Недостаточно прав"}),
            {status:403,headers:{"content-type":"application/json",...corsHeaders()}}
          );
        };

        if(u.pathname==="/admin/api/players"){
          requirePerm("players");
          return dbJSON(stub,"/db/players?q="+encodeURIComponent(u.searchParams.get("q")||"")+"&limit=50&offset="+(u.searchParams.get("offset")||0));
        }

        if(u.pathname.startsWith("/admin/api/player/") && u.pathname.endsWith("/history")){
          requirePerm("players");
          const id=decodeURIComponent(u.pathname.slice("/admin/api/player/".length,-8));
          return dbJSON(stub,"/db/player-history?id="+encodeURIComponent(id)+"&category="+encodeURIComponent(u.searchParams.get("category")||""));
        }

        if(u.pathname.startsWith("/admin/api/player/")){
          requirePerm("players");
          const id=decodeURIComponent(u.pathname.slice("/admin/api/player/".length));
          return dbJSON(stub,"/db/player-detail?id="+encodeURIComponent(id));
        }

        if(u.pathname==="/admin/api/finance"){
          requirePerm("finance");
          return dbJSON(stub,"/db/finance");
        }

        if(u.pathname==="/admin/api/prices"){
          requirePerm("prices");
          return dbJSON(stub,"/db/prices");
        }

        if(u.pathname==="/admin/api/anticheat"){
          requirePerm("anti");
          return dbJSON(stub,"/db/anti");
        }

        if(u.pathname==="/admin/api/ban"){
          requirePerm("ban");
          const x=await bodyJSON(request); x.admin_id=auth.login;
          return dbJSON(stub,"/db/ban","POST",x);
        }

        if(u.pathname==="/admin/api/gift"){
          requirePerm("gift");
          const x=await bodyJSON(request); x.admin_id=auth.login;
          return dbJSON(stub,"/db/gift","POST",x);
        }

        if(u.pathname==="/admin/api/adjust"){
          requirePerm("adjust");
          const x=await bodyJSON(request); x.admin_id=auth.login;
          return dbJSON(stub,"/db/adjust","POST",x);
        }

        if(u.pathname==="/admin/api/price"){
          requirePerm("prices");
          const x=await bodyJSON(request); x.admin_id=auth.login;
          return dbJSON(stub,"/db/price","POST",x);
        }

        if(u.pathname==="/admin/api/logs"){
          requirePerm("logs");
          return dbJSON(stub,"/db/logs");
        }

        if(u.pathname==="/admin/api/broadcast/preview"){
          requirePerm("broadcast");
          return dbJSON(stub,"/db/broadcast-preview?audience="+encodeURIComponent(u.searchParams.get("audience")||"all")+"&min_level="+encodeURIComponent(u.searchParams.get("min_level")||1));
        }

        if(u.pathname==="/admin/api/broadcasts"){
          requirePerm("broadcast");
          return dbJSON(stub,"/db/broadcasts");
        }

        if(u.pathname==="/admin/api/broadcast" && request.method==="POST"){
          requirePerm("broadcast");
          const x=await bodyJSON(request); x.admin_id=auth.login;
          return dbJSON(stub,"/db/broadcast","POST",x);
        }

        return json({error:"Not found"},404);
      }
      const p=await playerFromTelegram(request,env,stub);
      const id=p.telegram_id;

      if(u.pathname==="/api/player" && request.method==="GET") return json({ok:true,player:await dbJSON(stub,"/db/player?id="+encodeURIComponent(id)),state:await dbJSON(stub,"/db/state?id="+encodeURIComponent(id))});
      if(u.pathname==="/api/economy" && request.method==="GET") return json({ok:true,economy:await dbJSON(stub,"/db/economy?id="+encodeURIComponent(id))});
      if(u.pathname==="/api/state" && request.method==="GET") return json({ok:true,state:await dbJSON(stub,"/db/state?id="+encodeURIComponent(id))});
      if(u.pathname==="/api/state" && request.method==="POST"){const x=await bodyJSON(request);return json({ok:true,state:await dbJSON(stub,"/db/state","POST",{id,state:x.state||{}}),player:await dbJSON(stub,"/db/player?id="+encodeURIComponent(id))});}
      if(u.pathname==="/api/migrate" && request.method==="POST") return json({ok:true,skipped:true,reason:"First live test starts from server-owned fresh state"});
      if(u.pathname==="/api/pve/start" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/pve/start","POST",{id,chapter:x.chapter,stage:x.stage,boss:!!x.boss}));}
      if(u.pathname==="/api/pve/action" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/pve/action","POST",{id,session_id:x.session_id,nonce:x.nonce,action:x.action}));}
      if(u.pathname==="/api/pve/complete" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/pve/complete","POST",{id,session_id:x.session_id}));}
      if(u.pathname==="/api/auth") return json({
        ok:true,player:{
          id,username:p.username,first_name:p.first_name,level:p.level,exp:p.exp,
          hp:p.hp,maxHp:p.max_hp,coins:p.coins,gems:p.gems,redGems:Math.max(0,Number(p.red_gems)||0),vip:Math.max(0,Number(p.vip)||0),weapon:p.weapon
        }
      });

      if(u.pathname==="/api/me")return json({player:p});

      if(u.pathname==="/api/progress" && request.method==="POST"){
        const x=await bodyJSON(request),patch={};
        // Compatibility endpoint: only non-economy/non-XP combat fields are accepted.
        // Level, XP, coins, gems and other server-owned progression cannot be written by the client.
        for(const k of ["hp","max_hp","strength","agility","defense","weapon"])
          if(x[k]!==undefined)patch[k]=x[k];
        return json(await dbJSON(stub,"/db/progress","POST",{id,patch}));
      }

      if(u.pathname==="/api/shop")return json(await dbJSON(stub,"/db/shop"));
      if(u.pathname==="/api/consumable/buy" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/consumable/buy","POST",{id,item_id:x.item_id}));}
      if(u.pathname==="/api/reward/claim" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/reward/claim","POST",{id,kind:x.kind,item_id:x.id}));}
      if(u.pathname==="/api/world/claim" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/world/claim","POST",{id,kind:x.kind,data:x.data||{}}));}
      if(u.pathname==="/api/forge/upgrade" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/forge/upgrade","POST",{id,item_id:x.item_id}));}
      if(u.pathname==="/api/forge/salvage" && request.method==="POST"){const x=await bodyJSON(request);return json(await dbJSON(stub,"/db/forge/salvage","POST",{id,item_id:x.item_id}));}
      if(u.pathname==="/api/shop/buy" && request.method==="POST"){
        const x=await bodyJSON(request);
        return json(await dbJSON(stub,"/db/buy","POST",{id,item_id:x.item_id}));
      }

      if(u.pathname==="/api/mail")return json(await dbJSON(stub,"/db/mail?id="+encodeURIComponent(id)));
      if(u.pathname==="/api/mail/claim" && request.method==="POST"){
        const x=await bodyJSON(request);
        return json(await dbJSON(stub,"/db/mail/claim","POST",{id,mail_id:x.mail_id}));
      }

      if(u.pathname==="/api/arena/top")return json(await dbJSON(stub,"/db/top"));
      if(u.pathname.startsWith("/api/profile/")){
        const target=decodeURIComponent(u.pathname.slice("/api/profile/".length));
        const profile=await dbJSON(stub,"/db/profile?id="+encodeURIComponent(target));
        // profile SQL intentionally has no coins/gems columns.
        return json(profile);
      }

      if(u.pathname==="/api/arena/action" && request.method==="POST"){
        await dbJSON(stub,"/db/anticheat/action","POST",{id});
        return json({ok:true});
      }

      if(u.pathname==="/api/arena/event" && request.method==="POST"){
        // Legacy client score submission is disabled. The live Arena awards and
        // leaderboard changes must originate from server-validated Arena results.
        return json({error:"Arena score is server-authoritative"},403);
      }

      return json({error:"Not found"},404);
    }catch(e){
      if(e instanceof Response)return e;
      return json({error:e?.message||"Server error"},400);
    }
  },

  async scheduled(event,env,ctx){
    const stub=env.DB.get(env.DB.idFromName("global"));
    // Runs at 03:00 UTC with cron "0 3 * * *".
    const previous=day(Date.now()-86400000);
    ctx.waitUntil(dbJSON(stub,"/db/tournament","POST",{day:previous}));
  }
};

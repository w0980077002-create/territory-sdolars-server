import { DurableObject } from "cloudflare:workers";

/**
 * Territory G91 — Cloudflare Worker + Durable Object SQLite backend
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

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  }
});

const page = (body, status = 200) => new Response(body, {
  status,
  headers: {"content-type":"text/html; charset=utf-8","cache-control":"no-store"}
});

const now = () => Math.floor(Date.now() / 1000);
const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0,10);
const n = (v, d=0) => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d;
const clamp = (v,a,b) => Math.max(a, Math.min(b, n(v)));
const s = v => String(v ?? "");

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
  owner: ["players","finance","prices","anti","logs","broadcast","gift","adjust","ban"],
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
  const initData = request.headers.get("x-telegram-init-data") || "";
  if (!initData) throw new Response(JSON.stringify({error:"Authentication required"}),{
    status:401,headers:{"content-type":"application/json"}
  });

  let auth;
  try { auth = await telegramAuth(initData, env.BOT_TOKEN); }
  catch (e) {
    throw new Response(JSON.stringify({error:e.message}),{
      status:401,headers:{"content-type":"application/json"}
    });
  }

  const p = await dbJSON(stub,"/db/upsert","POST",{user:auth.user});
  if (p.banned) throw new Response(JSON.stringify({error:"Account banned"}),{
    status:403,headers:{"content-type":"application/json"}
  });
  return p;
}

function adminHTML(auth=null) {
const authed = !!auth;
return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Territory Admin G91.9</title>
<style>body{margin:0;background:#0a1016;color:#edf4f7;font-family:system-ui,-apple-system,sans-serif}header{padding:15px;background:#111b24;position:sticky;top:0;z-index:3;border-bottom:1px solid #263642}main{max-width:1180px;margin:auto;padding:14px}.tabs{display:flex;gap:7px;overflow:auto;margin-bottom:12px}button,input,select,textarea{font:inherit}button{padding:9px 12px;border:1px solid #3b4d59;border-radius:9px;background:#182630;color:#fff;cursor:pointer}button:hover{background:#243640}.danger{background:#632522}.good{background:#24502e}.muted{color:#91a2ab;font-size:12px}.panel{display:none}.panel.active{display:block}.card{background:#111b23;border:1px solid #273742;border-radius:12px;padding:13px;margin:9px 0}.row{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:9px}input,select,textarea{box-sizing:border-box;width:100%;padding:9px;background:#0d151c;border:1px solid #394b56;border-radius:8px;color:#fff}table{width:100%;border-collapse:collapse}td,th{padding:8px;border-bottom:1px solid #26343d;text-align:left;font-size:13px;vertical-align:top}.click{cursor:pointer}.click:hover{background:#17242c}.pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#24343e;font-size:11px}.modal{position:fixed;inset:0;background:#000b;display:none;align-items:flex-start;justify-content:center;padding:20px;overflow:auto;z-index:10}.modal.show{display:flex}.modalbox{width:min(1050px,100%);background:#101a22;border:1px solid #334752;border-radius:14px;padding:14px}.actions button{margin:3px}.history{max-height:380px;overflow:auto}.kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px}.kv div{background:#0c141a;padding:8px;border-radius:8px}.small{font-size:12px}.dangerText{color:#ff8f86}</style></head><body>
<header><b>⚔️ Territory · G91.9 Admin</b><span id="status" class="muted">${authed ? ` · ${auth.label}: ${auth.login}` : ""}</span></header><main>
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
<button data-perm="players" onclick="tab('players')">Игроки</button>
<button data-perm="finance" onclick="tab('finance')">Финансы</button>
<button data-perm="prices" onclick="tab('prices')">Магазин</button>
<button data-perm="anti" onclick="tab('anti')">Античит</button>
<button data-perm="logs" onclick="tab('logs')">Логи</button>
<button data-perm="broadcast" onclick="tab('broadcast')">🎁 Всем</button>
</div>
<section id="players" class="panel active"><div class="card"><div class="row"><div style="flex:1;min-width:220px"><input id="q" placeholder="Telegram ID / username / имя" onkeydown="if(event.key==='Enter')loadPlayers()"></div><button onclick="loadPlayers()">Поиск</button><button onclick="openById()">Открыть ID</button></div></div><div id="pb"></div></section>
<section id="finance" class="panel"><div id="fb"></div></section><section id="broadcast" class="panel"><div class="card"><h2>🎁 Массовый подарок</h2><p class="muted">Отправляет подарок через игровую почту. Баланс игроков напрямую не изменяется.</p><div class="grid"><div><label>Кому</label><select id="bcAudience"><option value="all">Всем игрокам</option><option value="active">Активным игрокам (30 дней)</option><option value="level">По уровню</option></select></div><div id="bcLevelBox" style="display:none"><label>Минимальный уровень</label><input id="bcMinLevel" type="number" min="1" value="1"></div><div><label>Тема</label><input id="bcSubject" value="🎉 Подарок от Territory"></div><div><label>Монеты</label><input id="bcCoins" type="number" min="0" value="1000"></div><div><label>Кристаллы</label><input id="bcGems" type="number" min="0" value="0"></div><div><label>ID оружия/предмета (необязательно)</label><input id="bcWeapon" placeholder="например weapon_01"></div></div><br><label>Текст письма</label><textarea id="bcBody" rows="5">🎉 Поздравляем с праздником! Это подарок от команды Territory.</textarea><br><br><label>Причина/название рассылки</label><input id="bcReason" value="Праздничная рассылка"><br><br><button class="good" onclick="sendBroadcast()">📨 Отправить подарок</button><div id="bcResult" class="muted"></div></div><div id="bchistory"></div></section><section id="prices" class="panel"><div id="prb"></div></section><section id="anti" class="panel"><div id="ab"></div></section><section id="logs" class="panel"><div id="lb"></div></section></div></main>
<div id="modal" class="modal"><div class="modalbox"><div class="row"><h2 id="mt" style="flex:1">Игрок</h2><button onclick="closeModal()">Закрыть</button></div><div id="mb"></div></div></div>
<script>
const $=x=>document.getElementById(x);const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(u,o={}){let r=await fetch(u,{...o,headers:{'content-type':'application/json',...(o.headers||{})}});let d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||r.statusText);return d}
window.adminLogin=async function(role,event){
  if(event) event.preventDefault();
  try{
    const loginValue=role==='owner'?$('ownerLogin').value.trim():$('modLogin').value.trim();
    const password=role==='owner'?$('ownerPw').value:$('modPw').value;
    const d=await api('/admin/login',{method:'POST',body:JSON.stringify({role,login:loginValue,password})});
    document.querySelectorAll('[data-perm]').forEach(el=>el.style.display=d.permissions.includes(el.dataset.perm)?'':'none');
    $('login').style.display='none';$('app').style.display='block';
    $('status').textContent=' · '+d.label+': '+d.login;
    loadPlayers();
  }catch(e){$('msg').textContent=' '+e.message}
}
function tab(id){
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  const panel=$(id);
  if(!panel)return;
  panel.classList.add('active');
  const loaders={players:loadPlayers,finance:loadFinance,prices:loadPrices,anti:loadAnti,logs:loadLogs,broadcast:loadBroadcast};
  const fn=loaders[id];
  if(typeof fn!=='function')return;
  const box=panel.querySelector('[id$=b]');
  if(box && id!=='players' && id!=='broadcast') box.innerHTML='<div class="card muted">Загрузка…</div>';
  Promise.resolve(fn()).catch(e=>{if(box)box.innerHTML='<div class="card dangerText">Ошибка загрузки: '+esc(e?.message||e)+'</div>';});
}
function openById(){const id=$('q').value.trim();if(id)openPlayer(id)}
async function loadPlayers(offset=0){try{const d=await api('/admin/api/players?q='+encodeURIComponent($('q').value.replace(/^@/,'')+'&offset='+offset);let h='<div class="card"><span class="muted">Найдено: '+d.total+'</span></div><div class="card"><table><tr><th>Telegram ID</th><th>Игрок</th><th>Ур.</th><th>Монеты</th><th>Кристаллы</th><th>Статус</th><th></th></tr>';for(const p of d.rows){h+='<tr class="click" onclick="openPlayer(\''+esc(p.id)+'\')"><td>'+esc(p.id)+'</td><td>'+esc(p.first_name||p.username||'')+'<br><span class="muted">@'+esc(p.username)+'</span></td><td>'+p.level+'</td><td>'+p.coins+'</td><td>'+p.gems+'</td><td>'+(p.banned?'<span class="pill dangerText">BAN</span>':'<span class="pill">OK</span>')+'</td><td><button onclick="event.stopPropagation();openPlayer(\''+esc(p.id)+'\')">Открыть</button></td></tr>'}h+='</table></div>';h+='<div class="row">';if(d.offset>0)h+='<button onclick="loadPlayers('+Math.max(0,d.offset-d.limit)+')">← Назад</button>';if(d.offset+d.limit<d.total)h+='<button onclick="loadPlayers('+(d.offset+d.limit)+')">Далее →</button>';h+='</div>';$('pb').innerHTML=h}catch(e){$('pb').innerHTML='<div class="card dangerText">'+esc(e.message)+'</div>'}}
async function openPlayer(id){try{const d=await api('/admin/api/player/'+encodeURIComponent(id));if(!d){alert('Игрок не найден');return}$('mt').textContent='Игрок '+id;renderPlayer(d);$('modal').classList.add('show')}catch(e){alert(e.message)}}
function renderPlayer(d){const p=d.player;let h='<div class="grid"><div class="card"><h3>Профиль</h3><div class="kv"><div>ID<br><b>'+esc(p.telegram_id)+'</b></div><div>Имя<br><b>'+esc(p.first_name)+' '+esc(p.last_name)+'</b></div><div>Username<br><b>@'+esc(p.username)+'</b></div><div>Уровень<br><b>'+p.level+'</b></div><div>XP<br><b>'+p.exp+'</b></div><div>Статус<br><b>'+(p.banned?'BAN':'Активен')+'</b></div><div>Монеты<br><b>'+p.coins+'</b></div><div>Кристаллы<br><b>'+p.gems+'</b></div></div></div><div class="card"><h3>Управление</h3><div class="actions"><button onclick="adjust(&quot;coins&quot;)">Монеты ±</button><button onclick="adjust(&quot;gems&quot;)">Кристаллы ±</button><button onclick="adjust(&quot;exp&quot;)">XP ±</button><button onclick="adjust(&quot;level&quot;)">Уровень</button><button onclick="adjust(&quot;hp&quot;)">HP ±</button><button onclick="giftPlayer()">Подарок в почту</button><button class="'+(p.banned?'good':'danger')+'" onclick="toggleBan('+(p.banned?0:1)+')">'+(p.banned?'Разбан':'Бан')+'</button></div></div></div>';
h+='<div class="card"><h3>Инвентарь</h3><table><tr><th>Предмет</th><th>Количество</th></tr>'+(d.inventory.length?d.inventory.map(x=>'<tr><td>'+esc(x.icon)+' '+esc(x.name)+'</td><td>'+x.quantity+'</td></tr>').join(''):'<tr><td colspan="2" class="muted">Пусто</td></tr>')+'</table></div>';
h+='<div class="card"><h3>История действий</h3><div class="row"><select id="hf" onchange="historyFilter()"><option value="">Все</option><option>Admin</option><option>Shop</option><option>Mail</option><option>Arena</option><option>Anti-cheat</option><option>Auth</option><option>Tournament</option></select></div><div id="hist" class="history"></div></div>';
h+='<div class="card"><h3>Экономика</h3><table><tr><th>Валюта</th><th>Изменение</th><th>До</th><th>После</th><th>Причина</th></tr>'+d.ledger.map(x=>'<tr><td>'+esc(x.currency)+'</td><td>'+x.amount+'</td><td>'+x.balance_before+'</td><td>'+x.balance_after+'</td><td>'+esc(x.reason)+'</td></tr>').join('')+'</table></div>';
h+='<div class="card"><h3>Почта</h3><table><tr><th>Письмо</th><th>Вложения</th><th>Статус</th></tr>'+d.mail.map(x=>'<tr><td>'+esc(x.subject)+'</td><td>🪙 '+x.coins+' 💎 '+x.gems+' '+esc(x.weapon_id)+'</td><td>'+(x.claimed?'Получено':'Ожидает')+'</td></tr>').join('')+'</table></div>';$('mb').innerHTML=h;historyFilter()}
async function historyFilter(){const id=$('mt').textContent.replace('Игрок ','').trim();const d=await api('/admin/api/player/'+encodeURIComponent(id)+'/history?category='+encodeURIComponent($('hf').value));$('hist').innerHTML='<table><tr><th>Время</th><th>Категория</th><th>Действие</th><th>Детали</th></tr>'+d.map(x=>'<tr><td>'+new Date(x.created_at*1000).toLocaleString()+'</td><td>'+esc(x.category)+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.details)+'</td></tr>').join('')+'</table>'}
async function adjust(action){const amount=prompt(action==='level'?'Новый уровень':'Изменение количества','0');if(amount===null)return;const reason=prompt('Причина (обязательно)','Коррекция администратора');if(!reason)return;await api('/admin/api/adjust',{method:'POST',body:JSON.stringify({id:$('mt').textContent.replace('Игрок ','').trim(),action,amount,reason})});await openPlayer($('mt').textContent.replace('Игрок ','').trim())}
async function giftPlayer(){const id=$('mt').textContent.replace('Игрок ','').trim();const coins=prompt('Монеты','0');if(coins===null)return;const gems=prompt('Кристаллы','0');if(gems===null)return;const weapon_id=prompt('ID оружия (необязательно)','')||'';const reason=prompt('Причина','Подарок от администрации');if(!reason)return;await api('/admin/api/gift',{method:'POST',body:JSON.stringify({id,coins,gems,weapon_id,reason,subject:'Подарок от администрации',body:reason})});alert('Письмо отправлено');openPlayer(id)}
async function toggleBan(b){const id=$('mt').textContent.replace('Игрок ','').trim();const reason=prompt('Причина',b?'Нарушение правил':'Снятие блокировки');if(!reason)return;await api('/admin/api/ban',{method:'POST',body:JSON.stringify({id,banned:b,reason})});openPlayer(id);loadPlayers()}
function closeModal(){$('modal').classList.remove('show')}
function loadBroadcast(){
  $('bcAudience').onchange=()=>{ $('bcLevelBox').style.display=$('bcAudience').value==='level'?'block':'none'; };
  loadBroadcastHistory();
}
async function sendBroadcast(){
  const audience=$('bcAudience').value, minLevel=Math.max(1,Number($('bcMinLevel').value||1));
  const coins=Math.max(0,Number($('bcCoins').value||0)), gems=Math.max(0,Number($('bcGems').value||0));
  const subject=$('bcSubject').value.trim(), body=$('bcBody').value.trim(), reason=$('bcReason').value.trim(), weapon_id=$('bcWeapon').value.trim();
  if(!subject||!body||!reason){alert('Тема, текст и причина обязательны');return}
  const preview=await api('/admin/api/broadcast/preview?audience='+encodeURIComponent(audience)+'&min_level='+minLevel);
  const total=preview.total||0;
  if(!confirm('Получателей: '+total+'\n\nНаграда каждому: '+coins+' монет + '+gems+' кристаллов'+(weapon_id?' + '+weapon_id:'')+'\n\nОтправить сейчас?'))return;
  try{const d=await api('/admin/api/broadcast',{method:'POST',body:JSON.stringify({audience,min_level:minLevel,coins,gems,weapon_id,subject,body,reason})});$('bcResult').textContent='Готово: отправлено '+d.sent+' игрокам. ID рассылки: '+d.broadcast_id;loadBroadcastHistory()}catch(e){alert(e.message)}
}
async function loadBroadcastHistory(){try{const d=await api('/admin/api/broadcasts');$('bchistory').innerHTML='<div class="card"><h3>История массовых рассылок</h3><table><tr><th>Дата</th><th>Название</th><th>Получателей</th><th>Награда</th><th>Причина</th></tr>'+d.map(x=>'<tr><td>'+new Date(x.created_at*1000).toLocaleString()+'</td><td>'+esc(x.subject)+'</td><td>'+x.recipient_count+'</td><td>🪙 '+x.coins+' 💎 '+x.gems+(x.weapon_id?' 🎁 '+esc(x.weapon_id):'')+'</td><td>'+esc(x.reason)+'</td></tr>').join('')+'</table></div>'}catch(e){$('bchistory').innerHTML='<div class="card dangerText">'+esc(e.message)+'</div>'}}
async function loadFinance(){try{const d=await api('/admin/api/finance');$('fb').innerHTML='<div class="grid"><div class="card">Доход за 24ч: <b>'+d.dailyIncome+'</b></div><div class="card">Подтверждённые платежи: <b>'+d.paymentCount+'</b></div></div><div class="card"><h3>Топ донатеров</h3><table><tr><th>ID</th><th>Сумма</th><th>Платежей</th></tr>'+d.topDonors.map(x=>'<tr><td>'+esc(x.id)+'</td><td>'+x.total+'</td><td>'+x.payments+'</td></tr>').join('')+'</table></div>'}
async function loadPrices(){try{const d=await api('/admin/api/prices');$('prb').innerHTML='<div class="card"><table><tr><th>Оружие</th><th>Цена</th><th>Урон</th><th></th></tr>'+d.map(x=>'<tr><td>'+esc(x.icon)+' '+esc(x.name)+'</td><td><input id="p_'+esc(x.item_id)+'" value="'+x.price+'"></td><td>'+x.damage+'</td><td><button onclick="price(\''+esc(x.item_id)+'\')">Сохранить</button></td></tr>').join('')+'</table></div>'}
async function price(id){const reason=prompt('Причина изменения цены','Коррекция магазина');if(!reason)return;await api('/admin/api/price',{method:'POST',body:JSON.stringify({item_id:id,price:$('p_'+id).value,reason})});loadPrices()}
async function loadAnti(){try{const d=await api('/admin/api/anticheat');$('ab').innerHTML='<div class="card"><table><tr><th>ID</th><th>Игрок</th><th>Нарушения</th><th>Последнее</th><th>Статус</th></tr>'+d.map(x=>'<tr><td>'+esc(x.id)+'</td><td>'+esc(x.first_name||x.username||'')+'</td><td>'+x.strikes+'</td><td>'+x.last_action_ms+'</td><td>'+(x.banned?'BAN':'OK')+'</td></tr>').join('')+'</table></div>'}
async function loadLogs(){try{const d=await api('/admin/api/logs');$('lb').innerHTML='<div class="card"><table><tr><th>Время</th><th>Игрок</th><th>Действие</th><th>Причина</th></tr>'+d.map(x=>'<tr><td>'+new Date(x.created_at*1000).toLocaleString()+'</td><td>'+esc(x.telegram_id)+'</td><td>'+esc(x.action)+'</td><td>'+esc(x.reason)+'</td></tr>').join('')+'</table></div>'}catch(e){$('fb').innerHTML='<div class="card dangerText">Ошибка загрузки: '+esc(e?.message||e)+'</div>';}}catch(e){$('prb').innerHTML='<div class="card dangerText">Ошибка загрузки: '+esc(e?.message||e)+'</div>';}}catch(e){$('ab').innerHTML='<div class="card dangerText">Ошибка загрузки: '+esc(e?.message||e)+'</div>';}}catch(e){$('lb').innerHTML='<div class="card dangerText">Ошибка загрузки: '+esc(e?.message||e)+'</div>';}}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>{if($('app')?.style.display!=='none') loadPlayers();});
}else{
  if($('app')?.style.display!=='none') loadPlayers();
}
</script></body></html>`}


/**
 * Legacy Durable Object compatibility exports.
 * These classes are kept because wrangler.toml preserves the already-deployed
 * GameHub / PresenceHub / RoomHub namespaces and migration history.
 */
export class GameHub extends DurableObject {
  async fetch() { return new Response(JSON.stringify({ok:true,hub:"game",legacy:true}), {headers:{"content-type":"application/json"}}); }
}

export class PresenceHub extends DurableObject {
  async fetch() { return new Response(JSON.stringify({ok:true,hub:"presence",legacy:true}), {headers:{"content-type":"application/json"}}); }
}

export class RoomHub extends DurableObject {
  async fetch() { return new Response(JSON.stringify({ok:true,hub:"room",legacy:true}), {headers:{"content-type":"application/json"}}); }
}

export class TerritoryDB {
  constructor(ctx, env) {
    this.ctx=ctx; this.env=env; this.sql=ctx.storage.sql; this.ready=false;
  }

  init() {
    if (this.ready) return;
    this.sql.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS players(
        telegram_id TEXT PRIMARY KEY, username TEXT DEFAULT '', first_name TEXT DEFAULT '',
        last_name TEXT DEFAULT '', photo_url TEXT DEFAULT '', level INTEGER NOT NULL DEFAULT 1,
        exp INTEGER NOT NULL DEFAULT 0, hp INTEGER NOT NULL DEFAULT 120,
        max_hp INTEGER NOT NULL DEFAULT 120, coins INTEGER NOT NULL DEFAULT 1000,
        gems INTEGER NOT NULL DEFAULT 25, strength INTEGER NOT NULL DEFAULT 5,
        agility INTEGER NOT NULL DEFAULT 5, defense INTEGER NOT NULL DEFAULT 0,
        weapon TEXT DEFAULT 'Кулаки', banned INTEGER NOT NULL DEFAULT 0,
        ban_reason TEXT DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shop_catalog(
        id INTEGER PRIMARY KEY AUTOINCREMENT, item_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '⚔️',
        price_coins INTEGER NOT NULL DEFAULT 0, damage INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
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
        claimed INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS daily_scores(
        day TEXT NOT NULL, telegram_id TEXT NOT NULL, score INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL, PRIMARY KEY(day,telegram_id)
      );
      CREATE TABLE IF NOT EXISTS tournament_awards(
        day TEXT NOT NULL, telegram_id TEXT NOT NULL, place INTEGER NOT NULL,
        gold INTEGER NOT NULL, PRIMARY KEY(day,telegram_id), UNIQUE(day,place)
      );
      CREATE TABLE IF NOT EXISTS finance(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        kind TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS anti_cheat(
        telegram_id TEXT PRIMARY KEY, strikes INTEGER NOT NULL DEFAULT 0,
        last_action_ms INTEGER NOT NULL DEFAULT 0, banned INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS economy_ledger(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL,
        currency TEXT NOT NULL, amount INTEGER NOT NULL, balance_before INTEGER, balance_after INTEGER,
        kind TEXT NOT NULL, reference TEXT DEFAULT '', reason TEXT DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS player_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, category TEXT NOT NULL,
        action TEXT NOT NULL, details TEXT DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mail_broadcasts(
        broadcast_id TEXT PRIMARY KEY, admin_id TEXT NOT NULL DEFAULT 'admin', audience TEXT NOT NULL,
        min_level INTEGER NOT NULL DEFAULT 1, subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
        coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, weapon_id TEXT DEFAULT '',
        reason TEXT NOT NULL DEFAULT '', recipient_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_audit(
        id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id TEXT NOT NULL DEFAULT 'admin',
        telegram_id TEXT DEFAULT '', action TEXT NOT NULL, before_json TEXT DEFAULT '', after_json TEXT DEFAULT '',
        reason TEXT DEFAULT '', created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_player ON player_events(telegram_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ledger_player ON economy_ledger(telegram_id,created_at DESC);
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
    const allowed=["level","exp","hp","max_hp","coins","gems","strength","agility","defense","weapon"];
    const sets=[],args=[];
    for(const k of allowed) if(p[k]!==undefined){
      sets.push(`${k}=?`);
      args.push(k==="weapon"?s(p[k]).slice(0,80):clamp(p[k],0,1000000000));
    }
    if(!sets.length)return this.player(id);
    sets.push("updated_at=?"); args.push(now(),id);
    this.sql.exec(`UPDATE players SET ${sets.join(",")} WHERE telegram_id=?`,...args);
    return this.player(id);
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
    this.sql.exec('BEGIN');
    try{
      for(const p of players){this.sql.exec(`INSERT INTO player_mail(telegram_id,sender,subject,body,coins,gems,weapon_id,claimed,created_at) VALUES(?,?,?,?,?,?,?,0,?)`,p.telegram_id,'Territory Administration',subject,body,coins,gems,weapon_id,t); this.event(p.telegram_id,'Mail','broadcast',JSON.stringify({broadcast_id,coins,gems,weapon_id,subject}));}
      this.sql.exec(`INSERT INTO mail_broadcasts(broadcast_id,admin_id,audience,min_level,subject,body,coins,gems,weapon_id,reason,recipient_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,broadcast_id,s(adminId||'admin'),audience,minLevel,subject,body,coins,gems,weapon_id,reason,players.length,t);
      this.audit(adminId,'','mass_mail',{}, {broadcast_id,recipient_count:players.length,coins,gems,weapon_id,subject,audience,min_level:minLevel},reason);
      this.sql.exec('COMMIT');
    }catch(e){try{this.sql.exec('ROLLBACK')}catch{};throw e}
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

  async fetch(request){
    this.init();
    const u=new URL(request.url);
    try{
      const b=()=>bodyJSON(request);
      if(u.pathname==="/db/upsert"){const x=await b();return json(this.upsert(x.user));}
      if(u.pathname==="/db/player"){return json(this.player(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/progress"){const x=await b();return json(this.progress(x.id,x.patch||{}));}
      if(u.pathname==="/db/shop"){return json(this.catalog());}
      if(u.pathname==="/db/buy"){const x=await b();return json(this.buy(x.id,x.item_id));}
      if(u.pathname==="/db/mail"){return json(this.mail(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/mail/claim"){const x=await b();return json(this.claimMail(x.id,x.mail_id));}
      if(u.pathname==="/db/mail/add"){const x=await b();this.addMail(x.id,x);return json({ok:true});}
      if(u.pathname==="/db/top"){return json(this.top100());}
      if(u.pathname==="/db/profile"){return json(this.profile(u.searchParams.get("id")||""));}
      if(u.pathname==="/db/score"){const x=await b();this.score(x.id,x.delta);return json({ok:true});}
      if(u.pathname==="/db/tournament"){const x=await b();return json(this.tournament(x.day));}
      if(u.pathname==="/db/anticheat/action"){const x=await b();this.antiAction(x.id);return json({ok:true});}
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

export default {
  async fetch(request,env,ctx){
    const u=new URL(request.url);

    try{
      if(u.pathname==="/admin/health" && request.method==="GET"){
        return json({ok:true,service:"admin",version:"G91.9"},200,{"cache-control":"no-store","x-territory-build":"G91.9"});
      }
      // Admin login is deliberately handled before the Durable Object lookup.
      // This keeps the login page independent from the game database and makes
      // the native HTML form work even when browser JavaScript is unavailable.
      if(u.pathname==="/admin" && request.method==="GET"){
        const auth=await verifyAdminToken(cookies(request)[ADMIN_COOKIE],env);
        return new Response(adminHTML(auth),{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-territory-build":"G91.9"}});
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

      const stub=env.DB.get(env.DB.idFromName("global"));

      if(u.pathname.startsWith("/admin/api/")){
        const auth=await verifyAdminToken(cookies(request)[ADMIN_COOKIE],env);
        if(!auth)return json({error:"Unauthorized"},401);

        const requirePerm=(perm)=>{
          if(!adminCan(auth,perm)) throw new Response(
            JSON.stringify({error:"Недостаточно прав"}),
            {status:403,headers:{"content-type":"application/json"}}
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

      if(u.pathname==="/api/auth") return json({
        ok:true,player:{
          id,username:p.username,first_name:p.first_name,level:p.level,exp:p.exp,
          hp:p.hp,maxHp:p.max_hp,coins:p.coins,gems:p.gems,weapon:p.weapon
        }
      });

      if(u.pathname==="/api/me")return json({player:p});

      if(u.pathname==="/api/progress" && request.method==="POST"){
        const x=await bodyJSON(request),patch={};
        for(const k of ["level","exp","hp","max_hp","coins","gems","strength","agility","defense","weapon"])
          if(x[k]!==undefined)patch[k]=x[k];
        // For production, client-supplied currency should be replaced by authoritative
        // game events. This endpoint is kept for progress synchronization.
        return json(await dbJSON(stub,"/db/progress","POST",{id,patch}));
      }

      if(u.pathname==="/api/shop")return json(await dbJSON(stub,"/db/shop"));
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
        // The score is recorded only after the anti-cheat gate.
        await dbJSON(stub,"/db/anticheat/action","POST",{id});
        const x=await bodyJSON(request);
        // Server accepts only a bounded score delta; reward/balance changes are never
        // accepted from this endpoint.
        await dbJSON(stub,"/db/score","POST",{id,delta:clamp(x.score_delta,0,10000)});
        return json({ok:true});
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

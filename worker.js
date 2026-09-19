import { DurableObject } from "cloudflare:workers";

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;
const MAX_STATE_BYTES = 64 * 1024;
const BOT_USERNAME = "TeritoryGameBot";

const DEFAULT_STATE = {
  coins: 1000, gems: 25, energy: 200, combatStone: 0,
  hp: 120, maxHp: 120, level: 1, exp: 0, maxExp: 100,
  weapon: "Кулаки", bonusDamage: 0, strength: 5, agility: 5,
  defense: 0, freePoints: 0, inventory: ["🪓"], alexQuest: 0,
  cityRep: 0, wins: 0, losses: 0, battles: 0
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type": "application/json; charset=UTF-8", "cache-control": "no-store",
    "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type"
  }});
}
function hex(buffer) { return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join(""); }
function timingSafeEqual(a,b) { if(a.length!==b.length)return false; let d=0; for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i); return d===0; }
async function hmacHex(keyBytes,message){
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));
}
async function validateTelegramInitData(initData,botToken){
  if(!botToken||typeof initData!=="string"||!initData)return{ok:false,error:"Telegram auth is not configured"};
  let params; try{params=new URLSearchParams(initData)}catch{return{ok:false,error:"Invalid initData"};}
  const receivedHash=params.get("hash"); if(!receivedHash)return{ok:false,error:"Missing Telegram hash"};
  const authDate=Number(params.get("auth_date")); if(!Number.isFinite(authDate))return{ok:false,error:"Missing auth_date"};
  const age=Math.floor(Date.now()/1000)-authDate;
  if(age<-60||age>MAX_AUTH_AGE_SECONDS)return{ok:false,error:"Telegram auth data is expired"};
  const dataCheckString=[...params.entries()].filter(([k])=>k!=="hash").sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const tokenKey=await crypto.subtle.importKey("raw",new TextEncoder().encode(botToken),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const secretKey=await crypto.subtle.sign("HMAC",tokenKey,new TextEncoder().encode("WebAppData"));
  const calculatedHash=await hmacHex(new Uint8Array(secretKey),dataCheckString);
  if(!timingSafeEqual(calculatedHash,receivedHash.toLowerCase()))return{ok:false,error:"Invalid Telegram signature"};
  let user; try{user=JSON.parse(params.get("user")||"null")}catch{return{ok:false,error:"Invalid Telegram user data"};}
  if(!user||!Number.isSafeInteger(user.id))return{ok:false,error:"Telegram user is missing"};
  return{ok:true,user};
}
function displayName(user){const full=[user.first_name,user.last_name].filter(Boolean).join(" ").trim();return full|| (user.username?`@${user.username}`:"Territory");}
function cloneDefaultState(){return JSON.parse(JSON.stringify(DEFAULT_STATE));}
function normalizeState(input){
  const state=cloneDefaultState(); if(!input||typeof input!=="object")return state;
  const numeric=["coins","gems","energy","combatStone","hp","maxHp","level","exp","maxExp","bonusDamage","strength","agility","defense","freePoints","alexQuest","cityRep","merchantRep","marketDay","wins","losses","battles","gameDice","gameRolls","gameSteps","gameEventVersion","gameTaskProgress","gameGiftDate","gameEndsAt","gameSaveVersion"];
  for(const key of numeric)if(Number.isFinite(Number(input[key])))state[key]=Number(input[key]);
  if(typeof input.weapon==="string"&&input.weapon.length<=80)state.weapon=input.weapon;
  if(Array.isArray(input.inventory))state.inventory=input.inventory.filter(x=>typeof x==="string").slice(0,200);
  for(const key of ["gameMilestones","gameTaskClaims","gamePanelClaims","gameJackpotClaims"])if(Array.isArray(input[key]))state[key]=input[key].slice(0,500);
  if(typeof input.gameGiftDate==="string"&&input.gameGiftDate.length<=32)state.gameGiftDate=input.gameGiftDate;
  return state;
}
async function telegramApi(method,body,botToken){
  const r=await fetch(`https://api.telegram.org/bot${botToken}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  let d;try{d=await r.json()}catch{return{ok:false,error:`Telegram API HTTP ${r.status}`}} return d;
}
async function handleTelegramUpdate(update,env){
  const message=update?.message, text=typeof message?.text==="string"?message.text.trim():"", chatId=message?.chat?.id;
  if(chatId==null||!text)return; const command=text.split(/\s+/)[0].split("@")[0].toLowerCase();
  if(command!=="/start"&&command!=="/game")return;
  await telegramApi("sendMessage",{chat_id:chatId,text:"🏰 Territory — Sdolars\n\nДобро пожаловать! Открой игру и продолжай свой путь.",reply_markup:{inline_keyboard:[[{text:"🎮 ИГРАТЬ",url:`https://t.me/${BOT_USERNAME}?startapp`}]]}},env.TELEGRAM_BOT_TOKEN);
}

export class GameHub extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.ctx.blockConcurrencyWhile(async()=>{this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS player (player_id TEXT PRIMARY KEY,name TEXT NOT NULL,username TEXT,photo_url TEXT,state_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`);});}
  getPlayer(){return this.ctx.storage.sql.exec(`SELECT player_id,name,username,photo_url,state_json,created_at,updated_at FROM player LIMIT 1`).one();}
  savePlayer(p){this.ctx.storage.sql.exec(`INSERT INTO player (player_id,name,username,photo_url,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET name=excluded.name,username=excluded.username,photo_url=excluded.photo_url,state_json=excluded.state_json,updated_at=excluded.updated_at`,p.playerId,p.name,p.username||null,p.photoUrl||null,JSON.stringify(p.state),p.createdAt,p.updatedAt);}
  async fetch(request){
    const url=new URL(request.url); if(request.method==="GET"&&url.pathname==="/health")return json({ok:true,service:"Territory Sdolars Server",version:"1.1.0"});
    if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);
    let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
    const auth=await validateTelegramInitData(body.initData,this.env.TELEGRAM_BOT_TOKEN);if(!auth.ok)return json({ok:false,error:auth.error},401);
    const user=auth.user,playerId=String(user.id),now=Date.now();
    if(url.pathname==="/auth"){
      const existing=this.getPlayer(); if(!existing){const state=cloneDefaultState();this.savePlayer({playerId,name:displayName(user),username:user.username||null,photoUrl:user.photo_url||null,state,createdAt:now,updatedAt:now});return json({ok:true,created:true,user:{id:playerId,name:displayName(user),username:user.username||null,photoUrl:user.photo_url||null},state});}
      return json({ok:true,created:false,user:{id:playerId,name:displayName(user),username:user.username||null,photoUrl:user.photo_url||null},state:JSON.parse(existing.state_json)});
    }
    if(url.pathname==="/save"){
      const state=normalizeState(body.state),stateJson=JSON.stringify(state);if(new TextEncoder().encode(stateJson).byteLength>MAX_STATE_BYTES)return json({ok:false,error:"State is too large"},413);
      const existing=this.getPlayer();this.savePlayer({playerId,name:displayName(user),username:user.username||null,photoUrl:user.photo_url||null,state,createdAt:existing?.created_at||now,updatedAt:now});return json({ok:true,savedAt:now,state});
    }
    return json({ok:false,error:"Not found"},404);
  }
}

function presenceSnapshot(hub){
  return hub.getWebSockets().map(ws=>ws.deserializeAttachment?.()).filter(x=>x&&x.authenticated).map(x=>({id:x.id,name:x.name,username:x.username||null,ready:!!x.ready,lastSeen:x.lastSeen}));
}

export class PresenceHub extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;}
  broadcast(payload,except=null){const message=JSON.stringify(payload);for(const ws of this.ctx.getWebSockets()){if(ws===except)continue;try{ws.send(message)}catch{}}}
  async fetch(request){
    if(request.method!=="GET"||request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return json({ok:false,error:"WebSocket upgrade required"},426);
    const pair=new WebSocketPair(),client=pair[0],server=pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({authenticated:false,id:null,name:null,username:null,ready:false,lastSeen:Date.now()});
    server.send(JSON.stringify({type:"hello",version:"G77",authRequired:true}));
    return new Response(null,{status:101,webSocket:client});
  }
  async authenticate(ws,initData){
    const auth=await validateTelegramInitData(initData,this.env.TELEGRAM_BOT_TOKEN);if(!auth.ok){ws.send(JSON.stringify({type:"auth_error",error:auth.error}));ws.close(1008,"auth failed");return false;}
    const u=auth.user, id=String(u.id); ws.serializeAttachment({authenticated:true,id,name:displayName(u),username:u.username||null,ready:false,lastSeen:Date.now()});
    ws.send(JSON.stringify({type:"authenticated",player:{id,name:displayName(u),username:u.username||null},online:presenceSnapshot(this)}));
    this.broadcast({type:"presence",online:presenceSnapshot(this)},ws); return true;
  }
  async webSocketMessage(ws,message){
    let data;try{data=JSON.parse(typeof message==="string"?message:new TextDecoder().decode(message))}catch{return}
    const meta=ws.deserializeAttachment?.()||{};
    if(!meta.authenticated){if(data.type==="auth"&&typeof data.initData==="string")await this.authenticate(ws,data.initData);else ws.send(JSON.stringify({type:"auth_required"}));return;}
    meta.lastSeen=Date.now();
    if(data.type==="ping"){ws.serializeAttachment(meta);ws.send(JSON.stringify({type:"pong",at:meta.lastSeen}));return;}
    if(data.type==="ready"){meta.ready=!!data.value;ws.serializeAttachment(meta);this.broadcast({type:"presence",online:presenceSnapshot(this)});return;}
    if(data.type==="party_invite"){const target=String(data.targetId||"");if(!target)return;for(const peer of this.ctx.getWebSockets()){const p=peer.deserializeAttachment?.();if(p?.authenticated&&p.id===target){peer.send(JSON.stringify({type:"party_invite",from:{id:meta.id,name:meta.name,username:meta.username||null},partyId:String(data.partyId||"")}));}}return;}
    if(data.type==="chat"){const text=typeof data.text==="string"?data.text.trim().slice(0,500):"";if(!text)return;this.broadcast({type:"chat",from:{id:meta.id,name:meta.name},text,at:Date.now()});}
  }
  async webSocketClose(ws){const meta=ws.deserializeAttachment?.();if(meta?.authenticated)this.broadcast({type:"presence",online:presenceSnapshot(this)});}
  async webSocketError(ws){try{ws.close(1011,"socket error")}catch{}}
}

export default { async fetch(request,env){
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"Content-Type","access-control-max-age":"86400"}});
  const url=new URL(request.url);
  if(url.pathname==="/api/health")return json({ok:true,service:"Territory Sdolars Server",version:"1.1.0",telegramConfigured:Boolean(env.TELEGRAM_BOT_TOKEN),realtime:true});
  if(url.pathname==="/telegram/webhook"){
    if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);let update;try{update=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}try{await handleTelegramUpdate(update,env)}catch(e){console.error("Telegram webhook error",e)}return json({ok:true});
  }
  if(url.pathname==="/api/setup-telegram-webhook"){
    if(request.method!=="GET")return json({ok:false,error:"Method not allowed"},405);if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram token is not configured"},500);const webhookUrl=`${url.origin}/telegram/webhook`;const result=await telegramApi("setWebhook",{url:webhookUrl,allowed_updates:["message"]},env.TELEGRAM_BOT_TOKEN);return json({ok:Boolean(result?.ok),webhookUrl,telegram:result},result?.ok?200:502);
  }
  if(url.pathname==="/api/telegram-webhook-info"){
    if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram token is not configured"},500);const result=await telegramApi("getWebhookInfo",{},env.TELEGRAM_BOT_TOKEN);return json(result,result?.ok?200:502);
  }
  if(url.pathname==="/api/auth"||url.pathname==="/api/save"){
    if(request.method!=="POST")return json({ok:false,error:"Method not allowed"},405);let body;try{body=await request.clone().json()}catch{return json({ok:false,error:"Invalid JSON"},400)}let user;try{const params=new URLSearchParams(body.initData||"");const raw=params.get("user");user=raw?JSON.parse(raw):null}catch{user=null}if(!user||!Number.isSafeInteger(user.id))return json({ok:false,error:"Telegram user is missing"},401);const id=env.GAME_HUB.idFromName(`player:${user.id}`);return env.GAME_HUB.get(id).fetch(request);
  }
  if(url.pathname==="/api/ws"){
    if(request.headers.get("Upgrade")?.toLowerCase()!=="websocket")return json({ok:false,error:"WebSocket upgrade required"},426);const id=env.PRESENCE_HUB.idFromName("global");return env.PRESENCE_HUB.get(id).fetch(request);
  }
  return json({ok:false,error:"Not found"},404);
}};

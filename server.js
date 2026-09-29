'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalize: normalizeEconomy, snapshot: economySnapshot, applyTransaction } = require('./economy-ledger');

const PORT = Number(process.env.PORT || 10001);
const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '');
const DB_FILE = process.env.TERRITORY_DB_FILE || path.join(__dirname, 'data', 'players.json');
const ORIGINS = String(process.env.CORS_ORIGINS || '*').split(',').map(x => x.trim()).filter(Boolean);

function nowIso() { return new Date().toISOString(); }
function load() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) { return { version: 4, players: {} }; } }
function save(db) { fs.mkdirSync(path.dirname(DB_FILE), { recursive: true }); const tmp=DB_FILE+'.tmp'; fs.writeFileSync(tmp, JSON.stringify(db,null,2)); fs.renameSync(tmp,DB_FILE); }
const db=load(); db.version=Math.max(4,Number(db.version)||1); db.players=db.players&&typeof db.players==='object'?db.players:{};

function cors(req,res){const origin=req.headers.origin;if(ORIGINS.includes('*')||ORIGINS.includes(origin))res.setHeader('Access-Control-Allow-Origin',ORIGINS.includes('*')?'*':(origin||''));res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','content-type,x-telegram-init-data');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>500000)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function validateInitData(raw){
  if(!raw||!BOT_TOKEN)throw new Error('Telegram auth is not configured');
  const params=new URLSearchParams(raw),hash=params.get('hash'),authDate=Number(params.get('auth_date')||0);
  if(!hash||!authDate)throw new Error('Invalid Telegram initData');
  if(Math.abs(Date.now()/1000-authDate)>86400)throw new Error('Telegram initData expired');
  const dataCheckString=[...params.entries()].filter(([k])=>k!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
  const expected=crypto.createHmac('sha256',secret).update(dataCheckString).digest('hex');
  if(expected.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(hash)))throw new Error('Telegram signature mismatch');
  let user; try{user=JSON.parse(params.get('user')||'{}')}catch(_){throw new Error('Invalid Telegram user payload')}
  if(!user.id)throw new Error('Telegram user missing'); return user;
}
function auth(req){return validateInitData(String(req.headers['x-telegram-init-data']||''))}
function xpNext(level){const l=Math.max(1,Number(level)||1);return Math.max(100,Math.round(90+12*Math.pow(l,1.5)))}
function num(v,min,max,fallback){const n=Number(v);if(!Number.isFinite(n))return fallback;return Math.max(min,Math.min(max,n))}
function str(v,max,fallback=''){return typeof v==='string'?v.slice(0,max):fallback}
function plainObject(v){return v&&typeof v==='object'&&!Array.isArray(v)?v:{}}
function safeItem(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  const out={},allowed=['id','name','title','slot','type','icon','emoji','rarity','quality','tier','level','enhance','attack','strength','damage','atk','defense','def','armor','guard','agility','agi','speed','maxHp','hp','health','critChance','damageReduction','bonusXp','setId','setName','source'];
  for(const key of allowed){const value=item[key];if(typeof value==='string')out[key]=value.slice(0,160);else if(typeof value==='number'&&Number.isFinite(value))out[key]=num(value,-1000000,1000000,0)}
  return out;
}
function safeState(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const s={
    level:Math.floor(num(raw.level,1,240,1)),xp:Math.floor(num(raw.xp,0,1000000000,0)),xpNext:Math.floor(num(raw.xpNext,1,1000000000,100)),
    hp:Math.floor(num(raw.hp,0,1000000,100)),maxHp:Math.floor(num(raw.maxHp,1,1000000,100)),energy:Math.floor(num(raw.energy,0,1000000,100)),
    maxEnergy:Math.floor(num(raw.maxEnergy,1,1000000,100)),battleStones:Math.floor(num(raw.battleStones,0,1000000,30)),
    battleStonesBonus:Math.floor(num(raw.battleStonesBonus,0,1000000,0)),battleStonesDate:str(raw.battleStonesDate,32,''),battleStonesCap:Math.floor(num(raw.battleStonesCap,1,1000,30)),
    equipment:Array.isArray(raw.equipment)?raw.equipment.slice(0,7).map(safeItem):Array(7).fill(null),
    inventoryItems:Array.isArray(raw.inventoryItems)?raw.inventoryItems.slice(0,100).map(safeItem).filter(Boolean):[],
    followers:plainObject(raw.followers),activeFollower:raw.activeFollower==null?null:str(String(raw.activeFollower),80,null),
    consumables:plainObject(raw.consumables),pve:plainObject(raw.pve),currentChapter:Math.floor(num(raw.currentChapter,1,240,1)),
    chapterStage:Math.floor(num(raw.chapterStage,1,4,1)),chapterProgress:Math.floor(num(raw.chapterProgress,0,100,0)),
    chapterBossUnlocked:Boolean(raw.chapterBossUnlocked),chapterBossDefeated:Boolean(raw.chapterBossDefeated),chapterCompleted:Boolean(raw.chapterCompleted),
    forge:plainObject(raw.forge),arena:plainObject(raw.arena),daily:plainObject(raw.daily),weekly:plainObject(raw.weekly),story:plainObject(raw.story),
    auto:Boolean(raw.auto),pos:Math.floor(num(raw.pos,0,100000,0)),dice:Math.floor(num(raw.dice,0,100000,0))
  };
  s.pve={chapter:Math.floor(num(s.pve.chapter,1,240,s.currentChapter)),stage:Math.floor(num(s.pve.stage,1,4,s.chapterStage)),progress:Math.floor(num(s.pve.progress,0,100,s.chapterProgress)),bossPending:Boolean(s.pve.bossPending||s.chapterBossUnlocked),bossActive:Boolean(s.pve.bossActive),bossDefeated:Math.floor(num(s.pve.bossDefeated,0,1000000,0)),wins:Math.floor(num(s.pve.wins,0,1000000,0))};
  s.forge={materials:Math.floor(num(s.forge.materials,0,100000000,0)),selectedId:s.forge.selectedId==null?null:str(String(s.forge.selectedId),120,null),successes:Math.floor(num(s.forge.successes,0,1000000,0)),failStreak:Math.floor(num(s.forge.failStreak,0,1000000,0))};
  s.arena={rating:Math.floor(num(s.arena.rating,0,100000000,1000)),wins:Math.floor(num(s.arena.wins,0,1000000,0)),losses:Math.floor(num(s.arena.losses,0,1000000,0)),battles:Math.floor(num(s.arena.battles,0,1000000,0)),combatSlotsUnlocked:Math.floor(num(s.arena.combatSlotsUnlocked,0,6,3)),loadout:['crit','tank','dodge','resilience'].includes(s.arena.loadout)?s.arena.loadout:'crit',gear:Array.isArray(s.arena.gear)?s.arena.gear.slice(0,7).map(x=>x==null?null:str(String(x),120,null)) : []};
  s.consumables={}; for(const [key,value] of Object.entries(plainObject(raw.consumables))){if(Object.keys(s.consumables).length>=32)break;s.consumables[str(key,80)]=Math.floor(num(value,0,100000,0))}
  return s;
}
function defaultPlayer(user){const ts=nowIso();return{schema_version:4,telegram_id:String(user.id),first_name:str(user.first_name,120),last_name:str(user.last_name,120),username:str(user.username,120),photo_url:str(user.photo_url,1000),level:1,xp:0,xp_next:100,hp:100,max_hp:100,economy:{coins:0,gems:0,red_gems:0,vip:0,economy_version:1,ledger:[],receipts:{}},state:null,legacy_imported:false,created_at:ts,updated_at:ts};}
function playerFor(user){
  const id=String(user.id);let p=db.players[id];if(!p){p=defaultPlayer(user);db.players[id]=p;save(db);return p}
  p.schema_version=Math.max(4,Number(p.schema_version)||1);p.first_name=str(user.first_name,120,p.first_name||'');p.last_name=str(user.last_name,120,p.last_name||'');p.username=str(user.username,120,p.username||'');p.photo_url=str(user.photo_url,1000,p.photo_url||'');p.economy=normalizeEconomy(p.economy||{});
  p.updated_at=nowIso();save(db);return p;
}
function publicPlayer(p){const e=p.economy||{};return{schema_version:4,first_name:p.first_name||'',last_name:p.last_name||'',username:p.username||'',photo_url:p.photo_url||'',level:num(p.level,1,240,1),xp:num(p.xp,0,1000000000,0),xp_next:num(p.xp_next,1,1000000000,100),hp:num(p.hp,0,1000000,100),max_hp:num(p.max_hp,1,1000000,100),coins:num(e.coins,0,100000000000,0),gems:num(e.gems,0,1000000000,0),red_gems:num(e.red_gems,0,1000000000,0),vip:num(e.vip,0,100,0),has_server_progress:Boolean(p.state||p.legacy_imported||p.level>1||p.xp>0),legacy_imported:Boolean(p.legacy_imported),updated_at:p.updated_at};}
function migrate(p,data){
  if(p.legacy_imported||p.state||p.level>1||p.xp>0||(p.economy&&(p.economy.coins||p.economy.gems||p.economy.red_gems)))throw new Error('Legacy migration is already closed for this player');
  const state=safeState(data&&data.state);if(!state)throw new Error('Invalid legacy state');p.level=state.level;p.xp=Math.min(state.xp,xpNext(state.level)-1);p.xp_next=xpNext(state.level);p.hp=state.hp;p.max_hp=state.maxHp;p.state=state;p.legacy_imported=true;p.updated_at=nowIso();save(db);
}
function syncState(p,raw){const state=safeState(raw);if(!state)throw new Error('Invalid state');p.state=state;p.level=state.level;p.xp=Math.min(state.xp,xpNext(state.level)-1);p.xp_next=xpNext(state.level);p.hp=state.hp;p.max_hp=state.maxHp;p.updated_at=nowIso();save(db);return state;}

function pveSessionStart(p,chapter,stage,boss){
  const s=p.state||{},ch=Math.max(1,Math.min(240,Number(chapter)||1)),st=Math.max(1,Math.min(4,Number(stage)||1));
  if(ch!==Math.max(1,Number(s.currentChapter)||1))throw new Error('Chapter mismatch');
  if(!boss&&st!==Math.max(1,Number(s.chapterStage)||1))throw new Error('Stage mismatch');
  if(boss&&!s.chapterBossUnlocked)throw new Error('Boss is not unlocked');
  const bonus=Math.max(0,Number(s.battleStonesBonus)||0),stones=Math.max(0,Number(s.battleStones)||0);if(bonus<=0&&stones<=0)throw new Error('No battle stones');
  // Consume the battle stone on the server. The client authority layer must not consume twice.
  if(bonus>0)s.battleStonesBonus=bonus-1;else s.battleStones=stones-1;
  p.state=s;p.battle_sessions=p.battle_sessions||{};const id=crypto.randomUUID();p.battle_sessions[id]={id,chapter:ch,stage:st,boss:!!boss,created_at:Date.now(),completed:false};
  const cutoff=Date.now()-30*60*1000;for(const [key,value] of Object.entries(p.battle_sessions))if(!value||Number(value.created_at)<cutoff||value.completed)delete p.battle_sessions[key];
  p.updated_at=nowIso();save(db);return{session_id:id,state:s};
}
function pveSessionComplete(p,sessionId){
  const session=(p.battle_sessions||{})[String(sessionId||'')];if(!session||session.completed)throw new Error('Invalid or already completed battle session');
  if(Date.now()-Number(session.created_at)>30*60*1000)throw new Error('Battle session expired');session.completed=true;
  const chapter=session.chapter,boss=!!session.boss,milestone=boss&&chapter%10===0;
  const reward=boss?{coins:milestone?1250:500,gems:milestone?25:5,red_gems:0}:{coins:25,gems:0,red_gems:0};
  const tx=applyTransaction(p,{id:'pve:'+session.id,reason:boss?'pve_boss_reward':'pve_stage_reward',delta:reward},()=>save(db));
  p.updated_at=nowIso();save(db);return{reward,economy:tx.economy};
}
const routes=new Set(['/api/auth','/api/player','/api/migrate','/api/progress','/api/state','/api/economy','/api/pve/start','/api/pve/complete']);
const server=http.createServer(async(req,res)=>{
  cors(req,res);if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  try{
    const u=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,service:'territory-server',version:4,foundation:'COMPLETE-01'});
    if(!routes.has(u.pathname))return json(res,404,{error:'Not found'});
    const user=auth(req),player=playerFor(user);
    if(req.method==='GET'&&(u.pathname==='/api/auth'||u.pathname==='/api/player'))return json(res,200,{ok:true,player:publicPlayer(player),state:player.state||null});
    if(req.method==='GET'&&u.pathname==='/api/progress')return json(res,200,{ok:true,player:publicPlayer(player),state:player.state||null});
    if(req.method==='GET'&&u.pathname==='/api/economy')return json(res,200,{ok:true,economy:economySnapshot(player.economy)});
    if(req.method==='GET'&&u.pathname==='/api/state')return json(res,200,{ok:true,schema_version:4,state:player.state||null});
    if(req.method==='POST'&&u.pathname==='/api/migrate'){const data=await body(req);migrate(player,data);return json(res,200,{ok:true,player:publicPlayer(player),state:player.state||null});}
    if(req.method==='POST'&&u.pathname==='/api/pve/start'){const data=await body(req);const started=pveSessionStart(player,data.chapter,data.stage,!!data.boss);return json(res,200,{ok:true,session_id:started.session_id,state:started.state,player:publicPlayer(player)});}
    if(req.method==='POST'&&u.pathname==='/api/pve/complete'){const data=await body(req);const completed=pveSessionComplete(player,data.session_id);return json(res,200,{ok:true,reward:completed.reward,economy:completed.economy,player:publicPlayer(player)});}
    if(req.method==='POST'&&u.pathname==='/api/state'){const data=await body(req);const state=syncState(player,data&&data.state);return json(res,200,{ok:true,schema_version:4,player:publicPlayer(player),state});}
    return json(res,405,{error:'Method not allowed'});
  }catch(e){const status=/Telegram|auth|signature|initData|user missing|expired/i.test(e.message||'')?401:400;return json(res,status,{error:e.message||'Request failed'});}
});
server.listen(PORT,()=>console.log(`[Territory] server listening on :${PORT} · foundation COMPLETE-01`));

'use strict';
const http=require('http');const crypto=require('crypto');const fs=require('fs');const path=require('path');
const PORT=Number(process.env.PORT||10001);const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'');
const DB_FILE=process.env.TERRITORY_DB_FILE||path.join(__dirname,'data','players.json');
const ORIGINS=String(process.env.CORS_ORIGINS||'*').split(',').map(x=>x.trim()).filter(Boolean);
if(!BOT_TOKEN)console.warn('[Territory] TELEGRAM_BOT_TOKEN is not set. Telegram auth will reject requests.');
function load(){try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch(_){return {version:2,players:{}}}}
function save(db){fs.mkdirSync(path.dirname(DB_FILE),{recursive:true});const tmp=DB_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DB_FILE)}
const db=load();db.version=Math.max(2,Number(db.version)||1);db.players=db.players||{};
function cors(req,res){const o=req.headers.origin;if(ORIGINS.includes('*')||ORIGINS.includes(o))res.setHeader('Access-Control-Allow-Origin',ORIGINS.includes('*')?'*':o||'');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','content-type,x-telegram-init-data');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>500000)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function validateInitData(raw){
 if(!raw||!BOT_TOKEN)throw new Error('Telegram auth is not configured');const params=new URLSearchParams(raw);const hash=params.get('hash');const authDate=Number(params.get('auth_date')||0);if(!hash||!authDate)throw new Error('Invalid Telegram initData');if(Math.abs(Date.now()/1000-authDate)>86400)throw new Error('Telegram initData expired');
 const data=[...params.entries()].filter(([k])=>k!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();const expected=crypto.createHmac('sha256',secret).update(data).digest('hex');
 if(expected.length!==hash.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(hash)))throw new Error('Telegram signature mismatch');let user={};try{user=JSON.parse(params.get('user')||'{}')}catch(_){throw new Error('Invalid Telegram user payload')}if(!user.id)throw new Error('Telegram user missing');return user;
}
function auth(req){return validateInitData(String(req.headers['x-telegram-init-data']||''))}
function xpNext(level){return Math.max(100,Math.round(90+12*Math.pow(Math.max(1,level),1.5)))}
function safeState(raw){if(!raw||typeof raw!=='object')return null;const s={
 level:Math.max(1,Math.min(240,Number(raw.level)||1)),xp:Math.max(0,Number(raw.xp)||0),xpNext:Math.max(1,Number(raw.xpNext)||100),hp:Math.max(0,Number(raw.hp)||0),maxHp:Math.max(1,Math.min(1000000,Number(raw.maxHp)||100)),
 equipment:Array.isArray(raw.equipment)?raw.equipment.slice(0,7):[],inventoryItems:Array.isArray(raw.inventoryItems)?raw.inventoryItems.slice(0,100):[],followers:raw.followers&&typeof raw.followers==='object'?raw.followers:{},activeFollower:raw.activeFollower||null,consumables:raw.consumables&&typeof raw.consumables==='object'?raw.consumables:{},
 pve:raw.pve&&typeof raw.pve==='object'?raw.pve:{},currentChapter:Math.max(1,Math.min(240,Number(raw.currentChapter)||1)),chapterStage:Math.max(1,Number(raw.chapterStage)||1),chapterProgress:Math.max(0,Math.min(100,Number(raw.chapterProgress)||0)),forge:raw.forge&&typeof raw.forge==='object'?raw.forge:{},arena:raw.arena&&typeof raw.arena==='object'?raw.arena:{},daily:raw.daily&&typeof raw.daily==='object'?raw.daily:{},weekly:raw.weekly&&typeof raw.weekly==='object'?raw.weekly:{}};
 s.xp=Math.min(s.xp,xpNext(s.level)-1);s.xpNext=xpNext(s.level);return s;}
function playerFor(user){const id=String(user.id);let p=db.players[id];if(!p){p={telegram_id:id,first_name:user.first_name||'',last_name:user.last_name||'',username:user.username||'',photo_url:user.photo_url||'',level:1,xp:0,xp_next:100,hp:100,max_hp:100,coins:0,gems:0,red_gems:0,weapon:'',legacy_imported:false,state:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};db.players[id]=p;save(db)}else{p.first_name=user.first_name||p.first_name;p.last_name=user.last_name||p.last_name;p.username=user.username||p.username;p.photo_url=user.photo_url||p.photo_url;p.updated_at=new Date().toISOString();save(db)}return p}
function publicPlayer(p){return {...p,telegram_id:undefined,state:undefined,has_server_progress:p.legacy_imported===true||p.level>1||p.xp>0||p.coins>0||p.gems>0||p.red_gems>0||!!p.state}}
function migrate(p,data){if(p.legacy_imported||p.level>1||p.xp>0||p.coins>0||p.gems>0||p.red_gems>0||p.state)throw new Error('Legacy migration is already closed for this player');const level=Math.min(240,Math.max(1,Number(data.level)||1));const xp=Math.max(0,Math.min(xpNext(level)-1,Number(data.xp)||0));p.level=level;p.xp=xp;p.xp_next=xpNext(level);p.hp=Math.max(0,Math.min(Math.max(1,Number(data.maxHp)||100),Number(data.hp)||100));p.max_hp=Math.max(1,Math.min(1000000,Number(data.maxHp)||100));p.state=safeState(data.state);p.legacy_imported=true;p.updated_at=new Date().toISOString();save(db)}
function syncState(p,raw){const s=safeState(raw);if(!s)throw new Error('Invalid state');p.state=s;p.level=s.level;p.xp=s.xp;p.xp_next=s.xpNext;p.hp=s.hp;p.max_hp=s.maxHp;p.updated_at=new Date().toISOString();save(db);return s}
const server=http.createServer(async(req,res)=>{cors(req,res);if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}try{const u=new URL(req.url,'http://localhost');if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,service:'territory-auth',version:2});if(!['/api/auth','/api/migrate','/api/progress','/api/state'].includes(u.pathname))return json(res,404,{error:'Not found'});const user=auth(req),p=playerFor(user);
 if(req.method==='GET'&&u.pathname==='/api/auth')return json(res,200,{ok:true,player:publicPlayer(p)});
 if(req.method==='GET'&&u.pathname==='/api/progress')return json(res,200,{ok:true,player:publicPlayer(p),state:p.state||null});
 if(req.method==='GET'&&u.pathname==='/api/state')return json(res,200,{ok:true,state:p.state||null});
 if(req.method==='POST'&&u.pathname==='/api/migrate'){const data=await body(req);migrate(p,data);return json(res,200,{ok:true,player:publicPlayer(p),state:p.state||null})}
 if(req.method==='POST'&&u.pathname==='/api/state'){const data=await body(req);const state=syncState(p,data.state);return json(res,200,{ok:true,state})}
 return json(res,405,{error:'Method not allowed'});
}catch(e){return json(res,401,{error:e.message||'Unauthorized'});}});
server.listen(PORT,()=>console.log(`[Territory] auth server listening on :${PORT}`));

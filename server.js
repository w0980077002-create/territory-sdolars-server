
'use strict';
const http=require('http');const crypto=require('crypto');const fs=require('fs');const path=require('path');
const PORT=Number(process.env.PORT||10001);const BOT_TOKEN=String(process.env.TELEGRAM_BOT_TOKEN||'');
const DB_FILE=process.env.TERRITORY_DB_FILE||path.join(__dirname,'data','players.json');
const ORIGINS=String(process.env.CORS_ORIGINS||'*').split(',').map(x=>x.trim()).filter(Boolean);
if(!BOT_TOKEN){console.warn('[Territory] TELEGRAM_BOT_TOKEN is not set. Telegram auth will reject requests.');}
function load(){try{return JSON.parse(fs.readFileSync(DB_FILE,'utf8'))}catch(_){return {version:1,players:{}}}}
function save(db){fs.mkdirSync(path.dirname(DB_FILE),{recursive:true});const tmp=DB_FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DB_FILE)}
const db=load();
function cors(req,res){const o=req.headers.origin;if(ORIGINS.includes('*')||ORIGINS.includes(o))res.setHeader('Access-Control-Allow-Origin',ORIGINS.includes('*')?'*':o||'');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','content-type,x-telegram-init-data');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>100000)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function validateInitData(raw){
 if(!raw||!BOT_TOKEN)throw new Error('Telegram auth is not configured');
 const params=new URLSearchParams(raw);const hash=params.get('hash');const authDate=Number(params.get('auth_date')||0);if(!hash||!authDate)throw new Error('Invalid Telegram initData');
 if(Math.abs(Date.now()/1000-authDate)>86400)throw new Error('Telegram initData expired');
 const data=[...params.entries()].filter(([k])=>k!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const expected=crypto.createHmac('sha256',secret).update(data).digest('hex');
 if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(hash)))throw new Error('Telegram signature mismatch');
 let user={};try{user=JSON.parse(params.get('user')||'{}')}catch(_){throw new Error('Invalid Telegram user payload')}
 if(!user.id)throw new Error('Telegram user missing');return user;
}
function auth(req){return validateInitData(String(req.headers['x-telegram-init-data']||''))}
function xpNext(level){return Math.max(100,Math.round(90+12*Math.pow(Math.max(1,level),1.5)))}
function playerFor(user){const id=String(user.id);let p=db.players[id];if(!p){p={telegram_id:id,first_name:user.first_name||'',last_name:user.last_name||'',username:user.username||'',photo_url:user.photo_url||'',level:1,xp:0,xp_next:100,hp:100,max_hp:100,coins:0,gems:0,red_gems:0,weapon:'',legacy_imported:false,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};db.players[id]=p;save(db)}else{p.first_name=user.first_name||p.first_name;p.last_name=user.last_name||p.last_name;p.username=user.username||p.username;p.photo_url=user.photo_url||p.photo_url;p.updated_at=new Date().toISOString();save(db)}return p}
function publicPlayer(p){return {...p,has_server_progress:p.legacy_imported===true||p.level>1||p.xp>0||p.coins>0||p.gems>0||p.red_gems>0,telegram_id:undefined}}
function migrate(p,data){if(p.legacy_imported||p.level>1||p.xp>0||p.coins>0||p.gems>0||p.red_gems>0)throw new Error('Legacy migration is already closed for this player');
 const level=Math.min(240,Math.max(1,Number(data.level)||1));const xp=Math.max(0,Math.min(xpNext(level)-1,Number(data.xp)||0));
 p.level=level;p.xp=xp;p.xp_next=xpNext(level);p.hp=Math.max(0,Math.min(Math.max(1,Number(data.maxHp)||100),Number(data.hp)||100));p.max_hp=Math.max(1,Math.min(1000000,Number(data.maxHp)||100));p.coins=Math.max(0,Math.min(1e9,Number(data.coins)||0));p.gems=Math.max(0,Math.min(1e7,Number(data.gems)||0));p.red_gems=Math.max(0,Math.min(1e7,Number(data.redGems)||0));p.legacy_imported=true;p.updated_at=new Date().toISOString();save(db)}
const server=http.createServer(async(req,res)=>{cors(req,res);if(req.method==='OPTIONS'){res.statusCode=204;return res.end()}try{
 const u=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&u.pathname==='/health')return json(res,200,{ok:true,service:'territory-auth',version:1});
 if(!['/api/auth','/api/migrate','/api/progress'].includes(u.pathname))return json(res,404,{error:'Not found'});
 const user=auth(req),p=playerFor(user);
 if(req.method==='GET'&&u.pathname==='/api/auth')return json(res,200,{ok:true,player:publicPlayer(p)});
 if(req.method==='GET'&&u.pathname==='/api/progress')return json(res,200,{ok:true,player:publicPlayer(p)});
 if(req.method==='POST'&&u.pathname==='/api/migrate'){const data=await body(req);migrate(p,data);return json(res,200,{ok:true,player:publicPlayer(p)})}
 return json(res,405,{error:'Method not allowed'});
}catch(e){return json(res,401,{error:e.message||'Unauthorized'});}
});
server.listen(PORT,()=>console.log(`[Territory] auth server listening on :${PORT}`));

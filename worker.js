import { DurableObject } from "cloudflare:workers";

const START = {
  coins:1779,gems:1330,energy:191.38,hp:120,maxHp:120,level:3,exp:120,
  maxExp:150,strength:12,agility:9,freePoints:0,wins:0,losses:0,battles:0
};

const INDEX_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Territory — Sdolars</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#071522;color:#eee;font-family:Arial,sans-serif}
button{font:inherit;color:inherit}#app{height:100%;display:flex;flex-direction:column}
.hud{height:58px;display:flex;align-items:center;justify-content:space-around;background:#101d27;border-bottom:1px solid #3b505c;font-weight:700}
.scene{flex:1;position:relative;overflow:hidden;background:radial-gradient(circle at 50% 38%,#294651,#08141d 72%)}
.scene:before{content:"";position:absolute;inset:0;background:linear-gradient(transparent 60%,#071017)}
.title{position:absolute;top:12px;left:0;right:0;text-align:center;font-size:22px;font-weight:900;letter-spacing:2px;text-shadow:0 2px 8px #000}
.hero{position:absolute;left:50%;bottom:11%;transform:translateX(-50%);width:180px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:end}
.hero .body{width:100px;height:150px;border-radius:45px 45px 20px 20px;background:linear-gradient(90deg,#17272d,#536d6d,#17272d);border:4px solid #71827d}
.hero .head{width:72px;height:72px;border-radius:50%;background:#718e84;border:5px solid #293e3b;position:absolute;top:15px}
.hero .horn{position:absolute;top:0;width:110px;height:35px;border-top:13px solid #ddd4b2}
.menu{height:82px;background:#101b24;border-top:1px solid #3b505b;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;padding:6px}
.menu button{border:0;border-radius:8px;background:#172934;font-size:11px}
.panel{position:absolute;inset:0;background:rgba(5,12,17,.96);z-index:5;padding:16px;overflow:auto}
.panel h2{margin:4px 0 14px}.close{float:right;background:#293b45;border:0;border-radius:8px;padding:8px 12px}
.row{display:flex;justify-content:space-between;gap:10px;padding:12px;border-bottom:1px solid #31434d}
.action{margin:8px 0;padding:12px;border:1px solid #4c6570;border-radius:9px;background:#182b35;width:100%}
.fighters{display:flex;gap:10px;justify-content:center;margin-top:50px}.fighter{width:46%;text-align:center}
.fighter img{width:100%;height:190px;object-fit:contain}.fighterName{font-weight:900}.fighterRole{font-size:12px;color:#9db0b6}.fhp{height:10px;background:#301a1a;border-radius:8px;overflow:hidden;margin-top:6px}.fhp i{display:block;width:100%;height:100%;background:#c84a45}
.zones{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin-top:12px}.zones button{padding:9px 2px;background:#182a34;border:1px solid #49606b;border-radius:7px;font-size:10px}
.selected{outline:2px solid #e1b85c;background:#39402d!important}.combat{margin-top:14px}
</style></head>
<body><div id="app">
<div class="hud"><span>🪙 <b id="coins">1779</b></span><span>💎 <b id="gems">1330</b></span><span>⚡ <b id="energy">191</b></span><span>❤️ <b id="hp">120</b></span></div>
<div class="scene"><div class="title">TERRITORY</div><div class="hero"><div class="horn"></div><div class="head"></div><div class="body"></div></div></div>
<div class="menu">
<button onclick="openPanel('arena')">⚔️<br>Арена</button>
<button onclick="openPanel('shop')">🛡️<br>Рынок</button>
<button onclick="openPanel('districts')">🏙️<br>Районы</button>
<button onclick="openPanel('profile')">👤<br>Профиль</button>
<button onclick="openPanel('more')">☰<br>Меню</button>
</div><div id="panel"></div></div>
<script>
const state=JSON.parse(localStorage.getItem('territory_save')||'null')||${JSON.stringify(START)};
function save(){localStorage.setItem('territory_save',JSON.stringify(state));renderHud()}
function renderHud(){coins.textContent=Math.floor(state.coins);gems.textContent=Math.floor(state.gems);energy.textContent=Math.floor(state.energy);hp.textContent=Math.floor(state.hp)}
function openPanel(type){
 const p=document.getElementById('panel');
 let h='<div class="panel"><button class="close" onclick="closePanel()">✕</button>';
 if(type==='arena') h+='<h2>⚔️ Викингская арена</h2><p>Тактический бой: выбери атаку и две зоны защиты.</p><button class="action" onclick="battle()">НАЧАТЬ БОЙ</button>';
 if(type==='shop') h+='<h2>🛡️ Рынок снаряжения</h2><button class="action" onclick="buy(250,2)">Топор — 250 🪙</button><button class="action" onclick="buy(500,5)">Меч — 500 🪙</button>';
 if(type==='districts') h+='<h2>🏙️ Sdolars</h2><div class="row">Северный район <b>Открыт</b></div><div class="row">Арена <b>Открыта</b></div><div class="row">Таверна <b>Открыта</b></div>';
 if(type==='profile') h+='<h2>👤 Профиль</h2><div class="row">Уровень <b>'+state.level+'</b></div><div class="row">Сила <b>'+state.strength+'</b></div><div class="row">Ловкость <b>'+state.agility+'</b></div><div class="row">Победы <b>'+state.wins+'</b></div>';
 if(type==='more') h+='<h2>☰ Territory</h2><button class="action" onclick="resetGame()">Сбросить локальное сохранение</button>';
 h+='</div>';p.innerHTML=h
}
function closePanel(){panel.innerHTML=''}
function buy(cost,bonus){if(state.coins<cost)return alert('Не хватает монет');state.coins-=cost;state.strength+=bonus;save();openPanel('shop')}
function resetGame(){localStorage.removeItem('territory_save');location.reload()}
function battle(){
 let player=state.maxHp,enemy=100,attack=null,defs=[];
 const zones=['Голова','Грудь','Живот','Пояс','Ноги'];
 panel.innerHTML='<div class="panel"><button class="close" onclick="closePanel()">✕</button><h2>⚔️ Тактический бой</h2><div class="fighters"><div class="fighter"><div style="font-size:90px">🛡️</div><div class="fighterName">Игрок</div><div class="fhp"><i id="ph" style="width:100%"></i></div></div><div class="fighter"><div style="font-size:90px">👹</div><div class="fighterName">Ледяной тролль</div><div class="fhp"><i id="eh" style="width:100%"></i></div></div></div><div class="combat"><b>Атака — 1 зона</b><div class="zones" id="att"></div><b>Защита — 2 зоны</b><div class="zones" id="def"></div><button class="action" onclick="turn()">⚔️ СДЕЛАТЬ ХОД</button><div id="log"></div></div></div>';
 const a=document.getElementById('att'),d=document.getElementById('def');
 zones.forEach((z,i)=>{a.innerHTML+=`<button onclick="pickA(${i},this)">${z}</button>`;d.innerHTML+=`<button onclick="pickD(${i},this)">${z}</button>`})
 window.pickA=(i,e)=>{attack=i;[...a.children].forEach(x=>x.classList.remove('selected'));e.classList.add('selected')}
 window.pickD=(i,e)=>{if(defs.includes(i))defs=defs.filter(x=>x!==i);else if(defs.length<2)defs.push(i);[...d.children].forEach(x=>x.classList.toggle('selected',defs.includes([...d.children].indexOf(x)))}
 window.turn=()=>{if(attack===null||defs.length!==2)return alert('Выбери атаку и 2 зоны защиты');let dmg=(attack===2?24:18)+Math.floor(Math.random()*8);if(!defs.includes(attack))enemy=Math.max(0,enemy-dmg);let ed=12+Math.floor(Math.random()*10);if(!defs.includes(Math.floor(Math.random()*5)))player=Math.max(0,player-ed);document.getElementById('ph').style.width=player+'%';document.getElementById('eh').style.width=enemy+'%';document.getElementById('log').textContent='Ход выполнен: -'+dmg+' HP врагу';attack=null;defs=[];[...a.children,...d.children].forEach(x=>x.classList.remove('selected'));if(enemy<=0){state.wins++;state.coins+=100;save();document.getElementById('log').textContent='🏆 Победа! +100 🪙'}else if(player<=0){state.losses++;save();document.getElementById('log').textContent='☠️ Поражение'}}
}
renderHud()
</script></body></html>`;

export class GameHub extends DurableObject {
  constructor(ctx, env){super(ctx,env);this.ctx=ctx;this.env=env;this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS players (player_id TEXT PRIMARY KEY,name TEXT NOT NULL,state_json TEXT NOT NULL,updated_at INTEGER NOT NULL)`);}
  async fetch(request){
    const u=new URL(request.url);
    if(u.pathname==='/health') return Response.json({ok:true,service:'Territory Sdolars',version:'s51'});
    if(u.pathname==='/player' && request.method==='POST'){const body=await request.json();this.ctx.storage.sql.exec('INSERT OR REPLACE INTO players VALUES (?,?,?,?)',body.playerId,body.name,JSON.stringify(body.state),Date.now());return Response.json({ok:true});}
    return new Response('Not found',{status:404});
  }
}

export default {
 async fetch(request,env){
   const u=new URL(request.url);
   if(u.pathname==='/api/health') return Response.json({ok:true,service:'Territory Sdolars',version:'s51',serverTime:Date.now(),telegramAuth:!!env.TELEGRAM_BOT_TOKEN});
   if(u.pathname==='/api/game'){
     const id=env.GAME_HUB.idFromName('global'); return env.GAME_HUB.get(id).fetch(request);
   }
   return new Response(INDEX_HTML,{headers:{'content-type':'text/html;charset=UTF-8'}});
 }
};

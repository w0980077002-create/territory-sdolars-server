import { DurableObject } from "cloudflare:workers";

const HTML = String.raw`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Territory — Sdolars</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:#090d12;color:#e9edf0;font:14px Arial,sans-serif}
body{padding-bottom:70px}.app{max-width:520px;margin:auto;min-height:100vh;background:linear-gradient(#111820,#0b1016)}
.top{position:sticky;top:0;z-index:5;background:#10171f;border-bottom:1px solid #29333d;padding:9px 12px}
.brand{display:flex;justify-content:space-between;align-items:center}.logo{font-weight:900;letter-spacing:2px;font-size:20px}.city{font-size:11px;color:#8f9ba5}
.stats{display:flex;gap:5px;margin-top:8px}.stat{flex:1;text-align:center;background:#171f28;border:1px solid #29343e;border-radius:7px;padding:5px;font-size:11px}.stat b{display:block;color:#fff;margin-top:2px}
main{padding:10px}.screen{display:none}.screen.active{display:block}.title{font-size:18px;font-weight:800;margin:4px 0 10px}.sub{color:#8996a0;font-size:12px}
.card{background:#131b23;border:1px solid #29343e;border-radius:10px;padding:10px;margin:8px 0}.row{display:flex;gap:7px}.row>*{flex:1}
.btn{border:1px solid #34414c;background:#1b2630;color:#eef2f4;border-radius:7px;padding:8px;font-weight:700;font-size:11px}.btn.primary{background:#922727;border-color:#c23b3b}.btn.gold{background:#80621b;border-color:#aa872c}.btn:disabled{opacity:.4}
.hero{height:165px;border-radius:12px;background:radial-gradient(circle at 50% 25%,#30404a,#10171d 55%,#080b0f);border:1px solid #35424c;display:grid;place-items:center}.hero b{font-size:90px;filter:drop-shadow(0 8px 8px #000)}
.profile{display:flex;gap:10px;align-items:center}.avatar{width:66px;height:66px;border-radius:50%;background:#26333d;border:2px solid #8c7026;display:grid;place-items:center;font-size:34px}
.hp{height:7px;background:#252d34;border-radius:99px;overflow:hidden;margin-top:6px}.hp i{display:block;height:100%;background:#b52d2d}.hpText{font-size:10px;color:#aeb8be;margin-top:3px}
.fighters{display:flex;gap:7px}.fighter{flex:1;text-align:center;background:#101820;border:1px solid #2b3842;border-radius:10px;padding:7px}.face{height:85px;display:grid;place-items:center;font-size:60px;background:#0b1117;border-radius:7px;margin-bottom:5px}.fighterName{font-weight:800;font-size:12px}.fighterRole{font-size:10px;color:#8d9aa4;margin-top:3px}
.turn{text-align:center;font-size:12px;color:#c2c9ce}.sectionLabel{font-size:10px;color:#9ba7af;font-weight:800;margin-top:9px}
.zones{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:6px}.zone{padding:7px 2px;border:1px solid #34404a;background:#19222a;border-radius:6px;color:#dce2e6;font-size:9px;font-weight:700}.zone.selected{background:#8e2424;border-color:#d34a4a}.zone.def.selected{background:#26506a;border-color:#4f8caf}
.log{height:78px;overflow:auto;background:#090d12;border:1px solid #27323b;border-radius:7px;padding:6px;font-size:10px;color:#aab5bc}
.item{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #252e36}.item:last-child{border:0}.itemIcon{font-size:26px;width:34px;text-align:center}.itemInfo{flex:1}.itemInfo b{font-size:12px}.itemInfo small{display:block;color:#89959e;margin-top:2px}
.nav{position:fixed;bottom:0;left:0;right:0;z-index:10;background:#10171f;border-top:1px solid #29343e}.navin{width:min(520px,100%);margin:auto;display:grid;grid-template-columns:repeat(5,1fr)}.nav button{background:none;border:0;color:#7f8b94;padding:7px 2px;font-size:9px}.nav button b{display:block;font-size:18px;margin-bottom:2px}.nav button.active{color:#d7b34b}
.notice{padding:8px;border-left:3px solid #b38a28;background:#191b18;color:#c8c1a5;font-size:11px;border-radius:4px}
</style></head>
<body><div class="app">
<header class="top"><div class="brand"><div class="logo">TERRITORY</div><div class="city">SDOLARS · ONLINE</div></div>
<div class="stats"><div class="stat">🪙<b id="coins">1779</b></div><div class="stat">💎<b id="gems">1330</b></div><div class="stat">⚡<b id="energy">100</b></div><div class="stat">⭐<b id="level">3</b></div></div></header>
<main>
<section id="home" class="screen active"><div class="title">Центральная площадь</div><div class="sub">Sdolars · территория под контролем</div>
<div class="hero"><b>🧔🏻‍♂️</b></div><div class="card profile"><div class="avatar">🪓</div><div style="flex:1"><b id="pname">Воин</b><div class="sub">Уровень <span id="lv2">3</span> · Рейтинг <span id="rating">1000</span></div><div class="hp"><i id="hpbar"></i></div><div class="hpText" id="hptext">120 / 120 HP</div></div></div>
<div class="row"><button class="btn primary" onclick="startBattle()">⚔ ВОЙТИ НА АРЕНУ</button><button class="btn gold" onclick="show('districts')">🗺 РАЙОНЫ</button></div>
<div class="card"><b>Состояние города</b><p class="sub">Арена открыта. Новые районы доступны по уровню.</p><div class="notice">В бою выбирай 1 зону атаки и ровно 2 зоны защиты каждый ход.</div></div></section>

<section id="battle" class="screen"><div class="title">⚔ Арена Sdolars</div><div class="fighters">
<div class="fighter"><div class="face">🧔🏻‍♂️</div><div class="fighterName">Ты</div><div class="fighterRole">Уровень <span id="blvl">3</span></div><div class="hp"><i id="phpbar"></i></div><div class="hpText" id="php">120/120</div></div>
<div class="fighter"><div class="face">👹</div><div class="fighterName" id="enemyName">Уличный боец</div><div class="fighterRole" id="enemyRole">Разбойник</div><div class="hp"><i id="ehpbar" style="width:100%"></i></div><div class="hpText" id="ehp">90/90</div></div></div>
<div class="card"><div class="turn">ХОД <b id="turn">1</b></div><div class="sectionLabel">АТАКА — одна зона</div><div class="zones" id="attackZones"></div>
<div class="sectionLabel">ЗАЩИТА — две зоны</div><div class="zones" id="defZones"></div><div class="row" style="margin-top:8px"><button class="btn primary" id="fightBtn" onclick="makeTurn()">⚔ НАНЕСТИ УДАР</button><button class="btn" onclick="retreat()">← ОТСТУПИТЬ</button></div></div>
<div class="log" id="battleLog"></div></section>

<section id="districts" class="screen"><div class="title">🗺 Районы Sdolars</div><div id="districtList"></div></section>
<section id="shop" class="screen"><div class="title">🛒 Рынок снаряжения</div><div id="shopList"></div></section>
<section id="profile" class="screen"><div class="title">👤 Профиль персонажа</div><div class="card profile"><div class="avatar">🪓</div><div><b id="pn2">Воин</b><div class="sub">Уровень <span id="lv3">3</span></div></div></div>
<div class="card"><b>Характеристики</b><div class="item"><span>💪 Сила</span><b id="str" style="margin-left:auto">12</b><button class="btn" onclick="addStat('str')">+1</button></div>
<div class="item"><span>🏃 Ловкость</span><b id="agi" style="margin-left:auto">9</b><button class="btn" onclick="addStat('agi')">+1</button></div><div class="item"><span>🎯 Свободные очки</span><b id="points" style="margin-left:auto">0</b></div></div>
<div class="card"><b>Инвентарь</b><div id="inventory"></div></div></section>
</main></div>
<nav class="nav"><div class="navin"><button class="active" data-s="home" onclick="show('home',this)"><b>⌂</b>Город</button><button data-s="battle" onclick="startBattle()"><b>⚔</b>Арена</button><button data-s="shop" onclick="show('shop',this)"><b>🛒</b>Рынок</button><button data-s="districts" onclick="show('districts',this)"><b>🗺</b>Районы</button><button data-s="profile" onclick="show('profile',this)"><b>☻</b>Профиль</button></div></nav>
<script>
const Z=['Голова','Грудь','Живот','Пояс','Ноги'];
const enemies=[{name:'Уличный боец',role:'Разбойник',hp:90,damage:8,def:3,reward:90,xp:25},{name:'Наёмник',role:'Воин Sdolars',hp:125,damage:11,def:6,reward:130,xp:35},{name:'Ледяной тролль',role:'Монстр',hp:170,damage:14,def:9,reward:200,xp:50},{name:'Арена чемпион',role:'Элитный боец',hp:230,damage:18,def:12,reward:320,xp:80}];
const gear=[{id:'knife',name:'Боевой нож',icon:'🗡️',damage:7,price:250},{id:'axe',name:'Северный топор',icon:'🪓',damage:14,price:700},{id:'armor',name:'Кожаный доспех',icon:'🛡️',defense:8,price:500},{id:'steel',name:'Стальной доспех',icon:'🛡️',defense:16,price:1100}];
let s=JSON.parse(localStorage.getItem('territory_sdolars_v1')||'null')||{name:'Воин',coins:1779,gems:1330,energy:100,hp:120,maxHp:120,level:3,exp:120,maxExp:150,str:12,agi:9,points:0,rating:1000,wins:0,losses:0,inv:[{id:'fists',name:'Кулаки',icon:'✊',damage:0,equipped:true}]};
let battle=null,atk=null,defs=[];
const $=id=>document.getElementById(id);
function save(){localStorage.setItem('territory_sdolars_v1',JSON.stringify(s));render()}
function show(id,btn){document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.s===id));if(id==='shop')renderShop();if(id==='districts')renderDistricts();if(id==='profile')renderInv()}
function render(){$('coins').textContent=s.coins;$('gems').textContent=s.gems;$('energy').textContent=Math.floor(s.energy);$('level').textContent=s.level;$('lv2').textContent=s.level;$('lv3').textContent=s.level;$('pname').textContent=s.name;$('pn2').textContent=s.name;$('rating').textContent=s.rating;$('str').textContent=s.str;$('agi').textContent=s.agi;$('points').textContent=s.points;$('hptext').textContent=s.hp+' / '+s.maxHp+' HP';$('hpbar').style.width=(s.hp/s.maxHp*100)+'%'}
function startBattle(){const e=enemies[Math.min(3,Math.floor(s.wins/3))];battle={...e,max:e.hp,player:s.hp,turn:1};atk=null;defs=[];show('battle');$('enemyName').textContent=e.name;$('enemyRole').textContent=e.role;$('fightBtn').disabled=false;log('Бой начался. Выбери атаку и две зоны защиты.');drawZones();updateBattle()}
function drawZones(){$('attackZones').innerHTML=Z.map((z,i)=>'<button class="zone '+(atk===i?'selected':'')+'" onclick="pickAtk('+i+')">'+z+'</button>').join('');$('defZones').innerHTML=Z.map((z,i)=>'<button class="zone def '+(defs.includes(i)?'selected':'')+'" onclick="pickDef('+i+')">'+z+'</button>').join('')}
function pickAtk(i){atk=i;drawZones()}function pickDef(i){if(defs.includes(i))defs=defs.filter(x=>x!==i);else if(defs.length<2)defs.push(i);drawZones()}
function makeTurn(){if(!battle||battle.player<=0||battle.hp<=0)return;if(atk===null||defs.length!==2){log('Нужно выбрать 1 зону атаки и ровно 2 зоны защиты.');return}let weapon=s.inv.find(x=>x.equipped)?.damage||0;let dmg=Math.max(1,Math.round(15+s.str*.7+weapon-battle.def));if(Math.random()<.18)dmg=Math.round(dmg*1.5);battle.hp=Math.max(0,battle.hp-dmg);let enemyZone=Math.floor(Math.random()*5);let blocked=defs.includes(enemyZone);let edmg=blocked?Math.max(1,Math.round(battle.damage*.35)):battle.damage;if(Math.random()*100<s.agi*1.5)edmg=0;battle.player=Math.max(0,battle.player-edmg);battle.turn++;log('Атака: '+Z[atk]+' — '+dmg+' урона. '+(edmg?'Ответ: '+edmg+'.':'Ты уклонился.'));atk=null;defs=[];updateBattle();if(battle.hp<=0)win();else if(battle.player<=0)lose()}
function updateBattle(){$('turn').textContent=battle.turn;$('php').textContent=battle.player+'/'+s.maxHp;$('ehp').textContent=battle.hp+'/'+battle.max;$('phpbar').style.width=(battle.player/s.maxHp*100)+'%';$('ehpbar').style.width=(battle.hp/battle.max*100)+'%'}
function win(){s.hp=Math.min(s.maxHp,battle.player);s.coins+=battle.reward;s.exp+=battle.xp;s.wins++;s.rating+=18;levelUp();save();log('ПОБЕДА! +'+battle.reward+' 🪙, +'+battle.xp+' XP.');$('fightBtn').disabled=true}
function lose(){s.hp=Math.max(1,Math.round(s.maxHp*.35));s.losses++;s.rating=Math.max(0,s.rating-10);save();log('ПОРАЖЕНИЕ. Восстановлено 35% HP.');$('fightBtn').disabled=true}
function retreat(){battle=null;show('home')}
function levelUp(){while(s.exp>=s.maxExp){s.exp-=s.maxExp;s.level++;s.maxExp=Math.round(s.maxExp*1.25);s.maxHp+=8;s.hp=s.maxHp;s.points+=2}}
function log(t){$('battleLog').innerHTML='<div>'+t+'</div>'+$('battleLog').innerHTML}
function renderShop(){$('shopList').innerHTML=gear.map((x,i)=>'<div class="card item"><div class="itemIcon">'+x.icon+'</div><div class="itemInfo"><b>'+x.name+'</b><small>⚔ '+(x.damage||0)+' · 🛡 '+(x.defense||0)+' · '+x.price+' 🪙</small></div><button class="btn gold" onclick="buy('+i+')">Купить</button></div>').join('')}
function buy(i){let x=gear[i];if(s.coins<x.price){alert('Недостаточно монет');return}s.coins-=x.price;s.inv.push({...x,equipped:false});save();renderShop()}
function renderInv(){$('inventory').innerHTML=s.inv.map((x,i)=>'<div class="item"><div class="itemIcon">'+x.icon+'</div><div class="itemInfo"><b>'+x.name+'</b><small>⚔ '+(x.damage||0)+' · 🛡 '+(x.defense||0)+(x.equipped?' · ЭКИПИРОВАНО':'')+'</small></div><button class="btn" onclick="equip('+i+')">'+(x.equipped?'Снять':'Надеть')+'</button></div>').join('')}
function equip(i){s.inv.forEach(x=>x.equipped=false);s.inv[i].equipped=true;save();renderInv()}
function addStat(k){if(!s.points)return;s[k]++;s.points--;save()}
function renderDistricts(){let d=[['Центральная площадь',1,'🏰'],['Северный лес',3,'🌲'],['Порт Sdolars',8,'⚓'],['Промзона',12,'🏭'],['Старая крепость',18,'🏛️']];$('districtList').innerHTML=d.map(x=>'<div class="card item"><div class="itemIcon">'+x[2]+'</div><div class="itemInfo"><b>'+x[0]+'</b><small>Требуется уровень '+x[1]+'</small></div><button class="btn" '+(s.level<x[1]?'disabled':'')+'>Войти</button></div>').join('')}
render();
</script></body></html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/")
      return new Response(HTML, {headers: {"content-type": "text/html; charset=UTF-8", "cache-control": "no-store"}});
    if (url.pathname === "/api/health")
      return Response.json({ok:true, game:"Territory", city:"Sdolars", version:"v1"});
    return new Response("Not found", {status:404});
  }
};

export class GameHub extends DurableObject {
  async fetch() { return new Response("Territory GameHub online"); }
}

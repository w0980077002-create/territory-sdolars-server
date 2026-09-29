'use strict';
const assert=require('assert');const {applyTransaction,normalize}=require('./economy-ledger');
const p={economy:normalize({coins:100,gems:2,red_gems:1,vip:0,ledger:[],receipts:{}})};
let r=applyTransaction(p,{id:'test:tx01',reason:'test_reward',delta:{coins:25,gems:1}},()=>{});assert.equal(r.applied,true);assert.equal(p.economy.coins,125);
r=applyTransaction(p,{id:'test:tx01',reason:'test_reward',delta:{coins:25,gems:1}},()=>{});assert.equal(r.applied,false);assert.equal(p.economy.coins,125);
assert.throws(()=>applyTransaction(p,{id:'test:tx02',reason:'test_reward',delta:{coins:-1000}},()=>{}),/Insufficient/);
assert.throws(()=>applyTransaction(p,{id:'test:tx03',reason:'test_reward',delta:{coins:1.5}},()=>{}),/Invalid integer/);
console.log('economy ledger tests: PASS');

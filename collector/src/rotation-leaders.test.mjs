import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyStocks,captureLeaders} from './rotation-leaders.mjs';
const row=(code,r5,r10,ratio,signals=[],amount=600000000,sectors=['0002'])=>({code,name:code,close:1000,r5,r10,amount_ratio:ratio,signals,amount,sectors});
test('leaders and recovering followers require liquidity, true group and price recovery',()=>{
 const r=classifyStocks([row('000001',4,15,2),row('000002',2,0,2,['ENV20_LOWER_TOUCH']),row('000003',1,1,3),row('000004',-1,-10,4),row('000005',1,0,null),row('000006',1,0,3,[],100),row('000007',1,0,3,[],600000000,['0003'])],{code:'0002'});
 assert.deepEqual(r.leaders.map(x=>x.code),['000001']);
 assert.deepEqual(r.followers.map(x=>x.code),['000002','000003']);
 assert.equal(classifyStocks([row('000002',1,0,3)],{code:'0002'}).followers.length,0);
});
test('plan never opens DB',async()=>{
 assert.equal((await captureLeaders({}, {mode:'plan',factory:()=>{throw Error('forbidden')}})).status,'PLAN_ONLY');
});

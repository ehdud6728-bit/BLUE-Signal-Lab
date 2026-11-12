import test from 'node:test';
import assert from 'node:assert/strict';
import {groupBasketRecords} from '../web/src/basket-grouping.ts';
const originals=[
 {id:'MANUAL:005930:2026-11-02',code:'005930',name:'삼성전자',day:'2026-11-02',baseline:70000,memo:'first'},
 {id:'MANUAL:000660:2026-11-05',code:'000660',name:'SK하이닉스',day:'2026-11-05',baseline:500000,memo:''},
 {id:'AI:005930:2026-11-10',code:'005930',name:'삼성전자',day:'2026-11-10',baseline:75000,memo:'second'}
];
test('duplicate ticker groups by code, not by day or origin',()=>{
 const g=groupBasketRecords(originals);assert.equal(g.length,2);
 assert.deepEqual(g[0].records.map(x=>x.id),[originals[0].id,originals[2].id]);
 assert.equal(g[1].records[0].baseline,500000);
});
test('un-grouping retains every row and original order',()=>{
 const g=groupBasketRecords(originals,false);
 assert.deepEqual(g.map(x=>x.key),originals.map(x=>x.id));
 assert.equal(g.length,originals.length);
});
test('grouping does not mutate provenance, baseline, memo or array',()=>{
 const before=JSON.stringify(originals);const g=groupBasketRecords(originals);
 assert.equal(JSON.stringify(originals),before);
 assert.notEqual(g[0].records,g[1].records);
 assert.equal(g[0].records[1],originals[2]);
});
test('empty group stays empty and first encountered ticker determines order',()=>{
 assert.deepEqual(groupBasketRecords([]),[]);
 assert.deepEqual(groupBasketRecords([...originals].reverse()).map(x=>x.code),['005930','000660']);
});

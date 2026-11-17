import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {technicalFilterWhere} from '../worker/src/technical-filters.ts';

test('inverse alignment checks positive verified 20/40/60-day moving averages',()=>{
 const where=technicalFilterWhere('inverse','any');
 assert.match(where,/ma20/);
 assert.match(where,/ma40/);
 assert.match(where,/ma60/);
 assert.match(where,/json_type/);
 assert.match(where,/</);
});
test('112/224 breakouts can be selected with OR or AND before SQL paging',()=>{
 const either=technicalFilterWhere('ma112,ma224','any');
 const both=technicalFilterWhere('ma112,ma224','all');
 assert.match(either,/ OR /);
 assert.match(both,/ AND /);
 assert.match(either,/ma112_cross/);
 assert.match(both,/ma224_cross/);
});
test('invalid or repeated trend fields are rejected',()=>{
 assert.equal(technicalFilterWhere('bad','any'),null);
 assert.equal(technicalFilterWhere('ma112,ma112','any'),null);
 assert.equal(technicalFilterWhere('ma112','xor'),null);
 assert.equal(technicalFilterWhere('','any'),'');
});
test('actual SQLite selects only matching search-day signals, including combined filters',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE signals (code TEXT, extras_json TEXT)');
  const add=db.prepare('INSERT INTO signals(code,extras_json) VALUES (?,?)');
  add.run('000001',JSON.stringify({ma20:100,ma40:110,ma60:120,ma112_cross:true}));
  add.run('000002',JSON.stringify({ma20:120,ma40:110,ma60:100,ma224_cross:true}));
  add.run('000003',JSON.stringify({ma20:100,ma40:110,ma60:120,ma112_cross:true,ma224_cross:true}));
  add.run('000004',JSON.stringify({name:'missing historical moving averages'}));
  const codes=(where)=>db.prepare(`SELECT code FROM signals WHERE ${where} ORDER BY code`).all().map(x=>x.code);
  assert.deepEqual(codes(technicalFilterWhere('inverse','any')),['000001','000003']);
  assert.deepEqual(codes(technicalFilterWhere('ma112,ma224','all')),['000003']);
  assert.deepEqual(codes(technicalFilterWhere('inverse,ma224','any')),['000001','000002','000003']);
 }finally{db.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {checkedBreadth,inspectBenchmark,classifyIndex,stateOf,BREADTH_SQL} from './market-trends-regime.mjs';
const ds=Array.from({length:30},(_,i)=>new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10));
const series=ds.map((day,i)=>({day,close:100+i}));
function rows(){return ds.flatMap((day,i)=>['KOSPI','KOSDAQ'].map(market=>({day,prior5:i>=5?ds[i-5]:null,expected:1700,actual:1700,invalid:0,source:'KRX_OPENAPI_EXACT_DAY_VERIFIED',hash:'a'.repeat(64),market,universe:850,matched:i>=5?850:0,up:i>=5?510:0}))); }
test('index and breadth are separate, missing date invalidates joint state',()=>{
 const all=checkedBreadth(rows());
 assert.equal(inspectBenchmark(series,'KOSPI',all,ds.at(-1)).latest.state,'UP_CONFIRMED');
 all.delete(ds[27]);assert.equal(inspectBenchmark(series,'KOSPI',all,ds.at(-1)).latest.state,'UNKNOWN');
 assert.equal(classifyIndex(series,24).trend,'UP');
 const changed=series.map((x,i)=>i>24?{...x,close:1000}:x);
 assert.deepEqual(classifyIndex(series,24),classifyIndex(changed,24));
 assert.equal(stateOf({trend:'DOWN',short:'UP'},'BROAD_UP'),'RECOVERY_WATCH');
 assert.equal(stateOf({trend:'UP',short:'DOWN'},'BROAD_WEAK'),'WEAKENING_WATCH');
 assert.equal(stateOf({trend:'UP',short:'UP'},'BROAD_WEAK'),'MIXED_OR_DIVERGENT');
});
test('SQL validates same market match and count audit on synthetic SQLite',()=>{
 const db=new DatabaseSync(':memory:');try{
 db.exec('CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT PRIMARY KEY,row_count INTEGER,source TEXT,day_sha256 TEXT);CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,market TEXT,close INTEGER,source TEXT,PRIMARY KEY(trade_day,code))');
 const a=db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?,?,?)'), b=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES(?,?,?,?,?)'),source='KRX_OPENAPI_EXACT_DAY_VERIFIED';
 for(let j=0;j<6;j++){a.run(ds[j],1700,source,'a'.repeat(64));for(let i=0;i<1700;i++)b.run(ds[j],String(i),i<850?'KOSPI':'KOSDAQ',100+j,source);}
 const data=checkedBreadth(db.prepare(BREADTH_SQL).all(ds[0],ds[5]));
 assert.equal(data.get(ds[5]).markets.get('KOSPI').up,850);assert.equal(data.get(ds[5]).valid,true);
 db.prepare('DELETE FROM blue_eod_daily_v1 WHERE trade_day=? AND code=?').run(ds[5],'0');
 assert.equal(checkedBreadth(db.prepare(BREADTH_SQL).all(ds[0],ds[5])).get(ds[5]).valid,false);
 }finally{db.close();}
});

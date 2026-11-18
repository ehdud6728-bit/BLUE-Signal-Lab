import assert from 'node:assert/strict';
import {test} from 'node:test';
import {InvalidEodQuery,tursoEodDates,tursoEodSearch} from '../worker/src/turso-eod.ts';

const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'example-token'};

function mockDb({failure=false,audit=true,actualCount='1',hasDirectory=false}={}){
  const calls=[];let closed=0;
  const factory=()=>({
    async execute(stmt){
      const sql=typeof stmt==='string'?stmt:stmt.sql;
      const args=typeof stmt==='string'?[]:stmt.args;
      calls.push({sql,args});
      assert.match(sql,/^SELECT\b/);
      if(failure)throw Error('provider failed');
      if(sql.includes('FROM blue_eod_ingest_audit_v1')&&sql.includes('ORDER BY'))
        return {rows:[{day:'2026-11-18',rows:'2660',source:'KRX_PYKRX_EXACT_DAY_VERIFIED'}]};
      if(sql.includes('FROM blue_eod_ingest_audit_v1'))
        return {rows:audit?[{row_count:'2660',source:'KRX_PYKRX_EXACT_DAY_VERIFIED'}]:[]};
      if(sql.includes('FROM sqlite_master'))return {rows:hasDirectory?[{ok:1}]:[]};
      if(sql.includes('COUNT(*) AS n'))return {rows:[{n:actualCount}]};
      return {rows:[{day:'2026-11-18',code:'005930',name:hasDirectory?'삼성전자':'',
        name_asof_day:hasDirectory?'2026-11-18':null,market:'KOSPI',
        open:'80000',high:'81000',low:'79000',close:'80500',volume:'12000000',
        amount:'960000000000',source:'KRX_PYKRX_EXACT_DAY_VERIFIED'}]};
    },close(){closed++;}});
  return {calls,factory,get closed(){return closed;}};
}

test('reads only audited Turso days; no D1 or write calls',async()=>{
  const db=mockDb();
  const out=await tursoEodDates(env,db.factory);
  assert.equal(out.latest,'2026-11-18');
  assert.equal(out.items[0].rows,2660);
  assert.equal(out.storage,'TURSO');
  assert.equal(db.closed,1);
  assert.equal(db.calls.length,1);
});

test('returns historical daily prices and keeps KRW turnover as a precise string',async()=>{
  const db=mockDb();
  const out=await tursoEodSearch(env,new URLSearchParams({day:'2026-11-18',q:'삼성',page:'1',limit:'50'}),db.factory);
  assert.equal(out.data_status,'VERIFIED_EOD_ONLY');
  assert.equal(out.items[0].close,80500);
  assert.equal(out.items[0].amount_krw,'960000000000');
  assert.equal(out.total,1);
  assert.equal(out.items[0].name,'');
  assert.deepEqual(db.calls[3].args,['2026-11-18','%삼성%','%삼성%',50,0]);
  assert.equal(db.closed,1);
});

test('joins audited Turso company-name directory for visible name and name query, not D1',async()=>{
  const db=mockDb({hasDirectory:true});
  const out=await tursoEodSearch(env,new URLSearchParams({day:'2026-11-18',q:'삼성'}),db.factory);
  assert.equal(out.items[0].name,'삼성전자');
  assert.equal(out.items[0].name_asof_day,'2026-11-18');
  assert.match(db.calls[2].sql,/LEFT JOIN blue_symbol_directory_v1 n/);
  assert.match(db.calls[2].sql,/n\.name/);
  assert.equal(db.calls.every(c=>/^SELECT\b/.test(c.sql)),true);
});

test('escapes SQL LIKE wildcard input and does not interpolate user text',async()=>{
  const db=mockDb();
  await tursoEodSearch(env,new URLSearchParams({day:'2026-11-18',q:'A%_\\'}),db.factory);
  assert.deepEqual(db.calls[2].args,['2026-11-18','%A\\%\\_\\\\%','%A\\%\\_\\\\%']);
  assert.equal(db.calls.every(c=>!c.sql.includes('A%_')),true);
});

test('rejects invalid days, offsets and overlong queries without opening DB',async()=>{
  const db=mockDb();
  for(const params of [
    {day:'2026-02-31'}, {day:'2026-11-18',page:'0'},
    {day:'2026-11-18',limit:'200'}, {day:'2026-11-18',q:'x'.repeat(51)}]){
    await assert.rejects(()=>tursoEodSearch(env,new URLSearchParams(params),db.factory),InvalidEodQuery);
  }
  assert.equal(db.calls.length,0);
});

test('does not mistake a non-audited date for verified zero matches',async()=>{
  const db=mockDb({audit:false});
  const out=await tursoEodSearch(env,new URLSearchParams({day:'2026-11-18'}),db.factory);
  assert.equal(out.data_status,'NOT_VERIFIED');
  assert.equal(out.total,0);
  assert.equal(db.calls.length,1);
});

test('rejects an incomplete Turso day instead of silently presenting it as full coverage',async()=>{
  const db=mockDb({actualCount:'0'});
  await assert.rejects(()=>tursoEodSearch(env,new URLSearchParams({day:'2026-11-18'}),db.factory),
    /TURSO_EOD_AUDIT_ROW_COUNT_MISMATCH/);
  assert.equal(db.closed,1);
});

test('handles missing secrets and closes Turso connection on provider failure',async()=>{
  const db=mockDb({failure:true});
  await assert.rejects(()=>tursoEodDates({...env,TURSO_AUTH_TOKEN:''},db.factory),/TURSO_EOD_NOT_CONFIGURED/);
  assert.equal(db.closed,0);
  await assert.rejects(()=>tursoEodDates(env,db.factory),/provider failed/);
  assert.equal(db.closed,1);
});

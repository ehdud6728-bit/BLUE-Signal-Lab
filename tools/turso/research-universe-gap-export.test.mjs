import test from 'node:test';
import assert from 'node:assert/strict';
import {DAYS,exportResearchUniverseGap} from './research-universe-gap-export.mjs';

const hash='c'.repeat(64);
function fixtures({shortDay='',dropRowDay='',badCode=false}={}){
  const requests=[];
  const eodAudits=DAYS.map(day=>({trade_day:day,row_count:'2662',
    source:'KRX_PYKRX_EXACT_DAY_VERIFIED',day_sha256:hash}));
  const research=DAYS.map(day=>({trade_day:day,row_count:'88',
    observed_stocks:day===shortDay?'2600':'2612',source_payload_sha256:hash,
    source_audit_sha256:hash}));
  const codes=Array.from({length:2662},(_,i)=>String(i+1).padStart(6,'0'));
  const client={async execute(query){
    const {sql,args=[]}=typeof query==='string'?{sql:query}:query;
    requests.push(sql);
    assert.match(sql,/^SELECT\s/);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|DROP|CREATE|REPLACE)\b/);
    if(sql.includes('FROM blue_eod_ingest_audit_v1')){
      assert.deepEqual(args,DAYS);return {rows:eodAudits};
    }
    if(sql.includes('FROM blue_research_signal_audit_v1')){
      assert.deepEqual(args,DAYS);return {rows:research};
    }
    if(sql.includes('FROM blue_eod_daily_v1')){
      const end=dropRowDay===args[0]?1:0;
      return {rows:codes.slice(0,codes.length-end).map((code,i)=>({
        code:badCode&&i===0?'X-0001':code,
        market:i<1000?'KOSPI':'KOSDAQ',name:`STOCK_${code}`}))};
    }
    throw Error('TEST_UNEXPECTED_QUERY');
  }};
  return {client,requests};
}

test('plan makes zero DB calls, and explicit inspect rejects missing client',async()=>{
  assert.equal((await exportResearchUniverseGap(null)).turso_queries,0);
  await assert.rejects(exportResearchUniverseGap(null,{mode:'inspect'}),/CLIENT_REQUIRED/);
  await assert.rejects(exportResearchUniverseGap(null,{mode:'apply'}),/BAD_MODE/);
});
test('reads exactly four audited days and every EOD code without writing',async()=>{
  const {client,requests}=fixtures();
  const result=await exportResearchUniverseGap(client,{mode:'inspect'});
  assert.equal(requests.length,6);
  assert.equal(result.days.length,4);
  assert.equal(result.eod_rows_readback,10648);
  assert.equal(result.days[0].eod_codes.length,2662);
  assert.equal(result.days[0].net_gap,50);
  assert.equal(result.turso_read_only,true);
});
test('fails closed if old counts change, any EOD rows are missing or codes malformed',async()=>{
  for(const args of [{shortDay:DAYS[0]},{dropRowDay:DAYS[1]},{badCode:true}]){
    const {client}=fixtures(args);
    await assert.rejects(exportResearchUniverseGap(client,{mode:'inspect'}),/UNIVERSE_GAP_/);
  }
});

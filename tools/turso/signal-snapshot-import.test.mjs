import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {importSignalSnapshot,verifySignalSnapshot} from './signal-snapshot-import.mjs';

const sha=input=>createHash('sha256').update(input).digest('hex');
const day='2026-11-18';
function fixture(){
  const records=[
    {trade_day:day,code:'000660',run_id:'blue_market_20261118',signal_names:'BB40',
      close_price:1144000,supply_distance_pct:null,extras:{ma224_cross:'True'},
      chart:{version:'R10_CHART_V1',asof:day,bars:[{t:day,c:1144000,h:1170000,l:1100000}]},stats:{setups:[]}},
    {trade_day:day,code:'005930',run_id:'blue_market_20261118',signal_names:'BB20,ENV20',
      close_price:194700,supply_distance_pct:null,extras:{rsi_gc:'False'},
      chart:{version:'R10_CHART_V1',asof:day,bars:[{t:day,c:194700,h:199950,l:188800}]},stats:{setups:[]}},
  ];
  const payload=Buffer.from(records.map(r=>JSON.stringify(r)+'\n').join(''));
  const manifest={format:'BLUE_TURSO_SIGNAL_SNAPSHOT_V1',day,run_id:'blue_market_20261118',
    observed_stocks:2660,signal_events:3,matched_stocks:2,
    source:'KRX_PYKRX_EXACT_DAY_VERIFIED',source_audit_sha256:'a'.repeat(64),
    signals_csv_sha256:'b'.repeat(64),chart_snapshots_sha256:'c'.repeat(64),
    payload_sha256:sha(payload)};
  return {manifest,payload};
}

test('dry-run validates deterministic source without connecting to any DB',async()=>{
  const {manifest,payload}=fixture();
  assert.equal(verifySignalSnapshot(manifest,payload).length,2);
  const result=await importSignalSnapshot({manifest,payload,mode:'dry_run',
    clientFactory:()=>{throw Error('UNEXPECTED_DB_CALL');}});
  assert.deepEqual(result,{status:'DRY_RUN',day,rows:2,written:0});
});

test('reject tampering, duplicate ticker, and future-dated chart before DB access',async()=>{
  const {manifest,payload}=fixture();
  assert.throws(()=>verifySignalSnapshot(manifest,Buffer.from(payload.toString().replace('1144000','1144001'))),
    /SIGNAL_SNAPSHOT_HASH_MISMATCH/);
  const rows=payload.toString().trim().split('\n').map(JSON.parse);
  rows[1].code=rows[0].code;
  const changed=Buffer.from(rows.map(r=>JSON.stringify(r)+'\n').join(''));
  assert.throws(()=>verifySignalSnapshot({...manifest,payload_sha256:sha(changed)},changed),
    /INVALID_SIGNAL_SNAPSHOT_RECORD/);
  rows[1].code='005930';rows[1].chart.bars[0].t='2026-11-19';
  const future=Buffer.from(rows.map(r=>JSON.stringify(r)+'\n').join(''));
  assert.throws(()=>verifySignalSnapshot({...manifest,payload_sha256:sha(future)},future),
    /INVALID_SIGNAL_SNAPSHOT_RECORD/);
});

function mockTurso(){
  const records=new Map(),audits=new Map(),eod=new Map([['000660',1144000],['005930',194700]]);
  let eodReady=true,closed=0,eodAuditCount=2660;
  const client={
    async execute(input){
      const sql=typeof input==='string'?input:input.sql;
      const args=typeof input==='string'?[]:input.args;
      if(sql.startsWith('CREATE '))return {rows:[]};
      if(sql.includes('FROM blue_eod_ingest_audit_v1'))return {rows:eodReady?[{row_count:BigInt(eodAuditCount)}]:[]};
      if(sql.includes('FROM blue_eod_daily_v1'))return {rows:args.slice(1).sort().map(code=>
        eod.has(code)?{code,close:BigInt(eod.get(code))}:null).filter(Boolean)};
      if(sql.includes('INSERT INTO blue_research_signals_v1')){
        for(let i=0;i<args.length;i+=8){
          const [trade_day,code,run_id,signal_names,close_price,record_json,row_sha256,source_payload_sha256]=args.slice(i,i+8);
          const key=`${trade_day}:${code}`;
          if(!records.has(key))records.set(key,{code,run_id,signal_names,close_price,record_json,row_sha256,source_payload_sha256});
        }
        return {rows:[]};
      }
      if(sql.includes('FROM blue_research_signals_v1'))return {rows:[...records.values()].sort((a,b)=>a.code.localeCompare(b.code))};
      if(sql.includes('INSERT INTO blue_research_signal_audit_v1')){
        if(!audits.has(args[0]))audits.set(args[0],{
          row_count:BigInt(args[1]),observed_stocks:BigInt(args[2]),signal_events:BigInt(args[3]),
          source_payload_sha256:args[4],source_audit_sha256:args[5]});
        return {rows:[]};
      }
      if(sql.includes('FROM blue_research_signal_audit_v1'))return {rows:audits.has(args[0])?[audits.get(args[0])]:[]};
      throw Error(`UNEXPECTED_SQL ${sql.slice(0,60)}`);
    },
    close(){closed++;},
  };
  return {client,records,audits,eod,setEodReady:v=>{eodReady=v;},
    setEodAuditCount:v=>{eodAuditCount=v;},getClosed:()=>closed};
}

test('apply requires independently audited EOD price parity; D1 is never contacted',async()=>{
  const {manifest,payload}=fixture(),mock=mockTurso();
  const options={manifest,payload,mode:'apply',env:{TURSO_DATABASE_URL:'libsql://fake.invalid',
    TURSO_AUTH_TOKEN:'fake'},clientFactory:()=>mock.client};
  mock.setEodReady(false);
  await assert.rejects(importSignalSnapshot(options),/TURSO_SIGNAL_EOD_DAY_NOT_VERIFIED/);
  mock.setEodReady(true);mock.eod.set('000660',1111111);
  await assert.rejects(importSignalSnapshot(options),/TURSO_SIGNAL_EOD_PRICE_MISMATCH/);
  mock.eod.set('000660',1144000);
  const result=await importSignalSnapshot(options);
  assert.equal(result.status,'OK');assert.equal(result.written,2);
  assert.equal(mock.records.size,2);assert.equal(mock.audits.size,1);
  assert.equal((await importSignalSnapshot(options)).written,2);
  mock.records.get('2026-11-18:005930').record_json='CORRUPTED';
  await assert.rejects(importSignalSnapshot(options),/TURSO_SIGNAL_EXISTING_RECORD_CONFLICT/);
  assert.equal(mock.getClosed(),5);
});

test('apply refuses research universe smaller than KRX EOD even when every matched price agrees',async()=>{
  const {manifest,payload}=fixture(),mock=mockTurso();
  mock.setEodAuditCount(2661);
  await assert.rejects(importSignalSnapshot({manifest,payload,mode:'apply',
    env:{TURSO_DATABASE_URL:'libsql://fake.invalid',TURSO_AUTH_TOKEN:'fake'},
    clientFactory:()=>mock.client}),/TURSO_SIGNAL_RESEARCH_UNIVERSE_MISMATCH/);
  assert.equal(mock.records.size,0);
  assert.equal(mock.audits.size,0);
  assert.equal(mock.getClosed(),1);
});

test('only explicitly selected apply mode can create or modify Turso',async()=>{
  const {manifest,payload}=fixture();
  await assert.rejects(importSignalSnapshot({manifest,payload,mode:'apply',env:{}}),
    /TURSO_URL_MISSING_OR_INVALID/);
  await assert.rejects(importSignalSnapshot({manifest,payload,mode:'auto'}),
    /INVALID_SIGNAL_SNAPSHOT_MODE/);
});

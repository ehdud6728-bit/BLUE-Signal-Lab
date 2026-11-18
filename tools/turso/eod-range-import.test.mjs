import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateEodRange,importEodRange} from './eod-range-import.mjs';

const hash=(x)=>createHash('sha256').update(x).digest('hex');
const source='KRX_PYKRX_EXACT_DAY_VERIFIED';

function payloadFor(days=['2026-11-09']){
  const all=[],audits=[];
  for(const day of days){
    const records=Array.from({length:1700},(_,i)=>({
      trade_day:day,code:String(i).padStart(6,'0'),
      market:i<850?'KOSPI':'KOSDAQ',name:'',
      open:'100',high:'110',low:'90',close:'105',volume:'1000',amount:'105000',source,
    }));
    const bytes=Buffer.from(records.map(r=>JSON.stringify(r)+'\n').join(''));
    all.push(bytes);
    audits.push({day,rows:records.length,source,sha256:hash(bytes)});
  }
  const buffer=Buffer.concat(all);
  const manifest={format:'BLUE_TURSO_VERIFIED_EOD_RANGE_V1',start_day:days[0],
    end_day:days.at(-1),days:audits,total_rows:1700*days.length,data_sha256:hash(buffer)};
  return {manifest,buffer};
}

test('only complete, date-sorted, independently hashed market days are accepted',()=>{
  const {manifest,buffer}=payloadFor(['2026-11-09','2026-11-10']);
  assert.equal(validateEodRange(manifest,buffer).total,3400);
});

test('missing weekdays cannot be silently omitted',()=>{
  const {manifest,buffer}=payloadFor(['2026-11-09','2026-11-11']);
  assert.throws(()=>validateEodRange(manifest,buffer),/MISSING_EOD_DAYS/);
});

test('modified candle bytes, even if parseable, are rejected',()=>{
  const {manifest,buffer}=payloadFor();
  const corrupt=Buffer.from(buffer.toString().replace('"close":"105"','"close":"106"'));
  assert.throws(()=>validateEodRange(manifest,corrupt),/EOD_PAYLOAD_HASH_MISMATCH/);
});

test('dry_run does not connect or write to Turso',async()=>{
  const {manifest,buffer}=payloadFor();
  const result=await importEodRange({manifest,buffer,mode:'dry_run',
    clientFactory:()=>{throw Error('SHOULD_NOT_CONNECT');}});
  assert.deepEqual(result,{status:'DRY_RUN',days:1,rows:1700,written:0});
});

test('apply uses idempotent inserts, exact read-back, and audit proof',async()=>{
  const {manifest,buffer}=payloadFor();
  const stored=new Map(),proof=new Map();
  const client={
    async execute(statement){
      const sql=typeof statement==='string'?statement:statement.sql;
      const args=typeof statement==='string'?[]:statement.args;
      if(sql.startsWith('CREATE TABLE'))return {rows:[]};
      if(sql.includes('INSERT INTO blue_eod_ingest_audit_v1')){
        if(!proof.has(args[0]))proof.set(args[0],{row_count:BigInt(args[1]),source:args[2],day_sha256:args[3]});
        return {rows:[]};
      }
      if(sql.includes('SELECT row_count'))return {rows:proof.has(args[0])?[proof.get(args[0])]:[]};
      if(sql.includes('SELECT code,market'))return {rows:[...stored.values()]
        .filter(x=>x.trade_day===args[0]).sort((a,b)=>a.code.localeCompare(b.code))};
      throw Error(`UNKNOWN_SQL:${sql.slice(0,50)}`);
    },
    async batch(batch){
      for(const statement of batch){
        assert.match(statement.sql,/ON CONFLICT\(trade_day,code\) DO NOTHING/);
        for(let i=0;i<statement.args.length;i+=11){
          const args=statement.args.slice(i,i+11);
          const [trade_day,code,market,name,open,high,low,close,volume,amount,src]=args;
          const key=`${trade_day}:${code}`;
          if(!stored.has(key))stored.set(key,{trade_day,code,market,name,open,high,low,close,volume,amount,source:src});
        }
      }
    },
    close() {},
  };
  const args={manifest,buffer,mode:'apply',env:{TURSO_DATABASE_URL:'libsql://fake.example',TURSO_AUTH_TOKEN:'fake'},
    clientFactory:()=>client};
  assert.equal((await importEodRange(args)).written,1700);
  assert.equal((await importEodRange(args)).written,1700);
  assert.equal(stored.size,1700);
  stored.get('2026-11-09:000000').close='999';
  await assert.rejects(importEodRange(args),/TURSO_EOD_EXISTING_OR_READBACK_MISMATCH/);
});

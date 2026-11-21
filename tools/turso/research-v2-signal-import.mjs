/** Four-day independently audited R1.1 replay into an isolated v2 research pair.
 * Default dry_run never connects. `check` uses only SELECT. `apply` is an
 * explicitly guarded future operation, never dispatched by the PR workflow.
 * The old blue_research_signals_v1 / audit_v1 tables are never modified.
 */
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {verifySignalSnapshot} from './signal-snapshot-import.mjs';
import {REPLAY_DAYS} from './research-v2-eod-export.mjs';

const HASH=/^[a-f0-9]{64}$/;
const SOURCE=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const CONFIRM='blue-research-v2-four-day-replay';
const assert=(ok,code)=>{if(!ok)throw Error(code);};
const integer=(raw,min,max)=>raw!==null&&raw!==undefined&&
  Number.isSafeInteger(Number(raw))&&Number(raw)>=min&&Number(raw)<=max;

export function validateV2Snapshot(manifest,payload,proof){
  assert(proof?.format==='BLUE_RESEARCH_REPLAY_V2_PROOF_V1'&&
    REPLAY_DAYS.includes(proof.day)&&proof.day===manifest?.day&&
    proof.v1_original_unchanged===true&&proof.source==='IMMUTABLE_KRX_EOD_HASH_MATCH_RESCAN'&&
    proof.all_50_histories_ready===true&&
    SOURCE.has(proof.verified_eod_source)&&
    proof.verified_eod_source===manifest.source&&
    integer(proof.eod_row_count,1700,10000)&&
    proof.eod_row_count===manifest.observed_stocks&&
    proof.research_payload_sha256===manifest.payload_sha256&&
    proof.research_source_audit_sha256===manifest.source_audit_sha256&&
    ['eod_day_sha256','research_payload_sha256','research_source_audit_sha256',
      'source_marcap_sha256_2025','source_marcap_sha256_2026',
      'history_50_coverage_sha256']
      .every(k=>HASH.test(String(proof[k]))),'V2_REPLAY_BAD_RESEARCH_PROOF');
  const records=verifySignalSnapshot(manifest,payload);
  return records;
}

async function readV2Day(client,day,limit){
  const result=[];
  for(let offset=0;offset<=limit;offset+=5){
    const page=(await client.execute({sql:`SELECT code,record_json,row_sha256
      FROM blue_research_signals_v2 WHERE trade_day=? ORDER BY code LIMIT ? OFFSET ?`,
      args:[day,5,offset]})).rows;
    result.push(...page);
    assert(result.length<=limit,'V2_REPLAY_EXTRA_RECORDS');
    if(page.length<5)break;
  }
  return result;
}

export async function importV2Replay({manifest,payload,proof,mode='dry_run',env=process.env,
  clientFactory=createClient}={}){
  assert(['dry_run','check','apply'].includes(mode),'V2_REPLAY_BAD_IMPORT_MODE');
  const records=validateV2Snapshot(manifest,payload,proof);
  if(mode==='dry_run')return {status:'DRY_RUN',day:proof.day,
    observed:proof.eod_row_count,signals:records.length,written:0,queries:0};
  if(mode==='apply')assert(env.V2_REPLAY_APPLY_CONFIRM===CONFIRM,
    'V2_REPLAY_APPLY_NOT_AUTHORIZED');
  const url=String(env.TURSO_DATABASE_URL||''),token=String(env.TURSO_AUTH_TOKEN||'');
  assert(/^(libsql|https):\/\//.test(url)&&token,'V2_REPLAY_MISSING_CONFIG');
  const client=clientFactory({url,authToken:token,intMode:'string'});
  try{
    const eod=(await client.execute({sql:`SELECT row_count,source,day_sha256
      FROM blue_eod_ingest_audit_v1 WHERE trade_day=?`,args:[proof.day]})).rows;
    assert(eod.length===1&&Number(eod[0].row_count)===proof.eod_row_count&&
      String(eod[0].source)===proof.verified_eod_source&&
      String(eod[0].day_sha256)===proof.eod_day_sha256,
      'V2_REPLAY_EOD_AUDIT_MISMATCH');
    const original=(await client.execute({sql:`SELECT observed_stocks
      FROM blue_research_signal_audit_v1 WHERE trade_day=?`,args:[proof.day]})).rows;
    assert(original.length===1&&integer(original[0].observed_stocks,1700,10000)&&
      proof.eod_row_count-Number(original[0].observed_stocks)===50,
      'V2_REPLAY_ORIGINAL_RESEARCH_UNEXPECTED');
    for(let i=0;i<records.length;i+=40){
      const chunk=records.slice(i,i+40);
      const prices=(await client.execute({sql:`SELECT code,close FROM blue_eod_daily_v1
        WHERE trade_day=? AND code IN (${chunk.map(()=>'?').join(',')}) ORDER BY code`,
        args:[proof.day,...chunk.map(r=>r.code)]})).rows;
      assert(prices.length===chunk.length&&prices.every((r,j)=>
        String(r.code)===chunk[j].code&&String(r.close_price??r.close)===String(chunk[j].close_price)),
        'V2_REPLAY_SIGNAL_KRX_PRICE_MISMATCH');
    }
    if(mode==='check')return {status:'CHECKED_READ_ONLY',day:proof.day,
      observed:proof.eod_row_count,signals:records.length,written:0};

    // Only new v2 tables: never UPDATE, DELETE or REPLACE v1 or EOD.
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_research_signals_v2 (
      trade_day TEXT NOT NULL, code TEXT NOT NULL,run_id TEXT NOT NULL,
      signal_names TEXT NOT NULL,close_price INTEGER NOT NULL,
      record_json TEXT NOT NULL,row_sha256 TEXT NOT NULL,
      source_payload_sha256 TEXT NOT NULL,
      imported_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(trade_day,code))`);
    await client.execute(`CREATE INDEX IF NOT EXISTS blue_research_signals_day_v2
      ON blue_research_signals_v2(trade_day)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_research_signal_audit_v2 (
      trade_day TEXT PRIMARY KEY,row_count INTEGER NOT NULL,
      observed_stocks INTEGER NOT NULL,signal_events INTEGER NOT NULL,
      source_payload_sha256 TEXT NOT NULL,source_audit_sha256 TEXT NOT NULL,
      eod_day_sha256 TEXT NOT NULL,marcap_2025_sha256 TEXT NOT NULL,
      marcap_2026_sha256 TEXT NOT NULL,history_50_coverage_sha256 TEXT NOT NULL,
      completed_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const expectedAudit=[records.length,proof.eod_row_count,manifest.signal_events,
      proof.research_payload_sha256,proof.research_source_audit_sha256,
      proof.eod_day_sha256,proof.source_marcap_sha256_2025,
      proof.source_marcap_sha256_2026,proof.history_50_coverage_sha256];
    const existingAudit=(await client.execute({sql:`SELECT row_count,observed_stocks,
      signal_events,source_payload_sha256,source_audit_sha256,eod_day_sha256,
      marcap_2025_sha256,marcap_2026_sha256,history_50_coverage_sha256
      FROM blue_research_signal_audit_v2 WHERE trade_day=?`,args:[proof.day]})).rows;
    assert(existingAudit.length<=1,'V2_REPLAY_DUPLICATE_AUDIT');
    if(existingAudit.length){
      const keys=['row_count','observed_stocks','signal_events','source_payload_sha256',
        'source_audit_sha256','eod_day_sha256','marcap_2025_sha256','marcap_2026_sha256'];
      keys.push('history_50_coverage_sha256');
      assert(keys.every((key,i)=>String(existingAudit[0][key])===String(expectedAudit[i])),
        'V2_REPLAY_EXISTING_AUDIT_CONFLICT');
    }
    const before=await readV2Day(client,proof.day,records.length);
    const byCode=new Map(records.map(r=>[r.code,r]));
    for(const row of before){
      const expected=byCode.get(String(row.code));
      assert(expected&&String(row.row_sha256)===expected.row_sha256&&
        String(row.record_json)===expected.raw,'V2_REPLAY_EXISTING_ROW_CONFLICT');
    }
    for(let i=0;i<records.length;i+=4){
      const chunk=records.slice(i,i+4);
      await client.execute({sql:`INSERT INTO blue_research_signals_v2
        (trade_day,code,run_id,signal_names,close_price,record_json,row_sha256,source_payload_sha256)
        VALUES ${chunk.map(()=>'(?,?,?,?,?,?,?,?)').join(',')}
        ON CONFLICT(trade_day,code) DO NOTHING`,
        args:chunk.flatMap(r=>[r.trade_day,r.code,r.run_id,r.signal_names,r.close_price,
          r.raw,r.row_sha256,proof.research_payload_sha256])});
    }
    const after=await readV2Day(client,proof.day,records.length);
    assert(after.length===records.length&&after.every((row,i)=>
      String(row.code)===records[i].code&&String(row.record_json)===records[i].raw&&
      String(row.row_sha256)===records[i].row_sha256),'V2_REPLAY_READBACK_MISMATCH');
    await client.execute({sql:`INSERT INTO blue_research_signal_audit_v2
      (trade_day,row_count,observed_stocks,signal_events,source_payload_sha256,
      source_audit_sha256,eod_day_sha256,marcap_2025_sha256,marcap_2026_sha256,
      history_50_coverage_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(trade_day) DO NOTHING`,
      args:[proof.day,...expectedAudit]});
    const done=(await client.execute({sql:`SELECT row_count,observed_stocks,
      source_payload_sha256,eod_day_sha256 FROM blue_research_signal_audit_v2
      WHERE trade_day=?`,args:[proof.day]})).rows;
    assert(done.length===1&&Number(done[0].row_count)===records.length&&
      Number(done[0].observed_stocks)===proof.eod_row_count&&
      String(done[0].source_payload_sha256)===proof.research_payload_sha256&&
      String(done[0].eod_day_sha256)===proof.eod_day_sha256,
      'V2_REPLAY_AUDIT_READBACK_MISMATCH');
    return {status:'STORED',day:proof.day,observed:proof.eod_row_count,
      signals:records.length,written:records.length-before.length};
  }finally{client.close();}
}

async function main(){
  const args=process.argv.slice(2);
  const mode=(args.find(x=>x.startsWith('--mode='))||'--mode=dry_run').slice(7);
  const input=(args.find(x=>x.startsWith('--input-dir='))||'--input-dir=output/v2_replay/signals').slice(12);
  const proofPath=(args.find(x=>x.startsWith('--proof='))||'--proof=output/v2_replay/proof.json').slice(8);
  const manifest=JSON.parse(await readFile(`${input}/manifest.json`,'utf8'));
  const payload=await readFile(`${input}/records.jsonl`);
  const proof=JSON.parse(await readFile(proofPath,'utf8'));
  const result=await importV2Replay({manifest,payload,proof,mode});
  console.log('BLUE_V2_RESEARCH_REPLAY',`status=${result.status}`,
    `day=${result.day}`,`observed=${result.observed}`,
    `signals=${result.signals}`,`written=${result.written}`);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(e=>{console.error('BLUE_V2_RESEARCH_REPLAY_FAILED',
    String(e?.message||'').startsWith('V2_REPLAY_')||
    String(e?.message||'').startsWith('INVALID_SIGNAL_')||
    String(e?.message||'').startsWith('SIGNAL_SNAPSHOT_')?
      e.message:'SANITIZED_RUNTIME_FAILURE');process.exitCode=1;});
}

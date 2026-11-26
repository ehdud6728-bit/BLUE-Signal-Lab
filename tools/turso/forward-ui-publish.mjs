/** Explicit private publication of bounded aggregate report; no raw stock rows. */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const TABLE='blue_forward_ui_report_v1';
const hash=s=>createHash('sha256').update(s).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const day=d=>typeof d==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
export function compact(a,score,symbol){
 check(a.schema==='BLUE_ADAPTIVE_MARKET_BUNDLE_V1'&&score.schema==='BLUE_FORWARD_REPORT_V2'&&symbol.schema==='BLUE_FORWARD_SYMBOL_SETTLEMENT_REPORT_V1'&&day(a.asof)&&score.asof===a.asof&&symbol.asof===a.asof,'FORWARD_UI_BASIS');
 check(Array.isArray(a.market)&&a.market.length===2&&Array.isArray(score.pooled_opportunity_rows)&&Array.isArray(symbol.recent_rows),'FORWARD_UI_SHAPE');
 const market=a.market.map(m=>({market:m.market,state:m.state,breadth:m.breadth,timeline:m.timeline,frequency:{...m.frequency,rows:(m.frequency.rows||[]).slice(0,60),total_rows:(m.frequency.rows||[]).length}}));
 const rotation={status:a.rotation.status,receipt_count:a.rotation.receipts.length,outcome_status:a.rotation.outcome_status,rows:a.rotation.rows,cross_role_overlaps:a.rotation.cross_role_overlaps};
 const p=a.forward_performance;
 const result={schema:'BLUE_FORWARD_UI_V1',asof:a.asof,market,rotation,snapshot_count:score.snapshot_count,outcome_status:score.outcome_status,opportunity:score.pooled_opportunity_rows,
  archive:{total:symbol.total,conflicts:symbol.conflicts.length,sealed_recent:symbol.recent_rows.slice(0,10).map(r=>({source_day:r.source_day,horizon:r.horizon,maturity_day:r.maturity_day,coverage:r.coverage,exit_summary:r.exit_summary})),sealed_changes:p.sealed_changes.filter(r=>r.status==='DESCRIPTIVE_CHANGE').slice(0,20),unsealed_cohorts:p.unsealed_cohorts},
  limits:a.limits};
 check(Buffer.byteLength(JSON.stringify(result))<=250000,'FORWARD_UI_CAP');return result;
}
export async function publish(db,data,{apply=false,now=new Date()}={}){
 const raw=JSON.stringify(data),sha=hash(raw),at=now.toISOString();
 check(data.schema==='BLUE_FORWARD_UI_V1'&&day(data.asof)&&data.asof<=new Date(now.getTime()+32400000).toISOString().slice(0,10)&&Buffer.byteLength(raw)<=250000,'FORWARD_UI_BAD_REPORT');
 if(!apply)return {status:'INSPECT_ONLY',asof:data.asof,writes:0};
 await db.execute('CREATE TABLE IF NOT EXISTS '+TABLE+' (asof TEXT PRIMARY KEY,generated_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL)');
 await db.execute({sql:'INSERT INTO '+TABLE+' (asof,generated_at,payload_json,payload_sha256) VALUES(?,?,?,?) ON CONFLICT(asof) DO UPDATE SET generated_at=excluded.generated_at,payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256 WHERE excluded.generated_at>'+TABLE+'.generated_at',args:[data.asof,at,raw,sha]});
 const r=(await db.execute({sql:'SELECT generated_at,payload_json,payload_sha256 FROM '+TABLE+' WHERE asof=?',args:[data.asof]})).rows[0];
 check(r&&r.generated_at===at&&r.payload_json===raw&&r.payload_sha256===sha,'FORWARD_UI_READBACK');return {status:'PUBLISHED_READBACK_MATCH',asof:data.asof,writes:2};
}
async function main(){
 const read=async n=>JSON.parse(await readFile('output/forward/'+n+'.json','utf8'));
 const data=compact(await read('adaptive-market-report'),await read('report'),await read('symbol-report'));
 if(process.env.PUBLISH_FORWARD_UI!=='true'){console.log('BLUE_FORWARD_UI',JSON.stringify({status:'INSPECT_ONLY',asof:data.asof,writes:0}));return}
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 check(/^(libsql|https):\/\//.test(url)&&authToken,'FORWARD_UI_DB_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});try{console.log('BLUE_FORWARD_UI',JSON.stringify(await publish(db,data,{apply:true})));}finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('BLUE_FORWARD_UI_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

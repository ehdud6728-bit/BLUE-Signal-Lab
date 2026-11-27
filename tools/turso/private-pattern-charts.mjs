/** Bounded private chart evidence storage; no raw cases in logs/public artifacts. */
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const sha=s=>createHash('sha256').update(s).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code)};
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const date=s=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
export function validate(raw){
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=16*1024*1024,'CHART_BUNDLE_SIZE');const b=JSON.parse(raw);
 need(b.schema==='BLUE_PRIVATE_PATTERN_CHARTS_V1'&&date(b.asof)&&date(b.selection_asof)&&b.selection_asof<=b.asof&&hash(b.input_sha256?.source)&&hash(b.input_sha256?.snapshot)&&Array.isArray(b.cohorts)&&b.cohorts.length<=200&&b.cases&&typeof b.cases==='object'&&Object.keys(b.cases).length<=1200,'CHART_BUNDLE_INVALID');
 const used=new Set(),groups=new Set();
 for(const c of b.cohorts){
  const key=c.group+'/'+c.pattern;
  need(['rankings','candle_rankings','detail_rankings','turnover_rankings','market_rankings'].includes(c.group)&&/^[A-Z0-9_|]+$/.test(c.pattern)&&!groups.has(key)&&Array.isArray(c.selected)&&c.selected.length<=9,'CHART_COHORT_INVALID');groups.add(key);
  for(const r of c.selected){
   const v=b.cases[r.id];need(v&&hash(v.sha256)&&r.sha256===v.sha256&&typeof v.raw==='string'&&sha(v.raw)===v.sha256&&JSON.stringify(JSON.parse(v.raw))===JSON.stringify(v.payload),'CHART_CASE_HASH');
   const a=v.payload;need(r.id===a.id&&a.id===a.signal_day+'/'+a.code&&/^[0-9A-Z]{6}$/.test(a.code)&&date(a.signal_day)&&a.signal_day<=b.asof&&['HIT5','MISS5','INCOMPLETE'].includes(r.status)&&a.outcome?.status===r.status,'CHART_CASE_ID');
   let prev='';for(const z of [...a.pre_bars,...a.post_bars]){need(date(z.day)&&z.day>prev&&z.day<=b.asof&&['open','high','low','close'].every(k=>Number.isSafeInteger(z[k])&&z[k]>0)&&z.low<=Math.min(z.open,z.close)&&Math.max(z.open,z.close)<=z.high,'CHART_CASE_PRICE');prev=z.day;}
   if(a.post_bars.length<5)need(r.status==='INCOMPLETE','CHART_OUTCOME_INVALID');
   else {const p=a.post_bars.slice(0,5),entry=p[0].open,high=Math.max(...p.map(z=>z.high)),low=Math.min(...p.map(z=>z.low));
    need(r.status===(high*100>=entry*105?'HIT5':'MISS5')&&a.outcome.entry_day===p[0].day&&a.outcome.entry_open===entry&&a.outcome.high===high&&a.outcome.low===low&&a.outcome.close===p.at(-1).close,'CHART_OUTCOME_INVALID');
   }
   need(a.pre_bars.length>0&&a.pre_bars.at(-1).day===a.signal_day&&a.post_bars.every(z=>z.day>a.signal_day),'CHART_CASE_DATE');used.add(r.id);
  }
 }
 need(used.size===Object.keys(b.cases).length,'CHART_CASE_REFERENCES');return {b,id:sha(raw),count:used.size};
}
export async function persist(db,raw,{mode='inspect'}={}){
 const {b,id,count}=validate(raw);need(['inspect','apply'].includes(mode),'CHART_MODE_INVALID');
 if(mode==='inspect')return {status:'INSPECT_ONLY',asof:b.asof,cohorts:b.cohorts.length,cases:count,snapshot_id:id,writes:0};
 const q=(sql,args=[])=>db.execute({sql,args});
 await q('CREATE TABLE IF NOT EXISTS blue_private_pattern_charts_v1(snapshot_id TEXT PRIMARY KEY,asof TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL)');
 await q('INSERT INTO blue_private_pattern_charts_v1 VALUES(?,?,?,?) ON CONFLICT(snapshot_id) DO NOTHING',[id,b.asof,raw,id]);
 const row=(await q('SELECT payload_json,payload_sha256 FROM blue_private_pattern_charts_v1 WHERE snapshot_id=?',[id])).rows[0];
 need(row&&row.payload_json===raw&&row.payload_sha256===id,'CHART_READBACK_MISMATCH');
 return {status:'PRIVATE_EVIDENCE_STORED',asof:b.asof,cohorts:b.cohorts.length,cases:count,snapshot_id:id};
}
export async function read(db,id){
 need(hash(id),'CHART_SNAPSHOT_ID');const row=(await db.execute({sql:'SELECT payload_json,payload_sha256 FROM blue_private_pattern_charts_v1 WHERE snapshot_id=?',args:[id]})).rows[0];need(row&&row.payload_sha256===id&&sha(row.payload_json)===id,'CHART_READ_HASH');validate(row.payload_json);return row.payload_json;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;try{
  const [mode='inspect',input,out]=process.argv.slice(2);need(['inspect','apply','read'].includes(mode),'CHART_MODE_INVALID');
  if(mode!=='inspect'){const {createClient}=await import('@libsql/client');db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});}
  if(mode==='read'){need(typeof out==='string','CHART_OUTPUT_REQUIRED');const raw=await read(db,input);await writeFile(out,raw);console.log('BLUE_PRIVATE_PATTERN_CHARTS_READ_OK');}
  else console.log('BLUE_PRIVATE_PATTERN_CHARTS',JSON.stringify(await persist(db,await readFile(input,'utf8'),{mode})));
 }catch(e){console.error('BLUE_PRIVATE_PATTERN_CHARTS_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}finally{db?.close();}
}

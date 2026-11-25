/** Private immutable pages with an atomic verified head. No individual data in logs. */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const sha=s=>createHash('sha256').update(s).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code)};
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const bases=['ENV20','ENV20_LOWER_TOUCH'],groups=['JOINT','LONG_BULL_NOT_JOINT','LONG_BULL_RSI_GC'];
const key=(b,g,p)=>b+'/'+g+'/'+p;
export function validate(bundle){
 const raw=bundle.manifest,m=JSON.parse(raw);
 check(typeof raw==='string'&&Buffer.byteLength(raw)<=512*1024&&m.schema==='BLUE_PRIVATE_COMBINED_CASES_V1'&&day(m.asof)&&hash(m.source_sha256)&&hash(m.factors_sha256)&&m.page_size===20&&Array.isArray(m.groups)&&m.groups.length===6,'CASE_MANIFEST_INVALID');
 const pages=new Map();
 for(const p of bundle.pages){
  const k=key(p.base,p.group,p.page);
  check(bases.includes(p.base)&&groups.includes(p.group)&&Number.isSafeInteger(p.page)&&p.page>=0&&!pages.has(k)&&typeof p.payload==='string'&&Buffer.byteLength(p.payload)<=128*1024&&hash(p.sha256)&&sha(p.payload)===p.sha256,'CASE_PAGE_INVALID');
  pages.set(k,p);
 }
 let total=0;const seen=new Set();
 for(const g of m.groups){
  const k=g.base+'/'+g.group;
  check(bases.includes(g.base)&&groups.includes(g.group)&&!seen.has(k)&&Number.isSafeInteger(g.total)&&g.total>=0&&g.total<=8000&&Array.isArray(g.page_hashes)&&g.page_hashes.length===Math.ceil(g.total/20),'CASE_GROUP_INVALID');seen.add(k);total+=g.total;
  const identities=new Set();
  for(const [i,h] of g.page_hashes.entries()){
   const id=key(g.base,g.group,i),p=pages.get(id);
   check(p&&h===p.sha256,'CASE_PAGE_MISSING');
   const a=JSON.parse(p.payload);
   check(Array.isArray(a)&&a.length===Math.min(20,g.total-i*20),'CASE_PAGE_COUNT');
   for(const r of a){const id=r.day+'/'+r.code;check(day(r.day)&&r.day<=m.asof&&/^[0-9A-Z]{6}$/.test(r.code)&&!identities.has(id)&&hash(r.indicators?.record_sha256),'CASE_IDENTITY_INVALID');identities.add(id);}
   pages.delete(id);
  }
  for(const h of [1,3,5,10,20]){
   const v=g.horizons?.[h];
   check(v&&[v.complete,v.pending,v.missing].every(x=>Number.isSafeInteger(x)&&x>=0)&&v.complete+v.pending+v.missing===g.total,'CASE_COVERAGE_INVALID');
  }
 }
 check(!pages.size&&bundle.pages.length<=1200&&total<=24000,'CASE_BUNDLE_LIMIT');
 return {m,raw,id:sha(raw),total};
}
export async function persist(db,bundle,{mode='inspect'}={}){
 const {m,raw,id,total}=validate(bundle);
 check(['inspect','apply'].includes(mode),'CASE_MODE_INVALID');
 if(mode==='inspect')return {status:'INSPECT_ONLY',asof:m.asof,total_memberships:total,pages:bundle.pages.length,manifest_sha256:id,writes:0};
 const q=(sql,args=[])=>db.execute({sql,args});
 await q('CREATE TABLE IF NOT EXISTS blue_private_case_pages_v1(snapshot_id TEXT NOT NULL,base TEXT NOT NULL,cohort TEXT NOT NULL,page INTEGER NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL,PRIMARY KEY(snapshot_id,base,cohort,page))');
 await q('CREATE TABLE IF NOT EXISTS blue_private_case_heads_v1(asof TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL,manifest_json TEXT NOT NULL,manifest_sha256 TEXT NOT NULL)');
 // Write all pages first. A failed or interrupted run leaves the prior head unchanged.
 for(const p of bundle.pages){
  await q('INSERT INTO blue_private_case_pages_v1 VALUES(?,?,?,?,?,?) ON CONFLICT(snapshot_id,base,cohort,page) DO NOTHING',[id,p.base,p.group,p.page,p.payload,p.sha256]);
  const r=(await q('SELECT payload_json,payload_sha256 FROM blue_private_case_pages_v1 WHERE snapshot_id=? AND base=? AND cohort=? AND page=?',[id,p.base,p.group,p.page])).rows[0];
  check(r&&r.payload_json===p.payload&&r.payload_sha256===p.sha256,'CASE_PAGE_READBACK_MISMATCH');
 }
 await q('INSERT INTO blue_private_case_heads_v1 VALUES(?,?,?,?) ON CONFLICT(asof) DO UPDATE SET snapshot_id=excluded.snapshot_id,manifest_json=excluded.manifest_json,manifest_sha256=excluded.manifest_sha256',[m.asof,id,raw,id]);
 const r=(await q('SELECT snapshot_id,manifest_json,manifest_sha256 FROM blue_private_case_heads_v1 WHERE asof=?',[m.asof])).rows[0];
 check(r&&r.snapshot_id===id&&r.manifest_json===raw&&r.manifest_sha256===id,'CASE_HEAD_READBACK_MISMATCH');
 return {status:'READY',asof:m.asof,total_memberships:total,pages:bundle.pages.length,manifest_sha256:id};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{
  const [file,mode='inspect']=process.argv.slice(2),b=JSON.parse(await readFile(file,'utf8'));
  if(mode==='apply')db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  console.log('BLUE_PRIVATE_CASE_STORE',JSON.stringify(await persist(db,b,{mode})));
 }catch(e){console.error('BLUE_PRIVATE_CASE_STORE_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}finally{db?.close();}
}

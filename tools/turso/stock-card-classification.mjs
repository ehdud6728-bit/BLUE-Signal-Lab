/** Card metadata only, not signal/price research. Immutable day snapshots. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {reconstructVerifiedDay} from './research-v2-eod-export.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const need=(x,msg)=>{if(!x)throw Error(msg)};
const markets=['KOSPI','KOSDAQ'],code=/^[0-9A-Z]{6}$/,dayOk=d=>typeof d==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const clean=x=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=100&&!/[\u0000-\u001f]/.test(x);
const hash=/^[a-f0-9]{64}$/;
// Selected business/industry themes, not broad size/dividend/ESG index families.
// Preserve full original index name in every displayed membership record.
const labels=Object.freeze({
 'KRX BBIG 지수':'BBIG','KRX 2차전지 TOP 10 지수':'2차전지','KRX 바이오 TOP 10 지수':'바이오',
 'KRX 인터넷 TOP 10 지수':'인터넷','KRX 게임 TOP 10 지수':'게임','KRX 전기차 Top 15':'전기차',
 'KRX 반도체 Top 15':'반도체','KRX-Akros AI 전력인프라 지수':'AI 전력인프라',
 'KRX 코리아 소버린 AI 지수':'소버린 AI','KRX AI 반도체 지수':'AI 반도체',
 'KRX 조선 TOP10 지수':'조선','KRX 기술이전 바이오 지수':'기술이전 바이오',
 'KRX K-AI 반도체TOP2+ 지수':'AI 반도체','KRX K-AI 2차전지 지수':'2차전지',
 'KRX K-AI 바이오테크코스닥 지수':'바이오테크','KRX K-AI 방산TOP5+ 지수':'방산',
 'KRX 부동산리츠인프라 지수':'리츠·인프라','KRX 프라임 오피스 리츠 지수':'오피스 리츠'
});
export function prepareCardSnapshot(day,source,themes,eod,auditHash){
 need(dayOk(day)&&hash.test(auditHash)&&source.schema==='BLUE_DATED_CLASSIFICATION_SOURCE_V1'&&themes.schema==='BLUE_DATED_THEME_MEMBERS_V1'&&source.source==='KRX_VIA_PYKRX_1_2_9'&&themes.source===source.source&&source.writes===0&&themes.writes===0,'CARD_SOURCE_SCHEMA');
 need(source.requested_days.includes(day)&&themes.requested_days.includes(day),'CARD_SOURCE_DAY');
 const industry=new Map(),rows=Object.create(null),seen=new Set(),counts={};
 for(const market of markets){
  const cov=source.industry_coverage.filter(x=>x.day===day&&x.market===market);
  const list=source.industry_rows.filter(x=>x.day===day&&x.market===market);
  need(cov.length===1&&cov[0].status==='RECEIVED_NOT_PRICE_VERIFIED'&&cov[0].rows===list.length&&list.length>=400&&list.length<=5000&&sha(canonical(list))===cov[0].sha256,'CARD_INDUSTRY_HASH');
  need(cov[0].classified===list.filter(r=>r.industry!==null).length,'CARD_INDUSTRY_COUNT');
  for(const r of list){
   need(code.test(r.code)&&!industry.has(r.code)&&clean(r.name)&&(r.industry===null||clean(r.industry))&&Number.isSafeInteger(r.close)&&r.close>=0,'CARD_INDUSTRY_ROW');
   industry.set(r.code,r);
  }
 }
 for(const r of eod){
  need(r.trade_day===day&&markets.includes(r.market)&&code.test(r.code)&&!seen.has(r.code)&&/^[1-9][0-9]*$/.test(String(r.close)),'CARD_EOD_ROW');
  seen.add(r.code);const c=industry.get(r.code),m=counts[r.market]??={eligible:0,matched:0,classified:0};m.eligible++;
  if(!c)continue;
  need(c.market===r.market&&BigInt(c.close)===BigInt(r.close),'CARD_EOD_IDENTITY_MISMATCH');
  m.matched++;if(c.industry)m.classified++;
  rows[r.code]={market:c.market,name:c.name,industry:c.industry,close:c.close,themes:[]};
 }
 for(const market of markets)need(counts[market]?.eligible>=400&&5*counts[market].matched>=4*counts[market].eligible,'CARD_COVERAGE_TOO_LOW');
 const catalogs=source.theme_catalogs.filter(x=>x.day===day),groups=themes.groups.filter(x=>x.day===day),coverage=themes.coverage.filter(x=>x.day===day);
 need(catalogs.length===1&&coverage.length===1&&groups.length===coverage[0].catalog_count&&groups.length>0&&groups.length<=100,'CARD_THEME_CATALOG');
 const groupIds=groups.map(x=>x.index_code).sort();
 need(new Set(groupIds).size===groupIds.length&&sha(canonical(groupIds))===coverage[0].catalog_sha256,'CARD_THEME_IDENTITY');
 // The frozen industry run predates the alphanumeric theme-code fix.
 // Its catalog was unavailable; the later separate constituent run has its own catalog digest.
 const catalogChecked=catalogs[0].status==='RECEIVED_CATALOG_ONLY';
 if(catalogChecked){
  const ids=catalogs[0].indices.map(x=>x.index_code).sort();
  need(sha(canonical(catalogs[0].indices))===catalogs[0].sha256&&JSON.stringify(ids)===JSON.stringify(groupIds),'CARD_THEME_CATALOG_MISMATCH');
 }else need(catalogs[0].status==='UNAVAILABLE'&&catalogs[0].indices.length===0,'CARD_THEME_CATALOG_STATUS');
 const byIndex=new Map(catalogs[0].indices.map(x=>[x.index_code,x.name]));
 let available=0,links=0;
 for(const g of groups){
  need(/^[0-9A-Za-z]{4,12}$/.test(g.index_code)&&Array.isArray(g.members),'CARD_THEME_GROUP');
  if(g.status==='UNAVAILABLE'){need(g.members.length===0,'CARD_THEME_UNAVAILABLE');continue}
  need(g.status==='REQUESTED_DATE_MEMBERS_UNVERIFIED'&&clean(g.name)&&(!catalogChecked||byIndex.get(g.index_code)===g.name)&&g.members.length===g.member_count&&g.members.length>0&&g.members.length<=3000&&new Set(g.members).size===g.members.length&&sha(canonical(g.members))===g.sha256,'CARD_THEME_HASH');
  available++;
  for(const c of g.members){need(code.test(c)&&industry.has(c),'CARD_THEME_MEMBER_IDENTITY');const row=rows[c],tag=Object.hasOwn(labels,g.name)?labels[g.name]:null;if(row&&tag){row.themes.push({label:tag,index:g.name});links++}}
 }
 need(available===coverage[0].members_received&&available>0,'CARD_THEME_COVERAGE');
 for(const row of Object.values(rows))row.themes.sort((a,b)=>a.label.localeCompare(b.label)||a.index.localeCompare(b.index));
 return {schema:'BLUE_STOCK_CARD_CLASSIFICATION_V1',day,eod_sha256:auditHash,industry_source:'KRX_VIA_PYKRX_1_2_9',theme_status:'REQUESTED_DATE_MEMBERS_UNVERIFIED',theme_coverage:{available,total:groups.length,catalog_crosscheck:catalogChecked},coverage:counts,links,rows};
}
async function main(){
 const mode=process.argv[2],kind=process.argv[3];
 need(['inspect','publish'].includes(mode)&&['seed','fresh'].includes(kind),'CARD_MODE');
 const path='output/card-classification';
 const [s,t]=await Promise.all([readFile(path+'/source.json'),readFile(path+'/theme-members.json')]);
 if(kind==='seed')need(sha(s)==='aba6c30280ab4f8aa580388ba91efc0073e66ca502438b8d6610ff02e577c170'&&sha(t)==='67dacdf2a1880e8030945f8effea99c68847a5864a1b6955ab6ec93c53d46a5f','CARD_FROZEN_SOURCE_HASH');
 const source=JSON.parse(s),themes=JSON.parse(t),days=source.requested_days;
 need(Array.isArray(days)&&days.length===(kind==='seed'?9:1)&&days.every(dayOk)&&new Set(days).size===days.length&&JSON.stringify(days)===JSON.stringify(themes.requested_days),'CARD_DAYS');
 if(kind==='fresh')need(days[0]===process.argv[4],'CARD_REQUEST_DAY');
 const {createClient}=await import('@libsql/client');
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 const query=async(sql,args=[])=> (await db.execute({sql,args})).rows;
 try{
  const prepared=[];
  for(const day of days){
   const a=await query('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
   need(a.length===1,'CARD_EOD_AUDIT_MISSING');
   const eod=await query('SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[day]);
   reconstructVerifiedDay(day,a[0],eod);
   const p=prepareCardSnapshot(day,source,themes,eod,String(a[0].day_sha256));
   const payload=canonical(p);need(Buffer.byteLength(payload)<1500000,'CARD_PAYLOAD_SIZE');
   prepared.push({day,payload,digest:sha(payload),summary:{day,stocks:Object.keys(p.rows).length,coverage:p.coverage,theme_coverage:p.theme_coverage,links:p.links,sha256:sha(payload)}});
  }
  const table=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_stock_card_classification_v1'");
  if(table.length)for(const p of prepared){
   const old=await query('SELECT payload_sha256,payload_json FROM blue_stock_card_classification_v1 WHERE trade_day=?',[p.day]);
   need(!old.length||old.length===1&&old[0].payload_sha256===p.digest&&old[0].payload_json===p.payload,'CARD_EXISTING_SNAPSHOT_CONFLICT');
  }
  if(mode==='publish'){
   await db.execute('CREATE TABLE IF NOT EXISTS blue_stock_card_classification_v1 (trade_day TEXT PRIMARY KEY,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL)');
   await db.batch(prepared.map(p=>({sql:'INSERT INTO blue_stock_card_classification_v1 VALUES(?,?,?) ON CONFLICT(trade_day) DO NOTHING',args:[p.day,p.payload,p.digest]})),'write');
   for(const p of prepared){
    const r=await query('SELECT payload_sha256,payload_json FROM blue_stock_card_classification_v1 WHERE trade_day=?',[p.day]);
    need(r.length===1&&r[0].payload_sha256===p.digest&&r[0].payload_json===p.payload,'CARD_READBACK_MISMATCH');
   }
  }
  const report={status:mode==='publish'?'PUBLISHED_READBACK_MATCH':'INSPECT_ONLY',kind,days:prepared.map(p=>p.summary),writes:mode==='publish'?'CLASSIFICATION_TABLE_ONLY':0,limitations:['Theme membership requested date, historical identity not independently confirmed.','Selected KRX theme indices only, not full market theme universe.']};
  await mkdir(path+'/report',{recursive:true});await writeFile(path+'/report/report.json',JSON.stringify(report,null,2)+'\n');
  console.log('BLUE_CARD_CLASSIFICATION',JSON.stringify(report));
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('BLUE_CARD_CLASSIFICATION_FAILED',/^(CARD_|V2_REPLAY_)[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

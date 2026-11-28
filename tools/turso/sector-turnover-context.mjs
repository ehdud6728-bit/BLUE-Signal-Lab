// Read-only gross trading turnover, not net inflow. All amounts in KRW.
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const DAYS=['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13','2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23','2026-11-24','2026-11-25','2026-11-26'],MARKETS=['KOSPI','KOSDAQ'];
const sha=x=>createHash('sha256').update(x).digest('hex'),need=(x,m)=>{if(!x)throw Error(m)},key=(...x)=>JSON.stringify(x),pct=(a,b)=>b>0n?100*Number(a)/Number(b):null;
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const pos=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x);
function classifications(sources){
 const rows=new Map(),seen=new Set();
 for(const s of sources){
  need(s.writes===0,'CLASSIFICATION_SCHEMA');let count=0;
  for(const a of s.industry_coverage){
   const k=key(a.day,a.market),list=s.industry_rows.filter(x=>x.day===a.day&&x.market===a.market);
   need(DAYS.includes(a.day)&&MARKETS.includes(a.market)&&!seen.has(k)&&a.status==='RECEIVED_NOT_PRICE_VERIFIED'&&list.length===a.rows&&sha(canonical(list))===a.sha256,'CLASSIFICATION_COVERAGE_HASH');
   seen.add(k);count+=list.length;
   for(const x of list){const z=key(x.day,x.code);need(!rows.has(z)&&/^[0-9A-Z]{6}$/.test(x.code)&&Number.isSafeInteger(x.close)&&x.close>=0&&(x.industry===null||typeof x.industry==='string'&&x.industry.trim()),'CLASSIFICATION_ROW');rows.set(z,x)}
  }
  need(count===s.industry_rows.length,'CLASSIFICATION_EXTRA');
 }
 need(seen.size===28,'CLASSIFICATION_MISSING');return rows;
}
function aggregateDay(day,records,map){
 const seen=new Set();
 for(const r of records){need(r.trade_day===day&&MARKETS.includes(r.market)&&/^[0-9A-Z]{6}$/.test(r.code)&&!seen.has(r.code)&&pos(r.amount)&&pos(r.close),'EOD_ROW');seen.add(r.code)}
 return MARKETS.map(market=>{
  const a=records.filter(r=>r.market===market),total=a.reduce((n,r)=>n+BigInt(r.amount),0n),groups=new Map();
  let matched=0,matchAmount=0n,missing=0,unclassified=0,priceMismatch=0,marketMismatch=0;
  for(const r of a){
   const c=map.get(key(day,r.code));
   if(!c){missing++;continue}if(c.market!==market){marketMismatch++;continue}if(BigInt(c.close)!==BigInt(r.close)){priceMismatch++;continue}if(!c.industry){unclassified++;continue}
   const g=groups.get(c.industry)||{n:0,amount:0n};g.n++;g.amount+=BigInt(r.amount);groups.set(c.industry,g);matched++;matchAmount+=BigInt(r.amount);
  }
  need([...groups.values()].reduce((n,g)=>n+g.amount,0n)===matchAmount&&[...groups.values()].reduce((n,g)=>n+g.n,0)===matched&&matched+missing+unclassified+priceMismatch+marketMismatch===a.length,'PARTITION');
  return {day,market,universe:a.length,total_amount_krw:String(total),matched,matched_amount_krw:String(matchAmount),missing,unclassified,price_mismatch:priceMismatch,market_mismatch:marketMismatch,coverage_count_pct:a.length?100*matched/a.length:null,coverage_amount_pct:pct(matchAmount,total),status:a.length&&total>0n&&!priceMismatch&&!marketMismatch&&5*matched>=4*a.length&&5n*matchAmount>=4n*total?'USABLE':'UNKNOWN',groups:[...groups].map(([industry,g])=>({industry,n:g.n,amount_krw:String(g.amount),share_pct:pct(g.amount,total)}))};
 });
}
function context(daily){
 const lookup=new Map(daily.map(d=>[key(d.day,d.market),d]));need(lookup.size===daily.length,'DAY_DUPLICATE');
 return DAYS.slice(5).flatMap((day,i)=>MARKETS.flatMap(market=>{
  const cur=lookup.get(key(day,market));need(cur,'MISSING_DAY');
  const prior=DAYS.slice(i,i+5).map(d=>lookup.get(key(d,market)));
  return cur.groups.map(g=>{
   const p=prior.map(d=>d?.groups.find(x=>x.industry===g.industry));
   const ok=cur.status==='USABLE'&&g.n>=10&&prior.every(d=>d?.status==='USABLE')&&p.every(x=>x&&x.n>=10&&x.share_pct>0);
   const avg=ok?p.reduce((n,x)=>n+x.share_pct,0)/5:null;
   const ratio=ok?5*Number(BigInt(g.amount_krw))/Number(p.reduce((n,x)=>n+BigInt(x.amount_krw),0n)):null;
   return {day,market,industry:g.industry,stocks:g.n,amount_krw:g.amount_krw,market_share_pct:g.share_pct,prior5_share_mean_pct:avg,share_change_pp:ok?g.share_pct-avg:null,share_ratio:ok?g.share_pct/avg:null,amount_ratio:ratio,status:ok?'DESCRIPTIVE_ONLY':'UNKNOWN',concentration:ok?(ratio>=1.5&&g.share_pct/avg>=1.2?'EXPANSION_WATCH':'OTHER'):null};
  });
 }));
}
function selfTest(){
 let n=0;const t=x=>{need(x,'TEST');n++},d=DAYS[5],rec=(code,market,amount)=>({trade_day:d,code,market,amount:String(amount),close:'100'}),a=[rec('000001','KOSPI',80),rec('000002','KOSPI',20),rec('000003','KOSDAQ',100)],m=new Map([[key(d,'000001'),{market:'KOSPI',close:100,industry:'A'}],[key(d,'000003'),{market:'KOSDAQ',close:100,industry:'B'}]]);
 let x=aggregateDay(d,a,m)[0];t(x.groups[0].share_pct===80&&x.missing===1&&x.status==='UNKNOWN');
 m.set(key(d,'000002'),{market:'KOSPI',close:100,industry:'A'});x=aggregateDay(d,a,m)[0];t(x.status==='USABLE'&&x.groups[0].amount_krw==='100');
 m.get(key(d,'000002')).close=101;t(aggregateDay(d,a,m)[0].price_mismatch===1&&aggregateDay(d,a,m)[0].status==='UNKNOWN');
 m.get(key(d,'000002')).close=100;m.get(key(d,'000002')).market='KOSDAQ';t(aggregateDay(d,a,m)[0].market_mismatch===1);
 let err=false;try{aggregateDay(d,[...a,a[0]],m)}catch{err=true}t(err);
 const f=DAYS.flatMap((day,i)=>MARKETS.map(market=>({day,market,status:'USABLE',groups:[{industry:'A',n:10,amount_krw:i===5?'200':'100',share_pct:i===5?20:10}]})));
 const y=context(f);t(y[0].share_change_pp===10&&y[0].amount_ratio===2&&y[0].concentration==='EXPANSION_WATCH');
 f[0].status='UNKNOWN';t(context(f)[0].status==='UNKNOWN'&&context(f)[0].share_change_pp===null);
 f[0].status='USABLE';f[0].groups[0].n=9;t(context(f)[0].status==='UNKNOWN');
 const future=JSON.parse(JSON.stringify(f));future.at(-1).groups[0].share_pct=999;t(JSON.stringify(context(future)[0])===JSON.stringify(context(f)[0]));
 return n;
}
async function main(){
 const files=[['output/turnover/classification/source.json','aba6c30280ab4f8aa580388ba91efc0073e66ca502438b8d6610ff02e577c170'],['output/turnover/context/market-context.json','cc40c9fb40b08c6831662638dc69f74364e888f94ab6a74210c0478f7771e134']],sources=[];
 for(const [file,hash] of files){const raw=await readFile(file);need(sha(raw)===hash,'FROZEN_CLASSIFICATION_FILE_MISMATCH');sources.push(JSON.parse(raw))}
 const mapping=classifications(sources),daily=[],proof=[];
 for(const day of DAYS){
  const root='output/global-preflight/private-eod/'+day,man=JSON.parse(await readFile(root+'/manifest.json','utf8')),raw=await readFile(root+'/daily.jsonl');
  need(man.origin==='IMMUTABLE_TURSO_KRX_EOD_READBACK_HASH_EQUAL'&&man.start_day===day&&man.end_day===day&&man.days.length===1&&man.days[0].day===day&&sha(raw)===man.data_sha256&&man.data_sha256===man.days[0].sha256,'EOD_HASH');
  const rows=raw.toString('utf8').trimEnd().split('\n').map(JSON.parse);need(rows.length===man.total_rows&&rows.length===man.days[0].rows,'EOD_COUNT');
  proof.push({day,rows:rows.length,sha256:man.data_sha256});daily.push(...aggregateDay(day,rows,mapping));
 }
 const result={schema:'BLUE_SECTOR_TURNOVER_CONTEXT_V1',primary_horizon:10,classification_hashes:files.map(x=>x[1]),proof,daily,context:context(daily),writes:0,limitations:['Gross turnover, not net buying; denominator is verified eligible EOD universe, not all listings.','Requested-date industry classification not independently verified. Any close/market mismatch blocks that market-day.','>=80% matched count AND turnover, >=10 stocks per group each day; prior five sessions, 1.5x gross turnover and 1.2x share exploratory thresholds.','No outcomes or leader predictions; no promotion.']};
 await mkdir('output/turnover/public',{recursive:true});await writeFile('output/turnover/public/report.json',JSON.stringify(result)+'\n');
 console.log('BLUE_SECTOR_TURNOVER_RESULT',JSON.stringify({days:proof.length,markets:daily.length,usable:daily.filter(x=>x.status==='USABLE').length,context:result.context.length,usable_context:result.context.filter(x=>x.status==='DESCRIPTIVE_ONLY').length,writes:0}));
}
if(process.argv.includes('--test'))console.log('BLUE_SECTOR_TURNOVER_TESTS',selfTest());
else main().catch(e=>{console.error('BLUE_SECTOR_TURNOVER_FAILED',/^[A-Z_]+$/.test(e.message)?e.message:'SANITIZED');process.exitCode=1});

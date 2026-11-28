import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {prepareCardSnapshot} from '../tools/turso/stock-card-classification.mjs';
const day='2026-11-26',digest='a'.repeat(64);
const canonical=x=>Array.isArray(x)?'['+x.map(canonical).join(',')+']':x!==null&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}':JSON.stringify(x);
const sha=x=>createHash('sha256').update(canonical(x)).digest('hex');
function fixture(){
 const industry_rows=['KOSPI','KOSDAQ'].flatMap((market,j)=>Array.from({length:400},(_,i)=>({day,market,code:String(100000+j*1000+i),name:'기업 '+i,industry:i===1?null:'전기·전자',close:100})));
 const eod=industry_rows.map(r=>({trade_day:day,market:r.market,code:r.code,close:'100'}));
 const industry_coverage=['KOSPI','KOSDAQ'].map(market=>{const a=industry_rows.filter(r=>r.market===market);return {day,market,status:'RECEIVED_NOT_PRICE_VERIFIED',rows:a.length,classified:399,sha256:sha(a)}});
 const indices=[{index_code:'5412',name:'KRX 2차전지 TOP 10 지수'},{index_code:'5418',name:'KRX 300 기후변화지수'},{index_code:'G004',name:'KRX/S&P 탄소효율 그린뉴딜지수'}];
 const common={source:'KRX_VIA_PYKRX_1_2_9',requested_days:[day],writes:0};
 const source={...common,schema:'BLUE_DATED_CLASSIFICATION_SOURCE_V1',industry_rows,industry_coverage,theme_catalogs:[{day,status:'RECEIVED_CATALOG_ONLY',indices,sha256:sha(indices)}]};
 const members=['100000','101000'];
 const groups=indices.map((g,i)=>i===2?{day,...g,status:'UNAVAILABLE',members:[]}:{day,...g,status:'REQUESTED_DATE_MEMBERS_UNVERIFIED',members,member_count:2,sha256:sha(members)});
 const themes={...common,schema:'BLUE_DATED_THEME_MEMBERS_V1',groups,coverage:[{day,catalog_count:3,members_received:2,catalog_sha256:sha(indices.map(x=>x.index_code))}]};
 return {source,themes,eod};
}
test('snapshot preserves verified industry and economic theme index name only',()=>{
 const {source,themes,eod}=fixture(),x=prepareCardSnapshot(day,source,themes,eod,digest);
 assert.equal(Object.keys(x.rows).length,800);
 assert.deepEqual(x.rows['100000'].themes,[{label:'2차전지',index:'KRX 2차전지 TOP 10 지수'}]);
 assert.equal(x.rows['100001'].industry,null);
 assert.deepEqual(x.rows['100001'].themes,[]);
 assert.deepEqual(x.theme_coverage,{available:2,total:3,catalog_crosscheck:true});
});
test('original seed catalog unavailable remains explicitly unverified',()=>{
 const {source,themes,eod}=fixture();source.theme_catalogs=[{day,status:'UNAVAILABLE',indices:[]}];
 assert.equal(prepareCardSnapshot(day,source,themes,eod,digest).theme_coverage.catalog_crosscheck,false);
});
test('reject mismatch, corrupted members, and cross-catalog identity',()=>{
 for(const [modify,error] of [
  [f=>{f.eod[0].close='101'},/CARD_EOD_IDENTITY_MISMATCH/],
  [f=>{f.source.industry_rows[0].industry='금융'},/CARD_INDUSTRY_HASH/],
  [f=>{f.themes.groups[0].members=['100000','100001']},/CARD_THEME_HASH/],
  [f=>{f.themes.groups[0].name='KRX 전기차 Top 15'},/CARD_THEME_HASH/],
  [f=>{f.themes.coverage[0].catalog_sha256='b'.repeat(64)},/CARD_THEME_IDENTITY/]
 ]){const f=fixture();modify(f);assert.throws(()=>prepareCardSnapshot(day,f.source,f.themes,f.eod,digest),error)}
});

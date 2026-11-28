/** Bounded, read-only enrichment of the returned page. Missing metadata must
 * never change the search result, ranking or count. No future classification.
 */
type DB={execute:(statement:{sql:string;args:string[]})=>Promise<{rows:Record<string,unknown>[]} >};
type Input={code:string;name?:unknown;day?:string;close_price?:number;extras:Record<string,unknown>};
const CODE=/^[0-9A-Z]{6}$/,DAY=/^20\d{2}-\d{2}-\d{2}$/;
const label=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=100&&!/[\u0000-\u001f]/.test(v);
export async function attachStockCardClassification(db:DB,items:Input[],referenceDay?:string){
 if(!items.length)return;
 // Do not trust upstream custom extras as an official classification.
 for(const r of items)delete r.extras.stock_card_classification;
 try{
  const table=await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name='blue_stock_card_classification_v1'",args:[]});
  if(!table.rows.length)return;
  const requested=[...new Map(items.flatMap(r=>{
   const day=referenceDay??r.day;
   return day&&DAY.test(day)&&CODE.test(r.code)?[[day+':'+r.code,{day,code:r.code}] as const]:[];
  })).values()];
  const found=new Map<string,{asof:string;row:any;coverage:any}>();
  for(let i=0;i<requested.length;i+=40){
   const batch=requested.slice(i,i+40);
   const result=await db.execute({sql:`WITH requested(day,code) AS (VALUES ${batch.map(()=>'(?,?)').join(',')})
    SELECT r.day AS requested_day,r.code,s.trade_day AS asof,
      json_extract(s.payload_json,'$.rows."'||r.code||'"') AS row_json,
      json_extract(s.payload_json,'$.theme_coverage') AS coverage_json
    FROM requested r JOIN blue_stock_card_classification_v1 s ON s.trade_day=(
      SELECT MAX(trade_day) FROM blue_stock_card_classification_v1
      WHERE trade_day<=r.day AND trade_day>=date(r.day,'-7 days'))
    JOIN blue_eod_ingest_audit_v1 a ON a.trade_day=s.trade_day
    WHERE json_extract(s.payload_json,'$.schema')='BLUE_STOCK_CARD_CLASSIFICATION_V1'
      AND json_extract(s.payload_json,'$.day')=s.trade_day
      AND json_extract(s.payload_json,'$.eod_sha256')=a.day_sha256
      AND json_extract(s.payload_json,'$.industry_source')='KRX_VIA_PYKRX_1_2_9'
      AND json_extract(s.payload_json,'$.theme_status')='REQUESTED_DATE_MEMBERS_UNVERIFIED'`,
      args:batch.flatMap(x=>[x.day,x.code])});
   for(const r of result.rows){
    if(typeof r.row_json!=='string'||typeof r.coverage_json!=='string'||typeof r.asof!=='string'||typeof r.requested_day!=='string'||typeof r.code!=='string')continue;
    const row=JSON.parse(r.row_json),coverage=JSON.parse(r.coverage_json);
    if(!DAY.test(r.asof)||r.asof>r.requested_day||!row||!['KOSPI','KOSDAQ'].includes(row.market)||!label(row.name)||
      !(row.industry===null||label(row.industry))||!Number.isSafeInteger(row.close)||row.close<=0||
      !Array.isArray(row.themes)||row.themes.length>40||!row.themes.every((t:any)=>t&&label(t.label)&&label(t.index))||
      !coverage||!Number.isSafeInteger(coverage.available)||!Number.isSafeInteger(coverage.total)||coverage.available<1||coverage.total<coverage.available||coverage.total>100)continue;
    found.set(r.requested_day+':'+r.code,{asof:r.asof,row,coverage});
   }
  }
  for(const item of items){
   const d=referenceDay??item.day,x=found.get(d+':'+item.code);
   if(!x)continue;
   if(typeof item.name==='string'&&item.name.trim()&&item.name!==item.code&&item.name.trim()!==x.row.name)continue;
   if(typeof item.extras.market==='string'&&['KOSPI','KOSDAQ'].includes(item.extras.market)&&item.extras.market!==x.row.market)continue;
   if(!referenceDay&&d===x.asof&&typeof item.close_price==='number'&&item.close_price!==x.row.close)continue;
   item.extras.stock_card_classification={asof:x.asof,market:x.row.market,industry:x.row.industry,themes:x.row.themes,theme_coverage:x.coverage,source:'KRX_DATED_REFERENCE'};
  }
 }catch{/* Metadata unavailable: keep the entire unmodified search result. */}
}

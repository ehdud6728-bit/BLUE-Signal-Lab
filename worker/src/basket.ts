/** BLUE R1.5 AI basket: independent, research-only AI candidate review.
 * Existing EOD/live/AI tables and Stock-Hunter algorithms are never updated.
 * Caller may not provide stocks, symbols, prompts or model names.
 */
export interface BasketEnv { DB: D1Database; GEMINI_API_KEY?:string; GEMINI_MODEL?:string; }
type Candidate={code:string;name:string;day:string;close_price:number;signals:string[];
  rsi:number|null;volume_ratio20:number|null;amount_ratio20:number|null;
  supply_distance_pct:number|null;gc:string[]};
const MODEL_ALLOW=new Set(['gemini-3.5-flash-lite','gemini-3.1-flash-lite']);
const modelName=(s?:string)=>s&&MODEL_ALLOW.has(s)?s:'gemini-3.5-flash-lite';
const MAX_CANDIDATES=24,MAX_DAILY_CALLS=8;
const send=(obj:unknown,code=200)=>new Response(JSON.stringify(obj),{status:code,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
}});
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const finite=(n:unknown):number|null=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))?Number(n):null;
const safeString=(s:unknown,n=100)=>String(s??'').slice(0,n);
const safeExtra=(raw:string)=>{try{const o=JSON.parse(raw||'{}');return o&&typeof o==='object'&&!Array.isArray(o)?o:{};}catch{return {};}};
const dateDays=(a:string,b:string)=>Math.floor((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
export function prefilter(rows:Candidate[]):Candidate[]{
 // Ranking is a DETERMINISTIC research prefilter, not the AI's recommendation.
 // The AI considers a bounded, auditable shortlist.
 const rank=(x:Candidate)=>x.signals.length*4+x.gc.length*2+
   Math.min(4,Math.max(0,(x.volume_ratio20??1)-1))+
   Math.min(4,Math.max(0,(x.amount_ratio20??1)-1));
 return [...rows].sort((a,b)=>rank(b)-rank(a)||a.code.localeCompare(b.code)).slice(0,MAX_CANDIDATES);
}
async function trustedCandidates(db:D1Database){
 const today=todayKST();
 const run=await db.prepare(`SELECT run_id,latest_price_date FROM runs
   WHERE is_demo=0 AND latest_price_date<?
   ORDER BY latest_price_date DESC,created_at DESC,run_id DESC LIMIT 1`).bind(today).first<{run_id:string|number;latest_price_date:string}>();
 if(!run?.latest_price_date)return {status:'NO_VERIFIED_EOD',asof:null,run_id:null,candidates:[] as Candidate[]};
 const days=dateDays(today,run.latest_price_date);
 if(days<1||days>7)return {status:'STALE_EOD',asof:run.latest_price_date,run_id:run.run_id,candidates:[] as Candidate[]};
 const data=await db.prepare(`SELECT code,day,signal_names,close_price,supply_distance_pct,extras_json
  FROM signals WHERE run_id=? AND day=? ORDER BY code LIMIT 500`)
  .bind(run.run_id,run.latest_price_date).all<{code:string;day:string;signal_names:string;close_price:number|null;supply_distance_pct:number|null;extras_json:string}>();
 const list:Candidate[]=[];
 for(const r of data.results){
  if(!/^\d{6}$/.test(r.code)||r.day!==run.latest_price_date||!(r.close_price&&r.close_price>0))continue;
  const e=safeExtra(r.extras_json);
  const gc=['rsi_gc','slow_14_3_3_gc','slow_12_5_5_gc','slow_20_12_12_gc','macd_gc'].filter(k=>e[k]===true||String(e[k]).toLowerCase()==='true'||e[k]===1);
  list.push({code:r.code,name:safeString(e.name||e.Name||r.code,42),day:r.day,close_price:r.close_price,
   signals:String(r.signal_names||'').split(',').filter(Boolean).slice(0,18),rsi:finite(e.rsi),
   volume_ratio20:finite(e.volume_ratio20),amount_ratio20:finite(e.amount_ratio20),
   supply_distance_pct:finite(r.supply_distance_pct),gc});
 }
 if(!list.length)return {status:'EMPTY_EOD',asof:run.latest_price_date,run_id:run.run_id,candidates:[] as Candidate[]};
 return {status:'READY',asof:run.latest_price_date,run_id:run.run_id,candidates:prefilter(list)};
}
export function checkedSelection(obj:unknown, shortlist:Candidate[]){
 let arr:unknown=[];
 if(obj&&typeof obj==='object'&&!Array.isArray(obj))arr=(obj as Record<string,unknown>).picks;
 if(!Array.isArray(arr))return [];
 const allowed=new Map(shortlist.map(x=>[x.code,x]));const used=new Set<string>();
 return arr.slice(0,12).flatMap(x=>{
  if(!x||typeof x!=='object')return [];
  const p=x as Record<string,unknown>,code=safeString(p.code,6),src=allowed.get(code);
  if(!src||used.has(code)||!/^\d{6}$/.test(code))return [];
  used.add(code);
  return [{code,name:src.name,day:src.day,close_price:src.close_price,signals:src.signals,
    reason:safeString(p.reason,160),risk:safeString(p.risk,160),watch:safeString(p.watch,160),
    source:'AI' as const,verified_tick:false}];
 }).slice(0,6);
}
export async function handleBasketAi(req:Request,env:BasketEnv):Promise<Response>{
 if(req.method!=='GET'&&req.method!=='POST')return send({error:'METHOD_NOT_ALLOWED'},405);
 if(!env.DB)return send({error:'D1_UNAVAILABLE'},503);
 let trusted:Awaited<ReturnType<typeof trustedCandidates>>;
 try{trusted=await trustedCandidates(env.DB);}catch{return send({error:'EOD_STORAGE_UNAVAILABLE'},503);}
 if(trusted.status!=='READY')return send({status:trusted.status,asof:trusted.asof,items:[],message:'검증된 최근 종가 후보가 준비되지 않았습니다.'},200);
 const model=modelName(env.GEMINI_MODEL),cacheKey=`R15:${trusted.run_id}:${trusted.asof}:${model}`;
 try{
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blue_basket_ai_cache_r15
    (cache_key TEXT PRIMARY KEY,asof TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT)`).run();
  let cached=await env.DB.prepare('SELECT status,payload_json,created_at FROM blue_basket_ai_cache_r15 WHERE cache_key=?')
   .bind(cacheKey).first<{status:string;payload_json:string|null;created_at:string}>();
  if(cached?.status==='READY'&&cached.payload_json){try{return send({...JSON.parse(cached.payload_json),cached:true});}catch{/* refresh corrupt cache */}}
  if(req.method==='GET')return send({status:'NOT_CACHED',asof:trusted.asof,items:[],message:'AI 후보 만들기 버튼을 누르면 검증된 종가에서 후보를 분석합니다.'});
  if(!env.GEMINI_API_KEY)return send({error:'GEMINI_NOT_CONFIGURED',message:'Gemini API 키가 Worker에 등록되지 않았습니다.'},503);
  const now=new Date().toISOString();
  if(cached?.status==='PENDING'&&Date.now()-Date.parse(cached.created_at)<180000)return send({status:'PENDING',message:'AI 후보를 분석 중입니다.'},202);
  const count=await env.DB.prepare(`SELECT COUNT(*) AS n FROM blue_basket_ai_cache_r15
   WHERE created_at>=? AND created_at<?`).bind(new Date(Date.parse(todayKST()+'T00:00:00+09:00')).toISOString(),new Date(Date.parse(todayKST()+'T00:00:00+09:00')+86400000).toISOString()).first<{n:number}>();
  if((count?.n||0)>=MAX_DAILY_CALLS&&!cached)return send({error:'AI_DAILY_LIMIT',message:'당일 AI 요청 상한에 도달했습니다.'},429);
  // Only the first request claims the cache; no arbitrary prompts or user-supplied candidate facts.
  const claim=await env.DB.prepare(`INSERT INTO blue_basket_ai_cache_r15(cache_key,asof,created_at,status,payload_json)
   VALUES(?,?,?,'PENDING',NULL) ON CONFLICT(cache_key) DO UPDATE SET
   created_at=excluded.created_at,status='PENDING',payload_json=NULL
   WHERE status!='READY' AND created_at<?`).bind(cacheKey,trusted.asof,now,new Date(Date.now()-180000).toISOString()).run();
  if(!claim.meta.changes)return send({status:'PENDING',asof:trusted.asof,message:'AI 후보를 분석 중입니다.'},202);
  const prompt=`당신은 BLUE Signal Lab의 연구용 종목 관찰 후보 검토자입니다. 투자 권유·매수 추천이 아닙니다.
아래의 과거 확정 일봉 관찰 사실만 사용합니다. 신호 빈도는 미래 수익을 입증하지 않습니다.
검증되지 않은 뉴스, 주문 가능 가격, 성공 확률, 차트 돌파 확정, KRX/NXT 실시간 체결을 꾸며내지 마세요.
직접 제시한 후보에서만 최대 5개를 선택하거나 전부 보류해도 됩니다.
선택 이유에는 서로 다른 관찰 근거, 반대 시나리오와 다음 관찰 조건을 써주세요.
응답은 JSON 객체 하나만: {"picks":[{"code":"000000","reason":"근거","risk":"반대 시나리오","watch":"다음 확인 항목"}]}.
확정 일봉 기준일: ${trusted.asof}. 사전 추림 후보 수: ${trusted.candidates.length}.
데이터: ${JSON.stringify(trusted.candidates)}`;
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),45000);
  try{
   const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
     method:'POST',signal:abort.signal,
     headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_API_KEY},
     body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.15,maxOutputTokens:2800}})
   });
   if(!response.ok)throw Error(response.status===429?'AI_QUOTA':'AI_PROVIDER_ERROR');
   const data=await response.json() as any;
   const raw=String(data?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||'').join('\n')||'').trim();
   const trimmed=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
   let parsed:unknown;
   try{parsed=JSON.parse(trimmed);}catch{throw Error('AI_INVALID_JSON');}
   const picks=checkedSelection(parsed,trusted.candidates);
   const proposed=(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))?(parsed as {picks?:unknown}).picks:null;
   if(!Array.isArray(proposed)||(!picks.length&&proposed.length>0))throw Error('AI_NO_VALID_PICKS');
   const payload={status:'READY',asof:trusted.asof,source_run_id:String(trusted.run_id),
     generated_at:now,model,items:picks,cached:false,
     note:picks.length?'AI가 확정 일봉 후보 중 관찰할 종목을 선택했습니다. 실제 미래 성과 및 실시간 체결을 보증하지 않습니다.':'AI가 이번 기준일의 후보를 보류했습니다. 강제 추천하지 않습니다.'};
   await env.DB.prepare(`UPDATE blue_basket_ai_cache_r15 SET status='READY',payload_json=? WHERE cache_key=?`)
      .bind(JSON.stringify(payload),cacheKey).run();
   return send(payload);
  }catch(e){
   await env.DB.prepare(`DELETE FROM blue_basket_ai_cache_r15 WHERE cache_key=? AND status='PENDING'`).bind(cacheKey).run();
   const reason=e instanceof Error&&['AI_QUOTA','AI_INVALID_JSON','AI_NO_VALID_PICKS'].includes(e.message)?e.message:'AI_PROVIDER_ERROR';
   return send({error:reason,message:'AI 후보를 생성하지 못했습니다. 데이터는 변경되지 않았습니다.'},503);
  }finally{clearTimeout(timer);}
 }catch{return send({error:'AI_CACHE_UNAVAILABLE',message:'AI 캐시 테이블을 확인하세요.'},503);}
}

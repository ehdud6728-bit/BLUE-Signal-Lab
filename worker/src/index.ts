interface Env { DB: D1Database; CORS_ORIGIN?: string }
type Out = Record<string, unknown>;
const json = (data: unknown, status=200, headers?: HeadersInit) => new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const dateRE = /^\d{4}-\d{2}-\d{2}$/;
function validDate(s:string):boolean { if(!dateRE.test(s))return false; const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s; }
function bad(message:string):Response{return json({error:message},400)}
function parseSignals(s:string|null):string[]{return (s||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean)}
const allowed=new Set(['BB20','BB30','BB40','ENV20','ENV40','BLUE20','BLUE30','BLUE40']);
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const origin=env.CORS_ORIGIN||'http://localhost:5173';
  const cors:HeadersInit={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const respond=(value:unknown,status=200)=>json(value,status,cors);
  try{
   const url=new URL(request.url), p=url.pathname;
   if(request.method!=='GET')return respond({error:'Read-only API'},405);
   if(p==='/api/health')return respond({status:'ok',mode:'RESEARCH_ONLY',storage:'D1'});
   if(p==='/api/runs'){
    const r=await env.DB.prepare('SELECT run_id,created_at,source,latest_price_date,notes,is_demo FROM runs ORDER BY created_at DESC LIMIT 50').all();
    return respond({items:r.results});
   }
   if(p==='/api/search'){
    const mode=url.searchParams.get('mode')||'single';
    if(mode!=='single'&&mode!=='range')return bad('mode must be single or range');
    const date=url.searchParams.get('date')||'';
    const start=mode==='single'?date:(url.searchParams.get('start')||'');
    const end=mode==='single'?date:(url.searchParams.get('end')||'');
    if(!validDate(start)||!validDate(end)||start>end)return bad('Valid dates required; start must be <= end');
    const runId=url.searchParams.get('run_id')||'';
    if(!runId)return bad('Select an imported run_id');
    const limit=Math.min(Math.max(Number(url.searchParams.get('limit')||100)||100,1),500);
    const page=Math.min(Math.max(Number(url.searchParams.get('page')||1)||1,1),10000);
    const code=(url.searchParams.get('code')||'').trim();
    if(code&&!/^[A-Za-z0-9._-]{1,24}$/.test(code))return bad('Invalid code');
    const signals=parseSignals(url.searchParams.get('signals'));
    if(signals.some(s=>!allowed.has(s)))return bad('Unsupported signal');
    const logic=url.searchParams.get('logic')||'any';
    if(!['any','all'].includes(logic))return bad('logic must be any or all');
    // Signal names are parsed using comma-padded LIKE, not substring matches.
    const filters=['run_id=?','day BETWEEN ? AND ?'];const bindings:(string|number)[]=[runId,start,end];
    if(code){filters.push('code=?');bindings.push(code)}
    if(signals.length){filters.push('('+signals.map(()=>"(',' || signal_names || ',') LIKE ?").join(logic==='all'?' AND ':' OR ')+')');bindings.push(...signals.map(s=>'%,'+s+',%'))}
    const where=filters.join(' AND ');
    const total=await env.DB.prepare('SELECT COUNT(*) AS n FROM signals WHERE '+where).bind(...bindings).first<{n:number}>();
    const r=await env.DB.prepare('SELECT run_id,code,day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE '+where+' ORDER BY day DESC,code LIMIT ? OFFSET ?').bind(...bindings,limit,(page-1)*limit).all();
    const counts=await env.DB.prepare('SELECT day,observed_stocks,signal_events,matched_stocks FROM daily_counts WHERE run_id=? AND day BETWEEN ? AND ? ORDER BY day DESC LIMIT 370').bind(runId,start,end).all();
    return respond({mode,start,end,run_id:runId,total:total?.n||0,page,limit,items:r.results.map((x:any)=>({...x,signals:String(x.signal_names||'').split(',').filter(Boolean),extras:JSON.parse(x.extras_json||'{}')})),daily_counts:counts.results,note:'Dates missing from source are not replaced by nearest trading dates.'});
   }
   if(p==='/api/symbol'){
    const code=url.searchParams.get('code')||'',runId=url.searchParams.get('run_id')||'';
    if(!/^[A-Za-z0-9._-]{1,24}$/.test(code)||!runId)return bad('code and run_id required');
    const r=await env.DB.prepare('SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE run_id=? AND code=? ORDER BY day ASC LIMIT 3000').bind(runId,code).all();
    return respond({code,run_id:runId,signals:r.results,price_data_available:false,note:'Price OHLCV chart requires a separately imported verified price source.'});
   }
   return respond({error:'Not found'},404);
  }catch(e){return respond({error:'Query failed',detail:e instanceof Error?e.message:'unknown'},500)}
 }
} satisfies ExportedHandler<Env>;

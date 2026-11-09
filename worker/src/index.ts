interface Env { DB: D1Database; CORS_ORIGIN?: string }
const json=(data:unknown,status=200,headers?:HeadersInit)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const dateRE=/^\d{4}-\d{2}-\d{2}$/;
function validDate(s:string):boolean {if(!dateRE.test(s))return false;const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===s}
const allowed=new Set(['BB20','BB30','BB40','ENV20','ENV40','BB20_LOWER','BB30_LOWER','BB40_LOWER','BB20_ALT','BB30_ALT','BB40_ALT','BB20_LOWER_ALT','BB30_LOWER_ALT','BB40_LOWER_ALT']);
const signalsOf=(s:string|null)=>(s||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean).map(x=>x.startsWith('BLUE')?x.replace(/^BLUE/,'BB'):x);
export default {async fetch(request:Request,env:Env):Promise<Response>{
 const cors:HeadersInit={'Access-Control-Allow-Origin':env.CORS_ORIGIN||'http://localhost:5173','Access-Control-Allow-Methods':'GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const respond=(x:unknown,status=200)=>json(x,status,cors);
 try {
  if(request.method!=='GET')return respond({error:'Read-only API'},405);
  const u=new URL(request.url),p=u.pathname;
  if(p==='/api/health')return respond({status:'ok',mode:'RESEARCH_ONLY',storage:'D1',api_version:'R0.6'});
  if(p==='/api/runs') {const r=await env.DB.prepare('SELECT run_id,created_at,source,latest_price_date,notes,is_demo FROM runs ORDER BY created_at DESC LIMIT 50').all();return respond({items:r.results})}
  if(p==='/api/dates') {
   const r=await env.DB.prepare("SELECT latest_price_date AS day,COUNT(*) AS versions FROM runs WHERE latest_price_date IS NOT NULL AND is_demo=0 GROUP BY latest_price_date ORDER BY latest_price_date DESC LIMIT 500").all();
   return respond({items:r.results,latest:r.results[0]?.day||null});
  }
  if(p==='/api/search') {
   const mode=u.searchParams.get('mode')||'single';if(mode!=='single'&&mode!=='range')return respond({error:'Invalid mode'},400);
   const start=mode==='single'?(u.searchParams.get('date')||''):(u.searchParams.get('start')||'');
   const end=mode==='single'?start:(u.searchParams.get('end')||'');
   if(!validDate(start)||!validDate(end)||start>end)return respond({error:'Valid date interval required'},400);
   const requested=u.searchParams.get('run_id')||'';
   // For each trading day, choose one non-demo run automatically. This keeps old run_id requests compatible.
   // Importing a newer run supersedes older versions for exactly that date only.
   const runFilter=requested?'run_id=?':'run_id IN (SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=signals.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)';
   const params:(string|number)[]=requested?[requested,start,end]:[start,end];
   const filters=[runFilter,'day BETWEEN ? AND ?'];
   const code=(u.searchParams.get('code')||'').trim();if(code){if(!/^[A-Za-z0-9._-]{1,24}$/.test(code))return respond({error:'Invalid code'},400);filters.push('code=?');params.push(code)}
   const chosen=signalsOf(u.searchParams.get('signals'));
   if(chosen.some(x=>!allowed.has(x)))return respond({error:'Unsupported signal'},400);
   const logic=u.searchParams.get('logic')||'any';if(!['any','all'].includes(logic))return respond({error:'Invalid signal logic'},400);
   if(chosen.length){filters.push('('+chosen.map(()=>"(','||signal_names||',') LIKE ?").join(logic==='all'?' AND ':' OR ')+')');params.push(...chosen.map(x=>'%,'+x+',%'))}
   const where=filters.join(' AND ');
   const limit=Math.min(500,Math.max(1,Number(u.searchParams.get('limit'))||100));const page=Math.max(1,Number(u.searchParams.get('page'))||1);
   const total=await env.DB.prepare('SELECT COUNT(*) AS n FROM signals WHERE '+where).bind(...params).first<{n:number}>();
   const rows=await env.DB.prepare('SELECT run_id,code,day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE '+where+' ORDER BY day DESC,code LIMIT ? OFFSET ?').bind(...params,limit,(page-1)*limit).all();
   const countFilter=requested?'run_id=?':'run_id IN (SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=daily_counts.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)';
   const days=await env.DB.prepare('SELECT day,observed_stocks,signal_events,matched_stocks FROM daily_counts WHERE '+countFilter+' AND day BETWEEN ? AND ? ORDER BY day DESC LIMIT 370').bind(...(requested?[requested,start,end]:[start,end])).all();
   const parsed=rows.results.map((x:any)=>{let extras:Record<string,unknown>={};try{extras=JSON.parse(x.extras_json||'{}')}catch{}return {...x,name:extras.name||extras.Name||null,signals:String(x.signal_names||'').split(',').filter(Boolean),extras}});
   return respond({mode,start,end,total:total?.n||0,page,limit,items:parsed,daily_counts:days.results,data_status:days.results.length?'AVAILABLE':'NOT_IMPORTED',note:'Missing data is not a zero-signal trading day; unverified estimates are labeled.'});
  }
  if(p==='/api/symbol') {
   const code=u.searchParams.get('code')||'';if(!/^[A-Za-z0-9._-]{1,24}$/.test(code))return respond({error:'Invalid code'},400);
   const run=u.searchParams.get('run_id');const rows=run?await env.DB.prepare('SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE run_id=? AND code=? ORDER BY day DESC LIMIT 3000').bind(run,code).all():await env.DB.prepare("SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE code=? AND run_id IN (SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=signals.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1) ORDER BY day DESC LIMIT 3000").bind(code).all();
   return respond({code,signals:rows.results,price_data_available:false});
  }
  return respond({error:'Not found'},404);
 }catch(e){return respond({error:'Query failed',detail:e instanceof Error?e.message:'unknown'},500)}
}} satisfies ExportedHandler<Env>;

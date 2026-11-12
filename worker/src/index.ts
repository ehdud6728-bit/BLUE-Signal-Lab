import { handleAi, getCachedAi } from './ai';
import { liveQuotes } from './live';
import { handleBasketAi } from './basket';
import {basketWatch} from './performance';
import {comparePrices} from './price-compare';
import {requestSearchQuotes} from './search-quote-priority';
interface Env {
  DB: D1Database;
  CORS_ORIGIN?: string;
  GITHUB_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const OWNER = 'ehdud6728-bit';
const REPO = 'BLUE-Signal-Lab';
const WORKFLOW = 'blue_market_scan_research_only.yml';
const ALLOWED = new Set([
  'BB20','BB30','BB40','ENV20','ENV40',
  'BB20_LOWER','BB30_LOWER','BB40_LOWER',
  'BB20_ALT','BB30_ALT','BB40_ALT',
  'BB20_LOWER_ALT','BB30_LOWER_ALT','BB40_LOWER_ALT',
]);
const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
const inFlightMs = 45 * 60 * 1000;

function validDate(s: string): boolean {
  if (!isoPattern.test(s)) return false;
  const dt = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(dt.valueOf()) && dt.toISOString().slice(0, 10) === s;
}
function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function normalizedSignals(s: string | null): string[] {
  return (s || '').split(',').map(x => x.trim().toUpperCase())
    .filter(Boolean).map(x => x.startsWith('BLUE') ? x.replace(/^BLUE/, 'BB') : x);
}
function githubHeaders(env: Env): HeadersInit {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BLUE-Signal-Lab-R07',
  };
}
function availableSQL(): string {
  return `SELECT 1 AS found FROM daily_counts d JOIN runs r ON d.run_id=r.run_id
    WHERE d.day=? AND r.latest_price_date=d.day AND r.is_demo=0 LIMIT 1`;
}
function scanDateOK(day: string): boolean {
  // This workflow currently imports FinanceData marcap 2025 and 2026 only.
  return validDate(day) && day >= '2025-01-01' && day <= '2026-12-31' && day <= todayKST();
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = env.CORS_ORIGIN || 'http://localhost:5173';
    const cors: HeadersInit = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    };
    const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const u = new URL(request.url), p = u.pathname;
    // ctx.access is provided only when Cloudflare Access has authenticated this Worker request.
    // An Origin header alone never grants permission to dispatch a GitHub workflow.
    const access = (ctx as ExecutionContext & { access?: unknown } | undefined)?.access;
    try {
      // AI requires Cloudflare Access at the API Worker edge. Origin alone is not authentication.
      if (p === '/api/ai/report' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await getCachedAi(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      if ((p === '/api/ai/market' || p === '/api/ai/stock') && request.method === 'POST') {
        if (request.headers.get('Origin') !== origin) return respond({error:'ORIGIN_DENIED'},403);
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await handleAi(request,env,p.endsWith('/market')?'market':'stock');
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.0: verified archived EOD candles for a matched symbol on a selected date.
      if (p === '/api/chart' && request.method === 'GET') {
        const day=u.searchParams.get('date')||'';
        const code=u.searchParams.get('code')||'';
        if(!validDate(day)||!/^[0-9]{6}$/.test(code))return respond({error:'INVALID_CHART_QUERY'},400);
        const r=await env.DB.prepare(`SELECT c.chart_json,c.stats_json,c.created_at
          FROM chart_snapshots c
          JOIN runs r ON r.run_id=c.run_id
          JOIN signals s ON s.run_id=c.run_id AND s.day=c.day AND s.code=c.code
          WHERE c.day=? AND c.code=? AND r.is_demo=0 AND r.latest_price_date=c.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`).bind(day,code)
          .first<{chart_json:string;stats_json:string;created_at:string}>();
        if(!r)return respond({status:'NOT_AVAILABLE',message:'R1.0 분석을 해당 날짜에 다시 실행해야 차트가 준비됩니다.'},404);
        return respond({status:'READY',chart:JSON.parse(r.chart_json),stats:JSON.parse(r.stats_json),
          snapshot_time:r.created_at});
      }
      // BLUE R1.5: AI picks from server-verified historical EOD; no order entry.
      if (p === '/api/basket/ai' && (request.method === 'GET' || request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        if (request.method === 'POST' && request.headers.get('Origin') !== origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream = await handleBasketAi(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.5.3: never accept arbitrary price data or arbitrary KIS requests.
      // Only Access-authenticated requests on verified scan symbols may enroll.
      if (p === '/api/basket/watch' && (request.method === 'GET'||request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.method==='POST' && request.headers.get('Origin')!==origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await basketWatch(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.4: D1-only intraday snapshots; same Cloudflare Access guard as BLUE AI.
      // Never forward KIS credentials or the encrypted token vault to browsers.
      // R1593_PRICE_COMPARE: Access-protected, read-only saved price/history.
      if (p === '/api/prices/compare' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await comparePrices(env.DB,u);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.5.9.4: authenticated batch request, no direct browser KIS access.
      if (p === '/api/prices/request' && request.method === 'POST') {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.headers.get('Origin')!==origin) return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await requestSearchQuotes(request,env.DB);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      if (p === '/api/live/quotes' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        return respond(await liveQuotes(env.DB));
      }
      if (p === '/api/health' && request.method === 'GET') {
        return respond({ status:'ok', mode:'RESEARCH_ONLY', storage:'D1', api_version:'R1.0.2' });
      }
      if (p === '/api/runs' && request.method === 'GET') {
        const r = await env.DB.prepare('SELECT run_id,created_at,source,latest_price_date,notes,is_demo FROM runs ORDER BY created_at DESC LIMIT 50').all();
        return respond({ items: r.results });
      }
      if (p === '/api/dates' && request.method === 'GET') {
        const r = await env.DB.prepare(`SELECT latest_price_date AS day,COUNT(*) AS versions FROM runs
          WHERE latest_price_date IS NOT NULL AND is_demo=0
          GROUP BY latest_price_date ORDER BY latest_price_date DESC LIMIT 500`).all();
        return respond({ items:r.results, latest:(r.results[0] as { day?: string } | undefined)?.day || null });
      }
      if (p === '/api/search' && request.method === 'GET') {
        const mode = u.searchParams.get('mode') || 'single';
        if (mode !== 'single' && mode !== 'range') return respond({ error:'Invalid mode' },400);
        const start = mode === 'single' ? u.searchParams.get('date') || '' : u.searchParams.get('start') || '';
        const end = mode === 'single' ? start : u.searchParams.get('end') || '';
        if (!validDate(start) || !validDate(end) || start > end) return respond({ error:'Valid date interval required' },400);
        const runId = u.searchParams.get('run_id') || '';
        const runFilter = runId ? 'run_id=?' : `run_id IN (
          SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=signals.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)`;
        const args: (string | number)[] = runId ? [runId,start,end] : [start,end];
        const filters = [runFilter, 'day BETWEEN ? AND ?'];
        const code = (u.searchParams.get('code') || '').trim();
        if (code) {
          if (!/^[A-Za-z0-9._-]{1,24}$/.test(code)) return respond({error:'Invalid code'},400);
          filters.push('code=?'); args.push(code);
        }
        const tags = normalizedSignals(u.searchParams.get('signals'));
        if (tags.some(tag => !ALLOWED.has(tag))) return respond({error:'Unsupported signal'},400);
        const logic = u.searchParams.get('logic') || 'any';
        if (!['any','all'].includes(logic)) return respond({error:'Invalid signal logic'},400);
        if (tags.length) {
          filters.push('(' + tags.map(() => "(','||signal_names||',') LIKE ?").join(logic === 'all' ? ' AND ' : ' OR ') + ')');
          args.push(...tags.map(tag => '%,' + tag + ',%'));
        }
        // Result-side golden-cross filters. Indexed result paging must be applied
        // AFTER SQL filtering so later pages are not silently missed.
        const gcAllowed:Record<string,string>={
          rsi:'rsi_gc',slow14:'slow_14_3_3_gc',slow12:'slow_12_5_5_gc',
          slow20:'slow_20_12_12_gc',macd:'macd_gc'
        };
        // R1.5.9.9: exact historical turnover in hundred-million KRW.
        // No inferred amounts for old EOD rows. Omitted param keeps API backward compatible.
        const amountText=(u.searchParams.get('min_amount_eok')||'0').trim();
        if(!/^\d{1,5}$/.test(amountText)||Number(amountText)>50000)
          return respond({error:'INVALID_MIN_AMOUNT'},400);
        const minAmount=Number(amountText);
        if(minAmount>0){
          filters.push(`(CASE WHEN json_valid(extras_json) THEN
            CAST(json_extract(extras_json,'$.traded_amount_krw') AS REAL) ELSE NULL END) >= ?`);
          args.push(minAmount*100000000);
        }
        const onlyPattern=(u.searchParams.get('only_pattern')||'0').trim();
        const minPattern=(u.searchParams.get('min_pattern_up')||'70').trim();
        const minPatternN=(u.searchParams.get('min_pattern_n')||'8').trim();
        if(!['0','1'].includes(onlyPattern)||!['60','70','80','90'].includes(minPattern)||
           !['3','4','5','6','7','8','10','15','20','30'].includes(minPatternN))
          return respond({error:'INVALID_PATTERN_FILTER'},400);
        // R1.5.10.4: real chart snapshots are the authoritative historical evidence.
        // Legacy signals.extras_json may predate pattern metadata. Search the SAME
        // chart setup that supplies the detail view, never infer a win percentage.
        const sampleFloor=Number(minPatternN); // allowlisted 3-30 choices; default 8
        const chartSetupTable=`chart_snapshots cs,
          json_each(CASE WHEN json_valid(cs.stats_json) THEN cs.stats_json
            ELSE '{"setups":[]}' END,'$.setups') setup`;
        const chartJoin=`cs.run_id=signals.run_id AND cs.code=signals.code AND cs.day=signals.day`;
        const setupN=`CAST(json_extract(setup.value,'$.horizons."10".n') AS INTEGER)`;
        const setupUp=`CAST(json_extract(setup.value,'$.horizons."10".up_pct') AS REAL)`;
        const setupValid=`json_type(setup.value,'$.horizons."10".up_pct') IN ('integer','real')`;
        if(onlyPattern==='1'){
          // Count and paging apply this *before* LIMIT/OFFSET; GC and amount stay ANDed.
          filters.push(`(EXISTS (SELECT 1 FROM ${chartSetupTable}
             WHERE ${chartJoin} AND ${setupValid} AND ${setupN}>=? AND ${setupUp}>=?)
           OR (NOT EXISTS (SELECT 1 FROM chart_snapshots cs WHERE ${chartJoin})
             AND CAST(json_extract(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END,
               '$.r159_pattern_n_10d') AS INTEGER)>=?
             AND CAST(json_extract(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END,
               '$.r159_pattern_up_10d') AS REAL)>=?))`);
          args.push(sampleFloor,Number(minPattern),sampleFloor,Number(minPattern));
        }
        // Select the best supported 10-day pattern *at the currently selected sample
        // floor*, not the one frozen when the D1 row was first imported.
        const bestSetupSql=`(SELECT setup.value FROM ${chartSetupTable}
          WHERE ${chartJoin} AND ${setupValid} AND ${setupN}>=${sampleFloor}
          ORDER BY ${setupUp} DESC,
            CAST(json_extract(setup.value,'$.horizons."10".median_return_pct') AS REAL) DESC,
            CAST(json_extract(setup.value,'$.horizons."10".mean_return_pct') AS REAL) DESC,
            ${setupN} DESC LIMIT 1)`;
        const gcRaw=(u.searchParams.get('gc')||'').trim();
        const gcNames=gcRaw?gcRaw.split(',').map(x=>x.trim()).filter(Boolean):[];
        if(gcNames.length>5||new Set(gcNames).size!==gcNames.length||gcNames.some(k=>!gcAllowed[k]))
          return respond({error:'Unsupported GC filter'},400);
        const gcLogic=u.searchParams.get('gc_logic')||'any';
        if(!['any','all'].includes(gcLogic))return respond({error:'Invalid GC logic'},400);
        if(gcNames.length){
          const gcWhere=gcNames.map(k=>`LOWER(CAST(json_extract(extras_json,'$.${gcAllowed[k]}') AS TEXT)) IN ('true','1')`);
          filters.push('('+gcWhere.join(gcLogic==='all'?' AND ':' OR ')+')');
        }
        const where = filters.join(' AND ');
        const limit = Math.min(500, Math.max(1, Math.floor(Number(u.searchParams.get('limit')) || 100)));
        const page = Math.min(10000, Math.max(1, Math.floor(Number(u.searchParams.get('page')) || 1)));
        const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM signals WHERE ' + where)
          .bind(...args).first<{ n:number }>();
        const rows = await env.DB.prepare(`SELECT run_id,code,day,signal_names,close_price,supply_distance_pct,extras_json,
          ${bestSetupSql} AS verified_pattern_setup_json
          FROM signals WHERE ${where} ORDER BY day DESC,code LIMIT ? OFFSET ?`)
          .bind(...args,limit,(page-1)*limit).all();
        const countFilter = runId ? 'run_id=?' : `run_id IN (
          SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=daily_counts.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)`;
        const counts = await env.DB.prepare(`SELECT day,observed_stocks,signal_events,matched_stocks
          FROM daily_counts WHERE ${countFilter} AND day BETWEEN ? AND ? ORDER BY day DESC LIMIT 370`)
          .bind(...(runId ? [runId,start,end] : [start,end])).all();
        const items = rows.results.map((x:any) => {
          let extras: Record<string,unknown> = {};
          try { extras = JSON.parse(x.extras_json || '{}'); } catch { /* legacy record */ }
          // Reconcile old search rows with the stored chart (same run/code/date).
          // Only export verified 10-session observations and their real signal dates.
          if(typeof x.verified_pattern_setup_json==='string'){
            try{
              const setup=JSON.parse(x.verified_pattern_setup_json) as any;
              const h=setup?.horizons?.['10'];
              const n=Number(h?.n),up=Number(h?.up_pct);
              if(Number.isInteger(n)&&n>=sampleFloor&&Number.isFinite(up)&&up>=0&&up<=100){
                const days=Array.isArray(h?.cases)?h.cases
                  .map((c:any)=>c?.signal_day)
                  .filter((d:unknown):d is string=>typeof d==='string'&&
                    /^20\d{2}-\d{2}-\d{2}$/.test(d)&&d<=String(x.day)) : [];
                extras.r159_pattern_up_10d=up;
                extras.r159_pattern_n_10d=n;
                extras.r159_pattern_label_10d=String(setup?.label||'').slice(0,150);
                extras.r159_pattern_signal_days_10d_json=JSON.stringify([...new Set(days)].sort().slice(-12));
              }
            }catch{/* Invalid historical JSON never fabricates evidence. */}
          }
          const record={...x};
          delete record.verified_pattern_setup_json;
          return { ...record, name:extras.name || extras.Name || null,
            signals:String(x.signal_names || '').split(',').filter(Boolean), extras };
        });
        return respond({mode,start,end,total:total?.n || 0,page,limit,items,
          daily_counts:counts.results,data_status:counts.results.length ? 'AVAILABLE' : 'NOT_IMPORTED',
          note:'Missing source days are never silently replaced by another trading day.'});
      }
      if (p === '/api/symbol' && request.method === 'GET') {
        const code = u.searchParams.get('code') || '', runId = u.searchParams.get('run_id');
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(code)) return respond({error:'Invalid code'},400);
        const rows = runId
          ? await env.DB.prepare('SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE run_id=? AND code=? ORDER BY day DESC LIMIT 3000').bind(runId,code).all()
          : await env.DB.prepare(`SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals
            WHERE code=? AND run_id IN (SELECT r.run_id FROM runs r WHERE r.is_demo=0
            AND r.latest_price_date=signals.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)
            ORDER BY day DESC LIMIT 3000`).bind(code).all();
        return respond({code,signals:rows.results,price_data_available:false});
      }
      if (p === '/api/scan/status' && request.method === 'GET') {
        // Keep GitHub status polling private to avoid exhausting the API token rate limit.
        if (!access) return respond({error:'Cloudflare Access login required'},401);
        const day = u.searchParams.get('date') || '';
        if (!validDate(day)) return respond({error:'Invalid date'},400);
        if (await env.DB.prepare(availableSQL()).bind(day).first()) return respond({date:day,status:'READY'});
        const row = await env.DB.prepare(`SELECT status,requested_at,github_run_id,github_run_url,failure_reason
          FROM scan_requests WHERE day=?`).bind(day).first<{
            status:string; requested_at:string; github_run_id:number | null;
            github_run_url:string | null; failure_reason:string | null;
          }>();
        if (!row) return respond({date:day,status:'NOT_IMPORTED'});
        if (row.status === 'failed') return respond({date:day,status:'FAILED',reason:row.failure_reason || '분석 실패',actions_url:row.github_run_url});
        const age = Date.now() - Date.parse(row.requested_at);
        if (age > inFlightMs) {
          await env.DB.prepare(`UPDATE scan_requests SET status='failed',failure_reason='45분 내 등록 결과 없음',updated_at=? WHERE day=? AND status='pending'`)
            .bind(new Date().toISOString(),day).run();
          return respond({date:day,status:'FAILED',reason:'45분 내 D1 등록 결과가 확인되지 않았습니다.',actions_url:row.github_run_url});
        }
        // When GitHub returned a run ID, detect an Actions failure before the 45-minute expiry.
        if (row.github_run_id && env.GITHUB_TOKEN) {
          try {
            const gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${row.github_run_id}`, {
              headers:githubHeaders(env)
            });
            if (gh.ok) {
              const job = await gh.json() as {status?:string;conclusion?:string;updated_at?:string};
              if (job.status === 'completed' && job.conclusion !== 'success') {
                const reason = 'GitHub Actions ' + (job.conclusion || '실패');
                await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
                  .bind('failed',reason,new Date().toISOString(),day).run();
                return respond({date:day,status:'FAILED',reason,actions_url:row.github_run_url});
              }
              if (job.status === 'completed' && job.conclusion === 'success'
                && job.updated_at && Date.now() - Date.parse(job.updated_at) > 120_000) {
                await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
                  .bind('failed','Actions는 완료됐으나 해당 날짜의 D1 데이터가 없습니다.',new Date().toISOString(),day).run();
                return respond({date:day,status:'FAILED',reason:'Actions 완료 후 D1 등록 데이터가 없습니다.',actions_url:row.github_run_url});
              }
            }
          } catch { /* GitHub status lookup is best-effort; never fabricate success. */ }
        }
        return respond({date:day,status:'PENDING',actions_url:row.github_run_url});
      }
      if (p === '/api/scan' && request.method === 'POST') {
        if (request.headers.get('Origin') !== origin) return respond({error:'Origin not allowed'},403);
        if (!access) return respond({error:'Cloudflare Access login required'},401);
        if (!env.GITHUB_TOKEN) return respond({error:'GitHub token is not configured'},503);
        let body: {date?:unknown};
        try { body = await request.json() as {date?:unknown}; }
        catch { return respond({error:'JSON body expected'},400); }
        const day = body.date;
        if (typeof day !== 'string' || !scanDateOK(day)) {
          return respond({error:'Date invalid, future, or outside 2025–2026 data source'},400);
        }
        if (await env.DB.prepare(availableSQL()).bind(day).first()) return respond({date:day,status:'READY'});
        const cutoff = new Date(Date.now() - inFlightMs).toISOString();
        const live = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scan_requests
          WHERE status='pending' AND requested_at>=?`).bind(cutoff).first<{n:number}>();
        if ((live?.n || 0) >= 3) return respond({error:'동시 진행 분석 3건 제한. 완료 후 다시 요청하세요.'},429);
        const now = new Date().toISOString();
        const claim = await env.DB.prepare(`INSERT INTO scan_requests(day,status,requested_at,updated_at)
          VALUES(?,'pending',?,?)
          ON CONFLICT(day) DO UPDATE SET status='pending',requested_at=excluded.requested_at,
            updated_at=excluded.updated_at,github_run_id=NULL,github_run_url=NULL,failure_reason=NULL
          WHERE scan_requests.status='failed' OR scan_requests.requested_at<?`)
          .bind(day,now,now,cutoff).run();
        if (!claim.meta.changes) return respond({date:day,status:'PENDING',deduplicated:true},202);
        let gh: Response;
        try {
          gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method:'POST',
            headers:{...githubHeaders(env),'Content-Type':'application/json'},
            body:JSON.stringify({ref:'main',inputs:{asof_date:day,publish_to_d1:'true'},return_run_details:true}),
          });
        } catch {
          await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
            .bind('failed','GitHub 연결 실패',new Date().toISOString(),day).run();
          return respond({error:'GitHub dispatch network error'},502);
        }
        if (!gh.ok) {
          await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
            .bind('failed','GitHub dispatch HTTP '+gh.status,new Date().toISOString(),day).run();
          return respond({error:'GitHub dispatch failed',github_status:gh.status},502);
        }
        let workflowRunId: number | null = null;
        let workflowRunUrl: string | null = null;
        if (gh.status === 200) {
          try {
            const ghData = await gh.json() as {workflow_run_id?:number;html_url?:string};
            workflowRunId = ghData.workflow_run_id || null;
            workflowRunUrl = ghData.html_url || null;
          } catch { /* 204/empty response is also a valid dispatch */ }
        }
        await env.DB.prepare('UPDATE scan_requests SET github_run_id=?,github_run_url=?,updated_at=? WHERE day=?')
          .bind(workflowRunId,workflowRunUrl,new Date().toISOString(),day).run();
        return respond({date:day,status:'PENDING',actions_url:workflowRunUrl},202);
      }
      return respond({error:'Not found'},404);
    } catch (err) {
      if (p.startsWith('/api/ai/')) return respond({error:'AI_SETUP_REQUIRED',message:'BLUE AI R0.9 D1 스키마 및 Worker 배포를 확인하세요.'},500);
      // Never print credentials or user-supplied headers to the response.
      return respond({error:'Request failed; confirm D1 R0.7 migration and Worker deployment',
        category:err instanceof Error ? err.name : 'Unknown'},500);
    }
  },
} satisfies ExportedHandler<Env>;

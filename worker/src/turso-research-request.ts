/** On-demand, Access-gated historical KRX + research import without D1. */
import {createClient} from '@libsql/client/web';

type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string;GITHUB_TOKEN?:string};
type Client=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type ClientFactory=(args:{url:string;authToken:string;intMode:'string'})=>Client;
type Fetcher=typeof fetch;
const OWNER='ehdud6728-bit',REPO='BLUE-Signal-Lab';
const WORKFLOW='blue_turso_daily_verified_eod_auto.yml';
const DISPATCH_URL=`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`;
const RUNS_URL=`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=30`;
const TIMEOUT=150*60*1000;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const table=`CREATE TABLE IF NOT EXISTS blue_research_requests_v1 (
  trade_day TEXT PRIMARY KEY,requested_at_utc TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PENDING','FAILED')),
  failure_reason TEXT)`;

export class InvalidTursoResearchRequest extends Error {
  constructor(message='INVALID_TURSO_RESEARCH_DAY'){super(message);}
}
function kstDate(now:Date){return new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);}
function kstClock(now:Date){return new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).format(now);}
export function validateResearchDay(day:string,now=new Date()){
  if(!DAY.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||
    new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||
    day<'2025-01-01'||day>kstDate(now)||new Date(day+'T00:00:00Z').getUTCDay()%6===0)
    throw new InvalidTursoResearchRequest();
  if(day===kstDate(now)&&kstClock(now)<'15:40')
    throw new InvalidTursoResearchRequest('VERIFIED_KRX_EOD_NOT_READY');
}
async function withTurso<T>(env:Env,fn:(client:Client)=>Promise<T>,factory:ClientFactory){
  const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('TURSO_RESEARCH_NOT_CONFIGURED');
  const client=factory({url,authToken,intMode:'string'});
  try{return await fn(client);}finally{client.close();}
}
async function isResearchReady(client:Client,day:string){
  const audited=await client.execute({sql:`SELECT row_count,source_payload_sha256
    FROM blue_research_signal_audit_v1 WHERE trade_day=?`,args:[day]});
  if(!audited.rows.length)return false;
  const result=await client.execute({sql:`SELECT COUNT(*) AS n FROM blue_research_signals_v1
    WHERE trade_day=? AND source_payload_sha256=?`,
    args:[day,String(audited.rows[0].source_payload_sha256)]});
  if(Number(result.rows[0]?.n)!==Number(audited.rows[0].row_count))
    throw Error('TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY');
  return true;
}
function ghHeaders(token:string){return {
  'Accept':'application/vnd.github+json',
  'Authorization':`Bearer ${token}`,
  'X-GitHub-Api-Version':'2022-11-28',
  'User-Agent':'BLUE-Signal-Lab-Research',
};}
async function findWorkflow(env:Env,day:string,requestedAt:string,fetcher:Fetcher){
  if(!env.GITHUB_TOKEN)return null;
  try{
    const r=await fetcher(RUNS_URL,{headers:ghHeaders(env.GITHUB_TOKEN)});
    if(!r.ok)return null;
    const payload=await r.json() as {workflow_runs?:Array<{
      id?:number;display_title?:string;created_at?:string;status?:string;conclusion?:string;
      html_url?:string;updated_at?:string}>};
    const from=Date.parse(requestedAt);
    const candidates=(payload.workflow_runs||[]).filter(run=>
      run.display_title===`BLUE Turso ${day} · apply` &&
      Number.isFinite(Date.parse(run.created_at||''))&&
      Date.parse(run.created_at!)>=from-10000&&
      Date.parse(run.created_at!)<=from+120000);
    // A unique date+dispatch window is required before attributing failures.
    return candidates.length===1?candidates[0]:null;
  }catch{return null;}
}

// The UI must never guess a percentage from elapsed time. Only audited
// GitHub job steps may advance its phase labels; failed reads stay generic.
async function githubResearchStage(env:Env,runId:number,fetcher:Fetcher){
  if(!Number.isSafeInteger(runId)||runId<=0||!env.GITHUB_TOKEN)return 'RUNNING';
  try{
    const url=`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}/jobs?per_page=10`;
    const response=await fetcher(url,{headers:ghHeaders(env.GITHUB_TOKEN)});
    if(!response.ok)return 'RUNNING';
    const payload=await response.json() as {jobs?:Array<{name?:string;steps?:Array<{
      name?:string;conclusion?:string}>}>};
    const steps=payload.jobs?.find(job=>job.name==='daily_eod')?.steps;
    if(!steps?.length)return 'RUNNING';
    const finished=(name:string)=>steps.some(step=>step.name===name&&step.conclusion==='success');
    if(finished('On KRX failure audit already saved KIS observations without writing EOD'))
      return 'KIS_PROVISIONAL';
    if(finished('Save research only after Turso EOD audit and exact close match'))return 'VERIFYING';
    if(finished('Scan full market patterns for the SAME verified KST date'))return 'SAVING';
    if(finished('Write verified KRX EOD into Turso only and audit read-back'))return 'RESEARCH';
    return 'EOD';
  }catch{return 'RUNNING';}
}

export async function requestTursoResearch(env:Env,day:string,{
  now=new Date(),factory=createClient,fetcher=fetch,
}:{now?:Date;factory?:ClientFactory;fetcher?:Fetcher}={}){
  validateResearchDay(day,now);
  if(!env.GITHUB_TOKEN)throw Error('GITHUB_DISPATCH_NOT_CONFIGURED');
  return withTurso(env,async client=>{
    if(await isResearchReady(client,day))return {status:'READY',day};
    await client.execute(table);
    const earliest=new Date(now.getTime()-TIMEOUT).toISOString();
    const active=await client.execute({sql:`SELECT COUNT(*) AS n
      FROM blue_research_requests_v1 WHERE status='PENDING' AND requested_at_utc>=?`,
      args:[earliest]});
    const previous=await client.execute({sql:`SELECT status,requested_at_utc
      FROM blue_research_requests_v1 WHERE trade_day=?`,args:[day]});
    if(previous.rows.length&&previous.rows[0].status==='PENDING'&&
       String(previous.rows[0].requested_at_utc)>=earliest)
      return {status:'PENDING',day,deduplicated:true};
    if(Number(active.rows[0]?.n)>=3)throw Error('TURSO_RESEARCH_QUEUE_FULL');
    const stamp=now.toISOString();
    const claimed=await client.execute({sql:`INSERT INTO blue_research_requests_v1
      (trade_day,requested_at_utc,status,failure_reason) VALUES(?,?,'PENDING',NULL)
      ON CONFLICT(trade_day) DO UPDATE SET requested_at_utc=excluded.requested_at_utc,
      status='PENDING',failure_reason=NULL WHERE status='FAILED' OR requested_at_utc<?`,
      args:[day,stamp,earliest]});
    if(Number(claimed.rowsAffected)!==1)return {status:'PENDING',day,deduplicated:true};
    try{
      const gh=await fetcher(DISPATCH_URL,{method:'POST',headers:{...ghHeaders(env.GITHUB_TOKEN!),
        'Content-Type':'application/json'},body:JSON.stringify({ref:'main',inputs:{
          trade_day:day,mode:'apply',confirm_write:'blue-turso-eod-research',
          include_indicators:'false'}})});
      if(!gh.ok)throw Error('GITHUB_DISPATCH_FAILED');
    }catch{
      await client.execute({sql:`UPDATE blue_research_requests_v1
        SET status='FAILED',failure_reason='GITHUB_DISPATCH_FAILED'
        WHERE trade_day=? AND requested_at_utc=?`,args:[day,stamp]});
      throw Error('GITHUB_DISPATCH_FAILED');
    }
    return {status:'PENDING',day,deduplicated:false};
  },factory);
}

export async function tursoResearchRequestStatus(env:Env,day:string,{
  now=new Date(),factory=createClient,fetcher=fetch,
}:{now?:Date;factory?:ClientFactory;fetcher?:Fetcher}={}){
  validateResearchDay(day,now);
  return withTurso(env,async client=>{
    if(await isResearchReady(client,day))return {status:'READY',day};
    let rows;
    try{rows=await client.execute({sql:`SELECT status,requested_at_utc,failure_reason
      FROM blue_research_requests_v1 WHERE trade_day=?`,args:[day]});}
    catch(e){if(/no such table: blue_research_requests_v1/i.test(String(e)))
      return {status:'NOT_IMPORTED',day};
      throw e;}
    if(!rows.rows.length)return {status:'NOT_IMPORTED',day};
    const record=rows.rows[0];
    if(record.status==='FAILED')return {status:'FAILED',day,reason:'분석 실행 요청이 실패했습니다.'};
    const stamp=String(record.requested_at_utc);
    if(now.getTime()-Date.parse(stamp)>TIMEOUT)return {status:'FAILED',day,
      reason:'분석이 제한 시간 안에 완료되지 않았습니다. GitHub 실행 기록을 확인해 주세요.'};
    const gh=await findWorkflow(env,day,stamp,fetcher);
    const actions_url=typeof gh?.html_url==='string'&&
      /^https:\/\/github\.com\/ehdud6728-bit\/BLUE-Signal-Lab\/actions\/runs\/\d+$/.test(gh.html_url)?
      gh.html_url:null;
    if(gh?.status==='completed'&&gh.conclusion!=='success')return {
      status:'FAILED',day,reason:'GitHub Actions 분석 실행이 실패했습니다.',actions_url};
    if(gh?.status==='completed'&&gh.conclusion==='success'&&
      await githubResearchStage(env,gh.id||0,fetcher)==='KIS_PROVISIONAL')return {
      status:'PROVISIONAL',day,
      reason:'KRX 확정 검증은 보류됐습니다. KIS 잠정 시세만 별도 저장·조회되며 확정 BLUE 패턴은 아직 없습니다.',
      actions_url};
    if(gh?.status==='completed'&&gh.conclusion==='success'&&
      now.getTime()-Date.parse(gh.updated_at||'')>120000)return {
      status:'FAILED',day,reason:'Actions 완료 후 Turso 패턴 기록이 확인되지 않습니다.',actions_url};
    const stage=!gh?'REQUESTED':gh.status==='queued'?'QUEUED':
      gh.status==='completed'?'VERIFYING':
      await githubResearchStage(env,gh.id||0,fetcher);
    return {status:'PENDING',day,actions_url,stage,requested_at_utc:stamp};
  },factory);
}

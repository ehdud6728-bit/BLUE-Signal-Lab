import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTursoProvisional,tursoProvisionalMode,provisionalStatements}
  from './src/turso-provisional.mjs';
import {getKisDailyQuote,getKisChartDailyQuote} from './src/core.mjs';

const NOW=new Date('2026-11-19T00:05:12.000Z');
const POST_CLOSE=new Date('2026-11-19T11:44:12.000Z'); // 20:44 KST
const env=(extra={})=>({
  COLLECTOR_ENABLED:'true',
  TURSO_DATABASE_URL:'libsql://mock.example',TURSO_AUTH_TOKEN:'placeholder',
  TURSO_PROVISIONAL_PILOT_UNTIL_UTC:'2026-11-19T00:20:12.000Z',
  KIS_APP_KEY:'key',KIS_APP_SECRET:'secret',
  DB:new Proxy({},{get(){throw Error('D1_MUST_NOT_BE_READ');}}),
  ...extra
});
const marketsFor=()=>[['J','KRX_REGULAR']];
const quote=(overrides={})=>({rt_cd:'0',output:{
  stck_prpr:'66500',stck_oprc:'66300',stck_hgpr:'67200',
  stck_lwpr:'65400',acml_vol:'700000',prdy_ctrt:'0.8',
  ...overrides
}});

function mockDb({auditDay='2026-11-18',count=2601,expected=2601,pacing=null,
  research=null,
  currentAudit=null,currentCount=2601,rows=[
  {code:'005930',name:'삼성전자',close:'66000'},
  {code:'000660',name:'SK하이닉스',close:'160000'}
]}={}){
  const state={queries:[],batches:[],closed:false};
  const db={
    async execute(query){
      const sql=typeof query==='string'?query:query.sql;
      state.queries.push({sql,args:query.args||[]});
      if(sql.includes('SELECT row_count FROM blue_eod_ingest_audit_v1'))
        return {rows:currentAudit===null?[]:[{row_count:currentAudit}]};
      if(sql.includes('SELECT trade_day,row_count')&&sql.includes('FROM blue_eod_ingest_audit_v1'))
        return {rows:[{trade_day:auditDay,row_count:expected}]};
      if(sql.includes('SELECT trade_day,row_count')&&sql.includes('FROM blue_research_signal_audit_v1'))
        return {rows:research?[research]:[]};
      if(sql.includes('SELECT batch_cap,cooldown_until_utc'))return {rows:pacing?[pacing]:[]};
      if(sql.includes('CREATE TABLE IF NOT EXISTS blue_kis_provisional_pacing_v1')||
        sql.includes('INSERT INTO blue_kis_provisional_pacing_v1'))return {rows:[]};
      if(sql.includes('SELECT e.code,e.name,e.close'))return {rows:research?[{
        code:'000660',name:'SK하이닉스',close:'160000'}]:[]};
      if(sql.includes('SELECT COUNT(*) AS n'))
        return {rows:[{n:query.args?.[0]==='2026-11-19'?currentCount:count}]};
      if(sql.includes('SELECT code,name,close'))return {rows};
      if(sql.includes('SELECT ciphertext,expires_at_utc'))return {rows:[]};
      if(sql.includes('CREATE TABLE IF NOT EXISTS blue_kis_provisional_daily_v1'))return {rows:[]};
      throw Error('UNEXPECTED_TURSO_QUERY');
    },
    async batch(statements,mode){state.batches.push({statements,mode});},
    close(){state.closed=true;}
  };
  return {db,state};
}
const deps=(db,extra={})=>({clientFactory:()=>db,marketsFor,
  token:async()=> 'dummy-cached-token',quote:async()=>quote(),receivedAt:NOW,
  noPacing:true,...extra});

test('provisional quotes are opt-in, max 30 minutes, with emergency pause',()=>{
  assert.equal(tursoProvisionalMode({},NOW),'OFF');
  assert.equal(tursoProvisionalMode(env(),NOW),'PILOT');
  assert.equal(tursoProvisionalMode(env({TURSO_PROVISIONAL_PILOT_UNTIL_UTC:'2026-11-19T01:05:12.000Z'}),NOW),'OFF');
  assert.equal(tursoProvisionalMode(env({TURSO_PROVISIONAL_PILOT_UNTIL_UTC:'2026-11-19T00:04:00.000Z'}),NOW),'OFF');
  assert.equal(tursoProvisionalMode(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),NOW),'FULL');
  assert.equal(tursoProvisionalMode(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true',TURSO_PROVISIONAL_PAUSED:'true'}),NOW),'OFF');
});

test('audited previous KRX day drives bounded provisional KIS observations, never EOD tables',async()=>{
  const {db,state}=mockDb();const calls=[];
  const result=await collectTursoProvisional(env(),NOW,deps(db,{quote:async(_env,_token,market,code)=>{
    calls.push([market,code]);return quote();
  }}));
  assert.equal(result.status,'SAVED');
  assert.equal(result.mode,'PILOT');
  assert.equal(result.saved,2);
  assert.deepEqual(calls,[['J','005930'],['J','000660']]);
  const select=state.queries.find(q=>q.sql.includes('SELECT code,name,close'));
  assert.deepEqual(select.args,['2026-11-18',10,50]); // 09:05 KST, sixth page
  assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].statements.length,6); // latest, history, provisional per symbol
  const insertProvisional=state.batches[0].statements.filter(q=>q.sql.includes('INSERT INTO blue_kis_provisional_daily_v1'));
  assert.equal(insertProvisional.length,2);
  assert.equal(insertProvisional[0].args[11],'COLLECTOR_KST_REGULAR_SESSION');
  assert.ok(!state.batches[0].statements.some(q=>/blue_eod_daily_v1|blue_eod_ingest_audit_v1|blue_research_signals_v1/.test(q.sql)));
  assert.equal(state.closed,true);
});

test('provider-reported matching date is retained only as provisional, mismatch is rejected',async()=>{
  const {db,state}=mockDb();
  let n=0;
  const result=await collectTursoProvisional(env(),NOW,deps(db,{quote:async()=>{
    n++;return quote({stck_bsop_date:n===1?'20261119':'20261118'});
  }}));
  assert.equal(result.status,'SAVED');
  assert.equal(result.saved,1);assert.equal(result.rejected,1);
  const stored=state.batches[0].statements.find(q=>q.sql.includes('INSERT INTO blue_kis_provisional_daily_v1'));
  assert.equal(stored.args[11],'KIS_REPORTED_TRADE_DATE');
  const payload=JSON.parse(state.batches[0].statements[0].args[4]);
  assert.equal(payload.is_confirmed_daily,false);
  assert.equal(payload.provisional_status,'IN_PROGRESS');
});

test('post-close KIS daily OHLCV continues until 22:00 only when verified KRX EOD is unavailable',async()=>{
  const {db,state}=mockDb();const requested=[];
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,
      quote:async()=>{throw Error('CURRENT_PRICE_NOT_ALLOWED_AFTER_CLOSE');},
      quoteDaily:async(_env,_token,market,code,day)=>{
        requested.push([market,code,day]);return quote({stck_bsop_date:'20261119'});
      }}));
  assert.equal(result.status,'SAVED');
  assert.equal(result.phase,'KRX_POST_CLOSE');
  assert.equal(result.saved,2);
  assert.deepEqual(requested,[['J','005930','2026-11-19'],['J','000660','2026-11-19']]);
  assert.ok(state.queries.some(q=>q.sql.includes('SELECT row_count FROM blue_eod_ingest_audit_v1')));
  const batch=state.batches[0].statements;
  const payload=JSON.parse(batch[0].args[4]);
  assert.equal(payload.source,'KIS_REST_INQUIRE_DAILY_PRICE');
  assert.equal(payload.provisional_date_basis,'KIS_REPORTED_TRADE_DATE');
  assert.equal(payload.is_confirmed_daily,false);
  const provisional=batch.find(q=>q.sql.includes('INSERT INTO blue_kis_provisional_daily_v1'));
  assert.equal(provisional.args[12],'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL');
  assert.ok(!batch.some(q=>/UPDATE blue_eod|INSERT INTO blue_eod/.test(q.sql)));
});

test('post-close fallback skips KIS if same-day independently audited KRX EOD is complete',async()=>{
  const {db,state}=mockDb({currentAudit:2601,currentCount:2601});
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,{clientFactory:()=>db,
      quoteDaily:async()=>{throw Error('KIS_MUST_NOT_BE_CALLED');}});
  assert.equal(result.status,'VERIFIED_EOD_ALREADY_AVAILABLE');
  assert.equal(state.queries.length,2);
  assert.equal(state.batches.length,0);
});

test('post-close incomplete EOD audit permits date-verified KIS fallback',async()=>{
  const {db,state}=mockDb({currentAudit:2601,currentCount:2500});
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,
      quoteDaily:async()=>quote({stck_bsop_date:'20261119'})}));
  assert.equal(result.status,'SAVED');
  assert.equal(result.saved,2);
  assert.equal(state.batches.length,1);
});

test('FULL mode ramps from 20 to 25 per minute without raising the 10-symbol pilot',async()=>{
  const {db,state}=mockDb();
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,
      quoteDaily:async()=>quote({stck_bsop_date:'20261119'})}));
  assert.equal(result.status,'SAVED');
  assert.equal(result.batch_cap,20);
  const select=state.queries.find(q=>q.sql.includes('SELECT code,name,close'));
  assert.deepEqual(select.args,['2026-11-18',20,1760]); // 20:44 KST, page 44 of 66
  const ramp=state.queries.find(q=>q.sql.includes('INSERT INTO blue_kis_provisional_pacing_v1'));
  assert.equal(ramp.args[1],25);
  assert.equal(state.batches.length,1);
});

test('FULL mode backs off and persists cooldown on KIS throttle, saving valid earlier quotes',async()=>{
  const {db,state}=mockDb();let count=0;
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,quoteDaily:async()=>{
      if(++count===2)throw Error('KIS_RATE_LIMIT');
      return quote({stck_bsop_date:'20261119'});
    }}));
  assert.equal(result.status,'SAVED_WITH_KIS_COOLDOWN');
  assert.equal(result.saved,1);assert.equal(result.rejected,1);
  const slowdown=state.queries.find(q=>q.sql.includes('INSERT INTO blue_kis_provisional_pacing_v1'));
  assert.equal(slowdown.args[1],10);
  assert.equal(slowdown.args[2],new Date(POST_CLOSE.getTime()+3*60_000).toISOString());
  assert.equal(state.batches.length,1);
});

test('FULL mode honors persisted cooldown without making a KIS request',async()=>{
  const {db,state}=mockDb({pacing:{batch_cap:10,
    cooldown_until_utc:new Date(POST_CLOSE.getTime()+180000).toISOString()}});
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,{clientFactory:()=>db,quoteDaily:async()=>{throw Error('MUST_NOT_CALL_KIS');}});
  assert.equal(result.status,'KIS_RATE_LIMIT_COOLDOWN');
  assert.equal(state.batches.length,0);
  assert.ok(!state.queries.some(q=>q.sql.includes('SELECT code,name,close')));
});

test('KIS HTTP 429 and official EGW00201 have a distinct throttle signal',async()=>{
  const input=[env(),'cached-token','J','005930','2026-11-19'];
  await assert.rejects(()=>getKisDailyQuote(...input,async()=>new Response('',{status:429})),
    /KIS_RATE_LIMIT/);
  await assert.rejects(()=>getKisDailyQuote(...input,async()=>Response.json({rt_cd:'1',msg_cd:'EGW00201'})),
    /KIS_RATE_LIMIT/);
});

test('FULL mode prioritizes independently audited research symbols every five minutes',async()=>{
  const {db,state}=mockDb({research:{trade_day:'2026-11-18',row_count:189}});
  const codes=[];
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    NOW,deps(db,{quote:async(_env,_token,_market,code)=>{
      codes.push(code);return quote();
    }}));
  assert.equal(result.status,'SAVED');
  assert.equal(codes[0],'000660');
  assert.equal(new Set(codes).size,codes.length);
  assert.equal(state.batches.length,1);
});

test('post-close rejects missing or stale business dates and never fabricates today',async()=>{
  for(const businessDate of ['', '20261118']){
    const {db,state}=mockDb();
    const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
      POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,
        quoteDaily:async()=>quote({stck_bsop_date:businessDate})}));
    assert.equal(result.status,'NO_VALID_QUOTES');
    assert.equal(result.rejected,2);
    assert.equal(result.reasons.KIS_DAILY_DATE_MISSING??result.reasons.PROVIDER_TRADE_DAY_MISMATCH,2);
    assert.equal(state.batches.length,0);
  }
});

test('zero valid KIS quotes expose sanitized reason counts, never raw provider text',async()=>{
  const {db}=mockDb();
  const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),
    POST_CLOSE,deps(db,{receivedAt:POST_CLOSE,quoteDaily:async()=>{throw Error('KIS_DAILY_EXACT_DATE_MISSING');}}));
  assert.equal(result.status,'NO_VALID_QUOTES');
  assert.equal(result.attempted,2);
  assert.deepEqual(result.reasons,{KIS_DAILY_EXACT_DATE_MISSING:2});
});

test('incomplete EOD audit or stale reference fails closed before any provider request',async()=>{
  for(const setup of [{count:2500},{auditDay:'2026-11-01'}]){
    const {db,state}=mockDb(setup);
    const result=await collectTursoProvisional(env(),NOW,deps(db,{
      quote:async()=>{throw Error('KIS_MUST_NOT_BE_CALLED');}
    }));
    assert.ok(['INCOMPLETE_EOD_REFERENCE','STALE_EOD_REFERENCE'].includes(result.status));
    assert.equal(state.batches.length,0);
    assert.equal(state.closed,true);
  }
});

test('missing cached token does not issue tokenP or write data',async()=>{
  const {db,state}=mockDb();
  const result=await collectTursoProvisional(env(),NOW,{
    clientFactory:()=>db,marketsFor,quote:async()=>{throw Error('KIS_MUST_NOT_BE_CALLED');}
  });
  assert.equal(result.status,'TURSO_TOKEN_MISSING');
  assert.equal(state.batches.length,0);
});

test('market gating excludes pre-open, 22:00 and non-trading dates without accessing Turso',async()=>{
  const {db,state}=mockDb();
  for(const when of [new Date('2026-11-18T23:59:00.000Z'),
    new Date('2026-11-19T13:00:00.000Z'),new Date('2026-11-21T11:05:00.000Z')]){
    const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),when,{
      clientFactory:()=>db,marketsFor:when.getUTCDay()===6?()=>[]:marketsFor
    });
    assert.equal(result.status,'OUTSIDE_COLLECTION_WINDOW');
  }
  assert.equal((await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true',CLOSED_DATES:'2026-11-19'}),
    POST_CLOSE,{clientFactory:()=>db})).status,'OUTSIDE_COLLECTION_WINDOW');
  assert.equal(state.queries.length,0);
});

test('invalid stock codes and malformed quotes never get saved',async()=>{
  const {db,state}=mockDb({rows:[
    {code:'00-88K',name:'bad',close:'1234'},
    {code:'005930',name:'Samsung',close:'66000'}]});
  const result=await collectTursoProvisional(env(),NOW,deps(db,{
    quote:async()=>quote({stck_hgpr:'1'})
  }));
  assert.equal(result.status,'NO_VALID_QUOTES');
  assert.equal(result.rejected,2);
  assert.equal(state.batches.length,0);
});

test('provisional writer rejects a final-day or non-KRX quote even with valid OHLCV',()=>{
  const sample={trade_date_kst:'2026-11-19',market:'J',phase:'KRX_REGULAR',code:'005930',
    received_at_utc:NOW.toISOString(),price:66500,accumulated_volume:700000,
    eod_asof:'2026-11-18',name:'Samsung',open:66300,high:67200,low:65400,
    provisional_status:'IN_PROGRESS',provisional_date_basis:'COLLECTOR_KST_REGULAR_SESSION',
    source:'KIS_REST_INQUIRE_PRICE'};
  assert.equal(provisionalStatements([sample]).length,3);
  assert.throws(()=>provisionalStatements([{...sample,eod_asof:sample.trade_date_kst}]),/INVALID_PROVISIONAL_QUOTE/);
  assert.throws(()=>provisionalStatements([{...sample,market:'NX'}]),/INVALID_PROVISIONAL_QUOTE/);
  const afterClose={...sample,phase:'KRX_POST_CLOSE',
    source:'KIS_REST_INQUIRE_DAILY_PRICE',is_confirmed_daily:false,
    reported_trade_date:'20261119',provisional_date_basis:'KIS_REPORTED_TRADE_DATE'};
  assert.equal(provisionalStatements([afterClose]).length,3);
  assert.throws(()=>provisionalStatements([{...afterClose,reported_trade_date:'20261118'}]),
    /INVALID_PROVISIONAL_QUOTE/);
  assert.throws(()=>provisionalStatements([{...afterClose,is_confirmed_daily:true}]),
    /INVALID_PROVISIONAL_QUOTE/);
});

 test('production configuration enables full mode and preserves emergency pause',async()=>{
 const {readFileSync}=await import('node:fs');
 const config=JSON.parse(readFileSync(new URL('./wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(tursoProvisionalMode(config.vars,NOW),'FULL');
 assert.equal(tursoProvisionalMode({...config.vars,TURSO_PROVISIONAL_PAUSED:'true'},NOW),'OFF');
 assert.equal(config.vars.TURSO_MIRROR_ENABLED,'false');
 });
 test('counts actual turnover and missing turnover separately',async()=>{
 const {db}=mockDb();let n=0;
 const r=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),NOW,deps(db,{quote:async()=>quote(++n===1?{acml_tr_pbmn:'123456'}:{})}));
 assert.equal(r.turnover_valid,1);assert.equal(r.turnover_missing,1);
 });

test('chart daily uses exact date, raw price and actual turnover',async()=>{
 const day='2026-11-19';
 const row={stck_bsop_date:'20261119',stck_clpr:'66500',stck_oprc:'66300',stck_hgpr:'67200',stck_lwpr:'65400',acml_vol:'700000',acml_tr_pbmn:'46550000000'};
 const q=await getKisChartDailyQuote(env(),'cached','J','005930',day,async(url,opts)=>{
  assert.ok(url.pathname.endsWith('/inquire-daily-itemchartprice'));
  assert.equal(opts.headers.tr_id,'FHKST03010100');
  assert.equal(url.searchParams.get('FID_ORG_ADJ_PRC'),'1');
  assert.equal(url.searchParams.get('FID_INPUT_DATE_1'),'20261119');
  assert.equal(url.searchParams.get('FID_INPUT_DATE_2'),'20261119');
  return Response.json({rt_cd:'0',output2:[row]});
 });
 assert.equal(q.output.acml_tr_pbmn,'46550000000');
 assert.equal(q.output.stck_prpr,'66500');
 await assert.rejects(()=>getKisChartDailyQuote(env(),'cached','J','005930',day,async()=>Response.json({rt_cd:'0',output2:[{...row,stck_bsop_date:'20261118'}]})),/KIS_DAILY_EXACT_DATE_MISSING/);
 await assert.rejects(()=>getKisChartDailyQuote(env(),'cached','J','005930',day,async()=>new Response('',{status:429})),/KIS_RATE_LIMIT/);
});

test('rotating post-close collector stops after 22:00 without saving a late response',async()=>{
 const {db,state}=mockDb();
 const before=new Date('2026-11-19T12:59:50.000Z');
 const late=new Date('2026-11-19T13:00:01.000Z');
 const stamps=[before,before,before,late];let calls=0;
 const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),before,
   deps(db,{clock:()=>stamps.shift()||late,quoteDaily:async()=>{calls++;return quote({stck_bsop_date:'20261119'});}}));
 assert.equal(calls,2);assert.equal(result.saved,1);assert.equal(result.rejected,1);
 assert.equal(result.window_ended,true);assert.equal(result.reasons.RESPONSE_OUTSIDE_COLLECTION_WINDOW,1);
 assert.equal(state.batches.length,1);
 assert.equal(state.batches[0].statements.filter(x=>x.sql.includes('INSERT INTO blue_kis_provisional_daily_v1')).length,1);
});
test('no provider call if the request window already expired during setup',async()=>{
 const {db,state}=mockDb();const before=new Date('2026-11-19T12:59:59.000Z');
 const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),before,
   deps(db,{clock:()=>new Date('2026-11-19T13:00:00.000Z'),quoteDaily:async()=>{throw Error('MUST_NOT_CALL_KIS');}}));
 assert.equal(result.status,'COLLECTION_WINDOW_ENDED');assert.equal(result.attempted,0);
 assert.equal(result.window_ended,true);assert.equal(state.batches.length,0);
});
test('regular phase response crossing 15:20 is not mislabeled as a regular observation',async()=>{
 const {db,state}=mockDb();const before=new Date('2026-11-19T06:19:59.000Z');
 const after=new Date('2026-11-19T06:20:00.000Z');const stamps=[before,after];
 const result=await collectTursoProvisional(env({TURSO_PROVISIONAL_QUOTES_ENABLED:'true'}),before,
   deps(db,{clock:()=>stamps.shift()||after}));
 assert.equal(result.status,'COLLECTION_WINDOW_ENDED');assert.equal(result.rejected,1);
 assert.equal(result.reasons.RESPONSE_OUTSIDE_COLLECTION_WINDOW,1);assert.equal(state.batches.length,0);
});

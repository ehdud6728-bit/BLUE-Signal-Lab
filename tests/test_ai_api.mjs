// Run with: node --experimental-strip-types tests/test_ai_api.mjs
import assert from 'node:assert/strict';
import { handleAi, getCachedAi } from '../worker/src/ai.ts';

class FakeD1 {
  constructor(){this.cache=new Map();this.usage=new Map();}
  prepare(sql){
    const db=this;let args=[];return {
      bind(...vals){args=vals;return this;},
      async first(){
        if(sql.includes('FROM daily_counts d JOIN runs r'))return {run_id:'blue_market_20261109',day:'2026-11-09',observed_stocks:2566,matched_stocks:133,signal_events:238,created_at:'2026-11-10T03:00:00Z'};
        if(sql.includes('FROM signals WHERE run_id=? AND day=? AND code=?'))return args[2]==='005930'?{code:'005930',day:args[1],run_id:args[0],signal_names:'BB20',close_price:70000,supply_distance_pct:2.4,extras_json:'{"name":"삼성전자","rsi":45,"macd_gc":false,"slow_14_3_3_gc":true}'}:null;
        if(sql.includes('SELECT * FROM ai_analysis_cache'))return db.cache.get(args[0])||null;
        if(sql.includes('FROM ai_analysis_cache')&&sql.includes("status='READY'")){
          const all=[...db.cache.values()].filter(x=>x.kind===args[0]&&x.asof_date===args[1]&&x.code===args[2]&&x.status==='READY');return all.at(-1)||null;
        }
        throw Error('Unknown first SQL: '+sql);
      },
      async all(){
        if(sql.includes('FROM signals WHERE run_id=? AND day=? LIMIT 500'))return {results:[{code:'005930',signal_names:'BB20',extras_json:'{"name":"삼성전자"}'},{code:'000660',signal_names:'BB40,ENV20',extras_json:'{"name":"SK하이닉스"}'}]};
        throw Error('Unknown all SQL: '+sql);
      },
      async run(){
        if(sql.startsWith('INSERT INTO ai_analysis_cache')){
          const [cache_key,kind,asof_date,code,source_run_id,model,created_at,retry,stale]=args;
          const prev=db.cache.get(cache_key);
          if(prev&&!((prev.status==='FAILED'&&prev.created_at<retry)||(prev.status==='PENDING'&&prev.created_at<stale)))return {meta:{changes:0}};
          db.cache.set(cache_key,{cache_key,kind,asof_date,code,source_run_id,model,status:'PENDING',created_at});return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT INTO ai_daily_usage')){
          const n=db.usage.get(args[0])||0;
          if(n>=args[1])return {meta:{changes:0}};
          db.usage.set(args[0],n+1);return {meta:{changes:1}};
        }
        if(sql.includes("SET status='READY'")){
          const [report_text,sources_json,generated_at,cache_key]=args;
          Object.assign(db.cache.get(cache_key),{status:'READY',report_text,sources_json,generated_at});return {meta:{changes:1}};
        }
        if(sql.includes('SET status=?,error_code=?')){
          const [status,error_code,cache_key]=args;Object.assign(db.cache.get(cache_key),{status,error_code});return {meta:{changes:1}};
        }
        throw Error('Unknown run SQL '+sql);
      }
    };
  }
}
const db=new FakeD1();
const env={DB:db,GEMINI_API_KEY:'TEST_SECRET'};
const url='https://example.com/api/ai/market';
const post=(u,obj)=>new Request(u,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(obj)});
let externalCalls=0;const original=globalThis.fetch;
globalThis.fetch=async (u,options)=>{
  assert.equal(options.headers['x-goog-api-key'],'TEST_SECRET');
  const data=JSON.parse(options.body);
  assert.equal(data.tools,undefined); // free-tier model must not use paid search grounding
  assert.ok(String(u).includes("gemini-3.5-flash-lite"));
  assert.ok(!JSON.stringify(data).includes('TEST_SECRET'));
  if(data.contents[0].parts[0].text.includes('[요청] 2026-11-09 기준 코스피')){
    assert.match(data.contents[0].parts[0].text,/삼성전자/);
    assert.match(data.contents[0].parts[0].text,/2566/);
  }
  externalCalls++;
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'기술 지표와 확인된 자료를 구분하세요.'}]},}]}),{status:200,headers:{'Content-Type':'application/json'}});
};
let resp=await handleAi(post(url,{date:'2026-11-09'}),env,'market');
assert.equal(resp.status,200);assert.equal((await resp.json()).status,'READY');
resp=await handleAi(post(url,{date:'2026-11-09'}),env,'market');
assert.equal(resp.status,200);assert.equal((await resp.json()).cached,true);assert.equal(externalCalls,1);
resp=await handleAi(post(url,{date:'2026-11-11'}),env,'market');assert.equal(resp.status,400);
resp=await handleAi(post(url,{date:'2026-11-09',code:'bad'}),env,'stock');assert.equal(resp.status,400);
resp=await handleAi(post(url,{date:'2026-11-09',code:'123456'}),env,'stock');assert.equal(resp.status,404);
resp=await handleAi(post(url,{date:'2026-11-09',code:'005930'}),env,'stock');assert.equal(resp.status,200);
assert.equal(externalCalls,2);
resp=await getCachedAi(new Request('https://example.com/api/ai/report?kind=stock&date=2026-11-09&code=005930'),env);
assert.equal((await resp.json()).status,'READY');
// Test free-tier usage cap enforced server side without sending 26th Gemini request.
db.usage.set(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),25);
resp=await handleAi(post(url,{date:'2026-11-09',code:'005930'}),env,'stock');
assert.equal(resp.status,200);assert.equal(externalCalls,2); // cached must remain free
console.log('AI integration tests: PASS (Gemini 3.5 free text mode, market, stock, cache, validation, limit).');
globalThis.fetch=original;

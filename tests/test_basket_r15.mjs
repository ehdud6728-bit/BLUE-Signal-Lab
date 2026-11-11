import test from 'node:test';
import assert from 'node:assert/strict';
import {prefilter,checkedSelection,handleBasketAi} from '../worker/src/basket.ts';
const a={code:'005930',name:'삼성전자',day:'2026-11-10',close_price:70000,signals:['BB20'],gc:[],rsi:55,volume_ratio20:2,amount_ratio20:2,supply_distance_pct:1};
const b={...a,code:'000660',name:'SK하이닉스',signals:['BB20','BB30'],gc:['rsi_gc']};
test('deterministic prefilter prioritizes researched signals',()=>{assert.equal(prefilter([a,b])[0].code,'000660');});
test('prefilter does not mutate original list',()=>{const z=[a,b];prefilter(z);assert.equal(z[0].code,'005930');});
test('model cannot invent a ticker',()=>{assert.deepEqual(checkedSelection({picks:[{code:'999999',reason:'invented'}]},[a]),[]);});
test('AI result keeps server-authoritative EOD values',()=>{
 const q=checkedSelection({picks:[{code:'005930',name:'WRONG',close_price:1,reason:'A',risk:'B',watch:'C'}]},[a]);
 assert.equal(q[0].close_price,70000);assert.equal(q[0].name,'삼성전자');assert.equal(q[0].source,'AI');
});
test('duplicate AI picks are collapsed',()=>{assert.equal(checkedSelection({picks:[{code:'005930'},{code:'005930'}]},[a]).length,1);});
test('wrong structure gets no candidates',()=>{assert.deepEqual(checkedSelection({foo:[]},[a]),[]);});
const dateToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.parse(dateToday+'T00:00:00Z')-86400000).toISOString().slice(0,10);
function fakeDb({run=true,rows=[{code:'005930',day:yesterday,close_price:70000,signal_names:'BB20',supply_distance_pct:3,extras_json:JSON.stringify({name:'삼성전자',rsi:55})}]}={}){
 const cache=new Map();
 const prepare=sql=>{let args=[];const stmt={bind(...v){args=v;return stmt;},async first(){
  if(sql.includes('FROM runs'))return run?{run_id:100,latest_price_date:yesterday}:null;
  if(sql.includes('SELECT status,payload_json'))return cache.get(args[0])||null;
  if(sql.includes('COUNT(*) AS n'))return {n:0};
  return null;
 },async all(){return {results:rows};},async run(){
  if(sql.includes('INSERT INTO blue_basket_ai_cache_r15')){cache.set(args[0],{status:'PENDING',created_at:args[2],payload_json:null});return {meta:{changes:1}};}
  if(sql.includes("UPDATE blue_basket_ai_cache_r15 SET status='READY'")){const c=cache.get(args[1]);if(c){c.status='READY';c.payload_json=args[0];}return {meta:{changes:1}};}
  if(sql.includes('DELETE FROM blue_basket_ai_cache_r15'))cache.delete(args[0]);
  return {meta:{changes:1}};
 }};return stmt;};
 return {prepare,cache};
}
test('missing verified EOD generates no Gemini call',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not call');};
 try{const res=await handleBasketAi(new Request('https://example.com/api/basket/ai',{method:'POST'}),{DB:fakeDb({run:false}),GEMINI_API_KEY:'dummy'});
  assert.equal((await res.json()).status,'NO_VERIFIED_EOD');assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});
test('GET without AI cache never generates candidates or calls provider',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('GET must not call provider');};
 try{const res=await handleBasketAi(new Request('https://example.com/api/basket/ai'),{DB:fakeDb()});
  assert.equal((await res.json()).status,'NOT_CACHED');
 }finally{globalThis.fetch=old;}
});
test('POST uses provider selection, filters to verified symbols and caches',async()=>{
 const db=fakeDb(),old=globalThis.fetch;let called=0;globalThis.fetch=async(_url,req)=>{
  called++;const body=JSON.parse(req.body);assert.ok(body.contents[0].parts[0].text.includes('005930'));
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({picks:[
   {code:'999999',reason:'fake'},{code:'005930',reason:'검증 가능한 신호',risk:'추세 약화',watch:'후속 거래량'}
  ]})}]}}]}),{status:200});
 };
 try{
  const env={DB:db,GEMINI_API_KEY:'fake'};
  const first=await handleBasketAi(new Request('https://example.com/api/basket/ai',{method:'POST'}),env);
  assert.equal(first.status,200);const f=await first.json();assert.equal(f.items.length,1);assert.equal(f.items[0].code,'005930');
  assert.equal(f.items[0].close_price,70000);assert.equal(f.cached,false);
  const second=await handleBasketAi(new Request('https://example.com/api/basket/ai'),env);
  assert.equal((await second.json()).cached,true);assert.equal(called,1);
 }finally{globalThis.fetch=old;}
});
test('AI provider failure never fabricates candidate picks',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>new Response('rate limit',{status:429});
 try{const res=await handleBasketAi(new Request('https://example.com/api/basket/ai',{method:'POST'}),{DB:fakeDb(),GEMINI_API_KEY:'dummy'});
  assert.equal(res.status,429);const j=await res.json();assert.equal(j.error,'AI_QUOTA');assert.equal(j.items,undefined);
 }finally{globalThis.fetch=old;}
});

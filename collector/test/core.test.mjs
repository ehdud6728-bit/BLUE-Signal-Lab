import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kstParts,marketsFor,ageDays,vaultScope,decryptVault,cachedToken,
  normalizeCandidate,candidateSelection,parseQuote,batchStatements,collect,MAX_STOCKS
} from '../src/core.mjs';

const at=(h,m=0,s=0,day='2026-11-11')=>new Date(`${day}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}+09:00`);
function fakeDb({snapshots=[],dbSignals=[],runDay=null,tokenRow=null}={}) {
  const calls=[];
  const db={calls,
    prepare(sql){
      const entry={sql,args:[],bind(...args){this.args=args;return this;},async first(){
        calls.push({type:'first',sql,args:this.args});
        if(sql.includes('blue_kis_token_vault_v1'))return tokenRow;
        if(sql.includes('FROM runs WHERE is_demo=0'))return runDay?{run_id:22,latest_price_date:runDay}:null;
        return null;
      },async all(){
        calls.push({type:'all',sql,args:this.args});
        if(sql.includes('FROM sqlite_master'))return {results:[{name:'blue_kis_live_quotes_r141'},{name:'runs'},{name:'signals'}]};
        if(sql.includes('FROM blue_kis_live_quotes_r141'))return {results:snapshots.map(x=>({payload_json:JSON.stringify(x)}))};
        if(sql.includes('FROM signals WHERE'))return {results:dbSignals};
        return {results:[]};
      },async run(){calls.push({type:'run',sql,args:this.args});return {meta:{changes:1}};}};
      return entry;
    },
    async batch(statements){calls.push({type:'batch',statements});return statements.map(()=>({meta:{changes:1}}));}
  };
  return db;
}
function seed(code='005930',asof='2026-11-10'){
  return {code,name:'가상종목',market:'J',eod_close:1000,eod_asof:asof,eod_signals:'BB20',source_krx_run_id:99};
}
const quote={rt_cd:'0',output:{stck_prpr:'1001',stck_oprc:'998',stck_hgpr:'1002',stck_lwpr:'995',acml_vol:'1988',stck_bsop_date:'20261111'}};

test('KST conversion and weekday cutoff',()=>{
  assert.equal(kstParts(new Date('2026-11-10T23:00:00Z')).date,'2026-11-11');
  assert.deepEqual(marketsFor(at(8)),[['NX','NXT_PRE']]);
  assert.deepEqual(marketsFor(at(8,49)),[['NX','NXT_PRE']]);
  assert.deepEqual(marketsFor(at(8,50)),[]);
  assert.deepEqual(marketsFor(at(9)),[['J','KRX_REGULAR']]);
  assert.equal(marketsFor(at(9,0,30)).length,2);
  assert.equal(marketsFor(at(15,19)).length,2);
  assert.deepEqual(marketsFor(at(15,20)),[]);
  assert.deepEqual(marketsFor(at(15,30)),[]);
  assert.deepEqual(marketsFor(at(15,40)),[['NX','NXT_AFTER']]);
  assert.deepEqual(marketsFor(at(16)),[['J','KRX_AFTER'],['NX','NXT_AFTER']]);
  assert.equal(marketsFor(at(19,59)).length,2);
  assert.deepEqual(marketsFor(at(20)),[]);
  assert.deepEqual(marketsFor(at(10,0,0,'2026-11-14')),[]);
  assert.deepEqual(marketsFor(at(10), '2026-11-11,2026-11-12'),[]);
});

test('Python R1.3.1 AES-GCM/HKDF vault decrypt is byte-compatible',async()=>{
  const app='TEST_APP_KEY_NOT_REAL',secret='TEST_APP_SECRET_NOT_REAL';
  assert.equal(await vaultScope(app),'KIS_PROD_READONLY_V1_351b2b6b1f289da6f91a');
  const encoded='AAECAwQFBgcICQoLHoySzGOkixdwKEhHed2XN1mNTkhM40RLJU6sVjUQNBq2sf1Ot0WpkLk=';
  assert.equal(await decryptVault(encoded,app,secret),'FAKE_ACCESS_TOKEN_EXAMPLE');
  await assert.rejects(()=>decryptVault(encoded,app,'WRONG_SECRET'),/TOKEN_DECRYPT_FAILED/);
});

test('token cache fail-closed on expiry, never calls token issuing endpoint',async()=>{
  const app='TEST_APP_KEY_NOT_REAL',secret='TEST_APP_SECRET_NOT_REAL';
  const encoded='AAECAwQFBgcICQoLHoySzGOkixdwKEhHed2XN1mNTkhM40RLJU6sVjUQNBq2sf1Ot0WpkLk=';
  let db=fakeDb({tokenRow:{ciphertext:encoded,expires_at_utc:'2026-11-11T23:59:00Z'}});
  assert.equal(await cachedToken(db,app,secret,at(9)),'FAKE_ACCESS_TOKEN_EXAMPLE');
  db=fakeDb({tokenRow:{ciphertext:encoded,expires_at_utc:'2026-11-10T22:00:00Z'}});
  assert.equal(await cachedToken(db,app,secret,at(9)),null);
});

test('candidate source preserves verified artifact provenance and does not pretend old EOD is fresh',async()=>{
  const db=fakeDb({snapshots:[seed('005930'),seed('000660'),{...seed('005930'),market:'NX'}]});
  const found=await candidateSelection(db,at(10));
  assert.equal(found.status,'OK');assert.equal(found.items.length,2);
  assert.equal(found.items[0].origin,'R141_VERIFIED_EOD_ARTIFACT');
  assert.equal(found.asof,'2026-11-10');
  assert.equal((await candidateSelection(db,at(10,0,0,'2026-11-20'))).status,'STALE_OR_FUTURE_EOD');
  assert.equal(ageDays('2026-11-11','2026-11-10'),1);
  assert.equal(normalizeCandidate({...seed('@@bad'),eod_close:-1},'x'),null);
});

test('newer non-demo D1 EOD can supersede older snapshot without silently changing asof',async()=>{
  const db=fakeDb({snapshots:[seed()],runDay:'2026-11-11',dbSignals:[{
    code:'000660',day:'2026-11-11',signal_names:'ENV20',close_price:300000,extras_json:'{"name":"SK"}'
  }]});
  const found=await candidateSelection(db,at(9,0,0,'2026-11-12'));
  assert.equal(found.asof,'2026-11-11');assert.equal(found.items[0].code,'000660');
  assert.equal(found.items[0].origin,'D1_NONDEMO_EOD');
});

test('quote is unverified for exchange tick; inconsistent and older trading days rejected',()=>{
  const candidate=normalizeCandidate(seed(),'R141_VERIFIED_EOD_ARTIFACT');
  const q=parseQuote(candidate,'J','KRX_REGULAR',quote,at(9,5),'2026-11-11');
  assert.equal(q.price,1001);assert.equal(q.exchange_tick_time_verified,false);
  assert.equal(q.reported_trade_day_matches_today,true);
  assert.equal(q.market_label,'KRX');
  const old={...quote,output:{...quote.output,stck_bsop_date:'20261110'}};
  assert.throws(()=>parseQuote(candidate,'NX','NXT_AFTER',old,at(17),'2026-11-11'),/PROVIDER_TRADE_DAY_MISMATCH/);
  const inconsistent={...quote,output:{...quote.output,stck_hgpr:'1000'}};
  assert.throws(()=>parseQuote(candidate,'NX','NXT_MAIN',inconsistent,at(11),'2026-11-11'),/QUOTE_INCONSISTENT/);
});

test('D1 100 parameter SQL limit is preserved at 40 valid market quotes',()=>{
  const db=fakeDb();const seedQuote=parseQuote(normalizeCandidate(seed(),'R141_VERIFIED_EOD_ARTIFACT'),'J','KRX_REGULAR',quote,at(9,5),'2026-11-11');
  const list=Array.from({length:40},(_,i)=>({...seedQuote,code:String(i).padStart(6,'0')}));
  const cmds=batchStatements(db,list);
  assert.equal(cmds.length,6);
  for(const c of cmds)assert.ok(c.args.length<=100,`exceeded SQL binding limit: ${c.args.length}`);
});

test('collector disabled produces no D1, GitHub, token, or KIS calls',async()=>{
  const db=fakeDb();const state=await collect({DB:db,COLLECTOR_ENABLED:'false'},at(10));
  assert.equal(state.status,'DISABLED');assert.equal(db.calls.length,0);
});

test('collector outside market produces no database writes',async()=>{
  const db=fakeDb();const state=await collect({DB:db,COLLECTOR_ENABLED:'true'},at(22));
  assert.equal(state.status,'OUTSIDE_MARKET_WINDOW');assert.equal(db.calls.length,0);
});

test('collector lacks current candidate -> pauses without network use',async()=>{
  const db=fakeDb({snapshots:[seed('005930','2026-11-01')]});let count=0;
  const report=await collect({DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'A',KIS_APP_SECRET:'B'},at(10),{quote:()=>{count++}});
  assert.equal(report.status,'PAUSED_NO_FRESH_CANDIDATES');assert.equal(count,0);
});

test('collector missing token -> pauses before KIS requests',async()=>{
  const db=fakeDb({snapshots:[seed()]});let count=0;
  const report=await collect({DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'A',KIS_APP_SECRET:'B'},at(10),{quote:()=>{count++}});
  assert.equal(report.status,'PAUSED_TOKEN_EXPIRED_OR_MISSING');assert.equal(count,0);
});

test('collector reuses cache, persists quote, and logs receipt while leaving token issuance disabled',async()=>{
  const encoded='AAECAwQFBgcICQoLHoySzGOkixdwKEhHed2XN1mNTkhM40RLJU6sVjUQNBq2sf1Ot0WpkLk=';
  const db=fakeDb({snapshots:[seed()],tokenRow:{ciphertext:encoded,expires_at_utc:'2026-11-11T23:59:00Z'}});
  const report=await collect({DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'TEST_APP_KEY_NOT_REAL',KIS_APP_SECRET:'TEST_APP_SECRET_NOT_REAL'},at(8,5),{quote:async()=>quote});
  assert.equal(report.status,'OK');assert.equal(report.attempted,1);assert.equal(report.saved,1);
  assert.ok(db.calls.some(x=>x.type==='run'&&x.sql.includes('INSERT INTO blue_kis_live_quotes_r141')));
  assert.ok(db.calls.some(x=>x.type==='run'&&x.sql.includes('INSERT INTO blue_kis_collector_runs_r142')));
});

test('the collector has no public manual trigger and Cron handler exists',async()=>{
  const {default:handler}=await import('../src/index.mjs');
  const r=await handler.fetch(new Request('https://collector.example/run',{method:'POST'}),{COLLECTOR_ENABLED:'true'});
  assert.equal(r.status,404);assert.equal(typeof handler.scheduled,'function');
});

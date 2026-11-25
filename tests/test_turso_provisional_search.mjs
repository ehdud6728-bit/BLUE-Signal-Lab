import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {InvalidProvisionalQuery,provisionalCandleObservations,tursoProvisionalSearch}
  from '../worker/src/turso-provisional-search.ts';

const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'dummy'};
const now=new Date('2026-11-20T00:30:00.000Z');
function fixture({table=true,directory=false}={}){
  const db=new DatabaseSync(':memory:'),sql=[];
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1
    (trade_day TEXT PRIMARY KEY,row_count INTEGER);
    INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-19',2660);
    CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,high INTEGER,volume INTEGER,market TEXT DEFAULT 'KOSPI');`);
  const eod=db.prepare('INSERT INTO blue_eod_daily_v1(trade_day,code,high,volume) VALUES(?,?,?,?)');
  eod.run('2026-11-19','005930',71500,50000);
  eod.run('2026-11-19','000660',210000,12000);
  for(let i=2;i<2660;i++)eod.run('2026-11-19',String(100000+i),100,1);
  if(table){
    db.exec(`CREATE TABLE blue_kis_provisional_daily_v1 (
      trade_day TEXT,code TEXT,market TEXT,name TEXT,open INTEGER,high INTEGER,
      low INTEGER,close INTEGER,volume INTEGER,reference_day TEXT,
      observed_at_utc TEXT,date_basis TEXT,source TEXT);`);
    const insert=db.prepare(`INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('2026-11-20','005930','J','삼성전자',71000,73000,70000,72500,123456,
      '2026-11-19','2026-11-20T00:29:00Z','COLLECTOR_KST_REGULAR_SESSION',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    insert.run('2026-11-20','000660','J','SK하이닉스',200000,210000,198000,205000,9000,
      '2026-11-19','2026-11-20T00:28:00Z','KIS_REPORTED_TRADE_DATE',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    // Different reference and non-KIS rows cannot masquerade as today's quote.
    insert.run('2026-11-20','123456','J','wrong-reference',10,12,9,11,100,
      '2026-11-18','2026-11-20T00:29:00Z','KIS_REPORTED_TRADE_DATE',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    insert.run('2026-11-20','999999','J','wrong-source',10,12,9,11,100,
      '2026-11-19','2026-11-20T00:29:00Z','KIS_REPORTED_TRADE_DATE','UNVERIFIED');
  }
  if(directory){
    db.exec("CREATE TABLE blue_symbol_directory_v1(code TEXT PRIMARY KEY,name TEXT,market TEXT,asof_day TEXT); INSERT INTO blue_symbol_directory_v1 VALUES('005930','삼성전자','KOSPI','2026-11-19'),('000660','다른시장명','KOSDAQ','2026-11-19'); UPDATE blue_kis_provisional_daily_v1 SET name=code WHERE code IN ('005930','000660')");
  }
  const factory=()=>({async execute(command){
    const text=typeof command==='string'?command:command.sql;
    const args=typeof command==='string'?[]:command.args;
    sql.push(text);
    assert.match(text,/^\s*SELECT\b/i);
    return {rows:db.prepare(text).all(...args)};
  },close(){db.close();}});
  return {factory,sql};
}

test('same-day saved KIS prices are fast, read-only, and explicitly partial',async()=>{
  const f=fixture();
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20'}),f.factory,now);
  assert.equal(result.data_status,'KIS_PARTIAL_PROVISIONAL');
  assert.equal(result.pattern_analysis,false);assert.equal(result.complete_market,false);
  assert.equal(result.reference_market_count,2660);assert.equal(result.observed_count,2);
  assert.equal(result.total,2);assert.equal(result.items.length,2);
  assert.equal(result.items[0].code,'005930');
  assert.equal(result.items[0].pattern_confirmed,false);
  assert.equal(result.observation_preview,true);
  assert.deepEqual(result.items[0].observations,
    ['UP_CANDLE','NEAR_HIGH','ABOVE_REFERENCE_HIGH','DOUBLE_REFERENCE_VOLUME']);
  assert.ok(f.sql.every(sql=>!/(?:INSERT|UPDATE|DELETE|D1|GITHUB_TOKEN|tokenP)/i.test(sql)));
});

test('name filter applies to the stored subset, without fabricating missing stocks',async()=>{
  const f=fixture();
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20',q:'하이닉스'}),f.factory,now);
  assert.equal(result.observed_count,2);assert.equal(result.total,1);
  assert.equal(result.items[0].code,'000660');
});

test('directory fallback fixes code-only names and supports name filtering without cross-market matches',async()=>{
  const f=fixture({directory:true});
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20'}),f.factory,now);
  assert.equal(result.items[0].name,'삼성전자');
  assert.equal(result.items[1].name,'000660');
  const named=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20',q:'삼성'}),fixture({directory:true}).factory,now);
  assert.equal(named.total,1);assert.equal(named.items[0].code,'005930');
});
test('uninitialized provisional storage is an honest zero-coverage result',async()=>{
  const f=fixture({table:false});
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20'}),f.factory,now);
  assert.equal(result.observed_count,0);assert.equal(result.items.length,0);
  assert.equal(result.complete_market,false);
});

test('previous dates, invalid paging, and injected query text are rejected',async()=>{
  for(const p of [{date:'2026-11-19'},{date:'2026-11-20',limit:'51'},
    {date:'2026-11-20',q:'ab\ncd'}]){
    await assert.rejects(()=>tursoProvisionalSearch(env,new URLSearchParams(p),undefined,now),
      InvalidProvisionalQuery);
  }
});

test('candle previews exclude full BLUE signals and require an audited baseline',async()=>{
  assert.deepEqual(provisionalCandleObservations({open:9,high:10,low:8,price:9,volume:200},null),[]);
  const f=fixture();
  const db=f.factory();
  // Baseline completeness is checked before the provisional table is read.
  assert.ok((await tursoProvisionalSearch(env,
    new URLSearchParams({date:'2026-11-20'}),()=>db,now)).observation_preview);
});

test('API route and PWA label provisional data separately from verified research',()=>{
  const api=readFileSync(new URL('../worker/src/index.ts',import.meta.url),'utf8');
  const web=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const card=readFileSync(new URL('../web/src/TursoProvisionalToday.tsx',import.meta.url),'utf8');
  assert.match(api,/\/api\/research\/provisional/);
  assert.match(web,/queryDate===todayKST\(\)&&provisionalWindowKST\(\)/);
  assert.match(web,/TursoProvisionalToday/);
  assert.match(card,/KIS 미확정 관측값/);
});

test('published provisional endpoint reads only promoted generation; EOD takes priority',async()=>{
  const {tursoPublishedProvisional}=await import('../worker/src/turso-published-provisional.ts');
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT PRIMARY KEY,row_count INTEGER); INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-19',2660); CREATE TABLE blue_provisional_pattern_head_v1(trade_day TEXT,reference_day TEXT,snapshot_id TEXT,latest_observed_utc TEXT,scan_asof_utc TEXT,row_count INTEGER,metadata_json TEXT); CREATE TABLE blue_provisional_pattern_rows_v1(snapshot_id TEXT,code TEXT,record_json TEXT,row_sha256 TEXT);");
    const day='2026-11-20',ref='2026-11-19',id='a'.repeat(64),at='2026-11-20T00:29:00Z';
    const factory=()=>({async execute(cmd){assert.match(cmd.sql,/^SELECT\b/);return {rows:db.prepare(cmd.sql).all(...cmd.args)};},close(){}});
    const query=q=>tursoPublishedProvisional(env,new URLSearchParams({date:day,...q}),factory,now);
    assert.equal((await query({})).data_status,'NOT_PUBLISHED');
    const meta={day,status:'KIS_PROVISIONAL',pattern_confirmed:false,scan_asof_utc:at,observed:3,eligible:2,
      quote_coverage:{reference:ref,turnoverAvailable:1},history_metadata:{reference:ref},audit:{matched_stocks:2}};
    db.prepare('INSERT INTO blue_provisional_pattern_head_v1 VALUES(?,?,?,?,?,?,?)').run(day,ref,id,at,at,2,JSON.stringify(meta));
    const row=(code,name,amount)=>JSON.stringify({code,name,market:'KOSPI',date:day,close:100,rsi:55.2,r159_pattern_up_10d:99,signals:code==='000660'?'ENV20,BB20':'ENV40',rsi_gc:code==='000660',ma112_cross:code==='000660',ma20:10,ma40:20,ma60:30,amount_ratio20:amount===null?null:2,observed_at_utc:at,
      provisional:true,pattern_confirmed:false,source:'KIS_PROVISIONAL',turnover_available:amount!==null,traded_amount_krw:amount});
    const insert=db.prepare('INSERT INTO blue_provisional_pattern_rows_v1 VALUES(?,?,?,?)');
    db.exec("CREATE TABLE blue_symbol_directory_v1(code TEXT PRIMARY KEY,name TEXT,market TEXT,asof_day TEXT); INSERT INTO blue_symbol_directory_v1 VALUES('000660','SK하이닉스','KOSPI','2026-11-19');");
    insert.run(id,'000660',row('000660','000660',100000000),'hash');
    insert.run(id,'005930',row('005930','삼성전자',null),'hash');
    insert.run('b'.repeat(64),'999999',row('999999','미공개',100),'hash');
    const result=await query({});
    assert.equal(result.data_status,'KIS_PROVISIONAL_PATTERNS');
    assert.equal(result.total,2);assert.equal(result.items[1].traded_amount_krw,null);
    assert.equal(result.items[0].traded_amount_krw,100000000);
    assert.equal(result.items[0].name,'SK하이닉스');
    assert.equal(result.items[0].extras.rsi,55.2);
    assert.equal(result.items[0].extras.traded_amount_krw,100000000);
    assert.equal(result.items[0].extras.r159_pattern_up_10d,undefined);
    assert.equal(result.items[1].extras.amount_ratio20,null);
    assert.equal((await query({q:'하이닉스'})).items[0].code,'000660');
    assert.deepEqual(result.items[0].signals,['ENV20','BB20']);
    assert.equal((await query({q:'삼성'})).items[0].code,'005930');
    assert.equal((await query({q:'%'})).total,0);
    assert.equal((await query({signals:'ENV20,ENV40',logic:'any'})).total,2);
    assert.equal((await query({signals:'ENV20,BB20',logic:'all'})).total,1);
    assert.equal((await query({signals:'ENV20,ENV40',logic:'all'})).total,0);
    assert.equal((await query({min_amount_eok:'1'})).total,1);
    assert.equal((await query({min_amount_eok:'2'})).total,0);
    assert.equal((await query({gc:'rsi',tech:'ma112,inverse',tech_logic:'all'})).total,1);
    assert.equal((await query({tech:'inverse'})).total,2);
    assert.equal((await query({sort:'amount_decline'})).items[0].code,'000660');
    await assert.rejects(query({gc:'constructor'}),InvalidProvisionalQuery);
    await assert.rejects(query({min_amount_eok:'-1'}),InvalidProvisionalQuery);
    assert.equal((await query({page:'2'})).items.length,0);
    db.prepare('DELETE FROM blue_provisional_pattern_rows_v1 WHERE code=?').run('005930');
    await assert.rejects(query({}),/INVALID_PUBLISHED_PROVISIONAL/);
    db.exec("INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-20',2660)");
    assert.equal((await query({})).data_status,'VERIFIED_EOD_AVAILABLE');
  }finally{db.close();}
});

test('main search requests published KIS snapshot before missing EOD fast path',()=>{
  const web=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  assert.ok(web.indexOf("API+'/api/research/provisional-patterns'")<web.indexOf('// Fast path: a day later'));
  assert.match(web,/setTotal\(live\.total\)/);
  assert.match(web,/setRows\(live\.items\.map/);
  assert.doesNotMatch(web,/<TursoProvisionalPatterns\b/);
  assert.match(web,/className="stock-card"/);
  assert.match(web,/r\.provisional\?'KIS 관측가':'종가'/);
  assert.match(web,/canBasket=\(r:Signal\)=>\(!r\.provisional\|\|/);
  assert.match(web,/kind:'KIS_PROVISIONAL',observedAt/);
  assert.match(web,/rows\.some\(r=>r\.provisional\)/);
  assert.match(web,/activeProvisional\?\.limit\?\?100/);
});

test('KIS AI matches require exact stored candle, count and sort before paging',async()=>{
  const {tursoPublishedProvisional,provisionalCandleFeatures,tursoProvisionalDetail}=await import('../worker/src/turso-published-provisional.ts');
  const {RECENT_ASOF}=await import('../web/src/recent-pattern-data.ts');
  const day=new Date(Date.parse(RECENT_ASOF+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const at=day+'T01:00:00Z',clock=new Date(day+'T02:00:00Z'),id='c'.repeat(64);
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT PRIMARY KEY,row_count INTEGER); CREATE TABLE blue_provisional_pattern_head_v1(trade_day TEXT,reference_day TEXT,snapshot_id TEXT,latest_observed_utc TEXT,scan_asof_utc TEXT,row_count INTEGER,metadata_json TEXT); CREATE TABLE blue_provisional_pattern_rows_v1(snapshot_id TEXT,code TEXT,record_json TEXT,row_sha256 TEXT);');
    db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,2660)').run(RECENT_ASOF);
    const meta={day,status:'KIS_PROVISIONAL',pattern_confirmed:false,scan_asof_utc:at,observed:12,eligible:12,quote_coverage:{reference:RECENT_ASOF,turnoverAvailable:12},history_metadata:{reference:RECENT_ASOF},audit:{matched_stocks:12}};
    db.prepare('INSERT INTO blue_provisional_pattern_head_v1 VALUES(?,?,?,?,?,?,?)').run(day,RECENT_ASOF,id,at,at,12,JSON.stringify(meta));
    const insert=db.prepare('INSERT INTO blue_provisional_pattern_rows_v1 VALUES(?,?,?,?)');
    for(let i=1;i<=12;i++){
      const code=String(i).padStart(6,'0');
      const candle=i===12?{open:80,high:125,low:75,close:100}:{open:100,high:125,low:75,close:100};
      const detail={reference:RECENT_ASOF,chart:{asof:day,pattern_confirmed:false,data_frequency:'PROVISIONAL_DAILY',bars:[{t:day,o:candle.open,h:candle.high,l:candle.low,c:candle.close}]},stats:{asof:day,history_end:RECENT_ASOF,setups:i===12||i===11?[{label:'prior setup',horizons:{'10':{n:i===12?4:8,up_pct:75,mean_return_pct:3,median_return_pct:2,cases:[]}}}]:[]}};
      insert.run(id,code,JSON.stringify({code,name:code,market:'KOSPI',date:day,close:100,signals:'ENV20_LOWER_TOUCH',observed_at_utc:at,provisional_research:detail,
        provisional:true,pattern_confirmed:false,source:'KIS_PROVISIONAL',turnover_available:true,traded_amount_krw:100000000,kis_candle:candle}),'hash');
    }
    const factory=()=>({async execute(cmd){assert.match(cmd.sql,/^SELECT\b/);return {rows:db.prepare(cmd.sql).all(...cmd.args)};},close(){}});
    const query=q=>tursoPublishedProvisional(env,new URLSearchParams({date:day,...q}),factory,clock);
    assert.deepEqual(provisionalCandleFeatures({open:80,high:125,low:75,close:100},100),['BULL','BODY_30_50','CLOSE_MID']);
    assert.equal(provisionalCandleFeatures({open:80,high:125,low:75,close:99},100),null);
    const ordinary=await query({});
    assert.equal(ordinary.total,12);assert.equal(ordinary.ai_count,1);assert.equal(ordinary.items.length,10);
    assert.equal(ordinary.history_ready,true);
    assert.equal((await query({sort:'recommended',min_pattern_n:'3'})).items[0].code,'000012');
    const hot=await query({only_pattern:'1',min_pattern_n:'3',highlight_up:'70',sort:'recommended'});
    assert.equal(hot.total,2);assert.equal(hot.pattern_filter_applied,true);
    assert.equal(hot.items[0].extras.r159_pattern_n_10d,4);
    assert.equal(hot.items[0].extras.r159_pattern_up_10d,75);
    assert.equal((await query({only_pattern:'1',min_pattern_n:'8'})).total,1);
    const detail=await tursoProvisionalDetail(env,new URLSearchParams({date:day,code:'000012',snapshot_id:id}),factory,clock);
    assert.equal(detail.status,'READY');assert.equal(detail.chart.bars.at(-1).c,100);
    assert.equal((await tursoProvisionalDetail(env,new URLSearchParams({date:day,code:'000012',snapshot_id:'d'.repeat(64)}),factory,clock)).status,'NOT_AVAILABLE');
    const only=await query({ai_only:'1'});
    assert.equal(only.total,1);assert.equal(only.unfiltered_total,12);assert.equal(only.ai_only,true);
    assert.equal(only.items[0].code,'000012');
    assert.deepEqual(only.items[0].extras.provisional_candle_features,['BULL','BODY_30_50','CLOSE_MID']);
    assert.equal((await query({q:'000001',ai_only:'1'})).total,0);
    db.prepare("UPDATE blue_provisional_pattern_rows_v1 SET record_json=json_remove(record_json,'$.kis_candle') WHERE code=?").run('000012');
    const old=await query({ai_only:'1'});
    assert.equal(old.ai_count,null);assert.equal(old.ai_only,false);assert.equal(old.ai_evidence_count,11);
    db.prepare("UPDATE blue_provisional_pattern_rows_v1 SET record_json=json_remove(record_json,'$.provisional_research') WHERE code=?").run('000012');
    const legacy=await query({only_pattern:'1'});
    assert.equal(legacy.history_ready,false);assert.equal(legacy.pattern_filter_applied,false);assert.equal(legacy.total,12);
  }finally{db.close();}
});

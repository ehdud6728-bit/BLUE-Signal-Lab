import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CODES,END,START,HistoryFailure,pageUrl,parsePage,requestPage,collectTicker,executeExport}
  from './stockhunter-r16-kis-history.mjs';

const ENV={KIS_APP_KEY:'mock-app-key',KIS_APP_SECRET:'mock-app-secret',
  TURSO_DATABASE_URL:'libsql://placeholder',TURSO_AUTH_TOKEN:'mock-db-token',
  GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'44933333333'};
const NOW=new Date('2026-11-22T01:00:00Z');
const pause=async()=>{};
const sig='b'.repeat(64);
const dates=[];
for(let d=new Date('2025-12-30T00:00:00Z');dates.length<300;d.setUTCDate(d.getUTCDate()-1)) {
  if(d.getUTCDay()!==0&&d.getUTCDay()!==6)dates.push(d.toISOString().slice(0,10));
}
const fixtureRow=(code,date)=>({date,code,open:1000,high:1020,low:990,close:1005,volume:10000,amount:10_050_000});
const getPage=async(code,end)=>({bars:dates.filter(d=>d.replaceAll('-','')<=end).slice(0,100).map(d=>fixtureRow(code,d)),responseSha256:sig});

async function withDir(fn) {
  const dir=await mkdtemp(join(tmpdir(),'blue-r16-kis-'));
  try {await fn(dir);} finally {await rm(dir,{recursive:true,force:true});}
}

test('30 codes fixed exactly, never prior five',()=>{
  assert.equal(CODES.length,30);
  assert.equal(new Set(CODES).size,30);
  for(const x of ['006400','039840','071840','053800','220260'])assert.ok(!CODES.includes(x));
  assert.equal(START,'20200101');assert.equal(END,'20251231');
});

test('only frozen ticker, period, unadjusted KIS GET URL',()=>{
  const u=new URL(pageUrl(CODES[0],END));
  assert.equal(u.pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
  assert.equal(u.searchParams.get('FID_ORG_ADJ_PRC'),'1');
  assert.equal(u.searchParams.get('FID_PERIOD_DIV_CODE'),'D');
  assert.equal(u.searchParams.get('FID_INPUT_DATE_1'),START);
  assert.throws(()=>pageUrl('005930',END),/KIS_REQUEST_OUT_OF_FROZEN_SCOPE/);
  assert.throws(()=>pageUrl(CODES[0],'20260101'),/KIS_REQUEST_OUT_OF_FROZEN_SCOPE/);
});

test('valid raw API parsing, missing amount, duplicate and impossible day rejected',()=>{
  const row=(d)=>({stck_bsop_date:d,stck_oprc:'1000',stck_hgpr:'1020',stck_lwpr:'990',
    stck_clpr:'1005',acml_vol:'1000',acml_tr_pbmn:'1005000'});
  assert.equal(parsePage({rt_cd:'0',output2:[row('20251230')]},CODES[0],END)[0].amount,1005000);
  assert.throws(()=>parsePage({rt_cd:'0',output2:[row('20250931')]},CODES[0],END),/KIS_BAR_DATE/);
  assert.throws(()=>parsePage({rt_cd:'0',output2:[row('20251230'),row('20251230')]},CODES[0],END),/KIS_BAR_DATE/);
  const incomplete=row('20251230');delete incomplete.acml_tr_pbmn;
  assert.throws(()=>parsePage({rt_cd:'0',output2:[incomplete]},CODES[0],END),/KIS_BAR_FIELD_INVALID/);
  assert.throws(()=>parsePage({rt_cd:'0',output2:[row('20260101')]},CODES[0],END),/KIS_BAR_DATE/);
  assert.throws(()=>parsePage({msg_cd:'EGW00201'},CODES[0],END),/KIS_RATE_LIMIT_STOP_ALL/);
});

test('exact KIS GET uses no POST/tokenP and hashes response, rate limit aborts',async()=>{
  let n=0;
  const body=Buffer.from(JSON.stringify({rt_cd:'0',output2:[]}));
  const get=async(url,request)=>{
    n++;
    assert.equal(request.method,'GET');
    assert.equal(request.headers.tr_id,'FHKST03010100');
    assert.equal(request.headers.authorization,'Bearer fake-cached-token');
    assert.equal(new URL(url).pathname,'/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice');
    return {ok:true,status:200,arrayBuffer:async()=>body};
  };
  const result=await requestPage(CODES[0],END,'key','secret','fake-cached-token',{fetchFn:get});
  assert.equal(n,1);
  assert.equal(result.responseSha256,createHash('sha256').update(body).digest('hex'));
  await assert.rejects(requestPage(CODES[0],END,'key','secret','fake-cached-token',{
    fetchFn:async()=>({status:429,ok:false})}),/KIS_RATE_LIMIT_STOP_ALL/);
});

test('280+ bars are fetched backward in 100-bar pages without overlap',async()=>{
  const ends=[];
  const result=await collectTicker(CODES[0],{key:'key',secret:'secret',token:'cached'},
    {pause,getPage:async(code,end)=>{ends.push(end);return getPage(code,end);}});
  assert.equal(result.rows.length,300);
  assert.equal(result.pages.length,4); // three full pages then empty response
  assert.equal(result.coverage.meets_r16_280_bar_minimum,true);
  assert.equal(result.coverage.r16_structural_precheck_pass,true);
  assert.equal(result.coverage.first_requested_date_proven,false);
  assert.equal(new Set(result.rows.map(x=>x.date)).size,300);
  assert.ok(ends.every((x,i)=>!i||x<ends[i-1]));
});

test('dry-run has no DB/REST/secret access and writes only audit summary',async()=>{
  await withDir(async(dir)=>{
    const result=await executeExport(dir,{}, {pause,
      tokenReader:()=>assert.fail('unexpected SELECT'),getPage:()=>assert.fail('unexpected API')});
    assert.equal(result.status,'DRY_RUN_NO_REMOTE_REQUESTS');
    assert.deepEqual(await readdir(dir),['R16_KIS_RUN_SUMMARY.json']);
    const record=JSON.parse(await readFile(join(dir,'R16_KIS_RUN_SUMMARY.json')));
    assert.equal(record.tokenP_calls,0);
  });
});

test('missing secrets and changing 30-code scope fail before network',async()=>{
  await withDir(async(dir)=>{
    const hook=()=>assert.fail('remote access prohibited');
    const a=await executeExport(dir,{}, {mode:'capture',tokenReader:hook,getPage:hook,pause});
    assert.equal(a.error_code,'EXISTING_BLUE_SECRETS_MISSING');
    const b=await executeExport(dir,ENV,{mode:'capture',codes:[...CODES].reverse(),tokenReader:hook,getPage:hook,pause});
    assert.equal(b.error_code,'UNAPPROVED_SCOPE');
  });
});

test('token_check uses only existing cached token with zero KIS quote GETs',async()=>{
  await withDir(async(dir)=>{
    let reads=0;
    const result=await executeExport(dir,ENV,{mode:'token_check',pause,
      tokenReader:async()=>{reads++;return 'fake-cached-token';},
      getPage:()=>assert.fail('KIS GET forbidden during token_check')});
    assert.equal(result.status,'TOKEN_VALID_NO_KIS_REQUESTS');
    assert.equal(reads,1);
    assert.deepEqual(await readdir(dir),['R16_KIS_RUN_SUMMARY.json']);
    assert.ok(!(await readFile(join(dir,'R16_KIS_RUN_SUMMARY.json'),'utf8')).includes('fake-cached-token'));
  });
});

test('cached-token errors are classified without leaking raw exception text',async()=>{
  for(const errorCode of ['EXISTING_TURSO_TOKEN_EXPIRED','EXISTING_TURSO_TOKEN_READ_UNAVAILABLE']) {
    await withDir(async(dir)=>{
      const result=await executeExport(dir,ENV,{mode:'token_check',pause,
        tokenReader:async()=>{const e=new Error('PRIVATE_SECRET_VALUE');e.code=errorCode;throw e;},
        getPage:()=>assert.fail('no KIS GET')});
      assert.equal(result.error_code,errorCode);
      assert.ok(!(await readFile(join(dir,'R16_KIS_RUN_SUMMARY.json'),'utf8')).includes('PRIVATE_SECRET_VALUE'));
    });
  }
  await withDir(async(dir)=>{
    const result=await executeExport(dir,ENV,{mode:'token_check',pause,
      tokenReader:async()=>{const e=new Error('PRIVATE_SECRET_VALUE');e.code='PRIVATE_SECRET_VALUE';throw e;}});
    assert.equal(result.error_code,'UNEXPECTED_SOURCE_ERROR');
  });
});

test('capture uses existing token one time and emits R16 schema plus SHA audit',async()=>{
  await withDir(async(dir)=>{
    let tokenReads=0,apiCalls=0;
    const result=await executeExport(dir,ENV,{mode:'capture',now:NOW,pause,
      tokenReader:async()=>{tokenReads++;return 'fake-cached-token';},
      getPage:async(...args)=>{apiCalls++;return getPage(args[0],args[1]);}});
    assert.equal(result.status,'CAPTURE_COMPLETE_REPLAY_NOT_DONE');
    assert.equal(tokenReads,1);
    assert.equal(apiCalls,30*4);
    assert.equal(result.structurally_valid_ticker_count,30);
    assert.equal(result.row_count,9000);
    const archive=await readFile(join(dir,'R16_KIS_UNADJUSTED_30.csv'));
    assert.equal(archive.toString('utf8').split('\n')[0],'date,code,open,high,low,close,volume,amount');
    assert.equal(result.archive_sha256,createHash('sha256').update(archive).digest('hex'));
    assert.equal(result.audit.length,30);
    assert.equal(result.audit[0].pages.length,4);
    const summary=JSON.parse(await readFile(join(dir,'R16_KIS_RUN_SUMMARY.json')));
    assert.equal(summary.status,'CAPTURE_COMPLETE_REPLAY_NOT_DONE');
    const manifest=JSON.parse(await readFile(join(dir,'R16_KIS_SOURCE_MANIFEST.json')));
    assert.equal(manifest.archive_sha256,result.archive_sha256);
    for(const privateValue of Object.values(ENV)) {
      if(privateValue.startsWith('mock-')||privateValue.startsWith('libsql:'))
        assert.ok(!JSON.stringify(result).includes(privateValue));
    }
  });
});

test('provider rate limit stops entire run without partial successful artifact',async()=>{
  await withDir(async(dir)=>{
    const result=await executeExport(dir,ENV,{mode:'capture',pause,
      tokenReader:async()=> 'fake-cached-token',
      getPage:async()=>{throw new HistoryFailure('KIS_RATE_LIMIT_STOP_ALL');}});
    assert.equal(result.error_code,'KIS_RATE_LIMIT_STOP_ALL');
    assert.deepEqual(await readdir(dir),['R16_KIS_RUN_SUMMARY.json']);
  });
});

test('unadjusted extreme gap not automatically healed or promoted',async()=>{
  const code=CODES[0];
  const jump=dates.slice(0,80).map((d,i)=>({...fixtureRow(code,d),open:i>40?400:1000,
    high:i>40?420:1020,low:i>40?390:990,close:i>40?405:1005}));
  const got=await collectTicker(code,{key:'key',secret:'secret',token:'cached'},
    {pause,getPage:async()=>({bars:jump,responseSha256:sig})});
  assert.equal(got.coverage.extreme_unadjusted_gap_over_35pct,true);
  assert.equal(got.coverage.r16_structural_precheck_pass,false);
});

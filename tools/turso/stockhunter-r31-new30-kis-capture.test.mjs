import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {CODES,FORBIDDEN_R19_CODES,FORBIDDEN_R28_CODES,START,END,EVAL_START,CaptureError,
  frozenCodePreflight,urlFor,parsePage,fetchPage,fetchTicker,capture}
from './stockhunter-r31-unseen2026-kis-capture.mjs';

const CRED={KIS_APP_KEY:'fake-key',KIS_APP_SECRET:'fake-secret',
            TURSO_DATABASE_URL:'libsql://fake',TURSO_AUTH_TOKEN:'fake-token',
            GITHUB_RUN_ID:'45678901234',GITHUB_SHA:'a'.repeat(40)};
const pause=async()=>{};
const sig='e'.repeat(64);
const dates=[];
for(let d=new Date('2026-11-20T00:00:00Z');d>=new Date('2025-01-02T00:00:00Z');d.setUTCDate(d.getUTCDate()-1)){
  if(![0,6].includes(d.getUTCDay()))dates.push(d.toISOString().slice(0,10));
}
const row=(code,date,open=1000,close=1005)=>({date,code,open,high:Math.max(open,close)+10,
    low:Math.min(open,close)-10,close,volume:10000,amount:10050000});
const mockedPage=async(code,end)=>({
  bars:dates.filter(d=>d.replaceAll('-','')<=end).slice(0,100).map(d=>row(code,d)),
  response_sha256:sig,
});
async function inDir(fn){
  const path=await mkdtemp(join(tmpdir(),'blue-r31-source-'));
  try{await fn(path)}finally{await rm(path,{recursive:true,force:true})}
}

test('new fixed 30 symbols disjoint from R19 26 and R28 30',()=>{
  assert.equal(CODES.length,30);
  assert.equal(new Set(CODES).size,30);
  assert.equal(FORBIDDEN_R19_CODES.length,26);
  assert.deepEqual(CODES.filter(x=>FORBIDDEN_R19_CODES.includes(x)),[]);
  assert.deepEqual(CODES.filter(x=>FORBIDDEN_R28_CODES.includes(x)),[]);
  assert.equal(FORBIDDEN_R28_CODES.length,30);
  assert.equal(frozenCodePreflight().overlap_with_R19_26,0);
  assert.equal(frozenCodePreflight().overlap_with_R28_30,0);
  assert.equal(START,'20250102');assert.equal(EVAL_START,'20260102');
  assert.equal(END,'20261120');
});

test('immutable scope refuses re-order or different date or old ticker',()=>{
  assert.throws(()=>frozenCodePreflight([...CODES].reverse()),/FIXED30/);
  for(const [code,end] of [['093320',END],['005930',END],['207940',END],[CODES[0],'20261201'],[CODES[0],'20241230']])
    assert.throws(()=>urlFor(code,end),/UNAPPROVED_PRICE_REQUEST/);
  const u=new URL(urlFor(CODES[0],END));
  assert.equal(u.searchParams.get('FID_ORG_ADJ_PRC'),'1');
  assert.equal(u.searchParams.get('FID_INPUT_DATE_1'),START);
  assert.equal(u.searchParams.get('FID_INPUT_DATE_2'),END);
  assert.equal(u.searchParams.get('FID_PERIOD_DIV_CODE'),'D');
});

test('KIS body must be descending, valid, bounded and have amount',()=>{
  const bar=d=>({stck_bsop_date:d,stck_oprc:'1000',stck_hgpr:'1020',
    stck_lwpr:'990',stck_clpr:'1005',acml_vol:'1000',acml_tr_pbmn:'1005000'});
  const a=parsePage({rt_cd:'0',output2:[bar('20261120')]},CODES[0],END);
  assert.equal(a[0].amount,1005000);
  for(const sample of [
       [bar('20261120'),bar('20261120')],
       [bar('20261120'),bar('20261121')],
       [bar('20261131')],[bar('20241230')]]){
    assert.throws(()=>parsePage({rt_cd:'0',output2:sample},CODES[0],END));
  }
  const missing=bar('20261120');delete missing.acml_tr_pbmn;
  assert.throws(()=>parsePage({rt_cd:'0',output2:[missing]},CODES[0],END),
                /INVALID_DAILY_BAR/);
  assert.throws(()=>parsePage({msg_cd:'EGW00201'},CODES[0],END),
                /RATE_LIMIT/);
});

test('GET-only original KIS history, no POST or token issuance',async()=>{
  const body=Buffer.from(JSON.stringify({rt_cd:'0',output2:[]}));
  let n=0;
  const result=await fetchPage(CODES[0],END,'key','secret','cached',{
    fetchFn:async(url,opt)=>{
      n++;assert.equal(opt.method,'GET');
      assert.equal(opt.headers.tr_id,'FHKST03010100');
      assert.equal(opt.headers.authorization,'Bearer cached');
      return {status:200,ok:true,arrayBuffer:async()=>body};
    }
  });
  assert.equal(n,1);
  assert.equal(result.response_sha256,createHash('sha256').update(body).digest('hex'));
  await assert.rejects(fetchPage(CODES[0],END,'k','s','t',{
    fetchFn:async()=>({status:429,ok:false})}),/RATE_LIMIT/);
});

test('all pages captured backward with strict 2025-26 price coverage',async()=>{
  const got=await fetchTicker(CODES[0],{key:'k',secret:'s',token:'t'},
          {pageFn:mockedPage,pause});
  assert.equal(got.rows.length,dates.length);
  assert.ok(got.rows.length>=350);
  assert.equal(got.rows.at(0).date,'2025-01-02');
  assert.equal(got.rows.at(-1).date,'2026-11-20');
  assert.equal(got.valid,true);
  assert.ok(got.pages.length>=5&&got.pages.length<=8);
  assert.equal(new Set(got.rows.map(x=>x.date)).size,got.rows.length);
});

test('big unadjusted corporate-action-like open gap quarantined',async()=>{
  const get=async(code,end)=>{
    const bars=dates.filter(d=>d.replaceAll('-','')<=end).slice(0,100).map(d=>{
      const j=dates.indexOf(d);
      return row(code,d,j>50?2000:1000,j>50?2005:1005);
    });
    return {bars,response_sha256:sig};
  };
  const got=await fetchTicker(CODES[0],{key:'k',secret:'s',token:'t'},
          {pageFn:get,pause});
  assert.equal(got.valid,false);
  assert.ok(got.coverage.extreme_unadjusted_gaps_gt35pct>=1);
});

test('dry run makes zero token, KIS and DB reads',async()=>{
  await inDir(async(dir)=>{
    const impossible=()=>assert.fail('network forbidden');
    const status=await capture(dir,{},{
      tokenReader:impossible,pageFn:impossible,pause,mode:'dry_run'
    });
    assert.equal(status.status,'DRY_RUN_NO_NETWORK_OR_TOKEN_READ');
    assert.deepEqual(await readdir(dir),['R31_CAPTURE_STATUS.json']);
  });
});

test('unknown credentials abort before any token or KIS request',async()=>{
  await inDir(async(dir)=>{
    const impossible=()=>assert.fail('remote should not be called');
    const x=await capture(dir,{},{
      mode:'capture',tokenReader:impossible,pageFn:impossible,pause});
    assert.equal(x.status,'SOURCE_UNAVAILABLE_FAIL_CLOSED');
    assert.equal(x.failure_code,'EXISTING_BLUE_SECRETS_MISSING');
  });
});

test('invalid 30-code universe rejects before network',async()=>{
  await inDir(async(dir)=>{
    await assert.rejects(capture(dir,{},{
      mode:'dry_run',codes:[...CODES].reverse(),
      tokenReader:()=>assert.fail('not allowed'),
      pageFn:()=>assert.fail('not allowed')
    }),/FIXED30/);
  });
});

test('cached-token check queries once and does not fetch prices',async()=>{
  await inDir(async(dir)=>{
    let checked=0;
    const x=await capture(dir,CRED,{
      mode:'token_check',pause,tokenReader:async()=>{checked++;return 'cached-private';},
      pageFn:()=>assert.fail('KIS quote forbidden in token_check')
    });
    assert.equal(checked,1);
    assert.equal(x.status,'TOKEN_VALID_NO_KIS_PRICE_REQUESTS');
    assert.equal((await readdir(dir)).length,1);
    assert.ok(!(await readFile(join(dir,'R31_CAPTURE_STATUS.json'),'utf8')).includes('cached-private'));
  });
});

test('30 independent tickers captured and SHA-provenance source manifest archived',async()=>{
  await inDir(async(dir)=>{
    let tokens=0,pages=0;
    const x=await capture(dir,CRED,{mode:'capture',pause,
      tokenReader:async()=>{tokens++;return 'cached-secret';},
      pageFn:async(...args)=>{pages++;return mockedPage(args[0],args[1]);},
      now:new Date('2026-11-23T00:00:00Z')});
    assert.equal(x.status,'SOURCE_CAPTURE_COMPLETE_NOT_EVALUATED');
    assert.equal(tokens,1);
    assert.equal(x.valid_tickers,30);
    assert.equal(x.daily_rows,30*dates.length);
    assert.ok(pages>120);
    const data=await readFile(join(dir,x.filename));
    assert.equal(x.raw_csv_sha256,createHash('sha256').update(data).digest('hex'));
    assert.equal(data.toString('utf8').split('\n')[0],
                 'date,code,open,high,low,close,volume,amount');
    const manifest=JSON.parse(await readFile(join(dir,'R31_SOURCE_MANIFEST.json')));
    assert.deepEqual(manifest.valid_codes,CODES);
    assert.equal(manifest.orders_placed,0);
    assert.equal(manifest.overlap_with_R28_30,0);
    assert.equal(manifest.prior_r28_sha256,'2d7e5d414f01e497ac68e191537a468ff82a59dd25a65fa724f1e92dc5e8779b');
    assert.equal(manifest.turso_writes,0);
    assert.equal(manifest.latest_price_date,'2026-11-20');
    assert.ok(!JSON.stringify(x).includes('cached-secret'));
  });
});

test('rate limit stops entire capture, no partial research CSV',async()=>{
  await inDir(async(dir)=>{
    const x=await capture(dir,CRED,{mode:'capture',pause,
      tokenReader:async()=> 'cached',
      pageFn:async()=>{throw new CaptureError('KIS_RATE_LIMIT_STOP_ALL');}});
    assert.equal(x.failure_code,'KIS_RATE_LIMIT_STOP_ALL');
    assert.deepEqual(await readdir(dir),['R31_CAPTURE_STATUS.json']);
  });
});

test('less than 20 eligible codes fails closed rather than replace stocks',async()=>{
  await inDir(async(dir)=>{
    let idx=0;
    const x=await capture(dir,CRED,{mode:'capture',pause,
      tokenReader:async()=> 'cached',
      pageFn:async(code,end)=>{
        if(CODES.indexOf(code)>4)return {bars:[],response_sha256:sig};
        return mockedPage(code,end);
      }});
    assert.equal(x.failure_code,'R31_LESS_THAN_20_VALID_UNSEEN_2026_CODES');
    assert.deepEqual(await readdir(dir),['R31_CAPTURE_STATUS.json']);
  });
});

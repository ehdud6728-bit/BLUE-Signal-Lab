import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {missingKisSearchQuotes} from '../web/src/auto-kis-search.ts';

const day='2026-11-20';
const rows=[{code:'005930',day:'2026-11-19'},
 {code:'000660',day:'2026-11-18'},
 {code:'000660',day:'2026-11-17'},
 {code:'225190',day:'2026-11-20'},
 {code:'00088K',day:'2026-11-18'}];
test('search refresh selects missing or stale KIS prices only once per symbol',()=>{
 const selected=missingKisSearchQuotes(rows,{
  '005930:2026-11-19':{latest_price:65000,latest_day:day},
  '000660:2026-11-18':{latest_price:180000,latest_day:'2026-11-19'},
  '225190:2026-11-20':{status:'NO_LATER_PRICE'},
 },day);
 assert.deepEqual(selected,[rows[1],rows[3],rows[4]]);
 assert.deepEqual(missingKisSearchQuotes(rows,{},day,2),rows.slice(0,2));
 assert.deepEqual(missingKisSearchQuotes([{code:'ABC/12',day},{code:'000000',day:'2026-11-21'}],{},day),[]);
});

test('search automatic requests are bounded, independent from D1 and user click',()=>{
 const web=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 const instant=readFileSync(new URL('../collector/src/turso-direct.mjs',import.meta.url),'utf8');
 assert.match(web,/missingKisSearchQuotes\(rows,result,today\)/);
 assert.match(web,/refreshKisQuoteToTurso\(item\.code,ctrl\.signal\)/);
 assert.match(web,/fetchComparedTursoOnly\(\[item\],ctrl\.signal\)/);
 assert.match(instant,/INSTANT_PER_MINUTE=12/);
 assert.doesNotMatch(instant,/tokenP\(/);
});

test('timestamped same-day quote becomes stale after 15 minutes',()=>{
 const now=new Date('2026-11-20T06:00:00.000Z');
 const item={code:'005930',day:'2026-11-19'};
 const check=(latest_at)=>missingKisSearchQuotes([item],{
  '005930:2026-11-19':{latest_price:65000,latest_day:day,latest_at}
 },day,100,now);
 assert.deepEqual(check('2026-11-20T05:50:00.000Z'),[]);
 assert.deepEqual(check('2026-11-20T05:40:00.000Z'),[item]);
 assert.deepEqual(check('2026-11-20T06:05:00.000Z'),[item]);
 assert.deepEqual(check(null),[]);
});

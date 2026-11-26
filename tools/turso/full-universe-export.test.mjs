import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {exportUniverse} from './full-universe-export.mjs';
const day='2026-10-12',source='KRX_OPENAPI_EXACT_DAY_VERIFIED';
const rows=Array.from({length:1700},(_,i)=>({trade_day:day,code:String(i).padStart(6,'0'),market:i<850?'KOSPI':'KOSDAQ',name:'',open:'100',high:'110',low:'90',close:'101',volume:'100',amount:'10100',source}));
const hash=createHash('sha256').update(rows.map(x=>JSON.stringify(x)+'\n').join('')).digest('hex');
function fake(values=rows){return {async execute({sql}){assert.match(sql,/^SELECT /);if(sql.includes('eod_ingest'))return {rows:[{trade_day:day,row_count:1700,source,day_sha256:hash}]};if(sql.includes('eod_daily'))return {rows:values};if(sql.includes('signal_audit'))return {rows:[]};throw Error('unexpected');}};}
test('entire market, not existing signal stocks, and exact original hash',async()=>{const r=await exportUniverse(fake(),{sessions:30,cutoff:day});assert.equal(r.bars.length,1700);assert.equal(r.days[0].signal_status,'MISSING_AUDIT');assert.equal(r.signals.length,0);assert.equal(r.original_eod_hashes_recomputed,true);});
test('original hash alteration fails closed',async()=>{const changed=rows.map(x=>({...x}));changed[0].close='102';await assert.rejects(exportUniverse(fake(changed),{sessions:30,cutoff:day}),/ORIGINAL_KRX_HASH_MISMATCH/);});

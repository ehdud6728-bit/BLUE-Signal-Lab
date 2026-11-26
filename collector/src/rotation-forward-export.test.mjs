import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {exportFrozenRotation} from './rotation-forward-export.mjs';
const now=new Date('2026-11-26T12:00:00Z'),at='2026-11-25T01:00:00Z',day='2026-11-25';
const snapshot={schema:'BLUE_ROTATION_LEADERS_V1',receipt_day:day,day:'2026-11-24',observed_at_utc:at,mapping_status:'PARTIAL',markets:[{market:'KOSPI',groups:[{code:'0002',name:'fixture',entry:'NEW_ENTRY',leaders:[{code:'000001',name:'fixture',close:100}],followers:[]}]},{market:'KOSDAQ',groups:[]}]};
const payload=JSON.stringify(snapshot);
const row={receipt_day:day,source_observed_at:at,recorded_at:at,payload_json:payload,payload_sha256:createHash('sha256').update(payload).digest('hex')};
function fake(rows,exists=true){return {async execute(q){assert.match(q.sql,/^SELECT/);return {rows:q.sql.includes('sqlite_master')?(exists?[{name:'blue_rotation_observations_v1'}]:[]):rows}}}}
test('no archive means no retrospective cohort',async()=>{assert.deepEqual((await exportFrozenRotation(fake([],false),now)).archives,[])});
test('hash and receipt validated; export minimal private linkage only',async()=>{
 const a=(await exportFrozenRotation(fake([row]),now)).archives[0];assert.deepEqual(a.candidates,[{market:'KOSPI',code:'000001',role:'LEADER'}]);
 await assert.rejects(exportFrozenRotation(fake([{...row,payload_sha256:'0'.repeat(64)}]),now),/HASH_MISMATCH/);
 await assert.rejects(exportFrozenRotation(fake([{...row,recorded_at:'2026-11-24T01:00:00Z'}]),now),/TIMESTAMP/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {safeTailRecords} from '../tools/tail-diagnostic.mjs';

const event=(...messages)=>JSON.stringify({
  eventTimestamp:Date.parse('2026-11-18T10:30:00.000Z'),
  event:{request:{url:'https://secret.example/private?token=TOP_SECRET'}},
  logs:messages.map(message=>({message:[message]}))
});

test('allows only fixed collector statuses and sanitized reason codes',()=>{
  const records=safeTailRecords(event('BLUE_R142 status=PAUSED_NO_FRESH_CANDIDATES reason=NO_VERIFIED_CANDIDATES attempted=0 saved=0 rejected=0'));
  assert.deepEqual(records,[{
    kind:'collector',status:'PAUSED_NO_FRESH_CANDIDATES',
    message:'at_utc=2026-11-18T10:30:00.000Z BLUE_R142 status=PAUSED_NO_FRESH_CANDIDATES reason=NO_VERIFIED_CANDIDATES attempted=0 saved=0 rejected=0'
  }]);
});

test('supports older status lines but never leaks URLs, tokens, SQL or arbitrary logs',()=>{
  const records=safeTailRecords(event(
    'BLUE_R142 status=OK attempted=2 saved=2 rejected=0',
    'SELECT * FROM tokens TOKEN=TOP_SECRET',
    'BLUE_R142 status=CHANGED_BY_ATTACKER attempted=0 saved=0 rejected=0'
  ));
  assert.equal(records.length,1);
  assert.equal(records[0].status,'OK');
  assert.equal(records[0].message.includes('TOP_SECRET'),false);
  assert.equal(records[0].message.includes('secret.example'),false);
});

test('recognizes Turso mirrored batches and known error messages only',()=>{
  const records=safeTailRecords(event(
    'BLUE_TURSO_MIRROR status=OK mode=PILOT saved=2',
    'BLUE_TURSO_MIRROR_WRITE_FAILED',
    'BLUE_QUOTE_SHARED provider_calls=5 reused_calls=7',
    'BLUE_TURSO_MIRROR status=OK mode=PRIVATE_TOKEN saved=2'
  ));
  assert.deepEqual(records.map(record=>record.kind),['mirror','warning','provider']);
});

test('includes only known Turso provisional status fields and never echoes arbitrary data',()=>{
  const records=safeTailRecords(event(
    'BLUE_TURSO_PROVISIONAL status=SAVED phase=KRX_POST_CLOSE saved=9 rejected=1',
    'BLUE_TURSO_PROVISIONAL status=VERIFIED_EOD_ALREADY_AVAILABLE phase=NONE saved=0 rejected=0',
    'BLUE_TURSO_PROVISIONAL status=TURSO_TOKEN_EXPIRED phase=NONE saved=0 rejected=0',
    'BLUE_TURSO_PROVISIONAL_FAILED',
    'BLUE_TURSO_PROVISIONAL status=SAVED phase=KRX_POST_CLOSE saved=9 rejected=1 token=secret',
    'BLUE_TURSO_PROVISIONAL status=UNTRUSTED phase=NONE saved=0 rejected=0'
  ));
  assert.deepEqual(records.map(record=>record.kind),
    ['provisional','provisional','provisional','warning']);
  assert.equal(records[0].message,
    'at_utc=2026-11-18T10:30:00.000Z BLUE_TURSO_PROVISIONAL status=SAVED phase=KRX_POST_CLOSE saved=9 rejected=1');
  assert.equal(records.some(record=>record.message.includes('secret')),false);
});

test('ignores malformed JSON and input without a logs array',()=>{
  assert.deepEqual(safeTailRecords('wrangler startup text'),[]);
  assert.deepEqual(safeTailRecords('{"logs":null}'),[]);
  assert.deepEqual(safeTailRecords('x'.repeat(256*1024+1)),[]);
  assert.equal(safeTailRecords(JSON.stringify({eventTimestamp:1e99,logs:[{message:['BLUE_TURSO_MIRROR_WRITE_FAILED']}]}))[0].message.startsWith('at_utc=UNKNOWN'),true);
});

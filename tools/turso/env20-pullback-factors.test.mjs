import test from 'node:test';
import assert from 'node:assert/strict';
import {storedContext} from './env20-pullback-factors.mjs';
const e={supply_strength_method:'DAILY_HL_UNIFORM_120_V2',supply_profile_status:'READY',supply_reference_price:105,supply_strength_relative_pct:80,supply_strength_grade:'강'};
const get=x=>storedContext(JSON.stringify({extras:x}),100).supply;
test('only valid same-record overhead estimate, never lower support',()=>{
 assert.equal(get(e).status,'STORED_ESTIMATE');assert.ok(Math.abs(get(e).distance_pct-5)<1e-9);
 assert.equal(get({...e,supply_reference_price:99}).status,'UNKNOWN');
 assert.equal(get({...e,supply_strength_grade:'약'}).status,'UNKNOWN');
 assert.equal(get({...e,supply_strength_method:'other'}).status,'UNKNOWN');
 assert.equal(get({...e,supply_profile_status:'NO_UPPER_CONCENTRATION'}).status,'NO_UPPER_CONCENTRATION');
});

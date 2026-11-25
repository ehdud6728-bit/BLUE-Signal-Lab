import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesJointBases} from '../web/src/combined-pattern-match.ts';
const e={rsi_gc:'True',ma20:'10',ma40:'20',ma60:'30'};
test('exact envelope and joint factors only',()=>{
 assert.deepEqual(matchesJointBases(['ENV20','ENV20_LOWER_TOUCH'],['LONG_BULL'],e,false),['ENV20','ENV20_LOWER_TOUCH']);
 for(const x of [{...e,rsi_gc:'False'},{...e,ma60:null},{...e,ma40:30},{...e,ma20:true},undefined])assert.deepEqual(matchesJointBases(['ENV20'],['LONG_BULL'],x,false),[]);
 assert.deepEqual(matchesJointBases(['ENV20'],['LONG_BULL','BEAR'],e,false),[]);
 assert.deepEqual(matchesJointBases(['ENV20'],['LONG_BULL'],e,true),[]);
 assert.deepEqual(matchesJointBases(['ENV40'],['LONG_BULL'],e,false),[]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validChartCode} from '../worker/src/chart-query.ts';

test('chart API supports ordinary and genuine KRX alphanumeric six-character codes',()=>{
  assert.equal(validChartCode('225190'),true);
  assert.equal(validChartCode('00088K'),true);
  assert.equal(validChartCode('00088A'),true);
  assert.equal(validChartCode('00088a'),false);
  assert.equal(validChartCode('00088K OR 1=1'),false);
  assert.equal(validChartCode(''),false);
});

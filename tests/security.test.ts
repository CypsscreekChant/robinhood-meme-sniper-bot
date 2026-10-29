import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateRisk, riskFields} from '../src/security/policy.js';
const pair = '0x0000000000000000000000000000000000000001';
const good = () => ({...Object.fromEntries(riskFields.map(f => [f, '0'])), is_open_source: '1', buy_tax: '0', sell_tax: '0.000', holders: [{address: pair, percent: '0.95'}, {address: '0xholder', percent: '0.05'}]});
test('known zero-risk fields pass with pool concentration excluded', () => assert.deepEqual(evaluateRisk(good(),1000,[pair]), []));
test('every dangerous field and every unknown field fails closed', () => {
 for (const field of riskFields) {
  assert.ok(evaluateRisk({...good(),[field]:'1'},1000,[pair]).length);
  assert.ok(evaluateRisk({...good(),[field]:undefined},1000,[pair]).length);
 }
});
test('taxes, unknown taxes, unverified contracts and concentrated holders rejected', () => {
 for (const value of ['', undefined, 'NaN', '-1', '0.01']) assert.ok(evaluateRisk({...good(),sell_tax:value},1000,[pair]).length);
 assert.ok(evaluateRisk({...good(),is_open_source:'0'},1000,[pair]).length);
 assert.ok(evaluateRisk(good(),1000,[]).length);
 assert.ok(evaluateRisk({...good(),holders:[]},1000,[pair]).length);
 assert.ok(evaluateRisk({...good(),holders:[{address:'x',percent:''}]},1000,[pair]).length);
});

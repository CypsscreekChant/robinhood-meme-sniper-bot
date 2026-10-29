import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {renderDashboard, redact, clean, type View} from '../src/ui/terminal.js';
const view:View={config:{mode:'paper',walletAddress:'0x1234567890123456789012345678901234567890',buy:1000000000000000n,daily:10000000000000000n,liquidity:5000000000000000000n,slippage:100,takeProfit:5000,stopLoss:2000,hold:3600,poll:3000,positions:3} as any,
 phase:'listening',started:0,now:40000,cursor:100,head:120,scannedAt:1000,events:[],counters:{pairs:0,rejected:0,buys:0,sells:0,errors:0}};
test('dashboard shows simulation, real scan lag and explicit entry-cost semantics',()=>{
 const text=renderDashboard(view,100,40,false);
 assert.match(text,/PAPER MODE · NO REAL TRANSACTIONS/);assert.match(text,/Scanned 100/);assert.match(text,/target 120/);
 assert.match(text,/DELAYED/);assert.match(text,/0 candidates/);assert.doesNotMatch(text,/\x1b/);
 for(const line of text.split('\n'))assert.ok([...line].length<=98);
 const live=renderDashboard({...view,config:{...view.config,mode:'live'}},100,40,false);
 assert.match(live,/LIVE MODE · REAL FUNDS/);
});
test('small terminals stay compact and control sequences from events are stripped',()=>{
 const text=renderDashboard(view,35,12,false);assert.ok(text.split('\n').length<=11);
 for(const line of text.split('\n'))assert.ok([...line].length<=34);
 assert.equal(clean('hello\x1b[2J\nworld'),'hello world');
});
test('recursive credential redaction preserves public token address and bigint',()=>{
 assert.deepEqual(redact({privateKey:'secret',nested:{appSecret:'secret',access_token:'secret'},token:'0xabc',amount:1n}),{privateKey:'[REDACTED]',nested:{appSecret:'[REDACTED]',access_token:'[REDACTED]'},token:'0xabc',amount:'1'});
});
test('redirected auto logs remain parseable JSON with no terminal escape sequences',()=>{
 const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',"import {log} from './src/log.ts'; log('test',{privateKey:'DO_NOT_PRINT',amount:1n});"],{encoding:'utf8',env:{...process.env,LOG_FORMAT:'auto'}});
 assert.equal(result.status,0);assert.doesNotMatch(result.stdout,/\x1b|DO_NOT_PRINT/);
 assert.equal(JSON.parse(result.stdout).privateKey,'[REDACTED]');
});

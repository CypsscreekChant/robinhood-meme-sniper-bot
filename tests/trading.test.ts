import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {minimumOut, exitReason} from '../src/trading/rules.js';
import {Store, acquireLock} from '../src/state.js';
import {Executor} from '../src/trading/executor.js';
import {checkGoPlus} from '../src/security/goplus.js';
test('slippage floor and exit boundaries use integer arithmetic',()=>{
 assert.equal(minimumOut(1000n,100),990n); assert.throws(()=>minimumOut(1n,100));
 assert.equal(exitReason(150n,100n,0,5000,2000,3600),'take-profit');
 assert.equal(exitReason(80n,100n,0,5000,2000,3600),'stop-loss');
 assert.equal(exitReason(100n,100n,3600,5000,2000,3600),'max-hold');
 assert.equal(exitReason(100n,100n,0,5000,2000,3600),undefined);
});
test('state preserves pending tx and blocks concurrent process or wrong wallet',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sniper-test-'));
 try { const release=acquireLock(dir,'paper'); assert.throws(()=>acquireLock(dir,'paper'));
 const s=new Store(dir,'paper','id'); s.state.pending={kind:'buy',hash:'0xhash',time:1}; s.save();
 assert.equal(new Store(dir,'paper','id').state.pending?.hash,'0xhash');
 assert.throws(()=>new Store(dir,'paper','different')); release();
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('paper buy/sell persists positions, daily cap and no token reentry',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sniper-test-'));
 try {const store=new Store(dir,'paper','id');
 const dex:any={config:{buy:100n,daily:100n,positions:2,slippage:100,mode:'paper',key:'0x'+'1'.repeat(64)},quote:async()=>1000n};
 const ex=new Executor(dex,store); assert.equal(ex.wallet, undefined); ex.wallet = {signTransaction: () => {throw new Error('Paper must not sign');}} as any; const candidate:any={token:'0xabc',pair:'0xpair'};
 assert.equal(await ex.buy(candidate),true); assert.equal(store.state.positions.length,1);
 assert.equal(await ex.buy({...candidate,token:'0xdef'}),false);
 await ex.sell(store.state.positions[0],'test'); assert.equal(store.state.positions.length,0);
 store.state.spent='0'; assert.equal(await ex.buy(candidate),false);
 assert.equal(new Store(dir,'paper','id').state.seen.length,1);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('security network failure and absent result never count as safe',async()=>{
 const original=globalThis.fetch;
 try {
 globalThis.fetch=async()=>new Response('{}',{status:503}); await assert.rejects(checkGoPlus('0xabc','0xpair',1000));
 globalThis.fetch=async()=>new Response(JSON.stringify({code:1,result:{}})); await assert.rejects(checkGoPlus('0xabc','0xpair',1000));
 } finally {globalThis.fetch=original;}
});
test('broadcast failure leaves prewritten hash and blocks a new buy',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sniper-test-'));
 try { const store=new Store(dir,'live','id'); const provider:any={getFeeData:async()=>({gasPrice:1n}),getBalance:async()=>10000000n,getTransactionCount:async()=>0,broadcastTransaction:async()=>{throw new Error('lost response');}};
 const dex:any={provider,config:{mode:'live',key:'0x'+'1'.repeat(64),gasPrice:2n,maxFee:100000n,reserve:1n}};
 const ex=new Executor(dex,store); ex.wallet={address:'0xabc',estimateGas:async()=>21000n,signTransaction:async()=> '0x1234'} as any;
 await assert.rejects(ex.transact('buy:test',{value:1n}));
 assert.match(new Store(dir,'live','id').state.pending!.hash!,/^0x[0-9a-f]{64}$/);
 assert.equal(await ex.buy({token:'0xabc'} as any),false);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

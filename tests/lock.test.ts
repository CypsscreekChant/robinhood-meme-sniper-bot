import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {acquireLock} from '../src/state.js';
function fixture(run:(dir:string)=>void){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sniper-lock-'));try{run(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('dead process lock is recovered without touching saved state',()=>fixture(dir=>{
 const child=spawnSync(process.execPath,['-e',''],{encoding:'utf8'});assert.equal(child.status,0);
 fs.writeFileSync(path.join(dir,'paper.lock'),String(child.pid));fs.writeFileSync(path.join(dir,'paper.json'),'preserve-state');
 const release=acquireLock(dir,'paper');
 assert.equal(fs.readFileSync(path.join(dir,'paper.lock'),'utf8'),String(process.pid));
 assert.equal(fs.readFileSync(path.join(dir,'paper.json'),'utf8'),'preserve-state');
 release();assert.equal(fs.existsSync(path.join(dir,'paper.lock')),false);
}));
test('active PID remains protected and gives actionable error',()=>fixture(dir=>{
 const release=acquireLock(dir,'paper');
 assert.throws(()=>acquireLock(dir,'paper'),(e:any)=>e.code==='BOT_ALREADY_RUNNING'&&e.message.includes(String(process.pid)));
 assert.equal(fs.existsSync(path.join(dir,'paper.lock.recovery')),false);release();
}));
test('invalid lock and concurrent recovery guard are not silently removed',()=>fixture(dir=>{
 const lock=path.join(dir,'paper.lock');fs.writeFileSync(lock,'');
 assert.throws(()=>acquireLock(dir,'paper'),(e:any)=>e.code==='INVALID_LOCK_FILE');assert.ok(fs.existsSync(lock));
 fs.writeFileSync(lock+'.recovery','');
 assert.throws(()=>acquireLock(dir,'paper'),(e:any)=>e.code==='LOCK_RECOVERY_BUSY');assert.ok(fs.existsSync(lock+'.recovery'));
}));

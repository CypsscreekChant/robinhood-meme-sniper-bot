import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {GoPlusAuth} from '../src/security/auth.js';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const issued=(token='Bearer test-token',expires=7200)=>json({code:1,result:{access_token:token,expires_in:expires}});
const credentials={appKey:'fixture-key',appSecret:'fixture-secret'};

test('signs locally, strips Bearer, shares concurrent issuance and renews before expiry',async()=>{
 let now=1700000000000,calls=0;
 const auth=new GoPlusAuth(credentials,async(url,init)=>{
  assert.equal(url,'https://api.gopluslabs.io/api/v1/token');
  const body=JSON.parse(String(init?.body));
  assert.deepEqual(Object.keys(body).sort(),['app_key','sign','time']);
  assert.equal(body.sign,createHash('sha1').update(credentials.appKey+body.time+credentials.appSecret).digest('hex'));
  calls++; return issued('Bearer token-'+calls);
 },()=>now);
 assert.deepEqual(await Promise.all([auth.getToken(),auth.getToken(),auth.getToken()]),['token-1','token-1','token-1']);
 assert.equal(calls,1); now+=7139*1000; assert.equal(await auth.getToken(),'token-1');
 now+=1000; assert.equal(await auth.getToken(),'token-2'); assert.equal(calls,2);
});
test('failed refresh never silently reuses an expired token and can recover',async()=>{
 let now=1700000000000,fail=false;
 const auth=new GoPlusAuth(credentials,async()=>fail?json({},503):issued(),()=>now);
 await auth.getToken(); now+=7200*1000; fail=true;
 await assert.rejects(auth.getToken(),/refresh failed/);
 fail=false; assert.equal(await auth.getToken(),'test-token');
});
test('rejects partial credentials and invalid issuance payloads',async()=>{
 assert.throws(()=>new GoPlusAuth({appKey:'x'}),/both/);
 assert.throws(()=>new GoPlusAuth({appSecret:'x'}),/both/);
 for(const body of [{code:1,result:{access_token:'x',expires_in:0}},{code:1,result:{access_token:'bad token',expires_in:7200}},{code:4012},{code:1,result:{expires_in:7200}}]){
  await assert.rejects(new GoPlusAuth(credentials,async()=>json(body)).getToken());
 }
});
test('HTTP 401 and API 4023 refresh once; bearer headers are not duplicated',async()=>{
 for(const status of ['http','api']) {
 let issues=0,checks=0; const times:number[]=[];
 const auth=new GoPlusAuth(credentials,async(url,init)=>{
  if(String(url).endsWith('/token')){times.push(JSON.parse(String(init?.body)).time);return issued('Bearer token-'+(++issues));}
  checks++; assert.equal(new Headers(init?.headers).get('Authorization'),'Bearer token-'+issues);
  return checks===1?(status==='http'?new Response('Unauthorized',{status:401}):json({code:4023})):json({code:1,result:{ok:true}});
 },()=>1700000000000);
 assert.equal((await auth.securityReport('0xtoken')).code,1);
 assert.equal(issues,2);assert.equal(checks,2);assert.ok(times[1]>times[0]);
 }
});
test('repeated auth rejection is bounded; quota errors are not retried',async()=>{
 for(const status of [401,429]) {
  let issues=0,checks=0;
  const auth=new GoPlusAuth(credentials,async(url)=>String(url).endsWith('/token')?(issues++,issued()):(checks++,new Response('',{status})));
  await assert.rejects(auth.securityReport('0xtoken'));
  assert.equal(issues,status===401?2:1);assert.equal(checks,status===401?2:1);
 }
});
test('app credentials override manual token; manual and anonymous modes stay supported',async()=>{
 const automatic=new GoPlusAuth({...credentials,token:'old'},async()=>issued('fresh'));
 assert.equal(await automatic.getToken(),'fresh');
 for(const token of ['Bearer manual',undefined]) {
  const auth=new GoPlusAuth({token},async(url,init)=>{
   assert.ok(String(url).includes('/token_security/'));
   assert.equal(new Headers(init?.headers).get('Authorization'),token?'Bearer manual':null);
   return json({code:1,result:{}});
  });
  await auth.securityReport('0xtoken');
 }
});

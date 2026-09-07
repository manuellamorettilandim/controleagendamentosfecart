import assert from "node:assert/strict";
import test from "node:test";
import { SessionStarter, type SessionStartJob } from "../src/session-start.js";

const job: SessionStartJob = {reservation_id:"r",account_id:"a",ends_at:new Date(Date.now()+300000).toISOString(),claim_token:"claim",enabled_models:["allowed-model"]};
test("startup sends one small message without a browser and verifies completion", async () => {
  const calls: Array<{method:string;params?:Record<string,unknown>}> = [];
  const statuses: string[]=[];
  let claimed=false;
  const db={claimSessionStarts:async()=>claimed?[]:(claimed=true,[job]), updateSessionStart:async(_id:string,_token:string,status:string)=>{statuses.push(status);return true;}};
  const worker={ready:true, refreshSnapshot:async()=>{},request:async(method:string,params?:Record<string,unknown>)=>{
    calls.push({method,params});
    if(method==='model/list')return {data:[{id:'allowed-model'}]};
    if(method==='thread/start')return {thread:{id:'thread'}};
    if(method==='turn/start')return {turn:{id:'turn',status:'inProgress'}};
    if(method==='thread/read')return {thread:{turns:[{id:'turn',status:'completed'}]}};
    throw new Error(method);
  }};
  const starter=new SessionStarter(db,async()=>worker,()=>{});
  await Promise.all([starter.tick(),starter.tick()]);await starter.tick();
  assert.equal(calls.filter(x=>x.method==='turn/start').length,1);
  assert.equal(calls.find(x=>x.method==='thread/start')?.params?.sandbox,'read-only');
  assert.deepEqual(statuses,['submitting','submitted','completed']);
});
test("ambiguous startup is recorded and never blindly retried",async()=>{
  const statuses:string[]=[];let claimed=false;
  const starter=new SessionStarter({claimSessionStarts:async()=>claimed?[]:(claimed=true,[job]),updateSessionStart:async(_id,_token,status)=>{statuses.push(status);return true;}},async()=>({ready:true,refreshSnapshot:async()=>{},request:async(method)=>{
    if(method==='model/list')return {data:[{id:'allowed-model'}]};
    if(method==='thread/start')return {thread:{id:'thread'}};
    throw new Error('Provider acknowledgement lost');
  }}),()=>{});
  await starter.tick();await starter.tick();assert.deepEqual(statuses,['submitting','uncertain']);
});
test("startup does not send a message after the booking ends",async()=>{
  let workerCalls=0;const statuses:string[]=[];
  const starter=new SessionStarter({claimSessionStarts:async()=>[{...job,ends_at:'2000-01-01T00:00:00Z'}],updateSessionStart:async(_id,_token,status)=>{statuses.push(status);return true;}},async()=>{workerCalls++;throw new Error('unexpected');},()=>{});
  await starter.tick();assert.equal(workerCalls,0);assert.deepEqual(statuses,['retry']);
});

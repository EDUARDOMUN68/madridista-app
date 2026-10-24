import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LineupNotices,sendToDevices} from './worker.mjs';
import {FEED_URL} from './core.mjs';
test('Servicio: transición real, cola persistente, reintento, receptores compatibles y alta sin pasado',async()=>{
 const originalFetch=globalThis.fetch,originalNow=Date.now;
 let now=originalNow(),phase='pre',goals=[],fail=false;Date.now=()=>now;
 const start=now-60000,parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',dateStyle:'short',timeStyle:'short',hourCycle:'h23'}).format(new Date(start)).split(' ');
 const fixture={competition:'Champions',status:'scheduled',date:parts[0],time:parts[1],venue:'home',jornada:3};
 const game=()=>({id:'999',date:new Date(start).toISOString(),status:{period:phase==='second'||phase==='final'?2:1,type:{state:phase==='pre'?'pre':phase==='final'?'post':'in',completed:phase==='final',name:phase==='half'?'STATUS_HALFTIME':'STATUS_IN_PROGRESS'}},competitors:[{id:'86',homeAway:'home',team:{displayName:'Real Madrid'},score:String(goals.length)},{id:'1',homeAway:'away',team:{displayName:'Rival'},score:'0'}]});
 const data=new Map(),ctx={blockConcurrencyWhile:fn=>fn(),storage:{async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async delete(k){data.delete(k);},async list({prefix='' }={}){return new Map([...data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}}};
 const object=new LineupNotices(ctx,{VAPID_PUBLIC_KEY:'configured',VAPID_PRIVATE_KEY:'configured'}),delivered=[];
 object.deliver=async(sub,notice)=>{delivered.push({endpoint:sub.endpoint,notice});return new Response(null,{status:fail?503:201});};
 const register=(endpoint,version)=>object.fetch(new Request('https://internal/subscription',{method:'POST',body:JSON.stringify({subscription:{endpoint},receiverVersion:version,confirmationReceived:true})}));
 const check=()=>object.fetch(new Request('https://internal/check'));
 globalThis.fetch=async input=>{
   const url=String(input);if(url===FEED_URL)return Response.json({fixtures:[fixture]});
   assert.match(url,/uefa\.champions/);
   if(url.includes('/scoreboard?'))return Response.json({events:[{id:'999',competitions:[{...game(),details:goals.map(e=>({...e,athletesInvolved:e.participants.map(p=>p.athlete)}))}]}]});
   assert.equal(phase,'pre','El directo no espera ni consulta el resumen');
   return Response.json({header:{competitions:[game()]},keyEvents:goals});
 };
 try{
   await register('modern','3.28.0');await register('old','3.25.1');await check();assert.equal(delivered.length,0);
   now+=60000;phase='first';await Promise.all([check(),check()]);assert.equal(delivered.length,1);assert.equal(delivered[0].endpoint,'modern');
   now+=60000;goals=[{id:'g1',scoringPlay:true,type:{type:'goal'},team:{id:'86'},period:{number:1},clock:{value:120,displayValue:"2'"},participants:[{athlete:{displayName:'Mbappé'}}]}];fail=true;await check();assert.equal(delivered.length,2);
   fail=false;now+=60000;await check();assert.equal(delivered.length,3);assert.match(delivered[2].notice.body,/1–0/);
   const reloaded=new LineupNotices(ctx,{VAPID_PUBLIC_KEY:'configured',VAPID_PRIVATE_KEY:'configured'});reloaded.deliver=object.deliver;await reloaded.fetch(new Request('https://internal/check'));assert.equal(delivered.length,3);
   now+=1000;await register('new','3.28.0');await check();assert.equal(delivered.length,3,'Nuevo dispositivo no reproduce la cola anterior');
   now+=60000;phase='half';await check();assert.equal(delivered.length,5);assert.ok(delivered.slice(3).every(d=>/Descanso/.test(d.notice.title)));
   await object.fetch(new Request('https://internal/subscription',{method:'DELETE',body:JSON.stringify({endpoint:'modern'})}));
   now+=60000;await register('late','3.28.0');phase='second';await check();assert.equal(delivered.length,6);assert.equal(delivered.at(-1).endpoint,'new');assert.ok(!delivered.some(d=>d.endpoint==='late'),'No reproduce transición detectada después de un alta a mitad del partido');
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});


test('Prueba diferida por dispositivo, limitada y enviada por alarma sin ventana abierta',async()=>{
 const data=new Map();let alarm=null,now=Date.now();const originalNow=Date.now;Date.now=()=>now;
 const ctx={blockConcurrencyWhile:fn=>fn(),storage:{async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async delete(k){data.delete(k);},async list({prefix='' }={}){return new Map([...data].filter(([k])=>k.startsWith(prefix)));},async getAlarm(){return alarm;},async setAlarm(at){alarm=at;}}};
 const object=new LineupNotices(ctx,{}),sent=[];object.deliver=async(sub,n)=>{sent.push({sub,n});return new Response(null,{status:201});};
 const register=(endpoint,testDelay)=>object.fetch(new Request('https://internal/subscription',{method:'POST',body:JSON.stringify({subscription:{endpoint},receiverVersion:'3.28.0',confirmationReceived:true,testDelay})}));
 try{
   const response=await register('phone-one',30);assert.equal((await response.json()).testScheduled,true);assert.equal(alarm,now+30000);assert.equal(sent.length,0);
   assert.equal((await register('phone-one',30)).status,429);
   await register('phone-two');now+=30001;await object.alarm();assert.equal(sent.length,1);assert.equal(sent[0].sub.endpoint,'phone-one');assert.match(sent[0].n.testId,/^[a-f0-9-]{36}$/);
   await object.alarm();assert.equal(sent.length,1);
   now+=60000;await register('phone-one',30);await object.fetch(new Request('https://internal/subscription',{method:'DELETE',body:JSON.stringify({endpoint:'phone-one'})}));now+=30001;await object.alarm();assert.equal(sent.length,1,'No enviar tras baja del dispositivo');
 }finally{Date.now=originalNow;}
});
test('Un dispositivo lento no retiene los demás; concurrencia limitada a cuatro',async()=>{
 let release,active=0,maximum=0;const sent=[],blocked=new Promise(resolve=>{release=resolve;});
 const work=sendToDevices(Array.from({length:8},(_,i)=>i),async i=>{active++;maximum=Math.max(maximum,active);if(i===0)await blocked;sent.push(i);active--;});
 await new Promise(resolve=>setImmediate(resolve));assert.ok(sent.includes(7));assert.ok(!sent.includes(0));assert.ok(maximum<=4);release();await work;assert.equal(sent.length,8);
});

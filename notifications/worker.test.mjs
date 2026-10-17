import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import {LineupNotices} from './worker.mjs';
import {APP_URL,FEED_URL,deviceId} from './core.mjs';
test('Envío cifrado, deduplicación persistente y limpieza de suscripción caducada',async()=>{
 const keys=webpush.generateVAPIDKeys(),ecdh=createECDH('prime256v1');ecdh.generateKeys();
 const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device-long-token',keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 const data=new Map(),ctx={blockConcurrencyWhile:fn=>fn(),storage:{async get(k){return structuredClone(data.get(k));},async put(k,v){data.set(k,structuredClone(v));},async delete(k){data.delete(k);},async list(){return new Map([...data].map(([k,v])=>[k,structuredClone(v)]));}}};
 const env={VAPID_PUBLIC_KEY:keys.publicKey,VAPID_PRIVATE_KEY:keys.privateKey};
 const object=new LineupNotices(ctx,env),url='https://internal/subscription',request=()=>new Request(url,{method:'POST',body:JSON.stringify(subscription)});
 assert.equal((await object.fetch(request())).status,200);
 const start=new Date(Date.now()+3600000);start.setUTCSeconds(0,0);
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(start).split(' ');
 const fixture={competition:'LaLiga',status:'scheduled',date:parts[0],time:parts[1],venue:'home',jornada:9};
 const game={id:'123',date:start.toISOString(),status:{type:{state:'pre'}},competitors:[{id:'86',homeAway:'home',team:{displayName:'Real Madrid'}},{id:'1',homeAway:'away',team:{displayName:'Sevilla'}}]};
 let sent=0,status=201;const original=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const u=String(input);
  if(u===FEED_URL)return Response.json({fixtures:[fixture]});
  if(u.includes('/scoreboard?'))return Response.json({events:[{id:'123',competitions:[game]}]});
  if(u.includes('/summary?'))return Response.json({header:{competitions:[game]},rosters:[{team:{id:'86'},roster:Array.from({length:11},(_,i)=>({starter:true,athlete:{id:String(i),displayName:'Jugador '+i}}))}]});
  assert.equal(u,subscription.endpoint);assert.equal(options.method,'POST');assert.equal(options.headers['Content-Encoding'],'aes128gcm');assert.ok(options.body.length>100);sent++;return new Response(null,{status});
 };
 try{
  await Promise.all([object.fetch(new Request('https://internal/check')),object.fetch(new Request('https://internal/check'))]);assert.equal(sent,1);
  await object.fetch(request());const reloaded=new LineupNotices(ctx,env);await reloaded.fetch(new Request('https://internal/check'));assert.equal(sent,1);
  const key='sub:'+await deviceId(subscription.endpoint),entry=data.get(key);entry.sent={};data.set(key,entry);status=503;
  await reloaded.fetch(new Request('https://internal/check'));assert.equal(data.get(key).sent['123'],undefined);
  status=410;await reloaded.fetch(new Request('https://internal/check'));assert.equal(data.has(key),false);
 }finally{globalThis.fetch=original;}
});


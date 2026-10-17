import webpush from 'web-push';
import {APP_URL,FEED_URL,SUMMARY,candidates,confirmedNotice,resolveEventId,validSubscription,deviceId} from './core.mjs';
const ORIGIN=new URL(APP_URL).origin;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}});
async function readJson(request){
  const reader=request.body?.getReader();if(!reader)throw Error('body');let size=0,chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw Error('size');}chunks.push(value);}
  const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(body));
}
async function getJson(url){const response=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('source');return response.json();}
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(request.headers.get('Origin')!==ORIGIN)return new Response('Forbidden',{status:403});
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
    if(path==='/config'&&request.method==='GET'){
      if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return json({ready:false},503);
      return json({ready:true,publicKey:env.VAPID_PUBLIC_KEY});
    }
    if(path!=='/subscription'||!['POST','DELETE'].includes(request.method)||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Not found'},404);
    let sub;try{sub=await readJson(request);}catch{return json({error:'Invalid request'},400);}
    if(!validSubscription(sub))return json({error:'Invalid subscription'},400);
    if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return json({error:'Not configured'},503);
    const object=env.LINEUP_NOTICES.get(env.LINEUP_NOTICES.idFromName('madrid'));
    return object.fetch(new Request('https://internal/subscription',{method:request.method,body:JSON.stringify(sub)}));
  },
  scheduled(event,env,ctx){const object=env.LINEUP_NOTICES.get(env.LINEUP_NOTICES.idFromName('madrid'));ctx.waitUntil(object.fetch('https://internal/check').then(r=>{if(!r.ok)throw Error('Lineup check failed');}));}
};
export class LineupNotices {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.running=null;}
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/subscription'){
      const sub=await request.json(),id='sub:'+await deviceId(sub.endpoint);
      return this.ctx.blockConcurrencyWhile(async()=>{
        if(request.method==='DELETE'){await this.ctx.storage.delete(id);return json({ok:true});}
        const existing=await this.ctx.storage.get(id);
        const all=await this.ctx.storage.list({prefix:'sub:'});
        if(!existing&&all.size>=50)return json({error:'Device limit reached'},429);
        await this.ctx.storage.put(id,{subscription:sub,sent:existing?.sent||{},updatedAt:Date.now()});return json({ok:true});
      });
    }
    if(path==='/check'){
      if(!this.running)this.running=this.check().finally(()=>this.running=null);
      await this.running;return json({ok:true});
    }
    return json({error:'Not found'},404);
  }
  async check(){
    if(!this.env.VAPID_PUBLIC_KEY||!this.env.VAPID_PRIVATE_KEY)return;
    const devices=await this.ctx.storage.list({prefix:'sub:'});if(!devices.size)return;
    const feed=await getJson(FEED_URL);
    for(const fixture of candidates(feed)){
      // Siempre resolver por el marcador del día: no depender de un ID viejo del JSON.
      const board=await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=${fixture.date.replaceAll('-','')}&limit=200`);
      const id=resolveEventId(board,fixture);if(!id)continue;
      const notice=confirmedNotice(await getJson(SUMMARY+id),fixture);if(!notice)continue;
      for(const [key,device] of devices){
        if(device.sent[id])continue;
        try{
          const details=webpush.generateRequestDetails(device.subscription,JSON.stringify(notice),{TTL:Math.max(1,Math.floor((notice.expiresAt-Date.now())/1000)),urgency:'high',topic:'madrid-lineup-'+id,vapidDetails:{subject:APP_URL,publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY}});
          const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,signal:AbortSignal.timeout(12000),redirect:'error'});
          if([404,410].includes(response.status)){await this.ctx.storage.delete(key);continue;}
          if(!response.ok)continue;
          // Conservar los últimos avisos por dispositivo para no repetirlos al volver a registrar.
          const latest=await this.ctx.storage.get(key);if(!latest)continue;
          latest.sent[id]=Date.now();latest.sent=Object.fromEntries(Object.entries(latest.sent).filter(([,at])=>at>Date.now()-45*86400000));
          await this.ctx.storage.put(key,latest);
        }catch{/* No registrar endpoints ni claves. Otro ciclo reintenta; el receptor deduplica. */}
      }
    }
  }
}

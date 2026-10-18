import webpush from 'web-push';
import {APP_URL,FEED_URL,LEAGUES,candidates,confirmedNotice,resolveEventId,validSubscription,deviceId} from './core.mjs';
import {snapshot,changes} from './events.mjs';
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
    let payload;try{payload=await readJson(request);}catch{return json({error:'Invalid request'},400);}
    const sub=payload?.subscription||payload;
    if(!validSubscription(sub))return json({error:'Invalid subscription'},400);
    if(!env.VAPID_PUBLIC_KEY||!env.VAPID_PRIVATE_KEY)return json({error:'Not configured'},503);
    const object=env.LINEUP_NOTICES.get(env.LINEUP_NOTICES.idFromName('madrid'));
    return object.fetch(new Request('https://internal/subscription',{method:request.method,body:JSON.stringify(payload)}));
  },
  scheduled(event,env,ctx){const object=env.LINEUP_NOTICES.get(env.LINEUP_NOTICES.idFromName('madrid'));ctx.waitUntil(object.fetch('https://internal/check').then(r=>{if(!r.ok)throw Error('Lineup check failed');}));}
};
export class LineupNotices {
  constructor(ctx,env){this.ctx=ctx;this.env=env;this.running=null;}
  async deliver(subscription,notice){
    try{
    const details=webpush.generateRequestDetails(subscription,JSON.stringify(notice),{TTL:Math.max(1,Math.floor((notice.expiresAt-Date.now())/1000)),urgency:'high',topic:(await deviceId(notice.matchId+':'+(notice.eventKey||notice.kind))).slice(0,32),vapidDetails:{subject:APP_URL,publicKey:this.env.VAPID_PUBLIC_KEY,privateKey:this.env.VAPID_PRIVATE_KEY}});
    const response=await fetch(details.endpoint,{method:details.method,headers:details.headers,body:details.body,signal:AbortSignal.timeout(12000),redirect:'manual'});
    if(!response.ok)console.error('push-http',response.status);
    return response;
    }catch(error){
      const detail=String(error?.message||'').replace(/https?:\/\/\S+/g,'[url]').replace(/[A-Za-z0-9_\-+/=]{30,}/g,'[redacted]').slice(0,220);
      console.error('push-error',String(error?.name||'Error'),detail);throw error;
    }
  }
  async fetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/subscription'){
      const payload=await request.json(),sub=payload.subscription||payload,id='sub:'+await deviceId(sub.endpoint);
      const version=typeof payload.receiverVersion==='string'?payload.receiverVersion.slice(0,20):null;
      return this.ctx.blockConcurrencyWhile(async()=>{
        if(request.method==='DELETE'){await this.ctx.storage.delete(id);return json({ok:true});}
        const existing=await this.ctx.storage.get(id);
        const all=await this.ctx.storage.list({prefix:'sub:'});
        if(!existing&&all.size>=50)return json({error:'Device limit reached'},429);
        const device={subscription:sub,sent:existing?.sent||{},updatedAt:Date.now(),welcomeSentAt:existing?.welcomeSentAt||null,welcomeVersion:existing?.welcomeVersion||null,createdAt:existing?.createdAt||existing?.updatedAt||Date.now(),liveNotices:version==='3.28.0'};
        await this.ctx.storage.put(id,device);
        const recover=version&&payload.confirmationReceived===false&&(version!==device.welcomeVersion||Date.now()-device.welcomeSentAt>60000);
        if(payload.confirmationReceived!==true&&(!device.welcomeSentAt||recover)){
          try{
            const result=await this.deliver(sub,{kind:'madrid-ready',matchId:'0',title:'Avisos del Madrid activados',body:'Este móvil ya puede recibir los avisos de los partidos del Real Madrid.',url:APP_URL,expiresAt:Date.now()+10*60000});
            if(result.ok){device.welcomeSentAt=Date.now();device.welcomeVersion=version;await this.ctx.storage.put(id,device);}
            else if([404,410].includes(result.status)){await this.ctx.storage.delete(id);return json({error:'Expired subscription'},410);}
            else{return json({ok:true,confirmationSent:false});}
          }catch{return json({ok:true,confirmationSent:false});}
        }
        return json({ok:true,confirmationSent:!!device.welcomeSentAt});
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
    const now=Date.now(),feed=await getJson(FEED_URL);
    // Estado y cola independientes del dispositivo para no repetir el pasado al activarlo.
    const oldMatches=await this.ctx.storage.list({prefix:'match:'});
    for(const [key,state] of oldMatches)if(state.at<now-2*86400000)await this.ctx.storage.delete(key);
    for(const fixture of candidates(feed,now)){
      const league=LEAGUES[fixture.competition];
      try{
        const board=await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${fixture.date.replaceAll('-','')}&limit=200`);
        const id=resolveEventId(board,fixture);if(!id)continue;
        const summary=await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${id}`);
        const boardEvent=board.events?.find(e=>String(e.id)===id);
        const current=snapshot(summary,fixture,boardEvent?.status||boardEvent?.competitions?.[0]?.status);if(!current)continue;
        const key='match:'+id,previous=await this.ctx.storage.get(key);
        const result=changes(current,previous,fixture,now);
        if(previous&&result.state===previous)continue; // Fuente que retrocede de fase.
        const queue=(previous?.queue||[]).filter(n=>n.expiresAt>now&&(!n.eventKey.startsWith('goal:')||!current.goalsCoherent||current.events.some(e=>e.key===n.eventKey)));
        for(const notice of result.notices)if(!queue.some(n=>n.eventKey===notice.eventKey))queue.push(notice);
        const lineup=confirmedNotice(summary,fixture,now);
        const notices=[...(lineup?[{...lineup,eventKey:'lineup'}]:[]),...queue];
        await this.ctx.storage.put(key,{...result.state,queue});
        for(const [deviceKey,device] of devices){
          for(const notice of notices){
            if(notice.kind==='madrid-event'&&!device.liveNotices)continue;
            if(fixture.competition==='Champions'&&!device.liveNotices)continue;
            if(notice.kind==='madrid-event'&&(device.createdAt||device.updatedAt)>notice.observedAt)continue;
            const sentKey=notice.kind==='madrid-lineup'?id:id+':'+notice.eventKey;
            const latest=await this.ctx.storage.get(deviceKey);if(!latest)break;
            if(latest.sent[sentKey])continue;
            try{
              const response=await this.deliver(latest.subscription,notice);
              if([404,410].includes(response.status)){await this.ctx.storage.delete(deviceKey);break;}
              if(!response.ok)continue;
              const fresh=await this.ctx.storage.get(deviceKey);if(!fresh)break;
              fresh.sent[sentKey]=Date.now();fresh.sent=Object.fromEntries(Object.entries(fresh.sent).filter(([,at])=>at>now-45*86400000));
              await this.ctx.storage.put(deviceKey,fresh);
            }catch{/* Reintento limitado por TTL; el receptor deduplica. */}
          }
        }
      }catch{console.error('match-check-failed',fixture.competition);}
    }
  }
}

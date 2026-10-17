export const APP_URL='https://eduardomun68.github.io/madridista-app/';
export const FEED_URL=new URL('real_madrid.json',APP_URL).href;
export const SUMMARY='https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/summary?event=';
export function kickoff(fixture){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(fixture.date||'')||!/^\d{2}:\d{2}$/.test(fixture.time||''))return NaN;
  const target=Date.parse(`${fixture.date}T${fixture.time}:00Z`);
  const zone=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant=target;
  for(let i=0;i<2;i++){const local=zone.format(new Date(instant));instant+=target-Date.parse(local.replace(' ','T')+'Z');}
  return instant;
}
export function candidates(feed,now=Date.now()){
  return (feed.fixtures||[]).filter(f=>f.competition==='LaLiga'&&f.status==='scheduled'&&kickoff(f)>=now&&kickoff(f)-now<=120*60000);
}
export function confirmedNotice(summary,fixture,now=Date.now()){
  const game=summary.header?.competitions?.[0],state=game?.status?.type;
  if(!game||state?.completed||state?.state!=='pre')return null;
  const madrid=game.competitors?.find(t=>String(t.id)==='86');
  if(!madrid||madrid.homeAway!==fixture.venue)return null;
  // Una fecha reprogramada o una ficha antigua no puede generar un aviso.
  const sourceKickoff=Date.parse(game.date);
  if(!Number.isFinite(sourceKickoff)||Math.abs(sourceKickoff-kickoff(fixture))>60000||now>=sourceKickoff)return null;
  const roster=(summary.rosters||[]).find(r=>String(r.team?.id)==='86');
  const starters=(roster?.roster||[]).filter(p=>p.starter===true);
  if(starters.length!==11||new Set(starters.map(p=>p.athlete?.id)).size!==11||starters.some(p=>!p.athlete?.id||!p.athlete?.displayName))return null;
  const id=String(game.id||summary.header.id||'');if(!/^\d+$/.test(id))return null;
  const home=game.competitors.find(t=>t.homeAway==='home')?.team?.displayName;
  const away=game.competitors.find(t=>t.homeAway==='away')?.team?.displayName;
  if(!home||!away)return null;
  const url=new URL(APP_URL);url.searchParams.set('lineup',id);url.searchParams.set('jornada',String(fixture.jornada));
  return {kind:'madrid-lineup',matchId:id,title:'¡Ya hay once del Real Madrid!',body:`${home} – ${away}. Toca para ver la alineación.`,url:url.href,expiresAt:sourceKickoff,players:starters.map(p=>p.athlete.displayName)};
}
export function resolveEventId(board,fixture){
  const hits=(board.events||[]).filter(e=>{
    const g=e.competitions?.[0],m=g?.competitors?.find(t=>String(t.id)==='86');
    return m?.homeAway===fixture.venue&&Math.abs(Date.parse(g.date||e.date)-kickoff(fixture))<=60000;
  });
  return hits.length===1&&/^\d+$/.test(String(hits[0].id))?String(hits[0].id):null;
}
export function validSubscription(sub){
  try{
    const u=new URL(sub.endpoint);
    const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||!allowed.includes(u.hostname))return false;
    if(!/^\/[\w/:.%-]+$/.test(u.pathname)||u.pathname.length<10)return false;
    if(!/^[\w-]{87}=?$/.test(sub.keys?.p256dh||'')||!/^[\w-]{22}(==)?$/.test(sub.keys?.auth||''))return false;
    return true;
  }catch{return false;}
}
export async function deviceId(endpoint){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint))),b=>b.toString(16).padStart(2,'0')).join('');}

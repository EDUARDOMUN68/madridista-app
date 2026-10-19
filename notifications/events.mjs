import {APP_URL,kickoff} from './core.mjs';
const rank={pre:0,first:1,half:2,second:3,extra:4,penalties:5,final:6};
export function scoreboardSnapshot(event,fixture){
  const game=event?.competitions?.[0];if(!game)return null;
  const keyEvents=(game.details||[]).map(e=>{
    const minute=parseInt(e.clock?.displayValue,10)||Math.floor((e.clock?.value||0)/60);
    const period=e.period?.number||(minute<=45?1:minute<=90?2:minute<=105?3:4);
    return {...e,period:{number:period},type:{...e.type,type:e.redCard?'red-card':e.ownGoal?'own-goal':e.type?.type},participants:(e.athletesInvolved||[]).map(athlete=>({athlete}))};
  });
  return snapshot({header:{id:event.id,competitions:[{...game,date:game.date||event.date,status:event.status||game.status}]},keyEvents},fixture);
}
export function snapshot(summary,fixture,boardStatus=null){
  const game=summary.header?.competitions?.[0];
  if(boardStatus?.type?.state&&game?.status?.type?.state&&boardStatus.type.state!==game.status.type.state)return null;
  const status={...boardStatus,...game?.status,period:game?.status?.period??boardStatus?.period,displayClock:game?.status?.displayClock??boardStatus?.displayClock},type=status?.type;
  const home=game?.competitors?.find(t=>t.homeAway==='home'),away=game?.competitors?.find(t=>t.homeAway==='away');
  const madrid=[home,away].find(t=>String(t?.id)==='86');
  if(!home||!away||!madrid||madrid.homeAway!==fixture.venue||Math.abs(Date.parse(game.date)-kickoff(fixture))>60000||!Number.isFinite(Date.parse(game.date)))return null;
  if(/postpon|suspend|abandon|cancel/i.test(type?.name+' '+type?.detail))return null;
  const id=String(game.id||summary.header.id||'');if(!/^\d+$/.test(id))return null;
  const period=Number(status?.period?.number??status?.period)||1;
  const half=/HALFTIME|HALF_TIME|^HT$|Half Time|Descanso/i.test(type?.name+' '+type?.shortDetail+' '+type?.detail);
  const phase=type?.completed?'final':type?.state==='pre'?'pre':type?.state==='in'?(half?'half':period===1?'first':period===2?'second':period>=5?'penalties':'extra'):null;
  if(!phase)return null;
  const score=t=>{const n=Number(t.score?.value??t.score?.displayValue??t.score);return Number.isInteger(n)&&n>=0?n:null;};
  const scores=[score(home),score(away)],teams=[home,away],events=[],seen=new Set();
  for(const e of summary.keyEvents||[]){
    const type=String(e.type?.type||''),label=type+' '+(e.type?.text||'');
    const kind=/yellow-red|second-yellow|red-card/i.test(label)?'red':e.scoringPlay&&!e.shootout&&!/cancel|disallow|overturn|missed/i.test(label)?'goal':null;
    const side=teams.findIndex(t=>String(t.id)===String(e.team?.id)),player=e.participants?.[0]?.athlete?.displayName;
    if(!kind||side<0||!player)continue;
    const eventPeriod=Number(e.period?.number)||1,clock=Number(e.clock?.value)||0;
    // Misma identidad en marcador y resumen, aunque sus IDs de evento difieran.
    const athlete=e.participants?.[0]?.athlete?.id||player.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const key=[kind,e.team.id,clock,athlete].join(':');
    if(seen.has(key))continue;seen.add(key);
    events.push({key,kind,side,player,period:eventPeriod,clock,minute:e.clock?.displayValue||'',own:/own.?goal/i.test(label)});
  }
  events.sort((a,b)=>a.period-b.period||a.clock-b.clock);
  const counts=[0,0];for(const e of events)if(e.kind==='goal'){counts[e.side]++;e.score=counts.join('–');}
  const coherent=scores.every((n,i)=>n!==null&&n===counts[i]);
  const minute=parseInt(status?.displayClock||type?.shortDetail||'',10);
  const elapsed=Number.isFinite(minute)?minute*60:Math.max(0,...events.map(e=>e.clock));
  return {id,phase,period,elapsed,home:home.team.displayName,away:away.team.displayName,scores,events:events.filter(e=>e.kind!=='goal'||coherent),goalsCoherent:coherent};
}
export function changes(current,previous,fixture,now=Date.now()){
  if(!current)return {state:previous,notices:[]};
  if(previous&&rank[current.phase]<rank[previous.phase])return {state:previous,notices:[]};
  const url=new URL(APP_URL);url.searchParams.set('lineup',current.id);url.searchParams.set('jornada',String(fixture.jornada));url.searchParams.set('competition',fixture.competition);url.searchParams.set('detail','summary');
  const score=current.scores.every(n=>n!==null)?`${current.home} ${current.scores.join('–')} ${current.away}`:`${current.home} – ${current.away}`;
  const notices=[],old=new Set(previous?.seen||[]);
  const add=(key,title,body)=>notices.push({kind:'madrid-event',eventKey:key,matchId:current.id,title,body,url:url.href,sourceAt:previous?.at||now,observedAt:now,expiresAt:now+3*60000});
  // El primer sondeo es una referencia, no una repetición de todo el partido.
  const continuous=previous&&now-previous.at<=5*60000;
  if(continuous){
    const titles={first:'⚽ Empieza el partido',half:'⏸ Descanso',second:'▶ Empieza la segunda parte',final:'🏁 Final del partido'};
    const phaseNotice=current.phase!==previous.phase&&titles[current.phase];
    if(phaseNotice&&current.phase==='first')add('phase:first',titles.first,score);
    for(const e of current.events){
      if(old.has(e.key)||e.period<previous.baselinePeriod||e.period===previous.baselinePeriod&&e.clock<=previous.baselineClock)continue;
      if(e.kind==='goal')add(e.key,'⚽ Gol de '+e.player,`${e.player}${e.own?' (en propia puerta)':''}${e.minute?' · '+e.minute:''}. ${current.home} ${e.score} ${current.away}`);
      else add(e.key,'🟥 Expulsado: '+e.player,`${e.player} · ${e.side===0?current.home:current.away}${e.minute?' · '+e.minute:''}. ${score}`);
    }
    if(phaseNotice&&current.phase!=='first')add('phase:'+current.phase,titles[current.phase],score);
    if(current.goalsCoherent&&previous.coherentScores&&current.scores.some((n,i)=>n<previous.coherentScores[i]))add('correction:'+current.scores.join('-')+':'+current.events.filter(e=>e.kind==='goal').map(e=>e.key).join(','),'Marcador corregido',score);
  }
  return {state:{phase:current.phase,scores:current.scores,coherentScores:current.goalsCoherent?current.scores:previous?.coherentScores,baselinePeriod:continuous?previous.baselinePeriod:current.period,baselineClock:continuous?previous.baselineClock:(current.phase==='pre'?-1:current.elapsed),seen:[...new Set([...old,...current.events.map(e=>e.key)])].slice(-120),at:now},notices};
}

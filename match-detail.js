/* Detalle bajo demanda de los partidos de LaLiga. */
(function(root){
  'use strict';
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stats=[['possessionPct','Posesión','%'],['totalShots','Tiros',''],['shotsOnTarget','Tiros a puerta',''],['wonCorners','Córners',''],['foulsCommitted','Faltas',''],['yellowCards','Tarjetas amarillas',''],['redCards','Tarjetas rojas',''],['offsides','Fueras de juego',''],['saves','Paradas',''],['totalPasses','Pases','']];
  function lineups(payload,home,away){
    return [home,away].map(team=>{
      const roster=(payload.rosters||[]).find(r=>String(r.team?.id)===String(team.id));
      const seen=new Set();
      const players=(roster?.roster||[]).filter(p=>{const key=p.athlete?.id||p.athlete?.displayName;if(!key||seen.has(key))return false;seen.add(key);return true;}).map(p=>({name:p.athlete?.displayName||p.athlete?.fullName||'',number:p.jersey||'',starter:p.starter,order:Number(p.formationPlace)||99,position:({G:'Portero',GK:'Portero',D:'Defensa',M:'Centrocampista',F:'Delantero'})[p.position?.abbreviation]||''}));
      const starters=players.filter(p=>p.starter===true).sort((a,b)=>a.order-b.order);
      return {team:team.team.displayName,confirmed:starters.length===11,formation:roster?.formation||'',starters,bench:players.filter(p=>p.starter===false)};
    });
  }
  function lineupHtml(teams){
    return '<p class="lineup-note">Las alineaciones suelen publicarse aproximadamente una hora antes del inicio. Se mostrarán cuando estén disponibles en la fuente.</p><div class="lineup-teams">'+teams.map(t=>{
      if(!t.confirmed)return `<section class="lineup-team"><h3>${escape(t.team)}</h3><p class="detail-empty">Alineación todavía no disponible.</p></section>`;
      const list=players=>'<ul class="lineup-list">'+players.map(p=>`<li><span class="lineup-number">${escape(p.number||'—')}</span><span>${escape(p.name)}${p.position?`<small>${escape(p.position)}</small>`:''}</span></li>`).join('')+'</ul>';
      return `<section class="lineup-team"><h3>${escape(t.team)}</h3>${t.formation?`<p class="lineup-formation">Formación: ${escape(t.formation)}</p>`:''}<h4>Titulares</h4>${list(t.starters)}<h4>Suplentes</h4>${t.bench.length?list(t.bench):'<p class="detail-empty">Suplentes no disponibles.</p>'}</section>`;
    }).join('')+'</div>';
  }
  function parse(payload,match,same){
    const game=payload.header?.competitions?.[0];
    const home=game?.competitors?.find(c=>c.homeAway==='home'),away=game?.competitors?.find(c=>c.homeAway==='away');
    if(!home||!away||!same(home.team?.displayName,match.home)||!same(away.team?.displayName,match.away))throw new Error('El detalle no corresponde al partido seleccionado.');
    const state=game.status?.type||{};
    const side=id=>String(id)===String(home.id)?'home':String(id)===String(away.id)?'away':null;
    const seen=new Set(),events=[];
    for(const e of payload.keyEvents||[]){
      const type=e.type?.type||'',label=e.type?.text||'';
      let kind=/substitution/i.test(type)?'sub':/yellow-red|second-yellow/i.test(type+' '+label)?'second':/red-card/i.test(type)?'red':/yellow-card/i.test(type)?'yellow':/missed.*penalty|penalty.*missed/i.test(type)?'missed':e.scoringPlay&&!e.shootout?'goal':null;
      if(!kind)continue;
      const team=side(e.team?.id);if(!team)continue;
      const period=Number(e.period?.number)||1,clock=Number(e.clock?.value)||0;
      const people=(e.participants||[]).map(p=>p.athlete?.displayName).filter(Boolean);
      const key=e.id||JSON.stringify([kind,period,clock,team,people]);if(seen.has(key))continue;seen.add(key);
      events.push({kind,side:team,period,clock,minute:e.clock?.displayValue||'—',people,own:/own.?goal/i.test(type+' '+label),penalty:/penalty/i.test(type+' '+label)});
    }
    events.sort((a,b)=>a.period-b.period||a.clock-b.clock);
    const boxes=payload.boxscore?.teams||[];
    const values=team=>Object.fromEntries((boxes.find(b=>String(b.team?.id)===String(team.id))?.statistics||[]).map(s=>[s.name,s.displayValue]));
    const hs=values(home),as=values(away);
    return {home,away,lineups:lineups(payload,home,away),live:state.state==='in',finished:!!state.completed,status:state.state==='in'?(state.shortDetail==='HT'?'Descanso':state.shortDetail||'En juego'):state.completed?'Finalizado':'Pendiente de inicio',events,stats:stats.filter(([key])=>hs[key]!=null||as[key]!=null).map(([key,label,suffix])=>({label,home:hs[key]==null?'—':String(hs[key])+(suffix&&!String(hs[key]).includes(suffix)?suffix:''),away:as[key]==null?'—':String(as[key])+(suffix&&!String(as[key]).includes(suffix)?suffix:'')}))};
  }
  function timeline(data){
    if(!data.events.length)return '<p class="detail-empty">'+(data.finished?'La fuente no ofrece incidencias de este partido.':data.live?'Todavía no hay incidencias disponibles.':'El resumen estará disponible cuando comience el partido.')+'</p>';
    let out='',period=null;
    const labels={1:'1.er tiempo',2:'2.º tiempo',3:'Prórroga · 1.er tiempo',4:'Prórroga · 2.º tiempo',5:'Penaltis'};
    const symbols={goal:'⚽',sub:'🔄',yellow:'🟨',red:'🟥',second:'🟨 🟥',missed:'⚽'};
    const names={goal:'Gol',sub:'Cambio',yellow:'Tarjeta amarilla',red:'Tarjeta roja',second:'Segunda amarilla',missed:'Penalti fallado'};
    for(const e of data.events){
      if(e.period!==period){period=e.period;const score=[data.home,data.away].map(t=>t.linescores?.[period-1]?.displayValue);out+=`<h3 class="detail-period">${labels[period]||'Incidencias'}${score.every(x=>x!=null)?`<span>${escape(score.join(' – '))}</span>`:''}</h3>`;}
      const player=e.people[0]||'Jugador sin confirmar',extra=e.people[1];
      const note=e.kind==='sub'?(extra?`Sale: ${extra}`:''):(e.kind==='goal'?(e.own?'En propia puerta':e.penalty?'De penalti':extra?`Asistencia: ${extra}`:''):'');
      out+=`<div class="detail-event ${e.side}"><span class="detail-minute">${escape(e.minute)}</span><span class="detail-symbol" aria-label="${names[e.kind]}">${symbols[e.kind]}</span><div class="detail-player"><strong>${e.kind==='sub'?'Entra: ':''}${escape(player)}</strong><small>${names[e.kind]}${note?' · '+escape(note):''}</small></div></div>`;
    }
    return out;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={parse,timeline,lineupHtml};
  if(typeof document==='undefined')return;
  let selected=null,timer=null,controller=null,token=0,busy=false,tab='lineups';
  const dialog=document.createElement('dialog');dialog.className='match-detail';dialog.setAttribute('aria-labelledby','matchDetailTitle');
  dialog.innerHTML='<div class="detail-top"><h2 id="matchDetailTitle">Detalle del partido</h2><button type="button" class="detail-close" aria-label="Cerrar detalle">✕</button></div><div id="detailHeading"></div><div class="detail-tabs" role="tablist" aria-label="Detalle del partido"><button type="button" id="detailLineupsTab" role="tab" aria-controls="detailLineups" aria-selected="true">Alineaciones</button><button type="button" id="detailSummaryTab" role="tab" aria-controls="detailSummary" aria-selected="false" tabindex="-1">Resumen</button><button type="button" id="detailStatsTab" role="tab" aria-controls="detailStats" aria-selected="false" tabindex="-1">Estadísticas</button></div><p id="detailStatus" role="status" aria-live="polite"></p><button type="button" id="detailRetry" hidden>Volver a intentar</button><div id="detailLineups" role="tabpanel" aria-labelledby="detailLineupsTab"></div><div id="detailSummary" hidden role="tabpanel" aria-labelledby="detailSummaryTab"></div><div id="detailStats" role="tabpanel" aria-labelledby="detailStatsTab" hidden></div><p class="detail-source">Datos de ESPN · Antes del inicio y durante el directo se revisan cada 60 segundos.</p>';
  document.body.append(dialog);
  const el=id=>dialog.querySelector('#'+id);
  const tabs=[['lineups','Lineups'],['summary','Summary'],['stats','Stats']];
  function choose(value){tab=value;for(const [name,id] of tabs){el('detail'+id).hidden=name!==tab;el('detail'+id+'Tab').setAttribute('aria-selected',String(name===tab));el('detail'+id+'Tab').tabIndex=name===tab?0:-1;}}
  for(const [name,id] of tabs){el('detail'+id+'Tab').onclick=()=>choose(name);el('detail'+id+'Tab').onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=tabs.findIndex(t=>t[0]===tab),next=e.key==='Home'?0:e.key==='End'?2:(index+(e.key==='ArrowRight'?1:2))%3;choose(tabs[next][0]);el('detail'+tabs[next][1]+'Tab').focus();}};}
  function stop(){clearInterval(timer);timer=null;controller?.abort();controller=null;selected=null;token++;busy=false;document.body.classList.remove('detail-open');}
  dialog.querySelector('.detail-close').onclick=()=>dialog.close();dialog.addEventListener('close',stop);
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  async function request(url,signal){const r=await fetch(url,{cache:'no-store',signal});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
  async function refresh(){
    if(!selected||busy||document.hidden)return;
    busy=true;const current=token,match=selected;controller=new AbortController();const signal=controller.signal;const timeout=setTimeout(()=>controller?.abort(),15000);
    el('detailStatus').textContent='Actualizando detalle…';el('detailRetry').hidden=true;
    try{
      if(!match.eventId){
        const board=await request(`https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/scoreboard?dates=${match.date.replaceAll('-','')}&limit=200`,signal);
        const candidates=root.parseDirectScoreboard(board,'LaLiga').filter(g=>root.directSame(g.home,match.home)&&root.directSame(g.away,match.away));
        if(candidates.length!==1)throw new Error('Sin ficha disponible');match.eventId=candidates[0].eventId;
      }
      if(!/^\d+$/.test(String(match.eventId)))throw new Error('Sin ficha disponible');
      const payload=await request(`https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/summary?event=${encodeURIComponent(match.eventId)}`,signal);
      if(current!==token||!dialog.open)return;
      const data=parse(payload,match,root.directSame);
      const score=t=>!data.live&&!data.finished?'—':t.score==null?'—':String(t.score);
      el('detailHeading').innerHTML=`<div class="detail-score"><b>${escape(match.home)}</b><strong>${escape(score(data.home))} – ${escape(score(data.away))}</strong><b>${escape(match.away)}</b></div><p class="detail-state ${data.live?'live':''}">${data.live?'🔴 ':''}${escape(data.status)}</p>`;
      el('detailSummary').innerHTML=timeline(data);
      el('detailLineups').innerHTML=lineupHtml(data.lineups);
      el('detailStats').innerHTML=data.stats.length?`<table class="detail-stat-table"><caption>Estadísticas del partido</caption><thead><tr><th scope="col">${escape(match.home)}</th><th scope="col">Dato</th><th scope="col">${escape(match.away)}</th></tr></thead><tbody>${data.stats.map(s=>`<tr><td>${escape(s.home)}</td><th scope="row">${s.label}</th><td>${escape(s.away)}</td></tr>`).join('')}</tbody></table>`:'<p class="detail-empty">Estadísticas todavía no disponibles en la fuente.</p>';
      el('detailStatus').textContent='Actualizado a las '+new Intl.DateTimeFormat('es-ES',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/Madrid'}).format(new Date());
      if(data.finished){clearInterval(timer);timer=null;}
    }catch(e){if(current===token&&dialog.open){el('detailStatus').textContent=el('detailSummary').innerHTML?'No se ha podido actualizar. Se conserva el último detalle recibido.':'No se ha podido cargar el detalle. Comprueba la conexión o inténtalo de nuevo.';el('detailRetry').hidden=false;}}
    finally{clearTimeout(timeout);if(current===token){busy=false;controller=null;}}
  }
  el('detailRetry').onclick=refresh;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog.open)refresh();});
  root.openLigaMatchDetail=match=>{if(match.competition!=='LaLiga'||!['scheduled','live','finished'].includes(match.status))return;stop();selected={...match};tab='lineups';choose(tab);el('matchDetailTitle').textContent='LaLiga · Detalle del partido';el('detailHeading').innerHTML=`<div class="detail-score"><b>${escape(match.home)}</b><strong>${escape(match.score||'—')}</strong><b>${escape(match.away)}</b></div>`;el('detailLineups').innerHTML='';el('detailSummary').innerHTML='';el('detailStats').innerHTML='';el('detailStatus').textContent='Cargando detalle…';el('detailRetry').hidden=true;if(!dialog.open)dialog.showModal();document.body.classList.add('detail-open');timer=setInterval(refresh,60000);refresh();};
})(typeof window==='undefined'?globalThis:window);

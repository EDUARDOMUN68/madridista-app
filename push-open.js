(function(){
  const query=new URLSearchParams(location.search),id=query.get('lineup'),round=Number(query.get('jornada')),competition=query.get('competition')||'LaLiga';
  if(!/^\d+$/.test(id||'')||!Number.isInteger(round)||round<1||round>(competition==='Champions'?8:38)||!['LaLiga','Champions'].includes(competition))return;
  function open(){
    if(typeof APP==='undefined'||!APP||typeof openMatchDetail!=='function')return false;
    const payload=APP.jornadasAll?.[competition]?.[String(round)];
    const match=payload?.matches?.find(m=>directSame(m.home,'Real Madrid')||directSame(m.away,'Real Madrid'));
    if(!match)return false;
    // La ficha valida de nuevo ambos equipos antes de mostrar la respuesta.
    document.querySelector('[data-view="jornadaView"]')?.click();setJornadaCompetition(competition);setJornadaNumber(round,true);
    openMatchDetail({...match,eventId:id,competition});
    if(query.get('detail')==='summary')document.getElementById('detailSummaryTab')?.click();
    const clean=new URL(location.href);clean.searchParams.delete('lineup');clean.searchParams.delete('jornada');clean.searchParams.delete('competition');clean.searchParams.delete('detail');history.replaceState(null,'',clean);return true;
  }
  let tries=0;const timer=setInterval(()=>{if(open()||++tries>=40)clearInterval(timer);},250);
})();

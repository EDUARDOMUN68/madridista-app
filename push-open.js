(function(){
  const query=new URLSearchParams(location.search),id=query.get('lineup'),round=Number(query.get('jornada'));
  if(!/^\d+$/.test(id||'')||!Number.isInteger(round)||round<1||round>38)return;
  function open(){
    if(typeof APP==='undefined'||!APP||typeof openLigaMatchDetail!=='function')return false;
    const payload=APP.jornadasAll?.LaLiga?.[String(round)];
    const match=payload?.matches?.find(m=>directSame(m.home,'Real Madrid')||directSame(m.away,'Real Madrid'));
    if(!match)return false;
    // La ficha valida de nuevo ambos equipos antes de mostrar la respuesta.
    document.querySelector('[data-view="jornadaView"]')?.click();setJornadaCompetition('LaLiga');setJornadaNumber(round,true);
    openLigaMatchDetail({...match,eventId:id,competition:'LaLiga'});
    const clean=new URL(location.href);clean.searchParams.delete('lineup');clean.searchParams.delete('jornada');history.replaceState(null,'',clean);return true;
  }
  let tries=0;const timer=setInterval(()=>{if(open()||++tries>=40)clearInterval(timer);},250);
})();

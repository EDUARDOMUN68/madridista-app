(function(){
  'use strict';
  const button=document.getElementById('pushToggle'),api=window.MADRIDISTA_PUSH_API;
  if(!button)return;
  if(!api||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){button.hidden=true;return;}
  let base;try{base=new URL(api);if(base.protocol!=='https:')return;}catch{return;}
  const key='madridista-push-enabled';
  let preferred=null;try{preferred=localStorage.getItem(key);}catch{}
  let enabled=preferred==='on'||(preferred===null&&Notification.permission==='granted'),busy=false,retryOff=false,failed=false;
  if(preferred===null)save(enabled); // Migración única; después manda la elección guardada.
  const request=(path,options={})=>fetch(new URL(path,base),{...options,cache:'no-store',signal:AbortSignal.timeout(15000)});
  function save(value){try{localStorage.setItem(key,value?'on':'off');}catch{}}
  function stillEnabled(){try{const value=localStorage.getItem(key);return value==='on'?true:value==='off'?false:enabled;}catch{return enabled;}}
  function paint(text){
    button.textContent=enabled?'🔔':'🔕';
    button.setAttribute('data-status',busy?'checking':failed?'error':'ready');
    button.disabled=busy;button.setAttribute('aria-pressed',String(enabled));
    button.title=text||(enabled?'Avisos activados · Pulsar para desactivar':'Avisos desactivados · Pulsar para activar');
    button.setAttribute('aria-label',button.title);
  }
  function notify(text){if(typeof window.showRefreshMessage==='function')window.showRefreshMessage(text);}
  function bytes(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
  async function receiver(registration){
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const state=await new Promise(resolve=>{
        const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},1000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
        registration.active?.postMessage({type:'MADRIDISTA_PUSH_STATUS'},[channel.port2]);
      });
      if(state?.ready&&state.version==='3.28.0')return state;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('receiver');
  }

  async function disable(manual){
    enabled=false;if(manual)save(false);busy=true;failed=false;paint('Desactivando avisos…');
    try{
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription();
      if(stillEnabled()){enabled=true;return;}
      if(subscription){
        const payload=JSON.stringify(subscription);
        if(!await subscription.unsubscribe())throw Error('unsubscribe');
        // La baja del navegador corta los envíos aunque el servicio no responda.
        try{await request('/subscription',{method:'DELETE',headers:{'Content-Type':'application/json'},body:payload});}catch{}
      }
      retryOff=false;if(manual)notify('Avisos desactivados en este móvil');
    }catch{retryOff=true;failed=true;notify('No se ha podido completar la baja. Toca la campana para reintentar.');}
    finally{busy=false;paint(retryOff?'No se han podido desactivar · Pulsar para reintentar':undefined);}
  }
  async function enable(manual){
    busy=true;failed=false;paint('Preparando avisos…');
    try{
      if(Notification.permission==='default'&&manual)await Notification.requestPermission();
      if(Notification.permission!=='granted'){failed=true;notify('La elección sigue guardada. Permite las notificaciones en los ajustes del navegador para recibir avisos.');return;}
      enabled=true;if(manual)save(true);
      const response=await request('/config');if(!response.ok)throw Error('service');const config=await response.json();if(!config.ready||!config.publicKey)throw Error('config');
      const registration=await navigator.serviceWorker.ready,state=await receiver(registration);
      if(!stillEnabled()){enabled=false;return;}
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
      if(!stillEnabled()){enabled=false;if(subscription)await subscription.unsubscribe();return;}
      const sent=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,receiverVersion:state.version,confirmationReceived:state.confirmationReceived})});
      if(!sent.ok)throw Error('registration');
      const result=await sent.json();
      if(!result.confirmationSent&&!state.confirmationReceived)throw Error('confirmation');
      if(manual)notify('Avisos activados en este móvil');
    }catch{failed=true;notify('No se han podido preparar los avisos. Toca la campana para reintentar.');}
    finally{busy=false;paint(failed?'Avisos activados · Pendiente de conexión o permiso · Pulsar para desactivar':undefined);}
  }
  button.onclick=()=>{if(busy)return;if(retryOff||enabled)disable(true);else{enabled=true;save(true);enable(true);}};
  window.addEventListener?.('storage',event=>{if(event.key!==key||!['on','off'].includes(event.newValue))return;enabled=event.newValue==='on';failed=false;paint();});
  window.addEventListener?.('online',()=>{if(enabled&&!busy)enable(false);});
  button.hidden=false;paint();
  if(preferred==='off')disable(false);else if(enabled)enable(false);
})();

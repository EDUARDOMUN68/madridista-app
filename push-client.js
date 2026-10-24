(function(){
  'use strict';
  const button=document.getElementById('pushToggle'),api=window.MADRIDISTA_PUSH_API;
  if(!button)return;
  if(!api||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){button.hidden=true;return;}
  let base;try{base=new URL(api);if(base.protocol!=='https:')return;}catch{return;}
  const key='madridista-push-enabled';
  let preferred=null;try{preferred=localStorage.getItem(key);}catch{}
  let enabled=preferred==='on'||(preferred===null&&Notification.permission==='granted'),busy=false,retryOff=false,failed=false;
  const panel=document.getElementById('pushPanel'),status=document.getElementById('pushStatus'),repair=document.getElementById('pushRepair'),off=document.getElementById('pushDisable'),test=document.getElementById('pushTest'),received=document.getElementById('pushReceived');
  let problem='',stage='',lastDisplayed=null;
  if(preferred===null)save(enabled); // Migración única; después manda la elección guardada.
  const request=(path,options={})=>fetch(new URL(path,base),{...options,cache:'no-store',signal:AbortSignal.timeout(15000)});
  function save(value){try{localStorage.setItem(key,value?'on':'off');}catch{}}
  function stillEnabled(){try{const value=localStorage.getItem(key);return value==='on'?true:value==='off'?false:enabled;}catch{return enabled;}}
  function paint(text){
    button.textContent=enabled?'🔔':'🔕';
    button.setAttribute('data-status',busy?'checking':failed?'error':'ready');
    button.disabled=false;button.setAttribute('aria-pressed',String(enabled));
    button.title=text||'Ver estado y opciones de los avisos';
    button.setAttribute('aria-label',button.title);
    if(status)status.textContent=busy?'Comprobando los avisos…':problem||(enabled?'Avisos registrados en este móvil. Puedes probar la recepción o desactivarlos.':'Avisos desactivados en este móvil.');
    if(repair){repair.disabled=busy;repair.textContent=enabled?'Comprobar y reintentar':'Activar avisos';}
    if(off){off.hidden=!enabled&&!retryOff;off.disabled=busy;}
    if(test){test.disabled=busy||!enabled||failed;}
    if(received)received.textContent=lastDisplayed?'Último aviso mostrado por Chrome: '+new Date(lastDisplayed).toLocaleString('es-ES'):'Todavía no consta un aviso mostrado por este receptor.';
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
    enabled=false;if(manual)save(false);busy=true;failed=false;problem='';paint('Desactivando avisos…');
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
    busy=true;failed=false;problem='';stage='permiso';paint('Preparando avisos…');
    try{
      if(Notification.permission==='default'&&manual)await Notification.requestPermission();
      if(Notification.permission!=='granted'){failed=true;problem=Notification.permission==='denied'?'Chrome tiene bloqueado el permiso. En Chrome abre Configuración → Configuración de sitios → Notificaciones y permite eduardomun68.github.io. Comprueba también Ajustes de Android → Aplicaciones → Chrome → Notificaciones. Tu elección de avisos sigue guardada.':'Falta conceder el permiso de Chrome. Pulsa Comprobar y reintentar y elige Permitir. Tu elección sigue guardada.';notify(problem);return;}
      enabled=true;if(manual)save(true);
      stage='conexión con el servicio';
      const response=await request('/config');if(!response.ok)throw Error('service');const config=await response.json();if(!config.ready||!config.publicKey)throw Error('config');
      stage='receptor de avisos';
      const registration=await navigator.serviceWorker.ready,state=await receiver(registration);
      lastDisplayed=state.lastDisplayed||null;
      if(!stillEnabled()){enabled=false;return;}
      let subscription=await registration.pushManager.getSubscription();
      stage='suscripción de Chrome';
      if(subscription?.options?.applicationServerKey){
        const existing=new Uint8Array(subscription.options.applicationServerKey),expected=bytes(config.publicKey);
        if(existing.length!==expected.length||existing.some((v,i)=>v!==expected[i])){await subscription.unsubscribe();subscription=null;}
      }
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
      if(!stillEnabled()){enabled=false;if(subscription)await subscription.unsubscribe();return;}
      stage='registro en el servicio';
      let sent=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,receiverVersion:state.version,confirmationReceived:manual?false:state.confirmationReceived})});
      if(sent.status===410){
        await subscription.unsubscribe();
        subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
        if(!stillEnabled()){await subscription.unsubscribe();enabled=false;return;}
        sent=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,receiverVersion:state.version,confirmationReceived:false})});
      }
      if(!sent.ok)throw Error('registration');
      const result=await sent.json();
      if(!result.confirmationSent&&!state.confirmationReceived){stage='envío del aviso de prueba';throw Error('confirmation');}
      if(manual){problem='Registro comprobado. El servicio ha aceptado la solicitud de prueba; confirma que aparece una notificación en este móvil. Si acabas de probar, espera un minuto antes de repetir.';notify(problem);}
    }catch{failed=true;problem='No se ha podido completar: '+stage+'. La elección sigue guardada. Pulsa Comprobar y reintentar cuando tengas conexión.';notify(problem);}
    finally{busy=false;paint();}
  }
  button.onclick=()=>{if(panel){if(!panel.open)panel.showModal();paint();}else if(!busy){if(failed)enable(true);else if(retryOff||enabled)disable(true);else{enabled=true;save(true);enable(true);}}};
  if(repair)repair.onclick=()=>{if(!busy){enabled=true;save(true);enable(true);}};
  if(off)off.onclick=()=>{if(!busy)disable(true);};
  if(test)test.onclick=async()=>{
    if(busy||!enabled||failed)return;
    busy=true;problem='';paint();
    try{
      const registration=await navigator.serviceWorker.ready,state=await receiver(registration),subscription=await registration.pushManager.getSubscription();
      if(!subscription)throw Error('subscription');
      const response=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,receiverVersion:state.version,confirmationReceived:state.confirmationReceived,testDelay:30})});
      if(response.status===429){problem='Espera un minuto antes de solicitar otra prueba.';return;}
      if(!response.ok||!(await response.json()).testScheduled)throw Error('test');
      problem='Prueba programada. Cierra ahora Madridista y espera 30 segundos. No fuerces la detención de Chrome. La notificación debe llegar sin abrir la app.';
    }catch{problem='No se ha podido programar la prueba. Comprueba la conexión y reintenta.';}
    finally{busy=false;paint();}
  };
  const close=document.getElementById('pushClose');if(close)close.onclick=()=>panel.close();
  window.addEventListener?.('storage',event=>{if(event.key!==key||!['on','off'].includes(event.newValue))return;enabled=event.newValue==='on';failed=false;paint();});
  window.addEventListener?.('online',()=>{if(enabled&&!busy)enable(false);});
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible'&&enabled&&!busy)enable(false);});
  navigator.permissions?.query({name:'notifications'}).then(permission=>{permission.onchange=()=>{if(enabled&&!busy)enable(false);};}).catch(()=>{});
  button.hidden=false;paint();
  if(preferred==='off')disable(false);else if(enabled)enable(false);
})();

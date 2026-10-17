(function(){
  'use strict';
  const api=window.MADRIDISTA_PUSH_API;
  if(!api||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return;
  let base;try{base=new URL(api);if(base.protocol!=='https:')return;}catch{return;}
  const request=(path,options={})=>fetch(new URL(path,base),{...options,cache:'no-store',signal:AbortSignal.timeout(15000)});
  let message=null;
  function banner(text,action){
    if(!message){message=document.createElement('div');message.className='push-permission';message.style.cssText='margin:10px 14px;padding:14px;background:#eef4ff;border:1px solid #c6d8f4;border-radius:14px;color:#193d69;font-size:13px;line-height:1.5';document.querySelector('header').after(message);}
    message.replaceChildren(document.createTextNode(text));
    if(action){const button=document.createElement('button');button.type='button';button.textContent=action.label;button.style.cssText='display:block;margin-top:10px;padding:10px 14px;background:#fff;border:1px solid #8daed8;border-radius:10px;color:#193d69;font-weight:700';button.onclick=action.run;message.append(button);}
  }
  function bytes(value){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));}
  async function receiver(registration){
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      const state=await new Promise(resolve=>{
        const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},1000);
        channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data);};
        registration.active?.postMessage({type:'MADRIDISTA_PUSH_STATUS'},[channel.port2]);
      });
      if(state?.ready&&state.version==='3.25.1')return state;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('receiver');
  }
  async function subscribe(){
    try{
      if(Notification.permission==='default'){
        const permission=await Notification.requestPermission();
        if(permission!=='granted'){banner('Los avisos necesitan permiso del móvil. Puedes permitirlos en los ajustes del navegador.');return;}
      }
      if(Notification.permission!=='granted'){banner('Los avisos están bloqueados en el navegador. Permítelos en sus ajustes para recibir la alineación del Madrid.');return;}
      banner('Preparando los avisos de la alineación del Madrid…');
      const response=await request('/config');if(!response.ok)throw Error('service');const config=await response.json();if(!config.ready||!config.publicKey)throw Error('config');
      const registration=await navigator.serviceWorker.ready;
      const state=await receiver(registration);
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
      const sent=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription,receiverVersion:state.version,confirmationReceived:state.confirmationReceived})});
      if(!sent.ok)throw Error('registration');
      const result=await sent.json();
      if(!result.confirmationSent&&!state.confirmationReceived){banner('El móvil está registrado, pero el aviso de prueba no se ha podido enviar.',{label:'Volver a intentar',run:subscribe});return;}
      banner('Avisos de la alineación del Madrid preparados en este móvil.');
    }catch{banner('No se han podido preparar los avisos. La app sigue funcionando.',{label:'Volver a intentar',run:subscribe});}
  }
  if(Notification.permission==='default')banner('Permite una vez las notificaciones para recibir siempre el once del Real Madrid, también con la app cerrada.',{label:'Permitir notificaciones',run:subscribe});else subscribe();
})();

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
  async function subscribe(){
    try{
      if(Notification.permission==='default'){
        const permission=await Notification.requestPermission();
        if(permission!=='granted'){banner('Los avisos necesitan permiso del móvil. Puedes permitirlos en los ajustes del navegador.');return;}
      }
      if(Notification.permission!=='granted'){banner('Los avisos están bloqueados en el navegador. Permítelos en sus ajustes para recibir la alineación del Madrid.');return;}
      const response=await request('/config');if(!response.ok)throw Error('service');const config=await response.json();if(!config.ready||!config.publicKey)throw Error('config');
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
      const sent=await request('/subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});
      if(!sent.ok)throw Error('registration');
      if(message){message.textContent='Avisos de la alineación del Madrid preparados en este móvil.';setTimeout(()=>{message?.remove();message=null;},6000);}
    }catch{banner('No se han podido preparar los avisos. La app sigue funcionando.',{label:'Volver a intentar',run:subscribe});}
  }
  if(Notification.permission==='default')banner('Permite una vez las notificaciones para recibir siempre el once del Real Madrid, también con la app cerrada.',{label:'Permitir notificaciones',run:subscribe});else subscribe();
})();

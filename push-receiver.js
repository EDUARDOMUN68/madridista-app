/* Recibe avisos incluso cuando la ventana de Madridista está cerrada. */
function rememberPush(id){
  return new Promise((resolve,reject)=>{
    const open=indexedDB.open('madridista-push',1);
    open.onupgradeneeded=()=>open.result.createObjectStore('seen',{keyPath:'id'});
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('seen','readwrite'),store=tx.objectStore('seen');let added=false;
      const get=store.get(id);get.onsuccess=()=>{if(!get.result){store.add({id,at:Date.now()});added=true;}};
      const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(c){if(c.value.at<Date.now()-45*86400000)c.delete();c.continue();}};
      tx.oncomplete=()=>{db.close();resolve(added);};tx.onerror=()=>{db.close();reject(tx.error);};
    };
  });
}
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let notice;try{notice=event.data?.json();}catch{return;}
    if(!['madrid-lineup','madrid-ready'].includes(notice?.kind)||!/^\d+$/.test(notice.matchId)||!Number.isFinite(notice.expiresAt)||notice.expiresAt<=Date.now())return;
    let url;try{url=new URL(notice.url);const scope=new URL(self.registration.scope);if(url.origin!==scope.origin||url.pathname!==scope.pathname)return;}catch{return;}
    if(!await rememberPush(notice.kind+':'+notice.matchId))return;
    await self.registration.showNotification(notice.kind==='madrid-ready'?'Avisos del Madrid activados':'¡Ya hay once del Real Madrid!',{body:String(notice.body||'Toca para ver la alineación.').slice(0,180),icon:new URL('crest-192.png',self.registration.scope).href,badge:new URL('crest-192.png',self.registration.scope).href,tag:notice.kind+'-'+notice.matchId,renotify:false,data:{url:url.href}});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();event.waitUntil((async()=>{
    const target=event.notification.data?.url||self.registration.scope;
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    const existing=windows.find(w=>w.url.startsWith(self.registration.scope));
    if(existing){await existing.navigate(target);await existing.focus();}else await clients.openWindow(target);
  })());
});

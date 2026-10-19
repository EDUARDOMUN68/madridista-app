importScripts('./push-receiver.js?v=3.29.0');
const CACHE='madridista-v3.29.0';
const STATIC=['./push-config.js?v=3.29.0','./push-client.js?v=3.29.0','./push-open.js?v=3.29.0','./push-receiver.js?v=3.29.0','./match-detail.js?v=3.29.0','./match-detail.css?v=3.29.0','./','./index.html','./manifest.webmanifest?v=3.29.0','./crest-192.png?v=3.29.0','./icon-512.png?v=3.29.0','./icon-maskable-512.png?v=3.29.0'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);

  // Datos: siempre intentamos red primero para que directo, jornada y clasificación
  // no queden atrapados en una versión antigua del JSON.
  if(url.pathname.endsWith('real_madrid.json')){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put('./real_madrid.json',copy));
          return resp;
        })
        .catch(()=>caches.match('./real_madrid.json',{ignoreSearch:true}))
    );
    return;
  }

  // HTML/navegación: red primero. Así una nueva versión de index.html llega a la
  // PWA sin depender de que el usuario vacíe caché manualmente.
  if(e.request.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/')){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(resp=>{
          const copy=resp.clone();
          caches.open(CACHE).then(c=>c.put('./index.html',copy));
          return resp;
        })
        .catch(()=>caches.match('./index.html',{ignoreSearch:true}).then(r=>r||caches.match('./',{ignoreSearch:true})))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});

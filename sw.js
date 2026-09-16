const CACHE='madridista-v3-6-jornada';
const STATIC=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png'];

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
  const sameOrigin=url.origin===self.location.origin;

  if(sameOrigin && (e.request.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/'))){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./index.html',copy));return resp;})
        .catch(()=>caches.match('./index.html',{ignoreSearch:true}).then(r=>r||caches.match('./')))
    );
    return;
  }

  if(sameOrigin && url.pathname.endsWith('real_madrid.json')){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put('./real_madrid.json',copy));return resp;})
        .catch(()=>caches.match('./real_madrid.json',{ignoreSearch:true}))
    );
    return;
  }

  if(sameOrigin){
    e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(r=>r||fetch(e.request)));
    return;
  }

  // Las APIs de directo nunca se sirven desde la caché de la PWA.
  e.respondWith(fetch(e.request));
});

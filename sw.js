const CACHE='karibik-korsar-v77';
const FONTS='kk-fonts-v1';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-maskable-512.png','./three.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE&&x!==FONTS).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com'){
    /* Schriften nach dem ersten Laden auch offline verfügbar */
    e.respondWith(caches.open(FONTS).then(c=>c.match(e.request).then(r=>r||fetch(e.request).then(res=>{if(res&&(res.ok||res.type==='opaque'))c.put(e.request,res.clone());return res}).catch(()=>r))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(res=>{
    if(res&&res.ok&&u.origin===location.origin){const cp=res.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}
    return res;
  }).catch(()=>caches.match('./index.html'))));
});

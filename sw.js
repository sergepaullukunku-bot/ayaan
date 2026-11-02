// Ayaan : fonctionnement hors ligne. Changer VERSION à chaque mise à jour des fichiers.
const VERSION='ayaan-v13';
const FILES=['./','./index.html','./central.html','./manifest.webmanifest','./central.webmanifest','./icon-192.png','./icon-512.png','./maskable-192.png','./maskable-512.png','./apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==VERSION).map(n=>caches.delete(n)))).then(()=>self.clients.claim()))});
// Réponse immédiate depuis le cache (rapide même avec une connexion faible), mise à jour en arrière-plan.
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(caches.open(VERSION).then(c=>c.match(e.request,{ignoreSearch:true}).then(hit=>{
    const net=fetch(e.request).then(r=>{if(r&&r.ok)c.put(e.request,r.clone());return r}).catch(()=>hit||c.match('./index.html'));
    return hit||net;
  })));
});

// Toucher la notification ouvre Ayaan
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{for(const c of l){if(c.url.includes('index.html')||c.url.endsWith('/'))return c.focus()}return clients.openWindow('./index.html')}))});

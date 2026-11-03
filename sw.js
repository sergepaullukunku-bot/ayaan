/* =====================================================================
   Ayaan · sw.js — service worker (fonctionnement hors ligne et mises à jour)

   STRATÉGIE
   1. Installation : tous les fichiers de l'application sont copiés dans un
      cache dont le nom contient la version (ex. « ayaan-v15.0 »).
      Ils sont téléchargés en contournant le cache HTTP (cache: 'reload'),
      pour être sûr d'avoir la nouvelle version complète.
   2. Utilisation : les fichiers sont servis DEPUIS LE CACHE (« cache d'abord »).
      L'application démarre donc toujours, avec ou sans réseau, et tous ses
      fichiers sont de la MÊME version (jamais un mélange ancien/nouveau).
   3. Mise à jour : dès que le téléphone retrouve le réseau, la page demande
      au navigateur de vérifier ce fichier sw.js (voir js/maj.js). S'il a
      changé (nouvelle VERSION), la nouvelle version s'installe en arrière-plan
      puis ATTEND. La page propose alors « Mettre à jour » ; si personne n'est
      connecté, elle l'applique tout de suite.
   4. Activation : l'ancien cache est supprimé.

   À CHAQUE NOUVELLE VERSION : changer VERSION ci-dessous (et dans js/config.js).
   ===================================================================== */

const VERSION = 'ayaan-v15.1';

// Fichiers indispensables : si l'un manque, l'installation échoue (et l'ancienne version reste en place).
const FICHIERS = [
  './', 'index.html', 'central.html',
  'manifest.webmanifest', 'central.webmanifest',
  'css/ayaan.css', 'css/central.css', 'css/verrou.css', 'css/adaptatif.css',
  'js/config.js', 'js/coffre.js', 'js/auth.js', 'js/migration.js', 'js/maj.js', 'js/accueil.js',
  'js/outils.js', 'js/calculs.js', 'js/fichiers.js', 'js/stockage.js', 'js/import.js', 'js/excel.worker.js', 'js/app.js', 'js/central.js',
  'icones/icon-192.png', 'icones/icon-512.png', 'icones/maskable-192.png', 'icones/maskable-512.png',
  'icones/apple-touch-icon.png',
];
// Fichiers facultatifs : mis en cache s'ils existent (la bibliothèque SheetJS).
const FACULTATIFS = ['vendor/xlsx.mini.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(FICHIERS.map((u) => new Request(u, { cache: 'reload' })));
    for (const u of FACULTATIFS) {
      try {
        const r = await fetch(new Request(u, { cache: 'reload' }));
        if (r.ok) await cache.put(u, r);
      } catch (e) { /* fichier absent : l'application utilisera son lecteur intégré */ }
    }
    // Passage depuis la v14 ou avant (les anciennes pages ne savent pas
    // demander la mise à jour) : on s'active tout de suite.
    const anciens = (await caches.keys()).filter((k) => /^ayaan-v(\d+)/.test(k) && +k.match(/^ayaan-v(\d+)/)[1] < 15);
    if (anciens.length) self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('ayaan-') && k !== VERSION) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

// La page demande d'appliquer la nouvelle version (bouton « Mettre à jour »)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'MAJ_MAINTENANT') self.skipWaiting();
  if (event.data && event.data.type === 'VERSION' && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Seulement les lectures (GET) de notre propre site ; tout le reste passe normalement.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    // Navigation (ouverture d'une page) : la page en cache, sinon l'accueil
    if (req.mode === 'navigate') {
      return (await cache.match(req, { ignoreSearch: true })) ||
        (await cache.match('index.html')) ||
        fetch(req);
    }
    const enCache = await cache.match(req, { ignoreSearch: true });
    if (enCache) return enCache;
    try {
      return await fetch(req);
    } catch (e) {
      return new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

// Clic sur une notification : ouvrir (ou ramener) Ayaan
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((l) => {
    for (const c of l) { if (c.url.includes('index.html') || c.url.endsWith('/')) return c.focus(); }
    return self.clients.openWindow('./index.html');
  }));
});

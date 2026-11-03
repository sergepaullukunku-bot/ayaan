/* =====================================================================
   Ayaan · maj.js — inscription du service worker et mises à jour

   QUAND VÉRIFIE-T-ON S'IL Y A UNE NOUVELLE VERSION ?
   - à l'ouverture de l'application ;
   - dès que le téléphone RETROUVE LE RÉSEAU (événement « online ») ;
   - quand on revient dans l'application (au plus une fois toutes les 10 min) ;
   - toutes les heures si l'application reste ouverte.

   QUE SE PASSE-T-IL QUAND UNE VERSION EST PRÊTE ?
   - Personne n'est connecté (écran de verrouillage) : elle est appliquée
     tout de suite (rien à perdre).
   - Quelqu'un est connecté : un bandeau propose « Mettre à jour ». Au clic,
     les écritures en cours sont terminées, la nouvelle version est activée
     et la page se recharge (il faudra entrer à nouveau son PIN).
   Les données ne sont jamais touchées par une mise à jour.
   ===================================================================== */

import * as Coffre from './coffre.js';

let enregistrement = null;
let derniereVerif = 0;

function utilisateurConnecte() { return !!(window.AY && window.AY.user && window.AY.user()); }

// Vérifier s'il existe une nouvelle version (sans effet si hors ligne)
async function verifier(force) {
  if (!enregistrement || !navigator.onLine) return;
  if (!force && Date.now() - derniereVerif < 10 * 60 * 1000) return;
  derniereVerif = Date.now();
  try { await enregistrement.update(); } catch (e) { /* réseau instable : on réessaiera */ }
}

// Activer la version en attente puis recharger la page
async function appliquer() {
  const attente = enregistrement && enregistrement.waiting;
  if (!attente) return;
  const b = document.getElementById('majBandeau');
  if (b) b.querySelector('span').textContent = 'Mise à jour en cours…';
  await Coffre.attendre();
  attente.postMessage({ type: 'MAJ_MAINTENANT' });
}

function proposer() {
  // Personne n'est connecté et rien n'est en cours de saisie : on applique tout de suite
  const saisie = ['pinIn', 'pinIn2', 'pinName'].some((id) => { const e = document.getElementById(id); return e && e.value; });
  if (!utilisateurConnecte() && !saisie) { appliquer(); return; }
  let b = document.getElementById('majBandeau');
  if (!b) {
    b = document.createElement('div');
    b.id = 'majBandeau';
    b.setAttribute('role', 'status');
    b.innerHTML = '<span>Une nouvelle version d\'Ayaan est prête. Vos données sont conservées.</span>' +
      '<span class="acts"><button type="button" class="plus-tard">Plus tard</button> <button type="button" class="ok">Mettre à jour</button></span>';
    b.querySelector('.ok').addEventListener('click', appliquer);
    b.querySelector('.plus-tard').addEventListener('click', () => { b.hidden = true; });
    document.body.appendChild(b);
  }
  b.hidden = false;
}

// Surveille l'installation d'une nouvelle version
function surveiller(reg) {
  if (reg.waiting && navigator.serviceWorker.controller) proposer();
  reg.addEventListener('updatefound', () => {
    const nouveau = reg.installing;
    if (!nouveau) return;
    nouveau.addEventListener('statechange', () => {
      if (nouveau.state === 'installed' && navigator.serviceWorker.controller) proposer();
    });
  });
}

export async function demarrerMisesAJour() {
  if (!('serviceWorker' in navigator)) return;
  try {
    // updateViaCache: 'none' → le navigateur ne lit jamais sw.js dans son cache HTTP
    enregistrement = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch (e) { return; }
  surveiller(enregistrement);
  // Quand la nouvelle version prend le contrôle : recharger une seule fois
  // (pas lors de la toute première installation, où il n'y avait pas encore de version)
  const avaitUneVersion = !!navigator.serviceWorker.controller;
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recharge || !avaitUneVersion) return;
    recharge = true;
    Coffre.attendre().then(() => location.reload());
  });
  addEventListener('online', () => verifier(true));                 // retour du réseau
  document.addEventListener('visibilitychange', () => { if (!document.hidden) verifier(false); });
  setInterval(() => verifier(true), 60 * 60 * 1000);                 // toutes les heures
  verifier(true);
}

// Après la connexion d'un utilisateur, une version déjà prête est proposée
document.addEventListener('ayaan-user', () => { if (enregistrement && enregistrement.waiting) proposer(); });

demarrerMisesAJour();

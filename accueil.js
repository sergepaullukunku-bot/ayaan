/* =====================================================================
   Ayaan · accueil.js — écran d'accueil animé (logo) au lancement
   Disparaît après un court instant, ou au toucher.
   ===================================================================== */
(function () {
  const s = document.getElementById('splash');
  if (!s) return;
  const duree = matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 900;
  const fermer = () => { s.classList.add('out'); setTimeout(() => s.remove(), 500); };
  setTimeout(fermer, duree);
  s.addEventListener('click', fermer);
})();

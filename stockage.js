/* =====================================================================
   Ayaan · stockage.js — stockage PERSISTANT (navigator.storage.persist)

   Sans cette demande, le navigateur peut effacer la base IndexedDB quand
   la mémoire du téléphone est pleine, ou (Safari sur iPhone, application
   NON installée) après quelques jours sans utilisation.

   Ce que fait chaque système :
   - Android / ordinateur (Chrome, Edge) : accordé automatiquement quand
     Ayaan est installée (icône sur l'écran d'accueil / dans le menu Démarrer).
   - Firefox : le navigateur peut poser la question à l'utilisateur.
   - iPhone / iPad (Safari) : une application ajoutée à l'écran d'accueil
     n'est pas soumise à l'effacement après 7 jours ; persist() est demandé
     en plus (Safari 15.2 et plus récents).
   La demande est faite au démarrage et à chaque connexion (après un geste
   de l'utilisateur, ce que certains navigateurs exigent).
   ===================================================================== */

let dejaAccorde = false;

// Demande la protection du stockage. Renvoie 'protege', 'non' ou 'indisponible'.
export async function demanderPersistance() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return 'indisponible';
    if (dejaAccorde || (await navigator.storage.persisted())) {
      dejaAccorde = true;
      return 'protege';
    }
    dejaAccorde = await navigator.storage.persist();
    return dejaAccorde ? 'protege' : 'non';
  } catch (e) {
    return 'indisponible';
  }
}

// L'application est-elle ouverte en mode « installée » (écran d'accueil) ?
export const estInstallee = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;

const estIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// État lisible par l'utilisateur, pour le panneau « Règles et sauvegarde »
export async function etatStockage() {
  const etat = await demanderPersistance();
  let place = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      if (usage != null)
        place =
          ` Place utilisée : ${(usage / 1048576).toFixed(1).replace('.', ',')} Mo` +
          (quota ? ` sur ${Math.round(quota / 1048576).toLocaleString('fr-FR')} Mo disponibles.` : '.');
    }
  } catch (e) {
    /* estimation indisponible */
  }
  if (etat === 'protege') {
    return {
      ok: true,
      texte: 'Stockage protégé : le navigateur ne supprimera pas les données de cet appareil.' + place,
    };
  }
  const conseil = estInstallee()
    ? 'Faites des sauvegardes régulières.'
    : estIOS()
      ? "Installez Ayaan : dans Safari, touchez Partager › « Sur l'écran d'accueil », puis ouvrez-la depuis son icône. Faites aussi des sauvegardes régulières."
      : "Installez Ayaan (menu du navigateur › « Installer l'application » ou « Ajouter à l'écran d'accueil »), puis ouvrez-la depuis son icône. Faites aussi des sauvegardes régulières.";
  return {
    ok: false,
    texte:
      "Stockage non garanti : le navigateur pourrait effacer les données s'il manque de place ou après une longue inactivité. " +
      conseil +
      place,
  };
}

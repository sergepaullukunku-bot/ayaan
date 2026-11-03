/* =====================================================================
   Ayaan · fichiers.js — ouvrir et enregistrer des fichiers
   avec les API STANDARD des navigateurs (aucune API réservée à un système)

   OUVRIR : <input type="file">
   - Windows / Mac / Linux : ouvre l'Explorateur de fichiers ou le Finder ;
     on peut aussi GLISSER-DÉPOSER le fichier sur la page.
   - iPhone / iPad : ouvre l'application « Fichiers » (iCloud Drive, Sur mon
     iPhone, WhatsApp…), ou les Photos / l'appareil photo selon le type.
   - Android : ouvre le sélecteur de fichiers (Téléchargements, Drive…).
   Le champ <input> n'est jamais en « display:none » (classe .fichier-cache) :
   certains anciens navigateurs mobiles refusent d'ouvrir un champ invisible.

   ENREGISTRER :
   - ordinateur : téléchargement classique (dossier Téléchargements) ;
   - Android : téléchargement classique (dossier Téléchargements) ;
   - iPhone / iPad : la feuille de partage du système (« Enregistrer dans
     Fichiers », WhatsApp…), car le téléchargement fonctionne mal dans une
     application installée sur l'écran d'accueil ; sinon téléchargement.
   ===================================================================== */

// Lecture d'un fichier en octets (FileReader en secours pour les anciens Safari)
export function lireOctets(fichier) {
  if (fichier.arrayBuffer) return fichier.arrayBuffer();
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => ko(r.error || new Error('lecture du fichier impossible'));
    r.readAsArrayBuffer(fichier);
  });
}

// Texte : UTF-8 si possible, sinon Windows-1252 (CSV enregistré par Excel sous Windows)
export function decoderTexte(tampon) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(tampon);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(tampon);
  }
}
export async function lireTexte(fichier) {
  return decoderTexte(await lireOctets(fichier));
}

// iPhone / iPad (y compris iPad qui se présente comme un Mac)
export const estIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Enregistre un fichier créé par Ayaan (rapport, sauvegarde, liste CSV).
 * @returns {Promise<'partage'|'telecharge'|'annule'>}
 */
export async function enregistrerFichier(nom, texte, type) {
  const blob = new Blob([texte], { type });
  if (estIOS() && navigator.canShare && typeof File === 'function') {
    try {
      const f = new File([blob], nom, { type });
      if (navigator.canShare({ files: [f] })) {
        await navigator.share({ files: [f], title: nom });
        return 'partage';
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return 'annule'; // l'utilisateur a fermé la feuille de partage
      /* partage refusé : on passe au téléchargement */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
  return 'telecharge';
}

/**
 * Glisser-déposer (ordinateur) : déposer un fichier sur « zone » équivaut à le choisir.
 * @param {HTMLElement} zone  élément qui reçoit le fichier
 * @param {(fichiers: File[]) => void} recevoir
 * @param {() => boolean} autorise  vérifie les droits de l'utilisateur
 */
export function brancherDepot(zone, recevoir, autorise = () => true) {
  let n = 0;
  const contientFichier = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  zone.addEventListener('dragenter', (e) => {
    if (!contientFichier(e) || !autorise()) return;
    e.preventDefault();
    n++;
    zone.classList.add('depot-actif');
  });
  zone.addEventListener('dragover', (e) => {
    if (!contientFichier(e) || !autorise()) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    if (--n <= 0) {
      n = 0;
      zone.classList.remove('depot-actif');
    }
  });
  zone.addEventListener('drop', (e) => {
    if (!contientFichier(e)) return;
    e.preventDefault();
    n = 0;
    zone.classList.remove('depot-actif');
    if (!autorise()) return;
    const l = [...e.dataTransfer.files];
    if (l.length) recevoir(l);
  });
}

/* =====================================================================
   Ayaan · migration.js — passage des versions 14 (et antérieures) à la v15

   Jusqu'à la v14, les données étaient gardées EN CLAIR dans le
   localStorage du navigateur. La v15 les lit UNE SEULE FOIS, les range
   chiffrées dans le coffre (IndexedDB), puis efface le localStorage.
   Ce fichier est le seul endroit où le localStorage est encore lu.
   ===================================================================== */

// Correspondance : ancienne clé localStorage → nom de la donnée dans le coffre
export const ANCIENNES_CLES = {
  'cvasf.data.v1': 'export',
  'cvasf.saisies.v1': 'saisies',
  'cvasf.manuels.v1': 'manuels',
  'cvasf.archives.v1': 'archives',
  'cvasf.annees.v1': 'annees',
  'cvasf.dernsauv.v1': 'derniereSauvegarde',
  'ayaan.central.v1': 'central',
};

function lireJSON(cle) {
  try { const t = localStorage.getItem(cle); return t == null ? null : JSON.parse(t); } catch (e) { return null; }
}

// Renvoie ce que l'ancienne version a laissé sur l'appareil (ou null s'il n'y a rien)
export function ancienneVersion() {
  let comptes = null;
  const donnees = {};
  try {
    const u = lireJSON('ayaan.users.v1');
    if (u && Array.isArray(u.users)) comptes = u.users;
    else {
      const v7 = lireJSON('ayaan.pin.v1'); // v7 : un seul PIN, devenu celui de l'administrateur
      if (v7 && v7.h) comptes = [{ id: 'v7admin', nom: 'Administrateur', role: 'admin', s: v7.s, h: v7.h, cree: '' }];
    }
    for (const [ancienne, nom] of Object.entries(ANCIENNES_CLES)) {
      const v = lireJSON(ancienne);
      if (v != null) donnees[nom] = v;
    }
  } catch (e) { return null; } // localStorage inaccessible : rien à migrer
  if (!comptes && !Object.keys(donnees).length) return null;
  return { comptes: comptes || [], donnees };
}

// Empreinte du PIN telle que calculée par la v14 (SHA-256 répété 1000 fois),
// utilisée UNIQUEMENT pour reconnaître l'ancien PIN pendant la migration.
export async function ancienneEmpreinte(sel, pin) {
  const d = new TextEncoder().encode(sel + '|' + pin);
  let b = await crypto.subtle.digest('SHA-256', d);
  for (let i = 0; i < 999; i++) b = await crypto.subtle.digest('SHA-256', new Uint8Array([...new Uint8Array(b), ...d]));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// Efface toutes les traces de l'ancienne version (après une migration réussie)
export function nettoyerAncienneVersion() {
  try {
    const aEffacer = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/^(cvasf|ayaan)\./.test(k)) aEffacer.push(k);
    }
    aEffacer.forEach((k) => localStorage.removeItem(k));
    sessionStorage.removeItem('ayaan.cur');
    sessionStorage.removeItem('ayaan.unl');
  } catch (e) { /* rien à faire */ }
}

/* =====================================================================
   Ayaan · excel.worker.js — lecture d'un classeur Excel avec SheetJS

   Ce fichier tourne dans un « Web Worker » : un fil d'exécution séparé.
   Un gros export Tier.Net se lit donc SANS bloquer l'écran du téléphone.

   Optimisations :
   - la bibliothèque SheetJS (vendor/xlsx.mini.min.js, version « mini »,
     la plus légère) n'est chargée qu'au premier import, pas au démarrage ;
   - seule la PREMIÈRE feuille est lue (option sheets: 0) ;
   - formules, styles, mise en forme et texte affiché ne sont pas décodés ;
   - le résultat est un simple tableau de lignes (valeurs brutes).

   Sécurité (OWASP M2 et M4) : une version de SheetJS plus ancienne que
   0.20.2 est refusée (failles connues CVE-2023-30533, CVE-2024-22363).
   ===================================================================== */

let charge = false;

// Compare deux numéros de version « a.b.c » : renvoie vrai si v >= min
function versionOk(v, min) {
  const a = String(v).split('.').map(Number), b = String(min).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
  return true;
}

self.onmessage = (e) => {
  const { tampon, versionMin } = e.data;
  try {
    if (!charge) { importScripts('../vendor/xlsx.mini.min.js'); charge = true; }
  } catch (err) {
    self.postMessage({ ok: false, code: 'absente', erreur: 'bibliothèque SheetJS absente' });
    return;
  }
  if (!versionOk(self.XLSX.version, versionMin)) {
    self.postMessage({ ok: false, code: 'version', erreur: `SheetJS ${self.XLSX.version} trop ancienne (minimum ${versionMin})` });
    return;
  }
  try {
    const classeur = self.XLSX.read(tampon, {
      type: 'array',
      sheets: 0,          // première feuille seulement
      dense: true,        // stockage compact, plus rapide sur les gros fichiers
      cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellNF: false,
      cellDates: false,   // les dates restent des nombres Excel, convertis ensuite par Ayaan
    });
    const feuille = classeur.Sheets[classeur.SheetNames[0]];
    if (!feuille) throw new Error('feuille introuvable dans le classeur');
    const lignes = self.XLSX.utils.sheet_to_json(feuille, { header: 1, raw: true, defval: null, blankrows: true });
    self.postMessage({ ok: true, lignes, version: self.XLSX.version });
  } catch (err) {
    self.postMessage({ ok: false, code: 'lecture', erreur: err && err.message ? err.message : String(err) });
  }
};

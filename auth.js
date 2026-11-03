/* =====================================================================
   Ayaan · auth.js — écran de verrouillage, comptes et droits

   - Connexion : type de compte (1. Administrateurs / 2. Utilisateurs), puis PIN.
   - Le bon PIN ouvre le coffre chiffré (voir coffre.js) ; il n'est jamais stocké.
   - 5 erreurs : attente de 30 s, puis 60 s, 120 s… (compteur gardé même si
     on recharge la page).
   - Verrouillage (bouton, 10 min d'inactivité ou 5 min dans une autre
     application) : les écritures en cours sont terminées, puis la page est
     rechargée, ce qui efface de la mémoire la clé et les données déchiffrées.
   - Le reste de l'application attend « AY.pret » (une promesse) avant de
     démarrer : rien n'est affiché tant que le coffre n'est pas ouvert.
   ===================================================================== */

import {
  ROLES, PERMS, ACTIONS, peut, PIN_MIN, PIN_MAX, ESSAIS_MAX, ATTENTE_BASE,
  DELAI_INACTIVITE, DELAI_ABSENCE,
} from './config.js';
import * as Coffre from './coffre.js';
import { ancienneVersion, ancienneEmpreinte, nettoyerAncienneVersion } from './migration.js';
import { demanderPersistance } from './stockage.js';

const $ = (id) => document.getElementById(id);
const nettoyer = (t) => String(t).replace(/[&<>"']/g, '');
const idAleatoire = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
const aujourdhui = () => new Date().toISOString().slice(0, 10);

let CUR = null;           // compte connecté
let mode = '';            // écran affiché : unlock, first, newpin, recover, migration, showcode, denied, change, erreur
let cible = null;         // compte dont on change le PIN
let ANCIEN = null;        // données de l'ancienne version (migration)
let derniereActivite = Date.now();
let cacheA = 0;           // moment où l'application est passée en arrière-plan
let pretOk;
const pret = new Promise((ok) => { pretOk = ok; });

// Éléments de l'écran de verrouillage
const CAT = $('pinCat'), L = $('pinLock'), N = $('pinName'), I = $('pinIn'), I2 = $('pinIn2'),
  E = $('pinErr'), P = $('pinP'), OK = $('pinOk'), F = $('pinForgot'), CB = $('pinCodeBox');

const pageCentrale = () => document.body.dataset.need === 'central';
const droitPage = () => document.body.dataset.need || '';
const peutCur = (d) => !!(CUR && (PERMS[CUR.role] || []).includes(d));

/* ---------------------------------------------------------------------
   Règles du code PIN
   --------------------------------------------------------------------- */
function pinInvalide(a) {
  if (!new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(a)) return `Le code PIN doit contenir ${PIN_MIN} à ${PIN_MAX} chiffres.`;
  if (/^(\d)\1+$/.test(a) || '01234567890'.includes(a) || '98765432109'.includes(a) || /^(\d\d)\1+$/.test(a) || /^(\d{3})\1$/.test(a)) {
    return 'Code trop facile à deviner (ex. 000000, 123456, 121212) : choisissez-en un autre.';
  }
  return '';
}

// Un autre compte utilise-t-il déjà ce PIN ? (il faut un PIN différent par personne)
async function pinDejaPris(pin, saufId) {
  const autres = (await Coffre.comptes()).filter((c) => c.id !== saufId && c.env);
  const r = await Promise.all(autres.map((c) => Coffre.pinOuvre(c, pin)));
  return r.some(Boolean);
}

/* ---------------------------------------------------------------------
   Compteur d'essais (gardé dans la base pour résister au rechargement)
   --------------------------------------------------------------------- */
async function essais() { return (await Coffre.metaLire('essais')) || { n: 0, serie: 0, jusqua: 0 }; }
async function echec() {
  const e = await essais();
  e.n++;
  if (e.n >= ESSAIS_MAX) { e.serie++; e.n = 0; e.jusqua = Date.now() + Math.min(ATTENTE_BASE * 2 ** (e.serie - 1), 15 * 60 * 1000); }
  await Coffre.metaEcrire('essais', e);
  return e;
}
const reussite = () => Coffre.metaEcrire('essais', { n: 0, serie: 0, jusqua: 0 });

/* ---------------------------------------------------------------------
   Affichage de l'écran de verrouillage
   --------------------------------------------------------------------- */
function afficher(m, texte) {
  mode = m;
  L.hidden = false;
  E.textContent = ''; I.value = ''; I2.value = ''; N.value = '';
  N.hidden = true; I2.hidden = true; CB.hidden = true; F.hidden = true;
  CAT.hidden = m !== 'unlock'; CAT.value = '';
  I.hidden = m === 'unlock' || m === 'denied' || m === 'erreur';
  OK.hidden = m === 'unlock' || m === 'erreur';
  OK.disabled = false; OK.textContent = 'Valider';
  I.type = 'password'; I.maxLength = PIN_MAX; I.setAttribute('inputmode', 'numeric'); I.setAttribute('aria-label', 'Code PIN');
  I2.maxLength = PIN_MAX;

  const textes = {
    unlock: 'Choisissez votre type de compte, puis entrez votre code PIN.',
    first: `Première utilisation : créez le compte administrateur de cet appareil. Saisissez votre nom, puis un code PIN de ${PIN_MIN} à ${PIN_MAX} chiffres et confirmez-le.`,
    newpin: `Choisissez votre nouveau code PIN (${PIN_MIN} à ${PIN_MAX} chiffres), puis confirmez-le.`,
    recover: "Administrateur : entrez le code de secours noté à la création (ex. ABCD-1234). Les autres utilisateurs demandent à l'administrateur de redéfinir leur PIN.",
    migration: "Mise à jour de sécurité : vos données vont être chiffrées sur cet appareil. Administrateur, entrez votre code PIN actuel.",
    denied: 'Le centralisateur est réservé aux administrateurs. Votre compte est un compte utilisateur.',
  };
  P.textContent = texte || textes[m] || '';
  if (m === 'first') { N.hidden = false; I2.hidden = false; }
  if (m === 'newpin') I2.hidden = false;
  if (m === 'recover') { I.removeAttribute('inputmode'); I.type = 'text'; I.maxLength = 9; I.setAttribute('aria-label', 'Code de secours'); }
  if (m === 'denied') OK.textContent = 'Retour à Ayaan Suivi CV';
  if (m === 'unlock' && pageCentrale()) {
    CAT.value = 'admin'; CAT.hidden = true; I.hidden = false; OK.hidden = false; F.hidden = false;
    P.textContent = 'Centralisateur : connexion réservée aux administrateurs. Entrez votre code PIN.';
  }
  setTimeout(() => (m === 'unlock' && !CAT.hidden ? CAT : (N.hidden ? I : N)).focus(), 50);
}
function cacher() { L.hidden = true; mode = ''; derniereActivite = Date.now(); }
function occupe(oui, texte) { OK.disabled = oui; if (oui) E.textContent = texte || 'Vérification…'; }

/* ---------------------------------------------------------------------
   Connexion réussie : on charge (déchiffre) les données puis on démarre
   --------------------------------------------------------------------- */
async function connecter(compte) {
  await Coffre.charger();
  CUR = compte;
  await reussite();
  peindre();
  if (droitPage() && !peutCur(droitPage())) { afficher('denied'); return; }
  cacher();
  pretOk(publique());
  document.dispatchEvent(new CustomEvent('ayaan-user', { detail: publique() }));
}
const publique = () => (CUR ? { id: CUR.id, nom: CUR.nom, role: CUR.role, roleLab: ROLES[CUR.role] } : null);

// Nom de l'utilisateur et droits appliqués aux boutons (data-perm)
function peindre() {
  document.querySelectorAll('[data-who]').forEach((el) => {
    el.innerHTML = CUR ? `Connecté : <b>${nettoyer(CUR.nom)}</b> · ${ROLES[CUR.role]} · <button type="button" class="lien-droits" data-action="droits">Mes droits</button>` : '';
  });
  document.querySelectorAll('[data-perm]').forEach((el) => {
    const ok = peutCur(el.dataset.perm);
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(el.tagName)) el.disabled = !ok; else el.hidden = !ok;
  });
}

/* ---------------------------------------------------------------------
   Validation de l'écran de verrouillage (bouton « Valider » ou Entrée)
   --------------------------------------------------------------------- */
async function valider() {
  if (OK.disabled) return;
  demanderPersistance(); // appelée pendant le geste de l'utilisateur (exigé par certains navigateurs)
  try {
    if (mode === 'unlock' || mode === 'change' || mode === 'migration') return await validerPin();
    if (mode === 'denied') { location.href = 'index.html'; return; }
    if (mode === 'first' || mode.startsWith('newpin')) return await validerNouveauPin();
    if (mode === 'recover') return await validerSecours();
    if (mode === 'showcode') cacher();
  } catch (err) {
    occupe(false); E.textContent = 'Erreur : ' + err.message;
  }
}

async function validerPin() {
  const e = await essais();
  if (Date.now() < e.jusqua) { E.textContent = `Trop d'essais : patientez ${Math.ceil((e.jusqua - Date.now()) / 1000)} s.`; return; }
  if (mode === 'unlock' && !CAT.value) { E.textContent = "Choisissez d'abord votre type de compte."; return; }
  const pin = I.value.trim();
  occupe(true);
  let compte = null;
  if (mode === 'migration') {
    for (const c of ANCIEN.comptes) {
      if (c.role === 'admin' && c.s && c.h && (await ancienneEmpreinte(c.s, pin)) === c.h) { compte = c; break; }
    }
  } else if (mode === 'change') {
    compte = (await Coffre.pinOuvre(CUR, pin)) ? CUR : null;
  } else {
    const cat = CAT.value;
    compte = await Coffre.ouvrirAvecPin(pin, (c) => (cat === 'admin' ? c.role === 'admin' : c.role !== 'admin'));
    if (!compte && cat === 'user' && (await Coffre.comptes()).some((c) => c.role !== 'admin' && !c.env)) {
      occupe(false); I.value = '';
      E.textContent = "Code PIN incorrect. Après la mise à jour de sécurité, l'administrateur doit redéfinir le PIN des utilisateurs.";
      await echec(); return;
    }
  }
  occupe(false);
  if (!compte) {
    I.value = '';
    const r = await echec();
    E.textContent = Date.now() < r.jusqua ? `${ESSAIS_MAX} essais incorrects : patientez ${Math.ceil((r.jusqua - Date.now()) / 1000)} s.` : 'Code PIN incorrect.';
    return;
  }
  await reussite();
  if (mode === 'change' || mode === 'migration') {
    cible = compte;
    const m = mode;
    afficher('newpin', m === 'migration'
      ? `Ancien PIN accepté. Choisissez maintenant un nouveau code PIN de ${PIN_MIN} à ${PIN_MAX} chiffres pour ${compte.nom} : il protégera les données chiffrées.`
      : undefined);
    mode = m === 'migration' ? 'newpin-migration' : 'newpin';
    return;
  }
  await connecter(compte);
}

async function validerNouveauPin() {
  const nom = N.value.trim(), a = I.value.trim(), b = I2.value.trim();
  if (mode === 'first' && nom.length < 2) { E.textContent = 'Saisissez votre nom.'; return; }
  const err = pinInvalide(a);
  if (err) { E.textContent = err; return; }
  if (a !== b) { E.textContent = 'Les deux codes ne sont pas identiques.'; I2.value = ''; return; }

  if (mode === 'first' || mode === 'newpin-migration') {
    occupe(true, 'Création du coffre chiffré…');
    const admin = mode === 'first'
      ? { id: idAleatoire(), nom: nom.slice(0, 40), role: 'admin', cree: aujourdhui() }
      : { id: cible.id, nom: cible.nom, role: 'admin', cree: cible.cree || aujourdhui() };
    const code = await Coffre.creerCoffre(admin, a);
    await importerAncienneVersion(admin.id);
    const compte = (await Coffre.comptes()).find((c) => c.id === admin.id);
    cible = null;
    await connecter(compte);
    // Afficher le code de secours (une seule fois)
    L.hidden = false; mode = 'showcode';
    P.textContent = "Coffre chiffré créé. Notez ce code de secours sur papier et gardez-le en lieu sûr : il permet à l'administrateur de choisir un nouveau PIN s'il l'oublie, et d'ouvrir une sauvegarde sur un autre appareil. Sans PIN ni code de secours, les données ne peuvent plus être lues par personne.";
    CB.textContent = code; CB.hidden = false; N.hidden = true; I.hidden = true; I2.hidden = true; CAT.hidden = true; F.hidden = true;
    E.textContent = ''; OK.hidden = false; OK.disabled = false; OK.textContent = "J'ai noté le code de secours"; OK.focus();
    return;
  }
  // newpin : changement de PIN d'un compte existant (coffre déjà ouvert)
  occupe(true);
  if (await pinDejaPris(a, cible.id)) { occupe(false); E.textContent = 'Ce code PIN est déjà utilisé par un autre utilisateur : choisissez-en un autre.'; return; }
  const maj = await Coffre.enregistrerCompte(cible, a);
  occupe(false);
  cible = null;
  if (!CUR) { await connecter(maj); } else { if (CUR.id === maj.id) CUR = maj; cacher(); }
  if (window.ayaanPinMsg) window.ayaanPinMsg('Nouveau code PIN enregistré.');
}

async function validerSecours() {
  occupe(true);
  const ok = await Coffre.ouvrirAvecSecours(I.value);
  occupe(false);
  if (!ok) { E.textContent = 'Code de secours incorrect.'; await echec(); return; }
  await reussite();
  cible = (await Coffre.comptes()).find((c) => c.role === 'admin');
  afficher('newpin', `Code de secours accepté. Choisissez un nouveau code PIN pour ${cible.nom} (administrateur), puis confirmez-le.`);
}

// Migration : range les données de la v14 dans le coffre, recrée les autres comptes (PIN à redéfinir)
async function importerAncienneVersion(idAdmin) {
  if (!ANCIEN) return;
  for (const [nom, valeur] of Object.entries(ANCIEN.donnees)) Coffre.ecrire(nom, valeur);
  for (const c of ANCIEN.comptes) {
    if (c.id === idAdmin || !ROLES[c.role]) continue;
    await Coffre.enregistrerCompte({ id: c.id, nom: String(c.nom).slice(0, 40), role: c.role, cree: c.cree || '', env: null });
  }
  await Coffre.attendre();
  nettoyerAncienneVersion();
  ANCIEN = null;
}

/* ---------------------------------------------------------------------
   Verrouillage
   --------------------------------------------------------------------- */
async function verrouiller() {
  if (!CUR) { if (mode === '') afficher('unlock'); return; }
  L.hidden = false; P.textContent = 'Verrouillage…';
  await Coffre.attendre();      // terminer les écritures chiffrées en cours
  location.reload();            // efface la clé et les données de la mémoire
}

/* ---------------------------------------------------------------------
   « Mes droits » et matrice
   --------------------------------------------------------------------- */
function montrerDroits() {
  if (!CUR) return;
  $('ayRS').textContent = CUR.nom + ' · ' + ROLES[CUR.role];
  $('ayRL').innerHTML = ACTIONS.map(([g, a]) => `<div class="rgt-g">${g}</div>` + a.map(([t, p]) => {
    const ok = peut(CUR.role, p);
    return `<div class="rgt"><b class="${ok ? 'y' : 'n'}">${ok ? 'Oui' : 'Non'}</b><span>${t}</span></div>`;
  }).join('')).join('');
  $('ayRights').hidden = false;
  $('ayRC').focus();
}
function matriceHTML() {
  const rk = Object.keys(ROLES);
  return `<table class="mx"><thead><tr><th>Action</th>${rk.map((r) => `<th class="c">${ROLES[r]}</th>`).join('')}</tr></thead><tbody>` +
    ACTIONS.map(([g, a]) => `<tr class="g"><td colspan="${rk.length + 1}">${g}</td></tr>` +
      a.map(([t, p]) => `<tr><td>${t}</td>${rk.map((r) => { const ok = peut(r, p); return `<td class="c ${ok ? 'y' : 'n'}">${ok ? 'Oui' : 'Non'}</td>`; }).join('')}</tr>`).join('')).join('') +
    '</tbody></table>';
}

/* ---------------------------------------------------------------------
   API utilisée par les pages (app.js, central.js)
   --------------------------------------------------------------------- */
export const AY = {
  ROLES, PERMS, pret,
  can: peutCur,
  user: publique,
  lock: verrouiller,
  showRights: montrerDroits,
  matrixHTML: matriceHTML,
  changePin() {
    if (!CUR) return;
    afficher('unlock'); mode = 'change';
    CAT.hidden = true; I.hidden = false; OK.hidden = false; F.hidden = true;
    P.textContent = 'Entrez votre code PIN actuel.';
    setTimeout(() => I.focus(), 60);
  },
  async list() {
    return (await Coffre.comptes()).map((u) => ({ id: u.id, nom: u.nom, role: u.role, roleLab: ROLES[u.role], cree: u.cree, sansPin: !u.env }));
  },
  // Créer ou modifier un utilisateur (administrateur seulement)
  async save(id, nom, role, pin) {
    if (!peutCur('utilisateurs')) return "Action réservée à l'administrateur.";
    nom = String(nom || '').trim().slice(0, 40);
    if (nom.length < 2) return "Saisissez le nom de l'utilisateur.";
    if (!ROLES[role]) return 'Choisissez un rôle.';
    const tous = await Coffre.comptes();
    const u = id ? tous.find((x) => x.id === id) : null;
    if (id && !u) return 'Utilisateur introuvable.';
    if (u && u.role === 'admin' && role !== 'admin' && tous.filter((x) => x.role === 'admin').length < 2) return 'Il faut garder au moins un administrateur.';
    if (!u || pin || !u.env) {
      const err = pinInvalide(pin || '');
      if (err) return u && !u.env && !pin ? 'Ce compte doit recevoir un nouveau code PIN.' : err;
      if (await pinDejaPris(pin, u && u.id)) return 'Ce code PIN est déjà utilisé par un autre utilisateur.';
    }
    if (tous.some((x) => x.id !== id && x.nom.toLowerCase() === nom.toLowerCase())) return 'Un utilisateur porte déjà ce nom.';
    const t = { ...(u || { id: idAleatoire(), cree: aujourdhui(), env: null }), nom, role };
    const enr = await Coffre.enregistrerCompte(t, pin || undefined);
    if (CUR && CUR.id === enr.id) CUR = enr;
    peindre();
    return '';
  },
  async del(id) {
    if (!peutCur('utilisateurs')) return "Action réservée à l'administrateur.";
    const tous = await Coffre.comptes();
    const u = tous.find((x) => x.id === id);
    if (!u) return 'Utilisateur introuvable.';
    if (CUR && CUR.id === id) return 'Vous ne pouvez pas supprimer votre propre compte.';
    if (u.role === 'admin' && tous.filter((x) => x.role === 'admin').length < 2) return 'Il faut garder au moins un administrateur.';
    await Coffre.supprimerCompte(id);
    return '';
  },
};
window.AY = AY; // pratique pour les tests ; ne donne aucun droit supplémentaire

/* ---------------------------------------------------------------------
   Événements de l'écran
   --------------------------------------------------------------------- */
OK.addEventListener('click', valider);
[N, I, I2].forEach((x) => x.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (x === N) I.focus(); else if (x === I && !I2.hidden && !I2.value) I2.focus(); else valider();
}));
F.addEventListener('click', () => afficher('recover'));
CAT.addEventListener('change', () => {
  const on = !!CAT.value;
  I.hidden = !on; OK.hidden = !on; F.hidden = !on || CAT.value !== 'admin'; E.textContent = '';
  if (on) { P.textContent = CAT.value === 'admin' ? 'Administrateur : entrez votre code PIN.' : 'Utilisateur : entrez votre code PIN.'; I.focus(); }
});
$('ayRC').addEventListener('click', () => { $('ayRights').hidden = true; });
$('ayRights').addEventListener('click', (e) => { if (e.target.id === 'ayRights') $('ayRights').hidden = true; });
// Clavier : Échap ferme « Mes droits »
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('ayRights').hidden) $('ayRights').hidden = true; });
// Boutons sans « onclick » dans le HTML (politique de sécurité du contenu) : data-action
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  if (b.dataset.action === 'verrouiller') verrouiller();
  else if (b.dataset.action === 'droits') montrerDroits();
  else if (b.dataset.action === 'changer-pin') AY.changePin();
});
// Verrouillage automatique
['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => addEventListener(ev, () => { derniereActivite = Date.now(); }, { passive: true, capture: true }));
setInterval(() => { if (CUR && !mode && Date.now() - derniereActivite > DELAI_INACTIVITE) verrouiller(); }, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cacheA = Date.now();
  else if (CUR && cacheA && Date.now() - cacheA > DELAI_ABSENCE) verrouiller();
});

/* ---------------------------------------------------------------------
   Démarrage
   --------------------------------------------------------------------- */
(async function demarrer() {
  try {
    await Coffre.ouvrirBase();
    demanderPersistance(); // protéger la base contre l'effacement automatique
    if (await Coffre.aDesComptes()) { afficher('unlock'); return; }
    ANCIEN = ancienneVersion();
    if (ANCIEN && ANCIEN.comptes.some((c) => c.role === 'admin' && c.h)) { afficher('migration'); return; }
    afficher('first');
  } catch (err) {
    afficher('erreur', "Ayaan ne peut pas démarrer sur ce navigateur : " + err.message + '.');
  }
})();

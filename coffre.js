/* =====================================================================
   Ayaan · coffre.js — le « coffre » chiffré des données (IndexedDB)

   PRINCIPE (OWASP Mobile M9 et M10)
   - Toutes les données de l'application (export Tier.Net, saisies, patients
     saisis à la main, archives, rapports reçus…) sont CHIFFRÉES avant d'être
     écrites dans IndexedDB. Rien n'est écrit en clair sur le téléphone.
   - Une seule « clé maître » (AES-GCM 256 bits, tirée au hasard) chiffre les
     données. Elle n'existe en clair QUE dans la mémoire de la page, après la
     saisie d'un bon code PIN, et disparaît au verrouillage (la page est
     rechargée).
   - Sur le disque, la clé maître est seulement rangée « dans des enveloppes » :
     une enveloppe par utilisateur (fermée avec une clé tirée de son PIN par
     PBKDF2-SHA256, 600 000 itérations) et une enveloppe « code de secours ».
     Un mauvais PIN n'ouvre pas l'enveloppe : c'est ainsi qu'on vérifie le PIN,
     sans jamais stocker le PIN ni son empreinte.

   ORGANISATION DE LA BASE « ayaan » (IndexedDB)
   - comptes : un enregistrement par utilisateur
               { id, nom, role, cree, env: {sel, iter, iv, cle} | null }
               (env = enveloppe contenant la clé maître ; null = PIN à redéfinir)
   - coffre  : les données chiffrées { nom, iv, donnees }
   - meta    : informations techniques non sensibles { nom, valeur }
               (enveloppe du code de secours, compteur d'essais de PIN…)
   ===================================================================== */

import { PBKDF2_ITERATIONS } from './config.js';

const NOM_BASE = 'ayaan';
const VERSION_BASE = 1;

let base = null;          // connexion IndexedDB
let cleMaitre = null;     // CryptoKey AES-GCM : en mémoire seulement
const cache = new Map();  // données déchiffrées, en mémoire seulement
const versions = new Map(); // numéro de la dernière écriture demandée, par donnée
let file = Promise.resolve(); // file d'attente des écritures (dans l'ordre)
let surErreur = () => {};

const enc = new TextEncoder();
const dec = new TextDecoder();
const aleatoire = (n) => crypto.getRandomValues(new Uint8Array(n));

/* ---------------------------------------------------------------------
   1. Ouverture de la base
   --------------------------------------------------------------------- */
export async function ouvrirBase() {
  if (base) return base;
  if (!('indexedDB' in self)) throw new Error("ce navigateur ne permet pas le stockage IndexedDB");
  if (!self.crypto || !crypto.subtle) {
    throw new Error("le chiffrement n'est pas disponible : ouvrez Ayaan par son adresse https://");
  }
  base = await new Promise((ok, ko) => {
    const r = indexedDB.open(NOM_BASE, VERSION_BASE);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('comptes')) db.createObjectStore('comptes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('coffre')) db.createObjectStore('coffre', { keyPath: 'nom' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'nom' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error('base de données bloquée par un autre onglet : fermez-le'));
  });
  // Si une nouvelle version de la base est ouverte ailleurs, on libère celle-ci.
  base.onversionchange = () => { base.close(); location.reload(); };
  return base;
}

/* ---------------------------------------------------------------------
   2. Petits outils IndexedDB (transformés en promesses)
   --------------------------------------------------------------------- */
function attendreRequete(req) {
  return new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });
}
const lireTout = (magasin) => attendreRequete(base.transaction(magasin).objectStore(magasin).getAll());
const lireUn = (magasin, cle) => attendreRequete(base.transaction(magasin).objectStore(magasin).get(cle));

// Plusieurs opérations dans UNE transaction : tout réussit ou rien n'est écrit.
// ops = [{ magasin, put: valeur } | { magasin, del: cle } | { magasin, clear: true }]
function ecrireOps(ops) {
  const magasins = [...new Set(ops.map((o) => o.magasin))];
  return new Promise((ok, ko) => {
    const tx = base.transaction(magasins, 'readwrite');
    for (const o of ops) {
      const st = tx.objectStore(o.magasin);
      if (o.clear) st.clear(); else if ('del' in o) st.delete(o.del); else st.put(o.put);
    }
    tx.oncomplete = () => ok(true);
    tx.onerror = () => ko(tx.error);
    tx.onabort = () => ko(tx.error || new Error('écriture annulée'));
  });
}

/* ---------------------------------------------------------------------
   3. Cryptographie (Web Crypto, intégrée au navigateur, sans bibliothèque)
   --------------------------------------------------------------------- */
// Clé d'enveloppe tirée d'un secret (PIN ou code de secours)
async function deriver(secret, sel, iterations) {
  const brut = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' },
    brut, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}

// Ferme une enveloppe contenant la clé maître avec un secret
async function envelopper(secret) {
  const sel = aleatoire(16), iv = aleatoire(12);
  const kek = await deriver(secret, sel, PBKDF2_ITERATIONS);
  const cle = new Uint8Array(await crypto.subtle.wrapKey('raw', cleMaitre, kek, { name: 'AES-GCM', iv }));
  return { sel, iter: PBKDF2_ITERATIONS, iv, cle };
}

// Ouvre une enveloppe ; échoue (exception) si le secret est faux
async function desenvelopper(secret, env) {
  const kek = await deriver(secret, env.sel, env.iter);
  return crypto.subtle.unwrapKey('raw', env.cle, kek, { name: 'AES-GCM', iv: env.iv },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

// Chiffre une donnée. Le nom de la donnée est lié au chiffrement (« données
// associées ») : on ne peut pas échanger deux enregistrements sans être détecté.
async function chiffrer(nom, valeur, cle = cleMaitre) {
  const iv = aleatoire(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(nom) },
    cle, enc.encode(JSON.stringify(valeur)));
  return { nom, iv, donnees: new Uint8Array(ct) };
}

async function dechiffrer(enr, cle = cleMaitre) {
  const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enr.iv, additionalData: enc.encode(enr.nom) },
    cle, enr.donnees);
  return JSON.parse(dec.decode(clair));
}

// Code de secours lisible : 8 caractères sans lettres ambiguës (ex. K7QM-3XRA)
export function nouveauCodeSecours() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 caractères
  let s = '';
  while (s.length < 8) {
    for (const b of aleatoire(16)) {
      if (b < 248 && s.length < 8) s += A[b % 31]; // 248 = 8 × 31 : pas de biais
    }
  }
  return s.slice(0, 4) + '-' + s.slice(4);
}
export const normaliserCode = (v) => {
  const t = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return t.slice(0, 4) + '-' + t.slice(4, 8);
};

/* ---------------------------------------------------------------------
   4. Comptes et ouverture du coffre
   --------------------------------------------------------------------- */
export const estOuvert = () => !!cleMaitre;
export const comptes = () => lireTout('comptes');
export async function aDesComptes() { return (await comptes()).length > 0; }

// Essaie le PIN sur tous les comptes autorisés (en parallèle). Renvoie le compte ou null.
export async function ouvrirAvecPin(pin, filtre = () => true) {
  const candidats = (await comptes()).filter((c) => c.env && filtre(c));
  const essais = await Promise.allSettled(candidats.map((c) => desenvelopper(pin, c.env)));
  const i = essais.findIndex((e) => e.status === 'fulfilled');
  if (i < 0) return null;
  cleMaitre = essais[i].value;
  return candidats[i];
}

// Vérifie si un PIN ouvre l'enveloppe d'un compte (sans changer l'état du coffre)
export async function pinOuvre(compte, pin) {
  if (!compte.env) return false;
  try { await desenvelopper(pin, compte.env); return true; } catch (e) { return false; }
}

// Premier lancement : crée la clé maître, le premier administrateur et le code de secours.
export async function creerCoffre(compte, pin) {
  cleMaitre = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const code = nouveauCodeSecours();
  const env = await envelopper(pin);
  const secours = await envelopper(code);
  await ecrireOps([
    { magasin: 'comptes', put: { ...compte, env } },
    { magasin: 'meta', put: { nom: 'secours', valeur: secours } },
  ]);
  return code;
}

// Ouvre le coffre avec le code de secours (administrateur qui a oublié son PIN)
export async function ouvrirAvecSecours(code) {
  const m = await lireUn('meta', 'secours');
  if (!m) return false;
  try { cleMaitre = await desenvelopper(normaliserCode(code), m.valeur); return true; } catch (e) { return false; }
}

// Enregistre un compte. Si pin est fourni, une nouvelle enveloppe est fermée avec ce PIN.
export async function enregistrerCompte(compte, pin) {
  if (pin) {
    if (!cleMaitre) throw new Error('coffre fermé');
    compte = { ...compte, env: await envelopper(pin) };
  }
  await ecrireOps([{ magasin: 'comptes', put: compte }]);
  return compte;
}
export const supprimerCompte = (id) => ecrireOps([{ magasin: 'comptes', del: id }]);

/* ---------------------------------------------------------------------
   5. Données : chargement, lecture et écriture
   - lire() est immédiat (données déjà déchiffrées en mémoire) ;
   - ecrire() met à jour la mémoire tout de suite, puis chiffre et enregistre
     en arrière-plan, dans l'ordre. Si on écrit plusieurs fois la même donnée
     rapidement, seule la dernière version est chiffrée et enregistrée.
   --------------------------------------------------------------------- */
export async function charger() {
  if (!cleMaitre) throw new Error('coffre fermé');
  cache.clear();
  for (const enr of await lireTout('coffre')) {
    try { cache.set(enr.nom, await dechiffrer(enr)); }
    catch (e) { surErreur(new Error(`donnée « ${enr.nom} » illisible (abîmée ?)`)); }
  }
}

export const lire = (nom) => (cache.has(nom) ? cache.get(nom) : null);

export function ecrire(nom, valeur) {
  if (!cleMaitre) return false;
  cache.set(nom, valeur);
  const n = (versions.get(nom) || 0) + 1;
  versions.set(nom, n);
  file = file.then(async () => {
    if (versions.get(nom) !== n) return; // une écriture plus récente suit : inutile d'écrire celle-ci
    const enr = await chiffrer(nom, cache.get(nom));
    await ecrireOps([{ magasin: 'coffre', put: enr }]);
  }).catch((e) => surErreur(e));
  return true;
}

export function effacer(nom) {
  cache.delete(nom);
  const n = (versions.get(nom) || 0) + 1;
  versions.set(nom, n);
  file = file.then(() => ecrireOps([{ magasin: 'coffre', del: nom }])).catch((e) => surErreur(e));
}

// Attendre que toutes les écritures soient terminées (avant verrouillage ou mise à jour)
export const attendre = () => file;
export const quandErreur = (fn) => { surErreur = fn; };

// Petites informations non sensibles (compteur d'essais, migration…)
export async function metaLire(nom) { const m = await lireUn('meta', nom); return m ? m.valeur : null; }
export const metaEcrire = (nom, valeur) => ecrireOps([{ magasin: 'meta', put: { nom, valeur } }]);

/* ---------------------------------------------------------------------
   6. Sauvegarde chiffrée (fichier)
   Le fichier contient les données chiffrées + l'enveloppe « code de secours ».
   - Sur le même appareil, il se restaure directement (même clé maître).
   - Sur un autre appareil, il faut le code de secours de l'appareil d'origine.
   --------------------------------------------------------------------- */
const versB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const depuisB64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

export async function fabriquerSauvegarde(objet) {
  if (!cleMaitre) throw new Error('coffre fermé');
  const enr = await chiffrer('sauvegarde', objet);
  const s = (await lireUn('meta', 'secours')).valeur;
  return JSON.stringify({
    type: 'ayaan-sauvegarde-chiffree', format: 1, date: new Date().toISOString().slice(0, 10),
    secours: { sel: versB64(s.sel), iter: s.iter, iv: versB64(s.iv), cle: versB64(s.cle) },
    iv: versB64(enr.iv), donnees: versB64(enr.donnees),
  });
}

// Renvoie l'objet sauvegardé. Lance une erreur { besoinCode: true } si le code de secours est nécessaire.
export async function lireSauvegarde(texte, code) {
  let f;
  try { f = JSON.parse(texte); } catch (e) { throw new Error("ce n'est pas un fichier de sauvegarde Ayaan"); }
  if (!f || f.type !== 'ayaan-sauvegarde-chiffree' || typeof f.iv !== 'string' || typeof f.donnees !== 'string') {
    throw new Error("ce n'est pas une sauvegarde chiffrée Ayaan");
  }
  const enr = { nom: 'sauvegarde', iv: depuisB64(f.iv), donnees: depuisB64(f.donnees) };
  try { return await dechiffrer(enr); } catch (e) { /* autre appareil : il faut le code de secours */ }
  if (!code) { const err = new Error('code de secours nécessaire'); err.besoinCode = true; throw err; }
  const env = { sel: depuisB64(f.secours.sel), iter: +f.secours.iter, iv: depuisB64(f.secours.iv), cle: depuisB64(f.secours.cle) };
  let cle;
  try { cle = await desenvelopper(normaliserCode(code), env); } catch (e) { throw new Error('code de secours incorrect pour cette sauvegarde'); }
  return dechiffrer(enr, cle);
}

/* ---------------------------------------------------------------------
   7. Effacement des données (les comptes et le code de secours sont gardés)
   --------------------------------------------------------------------- */
export async function effacerDonnees(noms) {
  await attendre();
  for (const n of noms) { cache.delete(n); versions.set(n, (versions.get(n) || 0) + 1); }
  await ecrireOps(noms.map((n) => ({ magasin: 'coffre', del: n })));
}

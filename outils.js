/* =====================================================================
   Ayaan · outils.js — petits outils partagés (dates, nombres, formats)
   Aucune donnée ici : uniquement des fonctions.
   ===================================================================== */

export const DAY = 864e5;
export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
export const NEED = {
  dos: 'numero de dossier',
  deb: 'date du debut tarv',
  rdv: 'date prochain rendez-vous dernier tarv',
  cvd: 'date charge virale dernier tarv',
  cvr: 'charge virale dernier tarv',
  sta: 'resultat',
  ess: 'centre de sante',
};
export const LABEL = {
  dos: 'Numéro de dossier',
  deb: 'Date du début TARV',
  rdv: 'Date prochain rendez-vous dernier TARV',
  cvd: 'Date charge virale dernier TARV',
  cvr: 'Charge virale dernier TARV',
  sta: 'Résultat',
  ess: 'Centre de Santé',
};
export const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
export const ymd = (d) => (d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()) : null);
export const iso = (d) =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
export const fr = (d) =>
  d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
export const fromIso = (s) => {
  if (!s) return null;
  const [a, b, c] = s.split('-').map(Number);
  return new Date(a, b - 1, c);
};
export const addM = (d, n) => {
  const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), last));
  return r;
};
export function toDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return ymd(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return ymd(new Date(Math.round((v - 25569) * DAY) + new Date().getTimezoneOffset() * 6e4));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
export function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(
    String(v)
      .replace(/[<>\s]/g, '')
      .replace(',', '.'),
  );
  return isNaN(n) ? null : n;
}

export function parseRes(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = String(v).trim();
  if (!t) return null;
  if (/^(tnd|nd|ind[eé]tect|non d[eé]tect|undetect|ld|<\s*ld)/i.test(t)) return 0;
  if (/^\d{1,3}([.,\s ]\d{3})+(\s*(cp|copies)\b.*)?$/i.test(t))
    return +t.replace(/\s*(cp|copies).*$/i, '').replace(/\D/g, '');
  const m = t.match(/^<\s*([\d\s.,]+)/);
  if (m) {
    const n = parseFloat(m[1].replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? null : n - 0.5;
  }
  return toNum(t);
}
export function fmtRes(v) {
  if (v == null) return '';
  if (v === 0) return 'TND';
  if (v % 1 !== 0) return '< ' + Math.ceil(v);
  return Math.round(v).toLocaleString('fr-FR') + ' cp/ml';
}
export function resCls(v) {
  if (v == null) return null;
  if (v < 50) return { c: 'p-ok', t: 'Supprimée' };
  if (v < 1000) return { c: 'p-warn', t: 'Bas niveau : alerte' };
  return { c: 'p-cra', t: '≥ 1 000 : CRA' };
}
export function today() {
  return ymd(new Date());
}
export function defaultFy(ref) {
  return new Date(ref.getMonth() >= 9 ? ref.getFullYear() : ref.getFullYear() - 1, 9, 1);
}

export function periods(fy) {
  const ps = [];
  for (let i = 0; i < 12; i++) {
    const s = new Date(fy.getFullYear(), fy.getMonth() + i, 1),
      e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    ps.push({
      id: 'm' + i,
      lab: MOIS[s.getMonth()].replace(/^./, (c) => c.toUpperCase()) + ' ' + s.getFullYear(),
      s,
      e,
      type: 'm',
    });
  }
  const fyY = fy.getFullYear() + 1;
  for (let q = 0; q < 4; q++) {
    const s = new Date(fy.getFullYear(), fy.getMonth() + 3 * q, 1),
      e = new Date(s.getFullYear(), s.getMonth() + 3, 0);
    ps.push({
      id: 'q' + q,
      lab: `T${q + 1} FY${String(fyY).slice(2)} (${MOIS[s.getMonth()].slice(0, 4)}. – ${MOIS[e.getMonth()].slice(0, 4)}. ${e.getFullYear()})`,
      s,
      e,
      type: 'q',
    });
  }
  return ps;
}

export const pctCls = (v) => (v == null ? '' : v >= 0.95 ? 'pct-ok' : v >= 0.85 ? 'pct-warn' : 'pct-bad');
export const pctTxt = (v) => (v == null ? '–' : (v * 100).toFixed(1).replace('.', ',') + ' %');
export const pillCls = (s) =>
  s.startsWith('Prélevé') ? 'p-ok' : s === 'En retard' ? 'p-bad' : s === 'À prélever ce mois' ? 'p-warn' : 'p-mut';

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Export Excel : une cellule qui commence par = + - @ serait exécutée comme une formule (injection) ; on la neutralise
export const sur = (v) => {
  v = String(v ?? '');
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
};

/* ---------------------------------------------------------------------
   Contrôle d'une sauvegarde avant restauration (OWASP M4)
   On ne garde que les champs attendus, du bon type et de taille raisonnable.
   Renvoie null si le contenu n'est pas une sauvegarde Ayaan.
   --------------------------------------------------------------------- */
const texte = (v, max) => (v == null ? '' : String(v).slice(0, max));
const nombre = (v) =>
  typeof v === 'number' && isFinite(v) ? v : v == null || v === '' ? null : isFinite(+v) ? +v : null;
const cleSure = (k) =>
  typeof k === 'string' && k.length < 200 && !['__proto__', 'constructor', 'prototype'].includes(k);
export function nettoyerSauvegarde(o) {
  if (!o || typeof o !== 'object' || o.type !== 'cvasf-saisies' || typeof o.saisies !== 'object' || !o.saisies)
    return null;
  const saisies = {},
    manuels = {},
    archives = {};
  for (const [k, s] of Object.entries(o.saisies)) {
    if (!cleSure(k) || !k.includes('|') || !s || typeof s !== 'object') continue;
    const r = {};
    for (const f of ['d', 'rd', 'cra']) if (s[f]) r[f] = /^\d{4}-\d{2}-\d{2}$/.test(s[f]) ? s[f] : '';
    if (s.r != null && s.r !== '') r.r = texte(s.r, 30);
    if (s.c) r.c = texte(s.c, 500);
    if (s.u) r.u = texte(s.u, 40);
    if (s.t) r.t = texte(s.t, 20);
    saisies[k] = r;
  }
  for (const [k, m] of Object.entries(o.manuels && typeof o.manuels === 'object' ? o.manuels : {})) {
    if (!cleSure(k) || !k.includes('|') || !m || typeof m !== 'object') continue;
    manuels[k] = {
      dos: texte(m.dos, 40),
      ess: texte(m.ess, 80),
      deb: texte(m.deb, 10),
      rdv: texte(m.rdv, 10),
      cvd: texte(m.cvd, 10),
      cvr: m.cvr === '' || m.cvr == null ? null : nombre(m.cvr),
      sta: texte(m.sta, 60),
    };
  }
  for (const [k, a] of Object.entries(o.archives && typeof o.archives === 'object' ? o.archives : {})) {
    if (!/^\d{4}-\d{2}$/.test(k) || !a || !Array.isArray(a.sites)) continue;
    archives[k] = {
      gen: texte(a.gen, 30),
      by: a.by && typeof a.by === 'object' ? { nom: texte(a.by.nom, 40), role: texte(a.by.role, 40) } : null,
      sites: a.sites
        .filter((x) => x && typeof x === 'object')
        .map((x) => ({
          ess: texte(x.ess, 80),
          actifs: nombre(x.actifs) || 0,
          att: nombre(x.att) || 0,
          real: nombre(x.real) || 0,
          late: nombre(x.late) || 0,
          pvlsD: nombre(x.pvlsD),
          pvlsN: nombre(x.pvlsN),
          cra: nombre(x.cra),
          craTodo: nombre(x.craTodo),
          tatMed: nombre(x.tatMed),
        })),
    };
  }
  const annees = Array.isArray(o.annees) ? o.annees.filter((y) => Number.isInteger(y) && y > 2000 && y < 2100) : [];
  return { type: 'cvasf-saisies', saisies, manuels, archives, annees };
}

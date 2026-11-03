/* =====================================================================
   Ayaan · calculs.js — les règles de calcul (sans affichage)

   - Patient actif (MER) : date de référence ≤ prochain RDV ARV + 28 jours ;
     décédés, transférés, perdus de vue et pré-TARV exclus.
   - Date probable du prochain prélèvement (nextFrom) :
       pas de CV → début TARV + 6 mois ; CV faite avant 11 mois de TARV →
       début + 12 mois ; CV ≥ 1 000 → CV + 3 mois ; sinon CV + 12 mois.
   - Patient raté : attendu le jour même jusqu'à minuit ; raté la veille,
     il est attendu aujourd'hui, et ainsi de suite ; puis le mois suivant.
   - Année fiscale : du 1er octobre au 30 septembre.
   Toutes ces fonctions sont « pures » : elles ne lisent ni n'écrivent rien.
   ===================================================================== */

import { DAY, norm, fromIso, addM, fr, parseRes } from './outils.js';

export function nextFrom(deb, d, res) {
  if (!d) return addM(deb, 6);
  if (res != null && res >= 1000) return addM(d, 3);
  if (d < addM(deb, 11)) return addM(deb, 12);
  return addM(d, 12);
}
export function calculer(lignes, SAIS, ref, fy, per) {
  // Logique identique pour l'année en cours et les années passées : seuls les événements
  // survenus au plus tard à la date de référence (ref) sont pris en compte.
  const ms = new Date(ref.getFullYear(), ref.getMonth(), 1),
    me = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const PS = per ? per.s.getTime() : ms.getTime(),
    PE = per ? per.e.getTime() : me.getTime();
  const jourRef = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()); // attendu jusqu'à minuit le jour même
  return lignes.map((r) => {
    const deb = fromIso(r.deb),
      rdv = fromIso(r.rdv),
      cvd0 = fromIso(r.cvd),
      key = r.ess + '|' + r.dos,
      s = SAIS[key] || {};
    const sd0 = fromIso(s.d);
    let act;
    const cvdOK = cvd0 && cvd0 <= ref ? cvd0 : null,
      sdOK = sd0 && sd0 <= ref ? sd0 : null; // pas d'événement postérieur à ref
    const st = norm(r.sta);
    if (!deb) act = 'Non : pré-TARV';
    else if (deb > ref) act = 'Non : pas encore sous TARV à cette date';
    else if (st.includes('deced') || st.includes('transf')) act = 'Non : décédé / transféré';
    else if (st.includes('perdu')) act = 'Non : perdu de vue';
    else if (!rdv) act = 'Non : sans date de RDV';
    else act = ref <= new Date(rdv.getTime() + 28 * DAY) ? 'Oui' : 'Non : IIT (> 28 j)';
    const cvT = cvdOK ? cvdOK.getTime() : 0,
      sT = sdOK ? sdOK.getTime() : 0,
      last = Math.max(cvT, sT);
    const lastD = last ? new Date(last) : null;
    const saisieNew = sT > cvT;
    const srRaw = s.r != null && s.r !== '' ? parseRes(s.r) : null;
    const sr = srRaw != null && (sdOK || (!sd0 && cvdOK)) ? srRaw : null; // résultat saisi, seulement s'il porte sur un prélèvement ≤ ref
    const res = sr != null ? sr : saisieNew ? null : cvdOK ? r.cvr : null; // résultat du dernier prélèvement connu à ref
    const resD = lastD,
      rd0 = fromIso(s.rd),
      resRet = rd0 && rd0 <= ref ? rd0 : null,
      resSrc = sr != null ? 'saisi' : res != null ? 'Tier.Net' : '';
    const pend = !!lastD && res == null && saisieNew;
    let prob = null,
      due = null,
      dueOrig = null,
      nextRdv = null,
      eff = null,
      effSrc = '',
      stat,
      ret = null,
      rep = null,
      mrep = 0;
    const fyc = (d) => (d < fy ? fy : d);
    const excl = st.includes('deced') || st.includes('transf') || st.includes('perdu');
    if (deb) {
      dueOrig = nextFrom(deb, lastD, res);
      prob = fyc(dueOrig);
    } // calculés pour tous : servent aux mois passés
    if (act === 'Oui') {
      // échéance d'origine (dueOrig) et projection (prob) déjà calculées ci-dessus                              // sert aux attendus : reportée au 1er mois de l'exercice si plus ancienne
      // date effective remplie automatiquement : dernier prélèvement de l'année fiscale, au plus tard à ref
      if (lastD && lastD >= fy) {
        eff = lastD;
        effSrc = saisieNew ? 'saisie' : 'Tier.Net';
      }
      if (eff) nextRdv = nextFrom(deb, eff, res); // prochain RDV CV calculé automatiquement
      if (lastD && last >= PS && last <= PE) {
        // prélevé pendant la période choisie
        due = saisieNew ? nextFrom(deb, cvdOK, cvdOK ? r.cvr : null) : null; // échéance qui a été honorée (date d'origine, sans la ramener au 1er octobre)
        stat = 'Prélevé le ' + fr(lastD) + (effSrc === 'Tier.Net' ? ' (Tier.Net)' : '');
      } else {
        due = prob;
        if (due < ref) stat = 'En retard';
        else if (due <= me) stat = 'À prélever ce mois';
        else stat = 'À venir';
        if (stat === 'En retard') {
          ret = Math.max(0, Math.round((ref - dueOrig) / DAY)); // jours de retard depuis la date d'origine
          rep = jourRef; // raté la veille : attendu aujourd'hui (jusqu'à minuit), et ainsi de suite chaque jour
          mrep = (ref.getFullYear() - dueOrig.getFullYear()) * 12 + ref.getMonth() - dueOrig.getMonth(); // mois de report depuis le mois d'origine
          nextRdv = rep;
        } else if (stat === 'À prélever ce mois') ret = 0;
      }
    } else stat = 'Non actif';
    const craD0 = fromIso(s.cra),
      craD = craD0 && craD0 <= ref ? craD0 : null,
      hi = act === 'Oui' && res != null && res >= 1000,
      craTodo = hi && (!craD || (resD && craD < resD));
    const same = (a, b) => a && b && a.getTime() === b.getTime();
    const todayF =
      act === 'Oui' &&
      !(lastD && last >= PS && last <= PE) &&
      ((due && same(due, ref)) || (rdv && same(rdv, ref) && (stat === 'En retard' || stat === 'À prélever ce mois')));
    return {
      ...r,
      refD: ref,
      excl,
      key,
      act,
      prob,
      due,
      dueOrig,
      rep,
      mrep,
      nextRdv,
      stat,
      ret,
      last,
      lastD,
      cvd: cvd0,
      deb,
      sd: sd0,
      eff,
      effSrc,
      com: s.c || '',
      res,
      resD,
      resRet,
      resSrc,
      pend,
      craIn: s.cra || '',
      craTodo,
      todayF,
      rdvD: rdv,
      rIn: s.r || '',
      rdIn: s.rd || '',
      by: s.u ? s.u + (s.t ? ' · ' + s.t : '') : '',
    };
  });
}
// actif MER à une date donnée (fin de la période, ou date de référence si elle est antérieure)
export const activeAt = (x, d) =>
  !!(x.deb && x.deb <= d && !x.excl && x.rdvD && d <= new Date(x.rdvD.getTime() + 28 * DAY));
export const pEnd = (p, x) => (p.e < x.refD ? p.e : x.refD);
export const inP = (p, x) =>
  activeAt(x, pEnd(p, x)) &&
  ((x.last >= p.s.getTime() && x.last <= p.e.getTime()) || (x.prob && x.prob <= p.e && x.last < p.s.getTime()));
export const pvlsD = (x, ref) =>
  x.act === 'Oui' && x.res != null && x.resD && x.resD >= addM(ref, -12) && x.resD <= ref;
export function supp(list, ref) {
  const d = list.filter((x) => pvlsD(x, ref));
  return {
    d: d.length,
    n: d.filter((x) => x.res < 1000).length,
    u: d.filter((x) => x.res < 50).length,
    low: d.filter((x) => x.res >= 50 && x.res < 1000).length,
    cra: d.filter((x) => x.res >= 1000).length,
  };
}
export function tat(list, ref) {
  const v = list
    .filter((x) => x.act === 'Oui' && x.resRet && x.resD && x.resRet >= x.resD && x.resRet >= addM(ref, -12))
    .map((x) => Math.round((x.resRet - x.resD) / DAY))
    .sort((a, b) => a - b);
  return { n: v.length, med: v.length ? v[Math.floor((v.length - 1) / 2)] : null };
}
export const doneP = (p, x) => activeAt(x, pEnd(p, x)) && x.last >= p.s.getTime() && x.last <= p.e.getTime();

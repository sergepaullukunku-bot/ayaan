/* =====================================================================
   Ayaan · app.js — écran principal « Ayaan Suivi CV »

   Ce module démarre APRÈS la connexion (await AY.pret) : à ce moment,
   le coffre chiffré est ouvert et les données sont déchiffrées en mémoire.
   Les calculs (patients actifs, dates probables, retards) sont dans
   calculs.js ; les petits outils (dates, formats) dans outils.js ;
   la lecture des fichiers Excel/CSV dans import.js.
   ===================================================================== */

import { AY } from './auth.js';
import { VERSION } from './config.js';
import * as Coffre from './coffre.js';
import { lireFichier } from './import.js';
import { enregistrerFichier, lireTexte, brancherDepot } from './fichiers.js';
import { etatStockage, demanderPersistance } from './stockage.js';
import {
  DAY,
  norm,
  NEED,
  LABEL,
  MOIS,
  ymd,
  iso,
  fr,
  fromIso,
  addM,
  toDate,
  parseRes,
  fmtRes,
  resCls,
  today,
  defaultFy,
  periods,
  pctCls,
  pctTxt,
  pillCls,
  esc,
  sur,
  nettoyerSauvegarde,
} from './outils.js';
import { calculer, activeAt, pEnd, inP, supp, tat, doneP } from './calculs.js';

await AY.pret; // attendre un code PIN valide

const $ = (id) => document.getElementById(id);
// Noms des données dans le coffre chiffré
const K_DATA = 'export',
  K_SAIS = 'saisies',
  K_MAN = 'manuels',
  K_BK = 'derniereSauvegarde',
  K_ARCH = 'archives',
  K_FYL = 'annees';
// Accès aux données : tout passe par le coffre chiffré (IndexedDB)
// Calcul de la liste (voir calculs.js) à partir des lignes de l'export et des saisies
const compute = (ref, fy, per) => calculer(getRows(), SAIS, ref, fy, per);
const store = { get: (k) => Coffre.lire(k), set: (k, v) => Coffre.ecrire(k, v), del: (k) => Coffre.effacer(k) };
const OFFLINE = true; // application installée : rapports et sauvegardes en fichiers
let MAN = store.get(K_MAN) || {};
let DATA = null,
  SAIS = store.get(K_SAIS) || {},
  page = 0,
  statusFilter = 'Tous';
const PAGE = 100;

function sample() {
  // Données d'exemple fictives
  const out = [],
    ess = ['ESS exemple A', 'ESS exemple B'];
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const ref = today();
  for (let i = 0; i < 80; i++) {
    const deb = new Date(ref.getTime() - (60 + rnd() * 2400) * DAY);
    const hasCv = rnd() > 0.15;
    const cvd = hasCv ? new Date(ref.getTime() - (20 + rnd() * 600) * DAY) : null;
    const rdv = new Date(ref.getTime() + (-90 + rnd() * 200) * DAY);
    out.push({
      dos: 'EX' + String(1000 + i),
      ess: ess[i % 2],
      deb: iso(ymd(deb)),
      rdv: iso(ymd(rdv)),
      cvd: hasCv && cvd > deb ? iso(ymd(cvd)) : '',
      cvr: hasCv ? (rnd() > 0.9 ? 4200 : Math.round(rnd() * 60)) : null,
      sta: rnd() > 0.95 ? 'Décédé' : '',
    });
  }
  return { rows: out, file: "Données d'exemple (fictives)", date: iso(today()), example: true };
}

// Import de l'export Tier.Net : la lecture du fichier est faite par import.js (SheetJS ou CSV)
async function parseFile(file) {
  showMsg('info', 'Lecture du fichier…');
  try {
    demanderPersistance();
    const { lignes: aoa, moteur } = await lireFichier(file);
    let h = -1;
    for (let i = 0; i < Math.min(aoa.length, 15); i++) {
      if ((aoa[i] || []).some((c) => norm(c) === NEED.dos)) {
        h = i;
        break;
      }
    }
    if (h < 0) {
      showMsg(
        'bad',
        "Colonne « Numéro de dossier » introuvable. Vérifiez qu'il s'agit bien d'un export Tier.Net (ligne d'en-têtes en haut).",
      );
      return;
    }
    const hdr = aoa[h].map(norm);
    const idx = {},
      miss = [];
    for (const k in NEED) {
      const j = hdr.indexOf(NEED[k]);
      if (j < 0) miss.push(LABEL[k]);
      idx[k] = j;
    }
    if (miss.length) {
      showMsg(
        'bad',
        "Colonne(s) introuvable(s) dans l'export : " +
          miss.join(', ') +
          '. Le nom doit être exactement celui de Tier.Net.',
      );
      return;
    }
    const rows = [];
    for (let i = h + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const dos = r[idx.dos];
      if (dos == null || String(dos).trim() === '') continue;
      rows.push({
        dos: String(dos).trim().slice(0, 40),
        ess: String(r[idx.ess] || '(sans ESS)')
          .trim()
          .slice(0, 80),
        deb: iso(toDate(r[idx.deb])),
        rdv: iso(toDate(r[idx.rdv])),
        cvd: iso(toDate(r[idx.cvd])),
        cvr: parseRes(r[idx.cvr]),
        sta: String(r[idx.sta] || '')
          .trim()
          .slice(0, 60),
      });
    }
    DATA = { rows, file: file.name, date: iso(today()), example: false };
    const ok = store.set(K_DATA, DATA);
    showMsg(
      'info',
      `Export importé : ${rows.length} lignes, ${new Set(rows.map((r) => r.ess)).size} ESS (lecture : ${esc(moteur)}).` +
        (ok
          ? ''
          : " Attention : cet appareil n'a pas pu garder l'export en mémoire, il faudra le réimporter à la prochaine ouverture."),
    );
    fillEss();
    page = 0;
    snapshot();
    render();
  } catch (err) {
    showMsg('bad', 'Lecture du fichier impossible : ' + esc(err.message));
  }
}
function showMsg(kind, t) {
  $('msg').innerHTML = t ? `<div class="alert ${kind}">${t}</div>` : '';
}

function baseRows() {
  return DATA && !(DATA.example && Object.keys(MAN).length) ? DATA.rows : [];
}
function getRows() {
  const base = baseRows();
  const map = new Map();
  base.forEach((r) => map.set(r.ess + '|' + r.dos, { ...r, src: DATA.example ? 'Exemple' : 'Export' }));
  for (const k in MAN) {
    const m = MAN[k];
    const b = map.get(k);
    if (b) {
      const o = { ...b, src: 'Export corrigé' };
      ['deb', 'rdv', 'cvd'].forEach((f) => {
        if (m[f]) o[f] = m[f];
      });
      o.sta = m.sta || '';
      if (m.cvr != null && m.cvr !== '') o.cvr = m.cvr;
      map.set(k, o);
    } else
      map.set(k, {
        dos: m.dos,
        ess: m.ess,
        deb: m.deb || '',
        rdv: m.rdv || '',
        cvd: m.cvd || '',
        cvr: m.cvr === '' ? null : m.cvr,
        sta: m.sta || '',
        src: 'Saisie manuelle',
      });
  }
  return [...map.values()];
}
function fillEss() {
  const sel = $('selEss'),
    cur = sel.value;
  const list = [...new Set(getRows().map((r) => r.ess))].sort();
  $('essList').innerHTML = list.map((e) => `<option value="${esc(e)}">`).join('');
  sel.innerHTML =
    `<option value="">Toutes les ESS (${list.length})</option>` +
    list.map((e) => `<option>${esc(e)}</option>`).join('');
  if (list.includes(cur)) sel.value = cur;
}
function fillPer(fy, ref) {
  const sel = $('selPer'),
    cur = sel.value;
  const ps = periods(fy);
  sel.innerHTML = ps.map((p) => `<option value="${p.id}">${p.lab}</option>`).join('');
  const m = ps.find((p) => p.type === 'm' && ref >= p.s && ref <= p.e);
  sel.value = ps.some((p) => p.id === cur) ? cur : m ? m.id : 'm0';
  return ps;
}
let LAST = [];
const EDITED = new Set();
function render() {
  if (!DATA) return;
  const ref = fromIso($('dRef').value) || today();
  const fy = fromIso($('dFy').value) || defaultFy(ref);
  const ps = fillPer(fy, ref);
  const per = ps.find((p) => p.id === $('selPer').value);
  const all = compute(ref, fy, per);
  const essSel = $('selEss').value;
  const rows = essSel ? all.filter((x) => x.ess === essSel) : all;
  renderMan();
  fillFy();
  renderArch();
  {
    const yy = defaultFy(ref).getFullYear(),
      now = defaultFy(today()).getFullYear();
    $('fyBanner').innerHTML =
      yy < now
        ? `<div class="alert info"><b>Année fiscale passée (FY${String(yy + 1).slice(2)})</b> : les listes et tableaux ci-dessous sont recalculés à partir de l'export Tier.Net actuel (approximation : seule la dernière CV de chaque patient est connue). Les chiffres enregistrés à l'époque sont dans « Archives mensuelles ».</div>`
        : '';
  }
  if (DATA.example && !Object.keys(MAN).length)
    showMsg(
      'info',
      '<span class="ex">Exemple</span> Ces patients sont fictifs. Cliquez sur « Importer l\'export Tier.Net » pour charger vos données.',
    );
  const act = rows.filter((x) => x.act === 'Oui');
  const actP = rows.filter((x) => activeAt(x, pEnd(per, x)));
  const dAct = pEnd(per, { refD: ref });
  const c = (s) => rows.filter((x) => x.stat === s).length;
  const nLate = c('En retard');
  $('track').innerHTML = nLate
    ? `<div class="alert bad row" style="justify-content:space-between"><span>${nLate.toLocaleString('fr-FR')} patient(s) en retard de prélèvement CV${essSel ? ' à ' + esc(essSel) : ''} : à mettre en tracking actif (appel, VAD par PE ou RECO).</span><button class="btn" id="btnTrack" type="button">Voir la liste de tracking</button></div>`
    : '';
  if (nLate)
    $('btnTrack').onclick = () => {
      statusFilter = 'En retard';
      EDITED.clear();
      page = 0;
      render();
      $('listTitle').scrollIntoView({ behavior: 'smooth' });
    };
  $('tiles').innerHTML = [
    ['v', actP.length, 'Patients actifs (MER) au ' + fr(dAct) + (dAct < ref ? ' (estimation)' : '')],
    ['j', c('À prélever ce mois'), 'À prélever ce mois'],
    ['r', nLate, 'En retard : tracking actif'],
    ['o', rows.filter((x) => x.stat.startsWith('Prélevé')).length, 'Prélevés dans la période (Tier.Net ou saisis)'],
  ]
    .map((t) => `<div class="tile ${t[0]}"><b>${t[1].toLocaleString('fr-FR')}</b><span>${t[2]}</span></div>`)
    .join('');
  const SP = supp(rows, ref),
    spv = SP.d ? SP.n / SP.d : null;
  $('tiles').innerHTML +=
    `<div class="tile"><b class="${pctCls(spv)}">${pctTxt(spv)}</b><span>Suppression virale (&lt; 1 000) : ${SP.n} / ${SP.d} CV des 12 derniers mois · &lt; 50 : ${SP.u}</span></div><div class="tile r"><b>${SP.cra}</b><span>CV ≥ 1 000 : CRA à faire · bas niveau 50–999 : ${SP.low}</span></div>`;
  const TT = tat(rows, ref);
  $('tiles').innerHTML +=
    `<div class="tile ${TT.med != null && TT.med > 30 ? 'r' : 'v'}"><b>${TT.med == null ? '–' : TT.med + ' j'}</b><span>Délai médian de retour des résultats (${TT.n} résultat(s) avec date de retour, 12 derniers mois)</span></div>`;
  const nS = Object.keys(SAIS).length,
    lb = fromIso(store.get(K_BK));
  if (nS && (!lb || (today() - lb) / DAY > (STOCKAGE_OK ? 14 : 7)) && !$('msg').innerHTML)
    showMsg(
      'info',
      `${nS} saisie(s) sur cet appareil ${lb ? 'et dernière sauvegarde le ' + fr(lb) : 'sans aucune sauvegarde'} : pensez à « Enregistrer la sauvegarde » (section Règles et sauvegarde).`,
    );
  const att = rows.filter((x) => inP(per, x)),
    dn = att.filter((x) => doneP(per, x)),
    pv = att.length ? dn.length / att.length : null;
  $('period').innerHTML =
    `<h2>${esc(per.lab)}${essSel ? ' · ' + esc(essSel) : ''}</h2><div><span class="n">${att.length}</span><span class="l">attendus</span></div><div><span class="n">${dn.length}</span><span class="l">réalisés</span></div><div><span class="n">${pctTxt(pv)}</span><span class="l">de réalisation</span></div><div><span class="n">${att.length - dn.length}</span><span class="l">non réalisés</span></div>`;
  // chips
  const opts = [
    "Aujourd'hui",
    'CRA à commencer',
    'Attendus de la période',
    'À prélever ce mois',
    'En retard',
    'Prélevé',
    'À venir',
    'CV ≥ 1 000 (CRA)',
    'Résultat en attente',
    'Tous',
    'Non actifs',
  ];
  $('chips').innerHTML = opts
    .map((o) => `<button class="chip" aria-pressed="${o === statusFilter}" data-f="${o}">${o}</button>`)
    .join('');
  const q = norm($('q').value);
  let L = rows.filter((x) => {
    if (q && !norm(x.dos).includes(q)) return false;
    if (EDITED.has(x.key)) return true;
    switch (statusFilter) {
      case "Aujourd'hui":
        return x.todayF;
      case 'CRA à commencer':
        return x.craTodo;
      case 'Attendus de la période':
        return inP(per, x);
      case 'À prélever ce mois':
        return x.stat === 'À prélever ce mois';
      case 'En retard':
        return x.stat === 'En retard';
      case 'Prélevé':
        return x.stat.startsWith('Prélevé');
      case 'À venir':
        return x.stat === 'À venir';
      case 'Non actifs':
        return x.act !== 'Oui';
      case 'CV ≥ 1 000 (CRA)':
        return x.act === 'Oui' && x.res != null && x.res >= 1000;
      case 'Résultat en attente':
        return x.act === 'Oui' && x.pend;
      default:
        return x.act === 'Oui';
    }
  });
  L.sort(
    (a, b) =>
      EDITED.has(b.key) - EDITED.has(a.key) ||
      (statusFilter === 'En retard'
        ? (b.ret || 0) - (a.ret || 0)
        : (a.due || a.prob || 0) - (b.due || b.prob || 0) || a.dos.localeCompare(b.dos)),
  );
  LAST = L;
  const pages = Math.max(1, Math.ceil(L.length / PAGE));
  if (page >= pages) page = pages - 1;
  $('listTitle').textContent = `Patients · ${statusFilter} (${L.length.toLocaleString('fr-FR')})`;
  $('tb').innerHTML =
    L.slice(page * PAGE, page * PAGE + PAGE)
      .map(
        (x) => `<tr${x.stat === 'En retard' ? ' class="late"' : ''}>
    <td><b>${esc(x.dos)}</b>${x.src === 'Saisie manuelle' || x.src === 'Export corrigé' ? ' <span class="pill p-mut">' + (x.src === 'Saisie manuelle' ? 'manuel' : 'corrigé') + '</span>' : ''}</td>
    <td>${esc(x.ess)}</td><td class="num">${fr(x.deb)}</td><td class="num">${fr(x.cvd)}${x.cvr != null && x.cvd ? '<br><span class="muted">' + x.cvr + ' cp/ml</span>' : ''}</td>
    <td class="num">${x.act === 'Oui' ? (x.stat === 'En retard' ? fr(x.dueOrig) + '<br><span class="muted">date d\'origine</span>' : x.due ? fr(x.due) + (x.stat.startsWith('Prélevé') && x.lastD && x.due < new Date(x.lastD.getFullYear(), x.lastD.getMonth(), 1) ? '<br><span class="muted">date d\'origine · rattrapé</span>' : '') : '<span class="muted">—</span>') : '<span class="muted">' + esc(x.act) + '</span>'}</td>
    <td><span class="pill ${pillCls(x.stat)}">${esc(x.stat)}</span>${x.stat === 'En retard' ? '<br><span class="track">Tracking actif</span>' : ''}${x.todayF ? '<br><span class="pill p-warn">Aujourd\'hui</span>' : ''}</td>
    <td>${x.act === 'Oui' ? `<input type="date" id="d_${esc(x.key)}" data-k="${esc(x.key)}" data-t="d" value="${x.eff ? iso(x.eff) : ''}" max="${iso(today())}" ${x.effSrc === 'Tier.Net' ? 'title="Date reprise de Tier.Net" style="border-color:var(--ok)"' : ''} aria-label="Date effective ${esc(x.dos)}">${x.effSrc === 'Tier.Net' ? '<br><span class="muted">auto · Tier.Net</span>' : ''}` : ''}</td>
    <td>${
      x.act === 'Oui'
        ? (() => {
            const rc = resCls(x.res);
            return `<div class="res"><input type="text" data-k="${esc(x.key)}" data-t="r" value="${esc(x.rIn)}" placeholder="${x.resSrc === 'Tier.Net' ? esc(fmtRes(x.res)) : 'ex. 40, TND'}" aria-label="Résultat CV ${esc(x.dos)}">${rc ? `<span class="pill ${rc.c}">${x.res >= 1000 ? '' : fmtRes(x.res) + ' · '}${rc.t}</span>` : ''}${x.resSrc === 'Tier.Net' ? '<span class="muted">auto · Tier.Net</span>' : ''}${x.pend ? `<span class="muted">en attente${x.lastD ? ' depuis ' + Math.round((today() - x.lastD) / DAY) + ' j' : ''}</span>` : ''}${x.res != null && x.res >= 1000 ? `<label class="muted" style="display:grid;gap:2px;margin-top:4px">Début du CRA<input type="date" data-k="${esc(x.key)}" data-t="cra" value="${esc(x.craIn)}" max="${iso(today())}" aria-label="Date de début du CRA ${esc(x.dos)}"></label>${x.craTodo ? '<span class="pill p-cra">CRA à commencer</span>' : '<span class="pill p-ok">CRA commencé</span>'}` : ''}</div>`;
          })()
        : ''
    }</td>
    <td>${x.act === 'Oui' ? `<input type="date" data-k="${esc(x.key)}" data-t="rd" value="${esc(x.rdIn)}" max="${iso(today())}" aria-label="Date retour du résultat ${esc(x.dos)}">` : ''}</td>
    <td class="num">${x.rep ? '<b style="color:var(--bad)">' + fr(x.rep) + '</b><br><span class="muted">raté la veille : attendu aujourd\'hui' + (x.mrep ? ' · reporté ' + x.mrep + ' mois' : '') + '</span>' : x.nextRdv ? '<b>' + fr(x.nextRdv) + '</b><br><span class="muted">à communiquer</span>' : ''}</td>
    <td>${x.act === 'Oui' ? `<input type="text" id="c_${esc(x.key)}" data-k="${esc(x.key)}" data-t="c" value="${esc(x.com)}" aria-label="Commentaire ${esc(x.dos)}">${x.by ? '<br><span class="muted">saisi par ' + esc(x.by) + '</span>' : ''}` : ''}</td>
    <td class="num">${x.ret ?? ''}</td></tr>`,
      )
      .join('') || `<tr><td colspan="12" class="muted">Aucun patient pour ce filtre.</td></tr>`;
  {
    const H = [...document.querySelectorAll('table.cards thead th')].map((t) => t.textContent);
    document.querySelectorAll('#tb tr').forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        if (!td.hasAttribute('colspan')) td.dataset.l = H[i] || '';
      }),
    );
  }
  if (!AY.can('saisir')) document.querySelectorAll('#tb input').forEach((x) => (x.disabled = true));
  $('pinfo').textContent = `Page ${page + 1} / ${pages}`;
  $('prev').disabled = page === 0;
  $('next').disabled = page >= pages - 1;
  const trs = (list, body) => {
    $(body).innerHTML = list
      .map((p) => {
        const a = rows.filter((x) => inP(p, x)),
          d = a.filter((x) => doneP(p, x)),
          v = a.length ? d.length / a.length : null;
        return `<tr><td>${esc(p.lab)}</td><td class="num">${a.length}</td><td class="num">${d.length}</td><td class="num ${pctCls(v)}">${pctTxt(v)}</td></tr>`;
      })
      .join('');
  };
  trs(
    ps.filter((p) => p.type === 'm'),
    'tbM',
  );
  trs(
    ps.filter((p) => p.type === 'q'),
    'tbQ',
  );
  renderEvo(rows, ps, per, ref);
  const essL = [...new Set(all.map((x) => x.ess))].sort();
  $('tbE').innerHTML = essL
    .map((e) => {
      const r = all.filter((x) => x.ess === e),
        a = r.filter((x) => inP(per, x)),
        d = a.filter((x) => doneP(per, x)),
        v = a.length ? d.length / a.length : null;
      return `<tr><td>${esc(e)}</td><td class="num">${r.filter((x) => activeAt(x, pEnd(per, x))).length}</td><td class="num">${a.length}</td><td class="num">${d.length}</td><td class="num ${pctCls(v)}">${pctTxt(v)}</td></tr>`;
    })
    .join('');
}

// events
$('btnImport').onclick = () => AY.can('importer') && $('file').click();
$('file').onchange = (e) => {
  if (e.target.files[0]) parseFile(e.target.files[0]);
  e.target.value = ''; // permet de choisir à nouveau le même fichier
};
// Ordinateur : glisser-déposer l'export Tier.Net n'importe où sur la page
brancherDepot(
  document.body,
  (l) => parseFile(l[0]),
  () => AY.can('importer'),
);
['selEss', 'selPer', 'dRef', 'dFy'].forEach((id) =>
  $(id).addEventListener('change', () => {
    EDITED.clear();
    page = 0;
    render();
  }),
);
$('q').addEventListener('input', () => {
  page = 0;
  render();
});
$('chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  statusFilter = b.dataset.f;
  EDITED.clear();
  page = 0;
  render();
});
$('prev').onclick = () => {
  page--;
  render();
};
$('next').onclick = () => {
  page++;
  render();
};
$('tb').addEventListener('change', (e) => {
  const t = e.target;
  if (!t.dataset.k) return;
  if (!AY.can('saisir')) {
    showMsg('bad', 'Votre rôle ne permet pas de saisir.');
    render();
    return;
  }
  const k = t.dataset.k;
  const s = SAIS[k] || {};
  const row0 = LAST.find((x) => x.key === k);
  if (t.dataset.t === 'd') {
    if (t.value && fromIso(t.value) > today()) {
      t.value = s.d || '';
      showMsg('bad', 'La date effective ne peut pas être dans le futur.');
      return;
    }
    if (t.value && row0 && row0.deb && fromIso(t.value) < row0.deb) {
      t.value = s.d || '';
      showMsg('bad', 'La date effective est antérieure au début du TARV : vérifiez.');
      return;
    }
    if (t.value && row0 && row0.cvd && fromIso(t.value) <= row0.cvd) {
      t.value = s.d || '';
      showMsg(
        'bad',
        "Cette date n'est pas postérieure à la dernière CV déjà connue dans Tier.Net (" +
          fr(row0.cvd) +
          ') : elle ne serait pas prise en compte.',
      );
      return;
    }
    s.d = t.value || undefined;
  } else if (t.dataset.t === 'r') {
    const v = t.value.trim();
    const row = LAST.find((x) => x.key === k);
    if (v && row && !row.lastD && !s.d) {
      t.value = '';
      showMsg('bad', "Saisissez d'abord la date effective du prélèvement, puis le résultat.");
      return;
    }
    if (v && parseRes(v) == null) {
      t.value = s.r || '';
      showMsg('bad', 'Résultat non reconnu : saisissez un nombre (ex. 40 ou 1500), TND ou < 50.');
      return;
    }
    s.r = v || undefined;
    if (v) {
      const pv = parseRes(v),
        rc = resCls(pv);
      const dos = k.split('|').slice(1).join('|');
      showMsg(
        pv >= 1000 ? 'bad' : 'info',
        `Résultat ${esc(fmtRes(pv))} enregistré pour ${esc(dos)} : ${rc.t}.` +
          (pv >= 1000 ? ' Faire le CRA et prévoir une CV de contrôle dans 3 mois.' : ''),
      );
    }
  } else if (t.dataset.t === 'rd') {
    if (t.value && fromIso(t.value) > today()) {
      t.value = s.rd || '';
      showMsg('bad', 'La date de retour ne peut pas être dans le futur.');
      return;
    }
    if (t.value && row0 && row0.lastD && fromIso(t.value) < row0.lastD) {
      t.value = s.rd || '';
      showMsg(
        'bad',
        'La date de retour du résultat est antérieure à la date du prélèvement (' + fr(row0.lastD) + ') : vérifiez.',
      );
      return;
    }
    s.rd = t.value || undefined;
  } else if (t.dataset.t === 'cra') {
    if (t.value && fromIso(t.value) > today()) {
      t.value = s.cra || '';
      showMsg('bad', 'La date de début du CRA ne peut pas être dans le futur.');
      return;
    }
    if (t.value && row0 && row0.resD && fromIso(t.value) < row0.resD) {
      t.value = s.cra || '';
      showMsg(
        'bad',
        'La date de début du CRA est antérieure au prélèvement de ce résultat (' + fr(row0.resD) + ') : vérifiez.',
      );
      return;
    }
    s.cra = t.value || undefined;
    if (t.value)
      showMsg(
        'info',
        'Début du CRA enregistré le ' +
          fr(fromIso(t.value)) +
          '. Prévoir 3 séances, puis une CV de contrôle 3 mois après le résultat.',
      );
  } else s.c = t.value || undefined;
  if (!s.d && !s.c && !s.r && !s.rd && !s.cra) delete SAIS[k];
  else {
    const u = AY.user();
    s.u = u ? u.nom : '';
    s.t = ((d) => iso(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'))(
      new Date(),
    );
    SAIS[k] = s;
  }
  EDITED.add(k);
  if (t.dataset.t === 'd' && t.value) {
    const dos = k.split('|').slice(1).join('|');
    showMsg(
      'info',
      `Prélèvement du ${fr(fromIso(t.value))} enregistré pour ${esc(dos)}. Prochain RDV CV calculé : voir la colonne « Prochain RDV CV ».`,
    );
  }
  if (!store.set(K_SAIS, SAIS))
    showMsg('bad', "Cet appareil n'a pas pu enregistrer la saisie. Copiez la sauvegarde pour ne pas la perdre.");
  const fk = t.dataset.k,
    ft = t.dataset.t;
  render();
  const el = document.querySelector(`#tb [data-k="${CSS.escape(fk)}"][data-t="${ft}"]`);
  if (el) {
    const ins = [...document.querySelectorAll('#tb input')];
    const i = ins.indexOf(el);
    (KEYNAV && ins[i + 1] ? ins[i + 1] : el).focus({ preventScroll: true });
  }
  KEYNAV = false;
});
let KEYNAV = false;
$('tb').addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey && e.target.matches('input')) KEYNAV = true;
});
$('btnCopy').onclick = async () => {
  const lines = [
    [
      'N° dossier',
      'ESS',
      'Début ARV',
      'Dernier prélèvement CV',
      'Date probable de prélèvement',
      'Statut',
      'Date effective',
      'Résultat CV',
      'Interprétation',
      'Date retour du résultat',
      'Prochain RDV CV',
      'Commentaire',
      'Retard (j)',
      'Prochain RDV ARV',
      'Début CRA',
      'Saisi par',
    ].join('\t'),
  ].concat(
    LAST.map((x) =>
      [
        x.dos,
        x.ess,
        fr(x.deb),
        fr(x.cvd),
        fr(x.due),
        x.stat,
        fr(x.eff),
        fmtRes(x.res),
        (resCls(x.res) || { t: '' }).t,
        fr(x.resRet),
        fr(x.nextRdv) + (x.rep ? ' (reporté' + (x.mrep ? ', ' + x.mrep + ' mois' : '') + ')' : ''),
        x.com,
        x.ret ?? '',
        x.rdv ? fr(fromIso(x.rdv)) : '',
        x.craIn ? fr(fromIso(x.craIn)) : '',
        x.by,
      ]
        .map(sur)
        .join('\t'),
    ),
  );
  const txt = lines.join('\n');
  try {
    await navigator.clipboard.writeText(txt);
    showMsg('info', `${LAST.length} lignes copiées. Collez-les dans Excel (Ctrl + V).`);
  } catch (e) {
    $('bk').value = txt;
    $('bk').select();
    showMsg(
      'info',
      'Copie automatique refusée : la liste est dans la zone de texte « Sauvegarder ou restaurer », sélectionnée. Faites Ctrl + C.',
    );
  }
};
window.ayaanPinMsg = (t) => showMsg('info', t);
const markBk = () => store.set(K_BK, iso(today()));
// ----- Sauvegarde chiffrée (voir coffre.js) : fichier ou texte, illisibles sans Ayaan
const contenuSauvegarde = () => ({
  type: 'cvasf-saisies',
  date: iso(today()),
  saisies: SAIS,
  manuels: MAN,
  archives: ARCH,
  annees: FYL,
});
$('btnBkDl').onclick = async () => {
  if (!AY.can('sauvegarde')) return;
  const txt = await Coffre.fabriquerSauvegarde(contenuSauvegarde());
  markBk();
  const mode = await dl(`Ayaan Suivi CV - sauvegarde chiffree - ${iso(today())}.json`, txt, 'application/json');
  $('bkmsg').textContent =
    mode === 'annule'
      ? 'Enregistrement annulé.'
      : `Sauvegarde chiffrée enregistrée (${Object.keys(SAIS).length} saisies) ${lieu(mode)}.`;
};
$('btnBack').onclick = async () => {
  if (!AY.can('sauvegarde')) return;
  const txt = await Coffre.fabriquerSauvegarde(contenuSauvegarde());
  markBk();
  $('bk').value = txt;
  try {
    await navigator.clipboard.writeText(txt);
    $('bkmsg').textContent =
      `Sauvegarde chiffrée copiée (${Object.keys(SAIS).length} saisies). Collez-la dans un fichier texte ou un courriel.`;
  } catch (e) {
    $('bk').select();
    $('bkmsg').textContent = 'Le texte est sélectionné : faites Ctrl + C.';
  }
};
async function restaurer(texte) {
  if (!AY.can('restaurer')) return;
  let o;
  try {
    const brut = JSON.parse(texte);
    o = brut && brut.type === 'cvasf-saisies' ? brut : await Coffre.lireSauvegarde(texte, $('bkCode').value); // 'cvasf-saisies' : ancienne sauvegarde v14, non chiffrée
  } catch (e) {
    if (e.besoinCode) {
      $('bk').value = texte;
      $('bkCodeLab').hidden = false;
      $('bkCode').focus();
      $('bkmsg').textContent =
        "Cette sauvegarde vient d'un autre appareil : entrez le code de secours de l'administrateur de cet appareil, puis cliquez « Restaurer depuis le texte collé ».";
      return;
    }
    $('bkmsg').textContent =
      'Restauration impossible : ' + (e instanceof SyntaxError ? 'texte non reconnu' : e.message) + '.';
    return;
  }
  o = nettoyerSauvegarde(o);
  if (!o) {
    $('bkmsg').textContent = "Sauvegarde non reconnue ou abîmée : rien n'a été restauré.";
    return;
  }
  SAIS = Object.assign({}, SAIS, o.saisies);
  store.set(K_SAIS, SAIS);
  if (Object.keys(o.manuels).length) {
    MAN = Object.assign({}, MAN, o.manuels);
    store.set(K_MAN, MAN);
    fillEss();
  }
  if (o.annees.length) {
    fyInit();
    FYL = [...new Set(FYL.concat(o.annees))];
    store.set(K_FYL, FYL);
  }
  for (const m in o.archives) {
    if (!ARCH[m] || (ARCH[m].gen || '') < (o.archives[m].gen || '')) ARCH[m] = o.archives[m];
  }
  store.set(K_ARCH, ARCH);
  $('bkCode').value = '';
  $('bkCodeLab').hidden = true;
  $('bkmsg').textContent = `${Object.keys(o.saisies).length} saisies restaurées.`;
  render();
}
$('btnRest').onclick = () => restaurer($('bk').value);
let armed = false;
$('btnClear').onclick = () => {
  if (!AY.can('effacer')) return;
  if (!armed) {
    armed = true;
    $('btnClear').textContent = 'Confirmer : tout effacer';
    $('bkmsg').textContent = "Cliquez encore pour effacer l'export et les dates saisies de cet appareil.";
    return;
  }
  store.del(K_DATA);
  store.del(K_SAIS);
  store.del(K_MAN);
  SAIS = {};
  MAN = {};
  DATA = sample();
  armed = false;
  $('btnClear').textContent = 'Effacer les données de cet appareil';
  $('bkmsg').textContent = 'Données effacées.';
  fillEss();
  render();
};

// Enregistrer un fichier (voir fichiers.js) : téléchargement, ou feuille de partage sur iPhone/iPad
async function dl(name, text, type) {
  return enregistrerFichier(name, text, type);
}
const lieu = (mode) =>
  mode === 'partage' ? "à l'endroit choisi" : mode === 'annule' ? '' : 'dans le dossier Téléchargements';
if (OFFLINE) {
  $('btnDl').hidden = false;
  $('offTag').textContent =
    ` Version ${VERSION} hors ligne : fonctionne sans Internet. Données chiffrées sur cet appareil.`;
}
$('btnDl').onclick = async () => {
  const rows = [
    [
      'N° dossier',
      'ESS',
      'Début ARV',
      'Dernier prélèvement CV',
      'Date probable de prélèvement',
      'Statut',
      'Date effective',
      'Résultat CV',
      'Interprétation',
      'Date retour du résultat',
      'Prochain RDV CV',
      'Commentaire',
      'Retard (j)',
      'Prochain RDV ARV',
      'Début CRA',
      'Saisi par',
    ],
  ].concat(
    LAST.map((x) => [
      x.dos,
      x.ess,
      fr(x.deb),
      fr(x.cvd),
      fr(x.due),
      x.stat,
      fr(x.eff),
      fmtRes(x.res),
      (resCls(x.res) || { t: '' }).t,
      fr(x.resRet),
      fr(x.nextRdv) + (x.rep ? ' (reporté' + (x.mrep ? ', ' + x.mrep + ' mois' : '') + ')' : ''),
      x.com,
      x.ret ?? '',
      x.rdv ? fr(fromIso(x.rdv)) : '',
      x.craIn ? fr(fromIso(x.craIn)) : '',
      x.by,
    ]),
  );
  const csv =
    '\uFEFF' +
    rows
      .map((r) =>
        r
          .map((v) => {
            v = sur(v);
            return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
          })
          .join(';'),
      )
      .join('\r\n');
  const ess = $('selEss').value || 'toutes ESS';
  const mode = await dl(`Ayaan Suivi CV - ${ess} - ${iso(today())}.csv`, csv, 'text/csv;charset=utf-8');
  if (mode !== 'annule')
    showMsg('info', `${LAST.length} lignes enregistrées ${lieu(mode)} (fichier CSV, s'ouvre dans Excel).`);
};
$('btnBkUp').onclick = () => $('bkFile').click();
$('bkFile').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 50 * 1048576) {
    $('bkmsg').textContent = 'Fichier trop volumineux.';
    return;
  }
  restaurer(await lireTexte(f));
};
function renderMan() {
  const keys = Object.keys(MAN).sort();
  $('manSum').textContent = `Patients saisis à la main (${keys.length})`;
  const inBase = new Set(baseRows().map((r) => r.ess + '|' + r.dos));
  $('tbMan').innerHTML =
    keys
      .map((k) => {
        const m = MAN[k];
        return `<tr><td>${esc(m.ess)}</td><td><b>${esc(m.dos)}</b></td><td>${fr(fromIso(m.deb))}</td><td>${fr(fromIso(m.rdv))}</td><td>${fr(fromIso(m.cvd))}</td><td class="num">${m.cvr === '' || m.cvr == null ? '' : fmtRes(m.cvr)}</td><td>${esc(m.sta || 'En suivi')}</td><td>${inBase.has(k) ? "corrige l'export" : 'manuel'}</td><td class="row" style="flex-wrap:nowrap"><button class="btn ghost" type="button" data-ed="${esc(k)}">Modifier</button><button class="btn ghost" type="button" data-del="${esc(k)}">Supprimer</button></td></tr>`;
      })
      .join('') || '<tr><td colspan="9" class="muted">Aucun patient saisi à la main.</td></tr>';
}
function manMsg(t) {
  $('m_msg').textContent = t;
}
$('manForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!AY.can('manuel')) return;
  const ess = $('m_ess').value.trim(),
    dos = $('m_dos').value.trim(),
    deb = $('m_deb').value;
  if (!ess || !dos || !deb) {
    manMsg("Renseignez l'ESS, le N° dossier et la date de début TARV.");
    return;
  }
  const t = today();
  for (const id of ['m_deb', 'm_cvd']) {
    if ($(id).value && fromIso($(id).value) > t) {
      manMsg('Une date de début TARV ou de CV ne peut pas être dans le futur.');
      return;
    }
  }
  if ($('m_cvd').value && $('m_cvd').value < deb) {
    manMsg('La date de la dernière CV est antérieure au début TARV : vérifiez.');
    return;
  }
  const cvr = $('m_cvr').value.trim();
  const n = cvr === '' ? '' : parseRes(cvr);
  if (cvr !== '' && n == null) {
    manMsg('Résultat de CV non reconnu : saisissez un nombre (ex. 40 ou 1500), TND ou < 50.');
    return;
  }
  const k = ess + '|' + dos;
  MAN[k] = { ess, dos, deb, rdv: $('m_rdv').value || '', cvd: $('m_cvd').value || '', cvr: n, sta: $('m_sta').value };
  if (!store.set(K_MAN, MAN)) manMsg("Cet appareil n'a pas pu enregistrer : faites une sauvegarde.");
  else manMsg(`Patient ${dos} (${ess}) enregistré.`);
  $('manForm').reset();
  fillEss();
  page = 0;
  render();
});
$('m_reset').onclick = () => {
  $('manForm').reset();
  manMsg('');
};
let delArm = null;
$('tbMan').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ed) {
    const m = MAN[b.dataset.ed];
    $('m_ess').value = m.ess;
    $('m_dos').value = m.dos;
    $('m_deb').value = m.deb || '';
    $('m_rdv').value = m.rdv || '';
    $('m_cvd').value = m.cvd || '';
    $('m_cvr').value = m.cvr ?? '';
    $('m_sta').value = m.sta || '';
    manMsg('Modifiez puis cliquez sur « Enregistrer le patient ».');
    $('m_dos').focus();
    return;
  }
  if (b.dataset.del) {
    if (delArm !== b.dataset.del) {
      delArm = b.dataset.del;
      b.textContent = 'Confirmer';
      return;
    }
    delete MAN[b.dataset.del];
    delArm = null;
    store.set(K_MAN, MAN);
    manMsg('Patient supprimé de la saisie manuelle.');
    fillEss();
    render();
  }
});
function buildReport(refArg) {
  const ref = refArg || fromIso($('dRef').value) || today();
  const fy = refArg ? defaultFy(refArg) : fromIso($('dFy').value) || defaultFy(ref);
  const ps = periods(fy);
  const cur = ps.find((p) => p.type === 'm' && ref >= p.s && ref <= p.e) || ps[0];
  const all = compute(ref, fy, cur);
  const essL = [...new Set(all.map((x) => x.ess))].sort();
  const sites = essL.map((e) => {
    const r = all.filter((x) => x.ess === e);
    const act = r.filter((x) => x.act === 'Oui');
    const months = ps
      .filter((p) => p.type === 'm')
      .map((p) => {
        const a = r.filter((x) => inP(p, x));
        return { m: iso(p.s).slice(0, 7), att: a.length, real: a.filter((x) => doneP(p, x)).length };
      });
    const late = r.filter((x) => x.stat === 'En retard').sort((a, b) => (b.ret || 0) - (a.ret || 0));
    return {
      ess: e,
      actifs: act.length,
      iit: r.filter((x) => x.act.startsWith('Non : IIT')).length,
      late: late.length,
      todo: r.filter((x) => x.stat === 'À prélever ce mois').length,
      doneMonth: r.filter((x) => doneP(cur, x)).length,
      attMonth: r.filter((x) => inP(cur, x)).length,
      manual: r.filter((x) => x.src === 'Saisie manuelle' || x.src === 'Export corrigé').length,
      cvAJour: act.filter((x) => x.lastD && x.lastD >= addM(ref, -12)).length,
      months,
      ...(() => {
        const q = supp(r, ref);
        return {
          pvlsD: q.d,
          pvlsN: q.n,
          und: q.u,
          low: q.low,
          cra: q.cra,
          pend: r.filter((x) => x.act === 'Oui' && x.pend).length,
          craTodo: r.filter((x) => x.craTodo).length,
          tatMed: tat(r, ref).med,
        };
      })(),
      lateList: late
        .slice(0, 300)
        .map((x) => ({ dos: x.dos, due: iso(x.dueOrig), rep: iso(x.rep), mrep: x.mrep, ret: x.ret, rdv: x.rdv || '' })),
    };
  });
  return {
    type: 'ayaan-rapport',
    v: 1,
    gen: new Date().toISOString(),
    by: ((u) => (u ? { nom: u.nom, role: u.roleLab } : null))(AY.user()),
    ref: iso(ref),
    fy: iso(fy),
    file: (DATA && DATA.file) || '',
    example: !!(DATA && DATA.example && !Object.keys(MAN).length),
    sites,
  };
}
$('btnRep').onclick = async () => {
  if (!AY.can('rapport')) return;
  snapshot();
  const r = buildReport();
  if (r.example) {
    showMsg(
      'bad',
      "Importez d'abord l'export Tier.Net du site : le rapport ne peut pas contenir les données d'exemple.",
    );
    return;
  }
  const txt = JSON.stringify(r);
  const name = `Ayaan rapport - ${r.sites.length === 1 ? r.sites[0].ess : r.sites.length + ' ESS'} - ${r.ref}.json`;
  if (OFFLINE) {
    const mode = await dl(name, txt, 'application/json');
    if (mode !== 'annule')
      showMsg(
        'info',
        `Rapport enregistré ${lieu(mode)} (« ${esc(name)} »). Envoyez ce fichier au centralisateur (WhatsApp, courriel ou clé USB).`,
      );
    return;
  }
  try {
    await navigator.clipboard.writeText(txt);
    showMsg(
      'info',
      'Rapport copié. Collez-le dans le centralisateur (zone « Coller un rapport »), ou dans un message.',
    );
  } catch (e) {
    $('bk').value = txt;
    $('bk').select();
    showMsg(
      'info',
      'Copie refusée : le rapport est dans la zone de texte « Sauvegarder ou restaurer », sélectionné. Faites Ctrl + C.',
    );
  }
};
async function renderUsr() {
  if (!AY.can('utilisateurs')) {
    $('tbUsr').innerHTML = '';
    $('usrMatrix').innerHTML = '';
    return;
  }
  $('usrMatrix').innerHTML = AY.matrixHTML();
  const me = AY.user();
  $('tbUsr').innerHTML = (await AY.list())
    .map(
      (u) =>
        `<tr><td><b>${esc(u.nom)}</b>${me && me.id === u.id ? ' <span class="pill p-mut">vous</span>' : ''}${u.sansPin ? ' <span class="pill p-bad">PIN à redéfinir</span>' : ''}</td><td>${esc(u.roleLab)}</td><td>${u.cree ? fr(fromIso(u.cree)) : ''}</td><td class="row" style="flex-wrap:nowrap"><button class="btn ghost" type="button" data-ue="${u.id}">Modifier / nouveau PIN</button>${me && me.id === u.id ? '' : `<button class="btn ghost" type="button" data-ud="${u.id}">Supprimer</button>`}</td></tr>`,
    )
    .join('');
}
function usrReset() {
  $('usrForm').reset();
  $('u_id').value = '';
  $('u_save').textContent = "Ajouter l'utilisateur";
  $('u_pinLab').textContent = 'Code PIN de départ *';
}
$('usrForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('u_id').value;
  if ($('u_save').disabled) return; // enregistrement déjà en cours (double clic)
  $('u_save').disabled = true;
  $('u_msg').textContent = 'Enregistrement (chiffrement du code PIN)…';
  const err = await AY.save(id, $('u_nom').value, $('u_role').value, $('u_pin').value.trim());
  $('u_save').disabled = false;
  if (err) {
    $('u_msg').textContent = err;
    return;
  }
  $('u_msg').textContent = id
    ? 'Utilisateur modifié.'
    : `Utilisateur ${$('u_nom').value.trim()} ajouté : donnez-lui son code PIN de départ ; il pourra le changer avec « Changer le code PIN ».`;
  usrReset();
  renderUsr();
});
$('u_reset').onclick = () => {
  usrReset();
  $('u_msg').textContent = '';
};
let uDel = null;
$('tbUsr').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ue) {
    const u = (await AY.list()).find((x) => x.id === b.dataset.ue);
    $('u_id').value = u.id;
    $('u_nom').value = u.nom;
    $('u_role').value = u.role;
    $('u_pin').value = '';
    $('u_pinLab').textContent = u.sansPin
      ? 'Nouveau code PIN * (obligatoire : mise à jour de sécurité)'
      : 'Nouveau code PIN (vide = inchangé)';
    $('u_save').textContent = 'Enregistrer';
    $('u_nom').focus();
    return;
  }
  if (b.dataset.ud) {
    if (uDel !== b.dataset.ud) {
      uDel = b.dataset.ud;
      b.textContent = 'Confirmer';
      return;
    }
    const err = await AY.del(b.dataset.ud);
    uDel = null;
    $('u_msg').textContent = err || 'Utilisateur supprimé.';
    renderUsr();
  }
});
// ----- résumé du jour, notifications, partage
let DSTXT = '';
function daySummary() {
  if (!DATA) return null;
  const ref = today();
  const fy = fromIso($('dFy').value) || defaultFy(ref);
  const ps = periods(fy);
  const cur = ps.find((p) => p.type === 'm' && ref >= p.s && ref <= p.e) || ps[0];
  const essSel = $('selEss').value;
  let all = compute(ref, fy, cur);
  if (essSel) all = all.filter((x) => x.ess === essSel);
  const n = {
    today: all.filter((x) => x.todayF).length,
    cra: all.filter((x) => x.craTodo).length,
    late: all.filter((x) => x.stat === 'En retard').length,
    month: all.filter((x) => x.stat === 'À prélever ce mois').length,
    pend: all.filter((x) => x.act === 'Oui' && x.pend).length,
  };
  const lieu = essSel || ([...new Set(all.map((x) => x.ess))].length === 1 ? all[0].ess : 'toutes les ESS');
  const pl = (v, a, b) => v + ' ' + (v > 1 ? b : a);
  DSTXT = `Ayaan · ${lieu} · ${fr(ref)}\n• ${pl(n.today, 'patient', 'patients')} à prélever aujourd'hui\n• ${pl(n.cra, 'patient', 'patients')} à commencer le CRA (CV ≥ 1 000)\n• ${pl(n.late, 'patient', 'patients')} en retard de prélèvement\n• ${n.month} à prélever ce mois · ${pl(n.pend, 'résultat', 'résultats')} en attente`;
  return { n, lieu, ref };
}
function setBadge(v) {
  try {
    if ('setAppBadge' in navigator) {
      v ? navigator.setAppBadge(v) : navigator.clearAppBadge();
    }
  } catch (e) {}
}
function notifState() {
  if (!('Notification' in window))
    return /iPhone|iPad|iPod/.test(navigator.userAgent) &&
      !navigator.standalone &&
      !matchMedia('(display-mode: standalone)').matches
      ? 'ios'
      : 'absent';
  return Notification.permission;
}
// une notification par utilisateur et par jour (pas une seule par appareil)
async function sendNotif(title, opt) {
  if (!('Notification' in window)) throw new Error('notifications non prises en charge par ce navigateur');
  if ('serviceWorker' in navigator) {
    let r = await navigator.serviceWorker.getRegistration();
    if (!r)
      r = await Promise.race([navigator.serviceWorker.ready, new Promise((s) => setTimeout(() => s(null), 3000))]);
    if (r && r.showNotification) {
      await r.showNotification(title, opt);
      return;
    }
  }
  new Notification(title, opt);
}
async function notifyDay(d, force, test) {
  try {
    if (notifState() !== 'granted') return false;
    const u = AY.user(),
      k = 'notif.' + (u ? u.id : 'x'),
      dd = iso(today());
    if (!force && store.get(k) === dd) return false;
    const opt = {
      body: `${d.n.today} à prélever aujourd'hui · ${d.n.cra} CRA à commencer · ${d.n.late} en retard`,
      icon: 'icones/icon-192.png',
      badge: 'icones/icon-192.png',
      tag: test ? 'ayaan-test-' + Date.now() : 'ayaan-jour',
      renotify: true,
      requireInteraction: !!test,
    };
    await sendNotif(test ? 'Ayaan · test de notification' : "Ayaan · aujourd'hui", opt);
    store.set(k, dd);
    return true;
  } catch (e) {
    if (test) throw e;
    return false;
  }
}
function showDay() {
  const d = daySummary();
  if (!d) return;
  $('dsSub').textContent =
    `${d.lieu} · ${fr(d.ref)}${DATA.example && !Object.keys(MAN).length ? " · données d'exemple" : ''}`;
  const L = [
    ["Aujourd'hui", d.n.today, "patient(s) à prélever aujourd'hui (date prévue ou RDV ARV aujourd'hui)", 'var(--warn)'],
    ['CRA à commencer', d.n.cra, 'patient(s) à commencer le CRA (CV ≥ 1 000)', 'var(--bad)'],
    ['En retard', d.n.late, 'patient(s) en retard de prélèvement : tracking actif', 'var(--bad)'],
    ['À prélever ce mois', d.n.month, 'à prélever ce mois', 'var(--violet)'],
    ['Résultat en attente', d.n.pend, 'résultat(s) en attente', 'var(--bleu)'],
  ];
  $('dsList').innerHTML = L.map(
    (l) =>
      `<button type="button" class="it" data-f="${esc(l[0])}"><b style="color:${l[3]}">${l[1]}</b><span>${esc(l[2])}</span></button>`,
  ).join('');
  $('dsShare').hidden = !navigator.share;
  {
    const ns = notifState();
    $('dsNotif').hidden = ns !== 'default';
    $('dsNotifInfo').textContent =
      ns === 'denied'
        ? "Notifications bloquées : autorisez-les dans les réglages du téléphone (Paramètres › Applications › Ayaan, ou cadenas de la barre d'adresse › Notifications)."
        : ns === 'ios'
          ? "Sur iPhone ou iPad : installez d'abord Ayaan sur l'écran d'accueil (Partager › Sur l'écran d'accueil), puis ouvrez-la depuis son icône pour activer les notifications."
          : ns === 'absent'
            ? 'Ce navigateur ne permet pas les notifications.'
            : ns === 'granted'
              ? 'Notifications activées : une par jour et par utilisateur.'
              : '';
    $('dsTest').hidden = ns === 'absent' || ns === 'ios';
  }
  $('daySum').hidden = false;
  setBadge(d.n.late + d.n.cra);
  notifyDay(d);
  setTimeout(() => $('dsClose').focus(), 30);
}
$('btnDay').onclick = showDay;
$('dsClose').onclick = () => {
  $('daySum').hidden = true;
};
$('daySum').addEventListener('click', (e) => {
  if (e.target.id === 'daySum') {
    $('daySum').hidden = true;
    return;
  }
  const b = e.target.closest('.it');
  if (!b) return;
  statusFilter = b.dataset.f;
  EDITED.clear();
  page = 0;
  $('daySum').hidden = true;
  render();
  $('listTitle').scrollIntoView({ behavior: 'smooth' });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('daySum').hidden) $('daySum').hidden = true;
});
$('dsWa').onclick = () => {
  const t = encodeURIComponent(DSTXT),
    info = $('dsNotifInfo');
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    // ouvre directement l'application WhatsApp (évite la page wa.me qui reste bloquée dans l'application installée)
    let left = false;
    const h = () => {
      if (document.hidden) left = true;
    };
    document.addEventListener('visibilitychange', h);
    location.href = 'whatsapp://send?text=' + t;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', h);
      if (!left && !document.hidden)
        info.textContent =
          "WhatsApp ne s'est pas ouvert sur ce téléphone. Utilisez « Partager… » (puis WhatsApp) ou « Copier » puis collez le message dans WhatsApp.";
    }, 2000);
  } else window.open('https://web.whatsapp.com/send?text=' + t, '_blank', 'noopener');
};
$('dsSms').onclick = () => {
  location.href = 'sms:?&body=' + encodeURIComponent(DSTXT);
};
$('dsShare').onclick = () => {
  navigator.share({ text: DSTXT }).catch(() => {});
};
$('dsCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(DSTXT);
    $('dsCopy').textContent = 'Copié';
  } catch (e) {
    $('bk').value = DSTXT;
    $('dsCopy').textContent = 'Dans la zone de sauvegarde';
  }
  setTimeout(() => ($('dsCopy').textContent = 'Copier'), 2000);
};
$('dsNotif').onclick = () => {
  Notification.requestPermission().then(() => showDay());
};
$('dsTest').onclick = async () => {
  const info = $('dsNotifInfo'),
    bt = $('dsTest');
  let ns = notifState();
  if (ns === 'default') {
    try {
      await Notification.requestPermission();
    } catch (e) {}
    ns = notifState();
    $('dsNotif').hidden = ns !== 'default';
  }
  if (ns === 'denied') {
    info.textContent =
      'Notifications bloquées : Paramètres du téléphone › Applications › Ayaan (ou Chrome) › Notifications › Autoriser, puis réessayez.';
    return;
  }
  if (ns !== 'granted') {
    info.textContent = 'Autorisation non accordée : touchez « Activer les notifications » puis « Autoriser ».';
    return;
  }
  const d = daySummary();
  if (!d) return;
  bt.disabled = true;
  info.textContent = 'Envoi de la notification de test…';
  try {
    await notifyDay(d, true, true);
    info.textContent =
      "Notification de test envoyée : glissez le haut de l'écran vers le bas pour la voir. Si rien n'apparaît : vérifiez « Ne pas déranger » et Paramètres › Applications › Ayaan (ou Chrome) › Notifications.";
  } catch (e) {
    info.textContent =
      "La notification n'a pas pu être affichée (" +
      ((e && e.message) || e) +
      '). Fermez Ayaan, rouvrez-la depuis son icône et réessayez.';
  } finally {
    bt.disabled = false;
  }
};
// Après la connexion (et après un changement de PIN) : archive du mois, liste des utilisateurs, résumé du jour
// État du stockage persistant (voir stockage.js), affiché dans « Règles et sauvegarde »
async function afficherStockage() {
  const e = await etatStockage();
  const el = $('etatStockage');
  el.textContent = e.texte;
  el.className = 'alert ' + (e.ok ? 'info' : 'bad');
  STOCKAGE_OK = e.ok;
}
let STOCKAGE_OK = true;
function apresConnexion() {
  afficherStockage();
  snapshot();
  renderUsr();
  render();
  if (!DATA.example || Object.keys(MAN).length) showDay();
}
document.addEventListener('ayaan-user', apresConnexion);
// ----- graphique d'évolution mois par mois (attendus et réalisés), SVG sans bibliothèque
function renderEvo(rows, ps, per, ref) {
  const y = +($('selFy').value || defaultFy(ref).getFullYear()),
    essSel = $('selEss').value;
  $('evoTitle').textContent = `Évolution mois par mois · FY${String(y + 1).slice(2)} · ${essSel || 'toutes les ESS'}`;
  const lim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const M = ps
    .filter((p) => p.type === 'm' && p.s <= lim)
    .map((p) => {
      const k = iso(p.s).slice(0, 7),
        a = ARCH[k];
      const cur = iso(today()).slice(0, 7) === k; // mois en cours : chiffres en direct ; mois passés : archive si elle existe
      if (a && !cur) {
        const L = a.sites.filter((x) => !essSel || x.ess === essSel);
        return {
          p,
          att: L.reduce((t, x) => t + (x.att || 0), 0),
          real: L.reduce((t, x) => t + (x.real || 0), 0),
          arch: true,
          src: 'archive',
        };
      }
      const at = rows.filter((x) => inP(p, x));
      return {
        p,
        att: at.length,
        real: at.filter((x) => doneP(p, x)).length,
        arch: cur,
        src: cur ? 'mois en cours' : 'estimation recalculée',
      };
    });
  const box = $('evoChart');
  if (!M.length) {
    box.innerHTML = '<p class="muted">Aucun mois à afficher pour cette année.</p>';
    $('evoSum').textContent = '';
    $('tbEvo').innerHTML = '';
    return;
  }
  const Wd = 640,
    H = 240,
    L = 44,
    Rr = 14,
    T = 16,
    B = 34,
    max = Math.max(4, ...M.map((m) => Math.max(m.att, m.real)));
  const nice = Math.ceil(max / 4 / (max > 40 ? 10 : 1)) * (max > 40 ? 10 : 1) * 4;
  const n = 12,
    step = (Wd - L - Rr) / n,
    X = (i) => L + step * (i + 0.5),
    Yv = (v) => H - B - (v / nice) * (H - B - T);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = (nice * i) / 4;
    g += `<line x1="${L}" x2="${Wd - Rr}" y1="${Yv(v)}" y2="${Yv(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${Yv(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v}</text>`;
  }
  const sel = M.findIndex((m) => m.p.id === per.id);
  if (sel >= 0)
    g += `<rect x="${X(sel) - step / 2}" y="${T - 6}" width="${step}" height="${H - B - T + 6}" fill="var(--jaune-soft)"/>`;
  ps.filter((p) => p.type === 'm').forEach((p, i) => {
    g += `<text x="${X(i)}" y="${H - B + 16}" text-anchor="middle" font-size="11" fill="${i === sel ? 'var(--ink)' : 'var(--muted)'}" ${i === sel ? 'font-weight="700"' : ''}>${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][p.s.getMonth()]}</text>`;
  });
  const line = (k, c) => {
    let d = '';
    M.forEach((m, i) => {
      d += (i ? 'L' : 'M') + X(i) + ',' + Yv(m[k]);
    });
    let out = `<path d="${d}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/>`;
    M.forEach((m, i) => {
      out += `<circle cx="${X(i)}" cy="${Yv(m[k])}" r="4.5" fill="${m.arch ? c : 'var(--panel)'}" stroke="${c}" stroke-width="2"><title>${m.p.lab} · ${k === 'att' ? 'Attendus' : 'Réalisés'} : ${m[k]}${' (' + m.src + ')'}</title></circle>`;
    });
    // valeur au-dessus du dernier point
    const i = M.length - 1;
    out += `<text x="${X(i) + 7}" y="${Yv(M[i][k]) + 4}" font-size="11" font-weight="700" fill="${c}">${M[i][k]}</text>`;
    return out;
  };
  g += line('att', 'var(--bleu)') + line('real', 'var(--ok)');
  // zones cliquables par mois
  M.forEach((m, i) => {
    g += `<rect x="${X(i) - step / 2}" y="${T}" width="${step}" height="${H - B - T + 20}" fill="transparent" style="cursor:pointer" data-per="${m.p.id}"><title>${m.p.lab} : attendus ${m.att}, réalisés ${m.real}</title></rect>`;
  });
  box.innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" width="100%" style="max-height:300px;display:block" aria-label="Attendus et réalisés par mois">${g}</svg>`;
  // synthèse et tableau
  const pct = (m) => (m.att ? Math.round((100 * m.real) / m.att) : null),
    a = M[0],
    z = M[M.length - 1];
  $('evoSum').textContent =
    M.length < 2
      ? `${z.p.lab} : ${z.att} attendus, ${z.real} réalisés${pct(z) != null ? ' (' + pct(z) + ' %)' : ''}.`
      : `Attendus : ${a.att} en ${a.p.lab} → ${z.att} en ${z.p.lab} (${z.att - a.att >= 0 ? '+' : ''}${z.att - a.att}) ; réalisés : ${a.real} → ${z.real} ; réalisation : ${pct(a) ?? '–'} % → ${pct(z) ?? '–'} %.`;
  $('tbEvo').innerHTML = M.map((m) => {
    const v = m.att ? m.real / m.att : null;
    return `<tr><td>${esc(m.p.lab)}</td><td class="num">${m.att}</td><td class="num">${m.real}</td><td class="num ${pctCls(v)}">${pctTxt(v)}</td><td class="muted">${m.src}</td></tr>`;
  }).join('');
}
$('evoChart').addEventListener('click', (e) => {
  const r = e.target.closest('[data-per]');
  if (!r) return;
  $('selPer').value = r.dataset.per;
  EDITED.clear();
  page = 0;
  render();
});
// ----- années fiscales et archives mensuelles
const fyLab = (d) => 'FY' + String(defaultFy(d).getFullYear() + 1).slice(2);
let ARCH = store.get(K_ARCH) || {};
let FYL = store.get(K_FYL);
function fyInit() {
  if (Array.isArray(FYL) && FYL.length) return;
  const now = defaultFy(today()).getFullYear();
  let min = now - 1;
  Object.keys(ARCH).forEach((m) => {
    const y = defaultFy(fromIso(m + '-01')).getFullYear();
    if (y < min) min = y;
  });
  FYL = [];
  for (let y = min; y <= now; y++) FYL.push(y);
  store.set(K_FYL, FYL);
}
const fyName = (y) => 'FY' + String(y + 1).slice(2);
function fillFy() {
  fyInit();
  const sel = $('selFy');
  const now = defaultFy(today()).getFullYear();
  const ys = [...FYL].sort((a, b) => b - a);
  sel.innerHTML = ys
    .map(
      (y) => `<option value="${y}">${fyName(y)} (oct. ${y} – sept. ${y + 1})${y === now ? ' · en cours' : ''}</option>`,
    )
    .join('');
  const fy = fromIso($('dFy').value) || defaultFy(today());
  sel.value = String(fy.getFullYear());
  if (!sel.value) sel.value = String(ys[0]);
  const last = Math.max(...FYL),
    fin = new Date(last + 1, 8, 30),
    next = last + 1,
    canAdd = today() > fin;
  $('fyAddNext').textContent = `Ajouter l'année fiscale suivante (${fyName(next)})`;
  $('fyAddNext').disabled = !canAdd;
  $('fyAddPrev').textContent = `Ajouter une année précédente (${fyName(Math.min(...FYL) - 1)})`;
  $('fyInfo').textContent = canAdd
    ? `${fyName(last)} est terminée depuis le ${fr(fin)} : ajoutez ${fyName(next)}.`
    : `${fyName(next)} pourra être ajoutée à partir du ${fr(new Date(last + 1, 9, 1))}, après la fin de ${fyName(last)}.`;
  $('fyAlert').innerHTML =
    canAdd && now > last
      ? `<div class="alert bad">L'année fiscale ${fyName(now)} a commencé mais n'est pas encore ajoutée${AY.can('annees') ? " : utilisez « Ajouter l'année fiscale suivante » dans « Archives mensuelles »." : " : demandez à l'administrateur de l'ajouter."}</div>`
      : '';
}
function snapshot() {
  try {
    if (!DATA || (DATA.example && !Object.keys(MAN).length)) return;
    const r = buildReport(today());
    const m = iso(today()).slice(0, 7);
    ARCH[m] = {
      gen: r.gen,
      by: r.by,
      sites: r.sites.map((x) => ({
        ess: x.ess,
        actifs: x.actifs,
        att: x.attMonth,
        real: x.doneMonth,
        late: x.late,
        pvlsD: x.pvlsD,
        pvlsN: x.pvlsN,
        cra: x.cra,
        craTodo: x.craTodo,
        tatMed: x.tatMed,
      })),
    };
    if (!store.set(K_ARCH, ARCH))
      showMsg('bad', "Archives mensuelles non enregistrées : mémoire de l'appareil pleine. Faites une sauvegarde.");
  } catch (e) {}
}
function renderArch() {
  const y = +($('selFy').value || defaultFy(today()).getFullYear());
  const essSel = $('selEss').value;
  $('archTitle').textContent = `Archives mensuelles · FY${String(y + 1).slice(2)}${essSel ? ' · ' + essSel : ''}`;
  let n = 0;
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, 9 + i, 1),
      m = iso(d).slice(0, 7),
      a = ARCH[m];
    if (!a) {
      rows.push(
        `<tr><td>${MOIS[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}</td><td colspan="9" class="muted">pas d'archive</td></tr>`,
      );
      continue;
    }
    n++;
    const L = a.sites.filter((x) => !essSel || x.ess === essSel),
      S = (k) => L.reduce((t, x) => t + (x[k] || 0), 0);
    const att = S('att'),
      real = S('real'),
      pv = att ? real / att : null,
      sp = S('pvlsD') ? S('pvlsN') / S('pvlsD') : null;
    rows.push(
      `<tr><td>${MOIS[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear()}</td><td class="num">${S('actifs')}</td><td class="num">${att}</td><td class="num">${real}</td><td class="num ${pctCls(pv)}">${pctTxt(pv)}</td><td class="num">${S('late')}</td><td class="num ${pctCls(sp)}">${pctTxt(sp)}</td><td class="num">${S('cra')}</td><td class="num">${S('craTodo')}</td><td class="muted">${fr(new Date(a.gen))}${a.by ? ' · ' + esc(a.by.nom) : ''}</td></tr>`,
    );
  }
  $('tbArch').innerHTML = rows.join('');
  $('archInfo').textContent = `${n} mois archivé(s) sur 12`;
}
$('fyAddNext').onclick = () => {
  if (!AY.can('annees')) return;
  const last = Math.max(...FYL);
  if (!(today() > new Date(last + 1, 8, 30))) return;
  FYL.push(last + 1);
  store.set(K_FYL, FYL);
  showMsg('info', `Année fiscale ${fyName(last + 1)} ajoutée.`);
  fillFy();
  $('selFy').value = String(last + 1);
  $('selFy').dispatchEvent(new Event('change'));
};
$('fyAddPrev').onclick = () => {
  if (!AY.can('annees')) return;
  const y = Math.min(...FYL) - 1;
  FYL.push(y);
  store.set(K_FYL, FYL);
  showMsg('info', `Année fiscale ${fyName(y)} ajoutée à la liste.`);
  fillFy();
};
$('selFy').addEventListener('change', () => {
  const y = +$('selFy').value,
    now = defaultFy(today()).getFullYear();
  $('dFy').value = iso(new Date(y, 9, 1));
  $('dRef').value = iso(y === now ? today() : new Date(y + 1, 8, 30));
  EDITED.clear();
  page = 0;
  render();
});
// init
try {
  navigator.storage && navigator.storage.persist && navigator.storage.persist();
} catch (e) {}
Coffre.quandErreur((e) =>
  showMsg('bad', 'Enregistrement chiffré impossible : ' + esc(e.message) + '. Faites une sauvegarde.'),
);
const ref0 = today();
$('dRef').value = iso(ref0);
$('dFy').value = iso(defaultFy(ref0));
DATA = store.get(K_DATA) || sample();
if (!DATA.example) showMsg('info', `Dernier export chargé : ${esc(DATA.file)} (importé le ${fr(fromIso(DATA.date))}).`);
fillEss();
apresConnexion();

/* =====================================================================
   Ayaan · central.js — le centralisateur (réservé aux administrateurs)

   Reçoit les rapports mensuels envoyés par les sites (fichiers .json),
   les garde dans le coffre chiffré et affiche le tableau de bord par site
   et par zone de santé. Un seul rapport par ESS et par mois : le plus
   récent remplace l'ancien.
   ===================================================================== */

import { AY } from './auth.js';
import * as Coffre from './coffre.js';
import { enregistrerFichier, lireTexte, brancherDepot } from './fichiers.js';
import { demanderPersistance } from './stockage.js';

await AY.pret; // attendre un code PIN administrateur valide

/* ---------------------------------------------------------------------
   Contrôle d'un rapport reçu (OWASP M4) : seuls les champs attendus sont
   gardés ; les nombres sont de vrais nombres, les textes sont limités.
   --------------------------------------------------------------------- */
const txt = (v, max) => (v == null ? '' : String(v).slice(0, max));
const num = (v) => (v == null || v === '' ? null : isFinite(+v) ? +v : null);
const dateOk = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 24) : '');
const CHAMPS_NOMBRES = [
  'actifs',
  'iit',
  'late',
  'todo',
  'doneMonth',
  'attMonth',
  'manual',
  'cvAJour',
  'pvlsD',
  'pvlsN',
  'und',
  'low',
  'cra',
  'pend',
  'craTodo',
  'tatMed',
];
function nettoyerSite(x, rapport) {
  if (!x || typeof x !== 'object' || !x.ess) return null;
  const o = { ess: txt(x.ess, 80) };
  for (const k of CHAMPS_NOMBRES) o[k] = num(x[k]);
  o.actifs = o.actifs || 0;
  o.late = o.late || 0;
  o.months = Array.isArray(x.months)
    ? x.months
        .filter((m) => m && /^\d{4}-\d{2}$/.test(m.m))
        .map((m) => ({ m: m.m, att: num(m.att) || 0, real: num(m.real) || 0 }))
    : [];
  o.lateList = Array.isArray(x.lateList)
    ? x.lateList.slice(0, 300).map((p) => ({
        dos: txt(p && p.dos, 40),
        due: dateOk(p && p.due),
        rep: dateOk(p && p.rep),
        mrep: num(p && p.mrep),
        ret: num(p && p.ret),
        rdv: dateOk(p && p.rdv),
      }))
    : [];
  // champs ajoutés par le centralisateur lui-même (rapports déjà rangés)
  if (rapport) {
    o.ref = dateOk(rapport.ref);
    o.fy = dateOk(rapport.fy);
    o.gen = txt(rapport.gen, 30);
    o.recv = txt(rapport.recv, 30);
    o.src = txt(rapport.src, 120);
    o.by =
      rapport.by && typeof rapport.by === 'object'
        ? { nom: txt(rapport.by.nom, 40), role: txt(rapport.by.role, 40) }
        : null;
  }
  if (rapport && !o.ref) return null;
  return o;
}
function nettoyerRapport(r) {
  if (!r || r.type !== 'ayaan-rapport' || !Array.isArray(r.sites) || !dateOk(r.ref)) return null;
  return {
    type: 'ayaan-rapport',
    v: num(r.v),
    gen: txt(r.gen, 30),
    ref: dateOk(r.ref),
    fy: dateOk(r.fy),
    file: txt(r.file, 120),
    example: !!r.example,
    by: r.by && typeof r.by === 'object' ? { nom: txt(r.by.nom, 40), role: txt(r.by.role, 40) } : null,
    sites: r.sites.map((x) => nettoyerSite(x)).filter(Boolean),
  };
}

const $ = (id) => document.getElementById(id);
const DAY = 864e5;
// Les rapports reçus sont gardés dans le coffre chiffré (donnée « central »)
const store = { get: () => Coffre.lire('central'), set: (v) => Coffre.ecrire('central', v) };
let ST = store.get() || { reports: {}, zones: {} };
const ZONES = ['Bandalungwa', 'Binza-Météo', 'Kikimi', 'Kingasani', 'Masina II'];
const KNOWN = {
  'Masina II': [
    'CS ELONGA',
    'SAINT HILAIRE',
    'CS LUNDA',
    'MAPELA',
    'PODI MASINA 2',
    'CS KIMBELA',
    'KASAI',
    'CS TEMOIGNAGE',
    'CS BORA',
    'MAFUTA KIZOLA',
    'AVENIR',
    'ALFADO',
  ],
};
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
// Excel : neutraliser les cellules qui commenceraient une formule
const sur = (v) => {
  v = String(v ?? '');
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
};
const fromIso = (s) => {
  if (!s) return null;
  const [a, b, c] = s.slice(0, 10).split('-').map(Number);
  return new Date(a, b - 1, c);
};
const fr = (d) =>
  d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
const MOIS = [
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
const mLab = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return MOIS[mm - 1].replace(/^./, (c) => c.toUpperCase()) + ' ' + y;
};
const pct = (a, b) => (b ? a / b : null);
const pctTxt = (v) => (v == null ? '–' : (v * 100).toFixed(1).replace('.', ',') + ' %');
const pctCls = (v) => (v == null ? '' : v >= 0.95 ? 'pct-ok' : v >= 0.85 ? 'pct-warn' : 'pct-bad');
const today = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
};
function msg(k, t) {
  $('msg').innerHTML = t ? `<div class="alert ${k}">${t}</div>` : '';
}
function zoneOf(e) {
  if (ST.zones[e]) return ST.zones[e];
  for (const z in KNOWN) if (KNOWN[z].includes(e.toUpperCase())) return z;
  return 'Non classée';
}
function addReport(r0, src) {
  const r = nettoyerRapport(r0);
  if (!r) throw new Error("ce n'est pas un rapport Ayaan Suivi CV");
  if (r.example) throw new Error("rapport fait avec les données d'exemple");
  const o = { n: 0, repl: 0, old: 0 };
  // Un seul rapport par ESS et par mois : le plus récent (date de création) remplace l'ancien, d'où qu'il vienne.
  for (const s of r.sites) {
    const list = (ST.reports[s.ess] = ST.reports[s.ess] || []);
    const rec = { ...s, ref: r.ref, fy: r.fy, gen: r.gen, by: r.by || null, recv: new Date().toISOString(), src };
    const i = list.findIndex((x) => x.ref.slice(0, 7) === r.ref.slice(0, 7));
    if (i >= 0) {
      if ((list[i].gen || '') > (r.gen || '')) {
        o.old++;
        continue;
      }
      list[i] = rec;
      o.repl++;
    } else list.push(rec);
    list.sort((a, b) => a.ref.localeCompare(b.ref));
    o.n++;
  }
  return o;
}
function save() {
  if (!store.set(ST))
    msg('bad', "Cet ordinateur n'a pas pu enregistrer les rapports. Faites une sauvegarde en fichier.");
}
function latest(fy) {
  const fyOf = (m) => {
    const [y, mm] = m.split('-').map(Number);
    return mm >= 10 ? y : y - 1;
  };
  const out = [];
  for (const e in ST.reports) {
    const l0 = ST.reports[e];
    const l = fy == null ? l0 : l0.filter((x) => fyOf(x.ref.slice(0, 7)) <= fy);
    const inFy = l.filter((x) => fy == null || fyOf(x.ref.slice(0, 7)) === fy);
    if (inFy.length) {
      const last = inFy[inFy.length - 1],
        i = l.indexOf(last);
      out.push({ ...last, prev: i > 0 ? l[i - 1] : null, hist: l });
    }
  }
  return out.sort((a, b) => a.ess.localeCompare(b.ess));
}
let SEL = null;

function spark(months, mk) {
  const w = 120,
    h = 28,
    pts = months.map((m, i) => {
      const v = m.att ? m.real / m.att : null;
      return v == null ? null : [i * (w / 11), h - 2 - v * (h - 4)];
    });
  const segs = [];
  let cur = [];
  pts.forEach((p) => {
    if (p) cur.push(p);
    else if (cur.length) {
      segs.push(cur);
      cur = [];
    }
  });
  if (cur.length) segs.push(cur);
  const sel = months.findIndex((m) => m.m === mk);
  const sp = pts[sel];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Évolution du pourcentage de réalisation"><line x1="0" x2="${w}" y1="${h - 2 - 0.95 * (h - 4)}" y2="${h - 2 - 0.95 * (h - 4)}" stroke="var(--ok)" stroke-dasharray="2 3" stroke-width="1"/>${segs.map((s) => `<polyline fill="none" stroke="var(--violet)" stroke-width="1.6" points="${s.map((p) => p.join(',')).join(' ')}"/>`).join('')}${sp ? `<circle cx="${sp[0]}" cy="${sp[1]}" r="3" fill="var(--jaune)" stroke="var(--violet)"/>` : ''}</svg>`;
}
function barChart(months, mk) {
  const W = 520,
    H = 210,
    L = 34,
    B = 30,
    T = 10,
    R = 8;
  const max = Math.max(1, ...months.map((m) => m.att));
  const step = (W - L - R) / months.length,
    bw = step * 0.36;
  const y = (v) => H - B - (v / max) * (H - B - T);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((max * i) / 4);
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  months.forEach((m, i) => {
    const x = L + i * step + step * 0.12;
    g += `<rect x="${x}" y="${y(m.att)}" width="${bw}" height="${H - B - y(m.att)}" fill="var(--violet-soft)" stroke="var(--violet)"/><rect x="${x + bw + 2}" y="${y(m.real)}" width="${bw}" height="${H - B - y(m.real)}" fill="var(--ok)"/>`;
    const p = m.att ? Math.round((100 * m.real) / m.att) : null;
    if (p != null && m.att)
      g += `<text x="${x + bw}" y="${Math.min(y(m.att), y(m.real)) - 3}" text-anchor="middle">${p}%</text>`;
    g += `<text x="${x + bw}" y="${H - B + 14}" text-anchor="middle" ${m.m === mk ? 'style="font-weight:700;fill:var(--ink)"' : ''}>${MOIS[+m.m.slice(5) - 1].slice(0, 3)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Attendus et réalisés par mois">${g}</svg>`;
}
function lineChart(hist) {
  const W = 520,
    H = 210,
    L = 40,
    B = 30,
    T = 10,
    R = 10;
  if (hist.length < 2)
    return '<p class="muted">L\'évolution apparaîtra à partir du deuxième rapport reçu pour ce site.</p>';
  const max = Math.max(1, ...hist.map((h) => Math.max(h.late, h.actifs)));
  const x = (i) => L + (i * (W - L - R)) / (hist.length - 1),
    y = (v) => H - B - (v / max) * (H - B - T);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((max * i) / 4);
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const pl = (k, c) =>
    `<polyline fill="none" stroke="${c}" stroke-width="2" points="${hist.map((h, i) => x(i) + ',' + y(h[k])).join(' ')}"/>` +
    hist.map((h, i) => `<circle cx="${x(i)}" cy="${y(h[k])}" r="3" fill="${c}"/>`).join('');
  g += pl('actifs', 'var(--violet)') + pl('late', 'var(--bad)');
  hist.forEach((h, i) => {
    if (hist.length <= 8 || i % Math.ceil(hist.length / 8) === 0 || i === hist.length - 1)
      g += `<text x="${x(i)}" y="${H - B + 14}" text-anchor="${i === hist.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${fr(fromIso(h.ref)).slice(0, 5)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Évolution des actifs et des retards">${g}</svg>`;
}

function render() {
  const fyOf = (m) => {
    const [y, mm] = m.split('-').map(Number);
    return mm >= 10 ? y : y - 1;
  };
  const allM = [
    ...new Set(
      Object.values(ST.reports)
        .flat()
        .flatMap((x) => (x.months || []).map((m) => m.m))
        .concat(
          Object.values(ST.reports)
            .flat()
            .map((x) => x.ref.slice(0, 7)),
        ),
    ),
  ];
  const nowFy = (() => {
    const d = today();
    return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
  })();
  const fys = [...new Set(allM.map(fyOf).concat([nowFy]))].sort((a, b) => b - a);
  const fSel = $('selFyC'),
    fc = fSel.value;
  fSel.innerHTML = fys
    .map(
      (y) =>
        `<option value="${y}">FY${String(y + 1).slice(2)} (oct. ${y} – sept. ${y + 1})${y === nowFy ? ' · en cours' : ''}</option>`,
    )
    .join('');
  fSel.value = fys.map(String).includes(fc) ? fc : String(nowFy);
  const FYS = +fSel.value;
  const all = latest(FYS);
  // zones & months
  const zSel = $('selZone'),
    zc = zSel.value;
  const zs = [...new Set(all.map((x) => zoneOf(x.ess)))].sort();
  zSel.innerHTML =
    `<option value="">Toutes les zones</option>` +
    zs.map((z) => `<option${z === zc ? ' selected' : ''}>${esc(z)}</option>`).join('');
  const mSel = $('selMonth'),
    mc = mSel.value;
  const ms = [...new Set(all.flatMap((x) => (x.months || []).map((m) => m.m)))].filter((m) => fyOf(m) === FYS).sort();
  const curM = (() => {
    const d = today();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  mSel.innerHTML = ms.map((m) => `<option value="${m}">${mLab(m)}</option>`).join('');
  mSel.value = ms.includes(mc) ? mc : ms.includes(curM) ? curM : ms[0] || '';
  const mk = mSel.value,
    zone = zSel.value,
    stale = +$('selStale').value;
  const L = all.filter((x) => !zone || zoneOf(x.ess) === zone);
  if (!all.length) {
    msg(
      'info',
      "Aucun rapport pour l'instant. Dans chaque site, cliquez sur « Envoyer au centralisateur » dans Ayaan Suivi CV, puis importez ici les fichiers reçus (plusieurs à la fois si besoin).",
    );
  }
  const mOf = (x) => (x.months || []).find((m) => m.m === mk) || { att: 0, real: 0 };
  const T = L.reduce(
    (a, x) => {
      const m = mOf(x);
      a.act += x.actifs;
      a.att += m.att;
      a.real += m.real;
      a.late += x.late;
      a.old += (today() - fromIso(x.ref)) / DAY > stale ? 1 : 0;
      a.pD += x.pvlsD || 0;
      a.pN += x.pvlsN || 0;
      a.cra += x.cra || 0;
      a.craT += x.craTodo || 0;
      a.low += x.low || 0;
      return a;
    },
    { act: 0, att: 0, real: 0, late: 0, old: 0, pD: 0, pN: 0, cra: 0, low: 0, craT: 0 },
  );
  const sp = pct(T.pN, T.pD);
  const tp = pct(T.real, T.att);
  $('tiles').innerHTML = [
    ['', L.length, 'ESS suivies'],
    ['', T.act.toLocaleString('fr-FR'), 'Patients actifs (MER)'],
    ['', T.att.toLocaleString('fr-FR'), 'Attendus · ' + (mk ? mLab(mk) : '')],
    ['o', T.real.toLocaleString('fr-FR'), 'Réalisés'],
    ['', pctTxt(tp), '% de réalisation'],
    ['r', T.late.toLocaleString('fr-FR'), 'En retard : tracking actif'],
    [
      '',
      pctTxt(sp),
      'Suppression virale (< 1 000) : ' + T.pN.toLocaleString('fr-FR') + ' / ' + T.pD.toLocaleString('fr-FR'),
      pctCls(sp),
    ],
    [
      'r',
      T.cra.toLocaleString('fr-FR'),
      'CV ≥ 1 000 · CRA à commencer : ' + T.craT + ' · bas niveau 50–999 : ' + T.low,
    ],
    ['r', T.old, 'Rapports anciens (> ' + stale + ' j)'],
    [
      '',
      (() => {
        const v = L.map((x) => x.tatMed)
          .filter((v) => v != null)
          .sort((a, b) => a - b);
        return v.length ? v[Math.floor((v.length - 1) / 2)] + ' j' : '–';
      })(),
      'Délai de retour des résultats (médiane des sites)',
    ],
  ]
    .map(
      (t) =>
        `<div class="tile ${t[0]}"><b class="${t[2] === '% de réalisation' ? pctCls(tp) : t[3] || ''}">${t[1]}</b><span>${esc(t[2])}</span></div>`,
    )
    .join('');
  $('tTitle').textContent = `Situation par site${zone ? ' · ' + zone : ''}${mk ? ' · ' + mLab(mk) : ''}`;
  $('tbS').innerHTML =
    L.map((x) => {
      const m = mOf(x),
        p = pct(m.real, m.att),
        age = Math.round((today() - fromIso(x.ref)) / DAY),
        d = x.prev ? x.late - x.prev.late : null;
      const tr =
        d == null
          ? '<span class="muted">1er rapport</span>'
          : d > 0
            ? `<span class="pill p-bad">▲ +${d}</span>`
            : d < 0
              ? `<span class="pill p-ok">▼ ${d}</span>`
              : '<span class="pill p-warn">= 0</span>';
      return `<tr class="click${x.ess === SEL ? ' sel' : ''}" tabindex="0" data-e="${esc(x.ess)}"><td><b>${esc(x.ess)}</b></td>
    <td><select data-z="${esc(x.ess)}"${AY.can('c_importer') ? '' : ' disabled'} aria-label="Zone de ${esc(x.ess)}">${[...ZONES, 'Non classée'].map((z) => `<option${z === zoneOf(x.ess) ? ' selected' : ''}>${z}</option>`).join('')}</select></td>
    <td>${fr(fromIso(x.ref))} ${age > stale ? `<span class="pill p-bad">${age} j</span>` : `<span class="muted">(${age} j)</span>`}</td>
    <td class="num">${x.actifs}</td><td class="num">${m.att}</td><td class="num">${m.real}</td><td class="num ${pctCls(p)}">${pctTxt(p)}</td>
    <td class="num">${x.late ? `<b style="color:var(--bad)">${x.late}</b>` : 0}</td><td>${tr}</td>
    <td class="num">${pctTxt(pct(x.cvAJour || 0, x.actifs))}</td><td class="num ${pctCls(pct(x.pvlsN, x.pvlsD))}">${x.pvlsD != null ? pctTxt(pct(x.pvlsN, x.pvlsD)) : '–'}</td><td class="num">${x.cra ? `<b style="color:var(--bad)">${x.cra}</b>` : x.pvlsD != null ? 0 : '–'}</td><td>${spark(x.months || [], mk)}</td></tr>`;
    }).join('') || '<tr><td colspan="13" class="muted">Aucun site pour ce filtre.</td></tr>';
  // zones table
  const Z = {};
  all.forEach((x) => {
    const z = zoneOf(x.ess);
    const m = mOf(x);
    Z[z] = Z[z] || { n: 0, act: 0, att: 0, real: 0, late: 0, pD: 0, pN: 0, cra: 0 };
    Object.assign(Z[z], {
      n: Z[z].n + 1,
      act: Z[z].act + x.actifs,
      att: Z[z].att + m.att,
      real: Z[z].real + m.real,
      late: Z[z].late + x.late,
      pD: Z[z].pD + (x.pvlsD || 0),
      pN: Z[z].pN + (x.pvlsN || 0),
      cra: Z[z].cra + (x.cra || 0),
    });
  });
  $('tbZ').innerHTML =
    Object.keys(Z)
      .sort()
      .map((z) => {
        const v = Z[z],
          p = pct(v.real, v.att);
        return `<tr><td><b>${esc(z)}</b></td><td class="num">${v.n}</td><td class="num">${v.act}</td><td class="num">${v.att}</td><td class="num">${v.real}</td><td class="num ${pctCls(p)}">${pctTxt(p)}</td><td class="num">${v.late}</td><td class="num ${pctCls(pct(v.pN, v.pD))}">${pctTxt(pct(v.pN, v.pD))}</td><td class="num">${v.cra}</td></tr>`;
      })
      .join('') || '<tr><td colspan="9" class="muted">–</td></tr>';
  // detail
  const x = all.find((a) => a.ess === SEL);
  $('detail').hidden = !x;
  if (x) {
    $('dTitle').textContent = x.ess;
    $('dSub').textContent =
      `${zoneOf(x.ess)} · dernier rapport du ${fr(fromIso(x.ref))} · ${x.hist.length} rapport(s) reçu(s)`;
    $('chM').innerHTML = barChart(x.months || [], mk);
    $('chH').innerHTML = lineChart(x.hist);
    $('lTitle').textContent = `Patients en retard (tracking actif) : ${x.late}`;
    $('tbL').innerHTML =
      (x.lateList || [])
        .map(
          (p) =>
            `<tr><td><b>${esc(p.dos)}</b></td><td class="num">${fr(fromIso(p.due))}</td><td class="num">${p.ret ?? ''}</td><td class="num">${fr(fromIso(p.rdv))}</td></tr>`,
        )
        .join('') || '<tr><td colspan="4" class="muted">Aucun patient en retard.</td></tr>';
  }
  // history
  $('tbH').innerHTML =
    Object.keys(ST.reports)
      .sort()
      .flatMap((e) =>
        ST.reports[e].map(
          (r, i) =>
            `<tr><td>${esc(e)}</td><td>${fr(fromIso(r.ref))}</td><td>${r.by ? esc(r.by.nom) + ' <span class="muted">(' + esc(r.by.role) + ')</span>' : '<span class="muted">—</span>'}</td><td>${fr(fromIso(r.recv))}</td><td class="num">${r.actifs}</td><td class="num">${r.late}</td><td>${AY.can('c_importer') ? `<button class="btn ghost" type="button" data-del="${esc(e)}" data-i="${i}">Retirer</button>` : ''}</td></tr>`,
        ),
      )
      .join('') || '<tr><td colspan="7" class="muted">Aucun rapport.</td></tr>';
}

// events
$('btnImp').onclick = () => $('files').click();
// Import de rapports : bouton (Explorateur Windows, app Fichiers de l'iPhone…) ou glisser-déposer
$('files').onchange = async (e) => {
  const liste = [...e.target.files];
  e.target.value = ''; // permet de choisir à nouveau les mêmes fichiers
  importerRapports(liste);
};
brancherDepot(
  document.body,
  (l) => importerRapports(l),
  () => AY.can('c_importer'),
);
async function importerRapports(liste) {
  if (!AY.can('c_importer')) return;
  demanderPersistance();
  let ok = 0,
    n = 0,
    rp = 0,
    od = 0,
    err = [];
  for (const f of liste) {
    try {
      if (f.size > 20 * 1048576) throw new Error('fichier trop volumineux');
      const o = addReport(JSON.parse(await lireTexte(f)), f.name);
      n += o.n;
      rp += o.repl;
      od += o.old;
      ok++;
    } catch (x) {
      err.push(`${f.name} : ${x.message}`);
    }
  }
  save();
  msg(
    err.length ? 'bad' : 'info',
    `${ok} fichier(s) importé(s), ${n} ESS mises à jour` +
      (rp ? ` dont ${rp} rapport(s) remplacé(s) (même ESS, même mois)` : '') +
      '.' +
      (od ? ` ${od} rapport(s) ignoré(s) : plus ancien(s) que celui déjà reçu.` : '') +
      (err.length ? '<br>Non importé(s) : ' + err.map(esc).join(' ; ') : ''),
  );
  render();
}
$('btnPaste').onclick = () => {
  try {
    const o = addReport(JSON.parse($('paste').value), 'texte collé');
    save();
    $('paste').value = '';
    msg(
      'info',
      `Rapport ajouté : ${o.n} ESS mises à jour` +
        (o.repl ? `, dont ${o.repl} remplacé(s)` : '') +
        '.' +
        (o.old ? ` ${o.old} ignoré(s) car plus ancien(s).` : ''),
    );
    render();
  } catch (x) {
    msg('bad', 'Texte non reconnu : collez exactement le rapport copié depuis Ayaan Suivi CV.');
  }
};
['selFyC', 'selZone', 'selMonth', 'selStale'].forEach((id) => $(id).addEventListener('change', render));
$('tbS').addEventListener('change', (e) => {
  const s = e.target.closest('select[data-z]');
  if (!s || !AY.can('c_importer')) return;
  ST.zones[s.dataset.z] = s.value;
  save();
  render();
});
$('tbS').addEventListener('click', (e) => {
  if (e.target.closest('select')) return;
  const tr = e.target.closest('tr[data-e]');
  if (!tr) return;
  SEL = tr.dataset.e;
  render();
  $('detail').scrollIntoView({ behavior: 'smooth' });
});
$('tbS').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const tr = e.target.closest('tr[data-e]');
    if (tr) {
      SEL = tr.dataset.e;
      render();
    }
  }
});
let armDel = null;
$('tbH').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-del]');
  if (!b) return;
  const id = b.dataset.del + '#' + b.dataset.i;
  if (armDel !== id) {
    armDel = id;
    b.textContent = 'Confirmer';
    return;
  }
  ST.reports[b.dataset.del].splice(+b.dataset.i, 1);
  if (!ST.reports[b.dataset.del].length) delete ST.reports[b.dataset.del];
  armDel = null;
  save();
  render();
});
const dl = (name, text) => enregistrerFichier(name, text, 'application/json');
// Sauvegarde du centralisateur : fichier chiffré (même principe que dans Ayaan Suivi CV)
$('btnSave').onclick = async () => {
  if (!AY.can('sauvegarde')) return;
  const d = today();
  const txt = await Coffre.fabriquerSauvegarde({ type: 'ayaan-central', ...ST });
  const mode = await dl(
    `Ayaan centralisateur - sauvegarde chiffree - ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`,
    txt,
  );
  $('bmsg').textContent =
    mode === 'annule'
      ? 'Enregistrement annulé.'
      : mode === 'partage'
        ? "Sauvegarde chiffrée enregistrée à l'endroit choisi."
        : 'Sauvegarde chiffrée enregistrée dans Téléchargements.';
};
$('btnRestore').onclick = () => $('bkf').click();
let fichierEnAttente = null;
async function restaurerCentral(texte) {
  if (!AY.can('restaurer')) return;
  try {
    const brut = JSON.parse(texte);
    const o = brut && brut.type === 'ayaan-central' ? brut : await Coffre.lireSauvegarde(texte, $('bkCodeC').value); // 'ayaan-central' en clair : ancienne sauvegarde v14
    if (!o || o.type !== 'ayaan-central' || typeof o.reports !== 'object') throw new Error('fichier non reconnu');
    const reports = {};
    for (const e in o.reports) {
      if (!Array.isArray(o.reports[e])) continue;
      reports[String(e).slice(0, 80)] = o.reports[e].map((x) => nettoyerSite(x, x)).filter(Boolean);
    }
    const zones = {};
    for (const e in o.zones || {})
      if (typeof o.zones[e] === 'string') zones[String(e).slice(0, 80)] = o.zones[e].slice(0, 40);
    ST = { reports, zones };
    save();
    fichierEnAttente = null;
    $('bkCodeCLab').hidden = true;
    $('bkCodeC').value = '';
    $('bmsg').textContent = 'Sauvegarde restaurée.';
    render();
  } catch (x) {
    if (x.besoinCode) {
      fichierEnAttente = texte;
      $('bkCodeCLab').hidden = false;
      $('bkCodeC').focus();
      $('bmsg').textContent =
        "Sauvegarde venant d'un autre ordinateur : entrez son code de secours, puis cliquez « Valider le code ».";
      return;
    }
    $('bmsg').textContent =
      'Restauration impossible : ' + (x instanceof SyntaxError ? 'fichier non reconnu' : x.message) + '.';
  }
}
$('bkf').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  restaurerCentral(await lireTexte(f));
};
$('bkCodeOk').onclick = () => {
  if (fichierEnAttente) restaurerCentral(fichierEnAttente);
};
let armC = false;
$('btnClear').onclick = () => {
  if (!AY.can('effacer')) return;
  if (!armC) {
    armC = true;
    $('btnClear').textContent = 'Confirmer : tout effacer';
    return;
  }
  ST = { reports: {}, zones: {} };
  save();
  SEL = null;
  armC = false;
  $('btnClear').textContent = 'Tout effacer';
  render();
};
$('btnCopyLate').onclick = async () => {
  const x = latest(+$('selFyC').value).find((a) => a.ess === SEL);
  if (!x) return;
  const t = ['N° dossier\tDate probable\tRetard (j)\tProchain RDV ARV']
    .concat((x.lateList || []).map((p) => [p.dos, fr(fromIso(p.due)), p.ret, fr(fromIso(p.rdv))].map(sur).join('\t')))
    .join('\n');
  try {
    await navigator.clipboard.writeText(t);
    msg('info', `Liste de tracking de ${esc(x.ess)} copiée (${(x.lateList || []).length} patients).`);
  } catch (e) {
    $('paste').value = t;
    msg('info', 'Copie refusée : la liste est dans la zone « Coller un rapport ».');
  }
};
try {
  navigator.storage && navigator.storage.persist && navigator.storage.persist();
} catch (e) {}
Coffre.quandErreur((e) =>
  msg('bad', 'Enregistrement chiffré impossible : ' + esc(e.message) + '. Faites une sauvegarde.'),
);
document.addEventListener('ayaan-user', () => render());
render();

/* =====================================================================
   Ayaan · import.js — lecture de l'export Tier.Net (Excel ou CSV)

   - .xlsx / .xls : lu par SheetJS dans un Web Worker (js/excel.worker.js).
     Si la bibliothèque SheetJS n'est pas installée (vendor/xlsx.mini.min.js)
     ou est trop ancienne, Ayaan utilise son lecteur .xlsx intégré.
   - .csv : lu directement (séparateur « ; » ou « , » détecté).
   - Contrôles (OWASP M4) : taille maximale, nombre de lignes maximal,
     type de fichier vérifié par son contenu et pas seulement par son nom.
   Le résultat est toujours un tableau de lignes : [[cellule, cellule…], …]
   ===================================================================== */

import { TAILLE_MAX_IMPORT, LIGNES_MAX_IMPORT, SHEETJS_MIN } from './config.js';
import { lireOctets, decoderTexte } from './fichiers.js';

let travailleur = null; // le Web Worker, créé au premier import Excel puis réutilisé

// Lecture par SheetJS dans le Web Worker
function lireAvecSheetJS(tampon) {
  if (!travailleur) travailleur = new Worker('js/excel.worker.js');
  return new Promise((ok) => {
    const minuterie = setTimeout(() => {
      travailleur.terminate();
      travailleur = null;
      ok({ ok: false, code: 'lecture', erreur: 'lecture trop longue (plus de 60 s)' });
    }, 60000);
    travailleur.onmessage = (e) => {
      clearTimeout(minuterie);
      ok(e.data);
    };
    travailleur.onerror = (e) => {
      clearTimeout(minuterie);
      e.preventDefault();
      travailleur = null;
      ok({ ok: false, code: 'absente', erreur: e.message });
    };
    travailleur.postMessage({ tampon, versionMin: SHEETJS_MIN }, [tampon]); // le tampon est transféré, pas copié
  });
}

/**
 * Lit un fichier choisi par l'utilisateur.
 * @param {File} fichier
 * @returns {Promise<{lignes: Array<Array>, moteur: string}>}
 */
export async function lireFichier(fichier) {
  if (fichier.size > TAILLE_MAX_IMPORT) {
    throw new Error(
      `fichier trop volumineux (${Math.round(fichier.size / 1048576)} Mo ; maximum ${TAILLE_MAX_IMPORT / 1048576} Mo)`,
    );
  }
  const tampon = await lireOctets(fichier); // API standard File / FileReader
  const debut = new Uint8Array(tampon.slice(0, 8));
  const estZip = debut[0] === 0x50 && debut[1] === 0x4b; // .xlsx (archive ZIP)
  const estXlsAncien = debut[0] === 0xd0 && debut[1] === 0xcf; // .xls (ancien format)
  let lignes, moteur;

  if (estZip || estXlsAncien) {
    const r = await lireAvecSheetJS(tampon.slice(0));
    if (r.ok) {
      lignes = r.lignes;
      moteur = 'SheetJS ' + r.version;
    } else if (r.code === 'lecture') throw new Error(r.erreur);
    else if (estXlsAncien)
      throw new Error('ancien format .xls : installez SheetJS (voir LISEZ-MOI) ou enregistrez le fichier en .xlsx');
    else {
      lignes = await lecteurXlsxIntegre(tampon);
      moteur = 'lecteur intégré (' + r.erreur + ')';
    }
  } else {
    // CSV : reconnu par son contenu (sur iPhone, le nom peut arriver sans extension).
    // Encodage UTF-8, ou Windows-1252 pour un CSV enregistré par Excel sous Windows.
    const texte = decoderTexte(tampon);
    const premiere = texte.slice(0, 2000).split(/\r?\n/)[0] || '';
    if (/\u0000/.test(texte.slice(0, 2000)) || !/[;,]/.test(premiere)) {
      throw new Error("ce fichier n'est ni un classeur Excel ni un fichier CSV");
    }
    lignes = lireCsv(texte);
    moteur = 'CSV';
  }
  if (lignes.length > LIGNES_MAX_IMPORT)
    throw new Error(`trop de lignes (${lignes.length} ; maximum ${LIGNES_MAX_IMPORT})`);
  return { lignes, moteur };
}

// Lecteur CSV simple : gère les guillemets et le séparateur ; ou ,
export function lireCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  return lines.map((l) => {
    const out = [];
    let cur = '',
      q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) {
        if (ch == '"' && l[i + 1] == '"') {
          cur += '"';
          i++;
        } else if (ch == '"') q = false;
        else cur += ch;
      } else if (ch == '"') q = true;
      else if (ch === sep) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

// Lecteur .xlsx intégré (sans bibliothèque) : décompresse l'archive avec
// DecompressionStream et lit la première feuille. Sert de solution de repli.
async function lecteurXlsxIntegre(buf) {
  const u8 = new Uint8Array(buf),
    dv = new DataView(buf);
  if (u8[0] !== 0x50 || u8[1] !== 0x4b)
    throw new Error(
      "Ce fichier n'est pas un classeur .xlsx (les anciens fichiers .xls ne sont pas lus : enregistrez-le en .xlsx).",
    );
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Fichier .xlsx endommagé.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const meth = dv.getUint16(p + 10, true),
      csz = dv.getUint32(p + 20, true),
      nl = dv.getUint16(p + 28, true),
      el = dv.getUint16(p + 30, true),
      cl = dv.getUint16(p + 32, true),
      off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    files[name] = { meth, csz, off };
    p += 46 + nl + el + cl;
  }
  async function get(name) {
    const f = files[name];
    if (!f) return null;
    const lnl = dv.getUint16(f.off + 26, true),
      lel = dv.getUint16(f.off + 28, true);
    const data = u8.subarray(f.off + 30 + lnl + lel, f.off + 30 + lnl + lel + f.csz);
    if (f.meth === 0) return td.decode(data);
    const ds = new DecompressionStream('deflate-raw');
    const out = new Response(new Blob([data]).stream().pipeThrough(ds));
    return td.decode(await out.arrayBuffer());
  }
  const ent = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&');
  const ss = [];
  const sx = await get('xl/sharedStrings.xml');
  if (sx) {
    const re = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(sx))) {
      let t = '';
      const rt = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let q;
      while ((q = rt.exec(m[1]))) t += q[1];
      ss.push(ent(t));
    }
  }
  let sheet = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml'),
    rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const s1 = wb.match(/<sheet [^>]*r:id="([^"]+)"/);
    if (s1) {
      const r =
        new RegExp('<Relationship [^>]*Id="' + s1[1] + '"[^>]*Target="([^"]+)"').exec(rels) ||
        new RegExp('<Relationship [^>]*Target="([^"]+)"[^>]*Id="' + s1[1] + '"').exec(rels);
      if (r) {
        let t = r[1].replace(/^\/?xl\//, '').replace(/^\//, '');
        sheet = 'xl/' + t;
      }
    }
  }
  const sx2 = await get(sheet);
  if (!sx2) throw new Error('Feuille introuvable dans le classeur.');
  const col = (ref) => {
    let c = 0;
    for (const ch of ref) {
      const v = ch.charCodeAt(0);
      if (v < 65 || v > 90) break;
      c = c * 26 + (v - 64);
    }
    return c - 1;
  };
  const aoa = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rm,
    ri = 0;
  while ((rm = rowRe.exec(sx2))) {
    const rn = /\br="(\d+)"/.exec(rm[1]);
    const idx = rn ? +rn[1] - 1 : ri;
    ri = idx + 1;
    const row = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(rm[2]))) {
      const at = cm[1],
        body = cm[2] || '';
      const r = /\br="([A-Z]+)\d+"/.exec(at);
      const t = (/\bt="(\w+)"/.exec(at) || [])[1];
      let v = null;
      if (t === 'inlineStr') {
        const q = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
        v = q ? ent(q[1]) : '';
      } else {
        const q = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (q) {
          v = q[1];
          if (t === 's') v = ss[+v];
          else if (t === 'str' || t === 'e') v = ent(v);
          else if (t === 'b') v = v === '1';
          else v = +v;
        }
      }
      row[r ? col(r[1]) : row.length] = v;
    }
    aoa[idx] = row;
  }
  for (let i = 0; i < aoa.length; i++) if (!aoa[i]) aoa[i] = [];
  return aoa;
}

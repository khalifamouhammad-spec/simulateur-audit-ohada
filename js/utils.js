// Fonctions utilitaires : montants, dates, HTML.

// Montants en francs CFA (XOF), sans décimales.
const fmtNombre = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

/** 1234567 -> « 1 234 567 FCFA ». (Nom conservé pour la compatibilité du code.) */
export const euro = (n) => `${fmtNombre.format(Math.round(Number(n) || 0))} FCFA`;
/** Montant sans devise, vide si nul (pour les colonnes débit / crédit). */
export const montantOuVide = (n) => (Math.round(n) ? fmtNombre.format(Math.round(n)) : '');

/** Tous les calculs se font en centimes entiers pour éviter les erreurs d'arrondi. */
export const enCentimes = (n) => Math.round((Number(n) || 0) * 100);
export const enEuros = (c) => c / 100;

/** Lit un nombre saisi à la française (« 1 234,56 »). */
export function lireNombre(texte) {
  if (typeof texte === 'number') return texte;
  const n = parseFloat(String(texte ?? '').replace(/F\s?CFA|FCFA/gi, '').replace(/[\s  €]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export const estDateISO = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
/** « 2025-12-31 » -> « 31/12/2025 » */
export const dateFr = (d) => (estDateISO(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
export function ajouterJours(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export const ecartJours = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export const echapper = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const identifiant = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function aleatoire(graine) {
  let a = graine >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rnd.entier = (min, max) => min + Math.floor(rnd() * (max - min + 1));
  rnd.choix = (liste) => liste[Math.floor(rnd() * liste.length)];
  rnd.melanger = (liste) => {
    const l = [...liste];
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  };
  return rnd;
}

/** Propose un fichier texte au téléchargement. */
export function telecharger(nom, contenu, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenu], { type }));
  const lien = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.append(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Variation en % entre deux montants (null si la base est nulle). */
export const variationPct = (n, n1) => (n1 ? ((n - n1) / Math.abs(n1)) * 100 : null);
export const pctFr = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1).replace('.', ',')} %`);

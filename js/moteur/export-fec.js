// Export du journal général au format CSV (séparateur point-virgule, lisible par un tableur) :
// une ligne par mouvement, dates JJ/MM/AAAA, montants en francs CFA sans décimales.
import { COL } from './plan.js';

export const ENTETES_EXPORT = ['Journal', 'Libellé journal', 'N° écriture', 'Date', 'Compte', 'Libellé compte', 'Compte tiers', 'Libellé tiers', 'Pièce', 'Date pièce', 'Libellé', 'Débit', 'Crédit', 'Lettrage', 'Date lettrage', 'Saisi par'];
const COLONNES = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'Utilisateur'];
const DATES = new Set(['EcritureDate', 'PieceDate', 'DateLet']);

const date = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const champ = (v) => { const t = String(v ?? '').replace(/[\r\n]+/g, ' '); return /[;"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export function fecVersTexte(lignes) {
  const sortie = [ENTETES_EXPORT.join(';')];
  for (const l of lignes) {
    sortie.push(COLONNES.map((col) => {
      const v = l[COL[col]];
      if (DATES.has(col)) return date(v);
      if (col === 'Debit' || col === 'Credit') return String(Math.round(v));
      return champ(v);
    }).join(';'));
  }
  return '﻿' + sortie.join('\r\n') + '\r\n'; // BOM pour l'ouverture correcte des accents dans un tableur
}

export const nomFichierFec = (ninea, cloture) => `journal-general_${ninea}_${cloture.slice(0, 4)}.csv`;

// Lecture d'un fichier des écritures comptables fourni par l'utilisateur : FEC réglementaire
// (18 colonnes), export CSV du journal général, ou variantes courantes. Module de calcul pur.
//
// Formats reconnus :
//   - séparateur tabulation, point-virgule, barre verticale ou virgule (détecté sur l'en-tête) ;
//   - colonnes Débit / Crédit, ou Montant + Sens (D / C) ;
//   - dates AAAAMMJJ, JJ/MM/AAAA, AAAA-MM-JJ ;
//   - montants avec virgule ou point décimal, espaces de milliers.
// Renvoie les lignes au format interne (voir COL dans plan.js) et un rapport de contrôle.
import { COL, JOURNAUX, PLAN } from './plan.js';

// Noms de colonnes acceptés (normalisés : minuscules, sans accents ni ponctuation).
const SYNONYMES = {
  JournalCode: ['journalcode', 'journal', 'codejournal', 'jal', 'jnl'],
  JournalLib: ['journallib', 'libellejournal', 'journallibelle', 'libjournal'],
  EcritureNum: ['ecriturenum', 'necriture', 'numecriture', 'numeroecriture', 'noecriture', 'numero', 'ecriture'],
  EcritureDate: ['ecrituredate', 'date', 'dateecriture', 'datecomptable'],
  CompteNum: ['comptenum', 'compte', 'numerocompte', 'numcompte', 'comptegeneral', 'nocompte', 'ncompte', 'codecompte', 'comptegene'],
  CompteLib: ['comptelib', 'libellecompte', 'intitulecompte', 'libcompte'],
  CompAuxNum: ['compauxnum', 'comptetiers', 'compteauxiliaire', 'auxiliaire', 'compteaux', 'tiers'],
  CompAuxLib: ['compauxlib', 'libelletiers', 'libelleauxiliaire', 'nomtiers'],
  PieceRef: ['pieceref', 'piece', 'reference', 'refpiece', 'numeropiece', 'npiece'],
  PieceDate: ['piecedate', 'datepiece'],
  EcritureLib: ['ecriturelib', 'libelle', 'libelleecriture', 'lib', 'designation'],
  Debit: ['debit', 'montantdebit'],
  Credit: ['credit', 'montantcredit'],
  Montant: ['montant'],
  Sens: ['sens'],
  EcritureLet: ['ecriturelet', 'lettrage', 'lettre', 'codelettrage'],
  DateLet: ['datelet', 'datelettrage'],
  ValidDate: ['validdate', 'datevalidation'],
  Montantdevise: ['montantdevise'],
  Idevise: ['idevise', 'devise'],
  Utilisateur: ['utilisateur', 'saisipar', 'auteur'],
};
const normaliser = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Décode le contenu d'un fichier (UTF-8, sinon Windows-1252, fréquent pour les FEC). */
export function decoder(octets) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(octets); } catch { return new TextDecoder('windows-1252').decode(octets); }
}

function lireDate(v) {
  const t = String(v ?? '').trim();
  let m;
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
const dateValide = (d) => !!d && !Number.isNaN(Date.parse(d)) && new Date(d + 'T00:00:00Z').toISOString().startsWith(d);

function lireMontant(v) {
  let t = String(v ?? '').replace(/[\s  ]|FCFA|EUR|€/gi, '');
  if (!t) return 0;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Découpe une ligne CSV en respectant les guillemets. */
function decouper(ligne, sep) {
  if (sep === '\t' || !ligne.includes('"')) return ligne.split(sep);
  const champs = []; let champ = ''; let guillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const ch = ligne[i];
    if (guillemets) {
      if (ch === '"' && ligne[i + 1] === '"') { champ += '"'; i++; } else if (ch === '"') guillemets = false; else champ += ch;
    } else if (ch === '"') guillemets = true;
    else if (ch === sep) { champs.push(champ); champ = ''; } else champ += ch;
  }
  champs.push(champ);
  return champs;
}

/**
 * texte : contenu du fichier. Renvoie { lignes, erreurs, avertissements, resume }.
 * erreurs : bloquantes (le fichier n'est pas importable) ; avertissements : à signaler.
 */
export function lireFichierEcritures(texte) {
  const erreurs = []; const avertissements = [];
  const brutes = texte.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (brutes.length < 2) return { lignes: [], erreurs: ['Le fichier est vide ou ne contient pas de lignes d\'écritures.'], avertissements, resume: null };
  const entete = brutes[0];
  const sep = ['\t', ';', '|', ','].map((s) => [s, entete.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const colonnes = decouper(entete, sep).map(normaliser);
  const position = {};
  for (const [cle, noms] of Object.entries(SYNONYMES)) {
    const i = colonnes.findIndex((c) => noms.includes(c));
    if (i >= 0) position[cle] = i;
  }
  const manquantes = ['JournalCode', 'EcritureDate', 'CompteNum'].filter((k) => position[k] == null);
  const sansMontant = position.Debit == null && position.Credit == null && position.Montant == null;
  if (manquantes.length || sansMontant) {
    erreurs.push(`Colonnes introuvables dans l'en-tête : ${[...manquantes, ...(sansMontant ? ['Debit / Credit (ou Montant et Sens)'] : [])].join(', ')}. En-tête lu : « ${entete.slice(0, 160)} ».`);
    return { lignes: [], erreurs, avertissements, resume: null };
  }
  const lignes = [];
  let datesInvalides = 0; let montantsInvalides = 0; let sansNumero = 0;
  brutes.slice(1).forEach((brute, i) => {
    const v = decouper(brute, sep);
    const champ = (cle) => (position[cle] == null ? '' : String(v[position[cle]] ?? '').trim());
    const date = lireDate(champ('EcritureDate'));
    if (!dateValide(date)) { datesInvalides++; if (datesInvalides <= 3) erreurs.push(`Ligne ${i + 2} : date d'écriture illisible « ${champ('EcritureDate')} ».`); return; }
    let debit; let credit;
    if (position.Debit != null || position.Credit != null) { debit = lireMontant(champ('Debit')); credit = lireMontant(champ('Credit')); }
    else { const m = lireMontant(champ('Montant')); const sens = champ('Sens').toUpperCase(); debit = /^(D|\+|1)/.test(sens) ? m : 0; credit = /^(C|-|-1)/.test(sens) ? m : 0; }
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) { montantsInvalides++; if (montantsInvalides <= 3) erreurs.push(`Ligne ${i + 2} : montant illisible ou négatif.`); return; }
    if (debit === 0 && credit === 0) return; // ligne à zéro : ignorée
    const journal = champ('JournalCode').toUpperCase() || 'OD';
    const compte = champ('CompteNum').replace(/\s/g, '');
    let num = champ('EcritureNum');
    const piece = champ('PieceRef');
    if (!num) { sansNumero++; num = `${journal}-${date}-${piece || 'SP'}`; }
    const ligne = new Array(20).fill('');
    ligne[COL.JournalCode] = journal;
    ligne[COL.JournalLib] = champ('JournalLib') || JOURNAUX[journal] || journal;
    ligne[COL.EcritureNum] = num;
    ligne[COL.EcritureDate] = date;
    ligne[COL.CompteNum] = compte;
    ligne[COL.CompteLib] = champ('CompteLib') || PLAN[compte] || PLAN[compte.slice(0, 6).padEnd(6, '0')] || '';
    ligne[COL.CompAuxNum] = champ('CompAuxNum');
    ligne[COL.CompAuxLib] = champ('CompAuxLib') || champ('CompAuxNum');
    ligne[COL.PieceRef] = piece || num;
    ligne[COL.PieceDate] = (dateValide(lireDate(champ('PieceDate'))) && lireDate(champ('PieceDate'))) || date;
    ligne[COL.EcritureLib] = champ('EcritureLib');
    ligne[COL.Debit] = Math.round(debit * 100) / 100;
    ligne[COL.Credit] = Math.round(credit * 100) / 100;
    ligne[COL.EcritureLet] = champ('EcritureLet');
    ligne[COL.DateLet] = (champ('EcritureLet') && lireDate(champ('DateLet'))) || '';
    ligne[COL.ValidDate] = lireDate(champ('ValidDate')) || date;
    ligne[COL.Montantdevise] = champ('Montantdevise');
    ligne[COL.Idevise] = champ('Idevise');
    ligne[COL.Utilisateur] = champ('Utilisateur') || 'IMPORT';
    ligne[COL.DateSaisie] = date;
    lignes.push(ligne);
  });
  if (datesInvalides > 3) erreurs.push(`… ${datesInvalides} lignes au total ont une date illisible.`);
  if (montantsInvalides > 3) erreurs.push(`… ${montantsInvalides} lignes au total ont un montant illisible.`);
  if (sansNumero) avertissements.push(`${sansNumero} ligne(s) sans numéro d'écriture : les écritures ont été regroupées par journal, date et pièce.`);
  if (!lignes.length && !erreurs.length) erreurs.push('Aucune ligne d\'écriture avec un montant n\'a été trouvée.');

  // Équilibre : global (bloquant) et par écriture (avertissement)
  const c = (n) => Math.round(n * 100);
  const totalD = lignes.reduce((s, l) => s + c(l[COL.Debit]), 0);
  const totalC = lignes.reduce((s, l) => s + c(l[COL.Credit]), 0);
  if (totalD !== totalC) erreurs.push(`Le fichier n'est pas équilibré : total des débits ${(totalD / 100).toLocaleString('fr-FR')}, total des crédits ${(totalC / 100).toLocaleString('fr-FR')}.`);
  const parEcriture = new Map();
  for (const l of lignes) parEcriture.set(l[COL.EcritureNum], (parEcriture.get(l[COL.EcritureNum]) || 0) + c(l[COL.Debit]) - c(l[COL.Credit]));
  const desequilibrees = [...parEcriture].filter(([, s]) => s !== 0).map(([n]) => n);
  if (desequilibrees.length) avertissements.push(`${desequilibrees.length} écriture(s) déséquilibrée(s), par exemple ${desequilibrees.slice(0, 3).join(', ')} : à analyser, c'est peut-être une anomalie.`);
  const tiersSansAux = lignes.filter((l) => /^4(01|11)/.test(l[COL.CompteNum]) && !l[COL.CompAuxNum]).length;
  if (tiersSansAux) avertissements.push(`${tiersSansAux} ligne(s) sur des comptes clients ou fournisseurs sans compte auxiliaire : la balance âgée, le lettrage et la circularisation seront incomplets.`);

  const dates = lignes.map((l) => l[COL.EcritureDate]).sort();
  const resume = lignes.length ? { nbLignes: lignes.length, nbEcritures: parEcriture.size, debut: dates[0], fin: dates[dates.length - 1], totalDebit: totalD / 100, journaux: [...new Set(lignes.map((l) => l[COL.JournalCode]))] } : null;
  return { lignes: erreurs.length ? [] : lignes, erreurs, avertissements, resume };
}

/** Bornes d'exercice déduites des dates : du 1er jour du premier mois au dernier jour du dernier mois. */
export function exerciceDepuis(resume) {
  const fin = new Date(Date.UTC(Number(resume.fin.slice(0, 4)), Number(resume.fin.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { debut: `${resume.debut.slice(0, 7)}-01`, cloture: fin };
}

/** Tiers déduits du fichier (comptes auxiliaires clients et fournisseurs). */
export function tiersDepuis(lignes) {
  const clients = new Map(); const fournisseurs = new Map();
  for (const l of lignes) {
    const num = l[COL.CompAuxNum];
    if (!num) continue;
    if (/^41/.test(l[COL.CompteNum])) clients.set(num, { num, nom: l[COL.CompAuxLib] || num, delai: 30 });
    else if (/^4(0|81)/.test(l[COL.CompteNum])) fournisseurs.set(num, { num, nom: l[COL.CompAuxLib] || num, compteCharge: '', mode: 'virement' });
  }
  return { clients: [...clients.values()], fournisseurs: [...fournisseurs.values()] };
}

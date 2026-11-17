// Tests de l'import d'un fichier des écritures : node tests/test-import.mjs
// Aller-retour export → import, variantes de format, fichiers refusés, notation sans corrigé.
import { TAILLES, SECTEURS } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { calculerEtats } from '../js/moteur/compta.js';
import { fecVersTexte } from '../js/moteur/export-fec.js';
import { lireFichierEcritures, decoder, exerciceDepuis, tiersDepuis } from '../js/moteur/import-fec.js';
import { evaluerMission } from '../js/correction.js';
import { COL } from '../js/moteur/plan.js';

let echecs = 0; let nb = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 25) console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const secteur of Object.keys(SECTEURS)) for (const taille of ['tpe', 'pme']) {
  const nom = `${secteur}/${taille}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille, difficulte: 'intermediaire', nbAnomalies: 8, graine: secteur.length * 7919 + taille.length, nomParDefaut: 'X', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES[taille].lignesFec, annee: 2025 });
  nb++;
  for (const ex of ['N', 'N-1']) {
    const origine = r.fec[ex];
    const lu = lireFichierEcritures(fecVersTexte(origine));
    verifier(!lu.erreurs.length, `${nom} ${ex} : export non relu (${lu.erreurs.join(' | ')})`);
    verifier(lu.lignes.length === origine.length, `${nom} ${ex} : ${lu.lignes.length} lignes relues pour ${origine.length}`);
    const champs = ['JournalCode', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompAuxNum', 'PieceRef', 'PieceDate', 'EcritureLet'];
    const ecarts = origine.filter((l, i) => !lu.lignes[i] || champs.some((k) => String(lu.lignes[i][COL[k]]) !== String(l[COL[k]])) || c(lu.lignes[i][COL.Debit]) !== c(l[COL.Debit]) || c(lu.lignes[i][COL.Credit]) !== c(l[COL.Credit]));
    verifier(!ecarts.length, `${nom} ${ex} : ${ecarts.length} ligne(s) différente(s) après aller-retour`);
    const a = calculerEtats(origine).agregats; const b = calculerEtats(lu.lignes).agregats;
    verifier(memes(a, b), `${nom} ${ex} : états différents après import`);
    if (ex === 'N') {
      const exo = exerciceDepuis(lu.resume);
      verifier(exo.debut === '2025-01-01' && exo.cloture === '2025-12-31', `${nom} : exercice déduit ${exo.debut} – ${exo.cloture}`);
      const t = tiersDepuis(lu.lignes);
      verifier(t.clients.length > 0 && t.fournisseurs.length > 0, `${nom} : tiers non déduits`);
    }
  }
}

// Variantes de format : barre verticale, Montant + Sens, dates JJ/MM/AAAA, guillemets, Windows-1252, sans numéro d'écriture
{
  const texte = ['Code journal|Date|N° compte|Libellé|Tiers|Montant|Sens|Pièce',
    'VE|15/03/2025|411000|"Facture ""A"" Dupont"|C001|1 200,00|D|F1',
    'VE|15/03/2025|706000|Facture Dupont||1 000,00|C|F1',
    'VE|15/03/2025|445710|TVA||200,00|C|F1',
    'BQ|20/03/2025|512100|Règlement Dupont||1200|D|R1',
    'BQ|20/03/2025|411000|Règlement Dupont|C001|1200|C|R1'].join('\r\n');
  const octets = new Uint8Array([...texte].map((ch) => ({ 'è': 0xe8, 'é': 0xe9, '°': 0xb0 }[ch] ?? ch.charCodeAt(0))));
  const lu = lireFichierEcritures(decoder(octets));
  verifier(!lu.erreurs.length && lu.lignes.length === 5, `variante : ${lu.erreurs.join(' | ')} (${lu.lignes.length} lignes)`);
  verifier(lu.lignes[0][COL.EcritureLib] === 'Facture "A" Dupont' && lu.lignes[0][COL.EcritureDate] === '2025-03-15' && lu.lignes[0][COL.Debit] === 1200, 'variante : champ mal lu');
  verifier(lu.lignes[3][COL.EcritureLib] === 'Règlement Dupont', `variante : accents Windows-1252 mal décodés (${lu.lignes[3][COL.EcritureLib]})`);
  verifier(lu.avertissements.some((a) => /sans numéro/.test(a)) && new Set(lu.lignes.map((l) => l[COL.EcritureNum])).size === 2, 'variante : regroupement des écritures sans numéro');
}
// Fichiers refusés
{
  const deseq = lireFichierEcritures('JournalCode\tEcritureNum\tEcritureDate\tCompteNum\tDebit\tCredit\nOD\t1\t20250101\t601000\t100,00\t0\nOD\t1\t20250101\t401000\t0\t90,00');
  verifier(deseq.erreurs.some((e) => /pas équilibré/.test(e)) && !deseq.lignes.length, 'fichier déséquilibré accepté');
  const colonnes = lireFichierEcritures('Date;Libellé;Montant\n01/01/2025;Test;100');
  verifier(colonnes.erreurs.some((e) => /Colonnes introuvables/.test(e)), 'colonnes manquantes non signalées');
  const date = lireFichierEcritures('JournalCode;EcritureNum;EcritureDate;CompteNum;Debit;Credit\nOD;1;32/13/2025;601000;100;0\nOD;1;01/01/2025;401000;0;100');
  verifier(date.erreurs.some((e) => /date/.test(e)), 'date invalide non signalée');
  verifier(lireFichierEcritures('').erreurs.length === 1, 'fichier vide non signalé');
}
// Notation d'un dossier importé : pas de corrigé, détection exclue
{
  const { scenario, choix } = scenarioHorsLigne({ secteur: 'commerce', taille: 'tpe', difficulte: 'debutant', nbAnomalies: 3, graine: 99, nomParDefaut: 'X', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: 2000, annee: 2025 });
  const dossier = { client: scenario.client, scenario: { graine: 1, source: 'import' }, parametres: { secteur: 'commerce' }, chiffres: { N: calculerEtats(r.fec.N).agregats }, exercice: { cloture: '2025-12-31' }, elements: {},
    ajustements: [{ id: 'A1', cycle: 'ventes', description: 'x', references: [], lignes: [{ compte: '706000', debit: '1000' }, { compte: '411000', credit: '1000' }], decision: 'non_corrigee' }] };
  const ev = evaluerMission({ dossier, corrige: undefined, feuilles: [], documents: [], revue: { significatifs: [] } });
  verifier(ev.importe && !ev.sections.detection && Number.isFinite(ev.globale) && ev.globale >= 0 && ev.globale <= 20, `notation sans corrigé : ${JSON.stringify({ importe: ev.importe, globale: ev.globale, sections: Object.keys(ev.sections) })}`);
  verifier(ev.sections.finalisation.opinion.appropriee === ev.sections.finalisation.opinion.coherente, 'opinion appropriée inventée sans corrigé');
}
console.log(`${nb} dossiers exportés puis réimportés (N et N-1), variantes de format et fichiers refusés contrôlés.`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

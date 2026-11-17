// Tests du moteur FEC : node tests/test-fec.mjs
// Génère des clients pour tous les secteurs, tailles et difficultés et contrôle la cohérence :
// écritures équilibrées, numérotation, lettrage, bilan équilibré, résultat identique au bilan
// et au compte de résultat, à-nouveaux de N égaux à la clôture de N-1, export réglementaire.
import { TAILLES, SECTEURS, NIVEAUX } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { verifierFec, calculerBalance, calculerEtats } from '../js/moteur/compta.js';
import { fecVersTexte } from '../js/moteur/export-fec.js';
import { COL } from '../js/moteur/plan.js';
import { BIBLIOTHEQUE } from '../js/moteur/anomalies.js';
import { euro } from '../js/utils.js';

const ANNEE = 2025;
let echecs = 0; let nb = 0;
const vues = new Set();
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 40) console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
const graines = Number(process.argv[2]) || 6;

for (const secteur of Object.keys(SECTEURS)) for (const taille of Object.keys(TAILLES)) for (const difficulte of Object.keys(NIVEAUX)) for (let g = 1; g <= graines; g++) {
  const nom = `${secteur}/${taille}/${difficulte}/#${g}`;
  const nbAnomalies = 3 + ((g * 5) % 10);
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille, difficulte, nbAnomalies, graine: g * 7919 + secteur.length, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  let r;
  try { r = genererComptabilite(scenario, choix, { lignesCible: TAILLES[taille].lignesFec, annee: ANNEE }); }
  catch (e) { echecs++; console.error(`  ÉCHEC ${nom} : exception ${e.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
  nb++;
  const etats = {};
  for (const [ex, annee] of [['N-1', ANNEE - 1], ['N', ANNEE]]) {
    const lignes = r.fec[ex];
    const v = verifierFec(lignes, { debut: `${annee}-01-01`, fin: `${annee}-12-31` });
    verifier(!v.erreurs.length, `${nom} ${ex} : ${v.erreurs.slice(0, 3).join(' | ')}`);
    const e = etats[ex] = calculerEtats(lignes);
    verifier(e.controles.bilanEquilibre, `${nom} ${ex} : bilan déséquilibré (${e.totalActif} / ${e.totalPassif})`);
    verifier(e.controles.resultatIdentique, `${nom} ${ex} : résultat bilan ${e.controles.resultatBilan} ≠ compte de résultat ${e.controles.resultatCompteDeResultat}`);
    const b = calculerBalance(lignes);
    verifier(b.reduce((s, l) => s + c(l.debit) - c(l.credit), 0) === 0, `${nom} ${ex} : balance déséquilibrée`);
    const banque = b.find((l) => l.compte === '521000');
    verifier(banque && banque.soldeCrediteur === 0, `${nom} ${ex} : banque créditrice à la clôture`);
    const caisse = b.find((l) => l.compte === '571000');
    verifier(caisse && caisse.soldeCrediteur === 0, `${nom} ${ex} : caisse créditrice`);
    verifier(lignes.length >= 1500 && lignes.length <= 11500, `${nom} ${ex} : ${lignes.length} lignes`);
    verifier(lignes.every((l) => l.length === 20), `${nom} ${ex} : ligne mal formée`);
    for (const j of ['AN', 'VE', 'AC', 'BQ', 'PA', 'OD']) verifier(lignes.some((l) => l[COL.JournalCode] === j), `${nom} ${ex} : journal ${j} absent`);
    // Export : 18 colonnes, relecture des montants
    const texte = fecVersTexte(lignes).replace(/^\ufeff/, '').replace(/\r\n$/, '').split('\r\n');
    verifier(texte.length === lignes.length + 1 && texte.every((t) => t.split(';').length >= 16), `${nom} ${ex} : export mal formé`);
    const relu = lignes.reduce((s, l) => s + c(Math.round(l[COL.Debit])) - c(Math.round(l[COL.Credit])), 0);
    verifier(relu === 0 && /^\d{2}\/\d{2}\/\d{4}$/.test(texte[1].split(';')[3]) && lignes.every((l) => Number.isInteger(l[COL.Debit]) && Number.isInteger(l[COL.Credit])), `${nom} ${ex} : export déséquilibré, date mal formatée ou montant non entier en FCFA`);
    // Activité plausible
    const ag = e.agregats;
    verifier(ag.chiffreAffaires > 0 && ag.totalBilan > 0 && ag.capitauxPropres > 0, `${nom} ${ex} : agrégats incohérents`);
    if (ex === 'N-1') verifier(Math.abs(ag.resultatNet) < ag.produitsExploitation * 0.2, `${nom} ${ex} : résultat ${euro(ag.resultatNet)} hors de proportion avec les produits ${euro(ag.produitsExploitation)}`);
  }
  // Les à-nouveaux de N reprennent exactement le bilan de clôture de N-1
  const cloture = new Map(); const ouverture = new Map();
  for (const l of r.fec['N-1']) if (!/^[678]/.test(l[COL.CompteNum])) { const k = `${l[COL.CompteNum]}|${l[COL.CompAuxNum]}`; cloture.set(k, (cloture.get(k) || 0) + c(l[COL.Debit]) - c(l[COL.Credit])); }
  for (const l of r.fec.N) if (l[COL.JournalCode] === 'AN' && !/^13/.test(l[COL.CompteNum])) { const k = `${l[COL.CompteNum]}|${l[COL.CompAuxNum]}`; ouverture.set(k, (ouverture.get(k) || 0) + c(l[COL.Debit]) - c(l[COL.Credit])); }
  let ecartAN = 0;
  for (const k of new Set([...cloture.keys(), ...ouverture.keys()])) ecartAN += Math.abs((cloture.get(k) || 0) - (ouverture.get(k) || 0));
  verifier(ecartAN === 0, `${nom} : à-nouveaux N ≠ clôture N-1 (écart ${ecartAN / 100})`);
  const resultatAN = r.fec.N.filter((l) => l[COL.JournalCode] === 'AN' && /^13/.test(l[COL.CompteNum])).reduce((s, l) => s + c(l[COL.Credit]) - c(l[COL.Debit]), 0);
  verifier(resultatAN === c(etats['N-1'].agregats.resultatNet), `${nom} : résultat N-1 repris en à-nouveaux incorrect`);
  // Anomalies
  verifier(r.anomalies.length + r.echecs.length === nbAnomalies, `${nom} : ${r.anomalies.length} anomalies + ${r.echecs.length} échecs pour ${nbAnomalies} demandées`);
  verifier(r.anomalies.length >= Math.min(nbAnomalies, 3) - 1, `${nom} : trop d'anomalies non placées (${r.echecs.join(', ')})`);
  const numeros = { N: new Set(r.fec.N.map((l) => l[COL.EcritureNum])), 'N-1': new Set(r.fec['N-1'].map((l) => l[COL.EcritureNum])) };
  for (const a of r.anomalies) {
    vues.add(a.type);
    verifier(a.montant > 0 && a.explication && a.procedure && a.correction && !/NaN|undefined/.test(a.explication + a.correction), `${nom} : anomalie ${a.type} mal chiffrée ou mal décrite`);
    verifier(a.ecritures.every((e) => numeros[e.exercice].has(e.num)), `${nom} : anomalie ${a.type} renvoie à une écriture absente du FEC`);
  }
  if (g === 1 && difficulte === 'intermediaire') {
    const a = etats.N.agregats; const p = etats['N-1'].agregats;
    console.log(`${nom.padEnd(36)} ${String(r.fec.N.length).padStart(5)} lignes | CA N ${euro(a.chiffreAffaires)} (N-1 ${euro(p.chiffreAffaires)}) | résultat ${euro(a.resultatNet)} | bilan ${euro(a.totalBilan)} | ${r.anomalies.length} anomalies`);
  }
}
const jamais = Object.keys(BIBLIOTHEQUE).filter((t) => !vues.has(t));
verifier(!jamais.length, `types d'anomalies jamais injectés : ${jamais.join(', ')}`);
console.log(`\n${nb} clients générés, ${vues.size}/${Object.keys(BIBLIOTHEQUE).length} types d'anomalies exercés.`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

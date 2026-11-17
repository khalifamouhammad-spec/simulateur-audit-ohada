// Tests des documents bancaires, des pièces et de l'échantillonnage : node tests/test-banque.mjs
import { TAILLES, SECTEURS, NIVEAUX } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { construireBanque } from '../js/moteur/banque.js';
import { ecritureDepuisFec, construirePiece } from '../js/moteur/pieces.js';
import { echantillonner } from '../js/moteur/echantillon.js';
import { COL } from '../js/moteur/plan.js';

let echecs = 0; let nb = 0; let pieces = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 30) console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
const typesVus = new Set();
for (const secteur of Object.keys(SECTEURS)) for (const taille of Object.keys(TAILLES)) for (const difficulte of Object.keys(NIVEAUX)) for (let g = 1; g <= 3; g++) {
  const nom = `${secteur}/${taille}/${difficulte}/#${g}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille, difficulte, nbAnomalies: 12, graine: g * 15485863 + taille.length, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES[taille].lignesFec, annee: 2025 });
  const dossier = { client: { ...scenario.client, secteur }, scenario: { graine: scenario.graine }, parametres: { secteur, difficulte }, seuilAutorisation: r.seuilAutorisation };
  nb++;
  // --- Banque ---
  const b = construireBanque(r.fec.N, r.donnees, { graine: scenario.graine, annee: 2025, difficulte });
  const rap = b.rapprochement;
  verifier(b.boucle, `${nom} : le rapprochement réel ne boucle pas`);
  const soldeFec = r.fec.N.filter((l) => l[COL.CompteNum] === '521000').reduce((s, l) => s + c(l[COL.Debit]) - c(l[COL.Credit]), 0);
  verifier(c(rap.soldeCompta) === soldeFec, `${nom} : solde comptable du rapprochement ≠ FEC`);
  let solde = c(b.soldeOuverture);
  for (const l of b.lignes) { solde += c(l.montant); verifier(solde === c(l.solde), `${nom} : solde progressif du relevé faux`); }
  const dernierDecembre = b.lignes.filter((l) => l.date <= '2025-12-31').pop();
  verifier(c(dernierDecembre.solde) === c(rap.soldeBanque), `${nom} : solde du relevé au 31/12 ≠ rapprochement`);
  const nc = (r.donnees.banque.nonComptabilises || []).reduce((s, x) => s + x.montant, 0);
  verifier(c(rap.ecart) === (difficulte === 'confirme' ? nc : 0), `${nom} : écart du rapprochement inattendu (${rap.ecart})`);
  verifier(rap.coteBanque.filter((x) => x.ancien).length === r.donnees.banque.chequesNonDebites.length, `${nom} : chèque ancien absent du rapprochement`);
  verifier(b.lignes.filter((l) => l.nonComptabilise).length === r.donnees.banque.nonComptabilises.length, `${nom} : opération non comptabilisée absente du relevé`);
  verifier(rap.coteBanque.filter((x) => !x.ancien).every((x) => b.lignes.some((l) => l.id === x.id && l.date >= '2026-01-01' && l.date <= '2026-01-31')), `${nom} : suspens non apuré sur le relevé de janvier`);
  // --- Pièces : une pièce pour chaque écriture d'anomalie et pour un échantillon de chaque journal ---
  const demander = (exercice, num, anomalies) => {
    const ecriture = ecritureDepuisFec(r.fec[exercice], num);
    if (!ecriture) { verifier(false, `${nom} : écriture ${num} (${exercice}) introuvable — anomalies ${anomalies.map((x) => x.type)}`); return null; }
    const d = construirePiece(ecriture, { dossier, exercice, anomalies, donnees: r.donnees });
    pieces++;
    const texte = JSON.stringify(d);
    verifier(d.titre && d.lignes.length && !/undefined|NaN|null,/.test(texte.replace(/"totaux":null/g, '')), `${nom} : pièce mal formée pour ${num} (${d.type})`);
    if (d.totaux) verifier(c(d.totaux.ht) + c(d.totaux.tva) === c(d.totaux.ttc), `${nom} : pièce ${num} : HT + TVA ≠ TTC`);
    return d;
  };
  for (const a of r.anomalies) for (const e of a.ecritures) { demander(e.exercice, e.num, [a]); typesVus.add(a.type); }
  for (const j of ['AN', 'VE', 'AC', 'BQ', 'PA', 'OD']) for (const num of new Set(r.fec.N.filter((l) => l[COL.JournalCode] === j).slice(0, 40).map((l) => l[COL.EcritureNum]))) demander('N', num, []);
  // --- Échantillonnage ---
  const population = r.fec.N.filter((l) => l[COL.CompteNum] === '521000');
  const valeur = (l) => l[COL.Debit] || l[COL.Credit];
  for (const methode of ['aleatoire', 'montant', 'eleves']) {
    const e = echantillonner(population, methode, 25, valeur, g);
    verifier(e.length > 0 && e.length <= 25 && new Set(e).size === e.length, `${nom} : échantillon ${methode} invalide (${e.length})`);
  }
  const eleves = echantillonner(population, 'eleves', 5, valeur);
  verifier(Math.min(...eleves.map(valeur)) >= [...population].map(valeur).sort((x, y) => y - x)[4], `${nom} : les montants élevés ne sont pas les plus élevés`);
}
console.log(`${nb} clients : rapprochements, relevés, ${pieces} pièces (${typesVus.size} types d'anomalies) et sondages contrôlés.`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

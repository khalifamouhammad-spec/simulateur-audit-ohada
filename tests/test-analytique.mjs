// Tests de la revue analytique : node tests/test-analytique.mjs
import { TAILLES, SECTEURS } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { calculerEtats } from '../js/moteur/compta.js';
import { revueAnalytique } from '../js/moteur/analytique.js';

let echecs = 0; let nb = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
for (const secteur of Object.keys(SECTEURS)) for (const taille of Object.keys(TAILLES)) for (let g = 1; g <= 4; g++) {
  const nom = `${secteur}/${taille}/#${g}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille, difficulte: 'intermediaire', nbAnomalies: 8, graine: g * 104729, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES[taille].lignesFec, annee: 2025 });
  const e = calculerEtats(r.fec.N);
  const seuil = e.agregats.produitsExploitation * 0.01;
  const a = revueAnalytique(r.fec.N, r.fec['N-1'], seuil);
  nb++;
  verifier(c(a.mensuel.reduce((s, m) => s + m.caN, 0)) === c(e.agregats.chiffreAffaires), `${nom} : la somme des CA mensuels ≠ CA annuel`);
  const total = (nature) => c(a.postes.filter((p) => p.nature === nature).reduce((s, p) => s + p.n, 0));
  verifier(total('Actif') === c(e.totalActif) && total('Passif') === c(e.totalPassif) && total('Résultat') === c(e.agregats.resultatNet), `${nom} : les postes ne recoupent pas les états financiers`);
  verifier(a.postes.every((p) => c(p.variation) === c(p.n) - c(p.n1)), `${nom} : variation mal calculée`);
  verifier(a.ratios.every((x) => (x.n == null || Number.isFinite(x.n)) && (x.n1 == null || Number.isFinite(x.n1))), `${nom} : ratio non fini`);
  const ratio = (id) => a.ratios.find((x) => x.id === 'ratio_' + id);
  verifier(ratio('margeBrute').n > 0 && ratio('margeBrute').n <= 1, `${nom} : taux de marge invraisemblable (${ratio('margeBrute').n})`);
  verifier(Math.abs(ratio('chargesSociales').n1 - 0.21) < 0.02, `${nom} : taux de charges sociales N-1 inattendu (${ratio('chargesSociales').n1})`);
  verifier(Math.abs(ratio('tva').n1 - 0.18) < 0.005, `${nom} : TVA facturée / CA N-1 incohérente (${ratio('tva').n1})`);
  // Une anomalie de charges sociales non rattachées doit ressortir sur le mois de décembre
  if (r.anomalies.some((x) => x.type === 'charges_sociales_non_rattachees')) verifier(a.mensuel[11].significatif && a.mensuel[11].tauxSocialN === 0, `${nom} : décembre non signalé malgré l'anomalie de charges sociales`);
  if (g === 1 && taille === 'pme') console.log(`${nom.padEnd(22)} ${a.postes.filter((p) => p.significatif).length} postes, ${a.ratios.filter((x) => x.significatif).length} ratios et ${a.mensuel.filter((m) => m.significatif).length} mois signalés | marge ${(ratio('margeBrute').n * 100).toFixed(1)} % | crédit clients ${Math.round(ratio('delaiClients').n)} j`);
}
console.log(`\n${nb} revues analytiques contrôlées.`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

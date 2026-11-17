// Tests des outils de cycle : node tests/test-outils.mjs
// Chaque anomalie doit être atteignable par une ligne sélectionnable (FEC, banque ou document
// d'un outil), et les tableaux des outils doivent recouper la comptabilité.
import { TAILLES, SECTEURS, NIVEAUX } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { calculerEtats, calculerBalance } from '../js/moteur/compta.js';
import { construireBanque } from '../js/moteur/banque.js';
import { OUTILS } from '../js/sections/outils.js';
import { CONFIGS_CYCLES } from '../js/cycles/index.js';
import { clesAnomalie, cleReference } from '../js/correction.js';
import { COL } from '../js/moteur/plan.js';

let echecs = 0; let nb = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 30) console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
const parType = {};
for (const secteur of Object.keys(SECTEURS)) for (const difficulte of Object.keys(NIVEAUX)) for (let g = 1; g <= 4; g++) {
  const nom = `${secteur}/${difficulte}/#${g}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille: 'tpe', difficulte, nbAnomalies: 12, graine: g * 92821 + secteur.length, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES.tpe.lignesFec, annee: 2025 });
  const dossier = { id: 'x', client: scenario.client, scenario: { graine: scenario.graine }, parametres: { secteur, difficulte }, tiers: r.tiers, chiffres: { N: calculerEtats(r.fec.N).agregats } };
  nb++;
  // Toutes les lignes sélectionnables, par la même voie que l'écran (références d'ajustement)
  const selectionnables = new Set();
  for (const ex of ['N', 'N-1']) for (const l of r.fec[ex]) selectionnables.add(cleReference({ source: 'fec', exercice: ex, num: l[COL.EcritureNum] }));
  const b = construireBanque(r.fec.N, r.donnees, { graine: scenario.graine, annee: 2025, difficulte });
  for (const l of b.lignes) selectionnables.add(cleReference({ source: 'releve', num: l.num || l.id }));
  for (const x of [...b.rapprochement.coteCompta, ...b.rapprochement.coteBanque]) selectionnables.add(cleReference({ source: 'rappro', num: x.num || x.id }));
  if (b.rapprochement.ecart) selectionnables.add(cleReference({ source: 'rappro', num: 'ecart' }));
  for (const config of Object.values(CONFIGS_CYCLES)) for (const id of config.outils || []) {
    const res = OUTILS[id].rendre({ dossier, annee: 2025, lignes: r.fec.N, donnees: r.donnees, anomalies: r.anomalies, etat: {}, panier: new Map(), donneesCycle: {}, modifie() {}, sauver: async () => {} });
    verifier(typeof res.html === 'string' && !/undefined|NaN/.test(res.html), `${nom} : outil ${id} mal rendu`);
    for (const it of res.items.values()) selectionnables.add(cleReference({ source: it.source, exercice: it.exercice, num: it.num || it.id }));
  }
  for (const a of r.anomalies) {
    const atteignable = [...clesAnomalie(a, r.donnees)].some((k) => selectionnables.has(k));
    parType[a.type] ??= { total: 0, ok: 0 };
    parType[a.type].total++; if (atteignable) parType[a.type].ok++;
    verifier(atteignable, `${nom} : anomalie ${a.type} inatteignable par une sélection`);
  }
  // Balance âgée : le total recoupe la balance des comptes de tiers
  const balance = calculerBalance(r.fec.N);
  const solde = (prefixe) => balance.filter((l) => l.compte.startsWith(prefixe)).reduce((s, l) => s + c(l.soldeDebiteur) - c(l.soldeCrediteur), 0);
  for (const [outil, prefixe] of [['balanceClients', '411'], ['balanceFournisseurs', '40']]) {
    const html = OUTILS[outil].rendre({ dossier, annee: 2025, lignes: r.fec.N, donnees: r.donnees, anomalies: r.anomalies, etat: {}, panier: new Map(), donneesCycle: {}, modifie() {}, sauver: async () => {} }).html;
    const total = html.match(/<tr class="total"><td colspan="2">Total[^<]*<\/td><td class="nombre">([^<]+)</);
    const lu = total ? c(Number(total[1].replace(/[\s  ]/g, '').replace(',', '.'))) : NaN;
    verifier(lu === solde(prefixe), `${nom} : balance âgée ${prefixe} (${lu}) ≠ balance (${solde(prefixe)})`);
  }
}
console.log(`${nb} dossiers : ${Object.keys(parType).length} types d'anomalies, atteignables : ${Object.entries(parType).map(([t, v]) => `${t} ${v.ok}/${v.total}`).join(', ')}`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

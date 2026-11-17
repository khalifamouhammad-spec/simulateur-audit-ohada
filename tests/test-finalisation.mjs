// Tests de la phase 7 : node tests/test-finalisation.mjs
// Circularisation cohérente avec le FEC et les anomalies, tests sur le FEC, événements postérieurs,
// position de la direction, opinion et note de finalisation.
import { TAILLES, SECTEURS, NIVEAUX } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { calculerEtats } from '../js/moteur/compta.js';
import { reponsesTiers, soldesTiers } from '../js/moteur/circularisation.js';
import { executerTest } from '../js/moteur/tests-fec.js';
import { evenementsPosterieurs, positionDirection } from '../js/moteur/evenements.js';
import { evaluerMission, ajouterTiers, clesAnomalie, opinionPour } from '../js/correction.js';
import { impactResultat } from '../js/sections/ajustements.js';

let echecs = 0; let nb = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 30) console.error('  ÉCHEC : ' + message); } };
const c = (n) => Math.round(n * 100);
const detectePar = { od_weekend: 'weekend', doublon_facture: 'doublons', doublon_paiement: 'doublons', fournisseur_inconnu: 'banqueCharges', montants_sous_seuil: 'sousSeuil', ventes_fictives: 'utilisateurs', ventes_cutoff: 'finExercice', cession_non_enregistree: 'attente' };
const detections = {}; const reponsesVues = { accord: 0, desaccord: 0, non_reponse: 0 };
for (const secteur of Object.keys(SECTEURS)) for (const difficulte of Object.keys(NIVEAUX)) for (let g = 1; g <= 4; g++) {
  const nom = `${secteur}/${difficulte}/#${g}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille: 'pme', difficulte, nbAnomalies: 12, graine: g * 31337 + secteur.length * 7, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES.pme.lignesFec, annee: 2025 });
  const etats = calculerEtats(r.fec.N).agregats;
  const dossier = { id: 'x', client: scenario.client, scenario: { graine: scenario.graine }, parametres: { secteur, difficulte }, tiers: r.tiers, chiffres: { N: etats }, exercice: { cloture: '2025-12-31' }, seuilAutorisation: r.seuilAutorisation, elements: {}, ajustements: [] };
  nb++;
  // --- Circularisation de tous les tiers ---
  const anomalies = ajouterTiers(r.anomalies, r.donnees, r.fec.N, r.tiers);
  for (const type of ['clients', 'fournisseurs']) {
    const soldes = soldesTiers(r.fec.N, type === 'clients' ? '411' : '40');
    const selection = [...soldes.keys()];
    const reponses = reponsesTiers({ selection, type, lignesN: r.fec.N, anomalies: r.anomalies, donnees: r.donnees, tiers: r.tiers, graine: scenario.graine, annee: 2025 });
    const deux = reponsesTiers({ selection, type, lignesN: r.fec.N, anomalies: r.anomalies, donnees: r.donnees, tiers: r.tiers, graine: scenario.graine, annee: 2025 });
    verifier(JSON.stringify(reponses) === JSON.stringify(deux), `${nom} : réponses de circularisation non déterministes`);
    for (const x of reponses) {
      reponsesVues[x.reponse]++;
      verifier(c(x.soldeComptable) === soldes.get(x.num).solde, `${nom} : solde comptable de ${x.nom} faux`);
      if (x.reponse !== 'non_reponse') verifier(c(x.soldeComptable) - c(x.soldeConfirme) === c(x.ecart), `${nom} : écart de ${x.nom} incohérent`);
      verifier(!/undefined|NaN/.test(x.commentaire), `${nom} : commentaire mal formé (${x.commentaire})`);
    }
    // Chaque anomalie liée à un tiers produit une réponse non neutre pour ce tiers
    for (const a of anomalies) for (const t of a.tiers) {
      const rep = reponses.find((x) => x.num === t);
      if (!rep) continue;
      verifier(rep.reponse !== 'accord' || /deux règlements|difficultés/.test(rep.commentaire), `${nom} : ${a.type} sans signal dans la réponse de ${rep.nom}`);
      verifier(clesAnomalie(a, r.donnees).has(`doc|CIRC-${t}`), `${nom} : la réponse de ${rep.nom} n'est pas reliée à ${a.type}`);
    }
  }
  // --- Tests sur le FEC : les anomalies concernées ressortent ---
  for (const a of r.anomalies) {
    const test = detectePar[a.type];
    if (!test) continue;
    const res = new Set(executerTest(test, r.fec.N, { annee: 2025, seuilAutorisation: c(r.seuilAutorisation) }).map((e) => e.num));
    const trouve = a.ecritures.some((e) => e.exercice === 'N' && res.has(e.num));
    detections[a.type] ??= { total: 0, ok: 0 }; detections[a.type].total++; if (trouve) detections[a.type].ok++;
    if (['od_weekend', 'doublon_facture', 'doublon_paiement', 'fournisseur_inconnu', 'montants_sous_seuil', 'cession_non_enregistree'].includes(a.type)) verifier(trouve, `${nom} : le test « ${test} » ne fait pas ressortir ${a.type}`);
  }
  // --- Événements postérieurs ---
  const corrige = { anomalies: r.anomalies, donnees: r.donnees };
  const ev = evenementsPosterieurs(dossier, corrige);
  verifier(ev.length >= 3 && ev.every((e) => e.texte && e.attendu && e.explication && !/undefined|NaN/.test(e.texte)), `${nom} : événements postérieurs mal formés`);
  verifier(JSON.stringify(ev) === JSON.stringify(evenementsPosterieurs(dossier, corrige)), `${nom} : événements non déterministes`);
  if (r.anomalies.some((a) => a.type === 'client_procedure_collective')) verifier(ev.some((e) => e.id === 'EV-PC' && e.attendu === 'ajustant'), `${nom} : procédure collective absente des événements`);

  // --- Mission complète simulée : ajustements parfaits, direction, opinion, finalisation ---
  const seuil = Math.round(etats.produitsExploitation * 0.01);
  dossier.seuils = { signification: seuil, planification: seuil * 0.7, insignifiant: seuil * 0.05 };
  dossier.ajustements = r.anomalies.map((a, i) => {
    const m = Math.abs(a.impactResultat) || a.montant;
    return { id: `AJ${i}`, cycle: a.cycle, description: a.libelle, references: a.ecritures.slice(0, 1).map((e) => ({ source: 'fec', exercice: e.exercice, num: e.num })),
      lignes: a.impactResultat < 0 ? [{ compte: '658000', debit: String(m) }, { compte: '471000', credit: String(m) }] : a.impactResultat > 0 ? [{ compte: '471000', debit: String(m) }, { compte: '758000', credit: String(m) }] : [{ compte: '471100', debit: String(m) }, { compte: '471000', credit: String(m) }], decision: 'attente' };
  });
  const position = positionDirection(dossier.ajustements, seuil, impactResultat);
  for (const a of dossier.ajustements) Object.assign(a, position.get(a.id), { presente: true });
  const refus = dossier.ajustements.filter((a) => a.decision === 'non_corrigee');
  verifier(refus.length <= 2 && refus.every((a) => impactResultat(a) < 0 && Math.abs(impactResultat(a)) >= seuil * 0.3), `${nom} : position de la direction incohérente`);
  const propre = refus.reduce((s, a) => s + Math.abs(impactResultat(a)), 0);
  const attendue = opinionPour(propre, seuil);
  dossier.elements = {
    F1: { donnees: { revues: [{ date: '2026-02-01', source: 'local', nouveaux: 1 }], points: [{ id: 'p', ref: 'C1', texte: 'x', reponse: 'Justification complétée.' }] } },
    G1: { donnees: Object.fromEntries(ev.map((e) => ['c_' + e.id, e.attendu])) },
    G2: { donnees: { texte: 'Lettre complétée.' } },
    G3: { donnees: Object.fromEntries(['contexte', 'risques', 'travaux', 'anomalies', 'suspens', 'conclusion'].map((k) => [k, 'Rubrique rédigée avec suffisamment de détails pour la note de synthèse.'])) },
    G4: { donnees: { opinion: attendue, justification: 'Justification détaillée de l\'opinion au regard du cumul des anomalies non corrigées comparé au seuil de signification, et de leur caractère non généralisé.'.repeat(2) } },
  };
  const evaluation = evaluerMission({ dossier, corrige: { ...corrige, anomalies }, feuilles: [], documents: [], revue: { significatifs: [] } });
  const f = evaluation.sections.finalisation;
  verifier(f.opinion.coherente === attendue && f.opinion.appropriee === attendue, `${nom} : opinion attendue ${attendue}, cohérente ${f.opinion.coherente}, appropriée ${f.opinion.appropriee}`);
  verifier(f.note === 20, `${nom} : finalisation parfaite notée ${f.note} (${f.constats.join(' | ')})`);
  verifier(evaluation.globale >= 0 && evaluation.globale <= 20, `${nom} : note globale hors bornes`);
  // Opinion contraire : perte de points
  dossier.elements.G4.donnees.opinion = attendue === 'sans_reserve' ? 'defavorable' : 'sans_reserve';
  verifier(evaluerMission({ dossier, corrige: { ...corrige, anomalies }, feuilles: [], documents: [], revue: { significatifs: [] } }).sections.finalisation.note === 13, `${nom} : opinion erronée mal sanctionnée`);
}
console.log(`${nb} dossiers. Réponses de circularisation : ${Object.entries(reponsesVues).map(([k, v]) => `${k} ${v}`).join(', ')}.`);
console.log(`Tests sur le FEC : ${Object.entries(detections).map(([t, v]) => `${t} ${v.ok}/${v.total}`).join(', ')}.`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

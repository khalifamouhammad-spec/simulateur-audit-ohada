// Tests de la correction : node tests/test-correction.mjs
// Copie « parfaite », copie vide, fausses alertes, rapprochement par montant, notes bornées.
import { TAILLES, SECTEURS, NIVEAUX } from '../js/config.js';
import { scenarioHorsLigne } from '../js/moteur/scenario.js';
import { genererComptabilite } from '../js/moteur/generateur-fec.js';
import { calculerEtats } from '../js/moteur/compta.js';
import { evaluerMission, dansPerimetre } from '../js/correction.js';
import { impactResultat } from '../js/sections/ajustements.js';

let echecs = 0; let nb = 0;
const verifier = (condition, message) => { if (!condition) { echecs++; if (echecs < 30) console.error('  ÉCHEC : ' + message); } };

/** Ajustement qui corrige exactement l'anomalie ; avecReferences = false : saisi directement dans E1. */
function ajustementParfait(a, i, avecReferences = true) {
  const m = Math.abs(a.impactResultat) || a.montant;
  const lignes = a.impactResultat < 0 ? [{ compte: '658000', debit: String(m), credit: '' }, { compte: '471000', debit: '', credit: String(m) }]
    : a.impactResultat > 0 ? [{ compte: '471000', debit: String(m), credit: '' }, { compte: '758000', debit: '', credit: String(m) }]
    : [{ compte: '471100', debit: String(m), credit: '' }, { compte: '471000', debit: '', credit: String(m) }];
  const references = !avecReferences ? [] : a.type === 'frais_bancaires_non_comptabilises' ? [{ source: 'releve', exercice: 'N', num: 'NC-0', lib: 'Frais' }]
    : a.type === 'cheque_ancien' ? [{ source: 'rappro', exercice: 'N', num: 'CHQ-ANCIEN-0', lib: 'Chèque' }]
    : a.ecritures.slice(0, 1).map((e) => ({ source: 'fec', exercice: e.exercice, num: e.num, lib: '' }));
  return { id: `AJ${i}`, cycle: a.cycle, description: a.libelle, references, lignes, decision: 'non_corrigee' };
}

for (const secteur of Object.keys(SECTEURS)) for (const difficulte of Object.keys(NIVEAUX)) for (let g = 1; g <= 4; g++) {
  const nom = `${secteur}/${difficulte}/#${g}`;
  const { scenario, choix } = scenarioHorsLigne({ secteur, taille: 'pme', difficulte, nbAnomalies: 3 + g * 2, graine: g * 7727 + difficulte.length, nomParDefaut: 'Client Test', formeParDefaut: 'SAS' });
  const r = genererComptabilite(scenario, choix, { lignesCible: TAILLES.pme.lignesFec, annee: 2025 });
  const corrige = { anomalies: r.anomalies, donnees: r.donnees };
  const n = calculerEtats(r.fec.N).agregats;
  const base = { client: scenario.client, parametres: { secteur, difficulte, referentiel: 'pcg' }, chiffres: { N: n }, elements: {}, ajustements: [] };
  const evaluer = (dossier, extra = {}) => evaluerMission({ dossier, corrige, feuilles: [], documents: [], revue: { significatifs: [] }, ...extra });
  nb++;
  const perimetre = r.anomalies.filter(dansPerimetre);
  verifier(r.anomalies.some((a) => a.cycle === 'tresorerie'), `${nom} : aucune anomalie du cycle trésorerie`);

  // Copie vide
  const vide = evaluer(structuredClone(base));
  verifier(vide.sections.detection.note === 0 || !perimetre.length, `${nom} : copie vide notée ${vide.sections.detection.note} en détection`);
  verifier(Object.values(vide.sections).every((s) => s.note >= 0 && s.note <= 20) && vide.globale <= 20, `${nom} : note hors bornes`);
  verifier(vide.resume.trouvees === 0 && vide.resume.faussesAlertes === 0, `${nom} : copie vide mal comptée`);

  // Copie parfaite, ajustements reliés aux écritures
  const parfaite = { ...structuredClone(base), ajustements: r.anomalies.map((a, i) => ajustementParfait(a, i)) };
  const ev = evaluer(parfaite);
  verifier(perimetre.length === r.anomalies.length && ev.resume.trouvees === perimetre.length, `${nom} : copie parfaite, ${ev.resume.trouvees}/${perimetre.length} trouvées`);
  verifier(ev.resume.faussesAlertes === 0, `${nom} : copie parfaite, ${ev.resume.faussesAlertes} fausse(s) alerte(s) (${ev.comparaison.faussesAlertes})`);
  verifier(ev.comparaison.resultats.every((x) => x.trouvee && x.chiffrage), `${nom} : copie parfaite, anomalie non trouvée ou mal chiffrée : ${ev.comparaison.resultats.filter((x) => !x.trouvee || !x.chiffrage).map((x) => r.anomalies.find((a) => a.id === x.anomalieId).type)}`);
  verifier(!perimetre.length || ev.sections.detection.note === 20, `${nom} : copie parfaite notée ${ev.sections.detection.note} en détection`);

  // Copie parfaite saisie sans références (rapprochement par le montant)
  const sansRef = { ...structuredClone(base), ajustements: r.anomalies.map((a, i) => ajustementParfait(a, i, false)) };
  const ev2 = evaluer(sansRef);
  verifier(ev2.resume.trouvees >= perimetre.length - 1, `${nom} : rapprochement par montant, ${ev2.resume.trouvees}/${perimetre.length}`);

  // Fausses alertes : −2 points chacune
  const avecFausses = { ...structuredClone(parfaite), ajustements: [...parfaite.ajustements, { id: 'F1', cycle: 'tresorerie', description: 'x', references: [{ source: 'fec', exercice: 'N', num: 'XX999999' }], lignes: [{ compte: '631000', debit: '13,37', credit: '' }, { compte: '521000', debit: '', credit: '13,37' }] }] };
  const ev3 = evaluer(avecFausses);
  verifier(ev3.resume.faussesAlertes === 1 && (!perimetre.length || ev3.sections.detection.note === 18), `${nom} : fausse alerte mal comptée (${ev3.resume.faussesAlertes}, note ${ev3.sections.detection.note})`);
  // Mauvais chiffrage : la détection compte, pas la précision
  const malChiffre = { ...structuredClone(parfaite) };
  malChiffre.ajustements = malChiffre.ajustements.map((aj) => (!aj.references.length ? aj : { ...aj, lignes: aj.lignes.map((l) => ({ ...l, debit: l.debit ? String(Number(l.debit) * 3) : '', credit: l.credit ? String(Number(l.credit) * 3) : '' })) }));
  const ev4 = evaluer(malChiffre);
  // Les ajustements sans références gardent leur montant exact : ils conservent leurs points de précision.
  const intacts = malChiffre.ajustements.filter((aj) => !aj.references.length && dansPerimetre(r.anomalies[Number(aj.id.slice(2))])).length;
  const attendu = Math.round((16 + (4 * intacts) / perimetre.length) * 10) / 10;
  verifier(!perimetre.length || Math.abs(ev4.sections.detection.note - attendu) < 0.11, `${nom} : mauvais chiffrage noté ${ev4.sections.detection.note} (attendu ${attendu})`);
  verifier(Math.abs(impactResultat(parfaite.ajustements[0]) - (r.anomalies[0].impactResultat || 0)) < 0.011 || !r.anomalies[0].impactResultat, `${nom} : ajustement de test mal construit`);
}

// Seuils : une réponse professionnelle obtient au moins 18, une réponse vide 0
{
  const chiffres = { N: { chiffreAffaires: 10e6, produitsExploitation: 10.2e6, resultatExploitation: 6e5, resultatNet: 4e5, totalBilan: 5e6, capitauxPropres: 2e6 } };
  const dossier = { chiffres, elements: { C1: { donnees: { base: 'produits', taux: '1', signification: '102 000', planification: '71 400', insignifiant: '5 100',
    justification: "Base retenue : produits d'exploitation, agrégat stable et suivi par les banques et l'acquéreur potentiel. Le résultat est trop volatil. Taux de 1 %, bas de fourchette compte tenu de la pression sur le résultat. Seuil de planification à 70 % du seuil compte tenu du risque. Anomalies insignifiantes à 5 %." } } }, ajustements: [], parametres: {}, client: {} };
  const ev = evaluerMission({ dossier, corrige: { anomalies: [] }, feuilles: [], documents: [], revue: { significatifs: [] } });
  verifier(ev.sections.seuils.note >= 18, `seuils professionnels notés ${ev.sections.seuils.note} : ${ev.sections.seuils.constats.join(' | ')}`);
  dossier.elements.C1.donnees = { base: 'resultatNet', taux: '5', signification: '2 000', planification: '1 900', insignifiant: '1 000', justification: '' };
  dossier.chiffres.N.resultatNet = 40000;
  const ev2 = evaluerMission({ dossier, corrige: { anomalies: [] }, feuilles: [], documents: [], revue: { significatifs: [] } });
  verifier(ev2.sections.seuils.note <= 8, `seuils inadaptés notés ${ev2.sections.seuils.note}`);
  console.log(`Seuils : réponse professionnelle ${ev.sections.seuils.note}/20, réponse inadaptée ${ev2.sections.seuils.note}/20.`);
}
console.log(`${nb} dossiers corrigés (copies vide, parfaite, sans références, avec fausse alerte, mal chiffrée).`);
console.log(echecs ? `${echecs} ÉCHEC(S)` : 'Tous les contrôles sont passés.');
process.exit(echecs ? 1 : 0);

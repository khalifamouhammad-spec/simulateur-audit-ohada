// Correction d'une mission clôturée. Calcul entièrement fait par le code, à partir de ce que
// l'auditeur a saisi et du corrigé caché. L'IA ne fait que commenter (voir commenterParIA).
//
// Périmètre noté : les anomalies des cycles disponibles (section D) et toutes celles qui passent
// par le journal de banque. Depuis la phase 6, tous les cycles sont disponibles.
import { CYCLES, ASSERTIONS, REFERENTIELS } from './config.js';
import { CONFIGS_CYCLES } from './cycles/index.js';
import { anomaliesParTiers } from './moteur/circularisation.js';
import { evenementsPosterieurs } from './moteur/evenements.js';
import { impactResultat, equilibre } from './sections/ajustements.js';
import { demanderJSON } from './groq.js';
import { euro, lireNombre } from './utils.js';

export const CYCLES_NOTES = Object.keys(CONFIGS_CYCLES);
export const PONDERATIONS = { detection: 0.35, travaux: 0.2, planification: 0.15, seuils: 0.1, finalisation: 0.2 };
export const SECTIONS = {
  detection: 'Détection des anomalies et ajustements (E1)',
  travaux: 'Travaux sur les cycles (D)',
  planification: 'Planification : acceptation, prise de connaissance, risques (A, B)',
  seuils: 'Seuils de signification (C1)',
  finalisation: 'Revue, finalisation et opinion (F, G)',
};

const arrondi = (n) => Math.round(n * 10) / 10;
const borne = (n) => Math.max(0, Math.min(20, arrondi(n)));
const rempli = (t, min = 1) => typeof t === 'string' && t.trim().length >= min;

export const dansPerimetre = (a) => CYCLES_NOTES.includes(a.cycle) || a.ecritures.some((e) => e.journal === 'BQ');

// ------------------------------------------------------------------ Rapprochement saisies / corrigé
/** Clés des lignes qui « portent » une anomalie (écritures du journal, lignes des documents bancaires). */
export function clesAnomalie(a, donnees) {
  const cles = new Set(a.ecritures.map((e) => `fec|${e.exercice}|${e.num}`));
  if (a.type === 'frais_bancaires_non_comptabilises') {
    (donnees?.banque?.nonComptabilises || []).forEach((_, i) => cles.add(`banque|NC-${i}`));
    cles.add('banque|ecart');
  }
  if (a.type === 'cheque_ancien') (donnees?.banque?.chequesNonDebites || []).forEach((_, i) => cles.add(`banque|CHQ-ANCIEN-${i}`));
  // Documents des outils de cycle (sections/outils.js)
  const post = donnees?.posterieur || {};
  if (a.type === 'fnp_oubliees') (post.factures || []).forEach((f, i) => { if (!f.provisionnee) cles.add(`doc|FAC-${i}`); });
  if (a.type === 'avoirs_post_cloture') (post.avoirs || []).forEach((_, i) => cles.add(`doc|AV-${i}`));
  if (a.type === 'client_procedure_collective') (post.faits || []).filter((f) => f.type === 'procedure_collective').forEach((_, i) => cles.add(`doc|BODACC-${i}`));
  if (a.type === 'amortissement_oublie' && a.comptes[0]) cles.add(`doc|IMMO-${a.comptes[0]}`);
  if (a.type === 'stock_surevalue') { cles.add('doc|INV'); cles.add('doc|INV-PV'); }
  if (a.type === 'charges_sociales_non_rattachees') cles.add('doc|PAIE-12');
  if (a.type === 'manquant_caisse') { cles.add('doc|CAISSE-PV'); cles.add('doc|CAISSE-571'); }
  if (a.type === 'retenues_non_reversees') [9, 10, 11, 12].forEach((m) => cles.add(`doc|PAIE-${m}`)); // mois de paie et mois de reversement attendus
  // Circularisation : réponse du tiers concerné, confirmation bancaire
  for (const t of a.tiers || []) cles.add(`doc|CIRC-${t}`);
  if (['frais_bancaires_non_comptabilises', 'cheque_ancien'].includes(a.type)) cles.add('doc|CIRC-BANQUE');
  return cles;
}
/** Clé d'une ligne référencée par un ajustement (voir sections/cycle.js). */
export function cleReference(r) {
  const num = String(r.num || '');
  if (r.source === 'doc') return `doc|${num}`;
  if (r.source === 'fec') return `fec|${r.exercice || 'N'}|${num}`;
  if (/^R-/.test(num)) return `fec|N|${num.slice(2)}`;
  if (/^[A-Z]{2}\d{6}$/.test(num)) return `fec|N|${num}`;
  return `banque|${num}`;
}
const proche = (x, cible, tolerance) => Math.abs(Math.abs(x) - Math.abs(cible)) <= Math.max(1, Math.abs(cible) * tolerance);
const debitTotal = (aj) => equilibre(aj).debit;
/** L'ajustement chiffre-t-il correctement l'anomalie ? */
function chiffrageCorrect(aj, a) {
  return a.impactResultat ? proche(impactResultat(aj), a.impactResultat, 0.1) : proche(debitTotal(aj), a.montant, 0.1);
}

export function comparer(anomalies, ajustements, donnees) {
  const lien = new Map(anomalies.map((a) => [a.id, []]));
  const utilises = new Set();
  // 1) Par les lignes sélectionnées
  for (const a of anomalies) {
    const cles = clesAnomalie(a, donnees);
    for (const aj of ajustements) if ((aj.references || []).some((r) => cles.has(cleReference(r)))) { lien.get(a.id).push(aj.id); utilises.add(aj.id); }
  }
  // 2) À défaut, par le montant (ajustement saisi directement dans E1)
  for (const a of anomalies) {
    if (lien.get(a.id).length) continue;
    const aj = ajustements.find((x) => !utilises.has(x.id) && (a.impactResultat ? proche(impactResultat(x), a.impactResultat, 0.05) : proche(debitTotal(x), a.montant, 0.05)));
    if (aj) { lien.get(a.id).push(aj.id); utilises.add(aj.id); }
  }
  const parId = new Map(ajustements.map((x) => [x.id, x]));
  return {
    resultats: anomalies.map((a) => {
      const ajs = lien.get(a.id).map((id) => parId.get(id));
      return { anomalieId: a.id, perimetre: dansPerimetre(a), trouvee: ajs.length > 0, ajustements: ajs.map((x) => x.id), chiffrage: ajs.some((x) => chiffrageCorrect(x, a)), decision: ajs[0]?.decision || null };
    }),
    faussesAlertes: ajustements.filter((x) => !utilises.has(x.id)).map((x) => x.id),
  };
}

// ------------------------------------------------------------------ Notes par section
function noterDetection(anomalies, comparaison, ajustements) {
  const constats = [];
  const res = comparaison.resultats.filter((r) => r.perimetre);
  const trouvees = res.filter((r) => r.trouvee);
  const fa = comparaison.faussesAlertes.length;
  let note;
  if (!res.length) {
    note = 20 - 2 * fa;
    constats.push("Aucune anomalie du périmètre noté dans ce dossier : seule l'absence de fausse alerte est appréciée.");
  } else {
    note = (16 * trouvees.length) / res.length + (4 * trouvees.filter((r) => r.chiffrage).length) / res.length - 2 * fa;
    constats.push(`${trouvees.length} anomalie(s) trouvée(s) sur ${res.length} dans le périmètre noté.`);
    const malChiffrees = trouvees.filter((r) => !r.chiffrage).length;
    if (malChiffrees) constats.push(`${malChiffrees} anomalie(s) trouvée(s) mais mal chiffrée(s) : l'incidence de l'écriture de correction s'écarte de plus de 10 % du bon montant.`);
  }
  if (fa) constats.push(`${fa} fausse(s) alerte(s) : ajustement(s) ne correspondant à aucune anomalie (−2 points chacune).`);
  const horsPerimetre = comparaison.resultats.filter((r) => !r.perimetre && r.trouvee).length;
  if (horsPerimetre) constats.push(`${horsPerimetre} anomalie(s) d'autres cycles également relevée(s) (non notées à ce stade, mais à votre crédit).`);
  if (!ajustements.length) constats.push("Aucun ajustement proposé dans le tableau E1 : les anomalies relevées doivent y être reportées avec leur écriture de correction (ISA 450).");
  return { note: borne(note), constats };
}

/** Note des travaux d'un cycle (section D), sur 20. */
function noterCycle(config, dossier, feuilles, documents) {
  const constats = [];
  const code = config.code;
  const d = dossier.elements?.[code]?.donnees || {};
  const programme = [...(d.programme || []), ...(d.proceduresAjoutees || [])];
  const total = Math.max(config.programme.length, programme.length);
  const traitees = programme.filter((p) => p.statut).length;
  const justifiees = programme.filter((p) => ['adapte', 'na'].includes(p.statut));
  const fs = feuilles.filter((f) => f.cycle === config.id);
  const completes = fs.filter((f) => rempli(f.titre, 3) && rempli(f.objectif, 10) && rempli(f.travail, 30) && rempli(f.conclusion, 15));
  const avecRefs = fs.filter((f) => f.refsCroisees.length);
  const avecElements = fs.filter((f) => f.elements.length);
  const pieces = documents.filter((x) => x.cycle === config.id);
  let note = (6 * traitees) / total;
  note += justifiees.length ? (2 * justifiees.filter((p) => rempli(p.commentaire, 10)).length) / justifiees.length : traitees ? 2 : 0;
  note += fs.length ? 6 * (completes.length / fs.length) * Math.min(1, fs.length / 3) : 0;
  note += fs.length ? (2 * avecRefs.length) / fs.length : 0;
  note += pieces.length ? 2 : 0;
  note += avecElements.length ? 2 : 0;
  constats.push(`${code} ${config.libelle} : ${traitees}/${total} procédure(s) traitée(s), ${fs.length} feuille(s) dont ${completes.length} complète(s), ${pieces.length} pièce(s).`);
  if (traitees < total) constats.push(`${code} : programme incomplet — chaque procédure est réalisée, adaptée ou écartée avec une justification (ISA 230).`);
  if (justifiees.some((p) => !rempli(p.commentaire, 10))) constats.push(`${code} : des procédures « adaptées » ou « non applicables » ne sont pas justifiées.`);
  if (config.id === 'tresorerie' && (d.programme || []).slice(0, 3).filter((p) => p.statut === 'fait' || p.statut === 'adapte').length < 3) constats.push("D1 : les contrôles de l'état de rapprochement (exactitude, validation des soldes, apurement des suspens) ne sont pas tous documentés.");
  if (!fs.length) constats.push(`${code} : aucune feuille de travail, les contrôles ne sont pas documentés.`);
  else {
    if (fs.length < 3) constats.push(`${code} : moins de trois feuilles de travail, documentation mince.`);
    if (avecRefs.length < fs.length) constats.push(`${code} : des feuilles sans référence croisée (programme, risques B4, ajustements E1).`);
    if (!avecElements.length) constats.push(`${code} : aucune sélection de lignes ni pièce jointe aux feuilles, l'étendue des contrôles n'est pas démontrée.`);
  }
  if (!pieces.length) constats.push(`${code} : aucune pièce justificative demandée, pas d'élément probant externe (ISA 500).`);
  return { note: borne(note), constats };
}

/** Travaux : moyenne des cycles qui contenaient des anomalies (ceux qu'il fallait travailler). */
function noterTravaux(dossier, feuilles, documents, anomalies) {
  const cycles = [...new Set(anomalies.map((a) => a.cycle))].filter((c) => CONFIGS_CYCLES[c]);
  const retenus = cycles.length ? cycles : ['tresorerie'];
  const notes = retenus.map((c) => ({ c, ...noterCycle(CONFIGS_CYCLES[c], dossier, feuilles, documents) }));
  const moyenne = notes.reduce((s, x) => s + x.note, 0) / notes.length;
  const constats = [`Note moyenne des cycles qui comportaient des anomalies : ${notes.map((x) => `${CONFIGS_CYCLES[x.c].code} ${String(x.note).replace('.', ',')}`).join(' · ')}.`, ...notes.flatMap((x) => x.constats)];
  return { note: borne(moyenne), constats, parCycle: Object.fromEntries(notes.map((x) => [x.c, x.note])) };
}

function noterPlanification(dossier, anomalies, revue) {
  const constats = [];
  const don = (code) => dossier.elements?.[code]?.donnees || {};
  const a1 = don('A1'); const a2 = don('A2'); const a3 = don('A3'); const b1 = don('B1'); const b2 = don('B2').cycles || {}; const b3 = don('B3'); const b4 = don('B4');
  // A — acceptation (4 points)
  let a = 0;
  if (a1.decision && rempli(a1.justification, 20)) a += 1.5; else constats.push("A1 : décision d'acceptation non prise ou non justifiée.");
  const reponsesA2 = Array.from({ length: 11 }, (_, i) => a2['r' + i]).filter(Boolean).length;
  if (reponsesA2 === 11 && a2.conclusion) a += 1.5; else constats.push(`A2 : questionnaire d'indépendance incomplet (${reponsesA2}/11 réponses${a2.conclusion ? '' : ', pas de conclusion'}).`);
  const crochets = typeof a3.texte === 'string' ? (a3.texte.match(/\[[^\]]+\]/g) || []).length : 99;
  if (crochets <= 2 && lireNombre(a3.heures) && lireNombre(a3.taux)) a += 1; else constats.push('A3 : lettre de mission non finalisée (mentions entre crochets restantes ou budget absent).');
  // B1 — prise de connaissance (3 points)
  const champsB1 = ['activite', 'environnement', 'organisation', 'risques'].filter((k) => rempli(b1[k], 40)).length;
  const b = 0.75 * champsB1;
  if (champsB1 < 4) constats.push(`B1 : ${4 - champsB1} rubrique(s) de la prise de connaissance peu ou pas renseignée(s).`);
  // B2 — contrôle interne (4 points)
  const cycles = Object.keys(CYCLES);
  const conclus = cycles.filter((c) => b2[c]?.risque);
  const cyclesAnomalies = [...new Set(anomalies.map((x) => x.cycle))];
  const detectes = cyclesAnomalies.filter((c) => ['moyen', 'eleve'].includes(b2[c]?.risque));
  let ci = (2 * conclus.length) / cycles.length + (cyclesAnomalies.length ? (2 * detectes.length) / cyclesAnomalies.length : 2);
  if (conclus.length < cycles.length) constats.push(`B2 : ${conclus.length} cycle(s) sur ${cycles.length} conclus dans les questionnaires de contrôle interne.`);
  const manques = cyclesAnomalies.filter((c) => !detectes.includes(c));
  if (manques.length) constats.push(`B2 : risque de contrôle interne jugé faible ou non évalué sur des cycles qui contenaient des anomalies (${manques.map((c) => CYCLES[c]).join(', ')}).`);
  // B3 — revue analytique (5 points)
  const significatives = revue.significatifs;
  const commentees = significatives.filter((id) => rempli(b3[id], 15)).length;
  const ra = (significatives.length ? (4 * commentees) / significatives.length : 4) + (rempli(b3.conclusion, 30) ? 1 : 0);
  if (commentees < significatives.length) constats.push(`B3 : ${commentees} variation(s) significative(s) commentée(s) sur ${significatives.length}.`);
  if (!rempli(b3.conclusion, 30)) constats.push('B3 : pas de conclusion de la revue analytique.');
  // B4 — matrice des risques (4 points)
  const risqueEleve = (c) => ASSERTIONS.some((_, i) => ['moyen', 'eleve'].includes(b4[`${c}_${i}`]));
  const reperes = cyclesAnomalies.filter(risqueEleve);
  const evalues = cycles.filter((c) => ASSERTIONS.some((_, i) => b4[`${c}_${i}`]));
  let m = (cyclesAnomalies.length ? (2 * reperes.length) / cyclesAnomalies.length : 2) + (cycles.filter((c) => rempli(b4[c + '_reponse'], 10)).length / cycles.length) + (rempli(b4.fraude, 30) ? 1 : 0);
  if (evalues.length < cycles.length) constats.push(`B4 : ${evalues.length} cycle(s) évalué(s) sur ${cycles.length} dans la matrice des risques.`);
  const nonReperes = cyclesAnomalies.filter((c) => !reperes.includes(c));
  if (nonReperes.length) constats.push(`B4 : aucun risque moyen ou élevé retenu sur des cycles qui contenaient des anomalies (${nonReperes.map((c) => CYCLES[c]).join(', ')}).`);
  if (!rempli(b4.fraude, 30)) constats.push('B4 : le risque de fraude n\'est pas analysé (ISA 240).');
  if (anomalies.some((x) => x.fraude) && !rempli(b4.fraude, 30)) constats.push('Le dossier contenait au moins une fraude : l\'analyse du risque de fraude était indispensable.');
  ci = Math.min(4, ci); m = Math.min(4, m);
  return { note: borne(a + b + ci + ra + m), constats };
}

const FOURCHETTES = { ca: [0.5, 2], produits: [0.5, 2], resultat: [5, 10], resultatNet: [5, 10], bilan: [1, 2], capitaux: [1, 5] };
const CLES = { ca: 'chiffreAffaires', produits: 'produitsExploitation', resultat: 'resultatExploitation', resultatNet: 'resultatNet', bilan: 'totalBilan', capitaux: 'capitauxPropres' };
const LIBELLES = { ca: "chiffre d'affaires", produits: "produits d'exploitation", resultat: "résultat d'exploitation", resultatNet: 'résultat net', bilan: 'total du bilan', capitaux: 'capitaux propres', autre: 'autre base' };

function noterSeuils(dossier) {
  const constats = [];
  const d = dossier.elements?.C1?.donnees || {};
  const n = dossier.chiffres.N;
  const s = lireNombre(d.signification); const p = lireNombre(d.planification); const i = lireNombre(d.insignifiant); const taux = lireNombre(d.taux);
  const base = n[CLES[d.base]];
  const reference = Math.round(n.produitsExploitation * 0.01);
  let note = 0;
  if (!d.base || !s) {
    constats.push('Seuil de signification non déterminé : il conditionne toute la mission (ISA 320).');
    return { note: 0, constats, reference };
  }
  note += 3;
  if (base && taux && proche(s, (base * taux) / 100, 0.05)) note += 3;
  else constats.push('Le seuil de signification ne correspond pas au produit de la base par le taux indiqué.');
  const [min, max] = FOURCHETTES[d.base] || [0, Infinity];
  const pctBase = base ? (s / Math.abs(base)) * 100 : null;
  if (pctBase != null && pctBase >= min * 0.9 && pctBase <= max * 1.1) note += 4;
  else if (pctBase != null) constats.push(`Le seuil représente ${arrondi(pctBase).toString().replace('.', ',')} % du ${LIBELLES[d.base]}, hors de la fourchette usuelle de ${min} à ${max} %.`);
  if (['resultat', 'resultatNet'].includes(d.base) && (base <= 0 || base < n.produitsExploitation * 0.02)) { note -= 2; constats.push(`Le ${LIBELLES[d.base]} est faible ou négatif : base instable, une base de chiffre d'affaires ou de produits était plus pertinente.`); }
  if (p && p / s >= 0.5 && p / s <= 0.8) note += 3; else constats.push(`Seuil de planification ${p ? `à ${Math.round((p / s) * 100)} %` : 'absent'} : il se situe en général entre 50 et 75 % du seuil de signification selon le risque du dossier.`);
  if (i && i / s >= 0.02 && i / s <= 0.1) note += 3; else constats.push(`Seuil des anomalies manifestement insignifiantes ${i ? `à ${arrondi((i / s) * 100).toString().replace('.', ',')} %` : 'absent'} : il se situe en général entre 3 et 10 % du seuil de signification.`);
  if (rempli(d.justification, 200)) note += 4; else if (rempli(d.justification, 60)) { note += 2; constats.push('Justification des seuils trop succincte.'); } else constats.push('Choix des seuils non justifié.');
  constats.unshift(`Seuil retenu : ${euro(s)} (${LIBELLES[d.base]}). À titre de repère, 1 % des produits d'exploitation donne ${euro(reference)}.`);
  return { note: borne(note), constats, reference };
}

// ------------------------------------------------------------------ Finalisation et opinion
export const OPINIONS_LIB = { sans_reserve: 'opinion sans réserve', reserve: 'opinion avec réserve', defavorable: 'opinion défavorable', impossibilite: "impossibilité d'exprimer une opinion" };
/** Opinion appropriée pour un cumul d'anomalies non corrigées : significatif → réserve ; plus de 5 fois le seuil → généralisé. */
export const opinionPour = (cumul, seuil) => (!seuil || cumul < seuil ? 'sans_reserve' : cumul < 5 * seuil ? 'reserve' : 'defavorable');

/** Anomalies réellement non corrigées : ratées, ou trouvées mais refusées par la direction. */
export function cumulReel(anomalies, comparaison, ajustements) {
  const parId = new Map(ajustements.map((a) => [a.id, a]));
  return comparaison.resultats.reduce((s, r) => {
    const a = anomalies.find((x) => x.id === r.anomalieId);
    const corrigee = r.trouvee && r.ajustements.every((id) => parId.get(id)?.decision === 'corrigee');
    return s + (corrigee ? 0 : Math.abs(a.impactResultat));
  }, 0);
}

function noterFinalisation(dossier, corrige, comparaison) {
  const constats = [];
  const don = (code) => dossier.elements?.[code]?.donnees || {};
  const ajustements = dossier.ajustements || [];
  let note = 0;
  // F1 — revue (3 points)
  const f1 = don('F1');
  const points = f1.points || [];
  if (!(f1.revues || []).length) constats.push('F1 : aucune revue du manager demandée.');
  else {
    const repondus = points.filter((x) => rempli(x.reponse, 5)).length;
    note += points.length ? (3 * repondus) / points.length : 3;
    if (repondus < points.length) constats.push(`F1 : ${points.length - repondus} point(s) de revue sans réponse.`);
  }
  // G1 — événements postérieurs (4 points)
  const evenements = dossier.scenario ? evenementsPosterieurs(dossier, corrige) : [];
  const g1 = don('G1');
  const justes = evenements.filter((e) => g1['c_' + e.id] === e.attendu);
  note += evenements.length ? (4 * justes.length) / evenements.length : 4;
  if (evenements.length) constats.push(`G1 : ${justes.length} événement(s) postérieur(s) correctement traité(s) sur ${evenements.length}.`);
  // G2 — lettre d'affirmation (2 points)
  const g2 = don('G2').texte;
  const crochets = typeof g2 === 'string' ? (g2.match(/\[[^\]]+\]/g) || []).length : 99;
  if (crochets <= 2) note += 2; else constats.push("G2 : lettre d'affirmation non finalisée.");
  // G3 — note de synthèse (3 points)
  const g3 = don('G3');
  const rubriques = ['contexte', 'risques', 'travaux', 'anomalies', 'suspens', 'conclusion'].filter((k) => rempli(g3[k], 40)).length;
  note += (3 * rubriques) / 6;
  if (rubriques < 6) constats.push(`G3 : ${6 - rubriques} rubrique(s) de la note de synthèse peu ou pas renseignée(s).`);
  // G4 — opinion (8 points)
  const g4 = don('G4');
  const seuilPropre = dossier.seuils?.signification || lireNombre(don('C1').signification) || Math.round(dossier.chiffres.N.produitsExploitation * 0.01);
  const seuilRef = Math.round(dossier.chiffres.N.produitsExploitation * 0.01);
  const propre = ajustements.filter((a) => a.decision !== 'corrigee').reduce((t, a) => t + Math.abs(impactResultat(a)), 0);
  const reel = cumulReel(corrige?.anomalies || [], comparaison, ajustements);
  const coherente = opinionPour(propre, seuilPropre);
  const appropriee = opinionPour(reel, seuilRef);
  if (!g4.opinion) constats.push("G4 : aucune opinion formulée.");
  else {
    if (g4.opinion === coherente) note += 5;
    else constats.push(`G4 : opinion « ${OPINIONS_LIB[g4.opinion]} » incohérente avec vos propres constats (anomalies non corrigées de ${euro(propre)} pour un seuil de ${euro(seuilPropre)} : ${OPINIONS_LIB[coherente]} attendue).`);
    if (g4.opinion === appropriee) note += 2;
    else constats.push(`G4 : au vu de la situation réelle (anomalies non corrigées ou non détectées : ${euro(reel)}), l'opinion appropriée était : ${OPINIONS_LIB[appropriee]}.`);
    if (rempli(g4.justification, 150) || (g4.opinion !== 'sans_reserve' && rempli(g4.fondement, 100))) note += 1; else constats.push("G4 : choix de l'opinion insuffisamment justifié.");
  }
  if (ajustements.some((a) => !a.presente)) constats.push("E1 : des ajustements n'ont pas été présentés à la direction avant la clôture.");
  return { note: borne(note), constats, opinion: { choisie: g4.opinion || null, coherente, appropriee, propre, reel, seuilPropre, seuilRef }, evenements: evenements.map((e) => ({ ...e, reponse: g1['c_' + e.id] || '' })) };
}

/** Ajoute aux anomalies les tiers qu'une circularisation ferait réagir. */
export function ajouterTiers(anomalies, donnees, lignesN, tiers) {
  const parTiers = anomaliesParTiers(anomalies, donnees, lignesN, tiers);
  return anomalies.map((a) => ({ ...a, tiers: [...parTiers].filter(([, liste]) => liste.some((x) => x.type === a.type)).map(([num]) => num) }));
}

// ------------------------------------------------------------------ Évaluation complète
/**
 * revue : { significatifs: [identifiants des variations significatives de B3] }.
 * Renvoie l'évaluation enregistrée dans le dossier à la clôture.
 */
export function evaluerMission({ dossier, corrige, feuilles, documents, revue }) {
  const anomalies = corrige?.anomalies || [];
  const ajustements = dossier.ajustements || [];
  const comparaison = comparer(anomalies, ajustements, corrige?.donnees);
  const sections = {
    detection: noterDetection(anomalies, comparaison, ajustements),
    travaux: noterTravaux(dossier, feuilles, documents, anomalies),
    planification: noterPlanification(dossier, anomalies, revue),
    seuils: noterSeuils(dossier),
    finalisation: noterFinalisation(dossier, corrige, comparaison),
  };
  const globale = arrondi(Object.entries(PONDERATIONS).reduce((s, [k, poids]) => s + sections[k].note * poids, 0));
  const ratees = comparaison.resultats.filter((r) => r.perimetre && !r.trouvee).map((r) => anomalies.find((a) => a.id === r.anomalieId));
  return {
    date: new Date().toISOString(), globale, sections, comparaison,
    resume: {
      perimetre: comparaison.resultats.filter((r) => r.perimetre).length,
      trouvees: comparaison.resultats.filter((r) => r.perimetre && r.trouvee).length,
      faussesAlertes: comparaison.faussesAlertes.length,
      typesRates: ratees.map((a) => a.type),
      cyclesRates: ratees.map((a) => a.cycle),
      parCycle: Object.fromEntries(Object.keys(CYCLES).map((c) => {
        const r = comparaison.resultats.filter((x) => x.perimetre && anomalies.find((a) => a.id === x.anomalieId).cycle === c);
        return [c, { total: r.length, trouvees: r.filter((x) => x.trouvee).length }];
      }).filter(([, v]) => v.total)),
    },
    ia: null, erreurIA: null,
  };
}

/** Commentaire qualitatif de l'IA (rôle de l'associé signataire). Les notes ne changent pas. */
export async function commenterParIA({ dossier, corrige, evaluation, feuilles, parametres }) {
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  const t = (code, cle) => String(dossier.elements?.[code]?.donnees?.[cle] || '').slice(0, 700) || '(vide)';
  const anomalies = corrige.anomalies;
  const parId = new Map(anomalies.map((a) => [a.id, a]));
  const ajs = new Map((dossier.ajustements || []).map((a) => [a.id, a]));
  const decrire = (aj) => `« ${aj.description.slice(0, 200)} » — correction : ${aj.lignes.map((l) => `${lireNombre(l.debit) ? 'D' : 'C'} ${l.compte} ${lireNombre(l.debit) || lireNombre(l.credit)}`).join(', ')}`;
  const systeme = `Tu es l'associé signataire d'un cabinet de commissariat aux comptes. Tu corriges le dossier d'un collaborateur junior qui s'entraîne. Référentiel : normes ${N}. Tu es exigeant, précis, bienveillant et concret ; tu t'adresses au collaborateur avec « vous ». Tu cites une norme par son numéro uniquement si elle s'applique réellement. Les notes sont déjà calculées : tu ne les modifies pas et tu ne les recalcules pas. Tu réponds uniquement par un objet JSON valide, en français.`;
  const utilisateur = `CLIENT : ${dossier.client.nom} — ${dossier.client.secteur}, ${dossier.client.effectif} salariés. ${dossier.client.contexteMission}
Produits d'exploitation : ${euro(dossier.chiffres.N.produitsExploitation)} ; résultat net : ${euro(dossier.chiffres.N.resultatNet)} ; total bilan : ${euro(dossier.chiffres.N.totalBilan)}.

NOTES CALCULÉES (sur 20) : ${Object.entries(evaluation.sections).map(([k, s]) => `${SECTIONS[k]} : ${s.note}`).join(' ; ')} ; note globale : ${evaluation.globale}.
CONSTATS AUTOMATIQUES : ${Object.values(evaluation.sections).flatMap((s) => s.constats).join(' ')}

OPINION : choisie ${evaluation.sections.finalisation.opinion.choisie || 'aucune'} ; cohérente avec ses constats : ${evaluation.sections.finalisation.opinion.coherente} ; appropriée au vu de la réalité : ${evaluation.sections.finalisation.opinion.appropriee}. Justification : ${t('G4', 'justification')}
SEUILS DU COLLABORATEUR : base ${t('C1', 'base')}, taux ${t('C1', 'taux')} %, signification ${t('C1', 'signification')}, planification ${t('C1', 'planification')}, insignifiantes ${t('C1', 'insignifiant')}. Justification : ${t('C1', 'justification')}
RISQUES IDENTIFIÉS (B1) : ${t('B1', 'risques')}
RISQUE DE FRAUDE (B4) : ${t('B4', 'fraude')}

ANOMALIES DU PÉRIMÈTRE NOTÉ :
${evaluation.comparaison.resultats.filter((r) => r.perimetre).map((r) => { const a = parId.get(r.anomalieId); return `- ${a.libelle} (${euro(a.montant)}) : ${r.trouvee ? `TROUVÉE${r.chiffrage ? '' : ', chiffrage inexact'} — ${r.ajustements.map((id) => decrire(ajs.get(id))).join(' ; ')}` : `RATÉE — procédure qui l'aurait détectée : ${a.procedure}`}`; }).join('\n') || '(aucune)'}
FAUSSES ALERTES : ${evaluation.comparaison.faussesAlertes.map((id) => decrire(ajs.get(id))).join(' ; ') || 'aucune'}

FEUILLES DE TRAVAIL DU CYCLE TRÉSORERIE :
${feuilles.filter((f) => f.cycle === 'tresorerie').slice(0, 8).map((f) => `${f.ref} « ${f.titre} » — objectif : ${f.objectif.slice(0, 200) || '(vide)'} — travail : ${f.travail.slice(0, 300) || '(vide)'} — conclusion : ${f.conclusion.slice(0, 200) || '(vide)'}`).join('\n') || '(aucune)'}

Réponds avec ce JSON :
{
  "detection": "2 à 4 phrases sur les anomalies trouvées et ratées, et la qualité des écritures de correction",
  "travaux": "2 à 4 phrases sur la documentation des travaux (feuilles, procédures, éléments probants)",
  "planification": "2 à 4 phrases sur la prise de connaissance, l'évaluation des risques et le lien avec les anomalies réelles",
  "seuils": "2 à 3 phrases sur le choix de la base, du taux et des seuils dérivés",
  "finalisation": "2 à 4 phrases sur la revue, les événements postérieurs, la note de synthèse et le choix de l'opinion",
  "synthese": "3 à 5 phrases de synthèse",
  "points_a_retravailler": ["3 à 5 points concrets, chacun avec la technique ou la norme à revoir"]
}`;
  const r = await demanderJSON({ cle: parametres.cleGroq, modele: parametres.modele, systeme, utilisateur, temperature: 0.3, maxTokens: 1800 });
  const texte = (v) => (typeof v === 'string' ? v.trim().slice(0, 1500) : '');
  return {
    detection: texte(r.detection), travaux: texte(r.travaux), finalisation: texte(r.finalisation), planification: texte(r.planification), seuils: texte(r.seuils), synthese: texte(r.synthese),
    points: (Array.isArray(r.points_a_retravailler) ? r.points_a_retravailler : []).map(texte).filter(Boolean).slice(0, 6),
  };
}

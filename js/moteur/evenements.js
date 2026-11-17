// Événements postérieurs à la clôture (ISA 560) : liste déterministe mêlant des événements liés aux
// anomalies cachées (qui confirment une situation existant à la clôture : ils ajustent les comptes)
// et des événements ordinaires (nés après la clôture : information en annexe, ou sans incidence).
import { aleatoire, dateFr, euro } from '../utils.js';

export const CLASSES_EVENEMENT = {
  ajustant: 'Ajuste les comptes (situation existant à la clôture)',
  annexe: "Information en annexe (situation née après la clôture)",
  sans_incidence: 'Sans incidence sur les comptes',
};

export function evenementsPosterieurs(dossier, corrige) {
  const annee = Number(dossier.exercice.cloture.slice(0, 4));
  const rnd = aleatoire((dossier.scenario.graine ^ 0x51ed) >>> 0);
  const types = new Set((corrige?.anomalies || []).map((a) => a.type));
  const post = corrige?.donnees?.posterieur || {};
  const d = (mois, jour) => `${annee + 1}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  const ca = dossier.chiffres.N.chiffreAffaires;
  const liste = [];
  const procedure = (post.faits || []).find((f) => f.type === 'procedure_collective');
  if (types.has('client_procedure_collective') && procedure) {
    liste.push({ id: 'EV-PC', date: d(2, 6), texte: `Courrier du mandataire liquidateur de ${procedure.client} : l'actif disponible ne permettra aucun paiement aux créanciers chirographaires.`, attendu: 'ajustant',
      explication: "La liquidation était prononcée avant la clôture : le courrier confirme l'irrécouvrabilité d'une créance existant au 31/12. La dépréciation doit être comptabilisée dans les comptes de l'exercice." });
  }
  const avoir = (post.avoirs || [])[0];
  if (types.has('avoirs_post_cloture') && avoir) {
    liste.push({ id: 'EV-AV', date: avoir.date, texte: `Accord transactionnel avec ${avoir.client} : avoir total émis le ${dateFr(avoir.date)} sur une livraison de décembre contestée dès sa réception.`, attendu: 'ajustant',
      explication: "Le litige est né avant la clôture (livraison de décembre contestée) : l'avoir précise une situation existant au 31/12 et doit être rattaché à l'exercice." });
  }
  if (types.has('creances_anciennes')) {
    liste.push({ id: 'EV-CR', date: d(3, 3), texte: "Aucun encaissement reçu en janvier et février sur les factures clients émises au premier trimestre de l'exercice audité, malgré trois relances.", attendu: 'ajustant',
      explication: "L'absence d'encaissement postérieur confirme le risque d'irrécouvrabilité de créances existant à la clôture : elles doivent être dépréciées." });
  }
  const ordinaires = [
    { id: 'EV-INC', date: d(2, rnd.entier(9, 20)), texte: `Incendie d'un entrepôt loué le ${dateFr(d(2, 14))} ; dommages estimés à ${euro(Math.round(ca * 0.01 / 1000) * 1000)}, en partie couverts par l'assurance.`, attendu: 'annexe',
      explication: "Le sinistre est né après la clôture : il ne modifie pas les comptes de l'exercice mais, s'il est significatif, il est mentionné en annexe." },
    { id: 'EV-ACQ', date: d(3, rnd.entier(2, 20)), texte: "Signature d'un protocole d'acquisition d'une société concurrente, financée par un emprunt bancaire.", attendu: 'annexe',
      explication: "Opération décidée après la clôture : information en annexe si elle est significative, sans modification des comptes." },
    { id: 'EV-PRIX', date: d(1, rnd.entier(10, 28)), texte: 'Hausse de 6 % des tarifs des principaux fournisseurs annoncée pour le second trimestre.', attendu: 'sans_incidence',
      explication: "Événement de gestion courante, sans lien avec la situation à la clôture et sans caractère exceptionnel : aucune incidence." },
    { id: 'EV-RH', date: d(2, rnd.entier(2, 26)), texte: 'Démission du directeur commercial, remplacé par un recrutement interne.', attendu: 'sans_incidence',
      explication: 'Événement courant de la vie de l\'entreprise, sans incidence sur les comptes ni information requise.' },
    { id: 'EV-AUG', date: d(3, rnd.entier(10, 28)), texte: "L'assemblée a décidé une augmentation de capital en numéraire, souscrite par un nouvel investisseur.", attendu: 'annexe',
      explication: "Opération sur le capital postérieure à la clôture : information en annexe, sans modification des comptes de l'exercice." },
  ];
  liste.push(...rnd.melanger(ordinaires).slice(0, rnd.entier(3, 4)));
  return liste.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Position de la direction sur les ajustements présentés (simulation déterministe) : la direction
 * accepte les corrections, sauf celles qui réduisent fortement le résultat (au moins 30 % du seuil
 * de signification), qu'elle refuse — dans la limite de deux refus, les plus fortes.
 */
export function positionDirection(ajustements, seuilSignification, impactResultat) {
  const refusables = ajustements.filter((a) => impactResultat(a) < 0 && Math.abs(impactResultat(a)) >= seuilSignification * 0.3)
    .sort((a, b) => impactResultat(a) - impactResultat(b)).slice(0, 2).map((a) => a.id);
  return new Map(ajustements.map((a) => [a.id, refusables.includes(a.id)
    ? { decision: 'non_corrigee', commentaire: "La direction refuse la correction : elle conteste votre analyse et souhaite maintenir les comptes en l'état." }
    : { decision: 'corrigee', commentaire: 'La direction accepte la correction, comptabilisée dans les comptes définitifs.' }]));
}

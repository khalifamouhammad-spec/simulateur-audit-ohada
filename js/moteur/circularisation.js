// Circularisation (ISA 505) : réponses simulées des tiers, déterministes et cohérentes avec le journal
// et les anomalies cachées. Un tiers concerné par une anomalie répond par un désaccord chiffré,
// un commentaire révélateur ou une non-réponse ; les autres répondent en accord, avec quelques
// non-réponses et écarts de rapprochement explicables (règlements en transit) qui ne sont pas des anomalies.
import { aleatoire, ajouterJours, dateFr, euro } from '../utils.js';
import { COL } from './plan.js';

const c = (n) => Math.round(n * 100);

// Effet d'une anomalie sur le solde que le tiers confirmera : soldeTiers = soldeComptable − ajustement.
const REGLES = {
  ventes_fictives: { reponse: 'desaccord', facteur: 1, texte: (m) => `Nous n'avons passé aucune commande correspondant aux factures de fin décembre (${euro(m)}) et ne les reconnaissons pas.` },
  ventes_cutoff: { reponse: 'desaccord', facteur: 1, texte: (m) => `Les factures datées du 31/12 (${euro(m)}) portent sur des livraisons reçues en janvier ; elles ne figurent pas dans notre solde au 31/12.` },
  avoirs_post_cloture: { reponse: 'desaccord', facteur: 1, texte: (m) => `La facture de décembre (${euro(m)}) est contestée depuis sa livraison (marchandises non conformes) ; un avoir nous a été promis.` },
  clients_crediteurs: { reponse: 'desaccord', facteur: 1, texte: (m, x) => (x > 0 ? `Notre virement de ${euro(m)} a bien été débité de notre compte : la facture correspondante est réglée.` : `Nous ne vous avons adressé aucun règlement de ${euro(m)} ; nous ne sommes pas à l'origine de ce versement.`) },
  doublon_facture: { reponse: 'desaccord', facteur: 0.5, texte: (m) => `Notre relevé ne comporte qu'une seule fois la facture de ${euro(m)} que vous semblez avoir enregistrée deux fois.` },
  fnp_oubliees: { reponse: 'desaccord', facteur: 1, texte: (m) => `Notre solde inclut la prestation réalisée en décembre, facturée en janvier (${euro(m)}).` },
  cheque_ancien: { reponse: 'desaccord', facteur: 1, texte: (m) => `Nous n'avons jamais encaissé le chèque de ${euro(m)} que vous mentionnez ; la facture correspondante reste due.` },
  creances_anciennes: { reponse: 'accord', facteur: 0, texte: () => 'Solde confirmé. Nous traversons des difficultés de trésorerie et aucun règlement n\'est envisageable à court terme.' },
  doublon_paiement: { reponse: 'accord', facteur: 0, texte: (m) => `Solde confirmé : nous avons reçu deux règlements pour la même facture (${euro(m)}) et tenons ce montant à votre disposition.` },
  client_procedure_collective: { reponse: 'non_reponse', facteur: 0, texte: () => 'Pli retourné par La Poste avec la mention « Société en liquidation judiciaire — s\'adresser au mandataire ».' },
};

/**
 * Tiers concernés par chaque anomalie, avec l'effet de l'anomalie sur leur solde (centimes).
 * Renvoie Map numTiers → [{ type, ajustement, montant }].
 */
export function anomaliesParTiers(anomalies, donnees, lignesN, tiers) {
  const parNum = new Map();
  const ajouter = (num, type, ajustement, montant) => { if (!num) return; if (!parNum.has(num)) parNum.set(num, []); parNum.get(num).push({ type, ajustement, montant }); };
  const numParNom = new Map([...(tiers?.clients || []), ...(tiers?.fournisseurs || [])].map((t) => [t.nom, t.num]));
  const lignesParNum = new Map();
  for (const l of lignesN) { const n = l[COL.EcritureNum]; if (!lignesParNum.has(n)) lignesParNum.set(n, []); lignesParNum.get(n).push(l); }
  for (const a of anomalies) {
    const regle = REGLES[a.type];
    if (!regle) continue;
    if (a.type === 'fnp_oubliees') {
      for (const f of donnees?.posterieur?.factures || []) if (!f.provisionnee) ajouter(numParNom.get(f.fournisseur), a.type, f.ht + f.tva, f.ht + f.tva);
      continue;
    }
    if (a.type === 'cheque_ancien') {
      for (const x of donnees?.banque?.chequesNonDebites || []) ajouter(numParNom.get(x.fournisseur), a.type, x.montant, x.montant);
      continue;
    }
    const effet = new Map();
    for (const e of a.ecritures.filter((x) => x.exercice === 'N')) for (const l of lignesParNum.get(e.num) || []) {
      if (!l[COL.CompAuxNum] || !/^4(01|81|11)/.test(l[COL.CompteNum])) continue;
      effet.set(l[COL.CompAuxNum], (effet.get(l[COL.CompAuxNum]) || 0) + c(l[COL.Debit]) - c(l[COL.Credit]));
    }
    for (const [num, x] of effet) ajouter(num, a.type, Math.round(x * regle.facteur), Math.abs(Math.round(x * regle.facteur)) || Math.abs(x));
  }
  return parNum;
}

/** Soldes comptables par tiers au 31/12 (centimes, débit − crédit) pour un préfixe de comptes. */
export function soldesTiers(lignesN, prefixe) {
  const soldes = new Map();
  for (const l of lignesN) {
    if (!l[COL.CompAuxNum] || !l[COL.CompteNum].startsWith(prefixe)) continue;
    const t = soldes.get(l[COL.CompAuxNum]) || { num: l[COL.CompAuxNum], nom: l[COL.CompAuxLib], solde: 0 };
    t.solde += c(l[COL.Debit]) - c(l[COL.Credit]);
    soldes.set(t.num, t);
  }
  return soldes;
}

/**
 * Réponses de tiers sélectionnés. selection : numéros de tiers ; type : 'clients' | 'fournisseurs'.
 * Renvoie [{ num, nom, reponse, soldeComptable, soldeConfirme, ecart, commentaire, recueLe }] (euros).
 */
export function reponsesTiers({ selection, type, lignesN, anomalies, donnees, tiers, graine, annee }) {
  const soldes = soldesTiers(lignesN, type === 'clients' ? '411' : '40');
  const parTiers = anomaliesParTiers(anomalies, donnees, lignesN, tiers);
  return selection.map((num) => {
    const rnd = aleatoire((graine ^ [...num].reduce((s, ch) => s * 33 + ch.charCodeAt(0), 5381)) >>> 0);
    const s = soldes.get(num) || { num, nom: num, solde: 0 };
    const recueLe = ajouterJours(`${annee + 1}-01-20`, rnd.entier(0, 25));
    const base = { num, nom: s.nom, soldeComptable: s.solde / 100 };
    const liees = parTiers.get(num) || [];
    if (liees.length) {
      if (liees.some((x) => REGLES[x.type].reponse === 'non_reponse')) {
        return { ...base, reponse: 'non_reponse', soldeConfirme: null, ecart: null, commentaire: liees.map((x) => REGLES[x.type].texte(x.montant / 100, x.ajustement)).join(' '), recueLe: null };
      }
      const ajustement = liees.reduce((t, x) => t + (REGLES[x.type].facteur ? x.ajustement : 0), 0);
      const confirme = s.solde - ajustement;
      return { ...base, reponse: ajustement ? 'desaccord' : 'accord', soldeConfirme: confirme / 100, ecart: (s.solde - confirme) / 100,
        commentaire: liees.map((x) => REGLES[x.type].texte(x.montant / 100, x.ajustement)).join(' '), recueLe };
    }
    // Tiers sans anomalie : non-réponse ou écart de rapprochement explicable dans une minorité de cas
    const tirage = rnd();
    if (tirage < 0.15) return { ...base, reponse: 'non_reponse', soldeConfirme: null, ecart: null, commentaire: 'Aucune réponse malgré une relance.', recueLe: null };
    if (tirage < 0.32 && s.solde !== 0) {
      const transit = Math.min(Math.abs(s.solde), Math.round(Math.abs(s.solde) * (0.2 + rnd() * 0.5) / 100) * 100);
      const date = `${annee}-12-${rnd.entier(29, 31)}`;
      const confirme = s.solde > 0 ? s.solde - transit : s.solde + transit;
      return { ...base, reponse: 'desaccord', soldeConfirme: confirme / 100, ecart: (s.solde - confirme) / 100, recueLe,
        commentaire: type === 'clients' ? `Écart dû à notre virement de ${euro(transit / 100)} émis le ${dateFr(date)}, que vous avez dû recevoir début janvier.` : `Écart dû à votre règlement de ${euro(transit / 100)} du ${dateFr(date)}, reçu par nous le ${dateFr(ajouterJours(date, 5))}.` };
    }
    return { ...base, reponse: 'accord', soldeConfirme: s.solde / 100, ecart: 0, commentaire: 'Solde confirmé.', recueLe };
  });
}

/** Confirmation bancaire : solde du relevé, emprunts, engagements et personnes habilitées. */
export function confirmationBanque({ banque, lignesN, dossier }) {
  let emprunt = 0;
  for (const l of lignesN) if (l[COL.CompteNum].startsWith('164')) emprunt += c(l[COL.Credit]) - c(l[COL.Debit]);
  return {
    soldeCompte: banque.soldeCloture, capitalRestantDu: emprunt / 100,
    engagements: 'Aucune caution ni garantie donnée par la banque pour le compte de la société. Aucun autre compte ouvert.',
    habilites: `${dossier.client.dirigeant} (signature seule jusqu'à ${euro(dossier.seuilAutorisation)}, double signature au-delà).`,
  };
}

/** Lettre de demande de confirmation (texte). */
export function lettreConfirmation({ dossier, tiers, type, annee }) {
  const objet = type === 'banque' ? 'confirmation des soldes, emprunts, engagements et signatures' : `confirmation du solde de nos comptes au 31/12/${annee}`;
  return `${dossier.client.nom}
${dossier.client.ville}

${tiers}

Objet : ${objet}

Madame, Monsieur,

Dans le cadre de l'audit de nos comptes de l'exercice clos le 31/12/${annee}, nous vous prions de bien vouloir indiquer directement à notre commissaire aux comptes, à l'adresse ci-dessous, ${type === 'banque' ? "le solde de nos comptes, le capital restant dû de nos emprunts, les engagements donnés ou reçus et les personnes habilitées à faire fonctionner nos comptes" : `le solde de notre compte dans vos livres au 31/12/${annee}, accompagné d'un relevé détaillé des factures et règlements non soldés`}.

Cette demande ne constitue pas une demande de paiement.

Réponse à adresser à : [Cabinet du commissaire aux comptes — adresse]

Pour ${dossier.client.nom}
${dossier.client.dirigeant}`;
}

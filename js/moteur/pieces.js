// Pièces justificatives : construites par le code à partir de l'écriture du journal, donc toujours
// cohérentes avec la comptabilité. Les anomalies cachées se traduisent par des indices dans la
// pièce (date de livraison, absence de justificatif, duplicata…), jamais par une mention explicite.
// L'IA peut seulement enrichir le libellé des lignes de facture (voir sections/pieces-ia).
import { aleatoire, ajouterJours, dateFr, euro } from '../utils.js';
import { COL } from './plan.js';

const c = (n) => Math.round(n * 100);
const e = (x) => x / 100;

/** Regroupe les lignes du journal d'une écriture. */
export function ecritureDepuisFec(lignes, num) {
  const ls = lignes.filter((l) => l[COL.EcritureNum] === num);
  if (!ls.length) return null;
  const l0 = ls[0];
  return {
    num, journal: l0[COL.JournalCode], date: l0[COL.EcritureDate], piece: l0[COL.PieceRef], pieceDate: l0[COL.PieceDate], lib: l0[COL.EcritureLib], utilisateur: l0[COL.Utilisateur],
    lignes: ls.map((l) => ({ compte: l[COL.CompteNum], compteLib: l[COL.CompteLib], aux: l[COL.CompAuxNum], auxLib: l[COL.CompAuxLib], debit: c(l[COL.Debit]), credit: c(l[COL.Credit]) })),
  };
}

const jourSemaine = (d) => ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][new Date(d + 'T00:00:00Z').getUTCDay()];
const somme = (lignes, motif, sens) => lignes.filter((l) => motif.test(l.compte)).reduce((s, l) => s + (sens === 'd' ? l.debit - l.credit : l.credit - l.debit), 0);

/**
 * ecriture : résultat de ecritureDepuisFec. contexte : { dossier, exercice, anomalies (du corrigé, liées à
 * cette écriture), donnees (données cachées) }. Renvoie le document, sans identifiant.
 */
export function construirePiece(ecriture, { dossier, exercice, anomalies = [], donnees = {} }) {
  const types = anomalies.map((a) => a.type);
  const a = (type) => anomalies.find((x) => x.type === type);
  const rnd = aleatoire((dossier.scenario.graine + [...ecriture.num].reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7)) >>> 0);
  const client = dossier.client;
  const tiers = ecriture.lignes.find((l) => l.aux);
  const base = { exercice, ecritureNum: ecriture.num, journal: ecriture.journal, reference: ecriture.piece, date: ecriture.pieceDate, lignes: [], totaux: null, mentions: [], annexes: [] };
  const societe = `${client.nom} — ${client.formeJuridique}, ${client.ville}`;

  if (ecriture.journal === 'VE') {
    const ht = somme(ecriture.lignes, /^70/, 'c'); const tva = somme(ecriture.lignes, /^443/, 'c'); const ttc = somme(ecriture.lignes, /^411/, 'd');
    const doc = { ...base, type: 'facture_vente', titre: `Facture de vente ${ecriture.piece}`, emetteur: societe, destinataire: tiers?.auxLib || 'Client',
      lignes: [{ designation: client.activite.split(/[.:;]/)[0], montant: e(ht) }], totaux: { ht: e(ht), tva: e(tva), ttc: e(ttc) } };
    if (types.includes('ventes_fictives')) {
      doc.annexes.push({ titre: 'Bon de commande et bon de livraison', texte: "Demandés au client : aucun bon de commande ni bon de livraison n'a pu être présenté. Le client indique que « la commande a été passée par téléphone »." });
    } else {
      const fait = (donnees.posterieur?.faits || []).find((f) => f.type === 'livraison' && f.piece === ecriture.piece);
      const livraison = fait ? fait.date : ajouterJours(ecriture.date, -rnd.entier(0, 3));
      doc.annexes.push({ titre: `Bon de livraison BL-${ecriture.piece.split('-').pop()}`, texte: `Marchandises ou prestations réceptionnées par ${doc.destinataire}. Bon signé par le client le ${dateFr(livraison)}.` });
    }
    if (tva === 0 && !dossier.parametres.secteur.startsWith('assoc')) doc.mentions.push(`Client établi au Sénégal, assujetti à la TVA. Facture émise sans TVA, sans mention d'exonération.`);
    const avoir = (donnees.posterieur?.avoirs || []).find((x) => x.piece === ecriture.piece);
    if (avoir) doc.annexes.push({ titre: 'Correspondance au dossier', texte: `Courriel du client du ${dateFr(ajouterJours(ecriture.date, 4))} : contestation de la livraison (${avoir.motif.toLowerCase()}).` });
    return doc;
  }

  if (ecriture.journal === 'AC') {
    const immo = ecriture.lignes.find((l) => /^2/.test(l.compte));
    const charge = ecriture.lignes.find((l) => /^[26]/.test(l.compte));
    const ht = charge ? charge.debit : 0; const tva = somme(ecriture.lignes, /^445/, 'd'); const ttc = somme(ecriture.lignes, /^4(0|81)/, 'c');
    const designation = ecriture.lib.replace(tiers?.auxLib || '', '').trim() || charge?.compteLib;
    const doc = { ...base, type: 'facture_achat', titre: `Facture fournisseur ${ecriture.piece}`, emetteur: tiers?.auxLib || 'Fournisseur', destinataire: societe,
      lignes: [{ designation, montant: e(ht) }], totaux: { ht: e(ht), tva: e(tva), ttc: e(ttc) } };
    doc.mentions.push(`Imputation comptable : ${charge?.compte} ${charge?.compteLib}.`);
    if (immo && types.includes('charges_immobilisees')) doc.mentions.push("Détail du devis joint : main-d'œuvre, pièces d'usure et consommables. Intervention sur du matériel existant, sans remplacement d'un composant ni allongement de la durée d'utilisation.");
    if (ecriture.pieceDate !== ecriture.date && types.includes('doublon_facture')) doc.mentions.push(`Exemplaire portant le tampon « DUPLICATA », reçu par courrier de relance. Facture originale datée du ${dateFr(ecriture.pieceDate)}.`);
    return doc;
  }

  if (ecriture.journal === 'BQ') {
    const banque = ecriture.lignes.find((l) => l.compte === '521000');
    const contre = ecriture.lignes.find((l) => l.compte !== '521000');
    const entree = banque.debit > 0;
    const doc = { ...base, type: 'avis_operation', titre: `Avis d'opération bancaire ${ecriture.piece}`, emetteur: 'Banque du client', destinataire: societe,
      lignes: [{ designation: `${entree ? 'Crédit' : 'Débit'} en compte — ${ecriture.lib}`, montant: e(entree ? banque.debit : banque.credit) }],
      totaux: null };
    doc.mentions.push(`Contrepartie comptable : ${contre?.compte} ${contre?.compteLib}${contre?.auxLib ? ` (${contre.auxLib})` : ''}.`);
    if (types.some((t) => ['fournisseur_inconnu', 'montants_sous_seuil'].includes(t))) {
      doc.mentions.push(`Ordre de virement saisi et validé par un seul utilisateur (${ecriture.utilisateur}). Montant inférieur au seuil de double signature de ${euro(dossier.seuilAutorisation)}.`);
      doc.annexes.push({ titre: 'Justificatif du paiement', texte: "Demandé au client : aucune facture, aucun contrat ni bon de commande n'a pu être présenté. Le bénéficiaire ne figure pas au fichier des fournisseurs." });
    } else if (types.includes('doublon_paiement')) {
      doc.annexes.push({ titre: 'Justificatif du paiement', texte: `Facture jointe à l'ordre de virement : il s'agit de la même facture que celle jointe à un autre règlement du même fournisseur, quelques jours plus tôt.` });
    } else if (types.includes('cession_non_enregistree')) {
      doc.annexes.push({ titre: 'Document joint', texte: "Certificat de cession d'un véhicule utilitaire de la société, signé du dirigeant, et copie du chèque de banque de l'acquéreur." });
    } else if (contre && /^40/.test(contre.compte)) {
      doc.annexes.push({ titre: 'Justificatif du paiement', texte: `Facture ${contre.auxLib} portant le bon à payer, jointe à l'ordre de paiement.` });
    } else if (contre && /^411/.test(contre.compte)) {
      const autre = types.includes('clients_crediteurs');
      doc.annexes.push({ titre: "Avis de crédit de la banque", texte: autre ? `Donneur d'ordre figurant sur l'avis de la banque : ${ecriture.lib.replace(/^Encaissement \S+ /, '')}.` : `Donneur d'ordre : ${contre.auxLib}.` });
    }
    return doc;
  }

  if (ecriture.journal === 'PA') {
    const brut = somme(ecriture.lignes, /^6611/, 'd'); const net = somme(ecriture.lignes, /^422/, 'c'); const patronales = somme(ecriture.lignes, /^6641/, 'd');
    const doc = { ...base, type: 'journal_paie', titre: `Journal de paie ${ecriture.piece.replace('PAIE-', '')}`, emetteur: 'Logiciel de paie', destinataire: societe,
      lignes: [{ designation: 'Salaires bruts', montant: e(brut) }, { designation: 'Cotisations salariales (IPRES, IPM) et retenues fiscales (IR, TRIMF)', montant: e(brut - net) }, { designation: 'Net à payer', montant: e(net) }], totaux: null };
    const oubli = a('charges_sociales_non_rattachees');
    doc.lignes.push({ designation: 'Cotisations patronales (état des charges du logiciel de paie)', montant: oubli ? oubli.montant : e(patronales) });
    doc.mentions.push(`Effectif payé : ${client.effectif} salariés.`);
    return doc;
  }

  // Opérations diverses et à-nouveaux
  const doc = { ...base, type: 'note_od', titre: `Justificatif de l'écriture ${ecriture.num}`, emetteur: societe, destinataire: 'Dossier comptable',
    lignes: ecriture.lignes.map((l) => ({ designation: `${l.compte} ${l.compteLib}${l.auxLib ? ` — ${l.auxLib}` : ''}`, montant: e(l.debit || -l.credit) })), totaux: null };
  if (types.includes('od_weekend')) {
    doc.annexes.push({ titre: 'Pièce justificative', texte: `Aucune pièce. Écriture saisie manuellement par l'utilisateur ${ecriture.utilisateur} le ${jourSemaine(ecriture.date)} ${dateFr(ecriture.date)}. Interrogé, le comptable indique ne pas en être l'auteur.` });
  } else if (/^STK/.test(ecriture.piece) && donnees.inventaire) {
    doc.annexes.push({ titre: "Procès-verbal d'inventaire physique", texte: `Valeur totale du stock compté et valorisé d'après le procès-verbal signé : ${euro(e(donnees.inventaire.stockReel))}.` });
  } else if (/^CP-/.test(ecriture.piece)) {
    const manque = a('cp_sous_evalues');
    const comptabilise = somme(ecriture.lignes, /^66/, 'd');
    doc.annexes.push({ titre: 'État des droits à congés (logiciel de paie)', texte: `Droits acquis et non pris au 31/12, charges sociales comprises : ${euro(e(comptabilise) + (manque ? manque.montant : 0))}.` });
  } else if (/^IS-/.test(ecriture.piece)) {
    doc.annexes.push({ titre: "Calcul de l'impôt établi par le client", texte: `Taux appliqué par le client au résultat comptable : ${a('is_mal_calcule') ? '25 %' : '30 %'}, avec comparaison au minimum forfaitaire (0,5 % du chiffre d'affaires).` });
  } else if (/^DOT-/.test(ecriture.piece)) {
    doc.annexes.push({ titre: 'Tableau des immobilisations', texte: `Dotation de l'exercice par compte d'amortissement : ${ecriture.lignes.filter((l) => /^28/.test(l.compte)).map((l) => `${l.compte} : ${euro(e(l.credit))}`).join(' ; ')}. Les autres catégories ne font l'objet d'aucune dotation dans le tableau remis.` });
  } else if (/^FNP/.test(ecriture.piece)) {
    doc.annexes.push({ titre: 'Justificatif', texte: 'Bon de réception de décembre et facture reçue en janvier, joints.' });
  } else {
    doc.annexes.push({ titre: 'Justificatif', texte: 'Feuille de calcul du service comptable, jointe au dossier de clôture.' });
  }
  return doc;
}

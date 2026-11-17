// Documents bancaires du client, reconstruits de façon déterministe à partir du journal :
// relevés de l'exercice N et de janvier N+1, et état de rapprochement au 31/12 établi par le client.
// Les écarts entre la banque et la comptabilité viennent uniquement des données cachées du dossier
// (opérations non comptabilisées, chèques jamais débités).
import { aleatoire, ajouterJours } from '../utils.js';
import { COL } from './plan.js';

const c = (n) => Math.round(n * 100);
const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
const ouvre = (d) => { while ([0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay())) d = ajouterJours(d, 1); return d; };

function libelleBanque(piece, lib) {
  const texte = sansAccent(lib);
  if (piece.startsWith('CHQ')) return `CHEQUE ${piece.slice(3)}`;
  if (piece.startsWith('PRLV')) return `PRLV SEPA ${texte.replace(/^(ECHEANCE|FRAIS ET COMMISSIONS BANCAIRES)/, '$1')}`;
  if (piece.startsWith('CB')) return `REMISE CARTES BANCAIRES ${piece}`;
  if (piece.startsWith('ENC')) return `VIR SEPA RECU ${texte.replace(/^ENCAISSEMENT\s*/, '')}`;
  return `VIR SEPA ${texte.replace(/^(VIREMENT|REGLEMENT)\s*/, '')}`;
}

/**
 * lignesFec : FEC de l'exercice N. donnees : données cachées du corrigé (montants en centimes).
 * Renvoie { soldeOuverture, lignes, rapprochement } — montants en euros, positifs = entrées d'argent.
 */
export function construireBanque(lignesFec, donnees, { graine, annee, difficulte }) {
  const rnd = aleatoire((graine ^ 0x5f3759df) >>> 0);
  const fin = `${annee}-12-31`;
  let soldeCompta = 0;
  const mouvements = [];
  for (const l of lignesFec) {
    if (l[COL.CompteNum] !== '521000') continue;
    const m = c(l[COL.Debit]) - c(l[COL.Credit]);
    if (l[COL.JournalCode] === 'AN') { soldeCompta += m; continue; }
    const piece = l[COL.PieceRef];
    const delai = piece.startsWith('CHQ') ? rnd.entier(2, 7) : piece.startsWith('ENC') ? rnd.entier(0, 1) : 0;
    mouvements.push({ id: 'R-' + l[COL.EcritureNum], num: l[COL.EcritureNum], dateCompta: l[COL.EcritureDate], date: delai ? ouvre(ajouterJours(l[COL.EcritureDate], delai)) : l[COL.EcritureDate],
      piece, libCompta: l[COL.EcritureLib], lib: libelleBanque(piece, l[COL.EcritureLib]), montant: m });
  }
  const soldeOuvertureCompta = soldeCompta;
  const anciens = (donnees?.banque?.chequesNonDebites || []).map((x, i) => ({ id: 'CHQ-ANCIEN-' + i, piece: x.piece, dateCompta: x.date, libCompta: `Chèque ${x.fournisseur}`, lib: `CHEQUE ${x.piece.slice(3)}`, montant: -x.montant, ancien: true }));
  const nonComptabilises = (donnees?.banque?.nonComptabilises || []).map((x, i) => ({ id: 'NC-' + i, date: x.date, piece: '', lib: x.lib, montant: x.montant, nonComptabilise: true }));

  // Relevés : toutes les opérations vues par la banque, dans l'ordre des dates de valeur.
  const soldeOuverture = soldeOuvertureCompta + anciens.reduce((s, x) => s - x.montant, 0); // les vieux chèques n'ont jamais été débités
  const lignes = [...mouvements, ...nonComptabilises].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let solde = soldeOuverture; let soldeFin = soldeOuverture;
  for (const l of lignes) { solde += l.montant; l.solde = solde; if (l.date <= fin) soldeFin = solde; }
  soldeCompta += mouvements.reduce((s, m) => s + m.montant, 0);

  // Rapprochement réel au 31/12
  const suspens = [...anciens, ...mouvements.filter((m) => m.date > fin)].sort((a, b) => a.dateCompta.localeCompare(b.dateCompta));
  const totalSuspens = suspens.reduce((s, x) => s + x.montant, 0);
  const totalNonComptabilise = nonComptabilises.reduce((s, x) => s + x.montant, 0);
  const boucle = soldeCompta + totalNonComptabilise === soldeFin + totalSuspens;

  // État présenté par le client : au niveau confirmé, les opérations non comptabilisées sont
  // noyées dans une ligne d'écart « en cours d'analyse » au lieu d'être listées.
  const masque = difficulte === 'confirme' && nonComptabilises.length > 0;
  const coteCompta = masque ? [] : nonComptabilises;
  const rectifieCompta = soldeCompta + coteCompta.reduce((s, x) => s + x.montant, 0);
  const rectifieBanque = soldeFin + totalSuspens;
  const e = (x) => x / 100;
  const sortie = (x) => ({ ...x, montant: e(x.montant), solde: x.solde == null ? undefined : e(x.solde) });
  return {
    soldeOuverture: e(soldeOuverture), soldeCloture: e(soldeFin), lignes: lignes.map(sortie), boucle,
    rapprochement: {
      date: fin, soldeCompta: e(soldeCompta), soldeBanque: e(soldeFin),
      coteCompta: coteCompta.map(sortie), coteBanque: suspens.map(sortie),
      soldeRectifieCompta: e(rectifieCompta), soldeRectifieBanque: e(rectifieBanque),
      ecart: e(rectifieBanque - rectifieCompta), libelleEcart: masque ? "Écart en cours d'analyse (régularisation N+1)" : null,
    },
  };
}

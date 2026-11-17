// Contrôles et états SYSCOHADA calculés à partir des lignes du journal. Aucun chiffre ne vient de l'IA.
import { COL } from './plan.js';

const c = (n) => Math.round(n * 100);

/**
 * Contrôles du journal : équilibre de chaque écriture, équilibre général, dates dans l'exercice,
 * numérotation continue par journal, lettrage équilibré, champs obligatoires.
 */
export function verifierFec(lignes, { debut, fin }) {
  const erreurs = [];
  const signaler = (msg) => { if (erreurs.length < 30) erreurs.push(msg); };
  const ecritures = new Map();
  const lettrages = new Map();
  let debit = 0; let credit = 0;
  for (const l of lignes) {
    const num = l[COL.EcritureNum];
    const d = c(l[COL.Debit]); const k = c(l[COL.Credit]);
    if (!l[COL.JournalCode] || !num || !l[COL.EcritureDate] || !l[COL.CompteNum] || !l[COL.CompteLib] || !l[COL.PieceRef] || !l[COL.PieceDate] || !l[COL.EcritureLib] || !l[COL.ValidDate]) signaler(`Écriture ${num} : champ obligatoire vide (compte ${l[COL.CompteNum]}).`);
    if (d < 0 || k < 0 || (d > 0 && k > 0) || (d === 0 && k === 0)) signaler(`Écriture ${num} : montant invalide sur le compte ${l[COL.CompteNum]}.`);
    if (l[COL.EcritureDate] < debut || l[COL.EcritureDate] > fin) signaler(`Écriture ${num} : date ${l[COL.EcritureDate]} hors exercice.`);
    if (/^4(01|08|11|81)/.test(l[COL.CompteNum]) && !l[COL.CompAuxNum]) signaler(`Écriture ${num} : compte de tiers ${l[COL.CompteNum]} sans compte auxiliaire.`);
    const e = ecritures.get(num) || { journal: l[COL.JournalCode], date: l[COL.EcritureDate], solde: 0, lignes: 0 };
    if (e.date !== l[COL.EcritureDate] || e.journal !== l[COL.JournalCode]) signaler(`Écriture ${num} : lignes de dates ou de journaux différents.`);
    e.solde += d - k; e.lignes++;
    ecritures.set(num, e);
    debit += d; credit += k;
    if (l[COL.EcritureLet]) {
      const cle = `${l[COL.CompteNum]}|${l[COL.CompAuxNum]}|${l[COL.EcritureLet]}`;
      lettrages.set(cle, (lettrages.get(cle) || 0) + d - k);
      if (!l[COL.DateLet]) signaler(`Écriture ${num} : lettrage sans date.`);
    }
  }
  const compteurs = {};
  for (const [num, e] of ecritures) {
    if (e.solde !== 0) signaler(`Écriture ${num} déséquilibrée (écart ${e.solde / 100}).`);
    if (e.lignes < 2) signaler(`Écriture ${num} : une seule ligne.`);
    const rang = Number(num.slice(e.journal.length));
    compteurs[e.journal] = (compteurs[e.journal] || 0) + 1;
    if (rang !== compteurs[e.journal]) signaler(`Journal ${e.journal} : rupture de numérotation à ${num}.`);
  }
  for (const [cle, solde] of lettrages) if (solde !== 0) signaler(`Lettrage déséquilibré : ${cle}.`);
  if (debit !== credit) signaler(`Total débit (${debit / 100}) différent du total crédit (${credit / 100}).`);
  return { erreurs, nbLignes: lignes.length, nbEcritures: ecritures.size, totalDebit: debit / 100, totalCredit: credit / 100 };
}

/** Balance générale : une ligne par compte. */
export function calculerBalance(lignes) {
  const comptes = new Map();
  for (const l of lignes) {
    const num = l[COL.CompteNum];
    const x = comptes.get(num) || { compte: num, libelle: l[COL.CompteLib], debit: 0, credit: 0 };
    x.debit += c(l[COL.Debit]); x.credit += c(l[COL.Credit]);
    comptes.set(num, x);
  }
  return [...comptes.values()].sort((a, b) => a.compte.localeCompare(b.compte)).map((x) => {
    const solde = x.debit - x.credit;
    return { compte: x.compte, libelle: x.libelle, debit: x.debit / 100, credit: x.credit / 100, soldeDebiteur: solde > 0 ? solde / 100 : 0, soldeCrediteur: solde < 0 ? -solde / 100 : 0 };
  });
}

// Rubriques du bilan et du compte de résultat SYSCOHADA révisé (références des états).
const ACTIF = [
  ['AI Immobilisations corporelles (valeur brute)', /^2[0-7]/], ['Amortissements et dépréciations des immobilisations', /^2[89]/], ['BB Stocks et encours', /^3/],
  ['BI Clients', /^41/], ['BJ Autres créances', /^4/], ['BS Trésorerie-Actif (banques, caisse)', /^5/],
];
const PASSIF = [
  ['CA Capital', /^10/], ['CG Réserves', /^11/], ['CH Report à nouveau', /^12/], ["CJ Résultat net de l'exercice", /^13/],
  ['DA Emprunts et dettes financières', /^1[4-9]/], ["DJ Fournisseurs d'exploitation", /^40/], ['DK Dettes fiscales et sociales', /^4[2-4]/], ['DM Autres dettes', /^4/], ['DQ Trésorerie-Passif', /^5/],
];
const RANG_RESULTAT_BILAN = 3;
const RESULTAT = [
  ['TA Ventes de marchandises', /^701/, 'exploitation'], ['RA Achats de marchandises', /^601/, 'exploitation'], ['RB Variation de stocks de marchandises', /^6031/, 'exploitation'],
  ['TB Ventes de produits fabriqués', /^702/, 'exploitation'], ['TC Travaux, services vendus', /^70[3-6]/, 'exploitation'], ['TD Produits accessoires', /^70[7-9]/, 'exploitation'],
  ["TG Subventions d'exploitation", /^71/, 'exploitation'], ['TH Autres produits', /^7[2-6]/, 'exploitation'], ['TI Transferts de charges', /^78/, 'exploitation'],
  ['RC Achats de matières premières', /^602/, 'exploitation'], ['RD Variation de stocks de matières premières', /^6032/, 'exploitation'], ['RE Autres achats', /^60[4-9]/, 'exploitation'],
  ['RF Variation de stocks d\'autres approvisionnements', /^603/, 'exploitation'], ['RG Transports', /^61/, 'exploitation'], ['RH Services extérieurs', /^6[23]/, 'exploitation'],
  ['RI Impôts et taxes', /^64/, 'exploitation'], ['RJ Autres charges', /^65/, 'exploitation'], ['RK Charges de personnel', /^66/, 'exploitation'],
  ['TJ Reprises d\'amortissements, provisions et dépréciations', /^79/, 'exploitation'], ['RL Dotations aux amortissements, provisions et dépréciations', /^6[89]/, 'exploitation'],
  ['TK Revenus financiers', /^77/, 'financier'], ['RM Frais financiers', /^67/, 'financier'],
  ['TN Produits des cessions d\'immobilisations', /^82/, 'hao'], ['TO Autres produits HAO', /^8[4-8]/, 'hao'], ['RO Valeurs comptables des cessions d\'immobilisations', /^81/, 'hao'], ['RP Autres charges HAO', /^8[35]/, 'hao'],
  ['RS Impôts sur le résultat', /^89/, 'impot'],
];
const code = (libelle) => libelle.split(' ')[0];

/**
 * Bilan et compte de résultat. Les comptes de tiers sont classés d'après leur solde par compte
 * auxiliaire (un client créditeur va au passif, un fournisseur débiteur à l'actif).
 */
export function calculerEtats(lignes) {
  const soldes = new Map(); // compte|aux -> { compte, libelle, solde }
  for (const l of lignes) {
    const cle = `${l[COL.CompteNum]}|${l[COL.CompAuxNum]}`;
    const x = soldes.get(cle) || { compte: l[COL.CompteNum], libelle: l[COL.CompteLib], solde: 0 };
    x.solde += c(l[COL.Debit]) - c(l[COL.Credit]);
    soldes.set(cle, x);
  }
  const rubriques = (definition) => definition.map(([libelle]) => ({ libelle, montant: 0, comptes: new Map() }));
  const actif = rubriques(ACTIF); const passif = rubriques(PASSIF); const resultat = rubriques(RESULTAT);
  const ajouter = (rubrique, x, montant) => { rubrique.montant += montant; rubrique.comptes.set(x.compte, (rubrique.comptes.get(x.compte) || 0) + montant); };
  for (const x of soldes.values()) {
    if (!x.solde) continue;
    const classe = x.compte[0];
    if ('678'.includes(classe)) {
      const i = RESULTAT.findIndex(([, motif]) => motif.test(x.compte));
      if (i >= 0) ajouter(resultat[i], x, -x.solde); // produits positifs, charges négatives
      continue;
    }
    const cotePassif = classe === '1' || ((classe === '4' || classe === '5') && x.solde < 0);
    if (cotePassif) ajouter(passif[PASSIF.findIndex(([, motif]) => motif.test(x.compte))], x, -x.solde);
    else ajouter(actif[ACTIF.findIndex(([, motif]) => motif.test(x.compte))], x, x.solde);
  }
  const total = (liste) => liste.reduce((s, r) => s + r.montant, 0);
  const resultatCompte = total(resultat);
  const totalActif = total(actif);
  const resultatBilan = totalActif - total(passif); // résultat non encore viré au compte 13
  passif[RANG_RESULTAT_BILAN].montant += resultatBilan;
  // Soldes intermédiaires de gestion SYSCOHADA
  const m = (...codes) => resultat.filter((r) => codes.includes(code(r.libelle))).reduce((s, r) => s + r.montant, 0);
  const XA = m('TA', 'RA', 'RB');
  const XB = m('TA', 'TB', 'TC', 'TD');
  const XC = XB + m('RA', 'RB', 'TG', 'TH', 'TI', 'RC', 'RD', 'RE', 'RF', 'RG', 'RH', 'RI', 'RJ');
  const XD = XC + m('RK');
  const XE = XD + m('TJ', 'RL');
  const XF = m('TK', 'RM');
  const XG = XE + XF;
  const XH = m('TN', 'TO', 'RO', 'RP');
  const XI = XG + XH + m('RS');
  const sortie = (liste) => liste.map((r) => ({ libelle: r.libelle, montant: r.montant / 100, comptes: [...r.comptes].sort((a, b) => a[0].localeCompare(b[0])).map(([compte, v]) => ({ compte, montant: v / 100 })) }));
  const capitauxPropres = passif.slice(0, RANG_RESULTAT_BILAN + 1).reduce((s, r) => s + r.montant, 0);
  return {
    actif: sortie(actif), passif: sortie(passif), resultat: sortie(resultat),
    sig: [['XA', 'Marge commerciale', XA], ['XB', "Chiffre d'affaires", XB], ['XC', 'Valeur ajoutée', XC], ['XD', "Excédent brut d'exploitation", XD], ['XE', "Résultat d'exploitation", XE],
      ['XF', 'Résultat financier', XF], ['XG', 'Résultat des activités ordinaires', XG], ['XH', 'Résultat hors activités ordinaires', XH], ['XI', 'Résultat net', XI]].map(([ref, libelle, v]) => ({ ref, libelle, montant: v / 100 })),
    totalActif: totalActif / 100, totalPassif: total(passif) / 100,
    agregats: {
      chiffreAffaires: XB / 100, produitsExploitation: (XB + m('TG', 'TH', 'TI')) / 100, valeurAjoutee: XC / 100, ebe: XD / 100,
      resultatExploitation: XE / 100, resultatFinancier: XF / 100, resultatExceptionnel: XH / 100,
      impot: -m('RS') / 100, resultatNet: resultatCompte / 100, totalBilan: totalActif / 100, capitauxPropres: capitauxPropres / 100,
    },
    controles: {
      bilanEquilibre: totalActif === total(passif),
      resultatIdentique: resultatBilan === resultatCompte && XI === resultatCompte,
      resultatBilan: resultatBilan / 100, resultatCompteDeResultat: resultatCompte / 100,
    },
  };
}

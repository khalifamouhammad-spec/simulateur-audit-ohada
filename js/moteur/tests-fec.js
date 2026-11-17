// Tests sur le journal des écritures (ISA 240) : écritures du week-end, montants ronds, paiements
// juste sous le seuil d'autorisation, doublons, utilisateurs peu fréquents, écritures de fin
// d'exercice, comptes d'attente, décaissements imputés directement en charges.
import { COL } from './plan.js';

const c = (n) => Math.round(n * 100);
const PIECES_INVENTAIRE = /^(DOT|STK|CP-|IS-|FNP|DTVA|AN|EXT|AG-)/;

/** Regroupe les lignes par écriture. */
export function ecritures(lignes) {
  const m = new Map();
  for (const l of lignes) {
    const n = l[COL.EcritureNum];
    if (!m.has(n)) m.set(n, { num: n, journal: l[COL.JournalCode], date: l[COL.EcritureDate], piece: l[COL.PieceRef], lib: l[COL.EcritureLib], utilisateur: l[COL.Utilisateur], lignes: [], montant: 0 });
    const e = m.get(n);
    e.lignes.push(l);
    e.montant += c(l[COL.Debit]);
  }
  return [...m.values()];
}

export const TESTS = {
  weekend: {
    titre: 'Écritures passées un samedi ou un dimanche',
    description: "Les écritures saisies hors des jours ouvrés n'ont en principe pas de raison d'être : elles peuvent traduire un contournement des contrôles.",
    executer: (es) => es.filter((e) => e.journal !== 'AN' && [0, 6].includes(new Date(e.date + 'T00:00:00Z').getUTCDay())),
  },
  ronds: {
    titre: 'Montants ronds (multiples de 1 000 000 FCFA)',
    description: 'Les montants ronds sont rares dans une activité normale : ils signalent des estimations, des opérations manuelles ou fictives.',
    executer: (es) => es.filter((e) => e.journal !== 'AN' && e.montant >= 100000000 && e.montant % 100000000 === 0),
  },
  sousSeuil: {
    titre: 'Décaissements juste sous le seuil de double signature (85 à 100 %)',
    description: "Une concentration de paiements juste sous le seuil d'autorisation peut traduire un fractionnement destiné à éviter la double signature.",
    // ctx.seuilAutorisation est exprimé en centimes.
    executer: (es, ctx) => es.filter((e) => e.journal === 'BQ' && e.lignes.some((l) => l[COL.CompteNum] === '521000' && c(l[COL.Credit]) >= ctx.seuilAutorisation * 0.85 && c(l[COL.Credit]) < ctx.seuilAutorisation)),
  },
  doublons: {
    titre: 'Doublons : même tiers, même montant, à moins de 15 jours d\'intervalle',
    description: 'Une même facture enregistrée ou payée deux fois gonfle les charges ou crée une créance sur le fournisseur.',
    executer: (es) => {
      const parCle = new Map();
      for (const e of es) {
        if (!['AC', 'BQ', 'VE'].includes(e.journal)) continue;
        const l = e.lignes.find((x) => x[COL.CompAuxNum]);
        if (!l) continue;
        const cle = `${e.journal}|${l[COL.CompAuxNum]}|${c(l[COL.Debit]) - c(l[COL.Credit])}`;
        if (!parCle.has(cle)) parCle.set(cle, []);
        parCle.get(cle).push(e);
      }
      const retenues = new Set();
      for (const liste of parCle.values()) {
        liste.sort((a, b) => a.date.localeCompare(b.date));
        for (let i = 1; i < liste.length; i++) {
          if ((Date.parse(liste[i].date) - Date.parse(liste[i - 1].date)) / 86400000 <= 15 || liste[i].piece === liste[i - 1].piece) { retenues.add(liste[i - 1]); retenues.add(liste[i]); }
        }
      }
      return es.filter((e) => retenues.has(e));
    },
  },
  utilisateurs: {
    titre: 'Écritures des utilisateurs peu fréquents (moins de 3 % des saisies)',
    description: 'Les écritures passées par un utilisateur qui saisit rarement (direction, stagiaire, administrateur) méritent une revue.',
    executer: (es) => {
      const compte = new Map();
      for (const e of es) compte.set(e.utilisateur, (compte.get(e.utilisateur) || 0) + 1);
      const rares = new Set([...compte].filter(([, n]) => n < es.length * 0.03).map(([u]) => u));
      return es.filter((e) => e.journal !== 'AN' && rares.has(e.utilisateur));
    },
  },
  finExercice: {
    titre: "Ventes et opérations diverses des trois derniers jours de l'exercice (hors écritures d'inventaire)",
    description: 'Les écritures de toute fin d\'exercice concentrent le risque de séparation des exercices et d\'habillage du résultat.',
    executer: (es, ctx) => es.filter((e) => ['VE', 'OD'].includes(e.journal) && e.date >= `${ctx.annee}-12-29` && !PIECES_INVENTAIRE.test(e.piece)),
  },
  attente: {
    titre: "Écritures sur le compte d'attente 471",
    description: "Le compte d'attente doit être soldé à la clôture : tout mouvement doit être expliqué et reclassé.",
    executer: (es) => es.filter((e) => e.lignes.some((l) => l[COL.CompteNum].startsWith('471'))),
  },
  banqueCharges: {
    titre: 'Décaissements imputés directement en charges, sans compte fournisseur',
    description: 'Un paiement comptabilisé directement en charge depuis la banque échappe au circuit de validation des factures.',
    executer: (es) => es.filter((e) => e.journal === 'BQ' && e.lignes.some((l) => /^6/.test(l[COL.CompteNum]) && !/^(631|671)/.test(l[COL.CompteNum]))),
  },
};

export function executerTest(id, lignes, ctx) {
  return TESTS[id].executer(ecritures(lignes), ctx);
}

// Bibliothèque d'anomalies types, tirées de cas fréquents en mission.
// Chaque entrée : libellé, cycle, assertion, procédure de détection, conditions d'emploi,
// et « injecter(o, injection) » qui modifie les écritures de l'exercice N.
//   o : outils du générateur (livre, ventes, achats, paies, immos, cloture, donnees, vendre, acheter…)
//   injection.echelle : montant visé en centimes (dépend de la difficulté et du chiffre d'affaires)
// injecter renvoie le chiffrage { ecritures, comptes, montant, impactResultat, explication, correction }
// (montants en centimes), ou une fonction appelée après la clôture quand le chiffrage en dépend,
// ou null si l'anomalie ne peut pas être placée dans ce dossier.
// impactResultat : effet de la correction sur le résultat avant impôt (négatif = le résultat baisse).
import { euro, dateFr, ajouterJours } from '../utils.js';
import { CATEGORIES_IMMO, PLAN } from './plan.js';

const E = (centimes) => euro(centimes / 100);
const somme = (liste, f) => liste.reduce((s, x) => s + f(x), 0);
const proche = (liste, cible, valeur) => liste.reduce((meilleur, x) => (!meilleur || Math.abs(valeur(x) - cible) < Math.abs(valeur(meilleur) - cible) ? x : meilleur), null);
/** Arrondi au franc CFA (montants internes en centièmes) et arrondi à un multiple donné. */
const R = (x) => Math.round(x / 100) * 100;
const arrondi = (centimes, pas) => Math.max(pas, Math.round(centimes / pas) * pas);
const TIERS_DOUTEUX = ['Orion Consulting Ltd', 'MK Advisory', 'Sahel Stratégie Conseil SUARL', 'Global Trade Partners', 'Delta Business Services'];
const CLIENTS_FICTIFS = ['Négoce Horizon Export', 'Société Sahélienne de Diffusion', 'Comptoir Général de la Petite Côte'];

export const BIBLIOTHEQUE = {
  // ------------------------------------------------------------------ Ventes / clients
  ventes_cutoff: {
    libelle: "Chiffre d'affaires de janvier N+1 comptabilisé en décembre N", cycle: 'ventes', assertion: 'Séparation des exercices',
    procedure: "Test de césure : rapprocher les dernières factures de décembre et les premières de janvier avec les bons de livraison ou les procès-verbaux de réception (ISA 500).",
    injecter(o, inj) {
      const ventes = o.repartir(inj.echelle, o.rnd.entier(2, 3), o.rnd, 0.3).map((ht) => {
        const client = o.rnd.choix(o.tiers.clients.slice(0, 8));
        const livraison = o.iso(o.annee + 1, 1, o.rnd.entier(6, 16));
        const v = o.vendre({ client, ht, date: o.dernierJourOuvre, sansReglement: true, lib: o.difficulte === 'debutant' ? `Facture ${client.nom} - livraison prévue le ${dateFr(livraison)}` : undefined });
        o.donnees.posterieur.faits.push({ type: 'livraison', piece: v.piece, date: livraison, texte: `Bon de livraison de la facture ${v.piece} (${client.nom}) signé le ${dateFr(livraison)}.` });
        return v;
      });
      const total = somme(ventes, (v) => v.ht);
      return { ecritures: ventes.map((v) => v.e), comptes: [o.cfg.vente, '411000'], montant: total, impactResultat: -total,
        explication: `${ventes.length} factures datées du ${dateFr(o.dernierJourOuvre)} (${ventes.map((v) => v.piece).join(', ')}) pour ${E(total)} HT correspondent à des livraisons de janvier ${o.annee + 1}. Le chiffre d'affaires et les créances clients de l'exercice sont surévalués.`,
        correction: `Débit ${o.cfg.vente} ${E(total)} + Débit 443100 TVA facturée / Crédit 411000 Clients (produit à rattacher à ${o.annee + 1}).` };
    },
  },
  ventes_fictives: {
    libelle: "Factures de vente fictives en fin d'exercice", cycle: 'ventes', assertion: 'Réalité', fraude: true, niveauMin: 'intermediaire',
    procedure: "Analyse des ventes de fin d'exercice : nouveaux clients, montants ronds, absence d'encaissement postérieur, saisie par un utilisateur inhabituel ; demande des bons de commande et de livraison ; circularisation (ISA 240, ISA 505).",
    injecter(o, inj) {
      const client = { num: 'C' + String(o.tiers.clients.length + 1).padStart(4, '0'), nom: o.rnd.choix(CLIENTS_FICTIFS), compte: '411000', delai: 60 };
      o.tiers.clients.push(client);
      const ht = arrondi(inj.echelle / 2, 100000000);
      const ventes = [0, 1].map((i) => o.vendre({ client, ht, date: o.jourOuvre(o.iso(o.annee, 12, 22 + i * 6), -1), sansReglement: true, utilisateur: o.livre.utilisateurs.inhabituel }));
      ventes.forEach((v) => { v.e.bloque = true; });
      return { ecritures: ventes.map((v) => v.e), comptes: [o.cfg.vente, '411000'], montant: ht * 2, impactResultat: -ht * 2,
        explication: `Deux factures de ${E(ht)} HT chacune ont été émises fin décembre sur ${client.nom}, client créé en décembre, sans commande ni livraison, saisies par l'utilisateur ${o.livre.utilisateurs.inhabituel} et jamais encaissées. Ces ventes sont fictives : le chiffre d'affaires est surévalué de ${E(ht * 2)}.`,
        correction: `Débit ${o.cfg.vente} ${E(ht * 2)} + Débit 443100 / Crédit 411000 ${client.nom} (annulation). Information de la direction et, le cas échéant, de la gouvernance.` };
    },
  },
  avoirs_post_cloture: {
    libelle: 'Avoir émis après la clôture sur une vente de décembre', cycle: 'ventes', assertion: 'Évaluation',
    procedure: "Revue des avoirs émis en janvier et février N+1 et rattachement à l'exercice des faits générateurs antérieurs à la clôture (ISA 560, ISA 500).",
    injecter(o, inj) {
      const client = o.tiers.clients[o.rnd.entier(0, Math.min(4, o.tiers.clients.length - 1))];
      const v = o.vendre({ client, ht: inj.echelle, date: o.jourOuvre(o.iso(o.annee, 12, o.rnd.entier(12, 22))), sansReglement: true });
      const date = o.iso(o.annee + 1, 1, o.rnd.entier(9, 22));
      o.donnees.posterieur.avoirs.push({ client: client.nom, piece: v.piece, date, ht: inj.echelle, motif: 'Retour de marchandises non conformes, litige ouvert avant la clôture' });
      return { ecritures: [v.e], comptes: [o.cfg.vente, '411000'], montant: inj.echelle, impactResultat: -inj.echelle,
        explication: `La facture ${v.piece} (${client.nom}, ${E(inj.echelle)} HT) a fait l'objet d'un avoir total le ${dateFr(date)} pour un litige né avant la clôture. Aucun avoir à établir n'a été comptabilisé au 31/12.`,
        correction: `Débit ${o.cfg.vente} ${E(inj.echelle)} + Débit 443100 / Crédit 419800 Clients - avoirs à établir.` };
    },
  },
  creances_anciennes: {
    libelle: 'Créances clients anciennes non dépréciées', cycle: 'ventes', assertion: 'Évaluation',
    procedure: "Analyse de la balance âgée clients, revue des encaissements postérieurs à la clôture et des relances, appréciation des dépréciations (ISA 500, ISA 540).",
    injecter(o, inj) {
      const n = o.rnd.entier(2, 3);
      const candidates = o.ventes.filter((v) => v.reglement && !v.verrou && v.date < o.iso(o.annee, 4, 30));
      const choisies = [];
      for (let i = 0; i < n; i++) { const v = proche(candidates.filter((x) => !choisies.includes(x)), inj.echelle / n, (x) => x.ht); if (v) choisies.push(v); }
      if (!choisies.length) return null;
      choisies.forEach((v) => { o.annulerReglement(v); v.e.bloque = true; v.verrou = true; });
      const total = somme(choisies, (v) => v.ht);
      return { ecritures: choisies.map((v) => v.e), comptes: ['411000'], montant: total, impactResultat: -total,
        explication: `${choisies.length} factures du premier quadrimestre (${choisies.map((v) => `${v.piece} ${v.client.nom}`).join(' ; ')}) restent impayées à la clôture, soit plus de 240 jours de retard, sans dépréciation ni encaissement postérieur. Créances HT concernées : ${E(total)}.`,
        correction: `Débit 659400 Dotations aux dépréciations des créances ${E(total)} / Crédit 491000 Dépréciations des comptes clients (après reclassement en 416000 Clients douteux).` };
    },
  },
  client_procedure_collective: {
    libelle: 'Client en procédure collective non déprécié', cycle: 'ventes', assertion: 'Évaluation',
    procedure: "Revue des clients significatifs et des impayés, consultation des annonces légales et du greffe, confirmation auprès du mandataire, examen de la déclaration de créance (ISA 500, ISA 540).",
    injecter(o, inj) {
      const client = o.tiers.clients[o.rnd.entier(3, Math.min(9, o.tiers.clients.length - 1))];
      const ventes = o.repartir(inj.echelle, 3, o.rnd, 0.3).map((ht, i) => o.vendre({ client, ht, date: o.jourAleatoire(8 + i), sansReglement: true }));
      ventes.forEach((v) => { v.e.bloque = true; });
      const total = somme(ventes, (v) => v.ht);
      const jugement = o.iso(o.annee, 11, 14);
      o.donnees.posterieur.faits.push({ type: 'procedure_collective', client: client.nom, date: jugement, texte: `${client.nom} : liquidation judiciaire prononcée le ${dateFr(jugement)} (annonce légale).` });
      return { ecritures: ventes.map((v) => v.e), comptes: ['411000'], montant: total, impactResultat: -total,
        explication: `${client.nom} a été placé en liquidation judiciaire le ${dateFr(jugement)}. Ses factures d'août à octobre (${ventes.map((v) => v.piece).join(', ')}), soit ${E(total)} HT, sont impayées et ne sont ni reclassées en clients douteux ni dépréciées.`,
        correction: `Débit 416000 Clients douteux / Crédit 411000 ; puis Débit 659400 ${E(total)} / Crédit 491000 (dépréciation du montant HT).` };
    },
  },
  clients_crediteurs: {
    libelle: "Solde client créditeur anormal (encaissement imputé au mauvais client)", cycle: 'ventes', assertion: 'Classification',
    procedure: "Revue des soldes clients créditeurs et des comptes non lettrés, rapprochement des encaissements avec les avis de virement (ISA 500).",
    injecter(o, inj) {
      const v = proche(o.ventes.filter((x) => x.reglement && !x.verrou), inj.echelle, (x) => x.ttc);
      const autre = o.tiers.clients.find((c) => c !== v?.client && !o.ventes.some((x) => x.client === c && !x.reglement));
      if (!v || !autre) return null;
      const ligne = v.reglement.lignes[1];
      ligne.t = autre;
      v.verrou = true;
      for (const l of [ligne, v.e.lignes[0]]) { l.l = ''; l.dl = ''; }
      return { ecritures: [v.reglement, v.e], comptes: ['411000'], montant: v.ttc, impactResultat: 0,
        explication: `L'encaissement de la facture ${v.piece} (${v.client.nom}, ${E(v.ttc)}) a été imputé sur le compte de ${autre.nom}, qui présente un solde créditeur anormal, tandis que la facture de ${v.client.nom} apparaît impayée. Sans incidence sur le résultat, mais les créances et les dettes sont mal présentées et le client risque d'être relancé ou déprécié à tort.`,
        correction: `Débit 411000 ${autre.nom} ${E(v.ttc)} / Crédit 411000 ${v.client.nom}, puis lettrage.` };
    },
  },

  // ------------------------------------------------------------------ Achats / fournisseurs
  fnp_oubliees: {
    libelle: 'Factures non parvenues oubliées', cycle: 'achats', assertion: 'Exhaustivité',
    procedure: "Recherche des passifs non enregistrés : revue des factures reçues et des décaissements de janvier-février N+1, rapprochement avec les bons de réception de décembre (ISA 500).",
    injecter(o, inj) {
      o.cloture.fnpOubliees = inj.echelle;
      return (c) => {
        const total = somme(c.fnpOubliees, (f) => f.ht);
        return { ecritures: [], comptes: ['408100', ...new Set(c.fnpOubliees.map((f) => f.compte))], montant: total, impactResultat: -total,
          explication: `${c.fnpOubliees.length} prestations réalisées en décembre et facturées en janvier ${o.annee + 1} n'ont pas été provisionnées : ${c.fnpOubliees.map((f) => `${f.fournisseur.nom} (${f.lib.toLowerCase()}, ${E(f.ht)})`).join(' ; ')}. Les charges et les dettes fournisseurs sont sous-évaluées de ${E(total)}.`,
          correction: `Débit ${[...new Set(c.fnpOubliees.map((f) => f.compte))].join(' / ')} ${E(total)} + Débit 445800 TVA sur factures non parvenues / Crédit 408100.` };
      };
    },
  },
  doublon_paiement: {
    libelle: "Facture fournisseur payée deux fois", cycle: 'achats', assertion: 'Réalité',
    procedure: "Recherche de doublons de règlement (même tiers, même montant), revue des soldes fournisseurs débiteurs, circularisation des fournisseurs (ISA 500, ISA 505).",
    injecter(o, inj) {
      const a = proche(o.achats.filter((x) => x.reglement && !x.verrou && x.echeance < o.iso(o.annee, 12, 5)), inj.echelle, (x) => x.ttc);
      if (!a) return null;
      a.verrou = true;
      const date = o.jourOuvre(ajouterJours(a.echeance, o.rnd.entier(4, 10)));
      const e = o.livre.ajouter({ journal: 'BQ', date, piece: o.livre.numero('VIR'), lib: a.reglement.lib, lignes: [o.L('401000', a.ttc, 0, a.fournisseur), o.L('521000', 0, a.ttc)] });
      e.bloque = true;
      return { ecritures: [a.reglement, e], comptes: ['401000', '521000'], montant: a.ttc, impactResultat: 0,
        explication: `La facture ${a.piece} de ${a.fournisseur.nom} (${E(a.ttc)}) a été réglée deux fois, le ${dateFr(a.echeance)} et le ${dateFr(date)}. Le compte fournisseur est débiteur : il s'agit d'une créance à récupérer, à reclasser à l'actif et dont le remboursement doit être demandé.`,
        correction: `Reclassement : Débit 409000 Fournisseurs débiteurs ${E(a.ttc)} / Crédit 401000 ${a.fournisseur.nom}. Pas d'incidence sur le résultat si la somme est récupérable.` };
    },
  },
  doublon_facture: {
    libelle: "Facture d'achat comptabilisée deux fois", cycle: 'achats', assertion: 'Réalité',
    procedure: "Recherche de doublons au journal des achats (même fournisseur, même référence de pièce, même montant), circularisation des fournisseurs (ISA 500, ISA 505).",
    injecter(o, inj) {
      const a = proche(o.achats.filter((x) => !x.verrou && x.date < o.iso(o.annee, 12, 1) && x.ht > 0), inj.echelle, (x) => x.ht);
      if (!a) return null;
      a.verrou = true;
      const date = o.jourOuvre(ajouterJours(a.date, o.rnd.entier(4, 14)));
      const e = o.livre.ajouter({ journal: 'AC', date, piece: a.piece, pieceDate: a.date, lib: a.e.lib, lignes: a.e.lignes.map((l) => o.L(l.c, l.d, l.k, l.t)) });
      e.bloque = true;
      return { ecritures: [a.e, e], comptes: [a.e.lignes[0].c, '401000'], montant: a.ht, impactResultat: a.ht,
        explication: `La facture ${a.piece} de ${a.fournisseur.nom} (${E(a.ht)} HT) est enregistrée deux fois au journal des achats, le ${dateFr(a.date)} et le ${dateFr(date)}. Les charges, la TVA déductible et la dette fournisseur sont surévaluées.`,
        correction: `Débit 401000 ${a.fournisseur.nom} ${E(a.ttc)} / Crédit ${a.e.lignes[0].c} ${E(a.ht)} + Crédit 445200 ${E(a.tva)} (annulation du doublon).` };
    },
  },
  fournisseur_inconnu: {
    libelle: 'Fournisseur inconnu payé par virement sans facture', cycle: 'achats', assertion: 'Réalité', fraude: true,
    procedure: "Revue des décaissements significatifs ou inhabituels, contrôle de l'existence du tiers, de la facture, du contrat et de l'autorisation de paiement (ISA 240, ISA 500).",
    injecter(o, inj) {
      const nom = o.rnd.choix(TIERS_DOUTEUX);
      const n = o.rnd.entier(1, 2);
      const montant = arrondi(inj.echelle / n, 100000000);
      const es = Array.from({ length: n }, (_, i) => o.livre.ajouter({ journal: 'BQ', date: o.jourOuvre(o.iso(o.annee, 12, 9 + i * 9)), piece: o.livre.numero('VIR'), utilisateur: o.livre.utilisateurs.inhabituel,
        lib: `Virement ${nom} - prestation de conseil`, lignes: [o.L('632400', montant, 0), o.L('521000', 0, montant)] }));
      return { ecritures: es, comptes: ['632400', '521000'], montant: montant * n, impactResultat: -montant * n,
        explication: `${n} virement(s) de ${E(montant)} ont été émis en décembre vers ${nom}, tiers absent du fichier fournisseurs, comptabilisés directement en honoraires depuis le journal de banque, sans facture ni contrat, par l'utilisateur ${o.livre.utilisateurs.inhabituel}. Risque de détournement ou de charge fictive : ${E(montant * n)}.`,
        correction: `À défaut de justificatif : Débit 471100 Débiteurs divers ${E(montant * n)} / Crédit 632400, puis appréciation de la dépréciation. Signalement à la direction et à la gouvernance.` };
    },
  },

  // ------------------------------------------------------------------ Stocks
  stock_surevalue: {
    libelle: "Stock final surévalué (erreur de valorisation)", cycle: 'stocks', assertion: 'Évaluation', applicable: (cfg) => !!cfg.stock,
    procedure: "Assistance à l'inventaire physique, rapprochement de l'état de stock valorisé avec le procès-verbal d'inventaire, test des coûts unitaires sur les dernières factures d'achat (ISA 501).",
    injecter(o, inj) {
      o.cloture.stockErreur = inj.echelle;
      return (c) => ({ ecritures: [c.odStock], comptes: [o.cfg.stock, o.cfg.varStock], montant: inj.echelle, impactResultat: -inj.echelle,
        explication: `Le stock comptabilisé au 31/12 (${E(c.stockFinal)}) excède de ${E(inj.echelle)} la valeur issue de l'inventaire physique (${E(c.stockFinal - inj.echelle)}) : des références ont été valorisées à un coût unitaire erroné. Le résultat est surévalué d'autant.`,
        correction: `Débit ${o.cfg.varStock} ${E(inj.echelle)} / Crédit ${o.cfg.stock}.` });
    },
  },

  // ------------------------------------------------------------------ Immobilisations
  charges_immobilisees: {
    libelle: "Charges d'entretien immobilisées à tort", cycle: 'immobilisations', assertion: 'Classification',
    procedure: "Revue des acquisitions de l'exercice sur facture : nature de la dépense, critères de comptabilisation d'un actif (ISA 500).",
    injecter(o, inj) {
      const lib = o.rnd.choix(['Réparation et remise en état des machines', 'Entretien annuel et révision du matériel', "Réfection des peintures de l'atelier"]);
      const r = o.investir({ categorie: CATEGORIES_IMMO[1], ht: inj.echelle, date: o.jourAleatoire(o.rnd.entier(3, 9)), lib });
      return () => {
        const net = r.immo.brut - r.immo.dotation;
        return { ecritures: [r.e], comptes: ['241000', '624000'], montant: r.immo.brut, impactResultat: -net,
          explication: `La dépense « ${lib} » (${E(r.immo.brut)}) a été immobilisée en matériel industriel alors qu'il s'agit d'entretien courant, qui ne prolonge pas la durée d'utilisation et n'augmente pas la valeur du bien. Après annulation de la dotation pratiquée (${E(r.immo.dotation)}), le résultat est surévalué de ${E(net)}.`,
          correction: `Débit 624000 Entretien et réparations ${E(r.immo.brut)} / Crédit 241000 ; Débit 284100 ${E(r.immo.dotation)} / Crédit 681300.` };
      };
    },
  },
  amortissement_oublie: {
    libelle: "Dotation aux amortissements non comptabilisée", cycle: 'immobilisations', assertion: 'Évaluation',
    procedure: "Recalcul global des dotations à partir du fichier des immobilisations et revue analytique des dotations N / N-1 par catégorie (ISA 520, ISA 500).",
    injecter(o) {
      const annuite = new Map();
      for (const x of o.immos) if (x.brut - x.cumul > x.brut / x.duree) annuite.set(x.amort, (annuite.get(x.amort) || 0) + R(x.brut / x.duree));
      const choix = [...annuite].sort((a, b) => b[1] - a[1])[0];
      if (!choix) return null;
      o.cloture.amortOublie = choix[0];
      return (c) => {
        const total = somme(c.immos.filter((x) => x.amort === choix[0]), (x) => x.dotationOubliee || 0);
        if (!total) return null;
        return { ecritures: [c.odAmort], comptes: [choix[0], '681300'], montant: total, impactResultat: -total,
          explication: `Aucune dotation n'a été comptabilisée en ${o.annee} sur le compte ${choix[0]} (${PLAN[choix[0]]}), alors que les biens ne sont pas totalement amortis. La dotation manquante s'élève à ${E(total)}.`,
          correction: `Débit 681300 ${E(total)} / Crédit ${choix[0]}.` };
      };
    },
  },
  cession_non_enregistree: {
    libelle: "Cession d'immobilisation non enregistrée", cycle: 'immobilisations', assertion: 'Réalité',
    procedure: "Revue du compte d'attente et des encaissements inhabituels, rapprochement du fichier des immobilisations avec l'inventaire physique et les cartes grises (ISA 500).",
    injecter(o) {
      const v = o.immos.find((x) => x.compte === '245000' && x.id.startsWith('OUV'));
      if (!v) return null;
      const mois = o.rnd.entier(4, 10);
      const date = o.jourAleatoire(mois);
      const prix = arrondi((v.brut - v.cumul) * (0.5 + o.rnd() * 0.5), 10000000);
      const e = o.livre.ajouter({ journal: 'BQ', date, piece: o.livre.numero('ENC'), lib: o.difficulte === 'confirme' ? 'Encaissement divers à identifier' : `Encaissement vente ${v.lib.toLowerCase()}`, lignes: [o.L('521000', prix, 0), o.L('471000', 0, prix)] });
      return () => {
        const vnc = v.brut - (v.cumul - v.dotation) - R((v.dotation * mois) / 12);
        return { ecritures: [e], comptes: ['471000', '245000', '284500'], montant: prix, impactResultat: prix - vnc,
          explication: `Le ${dateFr(date)}, la société a encaissé ${E(prix)} pour la vente d'un véhicule, laissé en compte d'attente 471000. Le bien (valeur brute ${E(v.brut)}) figure toujours à l'actif et continue d'être amorti. La cession n'est pas enregistrée : ${prix >= vnc ? 'plus' : 'moins'}-value de ${E(Math.abs(prix - vnc))} à constater, et TVA sur la cession à régulariser.`,
          correction: `Débit 471000 ${E(prix)} / Crédit 822000 Produits des cessions ; sortie de l'actif : Débit 812000 (valeur nette comptable ${E(vnc)}) + Débit 284500 / Crédit 245000 ${E(v.brut)}.` };
      };
    },
  },

  // ------------------------------------------------------------------ Trésorerie
  frais_bancaires_non_comptabilises: {
    libelle: 'Frais et agios bancaires non comptabilisés', cycle: 'tresorerie', assertion: 'Exhaustivité',
    procedure: "Contrôle de l'état de rapprochement bancaire au 31/12 et pointage du relevé de décembre avec le grand livre 521 (ISA 500, ISA 505).",
    injecter(o, inj) {
      const m = R(inj.echelle * 0.25);
      o.donnees.banque.nonComptabilises.push({ date: o.dernierJourOuvre, lib: 'ARRETE DE COMPTE - INTERETS ET COMMISSIONS', montant: -m });
      return { ecritures: [], comptes: ['521000', '631000', '671800'], montant: m, impactResultat: -m,
        explication: `L'arrêté de compte du ${dateFr(o.dernierJourOuvre)} (intérêts débiteurs et commissions, ${E(m)}) figure sur le relevé bancaire mais n'est pas comptabilisé à la clôture.`,
        correction: `Débit 631000 Frais bancaires (et 671800 Intérêts bancaires) ${E(m)} / Crédit 521000 Banque.` };
    },
  },
  cheque_ancien: {
    libelle: "Chèque émis non encaissé depuis plus d'un an", cycle: 'tresorerie', assertion: 'Réalité',
    procedure: "Revue de l'ancienneté des suspens de l'état de rapprochement bancaire et de leur apurement sur les relevés postérieurs (ISA 500).",
    injecter(o, inj) {
      const a = proche((o.precedent?.achats || []).filter((x) => x.reglement && x.fournisseur.mode === 'cheque' && x.echeance < o.iso(o.annee - 1, 11, 30)), inj.echelle, (x) => x.ttc);
      if (!a) return null;
      o.donnees.banque.chequesNonDebites.push({ piece: a.reglement.piece, date: a.echeance, montant: a.ttc, fournisseur: a.fournisseur.nom });
      return { ecritures: [a.reglement], comptes: ['521000', '401000'], montant: a.ttc, impactResultat: 0,
        explication: `Le chèque ${a.reglement.piece} émis le ${dateFr(a.echeance)} au profit de ${a.fournisseur.nom} (${E(a.ttc)}) n'a jamais été débité par la banque et figure en suspens au rapprochement depuis plus d'un an. Un chèque est périmé un an après l'expiration du délai de présentation : la trésorerie est minorée à tort et la dette doit être réexaminée.`,
        correction: `Débit 521000 Banque ${E(a.ttc)} / Crédit 401000 ${a.fournisseur.nom} (la dette renaît), ou produit hors activités ordinaires si la dette est prescrite.` };
    },
  },

  // ------------------------------------------------------------------ Personnel
  cp_sous_evalues: {
    libelle: 'Provision pour congés payés sous-évaluée', cycle: 'personnel', assertion: 'Évaluation',
    procedure: "Recalcul de la provision à partir de l'état des droits à congés du logiciel de paie et des salaires de référence, charges sociales comprises (ISA 500, ISA 540).",
    injecter(o) {
      o.cloture.cpFacteur = 0.35 + o.rnd() * 0.2;
      return (c) => {
        const manque = c.cp.complet - c.cp.brut - c.cp.charges;
        return { ecritures: [c.odCp], comptes: ['428100', '438100', '661300', '664800'], montant: manque, impactResultat: -manque,
          explication: `La provision pour congés payés comptabilisée (${E(c.cp.brut + c.cp.charges)} charges comprises) ne couvre qu'une partie des droits acquis à la clôture, évalués à ${E(c.cp.complet)} d'après l'état de la paie. Insuffisance : ${E(manque)}.`,
          correction: `Débit 661300 Congés payés + Débit 664800 Charges sociales sur congés payés ${E(manque)} au total / Crédit 428100 + Crédit 438100.` };
      };
    },
  },
  charges_sociales_non_rattachees: {
    libelle: 'Charges sociales de décembre non rattachées', cycle: 'personnel', assertion: 'Séparation des exercices',
    procedure: "Revue analytique des charges sociales (taux de charges mois par mois), rapprochement avec les déclarations sociales et les paiements de janvier N+1 (ISA 520, ISA 500).",
    injecter(o) {
      const p = o.paies[11];
      p.e.lignes = p.e.lignes.filter((l) => l.c !== '664100' && !(l.c === '431000' && l.k === p.patronales));
      return { ecritures: [p.e], comptes: ['664100', '431000'], montant: p.patronales, impactResultat: -p.patronales,
        explication: `L'écriture de paie de décembre ne comprend pas les cotisations patronales (${E(p.patronales)}), payées en janvier ${o.annee + 1} et comptabilisées à cette date. Le taux de charges de décembre est nul alors qu'il est stable les onze autres mois. Charges et dettes sociales sous-évaluées.`,
        correction: `Débit 664100 Charges sociales ${E(p.patronales)} / Crédit 431000.` };
    },
  },

  // ------------------------------------------------------------------ Fiscal
  tva_collectee_incoherente: {
    libelle: "TVA collectée ne correspondant pas au chiffre d'affaires", cycle: 'fiscal', assertion: 'Exhaustivité', applicable: (cfg) => !cfg.sansTva,
    procedure: "Contrôle de cohérence globale : chiffre d'affaires taxable × taux comparé à la TVA facturée déclarée (déclaration mensuelle de TVA), puis recherche des factures sans TVA (ISA 520, ISA 500).",
    injecter(o, inj) {
      const cible = inj.echelle * 0.4;
      const choisies = [];
      let total = 0;
      for (const v of o.rnd.melanger(o.ventes.filter((x) => !x.verrou && x.date >= o.iso(o.annee, 6, 1) && x.date < o.iso(o.annee, 12, 1) && x.tva > 0))) {
        if (total >= cible || choisies.length >= 6) break;
        if (v.tva > cible) continue;
        v.e.lignes = v.e.lignes.filter((l) => l.c !== '443100');
        v.e.lignes[0].d = v.ht;
        if (v.reglement) { v.reglement.lignes[0].d = v.ht; v.reglement.lignes[1].k = v.ht; }
        total += v.tva;
        v.ttc = v.ht;
        v.verrou = true;
        choisies.push(v);
      }
      if (!choisies.length) return null;
      return { ecritures: choisies.map((v) => v.e), comptes: ['443100', o.cfg.vente], montant: total, impactResultat: -total,
        explication: `${choisies.length} factures à des clients sénégalais assujettis (${choisies.map((v) => v.piece).join(', ')}) ont été émises et comptabilisées sans TVA. La TVA collectée est inférieure de ${E(total)} au produit du chiffre d'affaires taxable par le taux applicable : risque de rappel, majoré de pénalités, à provisionner si la TVA ne peut pas être refacturée.`,
        correction: `Débit 411000 Clients (si refacturation possible) ou 647100 Pénalités et amendes fiscales ${E(total)} / Crédit 443100 TVA facturée.` };
    },
  },
  is_mal_calcule: {
    libelle: 'Impôt sur les sociétés mal calculé', cycle: 'fiscal', assertion: 'Évaluation', applicable: (cfg) => !cfg.sansIs,
    procedure: "Recalcul de l'impôt à partir du résultat comptable et du tableau de détermination du résultat fiscal, contrôle du taux appliqué (ISA 500).",
    injecter(o) {
      o.cloture.tauxIs = 0.25;
      return (c) => {
        if (!c.odIs || c.avantIs <= 0) return null;
        const ecart = c.isDu - Math.max(R(c.avantIs * 0.25), c.imf);
        if (ecart <= 0) return null;
        return { ecritures: [c.odIs], comptes: ['891000', '441000'], montant: ecart, impactResultat: -ecart,
          explication: `L'impôt a été calculé au taux de 25 % sur le résultat (${E(c.avantIs)}), taux applicable avant la réforme du Code général des impôts entrée en vigueur en 2013. Le taux de l'impôt sur les sociétés est de 30 % : insuffisance d'impôt de ${E(ecart)}.`,
          correction: `Débit 891000 Impôt sur les bénéfices ${E(ecart)} / Crédit 441000 État, impôt sur les bénéfices.` };
      };
    },
  },

  // ------------------------------------------------------------------ Spécifiques au contexte OHADA / Sénégal
  manquant_caisse: {
    libelle: 'Manquant de caisse non régularisé', cycle: 'tresorerie', assertion: 'Réalité',
    procedure: "Assistance au comptage de la caisse à la clôture (procès-verbal de caisse avec billetage), rapprochement avec le solde du compte 571 et revue des dépenses réglées en espèces (ISA 500, ISA 240).",
    injecter(o, inj) {
      o.cloture.manquantCaisse = R(inj.echelle * 0.25);
      return (c) => {
        if (!c.caisse?.manquant) return null;
        const m = c.caisse.manquant;
        return { ecritures: [], comptes: ['571000', '658800'], montant: m, impactResultat: -m,
          explication: `Le procès-verbal de comptage de la caisse au 31/12 fait apparaître ${E(c.caisse.soldePV)} en espèces, alors que le compte 571000 présente un solde de ${E(c.caisse.soldeComptable)}. Le manquant de ${E(m)} n'est ni expliqué ni régularisé : la trésorerie est surévaluée, et l'écart peut traduire des dépenses non justifiées ou un détournement.`,
          correction: `Débit 658800 Charges diverses (manquant de caisse) ou 471100 Débiteurs divers (si un responsable est identifié) ${E(m)} / Crédit 571000 Caisse. Renforcer le contrôle de la caisse et informer la direction.` };
      };
    },
  },
  retenues_non_reversees: {
    libelle: 'Retenues sur salaires non reversées à l\'administration fiscale', cycle: 'fiscal', assertion: 'Exhaustivité',
    procedure: "Rapprochement des retenues fiscales du journal de paie (compte 447) avec les déclarations et les paiements mensuels à la DGID, analyse du solde du compte 447 à la clôture (ISA 500, ISA 250).",
    injecter(o) {
      o.cloture.retenuesNonReversees = [9, 10, 11];
      return (c) => {
        const dues = c.paies.filter((p) => [9, 10, 11].includes(p.mois)).reduce((t, p) => t + p.retenues + p.cfce, 0);
        if (!dues) return null;
        const penalites = R(dues * 0.25);
        return { ecritures: c.paies.filter((p) => [9, 10, 11].includes(p.mois)).map((p) => p.e), comptes: ['447200', '647100'], montant: dues, impactResultat: -penalites,
          explication: `Les retenues sur salaires et la CFCE de septembre à novembre (${E(dues)}) ont été prélevées sur les salariés et comptabilisées, mais jamais reversées à la DGID : le compte 447200 présente quatre mois de retenues à la clôture au lieu d'un. L'entreprise est exposée à des pénalités et intérêts de retard, estimés à 25 % (${E(penalites)}), qui ne sont pas provisionnés.`,
          correction: `Débit 647100 Pénalités et amendes fiscales ${E(penalites)} / Crédit 447200 (ou dette fiscale provisionnée) ; régularisation des déclarations auprès de la DGID.` };
      };
    },
  },

  // ------------------------------------------------------------------ Fraude
  od_weekend: {
    libelle: 'Écritures manuelles passées le week-end', cycle: 'achats', assertion: 'Réalité', fraude: true, niveauMin: 'intermediaire',
    procedure: "Tests sur le journal des écritures (ISA 240) : écritures manuelles passées le week-end ou hors horaires, par un utilisateur inhabituel, sans pièce, en compte d'attente.",
    injecter(o, inj) {
      const dimanches = [];
      for (let d = o.iso(o.annee, 11, 15); d <= o.finAnnee; d = ajouterJours(d, 1)) if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) dimanches.push(d);
      const compte = o.cfg.sousTraitance ? '621000' : '624000';
      const es = o.repartir(inj.echelle, 2, o.rnd, 0.2).map((m) => o.livre.ajouter({ journal: 'OD', date: o.rnd.choix(dimanches), piece: 'REGUL', utilisateur: o.livre.utilisateurs.inhabituel,
        lib: 'Régularisation charges - reclassement', lignes: [o.L('471000', m, 0), o.L(compte, 0, m)] }));
      const total = somme(es, (e) => e.lignes[0].d);
      return { ecritures: es, comptes: ['471000', compte], montant: total, impactResultat: -total,
        explication: `Deux opérations diverses saisies un dimanche par l'utilisateur ${o.livre.utilisateurs.inhabituel}, sans pièce justificative, transfèrent ${E(total)} de charges (${compte}) vers le compte d'attente 471000. Elles améliorent artificiellement le résultat : contournement des contrôles par la direction.`,
        correction: `Débit ${compte} ${E(total)} / Crédit 471000 (annulation des écritures injustifiées).` };
    },
  },
  montants_sous_seuil: {
    libelle: "Paiements fractionnés juste sous le seuil d'autorisation", cycle: 'tresorerie', assertion: 'Réalité', fraude: true, niveauMin: 'intermediaire',
    procedure: "Analyse des décaissements par tranche de montant : concentration juste sous le seuil de double signature, même bénéficiaire, dates rapprochées (ISA 240).",
    injecter(o, inj) {
      const seuil = o.P.seuilAutorisation;
      const n = Math.min(7, Math.max(3, Math.round(inj.echelle / seuil)));
      const nom = o.rnd.choix(TIERS_DOUTEUX);
      let date = o.jourOuvre(o.iso(o.annee, o.rnd.entier(10, 11), o.rnd.entier(3, 12)));
      const es = [];
      for (let i = 0; i < n; i++) {
        const m = seuil - o.rnd.entier(1, 12) * 1000000;
        es.push(o.livre.ajouter({ journal: 'BQ', date, piece: o.livre.numero('VIR'), utilisateur: o.livre.utilisateurs.inhabituel, lib: `Virement ${nom} - acompte prestation`, lignes: [o.L('632400', m, 0), o.L('521000', 0, m)] }));
        date = o.jourOuvre(ajouterJours(date, o.rnd.entier(1, 4)));
      }
      const total = somme(es, (e) => e.lignes[0].d);
      return { ecritures: es, comptes: ['632400', '521000'], montant: total, impactResultat: -total,
        explication: `${n} virements compris entre ${E(seuil - 12000000)} et ${E(seuil - 1000000)} ont été émis en quelques jours vers ${nom}, juste sous le seuil de double signature de ${E(seuil)}, sans facture, par l'utilisateur ${o.livre.utilisateurs.inhabituel}. Fractionnement destiné à éviter l'autorisation : ${E(total)} de charges non justifiées.`,
        correction: `À défaut de justificatif : Débit 471100 Débiteurs divers ${E(total)} / Crédit 632400, appréciation de la dépréciation et signalement à la gouvernance.` };
    },
  },
};

const RANG = { debutant: 0, intermediaire: 1, confirme: 2 };

/** Types d'anomalies utilisables pour un secteur et une difficulté. */
export function anomaliesApplicables(cfg, difficulte) {
  return Object.entries(BIBLIOTHEQUE)
    .filter(([, d]) => (!d.applicable || d.applicable(cfg)) && RANG[d.niveauMin || 'debutant'] <= RANG[difficulte])
    .map(([type]) => type);
}

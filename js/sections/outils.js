// Outils d'audit propres aux cycles : balance âgée, lettrage, documents postérieurs à la clôture,
// inventaire, tableau des immobilisations, récapitulatif de paie, cohérence de TVA, capitaux propres.
// Tout est calculé à partir du journal et des données du dossier. Les documents postérieurs mêlent des
// éléments liés aux anomalies cachées et des documents ordinaires, sans les distinguer.
//
// Chaque outil reçoit ctx = { dossier, annee, lignes (journal N), donnees (données cachées), etat, rendre }
// et renvoie { html, items } ; items associe la clé d'une case à cocher à la ligne sélectionnable.
import { aleatoire, ajouterJours, echapper, dateFr, euro, montantOuVide, ecartJours } from '../utils.js';
import { COL, PLAN } from '../moteur/plan.js';
import { reponsesTiers, confirmationBanque, lettreConfirmation, soldesTiers } from '../moteur/circularisation.js';
import { construireBanque } from '../moteur/banque.js';
import { TESTS, executerTest } from '../moteur/tests-fec.js';

const c = (n) => Math.round(n * 100);
const nombre = (n) => montantOuVide(n) || '0';
const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(1).replace('.', ',')} %`);

export const OUTILS = {
  balanceClients: { titre: 'Balance âgée clients', rendre: (ctx) => balanceAgee(ctx, '411', 'lettrageClients') },
  lettrageClients: { titre: 'Lettrage des comptes clients', rendre: (ctx) => lettrage(ctx, '411') },
  avoirs: { titre: 'Avoirs émis après la clôture', rendre: avoirsPosterieurs },
  annonces: { titre: 'Annonces légales et décisions du tribunal de commerce concernant les clients', rendre: annoncesLegales },
  pvCaisse: { titre: 'Procès-verbal de caisse au 31/12', rendre: procesVerbalCaisse },
  balanceFournisseurs: { titre: 'Balance âgée fournisseurs', rendre: (ctx) => balanceAgee(ctx, '40', 'lettrageFournisseurs') },
  lettrageFournisseurs: { titre: 'Lettrage des comptes fournisseurs', rendre: (ctx) => lettrage(ctx, '40') },
  factures: { titre: 'Factures fournisseurs reçues après la clôture', rendre: facturesPosterieures },
  inventaire: { titre: "Procès-verbal d'inventaire et stock comptable", rendre: inventaire },
  tableauImmobilisations: { titre: 'Tableau de variation des immobilisations', rendre: tableauImmobilisations },
  recapitulatifPaie: { titre: 'Récapitulatif mensuel de la paie', rendre: recapitulatifPaie },
  coherenceTva: { titre: "Cohérence chiffre d'affaires / TVA facturée", rendre: coherenceTva },
  capitauxPropres: { titre: 'Variation des capitaux propres et dettes financières', rendre: capitauxPropres },
};

const caseCochee = (ctx, cle) => `<td><input type="checkbox" data-cle="${cle}" ${ctx.panier.has(cle) ? 'checked' : ''} aria-label="Sélectionner la ligne"></td>`;
const itemFec = (l) => ({ cle: `fec|N|${l[COL.EcritureNum]}`, source: 'fec', exercice: 'N', num: l[COL.EcritureNum], date: l[COL.EcritureDate], piece: l[COL.PieceRef], lib: `${l[COL.EcritureLib]}${l[COL.CompAuxLib] ? ` (${l[COL.CompAuxLib]})` : ''}`, compte: l[COL.CompteNum], montant: l[COL.Debit] - l[COL.Credit] });
const itemDoc = (id, date, lib, montant) => ({ cle: `doc|${id}`, source: 'doc', exercice: 'N', id, num: '', date, piece: id, lib, montant });

// ------------------------------------------------------------------ Tiers : lignes ouvertes
function lignesTiers(lignes, prefixe) {
  return lignes.filter((l) => l[COL.CompAuxNum] && l[COL.CompteNum].startsWith(prefixe));
}

function balanceAgee(ctx, prefixe, outilLettrage) {
  const fin = `${ctx.annee}-12-31`;
  const tranches = [['≤ 30 j', 30], ['31-60 j', 60], ['61-90 j', 90], ['91-180 j', 180], ['> 180 j', Infinity]];
  const parTiers = new Map();
  for (const l of lignesTiers(ctx.lignes, prefixe)) {
    const t = parTiers.get(l[COL.CompAuxNum]) || { num: l[COL.CompAuxNum], nom: l[COL.CompAuxLib], solde: 0, tranches: tranches.map(() => 0), ouvertes: 0, comptes: new Set() };
    const m = c(l[COL.Debit]) - c(l[COL.Credit]);
    t.solde += m;
    t.comptes.add(l[COL.CompteNum]);
    if (!l[COL.EcritureLet]) {
      const age = ecartJours(l[COL.PieceDate] || l[COL.EcritureDate], fin);
      t.tranches[tranches.findIndex(([, max]) => age <= max)] += m;
      t.ouvertes++;
    }
    parTiers.set(t.num, t);
  }
  const fournisseur = prefixe === '40';
  const tiers = [...parTiers.values()].filter((t) => t.solde !== 0 || t.ouvertes).sort((a, b) => Math.abs(b.solde) - Math.abs(a.solde));
  const total = (f) => tiers.reduce((s, t) => s + f(t), 0) / 100;
  const anormal = (t) => (fournisseur ? t.solde > 0 : t.solde < 0);
  return {
    html: `
      <p class="discret">Postes non lettrés au 31/12/${ctx.annee}, classés par ancienneté de la pièce. Solde ${fournisseur ? 'créditeur = dette (affiché en négatif)' : 'débiteur = créance'}. Les soldes de sens anormal sont signalés. Cliquez sur un tiers pour ouvrir son compte en lettrage.</p>
      <div class="defilement haut"><table class="dense">
        <thead><tr><th>Tiers</th><th>Comptes</th><th class="nombre">Solde</th>${tranches.map(([lib]) => `<th class="nombre">${lib}</th>`).join('')}<th class="nombre">Postes ouverts</th></tr></thead>
        <tbody>${tiers.map((t) => `<tr class="${anormal(t) ? 'significatif' : ''}"><td><a href="#" data-tiers="${t.num}" data-outil="${outilLettrage}">${echapper(t.nom)}</a> <span class="code discret">${t.num}</span>${anormal(t) ? ' <span class="pastille orange">Solde de sens anormal</span>' : ''}</td>
          <td class="code">${[...t.comptes].join(', ')}</td><td class="nombre">${nombre(t.solde / 100)}</td>${t.tranches.map((x) => `<td class="nombre">${montantOuVide(x / 100)}</td>`).join('')}<td class="nombre">${t.ouvertes}</td></tr>`).join('') || '<tr><td colspan="9" class="vide">Aucun poste ouvert.</td></tr>'}
        <tr class="total"><td colspan="2">Total (${tiers.length} tiers)</td><td class="nombre">${nombre(total((t) => t.solde))}</td>${tranches.map((_, i) => `<td class="nombre">${nombre(total((t) => t.tranches[i]))}</td>`).join('')}<td></td></tr></tbody>
      </table></div>`,
    items: new Map(),
  };
}

function lettrage(ctx, prefixe) {
  const toutes = lignesTiers(ctx.lignes, prefixe);
  const tiers = [...new Map(toutes.map((l) => [l[COL.CompAuxNum], l[COL.CompAuxLib]])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const choisi = ctx.etat.tiers && tiers.some(([n]) => n === ctx.etat.tiers) ? ctx.etat.tiers : tiers[0]?.[0];
  const seulementOuvertes = !!ctx.etat.ouvertes;
  const lignes = toutes.filter((l) => l[COL.CompAuxNum] === choisi && (!seulementOuvertes || !l[COL.EcritureLet]));
  const items = new Map(lignes.map((l) => { const it = itemFec(l); return [it.cle, it]; }));
  const solde = toutes.filter((l) => l[COL.CompAuxNum] === choisi).reduce((s, l) => s + c(l[COL.Debit]) - c(l[COL.Credit]), 0);
  const cochees = lignes.filter((l) => ctx.panier.has(itemFec(l).cle));
  const sommeCochees = cochees.reduce((s, l) => s + c(l[COL.Debit]) - c(l[COL.Credit]), 0);
  return {
    html: `
      <div class="filtres">
        <label>Tiers <select data-etat-outil="tiers">${tiers.map(([n, nom]) => `<option value="${n}" ${n === choisi ? 'selected' : ''}>${echapper(nom)} (${n})</option>`).join('')}</select></label>
        <label class="en-ligne" style="align-self:flex-end"><input type="checkbox" data-etat-outil="ouvertes" ${seulementOuvertes ? 'checked' : ''}> Lignes non lettrées seulement</label>
      </div>
      <p class="discret">Solde du compte : <strong>${euro(solde / 100)}</strong>. Cochez des lignes pour tester un lettrage : ${cochees.length ? `les ${cochees.length} ligne(s) cochée(s) totalisent <strong>${euro(sommeCochees / 100)}</strong> — ${sommeCochees === 0 ? '<span class="pastille vert">elles se lettrent</span>' : '<span class="pastille orange">écart, elles ne se lettrent pas</span>'}` : 'aucune ligne cochée'}. Les lignes cochées rejoignent la sélection (feuille de travail, pièces, ajustement).</p>
      <div class="defilement haut"><table class="dense fec">
        <thead><tr><th></th><th>Date</th><th>Jal</th><th>N° écriture</th><th>Pièce</th><th>Libellé</th><th>Compte</th><th class="nombre">Débit</th><th class="nombre">Crédit</th><th>Lettre</th><th>Date let.</th></tr></thead>
        <tbody>${lignes.map((l) => { const it = itemFec(l); return `<tr class="${ctx.panier.has(it.cle) ? 'cochee' : l[COL.EcritureLet] ? '' : 'non-lettree'}">${caseCochee(ctx, it.cle)}<td class="date">${dateFr(l[COL.EcritureDate])}</td><td>${l[COL.JournalCode]}</td><td class="code">${l[COL.EcritureNum]}</td><td>${echapper(l[COL.PieceRef])}</td><td>${echapper(l[COL.EcritureLib])}</td><td class="code">${l[COL.CompteNum]}</td>
          <td class="nombre">${montantOuVide(l[COL.Debit])}</td><td class="nombre">${montantOuVide(l[COL.Credit])}</td><td class="code">${echapper(l[COL.EcritureLet])}</td><td class="date">${dateFr(l[COL.DateLet])}</td></tr>`; }).join('') || '<tr><td colspan="11" class="vide">Aucune ligne.</td></tr>'}</tbody>
      </table></div>`,
    items,
    redessinerApresSelection: true,
  };
}

// ------------------------------------------------------------------ Documents postérieurs à la clôture
const tirage = (ctx, sel) => aleatoire((ctx.dossier.scenario.graine ^ sel) >>> 0);

function avoirsPosterieurs(ctx) {
  const rnd = tirage(ctx, 0x2a4b);
  const reels = (ctx.donnees?.posterieur?.avoirs || []).map((a, i) => ({ id: `AV-${i}`, date: a.date, client: a.client, origine: a.piece, motif: a.motif, ht: a.ht / 100 }));
  const motifs = ['Remise commerciale de fin de saison accordée sur les livraisons de janvier', 'Erreur de quantité sur une facture de janvier', 'Escompte pour paiement anticipé', 'Retour partiel de marchandises livrées en janvier'];
  const leurres = Array.from({ length: rnd.entier(2, 4) }, (_, i) => ({ id: `AVX-${i}`, date: `${ctx.annee + 1}-0${rnd.entier(1, 2)}-${String(rnd.entier(10, 27)).padStart(2, '0')}`, client: rnd.choix(ctx.dossier.tiers.clients).nom,
    origine: `FA${ctx.annee + 1}-${String(rnd.entier(3, 90)).padStart(5, '0')}`, motif: rnd.choix(motifs), ht: Math.round(ctx.dossier.chiffres.N.chiffreAffaires * (0.0002 + rnd() * 0.0008) * 100) / 100 }));
  return documentsListe(ctx, [...reels, ...leurres].sort((a, b) => a.date.localeCompare(b.date)),
    `Avoirs émis par la société du 1er janvier au 28 février ${ctx.annee + 1}, extraits du logiciel de facturation.`,
    ['Date', 'Client', 'Facture d\'origine', 'Motif', 'Montant HT'], (x) => [dateFr(x.date), echapper(x.client), `<span class="code">${echapper(x.origine)}</span>`, echapper(x.motif), `<span class="nombre">${nombre(x.ht)}</span>`],
    (x) => itemDoc(x.id, x.date, `Avoir ${x.client} sur ${x.origine} — ${x.motif}`, -x.ht));
}

function facturesPosterieures(ctx) {
  const rnd = tirage(ctx, 0x6c1d);
  const reels = (ctx.donnees?.posterieur?.factures || []).map((f, i) => ({ id: `FAC-${i}`, date: f.date, fournisseur: f.fournisseur, objet: f.lib, ht: f.ht / 100, tva: f.tva / 100 }));
  const fournisseurs = ctx.dossier.tiers.fournisseurs;
  const leurres = Array.from({ length: rnd.entier(4, 7) }, (_, i) => {
    const f = rnd.choix(fournisseurs);
    const ht = Math.round(ctx.dossier.chiffres.N.chiffreAffaires * (0.0005 + rnd() * 0.002) * 100) / 100;
    return { id: `FACX-${i}`, date: `${ctx.annee + 1}-0${rnd.entier(1, 2)}-${String(rnd.entier(5, 27)).padStart(2, '0')}`, fournisseur: f.nom, objet: `${PLAN[f.compteCharge] || 'Achat'} — ${rnd.choix(['livraison', 'prestation', 'période'])} de janvier ${ctx.annee + 1}`, ht, tva: Math.round(ht * 20) / 100 };
  });
  return documentsListe(ctx, [...reels, ...leurres].sort((a, b) => a.date.localeCompare(b.date)),
    `Factures fournisseurs reçues et enregistrées du 1er janvier au 28 février ${ctx.annee + 1}. Comparez la période de la prestation à la date de clôture et aux factures non parvenues comptabilisées (compte 408100).`,
    ['Reçue le', 'Fournisseur', 'Objet', 'HT', 'TVA'], (x) => [dateFr(x.date), echapper(x.fournisseur), echapper(x.objet), `<span class="nombre">${nombre(x.ht)}</span>`, `<span class="nombre">${nombre(x.tva)}</span>`],
    (x) => itemDoc(x.id, x.date, `Facture ${x.fournisseur} — ${x.objet}`, -(x.ht + x.tva)));
}

function annoncesLegales(ctx) {
  const rnd = tirage(ctx, 0x3e77);
  const reels = (ctx.donnees?.posterieur?.faits || []).filter((f) => f.type === 'procedure_collective').map((f, i) => ({ id: `BODACC-${i}`, date: f.date, societe: f.client, nature: 'Jugement d\'ouverture d\'une procédure de liquidation des biens (Acte uniforme portant organisation des procédures collectives)' }));
  const natures = ['Transfert du siège social', 'Nomination d\'un nouveau gérant', 'Augmentation de capital', 'Modification de l\'objet social', 'Dépôt des états financiers au greffe'];
  const leurres = Array.from({ length: rnd.entier(3, 5) }, (_, i) => ({ id: `BODACCX-${i}`, date: ajouterJours(`${ctx.annee}-07-01`, rnd.entier(0, 240)), societe: rnd.choix(ctx.dossier.tiers.clients).nom, nature: rnd.choix(natures) }));
  return documentsListe(ctx, [...reels, ...leurres].sort((a, b) => a.date.localeCompare(b.date)),
    'Résultat de la consultation des journaux d\'annonces légales et du greffe du tribunal de commerce pour les principaux clients (second semestre et début d\'exercice suivant).',
    ['Date', 'Société', 'Nature de l\'annonce'], (x) => [dateFr(x.date), echapper(x.societe), echapper(x.nature)],
    (x) => itemDoc(x.id, x.date, `Annonce légale — ${x.societe} : ${x.nature}`, 0));
}

function documentsListe(ctx, liste, intro, entetes, cellules, versItem) {
  const items = new Map(liste.map((x) => { const it = versItem(x); return [it.cle, it]; }));
  return {
    html: `<p class="discret">${intro}</p>
      <div class="defilement"><table class="dense"><thead><tr><th></th>${entetes.map((e) => `<th>${e}</th>`).join('')}</tr></thead>
      <tbody>${liste.map((x) => { const it = versItem(x); return `<tr class="${ctx.panier.has(it.cle) ? 'cochee' : ''}">${caseCochee(ctx, it.cle)}${cellules(x).map((v) => `<td>${v}</td>`).join('')}</tr>`; }).join('') || `<tr><td colspan="${entetes.length + 1}" class="vide">Aucun document.</td></tr>`}</tbody></table></div>`,
    items,
  };
}

// ------------------------------------------------------------------ Tableaux de synthèse calculés à partir du journal
/** Mouvements d'un compte : ouverture (AN), débits, crédits, clôture — en centimes. */
function mouvements(lignes, filtre) {
  const comptes = new Map();
  for (const l of lignes) {
    const num = l[COL.CompteNum];
    if (!filtre(num)) continue;
    const x = comptes.get(num) || { compte: num, libelle: l[COL.CompteLib], ouverture: 0, debit: 0, credit: 0 };
    if (l[COL.JournalCode] === 'AN') x.ouverture += c(l[COL.Debit]) - c(l[COL.Credit]);
    else { x.debit += c(l[COL.Debit]); x.credit += c(l[COL.Credit]); }
    comptes.set(num, x);
  }
  return [...comptes.values()].sort((a, b) => a.compte.localeCompare(b.compte)).map((x) => ({ ...x, cloture: x.ouverture + x.debit - x.credit }));
}

function tableauDoc(ctx, intro, entetes, lignes, total = '') {
  const items = new Map(lignes.map((l) => [l.item.cle, l.item]));
  return {
    html: `<p class="discret">${intro}</p><div class="defilement"><table class="dense"><thead><tr><th></th>${entetes.map((e, i) => `<th class="${i ? 'nombre' : ''}">${e}</th>`).join('')}</tr></thead>
      <tbody>${lignes.map((l) => `<tr class="${ctx.panier.has(l.item.cle) ? 'cochee' : l.classe || ''}">${caseCochee(ctx, l.item.cle)}${l.cellules.map((v, i) => `<td class="${i ? 'nombre' : ''}">${v}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${entetes.length + 1}" class="vide">Aucune donnée.</td></tr>`}${total}</tbody></table></div>`,
    items,
  };
}

function inventaire(ctx) {
  const inv = ctx.donnees?.inventaire;
  if (!inv) return { html: '<p class="message info">Cette entité ne détient pas de stocks : le cycle est sans objet. Marquez les procédures « non applicable » en le justifiant.</p>', items: new Map() };
  const comptes = mouvements(ctx.lignes, (n) => /^3/.test(n));
  const comptable = comptes.reduce((s, x) => s + x.cloture, 0);
  const achats = mouvements(ctx.lignes, (n) => /^60[12]/.test(n)).reduce((s, x) => s + x.debit - x.credit, 0);
  const lignes = [
    { item: itemDoc('INV', `${ctx.annee}-12-31`, `Stock comptabilisé au 31/12 (${euro(comptable / 100)})`, comptable / 100), cellules: ['Stock comptabilisé au 31/12 (balance)', nombre(comptable / 100)] },
    { item: itemDoc('INV-PV', `${ctx.annee}-12-31`, `Procès-verbal d'inventaire physique (${euro(inv.stockReel / 100)})`, inv.stockReel / 100), cellules: ["Valeur du procès-verbal d'inventaire physique signé", nombre(inv.stockReel / 100)] },
  ];
  return tableauDoc(ctx, `Procès-verbal établi par le client à l'issue du comptage du ${dateFr(`${ctx.annee}-12-31`)}, valorisé au coût d'achat. Stock d'ouverture : ${euro(comptes.reduce((s, x) => s + x.ouverture, 0) / 100)} ; achats consommables de l'exercice : ${euro(achats / 100)} ; rotation apparente : ${achats ? Math.round((comptable / achats) * 360) : '—'} jours.`,
    ['Élément', 'Montant'], lignes);
}

function tableauImmobilisations(ctx) {
  const brutes = mouvements(ctx.lignes, (n) => /^2[0-7]/.test(n));
  const amort = mouvements(ctx.lignes, (n) => /^28/.test(n));
  const attente = mouvements(ctx.lignes, (n) => n === '471000');
  const ligne = (x, type) => ({
    item: itemDoc(`IMMO-${x.compte}`, `${ctx.annee}-12-31`, `Tableau des immobilisations — ${x.compte} ${x.libelle}`, x.cloture / 100),
    cellules: [`<span class="code">${x.compte}</span> ${echapper(x.libelle)}`, nombre(x.ouverture / 100),
      nombre((type === 'amort' ? x.credit : x.debit) / 100), nombre((type === 'amort' ? x.debit : x.credit) / 100), nombre(x.cloture / 100),
      type === 'amort' ? pct(x.ouverture ? x.credit / -x.ouverture : null) : ''],
  });
  const total = (liste) => liste.reduce((s, x) => s + x.cloture, 0) / 100;
  return tableauDoc(ctx, "Variation de l'exercice calculée à partir du journal. Pour les amortissements, « augmentations » = dotations, « diminutions » = reprises et sorties ; la dernière colonne rapporte la dotation au cumul d'ouverture.",
    ['Compte', 'Ouverture', 'Augmentations', 'Diminutions', 'Clôture', 'Dotation / cumul ouverture'],
    [...brutes.map((x) => ligne(x, 'brut')), ...amort.map((x) => ({ ...ligne(x, 'amort'), classe: x.credit === 0 && x.ouverture !== 0 ? 'significatif' : '' })), ...attente.map((x) => ({ ...ligne(x, 'brut'), classe: x.cloture ? 'significatif' : '' }))],
    `<tr class="total"><td></td><td>Valeur brute / amortissements / valeur nette</td><td></td><td></td><td></td><td class="nombre">${nombre(total(brutes))} / ${nombre(total(amort))} / ${nombre(total(brutes) + total(amort))}</td><td></td></tr>`);
}

function recapitulatifPaie(ctx) {
  const mois = Array.from({ length: 12 }, () => ({ brut: 0, patronales: 0, net: 0, retenues: 0, reverse: 0 }));
  for (const l of ctx.lignes) {
    const num = l[COL.CompteNum];
    const m = mois[Number(l[COL.EcritureDate].slice(5, 7)) - 1];
    if (l[COL.JournalCode] === 'PA') {
      if (num.startsWith('6611')) m.brut += c(l[COL.Debit]);
      else if (num.startsWith('6641')) m.patronales += c(l[COL.Debit]);
      else if (num.startsWith('422')) m.net += c(l[COL.Credit]);
      else if (num.startsWith('4472')) m.retenues += c(l[COL.Credit]);
    } else if (l[COL.JournalCode] === 'BQ' && num.startsWith('4472')) m.reverse += c(l[COL.Debit]);
  }
  const lignes = mois.map((m, i) => ({
    item: itemDoc(`PAIE-${i + 1}`, `${ctx.annee}-${String(i + 1).padStart(2, '0')}-28`, `Paie de ${MOIS[i].toLowerCase()} : brut ${euro(m.brut / 100)}, charges patronales ${euro(m.patronales / 100)}, retenues fiscales et CFCE ${euro(m.retenues / 100)}`, m.patronales / 100),
    cellules: [MOIS[i], nombre(m.brut / 100), nombre(m.net / 100), nombre(m.patronales / 100), pct(m.brut ? m.patronales / m.brut : null), nombre(m.retenues / 100), nombre(m.reverse / 100)],
  }));
  const t = (k) => mois.reduce((s, m) => s + m[k], 0);
  return tableauDoc(ctx, `Écritures du journal de paie (PA) mois par mois, et reversements à la DGID (compte 447200) passés en banque — un reversement est normalement effectué le 15 du mois suivant. Effectif déclaré : ${ctx.dossier.client.effectif} salariés.`,
    ['Mois', 'Salaires bruts', 'Net à payer', 'Charges patronales', 'Charges / brut', 'Retenues IR et CFCE', 'Reversé à la DGID'], lignes,
    `<tr class="total"><td></td><td>Total</td><td class="nombre">${nombre(t('brut') / 100)}</td><td class="nombre">${nombre(t('net') / 100)}</td><td class="nombre">${nombre(t('patronales') / 100)}</td><td class="nombre">${pct(t('brut') ? t('patronales') / t('brut') : null)}</td><td class="nombre">${nombre(t('retenues') / 100)}</td><td class="nombre">${nombre(t('reverse') / 100)}</td></tr>`);
}

function procesVerbalCaisse(ctx) {
  const k = ctx.donnees?.caisse;
  if (!k) return { html: '<p class="discret">Aucun procès-verbal de caisse disponible.</p>', items: new Map() };
  const rnd = tirage(ctx, 0x7a11);
  // Billetage du procès-verbal : coupures en FCFA dont la somme égale le montant compté
  const coupures = [10000, 5000, 2000, 1000, 500, 250, 100, 50, 25, 10, 5, 1];
  let reste = Math.round(k.soldePV / 100);
  const billetage = coupures.map((v, i) => { const n = i === coupures.length - 1 ? reste : Math.floor((reste * (i < 4 ? 0.3 + rnd() * 0.4 : 1)) / v); reste -= n * v; return [v, n]; }).filter(([, n]) => n > 0);
  const lignes = [
    { item: itemDoc('CAISSE-571', `${ctx.annee}-12-31`, `Solde comptable de la caisse au 31/12 (${euro(k.soldeComptable / 100)})`, k.soldeComptable / 100), cellules: ['Solde du compte 571000 Caisse au 31/12', nombre(k.soldeComptable / 100)] },
    { item: itemDoc('CAISSE-PV', `${ctx.annee}-12-31`, `Procès-verbal de caisse au 31/12 (${euro(k.soldePV / 100)})`, k.soldePV / 100), cellules: ['Espèces comptées (procès-verbal signé par le caissier et le contrôleur)', nombre(k.soldePV / 100)] },
  ];
  const t = tableauDoc(ctx, `Comptage de la caisse du siège effectué le 31/12/${ctx.annee} à la fermeture, en présence du caissier. Détail du billetage : ${billetage.map(([v, n]) => `${n} × ${v.toLocaleString('fr-FR')}`).join(' ; ')}.`, ['Élément', 'Montant'], lignes);
  return t;
}

function coherenceTva(ctx) {
  const mois = Array.from({ length: 12 }, () => ({ ca: 0, tva: 0 }));
  for (const l of ctx.lignes) {
    if (l[COL.JournalCode] !== 'VE') continue;
    const m = mois[Number(l[COL.EcritureDate].slice(5, 7)) - 1];
    if (l[COL.CompteNum].startsWith('70')) m.ca += c(l[COL.Credit]) - c(l[COL.Debit]);
    else if (l[COL.CompteNum].startsWith('4431')) m.tva += c(l[COL.Credit]) - c(l[COL.Debit]);
  }
  const lignes = mois.map((m, i) => ({
    item: itemDoc(`TVA-${i + 1}`, `${ctx.annee}-${String(i + 1).padStart(2, '0')}-28`, `TVA de ${MOIS[i].toLowerCase()} : CA ${euro(m.ca / 100)}, TVA facturée ${euro(m.tva / 100)}`, m.tva / 100),
    cellules: [MOIS[i], nombre(m.ca / 100), nombre(m.tva / 100), pct(m.ca ? m.tva / m.ca : null)],
  }));
  const ca = mois.reduce((s, m) => s + m.ca, 0); const tva = mois.reduce((s, m) => s + m.tva, 0);
  return tableauDoc(ctx, "Chiffre d'affaires et TVA facturée comptabilisés au journal des ventes, mois par mois. Comparez le taux apparent au taux applicable à l'activité.",
    ['Mois', "Chiffre d'affaires HT", 'TVA facturée', 'Taux apparent'], lignes,
    `<tr class="total"><td></td><td>Exercice</td><td class="nombre">${nombre(ca / 100)}</td><td class="nombre">${nombre(tva / 100)}</td><td class="nombre">${pct(ca ? tva / ca : null)}</td></tr>`);
}

function capitauxPropres(ctx) {
  const comptes = mouvements(ctx.lignes, (n) => /^1/.test(n) || n === '462000');
  let resultat = 0;
  for (const l of ctx.lignes) if (/^[678]/.test(l[COL.CompteNum])) resultat += c(l[COL.Credit]) - c(l[COL.Debit]);
  const lignes = comptes.map((x) => ({
    item: itemDoc(`CAP-${x.compte}`, `${ctx.annee}-12-31`, `${x.compte} ${x.libelle} : ouverture ${euro(-x.ouverture / 100)}, clôture ${euro(-x.cloture / 100)}`, -x.cloture / 100),
    cellules: [`<span class="code">${x.compte}</span> ${echapper(x.libelle)}`, nombre(-x.ouverture / 100), nombre(x.credit / 100), nombre(x.debit / 100), nombre(-x.cloture / 100)],
  }));
  return tableauDoc(ctx, `Comptes de capitaux, de dettes financières et de comptes courants (soldes créditeurs en positif). Résultat de l'exercice ${ctx.annee} avant affectation : ${euro(resultat / 100)}.`,
    ['Compte', 'Ouverture', 'Augmentations', 'Diminutions', 'Clôture'], lignes);
}

// ------------------------------------------------------------------ Circularisation (ISA 505)

const LIB_REPONSE = { accord: ['vert', 'Accord'], desaccord: ['orange', 'Désaccord'], non_reponse: ['rouge', 'Non-réponse'] };

function circularisation(ctx, type) {
  const prefixe = type === 'clients' ? '411' : '40';
  const d = (ctx.donneesCycle.circularisation ??= { selection: [], envoyee: null, reponses: null, analyses: {} });
  const soldes = [...soldesTiers(ctx.lignes, prefixe).values()].filter((t) => t.solde !== 0).sort((a, b) => Math.abs(b.solde) - Math.abs(a.solde));
  const total = soldes.reduce((s, t) => s + Math.abs(t.solde), 0);
  const couverture = (nums) => (total ? Math.round((soldes.filter((t) => nums.includes(t.num)).reduce((s, t) => s + Math.abs(t.solde), 0) / total) * 100) : 0);
  if (!d.envoyee) {
    return {
      html: `<p class="discret">Sélectionnez les ${type} à circulariser (les soldes les plus significatifs, les soldes anormaux, les tiers à risque), puis envoyez les demandes. Couverture actuelle : <strong>${couverture(d.selection)} %</strong> des soldes en valeur absolue, ${d.selection.length} tiers.</p>
        <div class="ligne"><label class="en-ligne">Sélectionner les <input type="number" data-nb-circ value="10" min="1" max="200" style="width:4.5rem"> soldes les plus élevés</label><button type="button" data-circ-auto>Appliquer</button>
          <button type="button" class="principal" data-circ-envoyer ${d.selection.length ? '' : 'disabled'}>Envoyer les ${d.selection.length} demande(s) de confirmation</button></div>
        <div class="defilement haut"><table class="dense"><thead><tr><th></th><th>Tiers</th><th class="nombre">Solde au 31/12</th></tr></thead>
        <tbody>${soldes.map((t) => `<tr class="${d.selection.includes(t.num) ? 'cochee' : ''}"><td><input type="checkbox" data-circ="${t.num}" ${d.selection.includes(t.num) ? 'checked' : ''} aria-label="Circulariser"></td><td>${echapper(t.nom)} <span class="code discret">${t.num}</span></td><td class="nombre">${nombre(t.solde / 100)}</td></tr>`).join('') || '<tr><td colspan="3" class="vide">Aucun solde.</td></tr>'}</tbody></table></div>`,
      items: new Map(),
      brancher: (corps, redessiner) => {
        corps.querySelectorAll('[data-circ]').forEach((x) => x.addEventListener('change', () => { d.selection = x.checked ? [...new Set([...d.selection, x.dataset.circ])] : d.selection.filter((n) => n !== x.dataset.circ); ctx.modifie(); redessiner(); }));
        corps.querySelector('[data-circ-auto]').addEventListener('click', () => { d.selection = soldes.slice(0, Number(corps.querySelector('[data-nb-circ]').value) || 10).map((t) => t.num); ctx.modifie(); redessiner(); });
        corps.querySelector('[data-circ-envoyer]').addEventListener('click', async () => { d.envoyee = `${ctx.annee + 1}-01-08`; ctx.modifie(); await ctx.sauver(); redessiner(); });
      },
    };
  }
  if (!d.reponses) {
    const premier = soldes.find((t) => d.selection.includes(t.num));
    return {
      html: `<p class="message info">${d.selection.length} demande(s) envoyée(s) le ${dateFr(d.envoyee)}, couverture ${couverture(d.selection)} %. Les réponses parviennent directement au cabinet.</p>
        <button type="button" class="principal" data-circ-recevoir>Recevoir les réponses</button>
        <details><summary>Modèle de lettre envoyée</summary><pre class="lettre-pre">${echapper(lettreConfirmation({ dossier: ctx.dossier, tiers: premier?.nom || '', type, annee: ctx.annee }))}</pre></details>`,
      items: new Map(),
      brancher: (corps, redessiner) => corps.querySelector('[data-circ-recevoir]').addEventListener('click', async () => {
        d.reponses = reponsesTiers({ selection: d.selection, type, lignesN: ctx.lignes, anomalies: ctx.anomalies, donnees: ctx.donnees, tiers: ctx.dossier.tiers, graine: ctx.dossier.scenario.graine, annee: ctx.annee });
        ctx.modifie(); await ctx.sauver(); redessiner();
      }),
    };
  }
  const items = new Map(d.reponses.map((r) => { const it = itemDoc(`CIRC-${r.num}`, r.recueLe || `${ctx.annee + 1}-02-15`, `Circularisation ${r.nom} : ${LIB_REPONSE[r.reponse][1].toLowerCase()}${r.ecart ? `, écart ${euro(r.ecart)}` : ''}`, r.ecart || 0); return [it.cle, it]; }));
  const nb = (t) => d.reponses.filter((r) => r.reponse === t).length;
  return {
    html: `<p class="discret">Demandes envoyées le ${dateFr(d.envoyee)} — ${d.reponses.length} tiers, couverture ${couverture(d.selection)} %. Accords : ${nb('accord')}, désaccords : ${nb('desaccord')}, non-réponses : ${nb('non_reponse')}.
      Analysez chaque désaccord (écart justifié ou anomalie) et mettez en œuvre une procédure alternative pour chaque non-réponse (règlements postérieurs, pièces justificatives).</p>
      <div class="defilement haut"><table class="dense"><thead><tr><th></th><th>Tiers</th><th class="nombre">Solde comptable</th><th>Réponse</th><th class="nombre">Solde confirmé</th><th class="nombre">Écart</th><th>Commentaire du tiers</th><th>Votre analyse / procédure alternative</th></tr></thead>
      <tbody>${d.reponses.map((r) => { const cle = `doc|CIRC-${r.num}`; const [cl, lib] = LIB_REPONSE[r.reponse];
        return `<tr class="${ctx.panier.has(cle) ? 'cochee' : ''}">${caseCochee(ctx, cle)}<td>${echapper(r.nom)}${r.recueLe ? `<br><span class="discret">reçue le ${dateFr(r.recueLe)}</span>` : ''}</td><td class="nombre">${nombre(r.soldeComptable)}</td><td><span class="pastille ${cl}">${lib}</span></td>
          <td class="nombre">${r.soldeConfirme == null ? '—' : nombre(r.soldeConfirme)}</td><td class="nombre">${r.ecart ? nombre(r.ecart) : r.ecart === 0 ? '0' : '—'}</td><td>${echapper(r.commentaire)}</td>
          <td class="reponse"><textarea rows="2" data-analyse="${r.num}" aria-label="Analyse">${echapper(d.analyses[r.num] || '')}</textarea></td></tr>`; }).join('')}</tbody></table></div>`,
    items,
    brancher: (corps) => corps.querySelectorAll('[data-analyse]').forEach((x) => x.addEventListener('input', () => { d.analyses[x.dataset.analyse] = x.value; ctx.modifie(); })),
  };
}

function circularisationBanque(ctx) {
  const d = (ctx.donneesCycle.circularisationBanque ??= { envoyee: null, reponse: null, analyse: '' });
  if (!d.reponse) {
    return {
      html: `<p class="discret">Demande de confirmation adressée à la banque : soldes, emprunts, engagements, personnes habilitées (ISA 505).</p>
        <button type="button" class="principal" data-banque-envoyer>${d.envoyee ? 'Recevoir la réponse de la banque' : 'Envoyer la demande et recevoir la réponse'}</button>
        <details><summary>Modèle de lettre</summary><pre class="lettre-pre">${echapper(lettreConfirmation({ dossier: ctx.dossier, tiers: 'Banque du client — service des confirmations', type: 'banque', annee: ctx.annee }))}</pre></details>`,
      items: new Map(),
      brancher: (corps, redessiner) => corps.querySelector('[data-banque-envoyer]').addEventListener('click', async () => {
        const banque = construireBanque(ctx.lignes, ctx.donnees, { graine: ctx.dossier.scenario.graine, annee: ctx.annee, difficulte: ctx.dossier.parametres.difficulte });
        d.envoyee = `${ctx.annee + 1}-01-08`;
        d.reponse = confirmationBanque({ banque, lignesN: ctx.lignes, dossier: ctx.dossier });
        ctx.modifie(); await ctx.sauver(); redessiner();
      }),
    };
  }
  const r = d.reponse;
  let soldeCompta = 0;
  for (const l of ctx.lignes) if (l[COL.CompteNum] === '521000') soldeCompta += c(l[COL.Debit]) - c(l[COL.Credit]);
  const it = itemDoc('CIRC-BANQUE', `${ctx.annee + 1}-01-25`, `Confirmation bancaire : solde ${euro(r.soldeCompte)}, capital restant dû ${euro(r.capitalRestantDu)}`, r.soldeCompte);
  return {
    html: `<p class="discret">Réponse reçue directement de la banque le ${dateFr(`${ctx.annee + 1}-01-25`)}.</p>
      <table class="dense"><tbody>
        <tr class="${ctx.panier.has(it.cle) ? 'cochee' : ''}">${caseCochee(ctx, it.cle)}<td>Solde du compte courant au 31/12/${ctx.annee} selon la banque</td><td class="nombre">${nombre(r.soldeCompte)}</td></tr>
        <tr><td></td><td>Solde du compte 521000 en comptabilité</td><td class="nombre">${nombre(soldeCompta / 100)}</td></tr>
        <tr><td></td><td>Capital restant dû des emprunts</td><td class="nombre">${nombre(r.capitalRestantDu)}</td></tr>
        <tr><td></td><td>Engagements</td><td>${echapper(r.engagements)}</td></tr>
        <tr><td></td><td>Personnes habilitées</td><td>${echapper(r.habilites)}</td></tr>
      </tbody></table>
      <label for="analyse-banque">Votre analyse (rapprochement avec l'état de rapprochement et le grand livre)</label><textarea id="analyse-banque" data-analyse-banque rows="3">${echapper(d.analyse)}</textarea>`,
    items: new Map([[it.cle, it]]),
    brancher: (corps) => corps.querySelector('[data-analyse-banque]').addEventListener('input', (e) => { d.analyse = e.target.value; ctx.modifie(); }),
  };
}

// ------------------------------------------------------------------ Tests sur les écritures (ISA 240)
function testsFec(ctx) {
  const id = TESTS[ctx.etat.test] ? ctx.etat.test : 'weekend';
  const resultats = executerTest(id, ctx.lignes, { annee: ctx.annee, seuilAutorisation: Math.round((ctx.dossier.seuilAutorisation || 0) * 100) });
  const items = new Map();
  const lignes = resultats.slice(0, 300).map((e) => {
    const it = { cle: `fec|N|${e.num}`, source: 'fec', exercice: 'N', num: e.num, date: e.date, piece: e.piece, lib: e.lib, compte: '', montant: e.montant / 100 };
    items.set(it.cle, it);
    const contreparties = [...new Set(e.lignes.map((l) => l[COL.CompteNum]))].join(', ');
    return `<tr class="${ctx.panier.has(it.cle) ? 'cochee' : ''}">${caseCochee(ctx, it.cle)}<td class="date">${dateFr(e.date)}</td><td>${e.journal}</td><td class="code">${e.num}</td><td>${echapper(e.piece)}</td><td>${echapper(e.lib)}</td><td class="code">${contreparties}</td><td class="nombre">${nombre(e.montant / 100)}</td><td>${echapper(e.utilisateur)}</td></tr>`;
  });
  return {
    html: `<div class="filtres"><label>Test <select data-etat-outil="test">${Object.entries(TESTS).map(([k, t]) => `<option value="${k}" ${k === id ? 'selected' : ''}>${t.titre}</option>`).join('')}</select></label></div>
      <p class="discret">${TESTS[id].description} Résultat : <strong>${resultats.length} écriture(s)</strong> sur l'exercice N. Toutes ne sont pas des anomalies : analysez-les.</p>
      <div class="defilement haut"><table class="dense fec"><thead><tr><th></th><th>Date</th><th>Jal</th><th>N° écriture</th><th>Pièce</th><th>Libellé</th><th>Comptes</th><th class="nombre">Montant</th><th>Saisi par</th></tr></thead>
      <tbody>${lignes.join('') || '<tr><td colspan="9" class="vide">Aucune écriture ne répond à ce critère.</td></tr>'}</tbody></table></div>`,
    items,
  };
}

Object.assign(OUTILS, {
  circularisationClients: { titre: 'Circularisation des clients', rendre: (ctx) => circularisation(ctx, 'clients') },
  circularisationFournisseurs: { titre: 'Circularisation des fournisseurs', rendre: (ctx) => circularisation(ctx, 'fournisseurs') },
  circularisationBanque: { titre: 'Confirmation bancaire', rendre: circularisationBanque },
  testsFec: { titre: 'Tests sur les écritures (écritures inhabituelles)', rendre: testsFec },
});

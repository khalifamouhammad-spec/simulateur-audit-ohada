// Section « Données comptables » : X1 journal, X2 balance générale, X3 états financiers.
import { db } from '../db.js';
import { COL, JOURNAUX } from '../moteur/plan.js';
import { calculerBalance, calculerEtats, verifierFec } from '../moteur/compta.js';
import { fecVersTexte, nomFichierFec } from '../moteur/export-fec.js';
import { echapper, euro, dateFr, montantOuVide, lireNombre, telecharger, variationPct, pctFr } from '../utils.js';

const PAR_PAGE = 100;
const cache = new Map(); // évite de relire le journal à chaque changement d'écran

export async function lireFec(dossier, exercice) {
  const cle = `${dossier.id}|${exercice}`;
  if (!cache.has(cle)) {
    if (cache.size > 3) cache.clear();
    cache.set(cle, (await db.lire('fec', [dossier.id, exercice]))?.lignes || []);
  }
  return cache.get(cle);
}
const anneeDe = (dossier, exercice) => Number(dossier.exercice.cloture.slice(0, 4)) - (exercice === 'N' ? 0 : 1);
const nombre = (n) => montantOuVide(n) || '0';

// ------------------------------------------------------------------ X1 : journal des écritures
export async function afficherFec(contenu, { dossier }) {
  const etat = { exercice: 'N', journal: '', compte: '', du: '', au: '', min: '', max: '', texte: '', utilisateur: '', complet: false, page: 0 };
  contenu.insertAdjacentHTML('beforeend', `
    <div class="panneau">
      <div class="filtres">
        <label>Exercice <select data-f="exercice"><option value="N">N (${anneeDe(dossier, 'N')})</option><option value="N-1">N-1 (${anneeDe(dossier, 'N-1')})</option></select></label>
        <label>Journal <select data-f="journal"><option value="">Tous</option>${Object.entries(JOURNAUX).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></label>
        <label>Compte <input type="text" data-f="compte" placeholder="ex. 411 ou C0012" size="12"></label>
        <label>Du <input type="date" data-f="du"></label>
        <label>Au <input type="date" data-f="au"></label>
        <label>Montant min <input type="text" data-f="min" inputmode="decimal" size="9"></label>
        <label>Montant max <input type="text" data-f="max" inputmode="decimal" size="9"></label>
        <label>Utilisateur <select data-f="utilisateur"><option value="">Tous</option>${[...new Set(Object.values(dossier.utilisateurs || {}))].sort().map((u) => `<option>${echapper(u)}</option>`).join('')}</select></label>
        <label class="large">Libellé ou pièce <input type="search" data-f="texte" placeholder="Rechercher…"></label>
      </div>
      <div class="ligne espace">
        <label class="en-ligne"><input type="checkbox" data-f="complet"> Afficher toutes les colonnes</label>
        <span class="ligne"><button data-reinitialiser>Réinitialiser les filtres</button><button class="principal" data-exporter>Exporter le journal (.csv)</button></span>
      </div>
    </div>
    <div class="panneau serre">
      <div class="defilement haut"><table class="dense fec"><thead></thead><tbody></tbody></table></div>
      <div class="ligne espace pied-tableau"><span data-resume class="discret"></span><span class="ligne"><button class="petit" data-page="-1">← Précédent</button><span data-pages class="discret"></span><button class="petit" data-page="1">Suivant →</button></span></div>
    </div>`);

  let lignes = await lireFec(dossier, etat.exercice);
  const COLONNES_SIMPLES = ['JournalCode', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxLib', 'PieceRef', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'Utilisateur'];
  const COLONNES_COMPLETES = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'Utilisateur'];
  const TITRES = { JournalLib: 'Journal', CompAuxNum: 'Compte tiers', PieceDate: 'Date pièce', DateLet: 'Date let.', JournalCode: 'Jal', EcritureNum: 'N° écriture', EcritureDate: 'Date', CompteNum: 'Compte', CompteLib: 'Libellé du compte', CompAuxLib: 'Tiers', PieceRef: 'Pièce', EcritureLib: 'Libellé', Debit: 'Débit', Credit: 'Crédit', EcritureLet: 'Let.', Utilisateur: 'Saisi par' };

  function filtrer() {
    const min = etat.min ? lireNombre(etat.min) : null;
    const max = etat.max ? lireNombre(etat.max) : null;
    const mots = etat.texte.toLowerCase().split(/\s+/).filter(Boolean);
    const compte = etat.compte.trim().toUpperCase();
    return lignes.filter((l) => {
      if (etat.journal && l[COL.JournalCode] !== etat.journal) return false;
      if (compte && !l[COL.CompteNum].startsWith(compte) && !l[COL.CompAuxNum].startsWith(compte)) return false;
      if (etat.du && l[COL.EcritureDate] < etat.du) return false;
      if (etat.au && l[COL.EcritureDate] > etat.au) return false;
      const m = l[COL.Debit] || l[COL.Credit];
      if (min != null && m < min) return false;
      if (max != null && m > max) return false;
      if (etat.utilisateur && l[COL.Utilisateur] !== etat.utilisateur) return false;
      if (mots.length) { const t = `${l[COL.EcritureLib]} ${l[COL.PieceRef]} ${l[COL.CompAuxLib]} ${l[COL.EcritureNum]}`.toLowerCase(); if (!mots.every((x) => t.includes(x))) return false; }
      return true;
    });
  }

  function dessiner() {
    const colonnes = etat.complet ? COLONNES_COMPLETES : COLONNES_SIMPLES;
    const filtrees = filtrer();
    const nbPages = Math.max(1, Math.ceil(filtrees.length / PAR_PAGE));
    etat.page = Math.min(etat.page, nbPages - 1);
    const estMontant = (col) => col === 'Debit' || col === 'Credit';
    const estDate = (col) => ['EcritureDate', 'PieceDate', 'DateLet', 'ValidDate'].includes(col);
    contenu.querySelector('thead').innerHTML = `<tr>${colonnes.map((col) => `<th class="${estMontant(col) ? 'nombre' : ''}">${TITRES[col]}</th>`).join('')}</tr>`;
    let precedent = null; let pair = false;
    contenu.querySelector('tbody').innerHTML = filtrees.slice(etat.page * PAR_PAGE, (etat.page + 1) * PAR_PAGE).map((l) => {
      if (l[COL.EcritureNum] !== precedent) { pair = !pair; precedent = l[COL.EcritureNum]; }
      return `<tr class="${pair ? 'bande' : ''}">${colonnes.map((col) => {
        const v = l[COL[col]];
        return estMontant(col) ? `<td class="nombre">${montantOuVide(v)}</td>` : estDate(col) ? `<td class="date">${dateFr(v)}</td>` : `<td>${echapper(v)}</td>`;
      }).join('')}</tr>`;
    }).join('') || `<tr><td colspan="${colonnes.length}" class="vide">Aucune ligne ne correspond aux filtres.</td></tr>`;
    const debit = filtrees.reduce((s, l) => s + Math.round(l[COL.Debit] * 100), 0) / 100;
    const credit = filtrees.reduce((s, l) => s + Math.round(l[COL.Credit] * 100), 0) / 100;
    contenu.querySelector('[data-resume]').textContent = `${filtrees.length.toLocaleString('fr-FR')} ligne(s) sur ${lignes.length.toLocaleString('fr-FR')} — débit ${euro(debit)} · crédit ${euro(credit)} · solde ${euro(debit - credit)}`;
    contenu.querySelector('[data-pages]').textContent = `Page ${etat.page + 1} / ${nbPages}`;
  }

  contenu.querySelectorAll('[data-f]').forEach((champ) => champ.addEventListener(champ.tagName === 'SELECT' || champ.type === 'checkbox' || champ.type === 'date' ? 'change' : 'input', async () => {
    etat[champ.dataset.f] = champ.type === 'checkbox' ? champ.checked : champ.value;
    etat.page = 0;
    if (champ.dataset.f === 'exercice') lignes = await lireFec(dossier, etat.exercice);
    dessiner();
  }));
  contenu.querySelectorAll('[data-page]').forEach((b) => b.addEventListener('click', () => { etat.page = Math.max(0, etat.page + Number(b.dataset.page)); dessiner(); }));
  contenu.querySelector('[data-reinitialiser]').addEventListener('click', () => {
    contenu.querySelectorAll('[data-f]').forEach((champ) => { if (champ.dataset.f === 'exercice') return; if (champ.type === 'checkbox') champ.checked = false; else champ.value = ''; etat[champ.dataset.f] = champ.type === 'checkbox' ? false : ''; });
    etat.page = 0;
    dessiner();
  });
  contenu.querySelector('[data-exporter]').addEventListener('click', () => {
    const cloture = `${anneeDe(dossier, etat.exercice)}-12-31`;
    telecharger(nomFichierFec(dossier.client.siren, cloture), fecVersTexte(lignes));
  });
  dessiner();
}

// ------------------------------------------------------------------ X2 : balance générale
export async function afficherBalance(contenu, { dossier }) {
  const [n, n1] = await Promise.all([lireFec(dossier, 'N'), lireFec(dossier, 'N-1')]);
  const balance = calculerBalance(n);
  const precedente = new Map(calculerBalance(n1).map((l) => [l.compte, l.soldeDebiteur - l.soldeCrediteur]));
  const comptes = new Map(balance.map((l) => [l.compte, l]));
  for (const l of calculerBalance(n1)) if (!comptes.has(l.compte)) comptes.set(l.compte, { compte: l.compte, libelle: l.libelle, debit: 0, credit: 0, soldeDebiteur: 0, soldeCrediteur: 0 });
  const toutes = [...comptes.values()].sort((a, b) => a.compte.localeCompare(b.compte));
  contenu.insertAdjacentHTML('beforeend', `
    <div class="panneau">
      <div class="filtres"><label class="large">Compte ou libellé <input type="search" data-filtre placeholder="ex. 6, 411, banque…"></label></div>
      <p class="discret">Balance de l'exercice N (${anneeDe(dossier, 'N')}) calculée à partir du journal. Solde N-1 : positif = débiteur, négatif = créditeur.</p>
    </div>
    <div class="panneau serre"><div class="defilement haut"><table class="dense">
      <thead><tr><th>Compte</th><th>Libellé</th><th class="nombre">Débit</th><th class="nombre">Crédit</th><th class="nombre">Solde débiteur</th><th class="nombre">Solde créditeur</th><th class="nombre">Solde N-1</th><th class="nombre">Variation</th></tr></thead>
      <tbody></tbody></table></div></div>`);
  const dessiner = (filtre) => {
    const f = filtre.trim().toLowerCase();
    const visibles = toutes.filter((l) => !f || l.compte.startsWith(f) || l.libelle.toLowerCase().includes(f));
    const total = (cle) => visibles.reduce((s, l) => s + Math.round(l[cle] * 100), 0) / 100;
    contenu.querySelector('tbody').innerHTML = visibles.map((l) => {
      const solde = l.soldeDebiteur - l.soldeCrediteur;
      const avant = precedente.get(l.compte) || 0;
      return `<tr><td class="code">${l.compte}</td><td>${echapper(l.libelle)}</td><td class="nombre">${montantOuVide(l.debit)}</td><td class="nombre">${montantOuVide(l.credit)}</td>
        <td class="nombre">${montantOuVide(l.soldeDebiteur)}</td><td class="nombre">${montantOuVide(l.soldeCrediteur)}</td><td class="nombre">${montantOuVide(avant)}</td><td class="nombre">${pctFr(variationPct(solde, avant))}</td></tr>`;
    }).join('') + `<tr class="total"><td colspan="2">Totaux (${visibles.length} comptes)</td><td class="nombre">${nombre(total('debit'))}</td><td class="nombre">${nombre(total('credit'))}</td><td class="nombre">${nombre(total('soldeDebiteur'))}</td><td class="nombre">${nombre(total('soldeCrediteur'))}</td><td></td><td></td></tr>`;
  };
  contenu.querySelector('[data-filtre]').addEventListener('input', (e) => dessiner(e.target.value));
  dessiner('');
}

// ------------------------------------------------------------------ X3 : états financiers
export async function afficherEtats(contenu, { dossier }) {
  const [n, n1] = await Promise.all([lireFec(dossier, 'N'), lireFec(dossier, 'N-1')]);
  const e = calculerEtats(n);
  const p = calculerEtats(n1);
  const controles = [['N', n, e], ['N-1', n1, p]].map(([ex, lignes, etats]) => {
    const an = anneeDe(dossier, ex);
    return { ex, fec: verifierFec(lignes, { debut: `${an}-01-01`, fin: `${an}-12-31` }), etats };
  });
  const ok = (v) => `<span class="pastille ${v ? 'vert' : 'orange'}">${v ? 'Conforme' : 'Écart'}</span>`;
  const tableau = (titre, rubriquesN, rubriquesN1, totalLibelle, totalN, totalN1) => `
    <div class="panneau serre"><h2 class="titre-tableau">${titre}</h2><div class="defilement"><table class="dense">
      <thead><tr><th>Rubrique</th><th class="nombre">N</th><th class="nombre">N-1</th><th class="nombre">Variation</th><th class="nombre">%</th></tr></thead>
      <tbody>${rubriquesN.map((r, i) => {
        const avant = rubriquesN1[i];
        if (!r.montant && !avant.montant) return '';
        const detail = new Map(avant.comptes.map((c) => [c.compte, { n: 0, n1: c.montant }]));
        for (const c of r.comptes) detail.set(c.compte, { n: c.montant, n1: detail.get(c.compte)?.n1 || 0 });
        return `<tr class="rubrique"><td>${echapper(r.libelle)}</td><td class="nombre">${nombre(r.montant)}</td><td class="nombre">${nombre(avant.montant)}</td><td class="nombre">${nombre(r.montant - avant.montant)}</td><td class="nombre">${pctFr(variationPct(r.montant, avant.montant))}</td></tr>
          ${[...detail].sort((a, b) => a[0].localeCompare(b[0])).map(([compte, m]) => `<tr class="detail"><td><span class="code">${compte}</span></td><td class="nombre">${nombre(m.n)}</td><td class="nombre">${nombre(m.n1)}</td><td class="nombre">${nombre(m.n - m.n1)}</td><td class="nombre">${pctFr(variationPct(m.n, m.n1))}</td></tr>`).join('')}`;
      }).join('')}
      <tr class="total"><td>${totalLibelle}</td><td class="nombre">${nombre(totalN)}</td><td class="nombre">${nombre(totalN1)}</td><td class="nombre">${nombre(totalN - totalN1)}</td><td class="nombre">${pctFr(variationPct(totalN, totalN1))}</td></tr></tbody>
    </table></div></div>`;
  contenu.insertAdjacentHTML('beforeend', `
    <div class="panneau">
      <h2>Contrôles de cohérence (calculés par le logiciel)</h2>
      <div class="defilement"><table class="dense">
        <thead><tr><th>Contrôle</th>${controles.map((c) => `<th>${c.ex} (${anneeDe(dossier, c.ex)})</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td>Chaque écriture est équilibrée, numérotation continue, lettrage équilibré</td>${controles.map((c) => `<td>${ok(!c.fec.erreurs.length)} <span class="discret">${c.fec.nbEcritures.toLocaleString('fr-FR')} écritures, ${c.fec.nbLignes.toLocaleString('fr-FR')} lignes</span></td>`).join('')}</tr>
          <tr><td>Total des débits = total des crédits</td>${controles.map((c) => `<td>${ok(c.fec.totalDebit === c.fec.totalCredit)} <span class="discret">${euro(c.fec.totalDebit)}</span></td>`).join('')}</tr>
          <tr><td>Total de l'actif = total du passif</td>${controles.map((c) => `<td>${ok(c.etats.controles.bilanEquilibre)} <span class="discret">${euro(c.etats.totalActif)}</span></td>`).join('')}</tr>
          <tr><td>Résultat du bilan = résultat du compte de résultat</td>${controles.map((c) => `<td>${ok(c.etats.controles.resultatIdentique)} <span class="discret">${euro(c.etats.controles.resultatCompteDeResultat)}</span></td>`).join('')}</tr>
        </tbody>
      </table></div>
      <p class="discret">Ces contrôles portent sur la cohérence arithmétique de la comptabilité, pas sur sa sincérité : les anomalies à trouver sont dans les écritures.</p>
    </div>
    ${tableau('Bilan — actif', e.actif, p.actif, "Total de l'actif", e.totalActif, p.totalActif)}
    ${tableau('Bilan — passif', e.passif, p.passif, 'Total du passif', e.totalPassif, p.totalPassif)}
    ${tableau('Compte de résultat SYSCOHADA (produits en positif, charges en négatif)', e.resultat, p.resultat, 'XI Résultat net', e.agregats.resultatNet, p.agregats.resultatNet)}
    <div class="panneau serre"><h2 class="titre-tableau">Soldes intermédiaires de gestion</h2><div class="defilement"><table class="dense">
      <thead><tr><th>Réf.</th><th>Solde</th><th class="nombre">N</th><th class="nombre">N-1</th><th class="nombre">Variation</th><th class="nombre">%</th></tr></thead>
      <tbody>${e.sig.map((x, i) => `<tr class="${x.ref === 'XI' ? 'total' : ''}"><td class="code">${x.ref}</td><td>${echapper(x.libelle)}</td><td class="nombre">${nombre(x.montant)}</td><td class="nombre">${nombre(p.sig[i].montant)}</td><td class="nombre">${nombre(x.montant - p.sig[i].montant)}</td><td class="nombre">${pctFr(variationPct(x.montant, p.sig[i].montant))}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <p class="discret">Cliquez sur « Afficher le détail par compte » pour déplier les rubriques.</p>`);
  const bascule = document.createElement('label');
  bascule.className = 'en-ligne';
  bascule.innerHTML = '<input type="checkbox"> Afficher le détail par compte';
  contenu.querySelector('.panneau').after(bascule);
  bascule.querySelector('input').addEventListener('change', (ev) => contenu.classList.toggle('avec-detail', ev.target.checked));
  contenu.lastElementChild.remove();
}

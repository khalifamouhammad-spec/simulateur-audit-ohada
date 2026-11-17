// Écran d'un cycle (section D) : programme de travail, feuilles de travail, grand livre et
// échantillonnage, documents bancaires, pièces justificatives. Générique : chaque cycle fournit
// sa configuration (js/cycles/…).
import { STATUTS, REFERENTIELS } from '../config.js';
import { db, lireParametres } from '../db.js';
import { demanderJSON } from '../groq.js';
import { listerFeuilles, nouvelleFeuille, enregistrerFeuille, supprimerFeuille, listerDocuments, enregistrerDocument } from '../feuilles.js';
import { COL } from '../moteur/plan.js';
import { construireBanque } from '../moteur/banque.js';
import { echantillonner, METHODES } from '../moteur/echantillon.js';
import { ecritureDepuisFec, construirePiece } from '../moteur/pieces.js';
import { lireFec } from './donnees.js';
import { ouvrirAjustement } from './ajustements.js';
import { OUTILS } from './outils.js';
import { echapper, euro, dateFr, montantOuVide, lireNombre } from '../utils.js';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const STATUTS_PROCEDURE = { '': '— À faire', fait: 'Fait', adapte: 'Adapté', na: 'Non applicable' };
const REFS_FIXES = ['B2', 'B3', 'B4', 'C1', 'E1'];
const MAX_LIGNES = 300;
const nombre = (n) => montantOuVide(n) || '0';

/** Fabrique l'écran d'un cycle à partir de sa configuration. */
export const ecranCycle = (config) => (zone, ctx) => afficherCycle(zone, ctx, config);

async function afficherCycle(zone, { dossier, donnees, modifie, sauver, lectureSeule }, config) {
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  const annee = Number(dossier.exercice.cloture.slice(0, 4));
  donnees.programme ??= config.programme.map(() => ({ statut: '', commentaire: '', feuille: '' }));
  donnees.proceduresAjoutees ??= [];
  const etat = { onglet: 'programme', feuilleId: null, documentId: null, gl: { exercice: 'N', compte: config.comptes[0][0], du: '', au: '', min: '', texte: '' }, vueBanque: 'rappro', message: '', outil: config.outils?.[0] || null, etatsOutils: {} };
  const panier = new Map();
  let feuilles = await listerFeuilles(dossier.id, config.id);
  let documents = await listerDocuments(dossier.id, config.id);
  let banque = null;

  zone.innerHTML = `
    <div class="onglets" role="tablist"></div>
    <div data-corps></div>
    <div class="barre-panier" hidden></div>`;
  const corps = zone.querySelector('[data-corps]');
  const barre = zone.querySelector('.barre-panier');

  const ONGLETS = [
    ['programme', () => 'Programme de travail'], ['feuilles', () => `Feuilles de travail (${feuilles.length})`], ['gl', () => 'Grand livre et sondages'],
    ...(config.banque ? [['banque', () => 'Banque']] : []), ...(config.outils?.length ? [['outils', () => 'Outils du cycle']] : []), ['pieces', () => `Pièces justificatives (${documents.length})`],
  ];
  const majOnglets = () => {
    zone.querySelector('.onglets').innerHTML = ONGLETS.map(([id, titre]) => `<button type="button" role="tab" data-onglet="${id}" class="${id === etat.onglet ? 'actif' : ''}">${titre()}</button>`).join('');
  };
  const aller = (onglet) => { etat.onglet = onglet; dessiner(); };

  // ------------------------------------------------------------ Panier de lignes sélectionnées
  const basculer = (item, coche) => { if (coche) panier.set(item.cle, item); else panier.delete(item.cle); majBarre(); };
  function majBarre() {
    barre.hidden = panier.size === 0 || lectureSeule;
    if (barre.hidden) return;
    const nbFec = [...panier.values()].filter((x) => x.source === 'fec').length;
    barre.innerHTML = `
      <strong>${panier.size} ligne(s) sélectionnée(s)</strong>
      <span class="ligne">
        <select data-feuille aria-label="Feuille de travail">${feuilles.length ? feuilles.map((f) => `<option value="${f.id}">${f.ref} ${echapper(f.titre)}</option>`).join('') : '<option value="">Aucune feuille</option>'}<option value="nouvelle">+ Nouvelle feuille</option></select>
        <button type="button" data-action="joindre">Joindre à la feuille</button>
        <button type="button" data-action="pieces" ${nbFec ? '' : 'disabled'}>Demander les pièces (${nbFec})</button>
        <button type="button" data-action="ajustement">Proposer un ajustement</button>
        <button type="button" data-action="vider">Vider</button>
      </span>`;
  }
  barre.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const items = [...panier.values()];
    if (action === 'vider') { panier.clear(); majBarre(); dessiner(); }
    else if (action === 'joindre') {
      const choix = barre.querySelector('[data-feuille]').value;
      let f = feuilles.find((x) => x.id === choix);
      if (!f) { f = nouvelleFeuille(dossier.id, config.id, config.code, feuilles); feuilles.push(f); }
      f.elements.push({ type: 'lignes', titre: `Sélection de ${items.length} ligne(s)`, lignes: items.map(({ cle, ...reste }) => reste) });
      await enregistrerFeuille(f);
      panier.clear(); majBarre(); modifie();
      etat.feuilleId = f.id; aller('feuilles');
    } else if (action === 'pieces') await demanderPieces(items.filter((x) => x.source === 'fec'));
    else if (action === 'ajustement') {
      ouvrirAjustement({ dossier, base: { cycle: config.id, references: items.map(({ source, exercice, num, lib, id }) => ({ source, exercice, num: num || id, lib })) },
        apres: async () => { panier.clear(); majBarre(); modifie(); await sauver(); etat.message = "Ajustement enregistré dans le tableau E1."; dessiner(); } });
    }
  });

  // ------------------------------------------------------------ Pièces justificatives
  async function demanderPieces(items) {
    const corrige = await db.lire('corriges', dossier.id);
    const nouvelles = [];
    for (const exercice of [...new Set(items.map((x) => x.exercice))]) {
      const nums = items.filter((x) => x.exercice === exercice);
      const lignes = await lireFec(dossier, exercice);
      for (const num of new Set(nums.map((x) => x.num))) {
        if (documents.some((d) => d.ecritureNum === num && d.exercice === exercice)) continue;
        const ecriture = ecritureDepuisFec(lignes, num);
        if (!ecriture) continue;
        const anomalies = (corrige?.anomalies || []).filter((a) => a.ecritures.some((x) => x.num === num && x.exercice === exercice));
        nouvelles.push({ ...construirePiece(ecriture, { dossier, exercice, anomalies, donnees: corrige?.donnees }), dossierId: dossier.id, cycle: config.id });
      }
    }
    await enrichirParIA(nouvelles);
    for (const d of nouvelles) documents.push(await enregistrerDocument(d));
    panier.clear(); majBarre();
    if (nouvelles.length) { etat.documentId = nouvelles[0].id; modifie(); }
    etat.message = nouvelles.length ? `${nouvelles.length} pièce(s) obtenue(s) auprès du client.` : 'Ces pièces figurent déjà au dossier.';
    aller('pieces');
  }
  /** L'IA ne fait que rédiger la désignation des lignes de facture ; les montants restent ceux du journal. */
  async function enrichirParIA(docs) {
    const factures = docs.filter((d) => d.type === 'facture_vente' || d.type === 'facture_achat').slice(0, 12);
    const parametres = await lireParametres();
    if (!factures.length || !parametres.cleGroq) return;
    try {
      const r = await demanderJSON({ cle: parametres.cleGroq, modele: parametres.modele, temperature: 0.7, maxTokens: 900,
        systeme: 'Tu rédiges des désignations de lignes de factures réalistes, en français. Tu réponds uniquement par un objet JSON valide.',
        utilisateur: `Entreprise : ${dossier.client.nom} — ${dossier.client.activite}\nPour chacune des factures suivantes, rédige une désignation réaliste et précise de 6 à 14 mots (nature du bien ou de la prestation, sans montant, sans date, sans nom de société).\n${factures.map((d, i) => `${i + 1}. ${d.type === 'facture_vente' ? 'Vente à' : 'Achat auprès de'} ${d.type === 'facture_vente' ? d.destinataire : d.emetteur} — nature comptable : ${d.lignes[0].designation}`).join('\n')}\nRéponds : { "designations": ["…", "…"] } avec exactement ${factures.length} éléments, dans l'ordre.` });
      if (Array.isArray(r.designations) && r.designations.length === factures.length) factures.forEach((d, i) => { const t = String(r.designations[i] || '').trim().slice(0, 160); if (t) d.lignes[0].designation = t; });
    } catch { /* sans IA, les désignations du logiciel suffisent */ }
  }
  const rendrePiece = (d) => `
    <div class="piece">
      <div class="ligne espace"><div><span class="discret">Émetteur</span><br><strong>${echapper(d.emetteur)}</strong></div><div style="text-align:right"><span class="discret">Destinataire</span><br><strong>${echapper(d.destinataire)}</strong></div></div>
      <h2>${echapper(d.titre)}</h2>
      <p class="discret">Date : ${dateFr(d.date)} · Référence : ${echapper(d.reference)} · Écriture ${echapper(d.ecritureNum)} (${d.exercice})</p>
      <table class="dense"><thead><tr><th>Désignation</th><th class="nombre">Montant</th></tr></thead><tbody>
        ${d.lignes.map((l) => `<tr><td>${echapper(l.designation)}</td><td class="nombre">${nombre(l.montant)}</td></tr>`).join('')}
        ${d.totaux ? `<tr class="total"><td>Total HT</td><td class="nombre">${nombre(d.totaux.ht)}</td></tr><tr><td>TVA</td><td class="nombre">${nombre(d.totaux.tva)}</td></tr><tr class="total"><td>Total TTC</td><td class="nombre">${nombre(d.totaux.ttc)}</td></tr>` : ''}
      </tbody></table>
      ${d.mentions.map((m) => `<p>${echapper(m)}</p>`).join('')}
      ${d.annexes.map((a) => `<div class="annexe"><strong>${echapper(a.titre)}</strong><br>${echapper(a.texte)}</div>`).join('')}
    </div>`;

  // ------------------------------------------------------------ Onglets
  function dessinerProgramme() {
    const toutes = [...config.programme.map((p, i) => ({ ...p, etat: donnees.programme[i] })), ...donnees.proceduresAjoutees.map((p) => ({ titre: p.titre, assertion: '', norme: '', etat: p, ajoutee: true }))];
    const traitees = toutes.filter((p) => p.etat.statut).length;
    corps.innerHTML = `
      <div class="panneau"><p>Programme de travail standard du cycle ${echapper(config.libelle.toLowerCase())}. Pour chaque procédure : réalisez-la, adaptez-la au dossier ou marquez-la « non applicable » en le justifiant, et renvoyez à la feuille de travail qui la documente.</p>
        <p class="discret">${traitees} procédure(s) traitée(s) sur ${toutes.length}.</p></div>
      <div class="panneau serre"><div class="defilement"><table class="dense">
        <thead><tr><th>N°</th><th>Procédure</th><th>Assertion</th><th>Statut</th><th>Feuille</th><th>Commentaire / adaptation</th></tr></thead>
        <tbody>${toutes.map((p, i) => `<tr data-i="${i}"><td>${i + 1}</td><td>${echapper(p.titre)}${p.norme ? ` <span class="discret">(${N} ${p.norme})</span>` : ''}${p.ajoutee ? ' <span class="pastille bleu">Ajoutée</span>' : ''}</td><td>${echapper(p.assertion)}</td>
          <td><select data-p="statut" aria-label="Statut">${Object.entries(STATUTS_PROCEDURE).map(([k, v]) => `<option value="${k}" ${p.etat.statut === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
          <td><select data-p="feuille" aria-label="Feuille"><option value="">—</option>${feuilles.map((f) => `<option ${p.etat.feuille === f.ref ? 'selected' : ''}>${f.ref}</option>`).join('')}</select></td>
          <td class="reponse"><input type="text" data-p="commentaire" value="${echapper(p.etat.commentaire)}" aria-label="Commentaire"></td></tr>`).join('')}</tbody>
      </table></div></div>
      <div class="ligne"><input type="text" data-nouvelle placeholder="Procédure complémentaire propre à ce dossier…" style="flex:1" aria-label="Nouvelle procédure"><button type="button" data-ajouter>Ajouter la procédure</button></div>`;
    corps.querySelectorAll('[data-p]').forEach((champ) => champ.addEventListener(champ.tagName === 'SELECT' ? 'change' : 'input', () => {
      toutes[Number(champ.closest('tr').dataset.i)].etat[champ.dataset.p] = champ.value;
      modifie();
    }));
    corps.querySelector('[data-ajouter]').addEventListener('click', () => {
      const titre = corps.querySelector('[data-nouvelle]').value.trim();
      if (!titre) return;
      donnees.proceduresAjoutees.push({ titre, statut: '', commentaire: '', feuille: '' });
      modifie(); dessinerProgramme();
    });
  }

  function dessinerFeuilles() {
    const f = feuilles.find((x) => x.id === etat.feuilleId);
    if (!f) {
      corps.innerHTML = `
        <div class="panneau"><div class="ligne espace"><p>Feuilles de travail du cycle, codifiées ${config.code}-1, ${config.code}-2… Chaque feuille documente un contrôle : objectif, travail effectué, conclusion, références croisées.</p>
          <button type="button" class="principal" data-nouvelle ${lectureSeule ? 'disabled' : ''}>+ Nouvelle feuille</button></div></div>
        <div class="panneau serre"><div class="defilement"><table class="dense">
          <thead><tr><th>Réf.</th><th>Titre</th><th>Statut</th><th>Éléments joints</th><th>Références croisées</th><th>Conclusion</th></tr></thead>
          <tbody>${feuilles.map((x) => `<tr><td><a href="#" data-ouvrir="${x.id}" class="code">${x.ref}</a></td><td><a href="#" data-ouvrir="${x.id}">${echapper(x.titre) || '<span class="discret">Sans titre</span>'}</a></td>
            <td><span class="pastille ${STATUTS[x.statut].classe}">${STATUTS[x.statut].libelle}</span></td><td>${x.elements.length}</td><td class="code">${x.refsCroisees.join(', ')}</td><td>${x.conclusion.trim() ? '<span class="pastille vert">Rédigée</span>' : '<span class="pastille gris">À rédiger</span>'}</td></tr>`).join('')
            || '<tr><td colspan="6" class="vide">Aucune feuille de travail. Créez-en une ou joignez-y une sélection depuis le grand livre.</td></tr>'}</tbody>
        </table></div></div>`;
      corps.querySelector('[data-nouvelle]').addEventListener('click', async () => {
        const nf = nouvelleFeuille(dossier.id, config.id, config.code, feuilles);
        feuilles.push(nf); await enregistrerFeuille(nf); modifie();
        etat.feuilleId = nf.id; dessiner();
      });
      corps.querySelectorAll('[data-ouvrir]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); etat.feuilleId = a.dataset.ouvrir; dessiner(); }));
      return;
    }
    const refsPossibles = [...feuilles.filter((x) => x.id !== f.id).map((x) => x.ref), ...REFS_FIXES];
    corps.innerHTML = `
      <div class="ligne espace"><button type="button" data-retour>← Toutes les feuilles</button><span class="ligne"><span data-enregistre class="discret"></span><button type="button" class="danger" data-supprimer ${lectureSeule ? 'disabled' : ''}>Supprimer la feuille</button></span></div>
      <div class="panneau">
        <div class="grille">
          <div><label>Référence</label><p class="code" style="font-size:1.1rem"><strong>${f.ref}</strong></p></div>
          <div style="grid-column: span 2"><label for="f-titre">Titre</label><input type="text" id="f-titre" data-f="titre" value="${echapper(f.titre)}" placeholder="ex. Contrôle de l'état de rapprochement bancaire"></div>
          <div><label for="f-statut">Statut</label><select id="f-statut" data-f="statut">${Object.entries(STATUTS).map(([k, s]) => `<option value="${k}" ${f.statut === k ? 'selected' : ''}>${s.libelle}</option>`).join('')}</select></div>
        </div>
        <label for="f-objectif">Objectif</label><textarea id="f-objectif" data-f="objectif" rows="2" placeholder="Assertion visée et risque couvert">${echapper(f.objectif)}</textarea>
        <label for="f-travail">Travail effectué</label><textarea id="f-travail" data-f="travail" rows="6" placeholder="Nature et étendue des contrôles, population, échantillon, sources, constats">${echapper(f.travail)}</textarea>
        <label for="f-conclusion">Conclusion</label><textarea id="f-conclusion" data-f="conclusion" rows="3" placeholder="Conclusion sur l'assertion, anomalies relevées et renvoi au tableau des ajustements">${echapper(f.conclusion)}</textarea>
        <label>Références croisées</label>
        <div class="ligne">${refsPossibles.map((r) => `<label class="en-ligne puce"><input type="checkbox" data-ref="${r}" ${f.refsCroisees.includes(r) ? 'checked' : ''}> <span class="code">${r}</span></label>`).join('')}</div>
      </div>
      <h2>Éléments joints (${f.elements.length})</h2>
      ${f.elements.map((el, i) => el.type === 'piece'
        ? `<div class="panneau"><div class="ligne espace"><span>📄 <a href="#" data-piece="${el.documentId}">${echapper(el.titre)}</a></span><button type="button" class="petit danger" data-retirer="${i}">Retirer</button></div></div>`
        : `<div class="panneau serre"><div class="ligne espace" style="padding:.5rem .8rem"><input type="text" data-titre-element="${i}" value="${echapper(el.titre)}" style="flex:1" aria-label="Titre de la sélection"><button type="button" class="petit danger" data-retirer="${i}">Retirer</button></div>
            <div class="defilement"><table class="dense"><thead><tr><th>Source</th><th>Date</th><th>Écriture / pièce</th><th>Libellé</th><th class="nombre">Montant</th></tr></thead>
            <tbody>${el.lignes.map((l) => `<tr><td>${{ fec: `FEC ${l.exercice}`, releve: 'Relevé', rappro: 'Rapprochement', doc: 'Document' }[l.source]}</td><td class="date">${dateFr(l.date)}</td><td class="code">${echapper(l.num || '')} ${echapper(l.piece || '')}</td><td>${echapper(l.lib)}</td><td class="nombre">${nombre(l.montant)}</td></tr>`).join('')}
            <tr class="total"><td colspan="4">Total (${el.lignes.length} lignes)</td><td class="nombre">${nombre(el.lignes.reduce((s, l) => s + Math.round(l.montant * 100), 0) / 100)}</td></tr></tbody></table></div></div>`).join('')
        || '<p class="discret">Aucun élément joint. Depuis le grand livre, la banque ou les pièces, sélectionnez des lignes puis « Joindre à la feuille ».</p>'}`;
    let attente = null;
    const enregistrer = () => { clearTimeout(attente); corps.querySelector('[data-enregistre]').textContent = ''; attente = setTimeout(async () => { await enregistrerFeuille(f); const s = corps.querySelector('[data-enregistre]'); if (s) s.textContent = 'Enregistré.'; }, 400); modifie(); };
    corps.querySelectorAll('[data-f]').forEach((champ) => champ.addEventListener(champ.tagName === 'SELECT' ? 'change' : 'input', () => { f[champ.dataset.f] = champ.value; enregistrer(); }));
    corps.querySelectorAll('[data-ref]').forEach((caseRef) => caseRef.addEventListener('change', () => { f.refsCroisees = [...corps.querySelectorAll('[data-ref]:checked')].map((x) => x.dataset.ref); enregistrer(); }));
    corps.querySelectorAll('[data-titre-element]').forEach((champ) => champ.addEventListener('input', () => { f.elements[Number(champ.dataset.titreElement)].titre = champ.value; enregistrer(); }));
    corps.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', async () => { f.elements.splice(Number(b.dataset.retirer), 1); await enregistrerFeuille(f); modifie(); dessiner(); }));
    corps.querySelectorAll('[data-piece]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); etat.documentId = a.dataset.piece; aller('pieces'); }));
    corps.querySelector('[data-retour]').addEventListener('click', async () => { clearTimeout(attente); await enregistrerFeuille(f); etat.feuilleId = null; dessiner(); });
    corps.querySelector('[data-supprimer]').addEventListener('click', async () => {
      if (!confirm(`Supprimer la feuille ${f.ref} ?`)) return;
      clearTimeout(attente); await supprimerFeuille(f.id); feuilles = feuilles.filter((x) => x.id !== f.id); etat.feuilleId = null; modifie(); dessiner();
    });
  }

  async function dessinerGrandLivre() {
    const g = etat.gl;
    const lignes = await lireFec(dossier, g.exercice);
    const compte = g.compte.trim();
    let solde = 0;
    const duCompte = lignes.filter((l) => l[COL.CompteNum].startsWith(compte)).map((l) => { solde += Math.round(l[COL.Debit] * 100) - Math.round(l[COL.Credit] * 100); return { l, solde: solde / 100 }; });
    const min = g.min ? lireNombre(g.min) : null;
    const mots = g.texte.toLowerCase().split(/\s+/).filter(Boolean);
    const visibles = duCompte.filter(({ l }) => (!g.du || l[COL.EcritureDate] >= g.du) && (!g.au || l[COL.EcritureDate] <= g.au) && (min == null || (l[COL.Debit] || l[COL.Credit]) >= min)
      && (!mots.length || mots.every((m) => `${l[COL.EcritureLib]} ${l[COL.PieceRef]} ${l[COL.CompAuxLib]} ${l[COL.EcritureNum]} ${l[COL.Utilisateur]}`.toLowerCase().includes(m))));
    const item = (l) => ({ cle: `fec|${g.exercice}|${l[COL.EcritureNum]}`, source: 'fec', exercice: g.exercice, num: l[COL.EcritureNum], date: l[COL.EcritureDate], piece: l[COL.PieceRef], lib: l[COL.EcritureLib], compte: l[COL.CompteNum], montant: l[COL.Debit] - l[COL.Credit] });
    const total = (col) => visibles.reduce((s, { l }) => s + Math.round(l[col] * 100), 0) / 100;
    corps.innerHTML = `
      <div class="panneau">
        <div class="filtres">
          <label>Exercice <select data-g="exercice"><option value="N" ${g.exercice === 'N' ? 'selected' : ''}>N (${annee})</option><option value="N-1" ${g.exercice === 'N-1' ? 'selected' : ''}>N-1 (${annee - 1})</option></select></label>
          <label>Compte <input type="text" data-g="compte" value="${echapper(g.compte)}" list="gl-comptes" size="10"></label>
          <datalist id="gl-comptes">${config.comptes.map(([num, lib]) => `<option value="${num}">${echapper(lib)}</option>`).join('')}</datalist>
          <label>Du <input type="date" data-g="du" value="${g.du}"></label><label>Au <input type="date" data-g="au" value="${g.au}"></label>
          <label>Montant min <input type="text" data-g="min" value="${echapper(g.min)}" size="9" inputmode="decimal"></label>
          <label class="large">Libellé, pièce, tiers ou utilisateur <input type="search" data-g="texte" value="${echapper(g.texte)}" placeholder="Rechercher…"></label>
        </div>
        <p class="discret">Comptes du cycle : ${config.comptes.map(([num, lib]) => `<a href="#" data-compte="${num}">${num} ${echapper(lib)}</a>`).join(' · ')}</p>
        <div class="filtres sondage">
          <label>Sondage sur les ${visibles.length} lignes affichées <select data-methode>${Object.entries(METHODES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label>Taille <input type="number" data-taille min="1" max="200" value="10" style="width:5rem"></label>
          <button type="button" data-tirer ${lectureSeule ? 'disabled' : ''}>Tirer l'échantillon</button>
          <span class="discret" data-sondage>${echapper(etat.message)}</span>
        </div>
      </div>
      <div class="panneau serre"><div class="defilement haut"><table class="dense fec">
        <thead><tr><th></th><th>Date</th><th>Jal</th><th>N° écriture</th><th>Pièce</th><th>Libellé</th><th>Tiers</th><th class="nombre">Débit</th><th class="nombre">Crédit</th><th class="nombre">Solde</th><th>Saisi par</th></tr></thead>
        <tbody>${visibles.slice(0, MAX_LIGNES).map(({ l, solde: s }) => { const it = item(l); const coche = panier.has(it.cle);
          return `<tr class="${coche ? 'cochee' : ''}"><td><input type="checkbox" data-cle="${it.cle}" ${coche ? 'checked' : ''} aria-label="Sélectionner l'écriture"></td><td class="date">${dateFr(l[COL.EcritureDate])}</td><td>${l[COL.JournalCode]}</td><td class="code">${l[COL.EcritureNum]}</td><td>${echapper(l[COL.PieceRef])}</td><td>${echapper(l[COL.EcritureLib])}</td><td>${echapper(l[COL.CompAuxLib])}</td>
            <td class="nombre">${montantOuVide(l[COL.Debit])}</td><td class="nombre">${montantOuVide(l[COL.Credit])}</td><td class="nombre">${nombre(s)}</td><td>${echapper(l[COL.Utilisateur])}</td></tr>`; }).join('') || '<tr><td colspan="11" class="vide">Aucune ligne.</td></tr>'}</tbody>
      </table></div>
      <div class="pied-tableau discret">${visibles.length.toLocaleString('fr-FR')} ligne(s)${visibles.length > MAX_LIGNES ? ` — ${MAX_LIGNES} affichées, affinez les filtres` : ''} · débit ${euro(total(COL.Debit))} · crédit ${euro(total(COL.Credit))} · solde du compte à la clôture ${euro(solde / 100)}</div></div>`;
    etat.message = '';
    const parCle = new Map(visibles.map(({ l }) => [item(l).cle, item(l)]));
    corps.querySelectorAll('[data-g]').forEach((champ) => champ.addEventListener('change', () => { g[champ.dataset.g] = champ.value; dessiner(); }));
    corps.querySelectorAll('[data-compte]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); g.compte = a.dataset.compte; dessiner(); }));
    corps.querySelectorAll('[data-cle]').forEach((caseL) => caseL.addEventListener('change', () => { basculer(parCle.get(caseL.dataset.cle), caseL.checked); caseL.closest('tr').classList.toggle('cochee', caseL.checked); }));
    corps.querySelector('[data-tirer]').addEventListener('click', () => {
      const methode = corps.querySelector('[data-methode]').value;
      const tires = echantillonner(visibles.map(({ l }) => l).filter((l) => l[COL.JournalCode] !== 'AN'), methode, Number(corps.querySelector('[data-taille]').value), (l) => l[COL.Debit] || l[COL.Credit]);
      tires.forEach((l) => panier.set(item(l).cle, item(l)));
      const valeur = tires.reduce((s, l) => s + (l[COL.Debit] || l[COL.Credit]), 0);
      const population = visibles.reduce((s, { l }) => s + (l[COL.Debit] || l[COL.Credit]), 0);
      etat.message = `${tires.length} ligne(s) tirée(s) — méthode « ${METHODES[methode]} » — ${population ? Math.round((valeur / population) * 100) : 0} % de la valeur de la population. Elles sont ajoutées à la sélection.`;
      majBarre(); dessiner();
    });
  }

  async function dessinerBanque() {
    if (!banque) {
      const corrige = await db.lire('corriges', dossier.id);
      banque = construireBanque(await lireFec(dossier, 'N'), corrige?.donnees, { graine: dossier.scenario.graine, annee, difficulte: dossier.parametres.difficulte });
    }
    const v = etat.vueBanque;
    const choix = `<div class="panneau"><div class="filtres"><label>Document <select data-vue>
      <option value="rappro" ${v === 'rappro' ? 'selected' : ''}>État de rapprochement au 31/12/${annee} (établi par le client)</option>
      ${MOIS.map((m, i) => `<option value="${i + 1}" ${String(v) === String(i + 1) ? 'selected' : ''}>Relevé bancaire — ${m} ${annee}</option>`).join('')}
      <option value="13" ${String(v) === '13' ? 'selected' : ''}>Relevé bancaire — Janvier ${annee + 1} (postérieur à la clôture)</option></select></label></div>
      <p class="discret">Documents remis par le client. Sur un relevé, un débit est une sortie d'argent et un crédit une entrée (point de vue de la banque).</p></div>`;
    const caseLigne = (it) => `<td><input type="checkbox" data-cle="${it.cle}" ${panier.has(it.cle) ? 'checked' : ''} aria-label="Sélectionner la ligne"></td>`;
    const items = new Map();
    const enregistrerItem = (it) => { items.set(it.cle, it); return it; };
    if (v === 'rappro') {
      const r = banque.rapprochement;
      const ligne = (x, source) => { const it = enregistrerItem({ cle: `rappro|${x.id}`, source: 'rappro', exercice: 'N', id: x.id, num: x.num || '', date: x.dateCompta || x.date, piece: x.piece, lib: x.libCompta || x.lib, montant: x.montant });
        return `<tr class="${panier.has(it.cle) ? 'cochee' : ''}">${caseLigne(it)}<td class="date">${dateFr(it.date)}</td><td>${echapper(x.piece || '')}</td><td>${echapper(it.lib)}</td><td class="nombre">${nombre(x.montant)}</td></tr>`; };
      const bloc = (titre, libSolde, solde, lignes, rectifie, extra = '') => `<div class="panneau serre"><h2 class="titre-tableau">${titre}</h2><div class="defilement"><table class="dense">
        <thead><tr><th></th><th>Date</th><th>Pièce</th><th>Libellé</th><th class="nombre">Montant</th></tr></thead><tbody>
        <tr class="total"><td colspan="4">${libSolde}</td><td class="nombre">${nombre(solde)}</td></tr>
        ${lignes.map(ligne).join('') || '<tr><td colspan="5" class="vide">Aucun élément.</td></tr>'}${extra}
        <tr class="total"><td colspan="4">Solde rectifié</td><td class="nombre">${nombre(rectifie)}</td></tr></tbody></table></div></div>`;
      const itEcart = r.ecart ? enregistrerItem({ cle: 'rappro|ecart', source: 'rappro', exercice: 'N', id: 'ecart', num: '', date: r.date, piece: '', lib: r.libelleEcart || 'Écart non justifié du rapprochement', montant: r.ecart }) : null;
      const ligneEcart = itEcart && r.libelleEcart ? `<tr class="${panier.has(itEcart.cle) ? 'cochee' : ''}">${caseLigne(itEcart)}<td></td><td></td><td>${echapper(r.libelleEcart)}</td><td class="nombre">${nombre(r.ecart)}</td></tr>` : '';
      corps.innerHTML = choix
        + bloc('Côté comptabilité — opérations du relevé restant à comptabiliser', `Solde du compte 521000 au 31/12/${annee}`, r.soldeCompta, r.coteCompta, r.libelleEcart ? r.soldeRectifieBanque : r.soldeRectifieCompta, ligneEcart)
        + bloc('Côté banque — opérations comptabilisées non encore passées en banque', `Solde du relevé bancaire au 31/12/${annee}`, r.soldeBanque, r.coteBanque, r.soldeRectifieBanque)
        + `<div class="panneau serre"><table class="dense"><tbody>${itEcart && !r.libelleEcart
          ? `<tr class="total ${panier.has(itEcart.cle) ? 'cochee' : ''}">${caseLigne(itEcart)}<td>Écart entre les deux soldes rectifiés, non justifié par le client</td><td class="nombre">${nombre(r.ecart)}</td></tr>`
          : '<tr class="total"><td>Écart entre les deux soldes rectifiés</td><td class="nombre">0,00</td></tr>'}</tbody></table></div>`;
    } else {
      const mois = Number(v);
      const prefixe = mois === 13 ? `${annee + 1}-01` : `${annee}-${String(mois).padStart(2, '0')}`;
      const lignes = banque.lignes.filter((l) => l.date.startsWith(prefixe));
      const avant = banque.lignes.filter((l) => l.date < prefixe + '-01');
      const soldeDebut = avant.length ? avant[avant.length - 1].solde : banque.soldeOuverture;
      const soldeFin = lignes.length ? lignes[lignes.length - 1].solde : soldeDebut;
      corps.innerHTML = choix + `<div class="panneau serre"><div class="defilement haut"><table class="dense">
        <thead><tr><th></th><th>Date</th><th>Libellé de l'opération</th><th class="nombre">Débit</th><th class="nombre">Crédit</th><th class="nombre">Solde</th></tr></thead><tbody>
        <tr class="total"><td colspan="5">Ancien solde</td><td class="nombre">${nombre(soldeDebut)}</td></tr>
        ${lignes.map((l) => { const it = enregistrerItem({ cle: `releve|${l.id}`, source: 'releve', exercice: 'N', id: l.id, num: '', date: l.date, piece: l.piece, lib: l.lib, montant: l.montant });
          return `<tr class="${panier.has(it.cle) ? 'cochee' : ''}">${caseLigne(it)}<td class="date">${dateFr(l.date)}</td><td>${echapper(l.lib)}</td><td class="nombre">${l.montant < 0 ? nombre(-l.montant) : ''}</td><td class="nombre">${l.montant > 0 ? nombre(l.montant) : ''}</td><td class="nombre">${nombre(l.solde)}</td></tr>`; }).join('') || '<tr><td colspan="6" class="vide">Aucun mouvement.</td></tr>'}
        <tr class="total"><td colspan="5">Nouveau solde</td><td class="nombre">${nombre(soldeFin)}</td></tr></tbody></table></div>
        <div class="pied-tableau discret">${lignes.length} mouvement(s)</div></div>`;
    }
    corps.querySelector('[data-vue]').addEventListener('change', (e) => { etat.vueBanque = e.target.value; dessiner(); });
    corps.querySelectorAll('[data-cle]').forEach((caseL) => caseL.addEventListener('change', () => { basculer(items.get(caseL.dataset.cle), caseL.checked); caseL.closest('tr').classList.toggle('cochee', caseL.checked); }));
  }

  let corrigeCache;
  async function dessinerOutils() {
    corrigeCache ??= (await db.lire('corriges', dossier.id)) || {};
    const donneesCachees = corrigeCache.donnees || {};
    const id = etat.outil;
    const etatOutil = (etat.etatsOutils[id] ??= {});
    const r = OUTILS[id].rendre({ dossier, annee, lignes: await lireFec(dossier, 'N'), donnees: donneesCachees, anomalies: corrigeCache.anomalies || [], etat: etatOutil, panier, donneesCycle: donnees, modifie, sauver });
    corps.innerHTML = `
      <div class="panneau"><div class="filtres"><label>Outil <select data-vue-outil>${config.outils.map((o) => `<option value="${o}" ${o === id ? 'selected' : ''}>${OUTILS[o].titre}</option>`).join('')}</select></label></div>
        <p class="discret">Les lignes cochées rejoignent la sélection : joignez-les à une feuille de travail ou proposez un ajustement.</p></div>
      <div class="panneau serre outil"><h2 class="titre-tableau">${OUTILS[id].titre}</h2><div class="corps-outil">${r.html}</div></div>`;
    corps.querySelector('[data-vue-outil]').addEventListener('change', (e) => { etat.outil = e.target.value; dessiner(); });
    corps.querySelectorAll('[data-etat-outil]').forEach((champ) => champ.addEventListener('change', () => { etatOutil[champ.dataset.etatOutil] = champ.type === 'checkbox' ? champ.checked : champ.value; dessiner(); }));
    corps.querySelectorAll('[data-tiers]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); etat.outil = a.dataset.outil; (etat.etatsOutils[a.dataset.outil] ??= {}).tiers = a.dataset.tiers; dessiner(); }));
    r.brancher?.(corps, dessiner);
    corps.querySelectorAll('[data-cle]').forEach((caseL) => caseL.addEventListener('change', () => {
      basculer(r.items.get(caseL.dataset.cle), caseL.checked);
      if (r.redessinerApresSelection) dessiner(); else caseL.closest('tr').classList.toggle('cochee', caseL.checked);
    }));
  }

  function dessinerPieces() {
    const d = documents.find((x) => x.id === etat.documentId) || documents[documents.length - 1];
    corps.innerHTML = `
      ${etat.message ? `<p class="message info">${echapper(etat.message)}</p>` : ''}
      <div class="panneau"><p>Pièces obtenues auprès du client. Pour en demander une : sélectionnez une ou plusieurs écritures dans le grand livre, puis « Demander les pièces ».
      Les montants, dates et tiers proviennent du journal ; lisez attentivement les mentions et les annexes.</p></div>
      ${documents.length ? `<div class="deux-colonnes">
        <div class="panneau serre liste-pieces">${documents.map((x) => `<a href="#" data-doc="${x.id}" class="${x.id === d.id ? 'actif' : ''}"><strong>${echapper(x.titre)}</strong><br><span class="discret">${dateFr(x.date)} · ${echapper(x.ecritureNum)}</span></a>`).join('')}</div>
        <div>${rendrePiece(d)}
          <div class="ligne" style="margin-top:.6rem"><select data-feuille aria-label="Feuille de travail">${feuilles.map((f) => `<option value="${f.id}">${f.ref} ${echapper(f.titre)}</option>`).join('') || '<option value="">Aucune feuille</option>'}</select>
          <button type="button" data-joindre ${feuilles.length && !lectureSeule ? '' : 'disabled'}>Joindre cette pièce à la feuille</button></div></div>
      </div>` : '<p class="discret">Aucune pièce au dossier pour ce cycle.</p>'}`;
    etat.message = '';
    corps.querySelectorAll('[data-doc]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); etat.documentId = a.dataset.doc; dessiner(); }));
    corps.querySelector('[data-joindre]')?.addEventListener('click', async () => {
      const f = feuilles.find((x) => x.id === corps.querySelector('[data-feuille]').value);
      if (!f || f.elements.some((el) => el.documentId === d.id)) return;
      f.elements.push({ type: 'piece', documentId: d.id, titre: d.titre });
      await enregistrerFeuille(f); modifie();
      etat.message = `Pièce jointe à la feuille ${f.ref}.`; dessiner();
    });
  }

  function dessiner() {
    majOnglets();
    ({ programme: dessinerProgramme, feuilles: dessinerFeuilles, gl: dessinerGrandLivre, banque: dessinerBanque, outils: dessinerOutils, pieces: dessinerPieces })[etat.onglet]();
  }
  zone.querySelector('.onglets').addEventListener('click', (e) => { const b = e.target.closest('[data-onglet]'); if (b) { if (b.dataset.onglet === 'feuilles') etat.feuilleId = null; aller(b.dataset.onglet); } });
  dessiner();
}

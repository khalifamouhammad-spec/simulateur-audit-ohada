// Dossier ouvert : bandeau client / exercice / statut, arborescence latérale, élément affiché.
import { STRUCTURE_DOSSIER, STATUTS, STATUTS_MISSION, SECTEURS, TAILLES, NIVEAUX, REFERENTIELS, PHASE_COURANTE, trouverElement } from '../config.js';
import { db, lireParametres } from '../db.js';
import { enregistrerDossier, statutElement, avancement, dureeFr } from '../dossiers.js';
import { genererClient } from '../generation.js';
import { afficherFec, afficherBalance, afficherEtats } from '../sections/donnees.js';
import { afficherFicheClient, afficherIndependance, afficherLettreMission, afficherFicheEntreprise, afficherMatriceRisques, afficherSeuils } from '../sections/planification.js';
import { afficherControleInterne } from '../sections/controle-interne.js';
import { afficherRevueAnalytique } from '../sections/revue-analytique.js';
import { ecranCycle } from '../sections/cycle.js';
import { afficherAjustements } from '../sections/ajustements.js';
import { CONFIGS_CYCLES } from '../cycles/index.js';
import { afficherCorrection } from '../sections/correction.js';
import { afficherRevue } from '../sections/revue.js';
import { afficherEvenements, afficherAffirmation, afficherSynthese as afficherNoteSynthese, afficherRapport } from '../sections/finalisation.js';
import { echapper, dateFr, euro, variationPct, pctFr } from '../utils.js';

// Écrans fonctionnels, par code d'élément. Les autres affichent leur contenu prévu.
const ECRANS = {
  X1: afficherFec, X2: afficherBalance, X3: afficherEtats,
  A1: afficherFicheClient, A2: afficherIndependance, A3: afficherLettreMission,
  B1: afficherFicheEntreprise, B2: afficherControleInterne, B3: afficherRevueAnalytique, B4: afficherMatriceRisques,
  C1: afficherSeuils,
  ...Object.fromEntries(Object.values(CONFIGS_CYCLES).map((c) => [c.code, ecranCycle(c)])),
  E1: afficherAjustements,
  F1: afficherRevue,
  G1: afficherEvenements, G2: afficherAffirmation, G3: afficherNoteSynthese, G4: afficherRapport,
  H1: afficherCorrection,
};

const pastille = (statut) => `<span class="pastille ${STATUTS[statut].classe}">${STATUTS[statut].libelle}</span>`;
const recharger = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

/** Affiche le dossier et renvoie une fonction de fermeture (arrêt du minuteur, sauvegarde). */
export async function afficherDossier(vue, id, code) {
  const dossier = await db.lire('dossiers', id);
  if (!dossier) {
    vue.innerHTML = '<main class="page"><p class="message erreur">Dossier introuvable.</p><a href="#/">Retour au tableau de bord</a></main>';
    return null;
  }
  const element = trouverElement(code);
  const cloturee = dossier.statut === 'cloturee';

  vue.innerHTML = `
    <div class="bandeau-dossier">
      <button class="menu" data-menu aria-label="Afficher l'arborescence">☰</button>
      <div class="client"><strong>${echapper(dossier.client.nom)}</strong><span>${echapper(dossier.client.formeJuridique)} · ${echapper(SECTEURS[dossier.parametres.secteur])} · ${TAILLES[dossier.parametres.taille].libelle}</span></div>
      <div class="info"><span>Exercice</span><strong>${dateFr(dossier.exercice.debut)} – ${dateFr(dossier.exercice.cloture)}</strong></div>
      <div class="info"><span>Mission</span><span class="pastille ${STATUTS_MISSION[dossier.statut].classe}">${STATUTS_MISSION[dossier.statut].libelle}</span></div>
      <div class="info"><span>Avancement</span><strong data-avancement></strong></div>
      <div class="info"><span>Temps passé</span><strong data-temps></strong></div>
    </div>
    <div class="espace-travail">
      <aside class="arborescence" data-arbre></aside>
      <main class="contenu" data-contenu></main>
    </div>`;

  const arbre = vue.querySelector('[data-arbre]');
  const majBandeau = () => {
    vue.querySelector('[data-avancement]').textContent = avancement(dossier) + ' %';
    vue.querySelector('[data-temps]').textContent = dureeFr(dossier.tempsSecondes);
  };
  const dessinerArbre = () => {
    arbre.innerHTML = `
      <a class="noeud racine ${element ? '' : 'actif'}" href="#/dossier/${id}">Synthèse du dossier</a>
      ${STRUCTURE_DOSSIER.map((s) => `
        <details open>
          <summary><b>${s.code === 'X' ? 'Compta' : s.code}</b> ${echapper(s.libelle)}</summary>
          ${s.elements.map((e) => `
            <a class="noeud ${e.code === code ? 'actif' : ''}" href="#/dossier/${id}/${e.code}" title="${echapper(e.libelle)}">
              <i class="point ${e.verrouille && !cloturee ? 'verrou' : s.suivi === false ? (dossier.scenario ? 'vert' : 'gris') : STATUTS[statutElement(dossier, e.code)].classe}"></i>
              <span class="code">${e.code}</span><span class="libelle">${echapper(e.libelle)}</span>
            </a>`).join('')}
        </details>`).join('')}`;
  };

  // Les saisies sont enregistrées avec un léger différé ; la fermeture de la vue force l'écriture en attente.
  let attente = null;
  const sauver = async () => { clearTimeout(attente); attente = null; await enregistrerDossier(dossier); dessinerArbre(); majBandeau(); };
  const sauverDiffere = (apres) => { clearTimeout(attente); attente = setTimeout(async () => { await sauver(); apres?.(); }, 400); };

  const contenu = vue.querySelector('[data-contenu]');
  dessinerArbre();
  majBandeau();
  if (!element) afficherSynthese(contenu, dossier);
  else await afficherElement(contenu, dossier, element, sauver, sauverDiffere);
  vue.querySelector('[data-menu]').addEventListener('click', () => arbre.classList.toggle('ouverte'));

  // Temps passé : compté uniquement quand l'onglet est visible, enregistré toutes les 20 secondes.
  let nonEnregistre = 0;
  const minuteur = cloturee || !dossier.scenario ? null : setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    dossier.tempsSecondes++;
    if (++nonEnregistre >= 20) { nonEnregistre = 0; db.ecrire('dossiers', dossier); }
    if (dossier.tempsSecondes % 60 === 0) majBandeau();
  }, 1000);
  return async () => {
    clearInterval(minuteur);
    if (attente) await sauver();
    else if (nonEnregistre) await db.ecrire('dossiers', dossier);
  };
}

/** Panneau de génération du client, tant que le dossier n'a ni scénario ni journal. */
function afficherGeneration(contenu, dossier) {
  contenu.innerHTML = `
    <h1>Création du client</h1>
    <div class="panneau">
      <p>Le client fictif et sa comptabilité (journal des écritures N-1 et N) n'ont pas encore été générés.</p>
      <ul>
        <li><strong>Avec l'IA</strong> : l'IA rédige la fiche du client, son contexte et choisit les anomalies ; le logiciel génère ensuite la comptabilité.</li>
        <li><strong>Sans IA</strong> : le scénario est tiré d'un modèle intégré au logiciel. Aucune clé n'est nécessaire.</li>
      </ul>
      <div class="ligne"><button class="principal" data-generer="ia">Générer avec l'IA</button><button data-generer="local">Générer sans IA</button></div>
      <div data-etat></div>
    </div>`;
  const etat = contenu.querySelector('[data-etat]');
  const lancer = async (mode) => {
    const boutons = contenu.querySelectorAll('[data-generer]');
    boutons.forEach((b) => { b.disabled = true; });
    try {
      if (mode === 'ia' && !(await lireParametres()).cleGroq) throw new Error("Aucune clé API Groq : saisissez-la dans les Paramètres, ou générez le client sans IA.");
      await genererClient(dossier, { mode, suivi: (t) => { etat.innerHTML = `<p class="message info">${echapper(t)}</p>`; } });
      recharger();
    } catch (e) {
      etat.innerHTML = `<p class="message erreur">${echapper(e.message)}</p>`;
      boutons.forEach((b) => { b.disabled = false; });
    }
  };
  contenu.querySelectorAll('[data-generer]').forEach((b) => b.addEventListener('click', () => lancer(b.dataset.generer)));
  // Mode choisi à la création du dossier : la génération démarre aussitôt.
  const mode = dossier.parametres.modeGeneration;
  if (mode) { delete dossier.parametres.modeGeneration; db.ecrire('dossiers', dossier).then(() => lancer(mode)); }
}

function afficherSynthese(contenu, dossier) {
  if (!dossier.scenario) { afficherGeneration(contenu, dossier); return; }
  const p = dossier.parametres;
  const c = dossier.client;
  const n = dossier.chiffres.N;
  const n1 = dossier.chiffres['N-1'];
  const ligne = (libelle, cle) => `<tr><td>${libelle}</td><td class="nombre">${euro(n[cle])}</td><td class="nombre">${euro(n1[cle])}</td><td class="nombre">${pctFr(variationPct(n[cle], n1[cle]))}</td></tr>`;
  contenu.innerHTML = `
    <h1>Synthèse du dossier</h1>
    ${dossier.statut === 'cloturee' && dossier.correction ? `<div class="message succes ligne espace"><span>Mission clôturée — note globale <strong>${String(dossier.correction.globale).replace('.', ',')} / 20</strong>. Le dossier est en consultation seule.</span><a class="bouton" href="#/dossier/${dossier.id}/H1">Voir le corrigé</a></div>` : ''}
    <div class="indicateurs">
      <div class="indicateur"><span>Secteur</span><strong>${echapper(SECTEURS[p.secteur])}</strong></div>
      <div class="indicateur"><span>Taille</span><strong>${TAILLES[p.taille].libelle} · ${c.effectif} salariés</strong></div>
      <div class="indicateur"><span>Difficulté</span><strong>${NIVEAUX[p.difficulte].libelle}</strong></div>
      <div class="indicateur"><span>Anomalies cachées</span><strong>${p.nbAnomalies}</strong></div>
      <div class="indicateur"><span>Référentiel</span><strong>${echapper(REFERENTIELS[p.referentiel].normes)}</strong></div>
    </div>
    <div class="panneau">
      <h2>${echapper(c.nom)}</h2>
      <p class="discret">${echapper(c.formeJuridique)} · NINEA ${echapper(c.siren)} (fictif) · ${echapper(c.ville)} · créée en ${echapper(c.dateCreation)} · dirigeant : ${echapper(c.dirigeant)}</p>
      <p><strong>Activité.</strong> ${echapper(c.activite)}</p>
      <p><strong>Organisation.</strong> ${echapper(c.organisation)}</p>
      <p><strong>Système d'information.</strong> ${echapper(c.systemeInformation)}</p>
      <p><strong>Contexte de la mission.</strong> ${echapper(c.contexteMission)}</p>
      ${c.faitsMarquants?.length ? `<p><strong>Faits marquants de l'exercice.</strong></p><ul>${c.faitsMarquants.map((f) => `<li>${echapper(f)}</li>`).join('')}</ul>` : ''}
      <p class="discret">Scénario ${dossier.scenario.source === 'ia' ? "rédigé par l'IA" : 'issu du modèle intégré (sans IA)'} ; comptabilité générée et contrôlée par le logiciel.</p>
    </div>
    <div class="panneau serre">
      <h2 class="titre-tableau">Chiffres clés (calculés à partir du journal)</h2>
      <div class="defilement"><table class="dense">
        <thead><tr><th></th><th class="nombre">N</th><th class="nombre">N-1</th><th class="nombre">Variation</th></tr></thead>
        <tbody>${ligne("Chiffre d'affaires", 'chiffreAffaires')}${ligne("Résultat d'exploitation", 'resultatExploitation')}${ligne('Résultat net', 'resultatNet')}${ligne('Total du bilan', 'totalBilan')}${ligne('Capitaux propres', 'capitauxPropres')}
          <tr><td>Lignes du journal</td><td class="nombre">${n.nbLignes.toLocaleString('fr-FR')}</td><td class="nombre">${n1.nbLignes.toLocaleString('fr-FR')}</td><td></td></tr></tbody>
      </table></div>
    </div>
    <p><a class="bouton" href="#/dossier/${dossier.id}/X1">Consulter le journal</a> <a class="bouton" href="#/dossier/${dossier.id}/X3">États financiers et contrôles</a>
      ${dossier.statut === 'cloturee' ? '' : `<a class="bouton" href="#/dossier/${dossier.id}/H1">Clôturer la mission…</a>`}</p>
    ${p.extraitRapport ? `<div class="panneau"><h2>Extrait de rapport ayant servi de modèle</h2><p class="discret">${echapper(p.extraitRapport)}</p></div>` : ''}
    <div class="panneau serre">
      <h2 class="titre-tableau">État d'avancement</h2>
      <div class="defilement"><table class="dense">
        <thead><tr><th>Réf.</th><th>Élément</th><th>Section</th><th>Statut</th></tr></thead>
        <tbody>${STRUCTURE_DOSSIER.filter((s) => s.suivi !== false).flatMap((s) => s.elements.map((e) => `
          <tr><td><a href="#/dossier/${dossier.id}/${e.code}">${e.code}</a></td><td>${echapper(e.libelle)}</td><td>${s.code} — ${echapper(s.libelle)}</td><td>${pastille(statutElement(dossier, e.code))}</td></tr>`)).join('')}</tbody>
      </table></div>
    </div>`;
}

async function afficherElement(contenu, dossier, element, sauver, sauverDiffere) {
  const section = STRUCTURE_DOSSIER.find((s) => s.code === element.section);
  const cloturee = dossier.statut === 'cloturee';
  const disponible = element.phase <= PHASE_COURANTE;
  const ecran = disponible ? ECRANS[element.code] : null;
  const etat = element.suivi ? (dossier.elements[element.code] ??= { statut: 'a_faire', notes: '' }) : null;
  contenu.innerHTML = `
    <p class="fil">${section.code === 'X' ? 'Compta' : section.code} — ${echapper(section.libelle)}</p>
    <div class="ligne espace">
      <h1><span class="code">${element.code}</span> ${echapper(element.libelle)}</h1>
      ${element.suivi ? `<label class="en-ligne">Statut <select data-statut ${cloturee ? 'disabled' : ''}>${Object.entries(STATUTS).map(([k, s]) => `<option value="${k}" ${etat.statut === k ? 'selected' : ''}>${s.libelle}</option>`).join('')}</select></label>` : ''}
    </div>`;
  contenu.querySelector('[data-statut]')?.addEventListener('change', (e) => { etat.statut = e.target.value; sauver(); });
  if (ecran) {
    if (!dossier.scenario) { contenu.insertAdjacentHTML('beforeend', `<p class="message info">Le client n'est pas encore généré : rendez-vous sur la <a href="#/dossier/${dossier.id}">synthèse du dossier</a>.</p>`); return; }
    const zone = document.createElement('fieldset');
    zone.className = 'ecran';
    contenu.append(zone);
    // « modifie » : à appeler à chaque saisie ; passe l'élément « en cours » et enregistre en différé.
    const modifie = () => {
      if (etat && etat.statut === 'a_faire') { etat.statut = 'en_cours'; contenu.querySelector('[data-statut]').value = 'en_cours'; }
      sauverDiffere();
    };
    // Mission clôturée : consultation seule. Seules les commandes de navigation (onglets, filtres) restent actives.
    const verrouiller = () => zone.querySelectorAll('input, textarea, select, button').forEach((el) => { if (!el.matches('[data-onglet], [data-vue], [data-vue-outil], [data-etat-outil], [data-g], [data-retour], [data-f]')) el.disabled = true; });
    if (cloturee && element.suivi) { zone.classList.add('lecture-seule'); new MutationObserver(verrouiller).observe(zone, { childList: true, subtree: true }); }
    await ecran(zone, { dossier, sauver, sauverDiffere, modifie, lectureSeule: cloturee, donnees: etat ? (etat.donnees ??= {}) : null });
    if (cloturee && element.suivi) verrouiller();
    return;
  }
  contenu.insertAdjacentHTML('beforeend', `
    ${element.verrouille && !cloturee ? '<p class="message attention">🔒 Le corrigé reste caché tant que la mission n\'est pas clôturée.</p>' : ''}
    ${disponible ? '' : `<p class="message info">Cet élément sera fonctionnel à la phase ${element.phase} du développement (phase actuelle : ${PHASE_COURANTE}).</p>`}
    <div class="panneau">
      <h2>Contenu prévu</h2>
      <ul>${element.contenu.map((c) => `<li>${echapper(c)}</li>`).join('')}</ul>
    </div>
    ${element.suivi ? `<div class="panneau">
      <h2>Notes de travail</h2>
      <textarea data-notes ${cloturee ? 'disabled' : ''} placeholder="Notes libres sur cet élément du dossier…">${echapper(etat.notes)}</textarea>
      <p class="discret" data-enregistre></p>
    </div>` : ''}`);
  contenu.querySelector('[data-notes]')?.addEventListener('input', (e) => {
    etat.notes = e.target.value;
    if (etat.statut === 'a_faire' && etat.notes.trim()) { etat.statut = 'en_cours'; contenu.querySelector('[data-statut]').value = 'en_cours'; }
    contenu.querySelector('[data-enregistre]').textContent = '';
    sauverDiffere(() => { contenu.querySelector('[data-enregistre]').textContent = 'Enregistré.'; });
  });
}

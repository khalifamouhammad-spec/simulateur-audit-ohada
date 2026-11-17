// H1 — Clôture de la mission et corrigé. Le corrigé n'est lu qu'après la clôture.
import { CYCLES, REFERENTIELS, ELEMENTS } from '../config.js';
import { CONFIGS_CYCLES } from '../cycles/index.js';
import { db, lireParametres } from '../db.js';
import { statutElement } from '../dossiers.js';
import { listerFeuilles, listerDocuments } from '../feuilles.js';
import { revueAnalytique } from '../moteur/analytique.js';
import { evaluerMission, commenterParIA, ajouterTiers, SECTIONS, PONDERATIONS, OPINIONS_LIB } from '../correction.js';
import { revueSoldee } from './revue.js';
import { CLASSES_EVENEMENT } from '../moteur/evenements.js';
import { impactResultat } from './ajustements.js';
import { lireFec } from './donnees.js';
import { echapper, euro, lireNombre } from '../utils.js';

const note = (n) => `${String(n).replace('.', ',')} / 20`;

/** Opinion et événements postérieurs dans le corrigé. */
function blocFinalisation(ev) {
  const f = ev.sections.finalisation;
  if (!f?.opinion) return '';
  const o = f.opinion;
  return `<div class="panneau">
    <h2>Opinion et événements postérieurs</h2>
    <div class="defilement"><table class="dense"><tbody>
      <tr><td>Votre opinion</td><td><strong>${echapper(OPINIONS_LIB[o.choisie] || 'aucune')}</strong></td></tr>
      <tr><td>Opinion cohérente avec vos constats (anomalies non corrigées ${euro(o.propre)}, seuil ${euro(o.seuilPropre)})</td><td><span class="pastille ${o.choisie === o.coherente ? 'vert' : 'orange'}">${echapper(OPINIONS_LIB[o.coherente])}</span></td></tr>
      <tr><td>Opinion appropriée au vu de la réalité (anomalies non corrigées ou non détectées ${euro(o.reel)}, seuil de référence ${euro(o.seuilRef)})</td><td><span class="pastille ${o.choisie === o.appropriee ? 'vert' : 'orange'}">${echapper(OPINIONS_LIB[o.appropriee])}</span></td></tr>
    </tbody></table></div>
    <p class="discret">Règle appliquée : cumul inférieur au seuil de signification → opinion sans réserve ; significatif → opinion avec réserve ; supérieur à cinq fois le seuil (incidence généralisée) → opinion défavorable (ISA 705).</p>
    ${f.evenements.length ? `<h3>Événements postérieurs à la clôture</h3><div class="defilement"><table class="dense"><thead><tr><th>Événement</th><th>Votre traitement</th><th>Traitement attendu</th></tr></thead><tbody>
      ${f.evenements.map((e) => `<tr><td>${echapper(e.texte)}<br><span class="discret">${echapper(e.explication)}</span></td><td>${echapper(CLASSES_EVENEMENT[e.reponse] || '—')}</td><td><span class="pastille ${e.reponse === e.attendu ? 'vert' : 'orange'}">${echapper(CLASSES_EVENEMENT[e.attendu])}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
  </div>`;
}
const classeNote = (n) => (n >= 14 ? 'vert' : n >= 10 ? 'orange' : 'rouge');
const recharger = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

/** Points d'attention avant clôture (n'empêchent pas de clôturer). */
async function verificationsAvantCloture(dossier) {
  const feuilles = await listerFeuilles(dossier.id);
  const alertes = [];
  if (!dossier.seuils?.signification) alertes.push("Le seuil de signification n'est pas fixé (C1).");
  if (!(dossier.ajustements || []).length) alertes.push("Aucun ajustement proposé dans le tableau E1 : c'est là que vos anomalies sont comparées au corrigé.");
  const sansConclusion = feuilles.filter((f) => !f.conclusion.trim());
  if (sansConclusion.length) alertes.push(`${sansConclusion.length} feuille(s) de travail sans conclusion (${sansConclusion.map((f) => f.ref).join(', ')}).`);
  const sansFeuille = Object.values(CONFIGS_CYCLES).filter((c) => !feuilles.some((f) => f.cycle === c.id)).map((c) => c.code);
  if (sansFeuille.length) alertes.push(`Cycles sans feuille de travail : ${sansFeuille.join(', ')}. Les travaux sont notés sur les cycles qui comportaient des anomalies.`);
  const enAttente = (dossier.ajustements || []).filter((a) => a.decision === 'attente');
  if (enAttente.length) alertes.push(`${enAttente.length} ajustement(s) sans décision du client.`);
  const nonValides = ELEMENTS.filter((e) => e.suivi && e.phase <= 7 && statutElement(dossier, e.code) !== 'valide').map((e) => e.code);
  if (nonValides.length) alertes.push(`Éléments du dossier non validés : ${nonValides.join(', ')}.`);
  return alertes;
}

async function demanderCommentaire(dossier, corrige) {
  const parametres = await lireParametres();
  if (!parametres.cleGroq) return;
  try {
    dossier.correction.ia = await commenterParIA({ dossier, corrige, evaluation: dossier.correction, feuilles: await listerFeuilles(dossier.id), parametres });
    dossier.correction.erreurIA = null;
  } catch (e) {
    dossier.correction.erreurIA = e.message;
  }
  await db.ecrire('dossiers', dossier);
}

export async function cloturerMission(dossier, suivi = () => {}) {
  suivi('Calcul de la correction…');
  const [corrige, feuilles, documents, n, n1] = await Promise.all([
    db.lire('corriges', dossier.id), listerFeuilles(dossier.id), listerDocuments(dossier.id), lireFec(dossier, 'N'), lireFec(dossier, 'N-1'),
  ]);
  corrige.anomalies = ajouterTiers(corrige.anomalies, corrige.donnees, n, dossier.tiers);
  const seuil = dossier.seuils?.planification || Math.round(dossier.chiffres.N.produitsExploitation * 0.01);
  const r = revueAnalytique(n, n1, seuil);
  const significatifs = [...r.postes, ...r.ratios].filter((x) => x.significatif).map((x) => x.id).concat(r.mensuel.filter((m) => m.significatif).map((m) => 'mois_' + m.mois));
  dossier.correction = evaluerMission({ dossier, corrige, feuilles, documents, revue: { significatifs } });
  dossier.statut = 'cloturee';
  dossier.modifieLe = new Date().toISOString();
  await db.ecrire('dossiers', dossier);
  suivi("L'associé relit votre dossier…");
  await demanderCommentaire(dossier, corrige);
}

export async function afficherCorrection(zone, { dossier }) {
  if (dossier.statut !== 'cloturee') return afficherAvantCloture(zone, dossier);
  const corrige = await db.lire('corriges', dossier.id);
  const ev = dossier.correction;
  const anomalies = new Map(corrige.anomalies.map((a) => [a.id, a]));
  const ajustements = new Map((dossier.ajustements || []).map((a) => [a.id, a]));
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  const ia = ev.ia;
  const res = ev.comparaison.resultats;
  const perimetre = res.filter((r) => r.perimetre);
  const blocAnomalie = (r) => {
    const a = anomalies.get(r.anomalieId);
    const classe = r.trouvee ? (r.chiffrage ? 'ok' : 'moyen') : 'ko';
    return `<div class="bloc-anomalie ${classe}">
      <div class="ligne espace"><strong>${r.trouvee ? '✔ Trouvée' : '✘ Ratée'} — ${echapper(a.libelle)}</strong><span>${a.fraude ? '<span class="pastille rouge">Fraude</span> ' : ''}<span class="pastille gris">${echapper(CYCLES[a.cycle])} · ${echapper(a.assertion)}</span></span></div>
      <p class="discret">Montant : ${euro(a.montant)} · incidence sur le résultat : ${euro(a.impactResultat)} · écritures : ${a.ecritures.map((e) => `${e.num}${e.exercice === 'N' ? '' : ` (${e.exercice})`}`).join(', ') || 'aucune (élément absent de la comptabilité)'}</p>
      <p>${echapper(a.explication)}</p>
      <p><strong>Procédure qui la détecte.</strong> ${echapper(a.procedure)}</p>
      <p><strong>Correction attendue.</strong> ${echapper(a.correction)}</p>
      ${r.trouvee ? `<p class="discret">Votre ajustement : ${r.ajustements.map((id) => { const aj = ajustements.get(id); return `« ${echapper(aj.description)} » (incidence ${euro(impactResultat(aj))})`; }).join(' ; ')} — <span class="pastille ${r.chiffrage ? 'vert' : 'orange'}">${r.chiffrage ? 'Chiffrage correct' : 'Chiffrage à revoir'}</span></p>` : ''}
    </div>`;
  };
  const pointsLocaux = Object.entries(ev.sections).sort((x, y) => x[1].note - y[1].note).flatMap(([, s]) => s.constats.filter((c) => !/^(Seuil retenu|\d+ anomalie\(s\) trouvée|\d+ procédure|\d+ feuille)/.test(c))).slice(0, 5);
  zone.innerHTML = `
    <div class="panneau">
      <div class="ligne espace">
        <div><h2>Note globale</h2><div class="note-globale ${classeNote(ev.globale)}">${note(ev.globale)}</div>
          <p class="discret">Mission clôturée le ${new Date(ev.date).toLocaleDateString('fr-FR')}. Toutes les anomalies du dossier sont notées.</p></div>
        <div class="indicateurs" style="flex:1;min-width:280px">
          <div class="indicateur"><span>Trouvées</span><strong>${ev.resume.trouvees} / ${ev.resume.perimetre}</strong></div>
          <div class="indicateur"><span>Ratées</span><strong>${ev.resume.perimetre - ev.resume.trouvees}</strong></div>
          <div class="indicateur"><span>Fausses alertes</span><strong>${ev.resume.faussesAlertes}</strong></div>
        </div>
      </div>
    </div>
    <div class="panneau serre"><h2 class="titre-tableau">Notes par section</h2><div class="defilement"><table class="dense">
      <thead><tr><th>Section</th><th class="nombre">Poids</th><th class="nombre">Note</th><th>Constats</th></tr></thead>
      <tbody>${Object.entries(SECTIONS).filter(([k]) => ev.sections[k]).map(([k, lib]) => `<tr><td><strong>${lib}</strong></td><td class="nombre">${Math.round(PONDERATIONS[k] * 100)} %</td>
        <td class="nombre"><span class="pastille ${classeNote(ev.sections[k].note)}">${note(ev.sections[k].note)}</span></td>
        <td><ul class="constats">${ev.sections[k].constats.map((c) => `<li>${echapper(c)}</li>`).join('')}</ul>${ia?.[k] ? `<p class="avis"><strong>Associé :</strong> ${echapper(ia[k])}</p>` : ''}</td></tr>`).join('')}
        <tr class="total"><td>Note globale</td><td class="nombre">100 %</td><td class="nombre">${note(ev.globale)}</td><td class="discret"></td></tr></tbody>
    </table></div></div>
    <div class="panneau">
      <h2>Appréciation de l'associé (normes ${N})</h2>
      ${ia ? `<p>${echapper(ia.synthese)}</p><p class="discret">Commentaire rédigé par une IA : vérifiez les références normatives citées dans les textes officiels.</p>`
        : `<p class="message attention">${echapper(ev.erreurIA || "Pas de commentaire de l'IA : aucune clé Groq n'était enregistrée lors de la clôture. Les notes et constats ci-dessus sont calculés par le logiciel.")}</p>
           <button type="button" data-ia>Demander le commentaire de l'associé (IA)</button> <span data-etat class="discret"></span>`}
      <h3>Points à retravailler</h3>
      <ul>${(ia?.points?.length ? ia.points : pointsLocaux).map((p) => `<li>${echapper(p)}</li>`).join('') || '<li>Aucun point particulier.</li>'}</ul>
    </div>
    ${blocFinalisation(ev)}
    <h2>Anomalies du périmètre noté (${perimetre.length})</h2>
    ${perimetre.filter((r) => !r.trouvee).map(blocAnomalie).join('')}
    ${perimetre.filter((r) => r.trouvee).map(blocAnomalie).join('')}
    ${!perimetre.length ? '<p class="discret">Aucune anomalie dans le périmètre noté.</p>' : ''}
    <h2>Fausses alertes (${ev.comparaison.faussesAlertes.length})</h2>
    ${ev.comparaison.faussesAlertes.map((id) => { const aj = ajustements.get(id); return `<div class="bloc-anomalie moyen"><strong>${echapper(aj.description)}</strong>
      <p class="discret">Incidence ${euro(impactResultat(aj))} · ${aj.lignes.map((l) => `${lireNombre(l.debit) ? 'D' : 'C'} ${echapper(l.compte)} ${euro(lireNombre(l.debit) || lireNombre(l.credit))}`).join(' / ')}</p>
      <p>Cet ajustement ne correspond à aucune anomalie du dossier. Vérifiez votre raisonnement sur les lignes concernées : ${(aj.references || []).map((r) => echapper(r.num || r.lib)).join(', ') || 'aucune ligne référencée'}.</p></div>`; }).join('') || '<p class="discret">Aucune fausse alerte.</p>'}
    <details class="panneau"><summary>Autres anomalies du dossier, hors périmètre noté (${res.length - perimetre.length})</summary>
      <p class="discret">Elles relèvent de cycles non encore disponibles au moment de la clôture.</p>
      ${res.filter((r) => !r.perimetre).map(blocAnomalie).join('') || '<p class="discret">Aucune.</p>'}
    </details>`;
  zone.querySelector('[data-ia]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    zone.querySelector('[data-etat]').textContent = "L'associé relit votre dossier…";
    if (!(await lireParametres()).cleGroq) { zone.querySelector('[data-etat]').textContent = 'Saisissez une clé Groq dans les Paramètres.'; e.target.disabled = false; return; }
    await demanderCommentaire(dossier, corrige);
    recharger();
  });
}

/** Conditions bloquantes : revue du manager soldée et opinion formulée. */
function bloquants(dossier) {
  const b = [];
  if (!revueSoldee(dossier)) b.push(`Revue du manager (F1) : demandez une revue et répondez à chaque point de revue.`);
  if (!dossier.elements?.G4?.donnees?.opinion) b.push("Rapport (G4) : choisissez et justifiez votre opinion.");
  return b;
}

async function afficherAvantCloture(zone, dossier) {
  const alertes = await verificationsAvantCloture(dossier);
  const bloque = bloquants(dossier);
  zone.innerHTML = `
    <div class="panneau">
      <h2>Clôturer la mission</h2>
      <p>La clôture fige le dossier : vos travaux ne sont plus modifiables et le corrigé devient consultable ici, avec une note sur 20 par section et une note globale.</p>
      <p>Vos anomalies sont comparées au corrigé à partir du <a href="#/dossier/${dossier.id}/E1">tableau des ajustements (E1)</a> : une anomalie n'est « trouvée » que si un ajustement y renvoie à ses écritures ou en reprend le montant.</p>
      ${alertes.length ? `<div class="message attention"><strong>Points d'attention avant clôture</strong><ul>${alertes.map((a) => `<li>${echapper(a)}</li>`).join('')}</ul></div>` : '<p class="message succes">Aucun point d\'attention : le dossier est prêt à être clôturé.</p>'}
      ${bloque.length ? `<div class="message erreur"><strong>Clôture impossible pour l'instant</strong><ul>${bloque.map((x) => `<li>${echapper(x)}</li>`).join('')}</ul></div>` : ''}
      <button type="button" class="principal" data-cloturer ${bloque.length ? 'disabled' : ''}>Clôturer la mission et afficher le corrigé</button>
      <p data-etat class="discret"></p>
    </div>`;
  zone.querySelector('[data-cloturer]').addEventListener('click', async (e) => {
    if (!confirm('Clôturer définitivement la mission ? Vos travaux ne seront plus modifiables.')) return;
    e.target.disabled = true;
    await cloturerMission(dossier, (t) => { zone.querySelector('[data-etat]').textContent = t; });
    recharger();
  });
}

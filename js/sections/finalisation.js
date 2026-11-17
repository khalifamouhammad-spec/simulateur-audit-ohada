// Section G — Finalisation : événements postérieurs (G1), lettre d'affirmation (G2),
// note de synthèse (G3), rapport sur les états financiers annuels et opinion (G4).
import { REFERENTIELS } from '../config.js';
import { db } from '../db.js';
import { evenementsPosterieurs, CLASSES_EVENEMENT } from '../moteur/evenements.js';
import { impactResultat } from './ajustements.js';
import { lier, zoneTexte } from './formulaire.js';
import { echapper, euro, dateFr } from '../utils.js';

export const OPINIONS = {
  sans_reserve: 'Opinion sans réserve (certification sans réserve)',
  reserve: 'Opinion avec réserve (certification avec réserve)',
  defavorable: 'Opinion défavorable (refus de certifier)',
  impossibilite: "Impossibilité d'exprimer une opinion (refus de certifier)",
};

/** Cumul des anomalies non corrigées selon le tableau E1 (euros, valeur absolue de l'incidence sur le résultat). */
export function cumulNonCorrige(dossier) {
  const retenus = (dossier.ajustements || []).filter((a) => a.decision !== 'corrigee');
  return {
    net: retenus.reduce((s, a) => s + Math.round(impactResultat(a) * 100), 0) / 100,
    absolu: retenus.reduce((s, a) => s + Math.abs(Math.round(impactResultat(a) * 100)), 0) / 100,
    nombre: retenus.length,
    enAttente: (dossier.ajustements || []).filter((a) => a.decision === 'attente').length,
  };
}

// ------------------------------------------------------------------ G1
export async function afficherEvenements(zone, { dossier, donnees, modifie }) {
  const corrige = await db.lire('corriges', dossier.id);
  const evenements = evenementsPosterieurs(dossier, corrige);
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  zone.innerHTML = `
    <div class="panneau"><p>Informations recueillies entre la clôture et la date de votre rapport : entretiens avec la direction, procès-verbaux, correspondances, situations comptables de début d'exercice (${N} 560).
      Pour chaque événement, indiquez son traitement : un événement qui confirme une situation existant à la clôture <strong>ajuste les comptes</strong> ; un événement né après la clôture fait l'objet, s'il est significatif, d'une <strong>information en annexe</strong>.</p></div>
    <div class="panneau serre"><div class="defilement"><table class="dense">
      <thead><tr><th>Date</th><th>Événement</th><th>Traitement</th><th>Incidence et travaux complémentaires</th></tr></thead>
      <tbody>${evenements.map((e) => `<tr><td class="date">${dateFr(e.date)}</td><td>${echapper(e.texte)}</td>
        <td><select data-champ="c_${e.id}" aria-label="Traitement"><option value="">— Choisir —</option>${Object.entries(CLASSES_EVENEMENT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></td>
        <td class="reponse"><textarea rows="2" data-champ="i_${e.id}" aria-label="Incidence"></textarea></td></tr>`).join('')}</tbody>
    </table></div></div>
    <div class="panneau">${zoneTexte('conclusion', 'Conclusion sur les événements postérieurs', 'Événements à traduire dans les comptes ou en annexe, et incidence éventuelle sur votre rapport.', 3)}</div>`;
  lier(zone, donnees, modifie);
}

// ------------------------------------------------------------------ G2
function modeleAffirmation(dossier) {
  const c = dossier.client;
  const an = dossier.exercice.cloture.slice(0, 4);
  const nonCorriges = (dossier.ajustements || []).filter((a) => a.decision === 'non_corrigee');
  return `${c.nom}
${c.ville}, le [date — au plus tard celle du rapport]

À l'attention du commissaire aux comptes

Objet : lettre d'affirmation — exercice clos le ${dateFr(dossier.exercice.cloture)}

Madame, Monsieur,

Dans le cadre de votre mission de certification des états financiers annuels de l'exercice ${an}, nous confirmons, à notre connaissance et en notre qualité de dirigeants, les déclarations suivantes :

1. Nous avons satisfait à notre responsabilité d'établir des états financiers annuels réguliers et sincères donnant une image fidèle, conformément au SYSCOHADA révisé (Acte uniforme relatif au droit comptable et à l'information financière).
2. Nous vous avons donné accès à toutes les informations et à tous les documents utiles, ainsi qu'aux personnes que vous avez souhaité rencontrer.
3. Toutes les opérations ont été enregistrées dans la comptabilité et se reflètent dans les états financiers annuels.
4. Nous vous avons communiqué tous les cas de fraude avérée ou suspectée dont nous avons connaissance : [à compléter].
5. Nous vous avons informés de tous les litiges et contentieux en cours ou probables : [à compléter].
6. Nous vous avons communiqué l'identité des parties liées et les transactions conclues avec elles : [à compléter].
7. Aucun événement postérieur à la clôture nécessitant un ajustement ou une mention en annexe ne doit être signalé, à l'exception de : [à compléter].
8. Nous considérons que les anomalies non corrigées listées ci-dessous ne sont pas significatives, individuellement et en cumul, pour les états financiers pris dans leur ensemble :
${nonCorriges.length ? nonCorriges.map((a) => `   - ${a.description} (incidence sur le résultat : ${euro(impactResultat(a))})`).join('\n') : '   - Aucune anomalie non corrigée.'}

Nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

${c.dirigeant}
[Fonction]`;
}

export function afficherAffirmation(zone, { dossier, donnees, modifie }) {
  if (donnees.texte == null) donnees.texte = modeleAffirmation(dossier);
  zone.innerHTML = `
    <div class="panneau">
      <div class="ligne espace"><p class="discret" style="margin:0">Déclarations écrites de la direction (ISA 580), signées à la date du rapport. Complétez les mentions entre crochets. La liste des anomalies non corrigées est reprise du tableau E1.</p>
        <span class="ligne"><span data-restant class="discret"></span><button type="button" data-modele>Revenir au modèle (met à jour la liste E1)</button></span></div>
      <textarea class="lettre" data-champ="texte" aria-label="Lettre d'affirmation"></textarea>
    </div>`;
  const maj = () => {
    const n = (donnees.texte.match(/\[[^\]]+\]/g) || []).length;
    zone.querySelector('[data-restant]').textContent = n ? `${n} mention(s) à compléter` : 'Lettre complétée';
  };
  lier(zone, donnees, modifie, maj);
  zone.querySelector('[data-modele]').addEventListener('click', () => {
    if (!confirm('Remplacer votre texte par le modèle ?')) return;
    donnees.texte = modeleAffirmation(dossier);
    zone.querySelector('[data-champ=texte]').value = donnees.texte;
    modifie(); maj();
  });
  maj();
}

// ------------------------------------------------------------------ G3
export function afficherSynthese(zone, { dossier, donnees, modifie }) {
  const cumul = cumulNonCorrige(dossier);
  const s = dossier.seuils || {};
  zone.innerHTML = `
    <div class="panneau">
      <p>Note de synthèse destinée à l'associé signataire : elle résume la mission et justifie l'opinion.</p>
      <div class="indicateurs">
        <div class="indicateur"><span>Seuil de signification</span><strong>${s.signification ? euro(s.signification) : '—'}</strong></div>
        <div class="indicateur"><span>Ajustements proposés</span><strong>${(dossier.ajustements || []).length}</strong></div>
        <div class="indicateur"><span>Non corrigés (net)</span><strong>${euro(cumul.net)}</strong></div>
        <div class="indicateur"><span>Non corrigés (absolu)</span><strong>${euro(cumul.absolu)}</strong></div>
      </div>
      ${zoneTexte('contexte', "Contexte de la mission et faits marquants de l'exercice", '', 3)}
      ${zoneTexte('risques', 'Risques identifiés et approche retenue', '', 3)}
      ${zoneTexte('travaux', 'Travaux réalisés et principales conclusions par cycle', '', 5)}
      ${zoneTexte('anomalies', 'Anomalies relevées, position de la direction, cumul comparé au seuil', '', 4)}
      ${zoneTexte('suspens', 'Points en suspens et limitations éventuelles', '', 3)}
      ${zoneTexte('conclusion', 'Conclusion et opinion proposée', '', 3)}
    </div>`;
  lier(zone, donnees, modifie);
}

// ------------------------------------------------------------------ G4
function rapport(dossier, opinion, fondement) {
  const c = dossier.client;
  const cloture = dateFr(dossier.exercice.cloture);
  const intro = `Rapport du commissaire aux comptes sur les états financiers annuels — exercice clos le ${cloture}

À l'assemblée générale de ${c.nom},

`;
  const ref = `En exécution de la mission qui nous a été confiée par votre assemblée générale, nous avons effectué l'audit des états financiers annuels de ${c.nom}, comprenant le bilan au ${cloture}, le compte de résultat, le tableau des flux de trésorerie et les notes annexes.`;
  const referentiel = "au regard des règles et méthodes comptables édictées par l'Acte uniforme OHADA relatif au droit comptable et à l'information financière (SYSCOHADA révisé)";
  const textes = {
    sans_reserve: `Opinion
${ref}
À notre avis, les états financiers annuels sont, ${referentiel}, réguliers et sincères et donnent une image fidèle du résultat des opérations de l'exercice écoulé ainsi que de la situation financière et du patrimoine de la société à la fin de cet exercice.

Fondement de l'opinion
Nous avons effectué notre audit selon les Normes internationales d'audit (ISA). Nous sommes indépendants de la société conformément au Code d'éthique de l'IESBA et aux règles d'indépendance de l'Acte uniforme. Nous estimons que les éléments que nous avons collectés sont suffisants et appropriés pour fonder notre opinion.`,
    reserve: `Opinion avec réserve
${ref}
À notre avis, sous la réserve décrite dans la partie « Fondement de l'opinion avec réserve », les états financiers annuels sont, ${referentiel}, réguliers et sincères et donnent une image fidèle du résultat des opérations de l'exercice écoulé ainsi que de la situation financière et du patrimoine de la société à la fin de cet exercice.

Fondement de l'opinion avec réserve
${fondement || '[Description du désaccord ou de la limitation et de son incidence chiffrée]'}`,
    defavorable: `Opinion défavorable
${ref}
En raison de l'importance du point décrit dans la partie « Fondement de l'opinion défavorable », nous sommes d'avis que les états financiers annuels ne sont pas, ${referentiel}, réguliers et sincères et ne donnent pas une image fidèle du résultat des opérations de l'exercice écoulé ainsi que de la situation financière et du patrimoine de la société à la fin de cet exercice.

Fondement de l'opinion défavorable
${fondement || '[Description des désaccords et de leur incidence généralisée]'}`,
    impossibilite: `Impossibilité d'exprimer une opinion
Nous avons été désignés en qualité de commissaire aux comptes afin d'effectuer l'audit des états financiers annuels de ${c.nom} relatifs à l'exercice clos le ${cloture}.
En raison de l'importance du point décrit dans la partie « Fondement de l'impossibilité d'exprimer une opinion », nous n'avons pas pu obtenir les éléments suffisants et appropriés pour fonder une opinion et nous n'exprimons donc pas d'opinion sur ces états financiers.

Fondement de l'impossibilité d'exprimer une opinion
${fondement || '[Description des limitations et de leur caractère généralisé]'}`,
  };
  return `${intro}${textes[opinion] || '[Choisissez une opinion]'}

Points clés de l'audit — Vérifications et informations spécifiques prévues par l'Acte uniforme — Responsabilités de la direction et du commissaire aux comptes
[Sections réglementaires du rapport]

${c.ville}, le [date]
Le commissaire aux comptes`;
}

export function afficherRapport(zone, { dossier, donnees, modifie }) {
  const cumul = cumulNonCorrige(dossier);
  const s = dossier.seuils || {};
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  zone.innerHTML = `
    <div class="panneau">
      <h2>Éléments pour fonder l'opinion (${N} 700 et 705)</h2>
      <div class="indicateurs">
        <div class="indicateur"><span>Seuil de signification</span><strong>${s.signification ? euro(s.signification) : '—'}</strong></div>
        <div class="indicateur"><span>Anomalies non corrigées (absolu)</span><strong>${euro(cumul.absolu)}</strong></div>
        <div class="indicateur"><span>Cumul / seuil</span><strong>${s.signification ? `${Math.round((cumul.absolu / s.signification) * 100)} %` : '—'}</strong></div>
        <div class="indicateur"><span>Ajustements sans position</span><strong>${cumul.enAttente}</strong></div>
      </div>
      ${cumul.enAttente ? '<p class="message attention">Des ajustements n\'ont pas été présentés à la direction (E1) : présentez-les avant de conclure.</p>' : ''}
      <label>Opinion</label>
      <div class="opinions">${Object.entries(OPINIONS).map(([k, v]) => `<label class="en-ligne puce"><input type="radio" name="opinion" data-champ="opinion" value="${k}"> ${v}</label>`).join('')}</div>
      ${zoneTexte('fondement', "Fondement de l'opinion (pour une réserve ou un refus : nature du désaccord ou de la limitation, montant, incidence)", '', 3)}
      ${zoneTexte('justification', "Justification de votre choix d'opinion", 'Caractère significatif, et le cas échéant généralisé, des anomalies non corrigées ou des limitations ; lien avec le seuil de signification.', 4)}
    </div>
    <div class="panneau"><h2>Projet de rapport</h2><pre class="lettre-pre" data-rapport></pre></div>`;
  const maj = () => { zone.querySelector('[data-rapport]').textContent = rapport(dossier, donnees.opinion, donnees.fondement); };
  lier(zone, donnees, modifie, maj);
  maj();
}

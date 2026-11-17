// Sections A (acceptation), B1 (fiche entreprise), B4 (matrice des risques) et C1 (seuils).
import { CYCLES, ASSERTIONS, NIVEAUX_RISQUE, REFERENTIELS, SECTEURS, TAILLES } from '../config.js';
import { lier, zoneTexte, champTexte, liste } from './formulaire.js';
import { echapper, euro, dateFr, lireNombre, variationPct, pctFr } from '../utils.js';

const normes = (dossier) => REFERENTIELS[dossier.parametres.referentiel].normes;
const fiche = (lignes) => `<dl class="fiche">${lignes.map(([dt, dd]) => `<dt>${dt}</dt><dd>${dd}</dd>`).join('')}</dl>`;

// ------------------------------------------------------------------ A1 : fiche client
export function afficherFicheClient(zone, { dossier, donnees, modifie }) {
  const c = dossier.client;
  const n = dossier.chiffres.N;
  zone.innerHTML = `
    <div class="panneau">
      <h2>Identité du client</h2>
      ${fiche([
        ['Dénomination', echapper(c.nom)], ['Forme juridique', echapper(c.formeJuridique)], ['NINEA (fictif)', echapper(c.siren)], ['Siège', echapper(c.ville)],
        ['Création', echapper(c.dateCreation)], ['Dirigeant', echapper(c.dirigeant)], ['Secteur', echapper(SECTEURS[dossier.parametres.secteur])],
        ['Taille', `${TAILLES[dossier.parametres.taille].libelle} — ${c.effectif} salariés`], ['Exercice audité', `du ${dateFr(dossier.exercice.debut)} au ${dateFr(dossier.exercice.cloture)}`],
        ["Chiffre d'affaires", euro(n.chiffreAffaires)], ['Total du bilan', euro(n.totalBilan)], ['Activité', echapper(c.activite)],
      ])}
    </div>
    <div class="panneau">
      <h2>Acceptation de la mission</h2>
      <p class="discret">À compléter avant d'accepter le mandat (${normes(dossier)} 210, Code d'éthique de l'IESBA et règles professionnelles de l'ONECCA).</p>
      <div class="grille">
        ${liste('origine', 'Origine de la mission', { '': '— Choisir —', nomination: 'Première nomination', renouvellement: 'Renouvellement du mandat', succession: "Succession d'un confrère" })}
        ${liste('risqueAcceptation', "Risque lié à l'acceptation", { '': '— Choisir —', faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé' })}
        ${liste('decision', 'Décision', { '': '— Choisir —', acceptee: 'Mission acceptée', sauvegarde: 'Acceptée avec mesures de sauvegarde', refusee: 'Mission refusée' })}
      </div>
      ${zoneTexte('actionnariat', 'Actionnariat, gouvernance et parties liées', 'Ce que vous savez ou devez obtenir : répartition du capital, organes de direction, sociétés liées.')}
      ${zoneTexte('integrite', "Intégrité de la direction et motifs d'attention", "Réputation, litiges, pression sur les résultats, changement fréquent d'auditeur…")}
      ${zoneTexte('competences', 'Compétences et moyens du cabinet', 'Connaissance du secteur, disponibilité de l\'équipe, recours éventuel à un expert.')}
      ${zoneTexte('justification', 'Justification de la décision')}
    </div>`;
  lier(zone, donnees, modifie);
}

// ------------------------------------------------------------------ A2 : indépendance
const QUESTIONS_INDEPENDANCE = [
  "Un membre de l'équipe ou du cabinet détient-il un intérêt financier (actions, prêt, garantie) dans l'entité ou une entité liée ?",
  "Existe-t-il des liens familiaux ou personnels étroits entre un membre de l'équipe et un dirigeant ou une personne occupant une fonction sensible ?",
  "Un membre de l'équipe a-t-il exercé une fonction de direction ou de salarié chez le client au cours des dernières années ?",
  "Le cabinet ou son réseau a-t-il fourni au client des prestations de tenue comptable, d'évaluation ou de conseil créant un risque d'auto-révision ?",
  "Le cabinet entretient-il des relations d'affaires avec le client en dehors de la mission (fournisseur, client, partenaire) ?",
  "Les honoraires de ce client représentent-ils une part significative du chiffre d'affaires du cabinet ?",
  "Des honoraires de l'exercice précédent sont-ils impayés à ce jour ?",
  "Les honoraires prévus sont-ils insuffisants au regard des diligences nécessaires ?",
  "Un membre de l'équipe a-t-il reçu des cadeaux ou avantages significatifs du client ?",
  "Le signataire dépasse-t-il la durée autorisée sur ce mandat (rotation) ?",
  "Existe-t-il un litige, actuel ou probable, entre le cabinet et le client ?",
];

export function afficherIndependance(zone, { dossier, donnees, modifie }) {
  zone.innerHTML = `
    <div class="panneau serre">
      <h2 class="titre-tableau">Questionnaire d'indépendance</h2>
      <div class="defilement"><table class="dense">
        <thead><tr><th>N°</th><th>Question</th><th>Réponse</th><th>Commentaire / mesure de sauvegarde</th></tr></thead>
        <tbody>${QUESTIONS_INDEPENDANCE.map((q, i) => `<tr><td>${i + 1}</td><td>${echapper(q)}</td>
          <td><select data-champ="r${i}" aria-label="Réponse à la question ${i + 1}"><option value="">—</option><option value="non">Non</option><option value="oui">Oui</option><option value="na">Sans objet</option></select></td>
          <td class="reponse"><input type="text" data-champ="c${i}" aria-label="Commentaire de la question ${i + 1}"></td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="panneau">
      <p data-bilan class="discret"></p>
      <div class="grille">${liste('conclusion', "Conclusion sur l'indépendance", { '': '— Choisir —', independant: 'Indépendance respectée', sauvegarde: 'Risques identifiés, mesures de sauvegarde suffisantes', incompatible: 'Situation incompatible : mission à refuser' })}</div>
      ${zoneTexte('justification', 'Justification', `Une réponse « Oui » appelle l'analyse du risque (intérêt personnel, auto-révision, familiarité, intimidation) et la mesure de sauvegarde retenue.`)}
    </div>`;
  const bilan = () => {
    const reponses = QUESTIONS_INDEPENDANCE.map((_, i) => donnees['r' + i] || '');
    const oui = reponses.filter((r) => r === 'oui').length;
    zone.querySelector('[data-bilan]').textContent = `${reponses.filter(Boolean).length} / ${QUESTIONS_INDEPENDANCE.length} questions traitées — ${oui} réponse(s) « Oui » à analyser.`;
  };
  lier(zone, donnees, modifie, bilan);
  bilan();
}

// ------------------------------------------------------------------ A3 : lettre de mission
function modeleLettre(dossier) {
  const c = dossier.client;
  const N = normes(dossier);
  const an = dossier.exercice.cloture.slice(0, 4);
  return `[Nom du cabinet]
[Adresse]

${c.nom}
À l'attention de ${c.dirigeant}
${c.ville}

Le [date]

Objet : lettre de mission — certification des états financiers annuels de l'exercice clos le ${dateFr(dossier.exercice.cloture)}

Madame, Monsieur,

En notre qualité de commissaire aux comptes de ${c.nom} (${c.formeJuridique}), nous vous confirmons par la présente les termes et conditions de notre intervention au titre de l'exercice ${an}, conformément à la norme ${N} 210.

1. Nature et étendue de la mission
Notre mission, prévue par l'Acte uniforme OHADA relatif au droit des sociétés commerciales et du groupement d'intérêt économique, consiste à certifier que les états financiers annuels sont réguliers et sincères et donnent une image fidèle du résultat des opérations de l'exercice ainsi que de la situation financière et du patrimoine de l'entité, au regard du SYSCOHADA révisé. Elle comprend également les vérifications spécifiques prévues par l'Acte uniforme.
Notre audit sera conduit selon les Normes internationales d'audit (ISA). Il est planifié et réalisé en vue d'obtenir l'assurance raisonnable que les comptes ne comportent pas d'anomalies significatives. Il ne vise pas à détecter toutes les erreurs ou fraudes.

2. Responsabilités de la direction
L'établissement des comptes, la mise en place du contrôle interne et la prévention des fraudes relèvent de la direction. Celle-ci nous donnera accès à tous les documents et personnes utiles et nous remettra, en fin de mission, une lettre d'affirmation.

3. Organisation de l'intervention
Équipe : [signataire, chef de mission, collaborateurs]
Calendrier : [intérim : dates] — [inventaire physique : date] — [contrôle des comptes : dates] — [émission du rapport : date]
Documents à nous remettre : journal général et grand livre, balance, états de rapprochement bancaire, états d'inventaire, [à compléter].

4. Confirmations de tiers
Nous procéderons à des demandes de confirmation directe auprès de [banques, clients, fournisseurs, avocats].

5. Honoraires
Budget : [nombre] heures au taux moyen de [taux] FCFA HT, soit [montant] FCFA HT, hors frais de déplacement. Facturation : [modalités].

6. Particularités de l'exercice
[Points d'attention identifiés lors de la prise de connaissance]

Nous vous remercions de nous retourner un exemplaire de cette lettre revêtu de votre accord.

Le commissaire aux comptes                                Pour ${c.nom}
[Signataire]                                               ${c.dirigeant}`;
}

export function afficherLettreMission(zone, { dossier, donnees, modifie }) {
  if (donnees.texte == null) donnees.texte = modeleLettre(dossier);
  zone.innerHTML = `
    <div class="panneau">
      <h2>Budget de la mission</h2>
      <div class="grille">
        ${champTexte('heures', "Nombre d'heures prévues", 'inputmode="decimal"')}
        ${champTexte('taux', 'Taux horaire moyen (FCFA HT)', 'inputmode="decimal"')}
        <div><label>Honoraires prévus</label><p><strong data-honoraires>—</strong></p></div>
      </div>
      <p class="discret">Repère : le budget dépend de la taille de l'entité (total du bilan ${euro(dossier.chiffres.N.totalBilan)}, chiffre d'affaires ${euro(dossier.chiffres.N.chiffreAffaires)}), de son risque et des honoraires usuels de la place.</p>
    </div>
    <div class="panneau">
      <div class="ligne espace"><h2>Lettre de mission</h2><span class="ligne"><span data-restant class="discret"></span><button type="button" data-reinitialiser>Revenir au modèle</button><button type="button" data-imprimer>Imprimer</button></span></div>
      <p class="discret">Lettre préremplie avec les données du client. Complétez toutes les mentions entre crochets.</p>
      <textarea class="lettre" data-champ="texte" aria-label="Texte de la lettre de mission"></textarea>
    </div>`;
  const maj = () => {
    const h = lireNombre(donnees.heures); const t = lireNombre(donnees.taux);
    zone.querySelector('[data-honoraires]').textContent = h && t ? euro(h * t) + ' HT' : '—';
    const restants = (donnees.texte.match(/\[[^\]]+\]/g) || []).length;
    zone.querySelector('[data-restant]').textContent = restants ? `${restants} mention(s) entre crochets à compléter` : 'Toutes les mentions sont complétées';
  };
  lier(zone, donnees, modifie, maj);
  zone.querySelector('[data-reinitialiser]').addEventListener('click', () => {
    if (!confirm('Remplacer votre texte par le modèle de lettre ?')) return;
    donnees.texte = modeleLettre(dossier);
    zone.querySelector('[data-champ=texte]').value = donnees.texte;
    modifie(); maj();
  });
  zone.querySelector('[data-imprimer]').addEventListener('click', () => {
    const fenetre = window.open('', '_blank');
    if (!fenetre) { alert("Autorisez les fenêtres surgissantes pour imprimer la lettre."); return; }
    fenetre.document.write(`<title>Lettre de mission</title><pre style="white-space:pre-wrap;font:12pt/1.5 Georgia,serif;margin:2cm">${echapper(donnees.texte)}</pre>`);
    fenetre.document.close();
    fenetre.print();
  });
  maj();
}

// ------------------------------------------------------------------ B1 : fiche entreprise
export function afficherFicheEntreprise(zone, { dossier, donnees, modifie }) {
  const c = dossier.client;
  const a = dossier.scenario.activite;
  zone.innerHTML = `
    <div class="panneau">
      <h2>Informations recueillies auprès du client</h2>
      <p><strong>Activité.</strong> ${echapper(c.activite)}</p>
      <p><strong>Organisation.</strong> ${echapper(c.organisation)}</p>
      <p><strong>Système d'information.</strong> ${echapper(c.systemeInformation)}</p>
      <p><strong>Contexte de l'exercice.</strong> ${echapper(c.contexteMission)}</p>
      ${c.faitsMarquants?.length ? `<p><strong>Faits marquants.</strong></p><ul>${c.faitsMarquants.map((f) => `<li>${echapper(f)}</li>`).join('')}</ul>` : ''}
      ${fiche([
        ['Effectif', `${c.effectif} salariés`], ['Clients actifs', String(dossier.tiers.clients.length)], ['Fournisseurs actifs', String(dossier.tiers.fournisseurs.length)],
        ['Évolution du chiffre d\'affaires', pctFr(variationPct(dossier.chiffres.N.chiffreAffaires, dossier.chiffres['N-1'].chiffreAffaires))],
        ['Utilisateurs de la comptabilité', [...new Set(Object.values(dossier.utilisateurs))].map(echapper).join(', ')],
        ['Double signature des paiements', `à partir de ${euro(dossier.seuilAutorisation)}`],
        ['Volume du journal', `${dossier.chiffres.N.nbEcritures.toLocaleString('fr-FR')} écritures en N`], ['Croissance annoncée', pctFr(a.croissancePct)],
      ])}
    </div>
    <div class="panneau">
      <h2>Votre analyse (${normes(dossier)} 315)</h2>
      ${zoneTexte('activite', "Compréhension de l'activité et du modèle économique", 'Sources de revenus, clients et fournisseurs clés, saisonnalité, dépendances.')}
      ${zoneTexte('environnement', 'Secteur et environnement', 'Concurrence, réglementation, conjoncture, particularités comptables du secteur.')}
      ${zoneTexte('organisation', 'Organisation, contrôle interne et système d\'information', 'Séparation des fonctions, supervision, interfaces et ressaisies.')}
      ${zoneTexte('risques', "Facteurs de risque identifiés et incidence sur l'approche d'audit", 'Reliez chaque facteur à un cycle et à une assertion : ils alimentent la matrice des risques (B4).', 6)}
    </div>`;
  lier(zone, donnees, modifie);
}

// ------------------------------------------------------------------ B4 : matrice des risques
export function afficherMatriceRisques(zone, { dossier, donnees, modifie }) {
  const N = normes(dossier);
  zone.innerHTML = `
    <div class="panneau">
      <p class="discret">Évaluez le risque d'anomalies significatives pour chaque cycle et chaque assertion (${N} 315), puis décrivez la réponse d'audit prévue (${N} 330).
      Laissez « — » quand l'assertion ne présente pas de risque particulier.</p>
    </div>
    <div class="panneau serre"><div class="defilement"><table class="dense matrice">
      <thead><tr><th>Cycle</th>${ASSERTIONS.map((a) => `<th>${a}</th>`).join('')}<th>Réponse d'audit prévue</th></tr></thead>
      <tbody>${Object.entries(CYCLES).map(([id, libelle]) => `<tr><td><strong>${echapper(libelle)}</strong></td>
        ${ASSERTIONS.map((a, i) => `<td data-cellule="${id}_${i}"><select data-champ="${id}_${i}" aria-label="${echapper(libelle)} — ${a}">${Object.entries(NIVEAUX_RISQUE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></td>`).join('')}
        <td class="reponse"><textarea rows="2" data-champ="${id}_reponse" aria-label="Réponse d'audit — ${echapper(libelle)}"></textarea></td></tr>`).join('')}</tbody>
    </table></div></div>
    <div class="panneau">
      <p data-bilan class="discret"></p>
      ${zoneTexte('significatifs', 'Risques significatifs retenus', "Risques qui appellent une démarche d'audit particulière. Le risque de fraude dans la comptabilisation des produits est présumé, sauf justification contraire.")}
      ${zoneTexte('fraude', `Risque de fraude (${N} 240)`, "Facteurs de pression, d'opportunité et de justification ; risque de contournement des contrôles par la direction ; tests prévus sur les écritures comptables.")}
      ${zoneTexte('strategie', "Stratégie d'audit", "Approche par les contrôles ou approche substantive, recours à la circularisation, à l'inventaire physique, calendrier.")}
    </div>`;
  const colorer = () => {
    let eleves = 0; let evalues = 0;
    zone.querySelectorAll('[data-cellule]').forEach((td) => {
      const v = donnees[td.dataset.cellule] || '';
      td.className = v ? `risque-${v}` : '';
      if (v) evalues++;
      if (v === 'eleve') eleves++;
    });
    zone.querySelector('[data-bilan]').textContent = `${evalues} assertion(s) évaluée(s), dont ${eleves} en risque élevé.`;
  };
  lier(zone, donnees, modifie, colorer);
  colorer();
}

// ------------------------------------------------------------------ C1 : seuils
const BASES = { ca: "Chiffre d'affaires", produits: "Produits d'exploitation", resultat: "Résultat d'exploitation", resultatNet: 'Résultat net', bilan: 'Total du bilan', capitaux: 'Capitaux propres', autre: 'Autre base' };
const CLES_BASE = { ca: 'chiffreAffaires', produits: 'produitsExploitation', resultat: 'resultatExploitation', resultatNet: 'resultatNet', bilan: 'totalBilan', capitaux: 'capitauxPropres' };

export function afficherSeuils(zone, { dossier, donnees, modifie }) {
  const n = dossier.chiffres.N;
  const n1 = dossier.chiffres['N-1'];
  const N = normes(dossier);
  zone.innerHTML = `
    <div class="panneau serre">
      <h2 class="titre-tableau">Bases de référence possibles (calculées à partir du journal)</h2>
      <div class="defilement"><table class="dense">
        <thead><tr><th>Agrégat</th><th class="nombre">N</th><th class="nombre">N-1</th><th class="nombre">Variation</th></tr></thead>
        <tbody>${Object.entries(CLES_BASE).map(([k, cle]) => `<tr><td>${BASES[k]}</td><td class="nombre">${euro(n[cle])}</td><td class="nombre">${euro(n1[cle])}</td><td class="nombre">${pctFr(variationPct(n[cle], n1[cle]))}</td></tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="panneau">
      <h2>Vos seuils (${N} 320)</h2>
      <div class="grille">
        ${liste('base', 'Base de référence retenue', { '': '— Choisir —', ...BASES })}
        ${champTexte('taux', 'Taux appliqué (%)', 'inputmode="decimal" placeholder="ex. 1"')}
        ${champTexte('signification', 'Seuil de signification (FCFA)', 'inputmode="decimal"')}
        ${champTexte('planification', 'Seuil de planification (FCFA)', 'inputmode="decimal"')}
        ${champTexte('insignifiant', 'Seuil des anomalies manifestement insignifiantes (FCFA)', 'inputmode="decimal"')}
      </div>
      <p class="message info" data-aide hidden></p>
      ${zoneTexte('justification', 'Justification', "Pourquoi cette base (stabilité, attentes des utilisateurs des comptes), pourquoi ce taux, et comment vous fixez le seuil de planification et le seuil des anomalies manifestement insignifiantes au regard du risque du dossier.", 6)}
      ${zoneTexte('specifiques', 'Seuils spécifiques éventuels', 'Flux, soldes ou informations pour lesquels un montant inférieur pourrait influencer les utilisateurs (rémunération des dirigeants, parties liées…).', 3)}
    </div>`;
  const aide = () => {
    const base = n[CLES_BASE[donnees.base]];
    const taux = lireNombre(donnees.taux);
    const s = lireNombre(donnees.signification);
    const morceaux = [];
    if (base && taux) morceaux.push(`${BASES[donnees.base]} × ${String(taux).replace('.', ',')} % = ${euro((base * taux) / 100)}`);
    if (s && lireNombre(donnees.planification)) morceaux.push(`seuil de planification = ${Math.round((lireNombre(donnees.planification) / s) * 100)} % du seuil de signification`);
    if (s && lireNombre(donnees.insignifiant)) morceaux.push(`anomalies insignifiantes = ${String(Math.round((lireNombre(donnees.insignifiant) / s) * 1000) / 10).replace('.', ',')} % du seuil de signification`);
    const p = zone.querySelector('[data-aide]');
    p.hidden = !morceaux.length;
    p.textContent = 'Aide au calcul : ' + morceaux.join(' · ');
    // Les seuils servent aux autres sections (revue analytique, ajustements).
    dossier.seuils = { signification: s, planification: lireNombre(donnees.planification), insignifiant: lireNombre(donnees.insignifiant) };
  };
  lier(zone, donnees, modifie, aide);
  aide();
}

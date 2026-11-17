// B3 — Revue analytique N / N-1 : calculée automatiquement, commentée par l'auditeur.
import { REFERENTIELS } from '../config.js';
import { revueAnalytique } from '../moteur/analytique.js';
import { lireFec } from './donnees.js';
import { lier, zoneTexte } from './formulaire.js';
import { echapper, euro, montantOuVide, pctFr } from '../utils.js';

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const nombre = (n) => montantOuVide(n) || '0';
const ratio = (v, unite) => (v == null ? '—' : unite === '%' ? `${(v * 100).toFixed(1).replace('.', ',')} %` : `${Math.round(v)} j`);

export async function afficherRevueAnalytique(zone, { dossier, donnees, modifie }) {
  const [n, n1] = await Promise.all([lireFec(dossier, 'N'), lireFec(dossier, 'N-1')]);
  const planification = dossier.seuils?.planification || 0;
  const seuil = planification || Math.round(dossier.chiffres.N.produitsExploitation * 0.01);
  const r = revueAnalytique(n, n1, seuil);
  const commentaire = (id, significatif) => `<td class="reponse"><textarea rows="1" data-champ="${id}" aria-label="Commentaire" placeholder="${significatif ? 'Variation à expliquer' : ''}"></textarea></td>`;
  const drapeau = (s) => (s ? '<span class="pastille orange">À expliquer</span>' : '');
  const natures = [...new Set(r.postes.map((p) => p.nature))];
  zone.innerHTML = `
    <div class="panneau">
      <p>Revue analytique calculée à partir des journaux N et N-1 (${REFERENTIELS[dossier.parametres.referentiel].normes} 315 et 520). Les lignes surlignées sont les variations significatives :
      plus de <strong>${euro(seuil)}</strong> et plus de 10 % pour un poste, plus de 10 % en valeur relative pour un ratio.</p>
      <p class="discret">${planification ? 'Seuil utilisé : votre seuil de planification (C1).' : "Seuil provisoire de 1 % des produits d'exploitation : il sera remplacé par votre seuil de planification dès que vous l'aurez fixé en C1."}
      Commentez chaque variation significative : explication attendue, cohérence avec votre connaissance de l'entité, risque à reporter dans la matrice (B4).</p>
      <p data-bilan class="discret"></p>
    </div>
    ${natures.map((nature) => `
      <div class="panneau serre"><h2 class="titre-tableau">${nature === 'Résultat' ? 'Compte de résultat' : 'Bilan — ' + nature.toLowerCase()}</h2><div class="defilement"><table class="dense">
        <thead><tr><th>Poste</th><th class="nombre">N</th><th class="nombre">N-1</th><th class="nombre">Variation</th><th class="nombre">%</th><th></th><th>Votre commentaire</th></tr></thead>
        <tbody>${r.postes.filter((p) => p.nature === nature).map((p) => `<tr class="${p.significatif ? 'significatif' : ''}"><td>${echapper(p.libelle)}</td><td class="nombre">${nombre(p.n)}</td><td class="nombre">${nombre(p.n1)}</td>
          <td class="nombre">${nombre(p.variation)}</td><td class="nombre">${pctFr(p.pct)}</td><td>${drapeau(p.significatif)}</td>${commentaire(p.id, p.significatif)}</tr>`).join('')}</tbody>
      </table></div></div>`).join('')}
    <div class="panneau serre"><h2 class="titre-tableau">Ratios</h2><div class="defilement"><table class="dense">
      <thead><tr><th>Ratio</th><th class="nombre">N</th><th class="nombre">N-1</th><th></th><th>Votre commentaire</th></tr></thead>
      <tbody>${r.ratios.map((x) => `<tr class="${x.significatif ? 'significatif' : ''}"><td>${echapper(x.libelle)}</td><td class="nombre">${ratio(x.n, x.unite)}</td><td class="nombre">${ratio(x.n1, x.unite)}</td><td>${drapeau(x.significatif)}</td>${commentaire(x.id, x.significatif)}</tr>`).join('')}</tbody>
    </table></div></div>
    <div class="panneau serre"><h2 class="titre-tableau">Évolution mensuelle</h2><div class="defilement"><table class="dense">
      <thead><tr><th>Mois</th><th class="nombre">CA N</th><th class="nombre">CA N-1</th><th class="nombre">%</th><th class="nombre">Charges sociales / salaires N</th><th class="nombre">N-1</th><th></th><th>Votre commentaire</th></tr></thead>
      <tbody>${r.mensuel.map((m) => `<tr class="${m.significatif ? 'significatif' : ''}"><td>${MOIS[m.mois - 1]}</td><td class="nombre">${nombre(m.caN)}</td><td class="nombre">${nombre(m.caN1)}</td>
        <td class="nombre">${pctFr(m.caN1 ? ((m.caN - m.caN1) / Math.abs(m.caN1)) * 100 : null)}</td><td class="nombre">${ratio(m.tauxSocialN, '%')}</td><td class="nombre">${ratio(m.tauxSocialN1, '%')}</td>
        <td>${drapeau(m.significatif)}</td>${commentaire('mois_' + m.mois, m.significatif)}</tr>`).join('')}</tbody>
    </table></div></div>
    <div class="panneau">${zoneTexte('conclusion', 'Conclusion de la revue analytique', "Zones de risque identifiées, cohérence d'ensemble, travaux complémentaires à prévoir dans les programmes de travail.", 5)}</div>`;
  const ids = [...r.postes, ...r.ratios, ...r.mensuel.map((m) => ({ id: 'mois_' + m.mois, significatif: m.significatif }))].filter((x) => x.significatif).map((x) => x.id);
  const bilan = () => {
    const faits = ids.filter((id) => (donnees[id] || '').trim()).length;
    zone.querySelector('[data-bilan]').textContent = `${faits} variation(s) significative(s) commentée(s) sur ${ids.length}.`;
  };
  lier(zone, donnees, modifie, bilan);
  bilan();
}

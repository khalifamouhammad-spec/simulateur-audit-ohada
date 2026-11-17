// Historique des missions clôturées et points faibles par cycle et par type d'anomalie.
import { CYCLES, SECTEURS, TAILLES, NIVEAUX } from '../config.js';
import { db } from '../db.js';
import { dureeFr } from '../dossiers.js';
import { SECTIONS } from '../correction.js';
import { BIBLIOTHEQUE } from '../moteur/anomalies.js';
import { echapper, dateFr } from '../utils.js';

const fr = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const classe = (n) => (n >= 14 ? 'vert' : n >= 10 ? 'orange' : 'rouge');

export async function afficherHistorique(vue) {
  const faites = (await db.tout('dossiers')).filter((d) => d.statut === 'cloturee' && d.correction).sort((a, b) => b.correction.date.localeCompare(a.correction.date));
  if (!faites.length) {
    vue.innerHTML = '<main class="page"><h1>Historique</h1><div class="panneau"><p class="discret">Aucune mission clôturée pour l\'instant. Clôturez une mission depuis la section H de son dossier pour voir apparaître ici votre note et vos points faibles.</p><a class="bouton" href="#/">Tableau de bord</a></div></main>';
    return;
  }
  const moyenne = (f) => faites.reduce((s, d) => s + f(d), 0) / faites.length;
  const avec = (k) => faites.filter((d) => d.correction.sections[k]);
  const moyenneSection = (k) => avec(k).reduce((s, d) => s + d.correction.sections[k].note, 0) / (avec(k).length || 1);
  // Points faibles par cycle (anomalies du périmètre noté)
  const parCycle = {};
  for (const d of faites) for (const [c, v] of Object.entries(d.correction.resume.parCycle || {})) {
    parCycle[c] ??= { total: 0, trouvees: 0 };
    parCycle[c].total += v.total; parCycle[c].trouvees += v.trouvees;
  }
  // Types d'anomalies le plus souvent ratés
  const rates = {};
  for (const d of faites) for (const t of d.correction.resume.typesRates || []) rates[t] = (rates[t] || 0) + 1;
  const sectionsFaibles = Object.keys(SECTIONS).filter((k) => avec(k).length).sort((a, b) => moyenneSection(a) - moyenneSection(b));

  vue.innerHTML = `
    <main class="page">
      <h1>Historique</h1>
      <p class="discret">Missions clôturées et repérage de vos points faibles.</p>
      <div class="indicateurs">
        <div class="indicateur"><span>Missions clôturées</span><strong>${faites.length}</strong></div>
        <div class="indicateur"><span>Note globale moyenne</span><strong>${fr(moyenne((d) => d.correction.globale))} / 20</strong></div>
        <div class="indicateur"><span>Dernière note</span><strong>${fr(faites[0].correction.globale)} / 20</strong></div>
        <div class="indicateur"><span>Temps moyen par mission</span><strong>${dureeFr(moyenne((d) => d.tempsSecondes))}</strong></div>
      </div>
      <div class="deux-colonnes egales">
        <div class="panneau serre"><h2 class="titre-tableau">Moyenne par section</h2><table class="dense"><tbody>
          ${sectionsFaibles.map((k) => { const m = moyenneSection(k); return `<tr><td>${SECTIONS[k]}</td><td class="nombre"><span class="pastille ${classe(m)}">${fr(m)} / 20</span></td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="panneau serre"><h2 class="titre-tableau">Détection par cycle</h2><table class="dense"><thead><tr><th>Cycle</th><th class="nombre">Trouvées</th><th class="nombre">Taux</th></tr></thead><tbody>
          ${Object.entries(parCycle).sort((a, b) => a[1].trouvees / a[1].total - b[1].trouvees / b[1].total).map(([c, v]) => { const taux = Math.round((v.trouvees / v.total) * 100); return `<tr><td>${echapper(CYCLES[c])}</td><td class="nombre">${v.trouvees} / ${v.total}</td><td class="nombre"><span class="pastille ${taux >= 70 ? 'vert' : taux >= 40 ? 'orange' : 'rouge'}">${taux} %</span></td></tr>`; }).join('') || '<tr><td colspan="3" class="vide">—</td></tr>'}
        </tbody></table></div>
      </div>
      <div class="panneau serre"><h2 class="titre-tableau">Anomalies le plus souvent ratées</h2><table class="dense"><thead><tr><th>Type d'anomalie</th><th>Cycle</th><th class="nombre">Ratée</th><th>Procédure à travailler</th></tr></thead><tbody>
        ${Object.entries(rates).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<tr><td>${echapper(BIBLIOTHEQUE[t]?.libelle || t)}</td><td>${echapper(CYCLES[BIBLIOTHEQUE[t]?.cycle] || '')}</td><td class="nombre">${n} fois</td><td class="discret">${echapper(BIBLIOTHEQUE[t]?.procedure || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucune anomalie ratée dans le périmètre noté. Bravo.</td></tr>'}
      </tbody></table></div>
      <div class="panneau serre"><h2 class="titre-tableau">Missions réalisées</h2><div class="defilement"><table class="dense">
        <thead><tr><th>Clôturée le</th><th>Client</th><th>Secteur</th><th>Taille</th><th>Difficulté</th>${Object.keys(SECTIONS).map((k) => `<th class="nombre">${{ detection: 'Détection', travaux: 'Travaux', planification: 'Planif.', seuils: 'Seuils', finalisation: 'Finalis.' }[k]}</th>`).join('')}<th class="nombre">Globale</th><th>Anomalies ratées</th><th class="nombre">Temps</th></tr></thead>
        <tbody>${faites.map((d) => `<tr>
          <td>${dateFr(d.correction.date.slice(0, 10))}</td><td><a href="#/dossier/${d.id}/H1">${echapper(d.client.nom)}</a></td><td>${echapper(SECTEURS[d.parametres.secteur])}</td><td>${TAILLES[d.parametres.taille].libelle}</td><td>${NIVEAUX[d.parametres.difficulte].libelle}</td>
          ${Object.keys(SECTIONS).map((k) => `<td class="nombre">${d.correction.sections[k] ? fr(d.correction.sections[k].note) : '—'}</td>`).join('')}
          <td class="nombre"><span class="pastille ${classe(d.correction.globale)}">${fr(d.correction.globale)}</span></td>
          <td>${(d.correction.resume.typesRates || []).map((t) => `<span class="pastille rouge">${echapper(BIBLIOTHEQUE[t]?.libelle || t)}</span>`).join(' ') || '<span class="pastille vert">Aucune</span>'}${d.correction.resume.faussesAlertes ? ` <span class="pastille orange">${d.correction.resume.faussesAlertes} fausse(s) alerte(s)</span>` : ''}</td>
          <td class="nombre">${dureeFr(d.tempsSecondes)}</td></tr>`).join('')}</tbody>
      </table></div></div>
    </main>`;
}

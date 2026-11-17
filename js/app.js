// Point d'entrée : routage par ancre.
//   #/                         tableau de bord
//   #/parametres               paramètres
//   #/historique               historique des missions clôturées
//   #/dossier/<id>/<code>      dossier ouvert sur un élément de l'arborescence
import { afficherTableauDeBord } from './ui/tableau-de-bord.js';
import { afficherParametres } from './ui/parametres.js';
import { afficherDossier } from './ui/dossier.js';
import { afficherHistorique } from './ui/historique.js';
import { echapper } from './utils.js';

let fermerVue = null; // fonction de nettoyage de la vue courante (minuteur du dossier)

async function router() {
  const [nom, ...args] = location.hash.replace(/^#\/?/, '').split('/');
  const route = ['dossier', 'parametres', 'historique'].includes(nom) ? nom : 'tableau';
  if (fermerVue) { await fermerVue(); fermerVue = null; }
  // Un conteneur neuf à chaque navigation évite d'empiler les écouteurs d'événements.
  const vue = document.createElement('div');
  vue.id = 'vue';
  document.getElementById('vue').replaceWith(vue);
  document.querySelectorAll('.barre-app nav a').forEach((a) => a.classList.toggle('actif', a.dataset.route === (route === 'dossier' ? 'tableau' : route)));
  try {
    if (route === 'dossier') fermerVue = await afficherDossier(vue, args[0], args[1]);
    else if (route === 'parametres') await afficherParametres(vue);
    else if (route === 'historique') await afficherHistorique(vue);
    else await afficherTableauDeBord(vue);
    window.logicielDemarre = true;
  } catch (e) {
    window.logicielDemarre = true;
    vue.innerHTML = `<main class="page"><p class="message erreur">${echapper(e.message)}</p></main>`;
  }
}

window.addEventListener('hashchange', router);
router();

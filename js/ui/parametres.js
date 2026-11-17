// Paramètres : clé Groq (stockée uniquement dans ce navigateur), modèle, référentiel.
import { REFERENTIELS, MODELE_GROQ_DEFAUT, VERSION_APP } from '../config.js';
import { listerModeles } from '../groq.js';
import { lireParametres, ecrireParametres } from '../db.js';
import { echapper } from '../utils.js';

export async function afficherParametres(vue) {
  const p = await lireParametres();
  vue.innerHTML = `
    <main class="page etroite">
      <h1>Paramètres</h1>
      <div class="panneau">
        <h2>IA — API Groq</h2>
        <p class="discret">Créez une clé gratuite sur <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> puis collez-la ici.
        Elle est enregistrée uniquement dans ce navigateur (IndexedDB) et n'est envoyée qu'à l'API Groq. Elle n'est jamais écrite dans le code ni dans le dépôt.</p>
        <label for="p-cle">Clé API Groq</label>
        <input type="password" id="p-cle" autocomplete="off" placeholder="gsk_…" value="${echapper(p.cleGroq)}">
        <label for="p-modele">Modèle</label>
        <input type="text" id="p-modele" list="p-modeles" value="${echapper(p.modele)}">
        <datalist id="p-modeles"><option value="${MODELE_GROQ_DEFAUT}"></datalist>
        <p class="discret">Modèle par défaut : ${MODELE_GROQ_DEFAUT}. « Tester la connexion » charge la liste des modèles disponibles avec votre clé.</p>
        <div class="ligne"><button class="principal" data-enregistrer>Enregistrer</button><button data-tester>Tester la connexion</button><button class="danger" data-effacer>Effacer la clé</button></div>
        <div data-etat></div>
      </div>
      <div class="panneau">
        <h2>Référentiel</h2>
        <label for="p-ref">Plan comptable et normes d'audit</label>
        <select id="p-ref">${Object.values(REFERENTIELS).map((r) => `<option value="${r.id}" ${r.disponible ? '' : 'disabled'} ${p.referentiel === r.id ? 'selected' : ''}>${echapper(r.libelle)}</option>`).join('')}</select>
        <p class="discret">Cette application applique le SYSCOHADA révisé, les normes ISA et la fiscalité sénégalaise. Pour le PCG et les normes NEP, utilisez la version française.</p>
      </div>
      <p class="discret">Version ${VERSION_APP}. Version française (PCG / NEP) : <a href="../simulateur-audit/">ouvrir le simulateur d'audit PCG</a>.</p>
    </main>`;

  const etat = vue.querySelector('[data-etat]');
  const message = (classe, texte) => { etat.innerHTML = `<p class="message ${classe}">${echapper(texte)}</p>`; };
  const formulaire = () => ({
    cleGroq: vue.querySelector('#p-cle').value.trim(),
    modele: vue.querySelector('#p-modele').value.trim() || MODELE_GROQ_DEFAUT,
    referentiel: vue.querySelector('#p-ref').value,
  });
  const enregistrer = async () => {
    try { await ecrireParametres(formulaire()); message('succes', 'Paramètres enregistrés dans ce navigateur.'); }
    catch (e) { message('erreur', e.message); }
  };
  vue.querySelector('[data-enregistrer]').addEventListener('click', enregistrer);
  vue.querySelector('#p-ref').addEventListener('change', enregistrer);
  vue.querySelector('[data-effacer]').addEventListener('click', () => { vue.querySelector('#p-cle').value = ''; enregistrer(); });
  vue.querySelector('[data-tester]').addEventListener('click', async () => {
    message('info', 'Test en cours…');
    try {
      const modeles = await listerModeles(formulaire().cleGroq);
      vue.querySelector('#p-modeles').innerHTML = modeles.map((m) => `<option value="${echapper(m)}">`).join('');
      await ecrireParametres(formulaire());
      const connu = modeles.includes(formulaire().modele);
      message(connu ? 'succes' : 'attention', connu
        ? `Connexion réussie : ${modeles.length} modèles disponibles. Clé enregistrée.`
        : `Connexion réussie, mais le modèle « ${formulaire().modele} » n'est pas dans la liste : choisissez-en un autre dans le champ Modèle.`);
    } catch (e) {
      message('erreur', e.message);
    }
  });
}

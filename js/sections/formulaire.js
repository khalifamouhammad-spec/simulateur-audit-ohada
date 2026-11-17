// Liaison générique entre des champs de saisie et un objet de données.
// Chaque champ porte data-champ="cle" ; la valeur est lue et écrite dans donnees[cle].
import { echapper } from '../utils.js';

export function lier(racine, donnees, modifie, apres) {
  racine.querySelectorAll('[data-champ]').forEach((champ) => {
    const cle = champ.dataset.champ;
    if (champ.type === 'radio') champ.checked = donnees[cle] === champ.value;
    else if (champ.type === 'checkbox') champ.checked = !!donnees[cle];
    else if (donnees[cle] != null) champ.value = donnees[cle];
    champ.addEventListener(champ.tagName === 'SELECT' || champ.type === 'radio' || champ.type === 'checkbox' ? 'change' : 'input', () => {
      if (champ.type === 'radio') { if (champ.checked) donnees[cle] = champ.value; }
      else donnees[cle] = champ.type === 'checkbox' ? champ.checked : champ.value;
      modifie();
      apres?.(cle);
    });
  });
}

export const zoneTexte = (cle, libelle, aide = '', lignes = 4) => `
  <label for="c-${cle}">${libelle}</label>
  ${aide ? `<p class="discret">${aide}</p>` : ''}
  <textarea id="c-${cle}" data-champ="${cle}" rows="${lignes}"></textarea>`;

export const champTexte = (cle, libelle, attributs = '') => `<div><label for="c-${cle}">${libelle}</label><input type="text" id="c-${cle}" data-champ="${cle}" ${attributs}></div>`;

export const liste = (cle, libelle, options) => `<div><label for="c-${cle}">${libelle}</label><select id="c-${cle}" data-champ="${cle}">${Object.entries(options).map(([k, v]) => `<option value="${k}">${echapper(v)}</option>`).join('')}</select></div>`;

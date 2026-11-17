// Échantillonnage d'une population de lignes : aléatoire, proportionnel au montant
// (sondage par unités monétaires) ou sélection des montants les plus élevés.
import { aleatoire } from '../utils.js';

export const METHODES = {
  aleatoire: 'Aléatoire simple',
  montant: 'Proportionnel au montant (unités monétaires)',
  eleves: 'Montants les plus élevés',
};

/** valeur(ligne) : montant en valeur absolue. Renvoie les lignes retenues, sans doublon. */
export function echantillonner(lignes, methode, taille, valeur, graine = Date.now()) {
  const n = Math.max(0, Math.min(Math.floor(taille) || 0, lignes.length));
  if (!n) return [];
  const rnd = aleatoire(graine >>> 0);
  if (methode === 'eleves') return [...lignes].sort((a, b) => valeur(b) - valeur(a)).slice(0, n);
  if (methode === 'aleatoire') return rnd.melanger(lignes).slice(0, n);
  // Unités monétaires : tirage systématique avec départ aléatoire sur le cumul des montants.
  const total = lignes.reduce((s, l) => s + valeur(l), 0);
  if (!total) return rnd.melanger(lignes).slice(0, n);
  const pas = total / n;
  let cible = rnd() * pas; let cumul = 0;
  const retenues = [];
  for (const l of lignes) {
    cumul += valeur(l);
    if (cumul >= cible) { retenues.push(l); while (cible <= cumul) cible += pas; }
  }
  return retenues;
}

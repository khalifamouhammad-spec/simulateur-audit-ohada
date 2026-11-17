// Dossiers clients : création, avancement, temps passé.
import { ELEMENTS, NOMS_PROVISOIRES, FORMES_PAR_TAILLE, SECTEURS } from './config.js';
import { db } from './db.js';
import { identifiant } from './utils.js';

/**
 * Structure d'un dossier (magasin « dossiers ») :
 * {
 *   id, creeLe, modifieLe,
 *   statut: 'en_cours' | 'en_revue' | 'cloturee',
 *   parametres: { secteur, taille, difficulte, nbAnomalies, referentiel, extraitRapport, modeGeneration },
 *   client: { nom, formeJuridique, secteur, provisoire },   // complété par le scénario en phase 2
 *   exercice: { debut, cloture },                           // dates AAAA-MM-JJ de l'exercice N
 *   tempsSecondes,
 *   elements: { [code]: { statut, notes } },                // état de chaque élément de l'arborescence
 * }
 */
export async function creerDossier({ secteur, taille, difficulte, nbAnomalies, referentiel, extraitRapport = '', modeGeneration = null }) {
  const annee = new Date().getFullYear() - 1;
  const existants = new Set((await db.tout('dossiers')).map((d) => d.client.nom));
  const noms = NOMS_PROVISOIRES[secteur];
  const nom = noms.find((n) => !existants.has(n)) || `${noms[0]} ${existants.size + 1}`;
  const maintenant = new Date().toISOString();
  const dossier = {
    id: identifiant(),
    creeLe: maintenant,
    modifieLe: maintenant,
    statut: 'en_cours',
    parametres: { secteur, taille, difficulte, nbAnomalies, referentiel, extraitRapport, modeGeneration },
    client: { nom, formeJuridique: FORMES_PAR_TAILLE[taille], secteur: SECTEURS[secteur], provisoire: true },
    exercice: { debut: `${annee}-01-01`, cloture: `${annee}-12-31` },
    tempsSecondes: 0,
    elements: {},
  };
  await db.ecrire('dossiers', dossier);
  return dossier;
}

export async function enregistrerDossier(dossier) {
  dossier.modifieLe = new Date().toISOString();
  await db.ecrire('dossiers', dossier);
}

export const statutElement = (dossier, code) => dossier.elements[code]?.statut || 'a_faire';

/** Avancement en % : part des éléments suivis (sections A à G) au statut « validé ». */
export function avancement(dossier) {
  const suivis = ELEMENTS.filter((e) => e.suivi);
  return Math.round((suivis.filter((e) => statutElement(dossier, e.code) === 'valide').length / suivis.length) * 100);
}

/** 3 725 secondes -> « 1 h 02 » */
export function dureeFr(secondes) {
  const minutes = Math.floor((secondes || 0) / 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

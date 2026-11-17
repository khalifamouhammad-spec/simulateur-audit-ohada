// Création d'un dossier à partir d'un FEC (ou d'un journal) importé par l'utilisateur.
// Le dossier n'a pas de corrigé : aucune anomalie n'est connue du logiciel.
import { SECTEURS, FORMES_PAR_TAILLE } from './config.js';
import { db } from './db.js';
import { creerDossier } from './dossiers.js';
import { lireFichierEcritures, exerciceDepuis, tiersDepuis } from './moteur/import-fec.js';
import { calculerEtats, verifierFec } from './moteur/compta.js';
import { COL } from './moteur/plan.js';

/**
 * fichiers : { N: texte, N1: texte | null }. Renvoie { dossier } ou lève une erreur détaillée.
 * Les avertissements sont conservés dans le dossier et affichés sur la synthèse.
 */
export async function importerDossier({ nom, secteur, taille, referentiel, fichiers, nomsFichiers }) {
  const n = lireFichierEcritures(fichiers.N);
  if (n.erreurs.length) throw new Error(`Exercice N — ${n.erreurs.join(' ')}`);
  let n1 = { lignes: [], avertissements: [], resume: null };
  if (fichiers.N1) {
    n1 = lireFichierEcritures(fichiers.N1);
    if (n1.erreurs.length) throw new Error(`Exercice N-1 — ${n1.erreurs.join(' ')}`);
    if (n1.resume.fin >= n.resume.debut) n1.avertissements.push("Les dates de l'exercice N-1 chevauchent celles de l'exercice N : vérifiez que les deux fichiers sont dans le bon ordre.");
  }
  const exercice = exerciceDepuis(n.resume);
  const dossier = await creerDossier({ secteur, taille, difficulte: 'intermediaire', nbAnomalies: 0, referentiel });
  const exercice1 = n1.resume ? exerciceDepuis(n1.resume) : null;
  const chiffres = {};
  for (const [cle, lu, ex] of [['N', n, exercice], ['N-1', n1, exercice1]]) {
    const controle = ex ? verifierFec(lu.lignes, { debut: ex.debut, fin: ex.cloture }) : { nbLignes: 0, nbEcritures: 0 };
    chiffres[cle] = { ...calculerEtats(lu.lignes).agregats, nbLignes: controle.nbLignes, nbEcritures: controle.nbEcritures };
  }
  const utilisateurs = Object.fromEntries([...new Set(n.lignes.map((l) => l[COL.Utilisateur]))].map((u, i) => [i ? `u${i}` : 'defaut', u]));
  const rien = 'Non renseigné (dossier importé) : complétez la prise de connaissance à partir de vos informations.';
  Object.assign(dossier, {
    client: {
      nom: nom || 'Client importé', formeJuridique: FORMES_PAR_TAILLE[taille] || 'Société', secteur: SECTEURS[secteur], provisoire: false,
      siren: '—', ville: '—', dateCreation: '—', dirigeant: '—', effectif: 0,
      activite: rien, organisation: rien, systemeInformation: rien, contexteMission: rien, faitsMarquants: [],
    },
    exercice,
    scenario: { source: 'import', graine: Math.floor(Math.random() * 2 ** 31), activite: { chiffreAffaires: chiffres.N.chiffreAffaires, croissancePct: 0 } },
    tiers: tiersDepuis(n.lignes),
    utilisateurs,
    seuilAutorisation: 0,
    chiffres,
    import: { fichiers: nomsFichiers, avertissements: [...n.avertissements, ...n1.avertissements.map((a) => `N-1 : ${a}`)], resumeN: n.resume, resumeN1: n1.resume },
  });
  dossier.parametres.source = 'import';
  dossier.parametres.nbAnomalies = 0;
  await db.ecrire('fec', { dossierId: dossier.id, exercice: 'N', lignes: n.lignes });
  await db.ecrire('fec', { dossierId: dossier.id, exercice: 'N-1', lignes: n1.lignes });
  await db.ecrire('dossiers', dossier);
  return dossier;
}

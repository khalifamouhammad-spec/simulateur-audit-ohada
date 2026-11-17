// Génération d'un client : scénario (IA ou modèle local), comptabilité N-1 et N par le moteur,
// contrôles, puis enregistrement. Le corrigé est rangé dans un magasin séparé.
import { REFERENTIELS, TAILLES, SECTEURS } from './config.js';
import { db, lireParametres } from './db.js';
import { demanderJSON } from './groq.js';
import { construirePromptScenario, validerScenario } from './moteur/scenario.js';
import { genererComptabilite } from './moteur/generateur-fec.js';
import { verifierFec, calculerEtats } from './moteur/compta.js';

const MAX_TENTATIVES = 4;

/** mode : 'ia' ou 'local'. Met à jour et enregistre le dossier. */
export async function genererClient(dossier, { mode, suivi = () => {} }) {
  const p = dossier.parametres;
  const annee = Number(dossier.exercice.cloture.slice(0, 4));
  let brut = {};
  if (mode === 'ia') {
    const parametres = await lireParametres();
    suivi("L'IA rédige le scénario du client…");
    const { systeme, utilisateur } = construirePromptScenario({ ...p, referentiel: REFERENTIELS[p.referentiel] });
    brut = await demanderJSON({ cle: parametres.cleGroq, modele: parametres.modele, systeme, utilisateur, maxTokens: 3000 });
  }
  let dernieresErreurs = [];
  for (let tentative = 1; tentative <= MAX_TENTATIVES; tentative++) {
    suivi(tentative === 1 ? 'Génération du journal des écritures N-1 et N, injection des anomalies…' : `Comptabilité rejetée par les contrôles — nouvelle génération ${tentative}/${MAX_TENTATIVES}…`);
    await new Promise((r) => setTimeout(r, 30)); // laisse l'écran se mettre à jour
    const graine = Math.floor(Math.random() * 2 ** 31);
    const { scenario, choix } = validerScenario(brut, { secteur: p.secteur, taille: p.taille, difficulte: p.difficulte, nbAnomalies: p.nbAnomalies, graine, nomParDefaut: dossier.client.nom, formeParDefaut: dossier.client.formeJuridique });
    const compta = genererComptabilite(scenario, choix, { lignesCible: TAILLES[p.taille].lignesFec, annee });

    // Contrôles : tout doit être juste, sinon on régénère.
    const chiffres = {};
    dernieresErreurs = [];
    for (const [exercice, an] of [['N-1', annee - 1], ['N', annee]]) {
      const controle = verifierFec(compta.fec[exercice], { debut: `${an}-01-01`, fin: `${an}-12-31` });
      const etats = calculerEtats(compta.fec[exercice]);
      dernieresErreurs.push(...controle.erreurs);
      if (!etats.controles.bilanEquilibre) dernieresErreurs.push(`Bilan ${exercice} déséquilibré.`);
      if (!etats.controles.resultatIdentique) dernieresErreurs.push(`Résultat ${exercice} différent entre bilan et compte de résultat.`);
      chiffres[exercice] = { ...etats.agregats, nbLignes: controle.nbLignes, nbEcritures: controle.nbEcritures };
    }
    if (compta.anomalies.length < Math.min(3, p.nbAnomalies)) dernieresErreurs.push('Trop peu d\'anomalies ont pu être placées.');
    if (dernieresErreurs.length) continue;

    suivi('Enregistrement du dossier…');
    for (const exercice of ['N-1', 'N']) await db.ecrire('fec', { dossierId: dossier.id, exercice, lignes: compta.fec[exercice] });
    await db.ecrire('corriges', { dossierId: dossier.id, anomalies: compta.anomalies, donnees: compta.donnees, nonPlacees: compta.echecs });
    Object.assign(dossier, {
      client: { ...scenario.client, secteur: SECTEURS[p.secteur], provisoire: false },
      scenario: { activite: scenario.activite, graine, source: mode },
      tiers: compta.tiers,
      utilisateurs: compta.utilisateurs,
      seuilAutorisation: compta.seuilAutorisation,
      chiffres,
      modifieLe: new Date().toISOString(),
    });
    dossier.parametres.nbAnomalies = compta.anomalies.length;
    delete dossier.parametres.modeGeneration;
    await db.ecrire('dossiers', dossier);
    return dossier;
  }
  throw new Error(`La comptabilité générée n'a pas passé les contrôles après ${MAX_TENTATIVES} tentatives (${dernieresErreurs[0]}).`);
}

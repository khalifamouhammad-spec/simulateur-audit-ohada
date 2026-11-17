// Accès à IndexedDB. Point unique d'accès au stockage.
// Magasins :
//   parametres : réglages de l'application (clé Groq, modèle, référentiel) — clé 'app'
//   dossiers   : un enregistrement par dossier client (sans le journal ni le corrigé)
//   fec        : écritures d'un exercice — clé [dossierId, exercice]
//   corriges   : anomalies cachées d'un dossier, lues uniquement après la clôture
//   feuilles   : feuilles de travail — index dossierId
//   documents  : pièces justificatives générées — index dossierId
import { MODELE_GROQ_DEFAUT } from './config.js';

// Nom distinct de celui de l'app PCG / NEP : les deux apps sont servies depuis le même domaine.
const NOM_BASE = 'logiciel-audit-ohada';
const VERSION = 1;
let base = null;

function ouvrir() {
  if (base) return base;
  base = new Promise((resoudre, rejeter) => {
    const demande = indexedDB.open(NOM_BASE, VERSION);
    demande.onupgradeneeded = () => {
      const b = demande.result;
      b.createObjectStore('parametres');
      b.createObjectStore('dossiers', { keyPath: 'id' });
      b.createObjectStore('fec', { keyPath: ['dossierId', 'exercice'] });
      b.createObjectStore('corriges', { keyPath: 'dossierId' });
      b.createObjectStore('feuilles', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
      b.createObjectStore('documents', { keyPath: 'id' }).createIndex('dossierId', 'dossierId');
    };
    demande.onsuccess = () => resoudre(demande.result);
    demande.onerror = () => rejeter(new Error('Stockage local indisponible (IndexedDB) : ' + demande.error?.message));
    demande.onblocked = () => rejeter(new Error('Base de données bloquée par un autre onglet : fermez-le puis rechargez.'));
  });
  return base;
}

/** Exécute une opération sur un ou plusieurs magasins et attend la fin de la transaction. */
async function transaction(magasins, mode, action) {
  const b = await ouvrir();
  return new Promise((resoudre, rejeter) => {
    const t = b.transaction(magasins, mode);
    let resultat;
    t.oncomplete = () => resoudre(resultat);
    t.onerror = () => rejeter(new Error('Erreur de stockage : ' + t.error?.message));
    t.onabort = () => rejeter(new Error('Écriture annulée (espace de stockage insuffisant ?) : ' + t.error?.message));
    const demande = action(t);
    if (demande) demande.onsuccess = () => { resultat = demande.result; };
  });
}

export const db = {
  lire: (magasin, cle) => transaction(magasin, 'readonly', (t) => t.objectStore(magasin).get(cle)),
  tout: (magasin) => transaction(magasin, 'readonly', (t) => t.objectStore(magasin).getAll()),
  parDossier: (magasin, dossierId) => transaction(magasin, 'readonly', (t) => t.objectStore(magasin).index('dossierId').getAll(dossierId)),
  ecrire: (magasin, valeur, cle) => transaction(magasin, 'readwrite', (t) => { t.objectStore(magasin).put(valeur, cle); }),
  supprimer: (magasin, cle) => transaction(magasin, 'readwrite', (t) => { t.objectStore(magasin).delete(cle); }),

  /** Supprime un dossier et tout ce qui s'y rattache. */
  supprimerDossier: (id) => transaction(['dossiers', 'fec', 'corriges', 'feuilles', 'documents'], 'readwrite', (t) => {
    t.objectStore('dossiers').delete(id);
    t.objectStore('corriges').delete(id);
    t.objectStore('fec').delete(IDBKeyRange.bound([id, ''], [id, '￿']));
    for (const magasin of ['feuilles', 'documents']) {
      t.objectStore(magasin).index('dossierId').openKeyCursor(IDBKeyRange.only(id)).onsuccess = (e) => {
        const curseur = e.target.result;
        if (curseur) { t.objectStore(magasin).delete(curseur.primaryKey); curseur.continue(); }
      };
    }
  }),
};

export async function lireParametres() {
  return { cleGroq: '', modele: MODELE_GROQ_DEFAUT, referentiel: 'ohada', ...((await db.lire('parametres', 'app')) || {}) };
}
export const ecrireParametres = (p) => db.ecrire('parametres', p, 'app');

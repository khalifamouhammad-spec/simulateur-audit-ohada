// Feuilles de travail et pièces justificatives (magasins « feuilles » et « documents »).
//
// Feuille : { id, dossierId, cycle, ref: 'D1-2', titre, objectif, travail, conclusion,
//             refsCroisees: ['D1-1', 'E1'], statut, elements: [élément joint], modifieLe }
// Élément joint : { type: 'lignes', titre, lignes: [{ source, exercice, num, date, piece, lib, compte, montant }] }
//              ou { type: 'piece', documentId, titre }
import { db } from './db.js';
import { identifiant } from './utils.js';

const ordre = (ref) => ref.split('-').map((x) => (Number.isNaN(Number(x)) ? x : String(x).padStart(4, '0'))).join('-');

export async function listerFeuilles(dossierId, cycle = null) {
  const feuilles = await db.parDossier('feuilles', dossierId);
  return feuilles.filter((f) => !cycle || f.cycle === cycle).sort((a, b) => ordre(a.ref).localeCompare(ordre(b.ref)));
}

export function nouvelleFeuille(dossierId, cycle, code, existantes) {
  const numero = Math.max(0, ...existantes.filter((f) => f.ref.startsWith(code + '-')).map((f) => Number(f.ref.split('-')[1]) || 0)) + 1;
  return { id: identifiant(), dossierId, cycle, ref: `${code}-${numero}`, titre: '', objectif: '', travail: '', conclusion: '', refsCroisees: [], statut: 'en_cours', elements: [], modifieLe: new Date().toISOString() };
}

export async function enregistrerFeuille(feuille) {
  feuille.modifieLe = new Date().toISOString();
  await db.ecrire('feuilles', feuille);
}
export const supprimerFeuille = (id) => db.supprimer('feuilles', id);

export async function listerDocuments(dossierId, cycle = null) {
  const docs = await db.parDossier('documents', dossierId);
  return docs.filter((d) => !cycle || d.cycle === cycle).sort((a, b) => a.creeLe.localeCompare(b.creeLe));
}
export async function enregistrerDocument(doc) {
  doc.id ??= identifiant();
  doc.creeLe ??= new Date().toISOString();
  await db.ecrire('documents', doc);
  return doc;
}

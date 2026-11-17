// E1 — Tableau des ajustements proposés, et formulaire de saisie d'un ajustement
// (utilisé aussi depuis les cycles).
//
// Ajustement : { id, cycle, description, feuille, references: [{ source, exercice, num, lib }],
//                lignes: [{ compte, libelle, debit, credit }], decision, commentaire }
import { CYCLES, REFERENTIELS } from '../config.js';
import { listerFeuilles } from '../feuilles.js';
import { PLAN } from '../moteur/plan.js';
import { echapper, euro, montantOuVide, lireNombre, identifiant } from '../utils.js';
import { positionDirection } from '../moteur/evenements.js';

export const DECISIONS = { attente: 'En attente', corrigee: 'Corrigée par le client', non_corrigee: 'Non corrigée' };
const c = (n) => Math.round(lireNombre(n) * 100);

/** Effet de l'écriture de correction sur le résultat avant impôt (produits − charges), en euros. */
export function impactResultat(ajustement) {
  return ajustement.lignes.reduce((s, l) => s + (/^[678]/.test(String(l.compte)) ? c(l.credit) - c(l.debit) : 0), 0) / 100;
}
export function equilibre(ajustement) {
  const debit = ajustement.lignes.reduce((s, l) => s + c(l.debit), 0);
  const credit = ajustement.lignes.reduce((s, l) => s + c(l.credit), 0);
  return { debit: debit / 100, credit: credit / 100, ok: debit === credit && debit > 0 };
}

/** Ouvre le formulaire dans une boîte de dialogue. « base » préremplit un nouvel ajustement. */
export async function ouvrirAjustement({ dossier, ajustement = null, base = {}, apres }) {
  const feuilles = await listerFeuilles(dossier.id);
  const a = ajustement ? structuredClone(ajustement) : { id: identifiant(), cycle: '', description: '', feuille: '', references: [], lignes: [{ compte: '', libelle: '', debit: '', credit: '' }, { compte: '', libelle: '', debit: '', credit: '' }], decision: 'attente', commentaire: '', ...base };
  const dialogue = document.createElement('dialog');
  dialogue.className = 'large';
  document.body.append(dialogue);
  const dessiner = () => {
    dialogue.innerHTML = `
      <form method="dialog">
        <h2>${ajustement ? 'Modifier' : 'Proposer'} un ajustement</h2>
        ${a.references.length ? `<p class="discret">Écritures et lignes concernées : ${a.references.map((r) => echapper(`${r.num || r.lib}${r.exercice && r.exercice !== 'N' ? ` (${r.exercice})` : ''}`)).join(', ')}</p>` : ''}
        <div class="grille">
          <div><label for="aj-cycle">Cycle</label><select id="aj-cycle" required><option value="">— Choisir —</option>${Object.entries(CYCLES).map(([k, v]) => `<option value="${k}" ${a.cycle === k ? 'selected' : ''}>${echapper(v)}</option>`).join('')}</select></div>
          <div><label for="aj-feuille">Feuille de travail de référence</label><select id="aj-feuille"><option value="">—</option>${feuilles.map((f) => `<option ${a.feuille === f.ref ? 'selected' : ''} value="${f.ref}">${f.ref} ${echapper(f.titre)}</option>`).join('')}</select></div>
          <div><label for="aj-decision">Décision de la direction</label><select id="aj-decision" disabled>${Object.entries(DECISIONS).map(([k, v]) => `<option value="${k}" ${a.decision === k ? 'selected' : ''}>${v}</option>`).join('')}</select><span class="discret">Fixée lors de la présentation des ajustements à la direction (E1).</span></div>
        </div>
        <label for="aj-description">Nature de l'anomalie et incidence sur les comptes</label>
        <textarea id="aj-description" rows="3" required>${echapper(a.description)}</textarea>
        <label>Écriture de correction proposée</label>
        <div class="defilement"><table class="dense">
          <thead><tr><th>Compte</th><th>Libellé</th><th class="nombre">Débit</th><th class="nombre">Crédit</th><th></th></tr></thead>
          <tbody>${a.lignes.map((l, i) => `<tr data-i="${i}">
            <td><input type="text" data-l="compte" value="${echapper(l.compte)}" size="8" list="aj-comptes" aria-label="Compte"></td>
            <td><input type="text" data-l="libelle" value="${echapper(l.libelle)}" aria-label="Libellé"></td>
            <td><input type="text" data-l="debit" value="${echapper(l.debit)}" size="10" inputmode="decimal" aria-label="Débit"></td>
            <td><input type="text" data-l="credit" value="${echapper(l.credit)}" size="10" inputmode="decimal" aria-label="Crédit"></td>
            <td><button type="button" class="petit danger" data-retirer="${i}" ${a.lignes.length <= 2 ? 'disabled' : ''}>✕</button></td></tr>`).join('')}</tbody>
        </table></div>
        <datalist id="aj-comptes">${Object.entries(PLAN).map(([k, v]) => `<option value="${k}">${echapper(v)}</option>`).join('')}</datalist>
        <div class="ligne espace"><button type="button" class="petit" data-ajouter>+ Ajouter une ligne</button><span data-controle class="discret"></span></div>
        <label for="aj-commentaire">Commentaire (position du client, suite donnée)</label>
        <input type="text" id="aj-commentaire" value="${echapper(a.commentaire)}">
        <div class="ligne fin"><button type="button" data-annuler>Annuler</button><button class="principal" value="ok">Enregistrer</button></div>
      </form>`;
    const lire = () => {
      for (const [id, cle] of [['aj-cycle', 'cycle'], ['aj-feuille', 'feuille'], ['aj-decision', 'decision'], ['aj-description', 'description'], ['aj-commentaire', 'commentaire']]) a[cle] = dialogue.querySelector('#' + id).value;
      dialogue.querySelectorAll('tr[data-i]').forEach((tr) => tr.querySelectorAll('[data-l]').forEach((champ) => { a.lignes[Number(tr.dataset.i)][champ.dataset.l] = champ.value.trim(); }));
    };
    const controle = () => {
      lire();
      const eq = equilibre(a);
      dialogue.querySelector('[data-controle]').innerHTML = `Débit ${euro(eq.debit)} · crédit ${euro(eq.credit)} — ${eq.ok ? '<span class="pastille vert">Équilibrée</span>' : '<span class="pastille orange">Déséquilibrée</span>'} · incidence sur le résultat : <strong>${euro(impactResultat(a))}</strong>`;
      return eq.ok;
    };
    dialogue.querySelectorAll('[data-l]').forEach((champ) => champ.addEventListener('input', () => {
      if (champ.dataset.l === 'compte' && PLAN[champ.value]) { const lib = champ.closest('tr').querySelector('[data-l=libelle]'); if (!lib.value) lib.value = PLAN[champ.value]; }
      controle();
    }));
    dialogue.querySelector('[data-ajouter]').addEventListener('click', () => { lire(); a.lignes.push({ compte: '', libelle: '', debit: '', credit: '' }); dessiner(); });
    dialogue.querySelectorAll('[data-retirer]').forEach((b) => b.addEventListener('click', () => { lire(); a.lignes.splice(Number(b.dataset.retirer), 1); dessiner(); }));
    dialogue.querySelector('[data-annuler]').addEventListener('click', () => dialogue.close());
    dialogue.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!controle()) { alert("L'écriture de correction doit être équilibrée (total débit = total crédit) et non nulle."); return; }
      a.lignes = a.lignes.filter((l) => l.compte || c(l.debit) || c(l.credit));
      dossier.ajustements ??= [];
      const i = dossier.ajustements.findIndex((x) => x.id === a.id);
      if (i >= 0) dossier.ajustements[i] = a; else dossier.ajustements.push(a);
      dialogue.close();
      apres?.(a);
    });
    controle();
  };
  dialogue.addEventListener('close', () => dialogue.remove());
  dessiner();
  dialogue.showModal();
}

export async function afficherAjustements(zone, { dossier, modifie, sauver, lectureSeule }) {
  dossier.ajustements ??= [];
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  const seuils = dossier.seuils || {};
  const dessiner = () => {
    const liste = dossier.ajustements;
    const retenus = liste.filter((a) => a.decision !== 'corrigee');
    const net = retenus.reduce((s, a) => s + Math.round(impactResultat(a) * 100), 0) / 100;
    const absolu = retenus.reduce((s, a) => s + Math.abs(Math.round(impactResultat(a) * 100)), 0) / 100;
    const corriges = liste.filter((a) => a.decision === 'corrigee').reduce((s, a) => s + Math.round(impactResultat(a) * 100), 0) / 100;
    const position = !seuils.signification ? ['orange', 'Seuil de signification non fixé (C1)']
      : Math.abs(net) >= seuils.signification ? ['rouge', "Les anomalies non corrigées dépassent le seuil de signification : incidence sur l'opinion à envisager"]
      : seuils.planification && Math.abs(net) >= seuils.planification ? ['orange', 'Cumul compris entre le seuil de planification et le seuil de signification : travaux complémentaires à envisager']
      : ['vert', 'Cumul des anomalies non corrigées inférieur au seuil de planification'];
    zone.innerHTML = `
      <div class="panneau">
        <p>Toutes les anomalies relevées pendant les travaux, avec l'écriture de correction proposée (${N} 450). L'incidence sur le résultat est calculée à partir de l'écriture : positive si la correction augmente le résultat, négative si elle le diminue. Elle est exprimée avant impôt ; l'incidence sur les capitaux propres est identique.</p>
        <div class="indicateurs">
          <div class="indicateur"><span>Seuil de signification</span><strong>${seuils.signification ? euro(seuils.signification) : '—'}</strong></div>
          <div class="indicateur"><span>Seuil de planification</span><strong>${seuils.planification ? euro(seuils.planification) : '—'}</strong></div>
          <div class="indicateur"><span>Anomalies insignifiantes</span><strong>${seuils.insignifiant ? euro(seuils.insignifiant) : '—'}</strong></div>
          <div class="indicateur"><span>Non corrigées — effet net</span><strong>${euro(net)}</strong></div>
          <div class="indicateur"><span>Non corrigées — cumul absolu</span><strong>${euro(absolu)}</strong></div>
          <div class="indicateur"><span>Corrigées par le client</span><strong>${euro(corriges)}</strong></div>
        </div>
        <p><span class="pastille ${position[0]}">${position[1]}</span></p>
        <div class="ligne"><button type="button" class="principal" data-nouveau ${lectureSeule ? 'disabled' : ''}>+ Nouvel ajustement</button>
          <button type="button" data-presenter ${lectureSeule || !liste.some((a) => !a.presente) ? 'disabled' : ''}>Présenter ${liste.filter((a) => !a.presente).length || ''} ajustement(s) à la direction</button></div>
        <p class="discret">La direction se prononce sur chaque ajustement présenté : elle accepte de corriger ou refuse. Seules les anomalies non corrigées entrent dans le cumul comparé au seuil et dans votre opinion (G4). Un ajustement présenté ne peut plus être modifié.</p>
      </div>
      <div class="panneau serre"><div class="defilement"><table class="dense">
        <thead><tr><th>N°</th><th>Cycle</th><th>Feuille</th><th>Anomalie</th><th>Écriture de correction</th><th class="nombre">Incidence résultat</th><th class="nombre">Incidence capitaux propres</th><th>Décision</th><th></th></tr></thead>
        <tbody>${liste.map((a, i) => {
          const impact = impactResultat(a);
          const mention = seuils.insignifiant && Math.abs(impact) < seuils.insignifiant && a.lignes.every((l) => Math.max(lireNombre(l.debit), lireNombre(l.credit)) < seuils.insignifiant) ? '<br><span class="pastille gris">Manifestement insignifiante</span>'
            : seuils.signification && Math.abs(impact) >= seuils.signification ? '<br><span class="pastille rouge">Significative à elle seule</span>' : '';
          return `<tr><td>${i + 1}</td><td>${echapper(CYCLES[a.cycle] || '')}</td><td class="code">${echapper(a.feuille)}</td><td>${echapper(a.description)}${a.commentaire ? `<br><span class="discret">${echapper(a.commentaire)}</span>` : ''}${mention}</td>
            <td class="ecriture">${a.lignes.map((l) => `${lireNombre(l.debit) ? 'D' : 'C'} ${echapper(l.compte)} ${echapper(l.libelle)} : ${montantOuVide(lireNombre(l.debit) || lireNombre(l.credit))}`).join('<br>')}</td>
            <td class="nombre">${euro(impact)}</td><td class="nombre">${euro(impact)}</td>
            <td><span class="pastille ${{ attente: 'gris', corrigee: 'vert', non_corrigee: 'rouge' }[a.decision]}">${DECISIONS[a.decision]}</span></td>
            <td class="actions">${a.presente ? '<span class="discret">Présenté</span>' : `<button type="button" class="petit" data-modifier="${a.id}">Modifier</button> <button type="button" class="petit danger" data-supprimer="${a.id}">Supprimer</button>`}</td></tr>`;
        }).join('') || '<tr><td colspan="9" class="vide">Aucun ajustement proposé. Ils se créent ici ou depuis les outils d\'un cycle.</td></tr>'}</tbody>
      </table></div></div>`;
    const apres = async () => { modifie(); await sauver(); dessiner(); };
    zone.querySelector('[data-nouveau]').addEventListener('click', () => ouvrirAjustement({ dossier, apres }));
    zone.querySelectorAll('[data-modifier]').forEach((b) => b.addEventListener('click', () => ouvrirAjustement({ dossier, ajustement: dossier.ajustements.find((a) => a.id === b.dataset.modifier), apres })));
    zone.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Supprimer cet ajustement ?')) return;
      dossier.ajustements = dossier.ajustements.filter((a) => a.id !== b.dataset.supprimer);
      apres();
    }));
    zone.querySelector('[data-presenter]')?.addEventListener('click', () => {
      const nouveaux = dossier.ajustements.filter((a) => !a.presente);
      if (!confirm(`Présenter ${nouveaux.length} ajustement(s) à la direction ? Ils ne pourront plus être modifiés.`)) return;
      const seuil = seuils.signification || Math.round(dossier.chiffres.N.produitsExploitation * 0.01);
      const position = positionDirection(nouveaux, seuil, impactResultat);
      for (const a of nouveaux) Object.assign(a, position.get(a.id), { presente: true });
      apres();
    });
  };
  dessiner();
}

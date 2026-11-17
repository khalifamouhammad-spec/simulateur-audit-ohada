// Tableau de bord : liste des dossiers clients et création d'un dossier.
import { SECTEURS, TAILLES, NIVEAUX, STATUTS_MISSION, REFERENTIELS } from '../config.js';
import { db, lireParametres } from '../db.js';
import { creerDossier, avancement, dureeFr } from '../dossiers.js';
import { importerDossier } from '../import.js';
import { decoder } from '../moteur/import-fec.js';
import { echapper, dateFr } from '../utils.js';

const options = (objet, texte = (v) => v.libelle || v) => Object.entries(objet).map(([k, v]) => `<option value="${k}">${echapper(texte(v))}</option>`).join('');

export async function afficherTableauDeBord(vue) {
  const [dossiers, parametres] = await Promise.all([db.tout('dossiers'), lireParametres()]);
  dossiers.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe));
  const total = dossiers.reduce((s, d) => s + d.tempsSecondes, 0);

  vue.innerHTML = `
    <main class="page">
      <div class="ligne espace">
        <div><h1>Tableau de bord</h1><p class="discret">Dossiers clients du cabinet (clients fictifs d'entraînement).</p></div>
        <span class="ligne"><button data-importer>Importer un FEC</button><button class="principal" data-nouveau>+ Nouveau dossier</button></span>
      </div>
      <div class="indicateurs">
        <div class="indicateur"><span>Dossiers</span><strong>${dossiers.length}</strong></div>
        <div class="indicateur"><span>Missions en cours</span><strong>${dossiers.filter((d) => d.statut !== 'cloturee').length}</strong></div>
        <div class="indicateur"><span>Missions clôturées</span><strong>${dossiers.filter((d) => d.statut === 'cloturee').length}</strong></div>
        <div class="indicateur"><span>Temps passé</span><strong>${dureeFr(total)}</strong></div>
      </div>
      <div class="panneau">
        <div class="defilement"><table class="dense">
          <thead><tr><th>Client</th><th>Exercice clos le</th><th>Secteur</th><th>Taille</th><th>Difficulté</th><th>Statut</th><th class="nombre">Note</th><th>Avancement</th><th class="nombre">Temps</th><th>Modifié le</th><th></th></tr></thead>
          <tbody>${dossiers.map((d) => {
            const pct = avancement(d);
            const s = STATUTS_MISSION[d.statut];
            return `<tr>
              <td><a href="#/dossier/${d.id}"><strong>${echapper(d.client.nom)}</strong></a><br><span class="discret">${echapper(d.client.formeJuridique)}</span></td>
              <td>${dateFr(d.exercice.cloture)}</td><td>${echapper(SECTEURS[d.parametres.secteur])}</td><td>${TAILLES[d.parametres.taille].libelle}</td>
              <td>${d.parametres.source === 'import' ? 'Importé' : NIVEAUX[d.parametres.difficulte].libelle}</td>
              <td><span class="pastille ${s.classe}">${s.libelle}</span></td>
              <td class="nombre">${d.correction ? `<a href="#/dossier/${d.id}/H1">${String(d.correction.globale).replace('.', ',')} / 20</a>` : '—'}</td>
              <td><div class="jauge" title="${pct} %"><i style="width:${pct}%"></i></div><span class="discret">${pct} %</span></td>
              <td class="nombre">${dureeFr(d.tempsSecondes)}</td><td>${dateFr(d.modifieLe.slice(0, 10))}</td>
              <td class="actions"><a class="bouton petit" href="#/dossier/${d.id}">Ouvrir</a> <button class="petit danger" data-supprimer="${d.id}">Supprimer</button></td></tr>`;
          }).join('') || '<tr><td colspan="11" class="vide">Aucun dossier. Créez votre premier client avec « Nouveau dossier ».</td></tr>'}</tbody>
        </table></div>
      </div>
      <details class="panneau"><summary>Mode d'emploi : déroulé d'une mission</summary>
        <ol class="mode-emploi">
          <li><strong>Créer un dossier</strong> (secteur, taille, difficulté, nombre d'anomalies). Le logiciel génère le client et son journal des écritures N-1 et N ; les anomalies cachées restent invisibles jusqu'à la clôture.</li>
          <li><strong>Planifier</strong> : A (acceptation, indépendance, lettre de mission), B (prise de connaissance, contrôle interne, revue analytique, matrice des risques), C (seuils).</li>
          <li><strong>Travailler les cycles</strong> D1 à D8 : programme de travail, grand livre et sondages, outils (rapprochement, balance âgée, lettrage, circularisation, tests sur le journal…), pièces justificatives, feuilles de travail.</li>
          <li><strong>Reporter chaque anomalie</strong> dans E1 avec son écriture de correction, de préférence depuis les lignes sélectionnées, puis présenter les ajustements à la direction.</li>
          <li><strong>Revue du manager</strong> (F1) : répondre à chaque point de revue.</li>
          <li><strong>Finaliser</strong> : G1 événements postérieurs, G2 lettre d'affirmation, G3 note de synthèse, G4 rapport et opinion.</li>
          <li><strong>Clôturer</strong> en H1 : corrigé détaillé, note sur 20 par section et note globale, puis suivi dans l'Historique.</li>
        </ol>
      </details>
      <p class="discret">Les dossiers sont enregistrés dans ce navigateur (IndexedDB) : ils ne sont pas partagés entre appareils.</p>
    </main>
    <dialog>
      <form method="dialog">
        <h2>Nouveau dossier client</h2>
        <div class="grille">
          <div><label for="n-secteur">Secteur</label><select id="n-secteur">${options(SECTEURS)}</select></div>
          <div><label for="n-taille">Taille</label><select id="n-taille">${options(TAILLES, (t) => `${t.libelle} — ${t.description}`)}</select></div>
          <div><label for="n-difficulte">Difficulté</label><select id="n-difficulte">${options(NIVEAUX, (n) => `${n.libelle} — ${n.description}`)}</select></div>
          <div><label for="n-anomalies">Nombre d'anomalies cachées</label><input type="number" id="n-anomalies" min="3" max="15" value="6" required></div>
        </div>
        <label for="n-extrait">Option : cas inspiré d'un vrai rapport</label>
        <textarea id="n-extrait" placeholder="Collez un extrait de rapport (par exemple un point clé de l'audit). L'IA construira un client fictif sur ce modèle, sans aucun nom réel."></textarea>
        <p class="discret">Référentiel : ${echapper(REFERENTIELS[parametres.referentiel].libelle)}. Le client et son journal des écritures (N-1 et N) sont générés à partir de ces paramètres.${parametres.cleGroq ? '' : ' Aucune clé Groq enregistrée : utilisez « Créer sans IA » ou saisissez la clé dans les Paramètres.'}</p>
        <div class="ligne fin"><button type="button" data-annuler>Annuler</button><button name="mode" value="local">Créer sans IA</button><button class="principal" name="mode" value="ia" ${parametres.cleGroq ? '' : 'disabled'}>Créer avec l'IA</button></div>
      </form>
    </dialog>
    <dialog class="import">
      <form method="dialog">
        <h2>Importer un FEC</h2>
        <p class="discret">Fichier des écritures de l'exercice audité : FEC réglementaire (.txt, 18 colonnes), export du journal général (.csv) ou fichier préparé par Claude. Séparateurs, formats de date et colonnes Débit / Crédit ou Montant + Sens sont reconnus automatiquement.
        Un dossier importé n'a pas de corrigé automatique : vos travaux et votre opinion sont notés, pas la détection.</p>
        <label for="i-nom">Nom du client</label><input type="text" id="i-nom" required placeholder="ex. Client importé">
        <div class="grille">
          <div><label for="i-secteur">Secteur</label><select id="i-secteur">${options(SECTEURS)}</select></div>
          <div><label for="i-taille">Taille</label><select id="i-taille">${options(TAILLES, (t) => `${t.libelle} — ${t.description}`)}</select></div>
        </div>
        <label for="i-n">Fichier de l'exercice N (obligatoire)</label><input type="file" id="i-n" accept=".txt,.csv,.tsv,.fec" required>
        <label for="i-n1">Fichier de l'exercice N-1 (facultatif, pour la revue analytique)</label><input type="file" id="i-n1" accept=".txt,.csv,.tsv,.fec">
        <div data-etat-import></div>
        <div class="ligne fin"><button type="button" data-annuler-import>Annuler</button><button class="principal" value="ok">Importer</button></div>
      </form>
    </dialog>`;

  const dialogue = vue.querySelector('dialog:not(.import)');
  const dialogueImport = vue.querySelector('dialog.import');
  vue.querySelector('[data-importer]').addEventListener('click', () => dialogueImport.showModal());
  vue.querySelector('[data-annuler-import]').addEventListener('click', () => dialogueImport.close());
  dialogueImport.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const etat = dialogueImport.querySelector('[data-etat-import]');
    const bouton = dialogueImport.querySelector('button[value=ok]');
    const lire = async (champ) => { const f = dialogueImport.querySelector(champ).files[0]; return f ? { nom: f.name, texte: decoder(new Uint8Array(await f.arrayBuffer())) } : null; };
    bouton.disabled = true;
    etat.innerHTML = '<p class="message info">Lecture et contrôle du fichier…</p>';
    try {
      const n = await lire('#i-n'); const n1 = await lire('#i-n1');
      if (!n) throw new Error("Choisissez le fichier de l'exercice N.");
      const dossier = await importerDossier({ nom: dialogueImport.querySelector('#i-nom').value.trim(), secteur: dialogueImport.querySelector('#i-secteur').value, taille: dialogueImport.querySelector('#i-taille').value,
        referentiel: parametres.referentiel, fichiers: { N: n.texte, N1: n1?.texte || null }, nomsFichiers: [n.nom, n1?.nom].filter(Boolean) });
      dialogueImport.close();
      location.hash = `#/dossier/${dossier.id}`;
    } catch (err) {
      etat.innerHTML = `<p class="message erreur" style="white-space:pre-wrap">${echapper(err.message)}</p>`;
      bouton.disabled = false;
    }
  });
  vue.querySelector('[data-nouveau]').addEventListener('click', () => dialogue.showModal());
  vue.querySelector('[data-annuler]').addEventListener('click', () => dialogue.close());
  dialogue.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = (id) => vue.querySelector('#' + id).value;
    const dossier = await creerDossier({
      secteur: v('n-secteur'), taille: v('n-taille'), difficulte: v('n-difficulte'),
      nbAnomalies: Number(v('n-anomalies')), referentiel: parametres.referentiel, extraitRapport: v('n-extrait').trim(),
      modeGeneration: e.submitter?.value === 'ia' ? 'ia' : 'local',
    });
    dialogue.close();
    location.hash = `#/dossier/${dossier.id}`;
  });
  vue.querySelectorAll('[data-supprimer]').forEach((b) => b.addEventListener('click', async () => {
    const d = dossiers.find((x) => x.id === b.dataset.supprimer);
    if (!confirm(`Supprimer définitivement le dossier « ${d.client.nom} » et toutes ses données ?`)) return;
    await db.supprimerDossier(d.id);
    afficherTableauDeBord(vue);
  }));
}

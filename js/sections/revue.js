// F1 — Revue du manager. Le manager (IA si une clé est enregistrée, sinon règles intégrées) relit le
// dossier et laisse des points de revue ; chaque point doit recevoir une réponse avant la clôture.
// Le manager ne connaît pas le corrigé : il juge la qualité du dossier, pas les anomalies cachées.
import { CYCLES, REFERENTIELS } from '../config.js';
import { CONFIGS_CYCLES } from '../cycles/index.js';
import { lireParametres } from '../db.js';
import { demanderJSON } from '../groq.js';
import { listerFeuilles } from '../feuilles.js';
import { echapper, dateFr, identifiant } from '../utils.js';

const rempli = (t, min = 1) => typeof t === 'string' && t.trim().length >= min;
const don = (dossier, code) => dossier.elements?.[code]?.donnees || {};

/** Points de revue issus de règles de qualité du dossier. */
export function pointsLocaux(dossier, feuilles) {
  const points = [];
  const p = (ref, texte) => points.push({ ref, texte });
  for (const f of feuilles) {
    if (!rempli(f.conclusion, 15)) p(f.ref, 'Conclusion non étayée : la feuille doit conclure sur l\'assertion testée et renvoyer aux ajustements éventuels.');
    else if (!rempli(f.travail, 60)) p(f.ref, 'Travail effectué insuffisamment décrit : précisez la population, la taille et la méthode de l\'échantillon, les pièces examinées.');
    if (!f.elements.length) p(f.ref, 'Échantillon ou pièces non documentés : joignez les lignes contrôlées ou les pièces obtenues.');
    if (!f.refsCroisees.length) p(f.ref, 'Référence croisée manquante (programme, matrice des risques, tableau des ajustements).');
  }
  const b4 = don(dossier, 'B4');
  for (const c of Object.values(CONFIGS_CYCLES)) {
    const risque = Array.from({ length: 6 }, (_, i) => b4[`${c.id}_${i}`]).some((v) => v === 'eleve');
    if (risque && !feuilles.some((f) => f.cycle === c.id)) p(c.code, `Risque élevé identifié en B4 sur le cycle ${CYCLES[c.id].toLowerCase()}, mais aucune feuille de travail ne documente la réponse à ce risque.`);
    const prog = don(dossier, c.code).programme || [];
    if (feuilles.some((f) => f.cycle === c.id) && prog.filter((x) => x.statut).length < c.programme.length) p(c.code, 'Programme de travail incomplet : chaque procédure doit être réalisée, adaptée ou écartée avec justification.');
  }
  for (const [code, type] of [['D2', 'clients'], ['D3', 'fournisseurs']]) {
    const circ = don(dossier, code).circularisation;
    if (!circ?.reponses) p(code, `Circularisation des ${type} non réalisée ou non exploitée : elle est attendue sur ce dossier (ISA 505), ou son absence doit être justifiée.`);
    else {
      const sansAnalyse = circ.reponses.filter((r) => r.reponse !== 'accord' && !rempli(circ.analyses?.[r.num], 10));
      if (sansAnalyse.length) p(code, `Circularisation des ${type} : ${sansAnalyse.length} désaccord(s) ou non-réponse(s) sans analyse ni procédure alternative (${sansAnalyse.map((r) => r.nom).slice(0, 4).join(', ')}).`);
    }
  }
  if (!rempli(don(dossier, 'C1').justification, 100)) p('C1', 'Justification des seuils insuffisante : expliquez le choix de la base et du taux au regard des utilisateurs des comptes et du risque.');
  if (!rempli(don(dossier, 'B3').conclusion, 30)) p('B3', 'Revue analytique sans conclusion : quelles zones de risque en ressortent et quels travaux en découlent ?');
  if (!rempli(don(dossier, 'B4').fraude, 30)) p('B4', 'Risque de fraude non analysé (ISA 240) : facteurs de risque, contournement des contrôles par la direction, tests sur les écritures.');
  for (const a of dossier.ajustements || []) {
    if (!a.feuille) p('E1', `Ajustement « ${a.description.slice(0, 60)} » sans renvoi à une feuille de travail.`);
  }
  if ((dossier.ajustements || []).some((a) => !a.presente)) p('E1', 'Des ajustements n\'ont pas été présentés à la direction : sa position est nécessaire pour conclure.');
  if (!don(dossier, 'G4').opinion) p('G4', "Opinion non encore formulée : elle doit s'appuyer sur le cumul des anomalies non corrigées comparé au seuil de signification.");
  return points;
}

function resume(dossier, feuilles) {
  const lignes = feuilles.slice(0, 25).map((f) => `${f.ref} « ${f.titre || 'sans titre'} » — objectif : ${f.objectif.slice(0, 150) || '(vide)'} — travail : ${f.travail.slice(0, 250) || '(vide)'} — conclusion : ${f.conclusion.slice(0, 150) || '(vide)'} — ${f.elements.length} élément(s) joint(s), références : ${f.refsCroisees.join(', ') || 'aucune'}`);
  const aj = (dossier.ajustements || []).map((a) => `« ${a.description.slice(0, 120)} » (feuille ${a.feuille || 'aucune'}, ${a.decision})`);
  const t = (code, cle) => String(don(dossier, code)[cle] || '').slice(0, 400) || '(vide)';
  return `Seuils (C1) : signification ${t('C1', 'signification')}, planification ${t('C1', 'planification')} — justification : ${t('C1', 'justification')}
Risques identifiés (B1) : ${t('B1', 'risques')}
Risque de fraude (B4) : ${t('B4', 'fraude')}
Conclusion de la revue analytique (B3) : ${t('B3', 'conclusion')}
Feuilles de travail :
${lignes.join('\n') || '(aucune)'}
Ajustements proposés : ${aj.join(' ; ') || 'aucun'}
Note de synthèse (G3) : ${t('G3', 'conclusion')}
Opinion envisagée (G4) : ${t('G4', 'opinion')} — ${t('G4', 'justification')}`;
}

async function pointsIA(dossier, feuilles, parametres) {
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  const r = await demanderJSON({
    cle: parametres.cleGroq, modele: parametres.modele, temperature: 0.4, maxTokens: 1500,
    systeme: `Tu es manager dans un cabinet de commissariat aux comptes. Tu relis le dossier de travail d'un collaborateur junior (normes ${N}) et tu laisses des points de revue précis, courts et actionnables, comme dans un logiciel d'audit. Tu ne connais pas les anomalies réelles du dossier et tu n'en inventes pas : tu juges la qualité de la documentation, la cohérence entre risques, travaux et conclusions, et la suffisance des éléments probants. Tu réponds uniquement par un objet JSON valide, en français.`,
    utilisateur: `Client : ${dossier.client.nom} (${dossier.client.secteur}). Contexte : ${dossier.client.contexteMission}

${resume(dossier, feuilles)}

Laisse entre 4 et 10 points de revue. Chaque point vise un élément précis du dossier par sa référence (ex. « D1-2 », « C1 », « B4 », « E1 », « G4 ») et formule une demande concrète (« conclusion non étayée », « échantillon insuffisant », « référence croisée manquante », « procédure alternative non documentée »…).
Réponds : { "points": [ { "ref": "D1-2", "texte": "…" } ] }`,
  });
  const points = (Array.isArray(r.points) ? r.points : []).map((x) => ({ ref: String(x?.ref || '').slice(0, 12), texte: String(x?.texte || '').trim().slice(0, 500) })).filter((x) => x.texte);
  if (!points.length) throw new Error("Réponse de l'IA vide.");
  return points;
}

/** Lien vers l'élément visé par un point (feuille D2-3 → cycle D2). */
const lienRef = (dossier, ref) => { const code = (ref.match(/^[A-HX]\d/) || [])[0]; return code ? `<a href="#/dossier/${dossier.id}/${code}" class="code">${echapper(ref)}</a>` : `<span class="code">${echapper(ref)}</span>`; };

export async function afficherRevue(zone, { dossier, donnees, modifie, sauver, lectureSeule }) {
  donnees.revues ??= [];
  donnees.points ??= [];
  const dessiner = (message = '') => {
    const ouverts = donnees.points.filter((x) => !rempli(x.reponse, 5)).length;
    zone.innerHTML = `
      <div class="panneau">
        <p>Le manager relit votre dossier et laisse des points de revue. Répondez à chacun (correction apportée, justification, ou explication de votre position) : <strong>la mission ne peut être clôturée que si une revue a eu lieu et que tous les points ont reçu une réponse.</strong></p>
        <div class="indicateurs">
          <div class="indicateur"><span>Revues</span><strong>${donnees.revues.length}</strong></div>
          <div class="indicateur"><span>Points de revue</span><strong>${donnees.points.length}</strong></div>
          <div class="indicateur"><span>Sans réponse</span><strong>${ouverts}</strong></div>
        </div>
        <button type="button" class="principal" data-revue ${lectureSeule ? 'disabled' : ''}>${donnees.revues.length ? 'Demander une nouvelle revue' : 'Demander une revue au manager'}</button>
        <span data-etat class="discret">${echapper(message)}</span>
        ${donnees.revues.length ? `<p class="discret">Revues : ${donnees.revues.map((r) => `${dateFr(r.date.slice(0, 10))} (${r.source === 'ia' ? 'IA' : 'règles intégrées'}, ${r.nouveaux} nouveau(x) point(s))`).join(' · ')}</p>` : ''}
      </div>
      <div class="panneau serre"><div class="defilement"><table class="dense">
        <thead><tr><th>Réf.</th><th>Point de revue</th><th>Votre réponse</th><th>Statut</th></tr></thead>
        <tbody>${donnees.points.map((x) => `<tr><td>${lienRef(dossier, x.ref)}</td><td>${echapper(x.texte)}</td>
          <td class="reponse"><textarea rows="2" data-point="${x.id}" aria-label="Réponse au point">${echapper(x.reponse)}</textarea></td>
          <td data-statut-point="${x.id}">${rempli(x.reponse, 5) ? '<span class="pastille vert">Répondu</span>' : '<span class="pastille orange">Ouvert</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="vide">Aucun point de revue pour l\'instant.</td></tr>'}</tbody>
      </table></div></div>`;
    zone.querySelectorAll('[data-point]').forEach((t) => t.addEventListener('input', () => {
      const x = donnees.points.find((p) => p.id === t.dataset.point);
      x.reponse = t.value;
      zone.querySelector(`[data-statut-point="${x.id}"]`).innerHTML = rempli(x.reponse, 5) ? '<span class="pastille vert">Répondu</span>' : '<span class="pastille orange">Ouvert</span>';
      modifie();
    }));
    zone.querySelector('[data-revue]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      zone.querySelector('[data-etat]').textContent = 'Le manager relit le dossier…';
      const feuilles = await listerFeuilles(dossier.id);
      const parametres = await lireParametres();
      let points = null; let source = 'local'; let note = '';
      if (parametres.cleGroq) {
        try { points = await pointsIA(dossier, feuilles, parametres); source = 'ia'; }
        catch (err) { note = ` (IA indisponible : ${err.message} Règles intégrées utilisées.)`; }
      }
      points ??= pointsLocaux(dossier, feuilles);
      const existants = new Set(donnees.points.map((x) => `${x.ref}|${x.texte}`));
      const nouveaux = points.filter((x) => !existants.has(`${x.ref}|${x.texte}`)).map((x) => ({ id: identifiant(), ...x, reponse: '', source, date: new Date().toISOString() }));
      donnees.points.push(...nouveaux);
      donnees.revues.push({ date: new Date().toISOString(), source, nouveaux: nouveaux.length });
      modifie(); await sauver();
      dessiner(`${nouveaux.length ? `${nouveaux.length} nouveau(x) point(s) de revue.` : 'Aucun nouveau point : le manager n\'a rien à ajouter.'}${note}`);
    });
  };
  dessiner();
}

/** Conditions de clôture liées à la revue. */
export function revueSoldee(dossier) {
  const d = don(dossier, 'F1');
  return (d.revues || []).length > 0 && (d.points || []).every((x) => rempli(x.reponse, 5));
}

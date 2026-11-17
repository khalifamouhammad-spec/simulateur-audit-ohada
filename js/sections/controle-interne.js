// B2 — Questionnaires de contrôle interne par cycle.
// Les réponses du client sont simulées : par l'IA si une clé est enregistrée, sinon par le
// modèle intégré. Dans les deux cas elles sont cohérentes avec les anomalies cachées du dossier
// (les cycles fragiles laissent transparaître des faiblesses) sans jamais les révéler.
import { CYCLES, NIVEAUX_RISQUE, REFERENTIELS } from '../config.js';
import { db, lireParametres } from '../db.js';
import { demanderJSON } from '../groq.js';
import { lier, zoneTexte, liste } from './formulaire.js';
import { aleatoire, echapper } from '../utils.js';

// Pour chaque question : réponse d'un client bien organisé, puis réponse révélant une faiblesse.
const QUESTIONNAIRES = {
  tresorerie: [
    ['Qui établit les rapprochements bancaires, à quelle fréquence, et qui les revoit ?', "Le comptable les établit chaque mois, le responsable financier les vise et signe l'état.", "Le comptable les fait quand il a le temps, en général à la clôture. Personne ne les revoit, il s'en occupe depuis toujours."],
    ['Les personnes qui préparent les paiements sont-elles différentes de celles qui les valident ?', "Oui : le comptable prépare les virements, le dirigeant les valide dans la banque en ligne avec son propre code.", "Le comptable a les codes de la banque en ligne et lance lui-même les virements. Le dirigeant regarde les relevés de temps en temps."],
    ['Existe-t-il un seuil de double signature ? Est-il respecté ?', "Oui, au-delà du seuil deux signatures sont exigées par la banque, sans exception.", "Il y a un seuil, mais pour aller plus vite il arrive qu'on découpe un paiement en plusieurs virements."],
    ['Comment sont suivis les chèques émis non encaissés et les suspens anciens ?', "Les suspens de plus de deux mois sont analysés chaque trimestre et régularisés.", "On ne s'en occupe pas vraiment, certains traînent depuis longtemps sur le rapprochement."],
    ['Qui peut créer ou modifier un RIB de fournisseur ?', "Seul le responsable financier, après contre-appel du fournisseur ; les modifications sont tracées.", "N'importe quel utilisateur de la comptabilité peut le faire, sur simple courriel du fournisseur."],
  ],
  ventes: [
    ['Comment une facture de vente est-elle déclenchée ?', "Elle est émise à partir du bon de livraison signé ou du procès-verbal de réception.", "Le commercial demande la facture dès que la commande est signée, la livraison suit plus ou moins vite."],
    ["Comment vous assurez-vous de la séparation des exercices en fin d'année ?", "Les dernières livraisons sont rapprochées des factures et une liste des factures à établir est dressée.", "On facture le plus possible avant le 31 décembre pour tenir l'objectif, on ne regarde pas les dates de livraison."],
    ['Qui autorise les avoirs et les remises ?', "Tout avoir est validé par le directeur commercial puis contrôlé par la comptabilité.", "Les commerciaux font leurs avoirs eux-mêmes, souvent en début d'année suivante."],
    ['Comment sont suivies les créances échues et décidées les dépréciations ?', "Une balance âgée est éditée chaque mois, les retards sont relancés et une revue des dépréciations a lieu à chaque clôture.", "On relance quand on y pense. On ne déprécie pas tant que le client n'a pas officiellement déposé le bilan."],
    ["Qui peut créer un nouveau client dans le système ?", "L'administration des ventes, après vérification de la solvabilité et de l'existence du client.", "Tous les utilisateurs ont le droit de créer un client, il n'y a pas de contrôle particulier."],
  ],
  achats: [
    ['Les achats font-ils l\'objet d\'un bon de commande approuvé ?', "Oui, tout achat supérieur à un petit montant passe par un bon de commande validé par le responsable du budget.", "Pas systématiquement. Pour les prestations de conseil ou les urgences, on règle sur simple demande du dirigeant."],
    ['Comment une facture fournisseur est-elle validée avant paiement ?', "Rapprochement commande, réception et facture, puis bon à payer signé.", "La comptabilité paie à réception de la facture si le fournisseur est connu."],
    ['Comment évitez-vous de payer deux fois une même facture ?', "Le logiciel bloque les numéros de facture en double et les paiements se font uniquement sur original.", "Il n'y a pas de blocage, on paie parfois sur relance ou sur copie."],
    ['Comment recensez-vous les factures non parvenues à la clôture ?', "À partir des bons de réception non facturés et d'une revue des factures reçues en janvier.", "On reprend à peu près les mêmes provisions que l'an dernier, on n'a pas le temps de tout pointer."],
    ['Qui peut créer un fournisseur dans le système ?', "Le service achats, avec extrait du registre du commerce (RCCM), NINEA et RIB vérifiés ; la comptabilité n'a pas ce droit.", "La comptabilité crée les fournisseurs au fil de l'eau, y compris ceux demandés par la direction."],
  ],
  stocks: [
    ['Un inventaire physique complet est-il réalisé à la clôture ? Selon quelle procédure ?', "Oui, avec instructions écrites, équipes de deux et double comptage par sondage.", "Oui, mais par les magasiniers seuls, sans procédure écrite ni recomptage."],
    ['Comment les écarts entre inventaire physique et stock comptable sont-ils traités ?', "Ils sont analysés, validés par la direction puis comptabilisés.", "Les gros écarts sont regardés, mais ils ne sont pas toujours passés en comptabilité."],
    ['Comment le stock est-il valorisé ?', "Au coût d'achat moyen pondéré, calculé par le logiciel et contrôlé par sondage sur les dernières factures.", "Sur un tableur tenu par le responsable, avec les derniers prix connus mis à jour à la main."],
    ['Comment identifiez-vous les articles à rotation lente ou obsolètes ?', "Un état des articles sans mouvement depuis six mois est édité et sert de base aux dépréciations.", "Il n'y a pas d'état de rotation. On ne déprécie pas, on finit toujours par vendre."],
    ['Qui a accès physiquement au stock ?', "L'accès est réservé aux magasiniers, les sorties sont saisies au fil de l'eau.", "Tout le personnel circule dans le dépôt, les sorties sont régularisées en fin de mois."],
  ],
  immobilisations: [
    ['Quels critères distinguent une immobilisation d\'une charge ?', "Une note interne fixe le seuil et les critères ; la comptabilité revoit chaque facture d'investissement.", "C'est le dirigeant qui décide, souvent en fonction du résultat qu'il veut afficher."],
    ['Un fichier des immobilisations est-il tenu et rapproché de la comptabilité ?', "Oui, il est rapproché de la comptabilité à chaque clôture.", "Il existe un tableur, mais il n'a pas été rapproché depuis le départ de l'ancienne comptable."],
    ['Comment les dotations aux amortissements sont-elles calculées ?', "Par le logiciel d'immobilisations, avec un contrôle de vraisemblance par catégorie.", "À la main en fin d'année, par catégorie ; il est possible qu'une catégorie soit oubliée."],
    ['Comment les cessions et mises au rebut sont-elles communiquées à la comptabilité ?', "Par une fiche de sortie signée, avec la facture de cession.", "La comptabilité l'apprend quand elle voit passer l'encaissement, et encore."],
    ['Un inventaire physique des immobilisations est-il réalisé ?', "Oui, tous les deux ans, avec rapprochement du fichier.", "Jamais."],
  ],
  personnel: [
    ['Qui établit la paie et qui la contrôle ?', "Le gestionnaire de paie l'établit, le responsable financier contrôle les variations du mois avant virement.", "Une seule personne s'occupe de tout, de la saisie des variables au virement."],
    ['Comment les entrées, sorties et augmentations sont-elles autorisées ?', "Par un document signé de la direction, conservé au dossier du salarié.", "Par un simple appel du dirigeant au service paie."],
    ['Comment la provision pour congés payés est-elle calculée ?', "À partir de l'état des droits édité par le logiciel de paie, charges sociales comprises.", "On reprend un montant forfaitaire, proche de celui de l'an dernier."],
    ['Les charges sociales sont-elles rapprochées des déclarations ?', "Oui, chaque mois avec les déclarations à l'IPRES et à la CSS, et à la clôture avec le récapitulatif annuel.", "Elles sont comptabilisées au moment du paiement, on ne fait pas de rapprochement particulier."],
    ['Le journal de paie est-il rapproché de la comptabilité ?', "Oui, tous les mois.", "Non, l'écriture est saisie à la main à partir des bulletins."],
  ],
  fiscal: [
    ['Qui établit les déclarations de TVA et comment sont-elles contrôlées ?', "Le comptable les prépare, le responsable financier les revoit, un contrôle de cohérence avec le chiffre d'affaires est fait chaque trimestre.", "Le comptable les fait seul à partir des soldes des comptes, sans contrôle de cohérence."],
    ['Comment le taux de TVA d\'une facture de vente est-il déterminé ?', "Il est paramétré par article et par client dans le logiciel, sans modification possible à la saisie.", "L'utilisateur le choisit à la saisie de la facture."],
    ['Qui calcule l\'impôt sur les sociétés ?', "L'expert-comptable, avec une revue par la direction financière.", "Le comptable applique le taux de l'an dernier au résultat."],
    ['Avez-vous fait l\'objet d\'un contrôle fiscal ou d\'une demande de l\'administration ?', "Non, aucun contrôle ni demande en cours.", "Nous avons reçu une demande de renseignements sur la TVA, nous n'avons pas encore répondu."],
    ['Les taxes et déclarations annuelles sont-elles suivies par un échéancier ?', "Oui, un échéancier fiscal est tenu et revu chaque mois.", "On attend les relances de l'administration."],
  ],
  capitaux: [
    ['Les décisions d\'assemblée (affectation du résultat, dividendes) sont-elles traduites en comptabilité sur la base des procès-verbaux ?', "Oui, l'écriture est passée au vu du procès-verbal signé.", "L'écriture est passée par habitude, les procès-verbaux sont rédigés plus tard par l'avocat."],
    ['Comment les litiges et risques sont-ils recensés pour les provisions ?', "Une revue est faite à chaque clôture avec la direction et les avocats.", "Le dirigeant n'aime pas provisionner tant que rien n'est jugé."],
    ['Les comptes courants d\'associés font-ils l\'objet de conventions ?', "Oui, avec taux d'intérêt et modalités de remboursement.", "Non, les mouvements se font selon les besoins."],
    ['Les emprunts sont-ils rapprochés des tableaux d\'amortissement ?', "Oui, à chaque clôture.", "Pas systématiquement."],
    ['Existe-t-il des engagements hors bilan (cautions, crédit-bail, garanties) et comment sont-ils suivis ?', "Ils sont recensés dans un registre mis à jour à chaque clôture.", "Il n'y a pas de recensement formalisé."],
  ],
};

/** Réponses du modèle intégré : faiblesses dans les cycles porteurs d'anomalies, quelques-unes ailleurs. */
function reponsesLocales(cycle, fragile, graine) {
  const rnd = aleatoire(graine);
  const questions = QUESTIONNAIRES[cycle];
  const faibles = new Set(rnd.melanger(questions.map((_, i) => i)).slice(0, fragile ? rnd.entier(2, 3) : rnd() < 0.3 ? 1 : 0));
  return questions.map(([, correcte, faible], i) => (faibles.has(i) ? faible : correcte));
}

async function reponsesIA(cycle, dossier, anomalies, parametres) {
  const questions = QUESTIONNAIRES[cycle];
  const c = dossier.client;
  const systeme = "Tu joues le rôle du responsable comptable d'une entreprise interrogé par son commissaire aux comptes sur le contrôle interne. Tu réponds à l'oral, de façon naturelle, concrète et brève (1 à 3 phrases par réponse), en français. Tu réponds uniquement par un objet JSON valide.";
  const utilisateur = `Entreprise : ${c.nom} (${c.formeJuridique}, ${c.secteur}, ${c.effectif} salariés).
Activité : ${c.activite}
Organisation : ${c.organisation}
Système d'information : ${c.systemeInformation}
Contexte : ${c.contexteMission}

Cycle interrogé : ${CYCLES[cycle]}.
${anomalies.length
    ? `Réalité cachée (à NE JAMAIS révéler ni citer) : ce cycle comporte les problèmes suivants : ${anomalies.map((a) => a.libelle).join(' ; ')}. Tes réponses doivent laisser transparaître, sur 2 ou 3 questions, les faiblesses d'organisation qui rendent ces problèmes possibles (absence de contrôle, de séparation des fonctions, de procédure), sans mentionner d'erreur, de montant ni d'anomalie. Les autres réponses décrivent un fonctionnement correct.`
    : "Ce cycle fonctionne correctement : tes réponses décrivent des contrôles raisonnables pour une entreprise de cette taille, avec éventuellement une petite imperfection sans gravité."}

Questions :
${questions.map(([q], i) => `${i + 1}. ${q}`).join('\n')}

Réponds avec ce JSON : { "reponses": ["réponse à la question 1", "...", "réponse à la question ${questions.length}"] }`;
  const r = await demanderJSON({ cle: parametres.cleGroq, modele: parametres.modele, systeme, utilisateur, temperature: 0.7, maxTokens: 1200 });
  const reponses = Array.isArray(r.reponses) ? r.reponses.map((x) => String(x || '').trim()).filter(Boolean) : [];
  if (reponses.length !== questions.length) throw new Error("Réponse de l'IA incomplète.");
  return reponses.map((x) => x.slice(0, 600));
}

export async function afficherControleInterne(zone, { dossier, donnees, modifie, sauver, lectureSeule }) {
  donnees.cycles ??= {};
  let cycle = Object.keys(CYCLES)[0];
  const N = REFERENTIELS[dossier.parametres.referentiel].normes;
  zone.innerHTML = `
    <div class="panneau">
      <p>Pour chaque cycle, interrogez le client puis appréciez ses réponses (${N} 315). Vos conclusions alimentent la matrice des risques (B4) et orientent l'étendue des contrôles de substance (${N} 330).</p>
      <p data-bilan class="discret"></p>
    </div>
    <div class="onglets" role="tablist"></div>
    <div data-cycle></div>`;

  const bilan = () => {
    const faits = Object.keys(CYCLES).filter((c) => donnees.cycles[c]?.risque).length;
    zone.querySelector('[data-bilan]').textContent = `${faits} cycle(s) conclu(s) sur ${Object.keys(CYCLES).length}.`;
    zone.querySelector('.onglets').innerHTML = Object.entries(CYCLES).map(([id, lib]) => {
      const d = donnees.cycles[id];
      return `<button type="button" role="tab" data-onglet="${id}" class="${id === cycle ? 'actif' : ''}"><i class="point ${d?.risque ? 'vert' : d?.reponses ? 'bleu' : ''}"></i> ${echapper(lib)}</button>`;
    }).join('');
  };

  function dessiner() {
    const d = (donnees.cycles[cycle] ??= {});
    const questions = QUESTIONNAIRES[cycle];
    const corps = zone.querySelector('[data-cycle]');
    corps.innerHTML = `
      <div class="panneau serre">
        <div class="ligne espace" style="padding:.6rem .8rem 0"><h2>Questionnaire — ${echapper(CYCLES[cycle])}</h2>
          <button type="button" class="${d.reponses ? '' : 'principal'}" data-interroger ${lectureSeule ? 'disabled' : ''}>${d.reponses ? 'Réinterroger le client' : 'Interroger le client'}</button></div>
        <p class="discret" style="padding:0 .8rem" data-etat>${d.reponses ? `Réponses ${d.source === 'ia' ? "simulées par l'IA" : 'issues du modèle intégré (sans IA)'}.` : 'Les réponses du client apparaîtront ici.'}</p>
        <div class="defilement"><table class="dense">
          <thead><tr><th>N°</th><th>Question</th><th>Réponse du client</th><th>Votre appréciation</th><th>Commentaire</th></tr></thead>
          <tbody>${questions.map(([q], i) => `<tr><td>${i + 1}</td><td>${echapper(q)}</td><td class="reponse">${d.reponses ? echapper(d.reponses[i]) : '<span class="discret">—</span>'}</td>
            <td><select data-champ="a${i}" aria-label="Appréciation de la question ${i + 1}"><option value="">—</option><option value="satisfaisant">Satisfaisant</option><option value="faiblesse">Faiblesse</option><option value="a_tester">À tester</option></select></td>
            <td class="reponse"><input type="text" data-champ="c${i}" aria-label="Commentaire de la question ${i + 1}"></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
      <div class="panneau">
        <div class="grille">${liste('risque', 'Risque lié au contrôle interne pour ce cycle', NIVEAUX_RISQUE)}</div>
        ${zoneTexte('conclusion', 'Conclusion', "Faiblesses relevées, assertions concernées, incidence sur la nature et l'étendue de vos travaux. Les faiblesses significatives sont à communiquer à la direction (" + N + ' 265).')}
      </div>`;
    lier(corps, d, modifie, bilan);
    corps.querySelector('[data-interroger]').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      const etat = corps.querySelector('[data-etat]');
      etat.textContent = 'Le client répond…';
      const corrige = await db.lire('corriges', dossier.id);
      const anomalies = (corrige?.anomalies || []).filter((a) => a.cycle === cycle);
      const parametres = await lireParametres();
      let reponses = null; let source = 'local'; let note = '';
      if (parametres.cleGroq) {
        try { reponses = await reponsesIA(cycle, dossier, anomalies, parametres); source = 'ia'; }
        catch (e) { note = ` (IA indisponible : ${e.message} Réponses du modèle intégré.)`; }
      }
      reponses ??= reponsesLocales(cycle, anomalies.length > 0, (dossier.scenario.graine + cycle.length * 7919 + (d.essais || 0)) >>> 0);
      Object.assign(d, { reponses, source, essais: (d.essais || 0) + 1 });
      modifie();
      await sauver();
      dessiner();
      bilan();
      if (note) corps.querySelector('[data-etat]').textContent += note;
    });
  }

  zone.querySelector('.onglets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-onglet]');
    if (!b) return;
    cycle = b.dataset.onglet;
    dessiner();
    bilan();
  });
  dessiner();
  bilan();
}

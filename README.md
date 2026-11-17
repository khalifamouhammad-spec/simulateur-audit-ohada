# Simulateur d'audit

Simulateur de missions d'audit légal pour s'entraîner sur des cas réalistes.

Logiciel d'entraînement au commissariat aux comptes, inspiré des logiciels de cabinet (dossier, feuilles de travail, programmes, revue, rapport). Il génère un client fictif doté d'un vrai FEC, dans lequel sont cachées des anomalies tirées de cas fréquents en mission. On réalise la mission comme en cabinet, puis le logiciel corrige et note.

- Application : https://khalifamouhammad-spec.github.io/simulateur-audit/
- Premier simulateur (cycle trésorerie seul) : [`v1/`](v1/)

## Lancer l'application

En ligne : ouvrir l'adresse ci-dessus (GitHub Pages, aucune installation).

En local, depuis le dossier du projet :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000. Un double-clic sur `index.html` ne suffit pas (modules JavaScript).

**Clé Groq (facultative)** : menu Paramètres → coller une clé gratuite créée sur https://console.groq.com/keys → « Tester la connexion ». Elle reste dans le navigateur (IndexedDB), jamais dans le code. Sans clé, tout fonctionne avec les modèles intégrés : seuls les textes rédigés par l'IA (scénario du client, réponses au contrôle interne, désignations des factures, points de revue, commentaire de l'associé) sont remplacés par des versions intégrées.

## Déroulé d'une mission

1. **Tableau de bord → Nouveau dossier** : secteur, taille (TPE / PME / ETI), difficulté, nombre d'anomalies, et en option un extrait de rapport réel servant de modèle. Le logiciel génère le client et ses FEC N-1 et N.
2. **FEC** (X1 à X3) : consultation filtrée et export `.txt` réglementaire, balance, bilan et compte de résultat N / N-1 avec contrôles de cohérence.
3. **Planification** : A1 fiche client et acceptation, A2 indépendance, A3 lettre de mission, B1 fiche entreprise, B2 questionnaires de contrôle interne (réponses du client simulées), B3 revue analytique automatique à commenter, B4 matrice des risques, C1 seuils.
4. **Cycles** D1 à D8 (trésorerie, ventes, achats, stocks, immobilisations, personnel, fiscal, capitaux propres) : programme de travail, feuilles de travail codifiées, grand livre et sondages, outils du cycle, pièces justificatives.
5. **E1 Ajustements** : chaque anomalie avec son écriture de correction (équilibre contrôlé), puis présentation à la direction, qui accepte ou refuse.
6. **F1 Revue du manager** : points de revue à solder (obligatoire avant clôture).
7. **G Finalisation** : événements postérieurs, lettre d'affirmation, note de synthèse, rapport et opinion (obligatoire avant clôture).
8. **H1 Clôture et corrigé** : anomalies trouvées, ratées et fausses alertes, notes sur 20 par section et note globale, commentaire de l'associé. **Historique** : notes et points faibles.

Une anomalie n'est « trouvée » que si un ajustement de E1 renvoie à ses lignes (écritures, lignes bancaires, documents des outils, réponses de circularisation) ou, à défaut, en reprend le montant.

## Outils disponibles

| Où | Outils |
| --- | --- |
| Tous les cycles | Grand livre filtrable, sondages (aléatoire, unités monétaires, montants élevés), pièces justificatives, tests sur le FEC (week-end, montants ronds, paiements sous le seuil, doublons, utilisateurs peu fréquents, fin d'exercice, compte d'attente, décaissements directs en charges) |
| D1 Trésorerie | Relevés bancaires N et janvier N+1, état de rapprochement du client, confirmation bancaire |
| D2 Ventes | Balance âgée, lettrage, circularisation clients, avoirs postérieurs, annonces légales |
| D3 Achats | Balance âgée, lettrage, circularisation fournisseurs, factures reçues après la clôture |
| D4 à D8 | Inventaire, tableau des immobilisations, récapitulatif de paie, cohérence CA / TVA, variation des capitaux propres |

## Notation

| Section | Poids |
| --- | --- |
| Détection des anomalies et ajustements (E1) | 35 % |
| Travaux sur les cycles qui comportaient des anomalies (D) | 20 % |
| Planification (A, B) | 15 % |
| Seuils (C1) | 10 % |
| Revue, finalisation et opinion (F, G) | 20 % |

Les notes sont calculées par le logiciel ; l'IA ne rédige que les commentaires. L'opinion est jugée deux fois : cohérence avec vos propres constats, et adéquation à la situation réelle (anomalies non détectées comprises). Règle : cumul des anomalies non corrigées inférieur au seuil → sans réserve ; significatif → réserve ; plus de cinq fois le seuil → refus de certifier.

## Qui fait quoi

- **L'IA** (facultative) rédige le scénario, les réponses du client au contrôle interne, les désignations des factures, les points de revue et le commentaire de correction. Elle ne fournit aucun chiffre.
- **Le code** génère le FEC de façon déterministe, injecte les anomalies, contrôle l'équilibre de chaque écriture et calcule tous les états, documents bancaires, réponses de circularisation, événements postérieurs et notes.
- **Le corrigé** est stocké à part et n'est lu qu'après la clôture.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `js/app.js` | Routage (`#/`, `#/historique`, `#/parametres`, `#/dossier/<id>/<code>`) |
| `js/config.js` | Référentiels, secteurs, tailles, statuts, arborescence du dossier |
| `js/db.js` | IndexedDB (dossiers, FEC, corrigés, feuilles, documents, paramètres) |
| `js/dossiers.js`, `js/feuilles.js` | Dossiers, feuilles de travail, pièces |
| `js/generation.js` | Scénario + génération + contrôles + enregistrement |
| `js/correction.js` | Notation, rapprochement avec le corrigé, opinion attendue, commentaire IA |
| `js/moteur/` | Plan de comptes, générateur de FEC, bibliothèque d'anomalies, états, export, revue analytique, banque, pièces, échantillonnage, circularisation, tests sur le FEC, événements postérieurs |
| `js/cycles/` | Configuration des 8 cycles (comptes, programme, outils) |
| `js/sections/` | Écrans du dossier : données, planification, contrôle interne, revue analytique, cycles et outils, ajustements, revue, finalisation, correction |
| `js/ui/` | Tableau de bord, dossier (bandeau + arborescence), historique, paramètres |

## Tests

```bash
node tests/test-fec.mjs
node tests/test-analytique.mjs
node tests/test-banque.mjs
node tests/test-correction.mjs
node tests/test-outils.mjs
node tests/test-finalisation.mjs
```

Ils génèrent des centaines de clients (tous secteurs, tailles et difficultés) et contrôlent : écritures équilibrées, numérotation, lettrage, bilan équilibré, résultat identique au bilan et au compte de résultat, à-nouveaux de N égaux à la clôture de N-1, export réglementaire, rapprochement bancaire, pièces, sondages, atteignabilité de chaque anomalie, circularisation, tests sur le FEC, notation et opinion.

## Référentiel

Plan comptable général et normes NEP. SYSCOHADA révisé / ISA est prévu dans les paramètres mais pas encore implémenté.

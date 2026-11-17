# Simulateur d'audit OHADA

Simulateur de missions d'audit légal pour s'entraîner sur des cas réalistes — version **SYSCOHADA révisé / normes ISA / Sénégal**.

Logiciel d'entraînement au commissariat aux comptes en zone OHADA, inspiré des logiciels de cabinet (dossier, feuilles de travail, programmes, revue, rapport). Il génère une entreprise sénégalaise fictive avec sa comptabilité complète (journal général N et N-1 en francs CFA), dans laquelle sont cachées des anomalies tirées de cas fréquents en mission. On réalise la mission comme en cabinet, puis le logiciel corrige et note.

- Application : https://khalifamouhammad-spec.github.io/simulateur-audit-ohada/
- Version française (PCG / NEP) : https://khalifamouhammad-spec.github.io/simulateur-audit/

## Lancer l'application

En ligne : ouvrir l'adresse ci-dessus (GitHub Pages, aucune installation).

En local, depuis le dossier du projet :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000.

**Clé Groq (facultative)** : menu Paramètres → coller une clé gratuite créée sur https://console.groq.com/keys → « Tester la connexion ». Elle reste dans le navigateur, jamais dans le code. Sans clé, tout fonctionne avec des textes intégrés.

Les dossiers sont enregistrés dans le navigateur, dans une base distincte de celle de la version française.

## Cadre de référence

| Domaine | Ce qui est appliqué |
| --- | --- |
| Comptabilité | SYSCOHADA révisé : plan de comptes (521 Banques, 571 Caisse, 401, 411, 422, 431, 441, 443, 445, 447, 481…), bilan par rubriques (AI, BB, BI, BS, CA, CJ, DA, DJ, DK…), compte de résultat par postes (TA, RA, TC, RK, RS…) et soldes intermédiaires (XA à XI) |
| Audit | Normes ISA (210, 240, 250, 315, 320, 330, 450, 500, 505, 520, 540, 560, 580, 700, 705) ; Acte uniforme relatif au droit des sociétés commerciales et du GIE pour la mission et le rapport |
| Fiscalité (Sénégal) | TVA 18 % ; IS 30 % avec minimum forfaitaire (IMF) de 0,5 % du CA, entre 500 000 et 5 000 000 FCFA ; retenues sur salaires et CFCE (3 %) reversées à la DGID |
| Social (taux simplifiés) | Cotisations salariales IPRES et IPM 8 % ; retenues fiscales (IR, TRIMF) 10 % ; cotisations patronales IPRES, CSS et IPM 21 % |
| Monnaie | Francs CFA (XOF), montants entiers |

Les taux sociaux et fiscaux sont simplifiés pour l'entraînement : ils ne remplacent pas les textes en vigueur.

## Déroulé d'une mission

1. **Nouveau dossier** : secteur (commerce, BTP, hôtellerie-restauration, services, industrie et agro-industrie, transport et logistique), taille, difficulté, nombre d'anomalies.
2. **Données comptables** : journal des écritures N et N-1 (filtres, export CSV), balance, états financiers SYSCOHADA avec soldes intermédiaires.
3. **Planification** : acceptation, indépendance, lettre de mission, prise de connaissance, contrôle interne, revue analytique, matrice des risques, seuils.
4. **Cycles** D1 à D8 : programme de travail, feuilles de travail, grand livre, sondages, outils (rapprochement bancaire, procès-verbal de caisse, balance âgée, lettrage, circularisation, récapitulatif de paie et reversements DGID, cohérence TVA, tests sur les écritures…), pièces justificatives.
5. **E1 Ajustements**, présentés à la direction qui accepte ou refuse.
6. **F1 Revue du manager**, puis **G Finalisation** : événements postérieurs, lettre d'affirmation, note de synthèse, rapport et opinion (ISA 700 / 705).
7. **H1 Clôture et corrigé**, puis **Historique**.

## Anomalies

24 types, dont deux propres au contexte sénégalais : **manquant de caisse** non régularisé (procès-verbal de caisse) et **retenues sur salaires non reversées** à la DGID (pénalités non provisionnées). Les autres couvrent ventes, clients, achats, stocks, immobilisations, trésorerie, personnel, fiscalité (dont un IS calculé à l'ancien taux de 25 %) et fraude.

## Tests

```bash
node tests/test-fec.mjs
node tests/test-analytique.mjs
node tests/test-banque.mjs
node tests/test-correction.mjs
node tests/test-outils.mjs
node tests/test-finalisation.mjs
```

Ils génèrent des centaines d'entreprises et contrôlent : écritures équilibrées, montants entiers en FCFA, numérotation, lettrage, bilan équilibré, résultat identique au bilan, au compte de résultat et aux soldes intermédiaires, à-nouveaux, export, rapprochement bancaire, pièces, atteignabilité de chaque anomalie, circularisation, tests sur les écritures, notation et opinion.

## Architecture

Même architecture que la version française (`js/moteur/` pour les calculs, `js/sections/` pour les écrans du dossier, `js/cycles/` pour les cycles). Les spécificités OHADA sont concentrées dans `js/moteur/plan.js` (plan de comptes, taux, secteurs), `js/moteur/compta.js` (états SYSCOHADA), `js/moteur/anomalies.js`, `js/moteur/scenario.js` et les textes de `js/sections/planification.js` et `js/sections/finalisation.js`.

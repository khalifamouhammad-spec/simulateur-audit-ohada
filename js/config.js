// Constantes du logiciel : référentiels, paramètres de création, structure du dossier d'audit.

export const VERSION_APP = '1.0 OHADA';
export const PHASE_COURANTE = 7;
export const MODELE_GROQ_DEFAUT = 'llama-3.3-70b-versatile';
export const URL_GROQ = 'https://api.groq.com/openai/v1';

export const REFERENTIELS = {
  ohada: { id: 'ohada', libelle: 'SYSCOHADA révisé / normes ISA (Sénégal)', planComptable: 'SYSCOHADA révisé', normes: 'ISA', devise: 'XOF', disponible: true },
};

export const SECTEURS = {
  commerce: 'Commerce / négoce',
  btp: 'BTP',
  restauration: 'Hôtellerie-restauration',
  services: 'Services',
  industrie: 'Industrie / agro-industrie',
  transport: 'Transport et logistique',
};

// lignesFec : volume visé par exercice pour le générateur de FEC (phase 2).
export const TAILLES = {
  tpe: { id: 'tpe', libelle: 'TPE', description: 'moins de 10 salariés, CA < 1 milliard FCFA', lignesFec: 2000 },
  pme: { id: 'pme', libelle: 'PME', description: '10 à 250 salariés, CA 1 à 20 milliards FCFA', lignesFec: 5000 },
  eti: { id: 'eti', libelle: 'ETI', description: 'plus de 250 salariés', lignesFec: 9500 },
};

export const NIVEAUX = {
  debutant: { id: 'debutant', libelle: 'Débutant', description: 'anomalies visibles' },
  intermediaire: { id: 'intermediaire', libelle: 'Intermédiaire', description: 'anomalies variées' },
  confirme: { id: 'confirme', libelle: 'Confirmé', description: 'anomalies subtiles, fraude possible' },
};

// Statut d'un élément du dossier (pastilles).
export const STATUTS = {
  a_faire: { libelle: 'À faire', classe: 'gris' },
  en_cours: { libelle: 'En cours', classe: 'bleu' },
  a_revoir: { libelle: 'À revoir', classe: 'orange' },
  valide: { libelle: 'Validé', classe: 'vert' },
};

// Statut de la mission dans son ensemble.
export const STATUTS_MISSION = {
  en_cours: { libelle: 'En cours', classe: 'bleu' },
  en_revue: { libelle: 'En revue', classe: 'orange' },
  cloturee: { libelle: 'Clôturée', classe: 'vert' },
};

export const CYCLES = {
  tresorerie: 'Trésorerie',
  ventes: 'Ventes / clients',
  achats: 'Achats / fournisseurs',
  stocks: 'Stocks',
  immobilisations: 'Immobilisations',
  personnel: 'Personnel',
  fiscal: 'Fiscal',
  capitaux: 'Capitaux propres et provisions',
};

/**
 * Arborescence du dossier. Chaque élément : code, libellé, phase de développement à partir de
 * laquelle il est fonctionnel, description de son contenu. « suivi: false » exclut l'élément
 * du calcul d'avancement (données et correction).
 */
export const STRUCTURE_DOSSIER = [
  { code: 'X', libelle: 'Données comptables', suivi: false, elements: [
    { code: 'X1', libelle: 'Journal des écritures N et N-1', phase: 2, contenu: ['Consultation du journal général', 'Filtres par journal, compte, date, montant', 'Export .csv'] },
    { code: 'X2', libelle: 'Balance générale', phase: 2, contenu: ['Balance N et N-1 calculée à partir du journal', 'Contrôle d\'équilibre'] },
    { code: 'X3', libelle: 'États financiers SYSCOHADA', phase: 2, contenu: ['Bilan et compte de résultat N / N-1 avec soldes intermédiaires', 'Contrôle actif = passif et résultat identique au bilan et au compte de résultat'] },
  ] },
  { code: 'A', libelle: 'Acceptation et lettre de mission', elements: [
    { code: 'A1', libelle: 'Fiche client', phase: 3, contenu: ['Identité, activité, dirigeants, actionnariat'] },
    { code: 'A2', libelle: 'Questionnaire d\'indépendance', phase: 3, contenu: ['Incompatibilités, liens personnels et financiers, honoraires'] },
    { code: 'A3', libelle: 'Lettre de mission', phase: 3, contenu: ['Lettre préremplie à compléter (ISA 210)'] },
  ] },
  { code: 'B', libelle: 'Prise de connaissance et risques', elements: [
    { code: 'B1', libelle: 'Fiche entreprise', phase: 3, contenu: ['Activité, organisation, système d\'information'] },
    { code: 'B2', libelle: 'Contrôle interne', phase: 3, contenu: ['Questionnaires par cycle, réponses du client simulées par l\'IA'] },
    { code: 'B3', libelle: 'Revue analytique', phase: 3, contenu: ['Variations N / N-1 en montant et en %', 'Ratios', 'Commentaire de chaque variation significative'] },
    { code: 'B4', libelle: 'Matrice des risques', phase: 3, contenu: ['Risques par cycle et par assertion (exhaustivité, réalité, séparation des exercices, évaluation…)'] },
  ] },
  { code: 'C', libelle: 'Seuils', elements: [
    { code: 'C1', libelle: 'Seuils de signification', phase: 3, contenu: ['Seuil de signification, seuil de planification, seuil des anomalies manifestement insignifiantes', 'Choix de la base et justification (ISA 320)'] },
  ] },
  { code: 'D', libelle: 'Programmes de travail', elements: [
    { code: 'D1', libelle: 'Trésorerie', cycle: 'tresorerie', phase: 4 },
    { code: 'D2', libelle: 'Ventes / clients', cycle: 'ventes', phase: 6 },
    { code: 'D3', libelle: 'Achats / fournisseurs', cycle: 'achats', phase: 6 },
    { code: 'D4', libelle: 'Stocks', cycle: 'stocks', phase: 6 },
    { code: 'D5', libelle: 'Immobilisations', cycle: 'immobilisations', phase: 6 },
    { code: 'D6', libelle: 'Personnel', cycle: 'personnel', phase: 6 },
    { code: 'D7', libelle: 'Fiscal', cycle: 'fiscal', phase: 6 },
    { code: 'D8', libelle: 'Capitaux propres et provisions', cycle: 'capitaux', phase: 6 },
  ].map((e) => ({ ...e, contenu: ['Programme de travail : procédures à cocher, adapter ou marquer « non applicable »', 'Feuilles de travail codifiées (objectif, travail effectué, conclusion, références croisées)', 'Outils : journal filtré, grand livre, balance âgée, lettrage, échantillonnage, tests', 'Pièces justificatives générées à la demande'] })) },
  { code: 'E', libelle: 'Ajustements proposés', elements: [
    { code: 'E1', libelle: 'Tableau des ajustements', phase: 4, contenu: ['Anomalies relevées et écritures de correction', 'Impact sur le résultat et les capitaux propres', 'Cumul comparé au seuil, décision du client'] },
  ] },
  { code: 'F', libelle: 'Revue du manager', elements: [
    { code: 'F1', libelle: 'Points de revue', phase: 7, contenu: ['L\'IA relit les feuilles de travail et laisse des points de revue', 'Réponse obligatoire à chaque point avant la clôture'] },
  ] },
  { code: 'G', libelle: 'Finalisation', elements: [
    { code: 'G1', libelle: 'Événements postérieurs', phase: 7, contenu: ['Revue des événements postérieurs à la clôture (ISA 560)'] },
    { code: 'G2', libelle: 'Lettre d\'affirmation', phase: 7, contenu: ['Déclarations de la direction (ISA 580)'] },
    { code: 'G3', libelle: 'Note de synthèse', phase: 7, contenu: ['Synthèse de la mission et des points en suspens'] },
    { code: 'G4', libelle: 'Rapport sur les états financiers', phase: 7, contenu: ['Choix et justification de l\'opinion (ISA 700 et 705)'] },
  ] },
  { code: 'H', libelle: 'Correction', suivi: false, elements: [
    { code: 'H1', libelle: 'Corrigé de la mission', phase: 5, verrouille: true, contenu: ['Accessible uniquement après la clôture de la mission', 'Anomalies trouvées, ratées, fausses alertes', 'Note sur 20 par section et note globale'] },
  ] },
];

export const ELEMENTS = STRUCTURE_DOSSIER.flatMap((s) => s.elements.map((e) => ({ ...e, section: s.code, suivi: s.suivi !== false })));
export const trouverElement = (code) => ELEMENTS.find((e) => e.code === code);

// Noms provisoires utilisés tant que le scénario n'est pas rédigé par l'IA (phase 2).
export const NOMS_PROVISOIRES = {
  commerce: ['Comptoir Commercial du Cap-Vert', 'Négoce Sahel Distribution', 'Établissements Diop et Fils'],
  btp: ['Bâtiments et Travaux de la Petite Côte', 'Construction Ndiaye Frères', 'Génie Civil du Sine'],
  restauration: ['Hôtel Résidence Teranga', 'Restaurant Le Baobab Gourmand', 'Saveurs du Fleuve'],
  services: ['Conseil Numérique Sénégal', 'Sahel Services Ingénierie', 'Nettoyage Pro Dakar'],
  industrie: ['Huilerie du Saloum', 'Plastiques Industriels de Rufisque', 'Conserverie de la Côte'],
  transport: ['Transports Routiers du Sahel', 'Logistique Atlantique Express', 'Fret Sénégal Ouest'],
};
export const FORMES_PAR_TAILLE = { tpe: 'SARL', pme: 'SARL', eti: 'SA' };

export const ASSERTIONS = ['Exhaustivité', 'Réalité', 'Séparation des exercices', 'Évaluation', 'Droits et obligations', 'Présentation'];
export const NIVEAUX_RISQUE = { '': '—', faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé' };

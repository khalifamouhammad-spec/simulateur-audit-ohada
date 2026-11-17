// Plan de comptes utilisé par le générateur (SYSCOHADA révisé, comptes à 6 chiffres), journaux,
// colonnes du journal des écritures et paramètres économiques par secteur (Sénégal).

export const JOURNAUX = { AN: 'À-nouveaux', VE: 'Ventes', AC: 'Achats', BQ: 'Banque', CA: 'Caisse', PA: 'Paie', OD: 'Opérations diverses' };

// Colonnes d'une ligne d'écriture (structure inspirée des exports de journal général). Chaque ligne stockée
// contient en plus deux colonnes internes : l'utilisateur de saisie et la date de saisie.
export const COLONNES_FEC = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
  'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
/** Comptes de banque (y compris les sous-comptes d'un FEC importé). */
export const estBanque = (compte) => /^52/.test(String(compte));
export const COL = Object.fromEntries([...COLONNES_FEC, 'Utilisateur', 'DateSaisie'].map((nom, i) => [nom, i]));

// Plan comptable SYSCOHADA révisé (comptes à 6 chiffres).
export const PLAN = {
  101300: 'Capital souscrit, appelé, versé, non amorti', 118000: 'Autres réserves',
  121000: 'Report à nouveau créditeur', 129000: 'Report à nouveau débiteur',
  131000: 'Résultat net : bénéfice', 139000: 'Résultat net : perte', 162000: 'Emprunts et dettes auprès des établissements de crédit',
  234000: 'Aménagements, agencements et installations techniques', 241000: 'Matériel et outillage industriel et commercial', 244000: 'Matériel et mobilier de bureau', 245000: 'Matériel de transport',
  283400: 'Amortissements des aménagements et installations', 284100: 'Amortissements du matériel et outillage',
  284400: 'Amortissements du matériel et mobilier de bureau', 284500: 'Amortissements du matériel de transport',
  311000: 'Marchandises', 321000: 'Matières premières',
  401000: 'Fournisseurs, dettes en compte', 408100: 'Fournisseurs, factures non parvenues', 409000: 'Fournisseurs débiteurs', 411000: 'Clients',
  416000: 'Créances clients litigieuses ou douteuses', 419800: 'Clients, rabais, remises et avoirs à accorder',
  422000: 'Personnel, rémunérations dues', 428100: 'Dettes provisionnées pour congés à payer', 431000: 'Organismes sociaux (IPRES, CSS, IPM)',
  438100: 'Charges sociales sur congés à payer', 441000: 'État, impôt sur les bénéfices', 443100: 'TVA facturée sur ventes',
  444100: 'État, TVA due', 444900: 'État, crédit de TVA à reporter', 445100: 'TVA récupérable sur immobilisations',
  445200: 'TVA récupérable sur achats', 445800: 'TVA sur factures non parvenues', 447200: 'État, impôts retenus à la source (IR, TRIMF, CFCE)',
  462000: 'Associés, comptes courants', 471000: 'Débiteurs et créditeurs divers (compte d\'attente)', 471100: 'Débiteurs divers',
  481200: "Fournisseurs d'investissements", 491000: 'Dépréciations des comptes clients',
  521000: 'Banques locales', 571000: 'Caisse siège social',
  601000: 'Achats de marchandises', 602000: 'Achats de matières premières', 603100: 'Variation des stocks de marchandises', 603200: 'Variation des stocks de matières premières',
  605200: 'Fournitures non stockables, électricité et eau', 605300: 'Autres énergies (carburant)', 605500: 'Fournitures de bureau', 605800: 'Achats de travaux, matériels et équipements',
  611000: 'Transports sur achats', 618100: 'Voyages et déplacements', 621000: 'Sous-traitance générale', 622200: 'Locations de bâtiments',
  624000: 'Entretien, réparations et maintenance', 625000: "Primes d'assurance", 627000: 'Publicité, publications, relations publiques',
  628000: 'Frais de télécommunications', 631000: 'Frais bancaires', 632400: 'Honoraires',
  641300: 'Contribution forfaitaire à la charge de l\'employeur (CFCE)', 647100: 'Pénalités et amendes fiscales', 658800: 'Charges diverses (manquants)', 659400: 'Charges pour dépréciations des créances',
  661100: 'Appointements, salaires et commissions', 661300: 'Congés payés', 664100: 'Charges sociales sur rémunérations', 664800: 'Charges sociales sur congés payés',
  671200: 'Intérêts des emprunts', 681300: 'Dotations aux amortissements des immobilisations corporelles',
  701000: 'Ventes de marchandises', 702000: 'Ventes de produits finis', 705000: 'Travaux facturés', 706000: 'Services vendus',
  711000: "Subventions d'exploitation", 758000: 'Produits divers', 812000: 'Valeurs comptables des cessions d\'immobilisations corporelles',
  822000: 'Produits des cessions d\'immobilisations corporelles', 891000: "Impôts sur les bénéfices de l'exercice", 895000: 'Impôt minimum forfaitaire (IMF)',
};

// Taux sénégalais simplifiés (CGI 2013 et barèmes sociaux) : cotisations salariales IPRES et IPM,
// retenues fiscales sur salaires (IR et TRIMF), cotisations patronales IPRES, CSS (prestations
// familiales, accidents du travail) et IPM, CFCE 3 %, IS 30 % avec un minimum forfaitaire (IMF) de 0,5 % du
// chiffre d'affaires (entre 500 000 et 5 000 000 FCFA), TVA 18 %.
export const TAUX = { cotisationsSalariales: 0.08, retenuesFiscales: 0.1, cotisationsPatronales: 0.21, cfce: 0.03, is: 0.3, imf: 0.005, imfMin: 50000000, imfMax: 500000000, tvaNormale: 0.18 };

/**
 * Paramètres économiques par secteur, en proportion du chiffre d'affaires.
 * achats : achats consommés ; sousTraitance ; externes : autres charges externes ; personnel : coût chargé.
 */
export const SECTEURS_MOTEUR = {
  commerce: { vente: '701000', tvaVente: 0.18, achat: '601000', stock: '311000', varStock: '603100', achats: 0.68, sousTraitance: 0, externes: 0.10, personnel: 0.13, joursStock: 45, immo: 0.10, delais: [30, 30, 45] },
  btp: { vente: '705000', tvaVente: 0.18, achat: '602000', stock: '321000', varStock: '603200', achats: 0.34, sousTraitance: 0.16, externes: 0.12, personnel: 0.28, joursStock: 20, immo: 0.16, delais: [30, 60, 90] },
  restauration: { vente: '706000', tvaVente: 0.18, achat: '601000', stock: '311000', varStock: '603100', achats: 0.34, sousTraitance: 0, externes: 0.20, personnel: 0.34, joursStock: 8, immo: 0.22, delais: [1, 2, 30] },
  services: { vente: '706000', tvaVente: 0.18, achat: '605800', stock: null, varStock: null, achats: 0.06, sousTraitance: 0, externes: 0.22, personnel: 0.58, joursStock: 0, immo: 0.05, delais: [30, 45, 60] },
  industrie: { vente: '702000', tvaVente: 0.18, achat: '602000', stock: '321000', varStock: '603200', achats: 0.46, sousTraitance: 0, externes: 0.14, personnel: 0.28, joursStock: 40, immo: 0.25, delais: [30, 45, 60] },
  transport: { vente: '706000', tvaVente: 0.18, achat: '605300', stock: null, varStock: null, achats: 0.30, sousTraitance: 0.08, externes: 0.16, personnel: 0.30, joursStock: 0, immo: 0.30, delais: [30, 45, 60] },
};

// Charges externes : part du budget, fréquence annuelle fixe (ou null : variable), TVA récupérable.
export const NATURES_EXTERNES = [
  { compte: '622200', part: 0.22, frequence: 12, tva: true, lib: 'Loyer', noms: ['SCI Les Filaos', 'Immobilière Teranga', 'SCI Résidence du Cap'] },
  { compte: '605200', part: 0.10, frequence: 12, tva: true, lib: 'Électricité et eau', noms: ['Énergie Services Sahel', 'Distribution Eau et Énergie'] },
  { compte: '628000', part: 0.05, frequence: 12, tva: true, lib: 'Téléphonie et internet', noms: ['Télécom Pro Afrique', 'Réseau Connect Sénégal'] },
  { compte: '625000', part: 0.08, frequence: 4, tva: false, lib: 'Assurance multirisque', noms: ['Mutuelle Assurances Teranga', 'Assurances Générales du Cap-Vert'] },
  { compte: '632400', part: 0.11, frequence: null, tva: true, lib: 'Honoraires', noms: ['Cabinet Diagne Conseil', 'Maître Ndoye Avocat', 'Conseil RH Sahel'] },
  { compte: '627000', part: 0.08, frequence: null, tva: true, lib: 'Publicité', noms: ['Agence Baobab Communication', 'Imprimerie du Plateau'] },
  { compte: '611000', part: 0.10, frequence: null, tva: true, lib: 'Transport', noms: ['Transports Ndiaye et Frères', 'Logistique Express Thiès'] },
  { compte: '618100', part: 0.07, frequence: null, tva: true, lib: 'Déplacements', noms: ['Agence Voyages Affaires Dakar', 'Hôtel Résidence Ocean'] },
  { compte: '624000', part: 0.12, frequence: null, tva: true, lib: 'Entretien et maintenance', noms: ['Maintenance Industrielle Sahel', 'Propreté Services Dakar', 'Dépannage Technique Plus'] },
  { compte: '605500', part: 0.07, frequence: null, tva: true, lib: 'Fournitures de bureau', noms: ['Bureau Fournitures Direct', 'Papeterie Centrale du Plateau'] },
];

// Immobilisations de départ : part du budget d'investissement, durée d'amortissement, âge moyen.
export const CATEGORIES_IMMO = [
  { compte: '234000', amort: '283400', part: 0.30, duree: 10, age: 4, lib: 'Aménagements des locaux' },
  { compte: '241000', amort: '284100', part: 0.40, duree: 7, age: 3, lib: 'Matériel et outillage' },
  { compte: '245000', amort: '284500', part: 0.15, duree: 5, age: 2, lib: 'Véhicule utilitaire' },
  { compte: '244000', amort: '284400', part: 0.15, duree: 4, age: 2, lib: 'Matériel de bureau et informatique' },
];

const PATRONYMES = ['Diop', 'Ndiaye', 'Fall', 'Sow', 'Ba', 'Diallo', 'Gueye', 'Faye', 'Sarr', 'Mbaye', 'Cissé', 'Diouf', 'Sy', 'Seck', 'Kane', 'Thiam', 'Ndour', 'Camara', 'Touré', 'Niang', 'Dieng', 'Mbengue', 'Sène', 'Lô', 'Badji', 'Sagna', 'Diagne', 'Ndoye', 'Tall', 'Wane'];
const FORMES = ['SARL', 'SA', 'SUARL', 'Ets', 'GIE', 'Société', 'Groupe'];
const ACTIVITES = ['Distribution', 'Industries', 'Services', 'Bâtiment', 'Logistique', 'Négoce', 'Équipements', 'Conseil', 'Habitat', 'Automobiles', 'Matériaux', 'Agro-alimentaire'];
const COLLECTIVITES = ['Commune de Keur Fall (marché public)', 'Hôpital régional du Nord (marché public)', 'Lycée technique du Sine', 'Agence nationale des routes rurales', 'Office des HLM du Littoral'];

/** Fabrique des noms de tiers fictifs, sans doublon. */
export function fabriqueNoms(rnd, dejaPris = []) {
  const pris = new Set(dejaPris);
  return () => {
    for (let essai = 0; essai < 50; essai++) {
      const tirage = rnd();
      const nom = tirage < 0.08 ? rnd.choix(COLLECTIVITES)
        : tirage < 0.55 ? `${rnd.choix(FORMES)} ${rnd.choix(PATRONYMES)}`
        : `${rnd.choix(PATRONYMES)} ${rnd.choix(ACTIVITES)}`;
      if (!pris.has(nom)) { pris.add(nom); return nom; }
    }
    const nom = `Société ${rnd.choix(PATRONYMES)} ${pris.size}`;
    pris.add(nom);
    return nom;
  };
}

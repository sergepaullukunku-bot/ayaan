/* =====================================================================
   Ayaan · config.js
   Réglages communs à toutes les pages : version, délais de verrouillage,
   règles du code PIN, rôles et matrice d'accès.
   Ce fichier ne contient AUCUNE donnée : seulement des constantes.
   ===================================================================== */

// Numéro de version affiché à l'écran. Doit correspondre à VERSION dans sw.js.
export const VERSION = '15.1';

// Verrouillage automatique
export const DELAI_INACTIVITE = 10 * 60 * 1000; // 10 min sans toucher l'écran
export const DELAI_ABSENCE = 5 * 60 * 1000;     // 5 min dans une autre application

// Code PIN : 6 à 8 chiffres (OWASP M3). Après 5 erreurs, attente qui double à chaque série.
export const PIN_MIN = 6;
export const PIN_MAX = 8;
export const ESSAIS_MAX = 5;
export const ATTENTE_BASE = 30 * 1000; // 30 s, puis 60 s, 120 s… (plafond 15 min)

// Dérivation de clé à partir du PIN (OWASP 2023 : PBKDF2-HMAC-SHA256, 600 000 itérations)
export const PBKDF2_ITERATIONS = 600000;

// Taille maximale d'un fichier importé (protection contre les fichiers piégés ou trop lourds)
export const TAILLE_MAX_IMPORT = 15 * 1024 * 1024; // 15 Mo
export const LIGNES_MAX_IMPORT = 50000;

// Version minimale acceptée de SheetJS (les versions plus anciennes ont des failles connues :
// CVE-2023-30533 et CVE-2024-22363).
export const SHEETJS_MIN = '0.20.2';

// ----- Rôles et droits (identique à la « Matrice d'accès Ayaan.xlsx »)
export const ROLES = {
  admin: 'Administrateur',
  gest: 'Gestionnaire de données',
  prest: 'Prestataire CV',
  sup: 'Superviseur de site',
};

export const PERMS = {
  admin: ['voir', 'saisir', 'exporter', 'importer', 'manuel', 'rapport', 'sauvegarde', 'restaurer',
          'effacer', 'utilisateurs', 'central', 'c_importer', 'annees'],
  gest: ['voir', 'saisir', 'exporter', 'importer', 'manuel', 'rapport', 'sauvegarde'],
  prest: ['voir', 'saisir', 'exporter', 'importer', 'manuel', 'rapport'],
  sup: ['voir', 'saisir', 'exporter', 'importer', 'manuel', 'rapport'],
};

// Liste des actions, utilisée par « Mes droits » et par la matrice complète.
export const ACTIONS = [
  ['Ayaan Suivi CV', [
    ['Voir les listes, les tuiles et les tableaux', 'voir'],
    ['Saisir prélèvement, résultat CV, date de retour, début du CRA, commentaire', 'saisir'],
    ['Copier ou télécharger la liste (Excel)', 'exporter'],
    ["Importer l'export Tier.Net", 'importer'],
    ["Saisie manuelle d'un patient (ajouter, modifier, supprimer)", 'manuel'],
    ['Envoyer le rapport au centralisateur', 'rapport'],
    ['Copier ou enregistrer la sauvegarde (chiffrée)', 'sauvegarde'],
    ['Restaurer une sauvegarde', 'restaurer'],
    ["Effacer les données de l'appareil", 'effacer'],
    ['Gérer les utilisateurs et les PIN', 'utilisateurs'],
    ['Ajouter les années fiscales', 'annees'],
  ]],
  ['Centralisateur', [
    ["Ouvrir le centralisateur et l'utiliser (tableau de bord, import des rapports, sauvegardes)", 'central'],
  ]],
  ['Compte personnel', [
    ['Changer son propre code PIN', '*'],
    ["Verrouiller l'application", '*'],
    ['Voir ses droits (« Mes droits »)', '*'],
  ]],
];

export const peut = (role, droit) => droit === '*' || (PERMS[role] || []).includes(droit);

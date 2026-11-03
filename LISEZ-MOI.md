# Ayaan Suivi CV – version 15.2 (sécurisée, tous appareils, fichiers à la racine)

Application web installable (PWA) de suivi de la charge virale, patient par patient, **hors ligne**.
Aucun serveur, aucun framework : du HTML, du CSS et du JavaScript simple, commentés en français.

## Ce qui change en v15

| Sujet | Avant (v14) | Maintenant (v15) |
|---|---|---|
| Stockage | localStorage, **en clair** | **IndexedDB, chiffré** (AES-GCM 256 bits) |
| Code PIN | 4 à 6 chiffres, empreinte SHA-256 | **6 à 8 chiffres**, dérivation PBKDF2-SHA256 600 000 itérations ; le PIN ouvre la clé de chiffrement |
| Erreurs de PIN | attente de 30 s (oubliée au rechargement) | attente de 30 s, 60 s, 120 s… **gardée même après rechargement** |
| Verrouillage | écran caché | la page est **rechargée** : la clé et les données disparaissent de la mémoire |
| Sauvegarde | fichier JSON lisible | **fichier chiffré** ; sur un autre appareil, il faut le code de secours |
| Lecture Excel | lecteur maison | **SheetJS** dans un Web Worker (repli automatique sur le lecteur maison) |
| Mises à jour | rechargement manuel | vérification **dès le retour du réseau**, bandeau « Mettre à jour » |
| Sécurité de la page | — | politique de sécurité du contenu (CSP), aucun script dans le HTML |
| Fichiers importés | peu contrôlés | taille, nombre de lignes et contenu contrôlés ; injection de formules Excel neutralisée |

## Un seul code pour tous les appareils (v15.1)

| Appareil | Navigateur conseillé | Installer l'icône |
|---|---|---|
| Ordinateur Windows / Mac | Chrome ou Edge (récents) | icône « Installer » dans la barre d'adresse |
| Android (téléphone, tablette) | Chrome | menu ⋮ › « Installer l'application » |
| iPhone / iPad | Safari (iOS 15 ou plus récent) | Partager › « Sur l'écran d'accueil » |

- **Stockage persistant** : Ayaan demande au navigateur de ne jamais effacer sa base (`navigator.storage.persist()`),
  au démarrage, à chaque connexion et après chaque import. L'état est affiché dans « Règles et sauvegarde » :
  « Stockage protégé » ou « Stockage non garanti » avec la marche à suivre. **Installer Ayaan sur l'écran
  d'accueil** est ce qui donne la meilleure protection (Android, ordinateur et iPhone).
- **Écran tactile** : boutons, puces et champs d'au moins 44 px pour le pouce ; texte des champs en 16 px
  (Safari ne zoome plus tout seul) ; marges respectant l'encoche de l'iPhone.
- **Souris et clavier** : éléments plus compacts, effets au survol, contour jaune sur l'élément actif (touche Tab),
  Échap ferme les fenêtres, Entrée valide.
- **Fichiers** : champ standard `<input type="file">`, qui ouvre l'Explorateur Windows, le Finder,
  l'application « Fichiers » de l'iPhone ou le sélecteur d'Android. Sur ordinateur, on peut aussi
  **glisser-déposer** l'export sur la page. Le type de fichier est reconnu par son contenu (un fichier sans
  extension fonctionne), et les CSV enregistrés par Excel sous Windows (accents en Windows-1252) sont lus correctement.
- **Enregistrer** (rapport, sauvegarde) : téléchargement sur ordinateur et Android ; sur iPhone/iPad, la feuille
  de partage s'ouvre (« Enregistrer dans Fichiers », WhatsApp…).

## Installation sur GitHub Pages

1. **Installer SheetJS (une seule fois)** : téléchargez
   `https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.mini.min.js`
   (version 0.20.3 ou plus récente, site officiel uniquement) et placez-le **à la racine**, à côté de `index.html`.
   Sans ce fichier, Ayaan fonctionne quand même avec son lecteur intégré (.xlsx et .csv).
   Une version plus ancienne que 0.20.2 est refusée (failles connues).
2. Dans le dépôt GitHub **ayaan**, envoyez **tous les fichiers** de ce dossier : « Add file › Upload files », puis glissez-les.
3. « Commit changes ». Attendez 1 à 2 minutes.
4. Sur chaque téléphone : ouvrez Ayaan depuis son icône. La v15 s'installe toute seule.

L'application doit être ouverte par son adresse **https://** (le chiffrement du navigateur ne fonctionne pas autrement).
Ouvrir `index.html` directement depuis un dossier de l'ordinateur ne fonctionne pas.

## Premier lancement après la v14 : la migration

- L'écran « Mise à jour de sécurité » s'affiche. L'**administrateur** entre son **ancien PIN**,
  puis choisit un **nouveau PIN de 6 chiffres**.
- Ayaan chiffre alors toutes les données de l'appareil, puis efface l'ancien stockage en clair.
- Un **nouveau code de secours** s'affiche : notez-le sur papier (l'ancien n'est plus valable).
- Les autres utilisateurs apparaissent avec « PIN à redéfinir » : l'administrateur leur donne un nouveau PIN
  (Utilisateurs › Modifier / nouveau PIN).

> **Important.** Sans PIN valide ni code de secours, les données chiffrées ne peuvent plus être lues
> par personne. Gardez le code de secours en lieu sûr et faites des sauvegardes régulières.

## Structure du code

Tous les fichiers sont **à la racine du dépôt** (pas de sous-dossiers) : on peut tout envoyer d'un coup
par « Add file › Upload files » sur le site GitHub.

| Fichier | Rôle |
|---|---|
| index.html, central.html | les deux écrans (HTML seulement, aucun script intégré) |
| sw.js | service worker : hors ligne et mises à jour |
| manifest.webmanifest, central.webmanifest | installation de l'application |
| ayaan.css, central.css, verrou.css, adaptatif.css | styles (adaptatif.css = tactile / souris / clavier) |
| icon-192.png, icon-512.png, maskable-*.png, apple-touch-icon.png | icônes |
| xlsx.mini.min.js | bibliothèque SheetJS (à ajouter, voir plus haut) |
| config.js | réglages : version, règles du PIN, rôles et droits |
| coffre.js | IndexedDB + chiffrement (le « coffre » des données) |
| auth.js | écran de verrouillage, comptes, droits |
| migration.js | reprise des données de la v14 (une seule fois) |
| maj.js | inscription du service worker, bandeau de mise à jour |
| outils.js | dates, formats, contrôle des sauvegardes |
| calculs.js | règles de calcul (actifs, dates probables, retards) |
| import.js, excel.worker.js | lecture de l'export Tier.Net (Excel dans un Web Worker, ou CSV) |
| fichiers.js | ouvrir / enregistrer des fichiers, glisser-déposer (API standard) |
| stockage.js | demande de stockage persistant et état affiché |
| app.js, central.js | écran « Ayaan Suivi CV » et écran « Centralisateur » |
| accueil.js | logo animé au lancement |

**Parcours d'une donnée** : `import.js` lit le fichier → `app.js` l'affiche et appelle `calculs.js` →
chaque modification passe par `coffre.js`, qui la chiffre puis l'écrit dans IndexedDB.

**Base IndexedDB « ayaan »** : `comptes` (nom, rôle, clé enveloppée par le PIN), `coffre` (données chiffrées),
`meta` (enveloppe du code de secours, compteur d'essais).

## Publier une nouvelle version

1. Modifiez le code.
2. Changez le numéro dans `sw.js` (`VERSION = 'ayaan-v15.3'`, par exemple) **et** dans `js/config.js`.
3. Envoyez les fichiers sur GitHub. Les téléphones verront la nouvelle version dès qu'ils auront du réseau.

## Limites connues

- Navigateurs trop anciens (iOS 14 et avant, Android avec Chrome de plus de 3 ans) : non pris en charge
  (chiffrement et modules JavaScript modernes nécessaires).
- Sur iPhone, Safari peut refuser le stockage persistant ; une application ajoutée à l'écran d'accueil n'est
  toutefois pas soumise à l'effacement automatique après 7 jours. Les sauvegardes restent indispensables.

- Un PIN de 6 chiffres protège bien contre une personne qui trouve le téléphone, mais un spécialiste
  qui copie la base peut essayer tous les PIN avec du matériel puissant. Le verrouillage du téléphone
  (code ou empreinte) reste indispensable.
- Les noms et rôles des utilisateurs (pas des patients) restent lisibles : ils servent à l'écran de connexion.
- Le rapport mensuel envoyé au centralisateur n'est pas chiffré : il contient des chiffres et les N° dossier
  des patients en retard (aucun nom). Envoyez-le par WhatsApp (chiffré de bout en bout).
- Les droits des rôles sont appliqués par l'application sur l'appareil : sans serveur, ils ne remplacent pas
  la confiance dans les personnes qui ont un compte.

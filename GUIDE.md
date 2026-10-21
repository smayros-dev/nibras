# Guide d'utilisation de Nibras

Ce guide explique comment utiliser Nibras au quotidien, selon votre rôle. Pour installer et lancer
le projet, voir le [README](README.md).

> **État des fonctionnalités.** Les sections marquées **(SP2)** concernent les étudiants et les
> invitations : elles sont dans la branche `sp2/students-invitations` et arrivent dans `main` à la
> fin de SP2. Les cours, modules et vidéos (SP3) ne sont pas encore visibles dans l'interface.

## Sommaire

1. [Premiers pas](#1-premiers-pas)
2. [Les rôles](#2-les-rôles)
3. [Compte et sécurité](#3-compte-et-sécurité)
4. [Espaces et organisations](#4-espaces-et-organisations)
5. [Membres d'une organisation](#5-membres-dune-organisation)
6. [Étudiants et invitations (SP2)](#6-étudiants-et-invitations-sp2)
7. [Mineurs et consentement du tuteur (SP2)](#7-mineurs-et-consentement-du-tuteur-sp2)
8. [Côté étudiant](#8-côté-étudiant)
9. [Côté tuteur (SP2)](#9-côté-tuteur-sp2)
10. [Signalement d'abus](#10-signalement-dabus)
11. [Console super-admin](#11-console-super-admin)
12. [Langue, thème et application mobile](#12-langue-thème-et-application-mobile)
13. [Essayer en local](#13-essayer-en-local)
14. [Questions fréquentes](#14-questions-fréquentes)

---

## 1. Premiers pas

1. Ouvrez Nibras (en local : http://localhost:3000).
2. Cliquez sur **Créer un compte**, renseignez nom, prénom, email, mot de passe, pays et date de
   naissance.
3. Validez votre email avec le lien reçu.
4. Acceptez les conditions d'utilisation, la politique de confidentialité et le code de conduite.
5. Vous arrivez sur le tableau de bord. Une liste « Premiers pas » vous guide : vérifier l'email,
   vérifier le téléphone, compléter le profil, inviter vos étudiants…

Un professeur indépendant reçoit automatiquement un **espace personnel**. Pour une école ou une
académie, créez une **organisation** (voir §4).

## 2. Les rôles

| Rôle                       | Ce qu'il peut faire                                                                |
| -------------------------- | ---------------------------------------------------------------------------------- |
| **Propriétaire** (OWNER)   | Tout dans son espace, y compris transférer la propriété. Un seul par organisation. |
| **Administrateur** (ADMIN) | Gère membres, étudiants, invitations et paramètres. 2FA obligatoire.               |
| **Professeur** (TEACHER)   | Gère ses propres étudiants, invitations et codes de groupe.                        |
| **Assistant** (ASSISTANT)  | Aide un professeur, droits limités.                                                |
| **Étudiant** (STUDENT)     | Accède à ses espaces, ses cours et ses sessions.                                   |
| **Tuteur** (GUARDIAN)      | Parent d'un étudiant mineur : donne ou retire le consentement.                     |
| **Super-admin**            | Équipe de la plateforme : console d'administration globale.                        |

Une même personne peut avoir des rôles différents dans plusieurs espaces.

## 3. Compte et sécurité

Tout se trouve dans **Paramètres** (menu utilisateur, en haut ou en bas selon l'écran).

- **Profil** : nom, langue de l'interface, fuseau horaire. Si le fuseau de votre navigateur diffère,
  un bandeau propose de le mettre à jour.
- **Vérification** : email et téléphone (code par SMS). Un professeur doit avoir un téléphone vérifié
  et avoir accepté le code de conduite pour inviter des étudiants.
- **Sécurité** :
  - **Mot de passe** : changement avec l'ancien mot de passe.
  - **Double authentification (2FA)** : votre mot de passe est demandé, puis scannez le QR code avec
    une application (Google Authenticator, Microsoft Authenticator, Aegis, 2FAS…), tapez le code à
    6 chiffres et **conservez les codes de récupération**. Obligatoire pour les administrateurs et
    propriétaires d'organisation. La désactivation demande aussi le mot de passe et un code.
  - **Appareils** : liste des sessions ouvertes, déconnexion d'un appareil à distance.
- **Consentements** : historique des documents acceptés. Quand une nouvelle version des conditions
  est publiée, l'application vous demande de l'accepter avant de continuer.

Après plusieurs mauvais mots de passe, le compte est bloqué temporairement : attendez quelques
minutes ou utilisez **Mot de passe oublié**.

## 4. Espaces et organisations

- **Espace personnel** : créé pour chaque professeur indépendant.
- **Organisation** : depuis le sélecteur d'espace, **Créer une organisation** (nom, pays). Vous en
  devenez propriétaire, et la 2FA vous est demandée.
- **Changer d'espace** : sélecteur en haut de la barre latérale (ou du menu mobile).
- **Paramètres de l'espace** : nom, langue par défaut (utilisée pour les emails envoyés aux
  étudiants et tuteurs), fuseau, stockage utilisé.
- **Journal d'audit** : toutes les actions importantes de l'espace (qui, quoi, quand).
- Une organisation **suspendue** passe en lecture seule : la consultation reste possible, les
  modifications sont refusées.

## 5. Membres d'une organisation

Page **Membres** (propriétaire et administrateurs) :

- **Inviter un membre du personnel (SP2)** : email + rôle (professeur ou administrateur). La personne
  reçoit un lien d'invitation.
- **Changer un rôle**, **suspendre** ou **retirer** un membre.
- **Transférer la propriété** : le nouveau propriétaire doit être administrateur actif ; vous devenez
  administrateur.

## 6. Étudiants et invitations (SP2)

Page **Étudiants** (propriétaire, administrateurs, professeurs). Un professeur ne voit que les
étudiants qu'il a invités ou qui lui sont attribués.

### Onglets

- **Tous** : la liste des étudiants avec leur statut (actif, en attente d'approbation, en attente du
  consentement du tuteur, suspendu).
- **En attente** : demandes à approuver, consentements en attente et invitations ouvertes.

### Inviter par email

1. **Inviter un étudiant** : email, et si vous le connaissez, prénom, nom et date de naissance.
   Vous pouvez ajouter un message personnel.
2. L'étudiant reçoit un email nommant votre espace et le professeur. Le lien est **valable 7 jours**
   et ne fonctionne qu'avec l'adresse invitée.
3. Depuis la liste des invitations : **Renvoyer** (au plus une fois toutes les 10 minutes) ou
   **Annuler**.
4. Vous recevez un email quand l'invitation est acceptée.

### Code ou lien de groupe

1. Dans la carte **Lien d'invitation**, créez un code : nombre maximum d'utilisations (50 par
   défaut), date d'expiration (30 jours par défaut) et **approbation requise** (activée par défaut
   dans une organisation).
2. Partagez le lien `…/join/<code>` (classe, groupe WhatsApp…).
3. Avec approbation, chaque demande arrive dans l'onglet **En attente** : **Approuver** ou
   **Refuser**.
4. Vous pouvez modifier ou désactiver le code à tout moment.

### Import CSV

Import de jusqu'à **500 étudiants** à partir d'un fichier CSV (séparateur `,` ou `;`, fichiers Excel
acceptés). Seule la colonne `email` est obligatoire ; `first_name`, `last_name`, `birth_date` et
`guardian_email` sont facultatives.

1. Choisissez le fichier : un **aperçu** indique le résultat de chaque ligne (adresse invalide, déjà
   membre, déjà invité…).
2. Confirmez : l'import se fait en arrière-plan, une invitation est envoyée par ligne valide.
3. Téléchargez le **rapport** ligne par ligne ; vous recevez aussi un email à la fin.

> L'écran d'import arrive avec la tâche T15 de SP2 ; l'API est déjà prête.

### Profil d'un étudiant

Menu de la ligne → **Profil** : informations, statut, professeurs attribués et tuteur. Pour un
mineur dont le consentement n'est pas encore donné, vous pouvez **changer l'email du tuteur** ou
**renvoyer la demande**.

## 7. Mineurs et consentement du tuteur (SP2)

Un étudiant de **moins de 18 ans** doit avoir le consentement de son tuteur **pour chaque espace**.

1. À l'inscription d'un mineur (invitation, code ou import), l'email du tuteur est demandé.
2. Le tuteur reçoit un email avec un lien **valable 14 jours**.
3. Tant que le consentement n'est pas donné, l'étudiant voit un écran d'attente (avec un bouton
   « Renvoyer à mon tuteur ») et n'a pas accès au contenu.
4. Si le tuteur **accepte**, l'accès s'ouvre. S'il **refuse**, l'accès reste suspendu.
5. Sans réponse après 14 jours, la demande expire : l'accès est suspendu, **aucune donnée n'est
   supprimée**, et la demande peut être renvoyée.
6. Avec un code de groupe soumis à approbation, l'email au tuteur part seulement quand le professeur
   approuve.

## 8. Côté étudiant

- **Accepter une invitation** : ouvrez le lien reçu, créez un compte (votre email est alors
  considéré comme vérifié) ou connectez-vous avec un compte existant.
- **Rejoindre avec un code** : ouvrez le lien `…/join/<code>`, créez un compte (vérification de
  l'email demandée) ou connectez-vous.
- Le **tableau de bord** liste vos espaces, avec un badge s'ils ne sont pas encore actifs (en attente
  d'approbation, de consentement…).
- Les cours, sessions en direct et la progression arrivent avec les prochains sous-projets.

## 9. Côté tuteur (SP2)

Le tuteur **n'a pas besoin de compte**.

1. Dans l'email reçu, ouvrez le lien de consentement.
2. Indiquez prénom, nom et lien de parenté, lisez la notice pour les mineurs, cochez
   « J'autorise … » puis **Autoriser** (ou **Refuser**, avec confirmation).
3. Après l'accord, un lien vers la **page tuteur** (« Sessions de {enfant} ») est fourni. Gardez-le :
   il permet de **retirer le consentement** à tout moment ou de **l'accorder à nouveau**.
4. Le retrait ne concerne que l'espace concerné ; l'étudiant, le professeur et les administrateurs
   sont prévenus.

> Ne transférez pas ces liens : ils donnent accès aux décisions de consentement.

## 10. Signalement d'abus

- N'importe quel utilisateur peut **signaler** un comportement (bouton de signalement), avec une
  catégorie et une description.
- Le signalement va aux responsables de l'espace et, pour les cas graves (sécurité des mineurs), à
  l'équipe de la plateforme.
- **Votre identité n'est visible que par les super-admins** : ni les responsables de l'organisation
  ni la personne signalée ne savent qui a signalé.
- Vous retrouvez vos propres signalements dans votre compte.

## 11. Console super-admin

Réservée à l'équipe de la plateforme (`/admin`) : utilisateurs, espaces, quotas, suspensions et
traitement des signalements. Le premier super-admin se crée en ligne de commande :

```bash
printf "%s" "$MOT_DE_PASSE" | pnpm --filter @nibras/api cli create-super-admin --email admin@exemple.com --password-stdin
```

Voir [docs/runbooks/auth-and-tenancy.md](docs/runbooks/auth-and-tenancy.md).

## 12. Langue, thème et application mobile

- **Langue** : français (par défaut), العربية (affichage de droite à gauche) ou English, depuis le
  menu de langue.
- **Thème** : clair, sombre ou automatique, depuis le menu utilisateur.
- **Installer l'application** : depuis le navigateur du téléphone, « Ajouter à l'écran d'accueil ».
  Une page hors ligne s'affiche en cas de coupure réseau.

## 13. Essayer en local

Démarrez l'application (voir le [README](README.md)), puis connectez-vous avec un compte de
démonstration. Mot de passe pour tous : **`mot-de-passe-demo-2026`**.

| Compte                 | Rôle dans « Académie El Manar »                     |
| ---------------------- | --------------------------------------------------- |
| `amine@example.test`   | Propriétaire (2FA demandée à la première connexion) |
| `leila@example.test`   | Professeure                                         |
| `karim@example.test`   | Professeur                                          |
| `sana@example.test`    | Assistante (interface en arabe)                     |
| `rajaa@example.test`   | Tutrice                                             |
| `yassine@example.test` | Étudiant mineur                                     |
| `noussa@example.test`  | Étudiante                                           |
| `tarek@example.test`   | Étudiant suspendu (sans consentement du tuteur)     |

Tous les emails envoyés en local (invitations, consentements, codes) arrivent dans **Mailpit** :
http://localhost:8025.

## 14. Questions fréquentes

**Le code 2FA est refusé.** Vérifiez que l'heure du téléphone est automatique, et tapez le code
avant qu'il change.

**J'ai perdu mon téléphone.** Connectez-vous avec un code de récupération, puis reconfigurez la 2FA.

**Le lien d'invitation dit « Invitation expirée ».** Demandez au professeur de la renvoyer : le lien
est valable 7 jours et un renvoi crée un nouveau lien.

**L'étudiant est « en attente du consentement ».** Le tuteur doit accepter depuis son email.
L'étudiant ou le professeur peut renvoyer la demande ; le professeur peut aussi corriger l'email du
tuteur.

**Je ne vois pas la page Étudiants.** Elle est réservée aux propriétaires, administrateurs et
professeurs de l'espace.

**Je ne peux plus rien modifier dans mon organisation.** Elle est probablement suspendue : contactez
l'équipe de la plateforme.

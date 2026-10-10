# PRD — Plateforme de cours en ligne avec sessions vidéo en direct

**Version :** 1.0  
**Statut :** Product Requirements Document  
**Type de produit :** Plateforme SaaS d'enseignement en ligne  
**Utilisateurs principaux :** Professeurs et étudiants

---

# 1. Vision du produit

L'application est une plateforme d'enseignement permettant à un professeur de gérer ses étudiants, créer et publier des cours, et organiser des **sessions vidéo en direct** avec ses étudiants.

L'application combine trois modes d'apprentissage :

1. **Cours enregistrés** : vidéos et PDF.
2. **Sessions vidéo en direct** : cours individuels ou collectifs entre professeur et étudiants.
3. **Suivi pédagogique** : progression, présence, historique des sessions et activité des étudiants.

L'objectif est de permettre au professeur de gérer toute sa relation pédagogique depuis une seule application.

---

# 2. Objectifs du produit

## Objectifs principaux

Le produit doit permettre au professeur de :

- créer et gérer ses cours ;
- organiser ses cours en modules et leçons ;
- publier des vidéos ;
- publier des PDF ;
- gérer ses étudiants ;
- attribuer des cours à ses étudiants ;
- programmer des sessions vidéo ;
- réaliser des cours vidéo en direct ;
- suivre la présence des étudiants ;
- suivre leur progression ;
- communiquer avec eux ;
- consulter l'historique pédagogique.

L'étudiant doit pouvoir :

- consulter les cours qui lui sont accessibles ;
- regarder les vidéos ;
- consulter les PDF ;
- suivre sa progression ;
- voir son calendrier ;
- rejoindre ses sessions vidéo ;
- communiquer avec son professeur ;
- consulter l'historique de ses sessions.

---

# 3. Utilisateurs

## 3.1 Professeur

Le professeur est responsable de son espace pédagogique.

Il possède :

- un profil ;
- des étudiants ;
- des cours ;
- des modules ;
- des leçons ;
- des sessions ;
- un calendrier ;
- des statistiques ;
- des notifications.

## 3.2 Étudiant

L'étudiant appartient à un ou plusieurs espaces pédagogiques de professeurs.

Il possède :

- un profil ;
- des cours ;
- une progression ;
- des sessions ;
- un calendrier ;
- des notifications ;
- une messagerie.

---

# 4. Concept général

Le fonctionnement principal est :

```text
PROFESSEUR
    │
    ├── Crée un cours
    │      │
    │      ├── Module
    │      │     ├── Vidéo
    │      │     ├── PDF
    │      │     └── Vidéo
    │      │
    │      └── Module
    │
    ├── Ajoute des étudiants
    │
    ├── Attribue le cours
    │
    └── Programme une session vidéo
              │
              ▼
        PROFESSEUR ↔ ÉTUDIANT
          vidéo + audio
              │
              ▼
        Suivi de la progression
```

---

# 5. Dashboard Professeur

Le dashboard est la page d'accueil du professeur.

Il présente une synthèse de son activité.

## Informations principales

- nombre d'étudiants ;
- nombre de cours ;
- sessions aujourd'hui ;
- prochaines sessions ;
- étudiants actifs ;
- progression moyenne ;
- activité récente.

Exemple :

```text
Bonjour Mohamed 👋

┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Étudiants    │ │ Cours        │ │ Sessions     │
│     32       │ │     12       │ │      8       │
└──────────────┘ └──────────────┘ └──────────────┘

PROCHAINES SESSIONS

10:00   Ahmed       Mathématiques     🎥
14:00   Sarah       Physique          🎥
16:00   Yassine     Algèbre           🎥

ACTIVITÉ RÉCENTE

Ahmed a terminé "Équations - Chapitre 2"
Sarah a regardé "Introduction à la physique"
Yassine a participé à une session vidéo
```

---

# 6. Gestion des étudiants

Le professeur possède une section **Mes étudiants**.

## Liste

```text
Étudiant       Cours              Progression

Ahmed          Mathématiques      75%
Sarah          Physique           42%
Yassine        Algèbre            90%
```

## Actions

Le professeur peut :

- ajouter un étudiant ;
- inviter un étudiant ;
- modifier les informations ;
- consulter son profil ;
- attribuer un cours ;
- retirer un cours ;
- consulter sa progression ;
- consulter ses sessions ;
- voir sa présence ;
- envoyer un message ;
- consulter son historique.

---

# 7. Invitation d'un étudiant

Le professeur peut inviter un étudiant par email.

Flux :

```text
Professeur
    ↓
Ajouter étudiant
    ↓
Email étudiant
    ↓
Invitation envoyée
    ↓
Étudiant crée son compte
    ↓
Étudiant rejoint l'espace
```

L'étudiant est ensuite automatiquement associé au professeur.

---

# 8. Profil étudiant

Le professeur peut consulter le profil pédagogique complet.

```text
Ahmed Ben Ali

Email
ahmed@email.com

Cours
Mathématiques Niveau 1

Progression
75%

Sessions
12 réalisées
2 à venir

Présence
92%

Dernière activité
Aujourd'hui
```

## Informations pédagogiques

- cours suivis ;
- progression ;
- leçons terminées ;
- vidéos regardées ;
- PDF consultés ;
- sessions réalisées ;
- sessions annulées ;
- temps passé ;
- dernière activité.

---

# 9. Gestion des cours

Le professeur peut créer, modifier, publier et supprimer ses cours.

## Création d'un cours

Champs :

- titre ;
- description ;
- image ;
- catégorie ;
- niveau ;
- durée estimée ;
- statut.

Statuts :

```text
DRAFT
PUBLISHED
ARCHIVED
```

---

# 10. Structure d'un cours

Chaque cours peut être organisé en modules.

```text
Cours : Mathématiques Niveau 1

Module 1 — Introduction
    ├── Leçon 1 — Introduction
    │       └── Vidéo
    │
    ├── Leçon 2 — Les nombres
    │       └── PDF
    │
    └── Leçon 3 — Exercices
            └── PDF

Module 2 — Algèbre
    ├── Leçon 1 — Équations
    │       └── Vidéo
    │
    └── Leçon 2 — Exercices
            └── PDF
```

---

# 11. Types de contenus pédagogiques

## 11.1 Vidéo enregistrée

Le professeur peut :

- uploader une vidéo ;
- définir un titre ;
- ajouter une description ;
- associer la vidéo à une leçon ;
- modifier ;
- supprimer.

L'étudiant peut :

- regarder ;
- mettre en pause ;
- reprendre ;
- avancer/reculer ;
- voir sa progression.

La plateforme doit mémoriser la position de lecture.

Exemple :

```text
Vidéo : 30 minutes

Étudiant :
18 minutes regardées

Progression :
60%

[▶ Reprendre à 18:00]
```

---

# 12. Documents PDF

Le professeur peut ajouter des documents PDF à une leçon.

L'étudiant peut :

- consulter le PDF ;
- télécharger le document si l'autorisation est activée ;
- marquer la leçon comme terminée.

---

# 13. Attribution des cours aux étudiants

Un professeur peut décider quels étudiants ont accès à chaque cours.

Exemple :

```text
Cours : Mathématiques Niveau 1

Étudiants autorisés :

☑ Ahmed
☑ Sarah
☐ Yassine
☐ Lina
```

L'étudiant ne peut voir que les cours auxquels il a accès.

---

# 14. Progression pédagogique

La progression est calculée automatiquement.

Exemple :

```text
Mathématiques

Progression globale : 75%

Module 1     ██████████ 100%
Module 2     ██████████ 100%
Module 3     ███████░░░  70%
Module 4     ░░░░░░░░░░   0%
```

La progression peut être calculée à partir :

- des leçons terminées ;
- du temps vidéo regardé ;
- des exercices terminés ;
- des contenus consultés.

---

# 15. Sessions vidéo en direct

## Fonctionnalité centrale

Une session vidéo est un rendez-vous pédagogique en direct entre un professeur et un ou plusieurs étudiants.

Exemple :

```text
Professeur
     ↕
🎥 Vidéo
🎤 Audio
💬 Chat
     ↕
Étudiant
```

Une session peut être :

- individuelle ;
- avec plusieurs étudiants.

---

# 16. Création d'une session vidéo

Le professeur clique sur :

**+ Nouvelle session**

Formulaire :

```text
Nouvelle session vidéo

Titre
[ Révision des équations ]

Cours
[ Mathématiques Niveau 1 ]

Étudiant(s)
[ Ahmed Ben Ali ]

Date
[ 15/10/2026 ]

Heure de début
[ 15:00 ]

Durée
[ 60 minutes ]

Description
[ Révision du chapitre 3 ]

[ Programmer la session ]
```

---

# 17. Cycle de vie d'une session

Une session suit les états suivants :

```text
SCHEDULED
    ↓
UPCOMING
    ↓
LIVE
    ↓
COMPLETED
```

Autres possibilités :

```text
SCHEDULED → CANCELLED
SCHEDULED → NO_SHOW
```

---

# 18. Salle vidéo

À l'heure prévue, le professeur et l'étudiant voient le bouton :

**🎥 Rejoindre la session**

Ils accèdent à une salle vidéo intégrée à l'application.

```text
┌──────────────────────────────────────────┐
│ Révision des équations                   │
│ 15:00 — 16:00                            │
├──────────────────────────────────────────┤
│                                          │
│              PROFESSEUR                  │
│                                          │
│                                          │
│                          ÉTUDIANT        │
│                                          │
├──────────────────────────────────────────┤
│ 🎤 Micro   📹 Caméra   🖥 Écran         │
│                                          │
│ 💬 Chat    📎 Fichier    ⛶ Plein écran  │
│                                          │
│              🔴 Quitter                  │
└──────────────────────────────────────────┘
```

---

# 19. Fonctionnalités de la salle vidéo

## MVP

La salle doit permettre :

- vidéo professeur ;
- vidéo étudiant ;
- audio ;
- activer/désactiver micro ;
- activer/désactiver caméra ;
- rejoindre ;
- quitter ;
- affichage du temps ;
- chat texte.

## Version suivante

Ajouter :

- partage d'écran ;
- partage de fichiers ;
- tableau blanc ;
- lever la main ;
- réactions ;
- enregistrement ;
- transcription automatique ;
- sous-titres.

---

# 20. Session individuelle

Le scénario principal est :

```text
Professeur
    │
    │ programme
    ▼
Session vidéo
    │
    ├── Date
    ├── Heure
    ├── Durée
    └── Étudiant
             │
             ▼
       Notification
             │
             ▼
      Salle vidéo
             │
       ┌─────┴─────┐
       ▼           ▼
 Professeur     Étudiant
       │           │
       └─────┬─────┘
             ▼
       Session terminée
             │
             ▼
          Historique
```

---

# 21. Sessions collectives

Le professeur peut également organiser une session avec plusieurs étudiants.

Exemple :

```text
Session :
Mathématiques — Révision

Professeur
     │
     ├── Ahmed
     ├── Sarah
     ├── Yassine
     └── Lina
```

La salle vidéo doit permettre d'afficher plusieurs participants.

---

# 22. Calendrier professeur

Le professeur dispose d'un calendrier regroupant ses sessions.

```text
OCTOBRE 2026

Lun Mar Mer Jeu Ven Sam Dim

12  13  14  15  16  17  18
            │
            ├── 10:00 Ahmed
            ├── 14:00 Sarah
            └── 16:00 Yassine
```

Actions :

- créer ;
- modifier ;
- annuler ;
- déplacer ;
- consulter ;
- rejoindre.

---

# 23. Calendrier étudiant

L'étudiant voit uniquement ses sessions.

```text
MES PROCHAINES SESSIONS

Aujourd'hui — 15:00

🎥 Révision des équations
Professeur : Mohamed
Durée : 60 minutes

[ Rejoindre ]
```

---

# 24. Rappels de session

Le système doit envoyer automatiquement :

### 24 heures avant

> Votre session avec votre professeur est prévue demain à 15h00.

### 15 minutes avant

> Votre session commence dans 15 minutes.

### Au début

> 🎥 Votre session commence maintenant.

---

# 25. Présence

L'application enregistre automatiquement les connexions.

Pour chaque participant :

```text
Participant : Ahmed

Session :
Révision des équations

Prévue :
15:00 → 16:00

Entrée :
15:02

Sortie :
15:57

Durée :
55 minutes

Présence :
Présent
```

---

# 26. Historique des sessions

Le professeur peut consulter toutes ses sessions.

```text
DATE       ÉTUDIANT     COURS           DURÉE    STATUT

15/10      Ahmed        Mathématiques   60 min   ✓ Terminée
14/10      Sarah        Physique        45 min   ✓ Terminée
13/10      Yassine      Algèbre         60 min   ❌ Annulée
```

---

# 27. Compte rendu de session

À la fin d'une session, le professeur peut ajouter un compte rendu.

```text
Session terminée

Étudiant : Ahmed
Durée : 60 min

Compte rendu :

[ Nous avons travaillé sur les équations
du second degré. Ahmed doit terminer
les exercices 4 à 8. ]

Prochaine session :
[ 22/10/2026 ]

[ Enregistrer ]
```

Le compte rendu est visible par l'étudiant.

---

# 28. Actions après une session

Le professeur peut :

- ajouter une note ;
- ajouter un compte rendu ;
- attribuer un PDF ;
- attribuer une vidéo ;
- recommander une leçon ;
- programmer une nouvelle session.

Exemple :

```text
Session terminée

✓ Compte rendu ajouté

Recommandations pour Ahmed :

📹 Équations — Vidéo 3
📄 Exercices — Chapitre 4

[ Programmer une prochaine session ]
```

---

# 29. Dashboard étudiant

```text
Bonjour Ahmed 👋

MES COURS

Mathématiques
████████████░░ 75%

Physique
██████░░░░░░░ 45%

PROCHAINE SESSION

🎥 Révision des équations
Aujourd'hui — 15:00

[ Rejoindre ]

DERNIÈRE ACTIVITÉ

✓ Vidéo terminée
✓ PDF consulté
✓ Session terminée
```

---

# 30. Espace étudiant — Cours

L'étudiant sélectionne un cours.

```text
Mathématiques Niveau 1

Progression : 75%

Module 1 ✓
Module 2 ✓
Module 3
   ├── ✓ Leçon 1
   ├── ✓ Leçon 2
   └── → Leçon 3
Module 4 🔒
```

Les modules peuvent éventuellement être verrouillés jusqu'à ce que certaines conditions soient remplies.

---

# 31. Messagerie

Une messagerie permet au professeur et à l'étudiant de communiquer.

```text
Ahmed

Professeur :
Bonjour Ahmed, n'oublie pas de regarder
la vidéo avant notre session.

Ahmed :
Bonjour professeur, c'est fait.

Professeur :
Parfait 👍
```

Fonctionnalités MVP :

- messages texte ;
- historique ;
- notifications ;
- messages non lus.

---

# 32. Notifications

## Professeur

- nouvel étudiant ;
- étudiant accepté ;
- nouveau message ;
- session programmée ;
- session annulée ;
- rappel de session ;
- étudiant absent ;
- cours terminé.

## Étudiant

- invitation ;
- nouveau cours ;
- nouveau contenu ;
- nouvelle session ;
- rappel ;
- session annulée ;
- nouveau message ;
- compte rendu de session.

---

# 33. Permissions

| Fonctionnalité | Professeur | Étudiant |
|---|---:|---:|
| Créer un cours | ✅ | ❌ |
| Modifier un cours | ✅ | ❌ |
| Ajouter vidéo | ✅ | ❌ |
| Ajouter PDF | ✅ | ❌ |
| Ajouter étudiant | ✅ | ❌ |
| Attribuer un cours | ✅ | ❌ |
| Voir progression étudiant | ✅ | ❌ |
| Programmer session | ✅ | ❌ |
| Modifier session | ✅ | ❌ |
| Annuler session | ✅ | ❌ |
| Rejoindre session vidéo | ✅ | ✅ |
| Utiliser caméra/micro | ✅ | ✅ |
| Partager écran | ✅ | ✅ |
| Voir calendrier | ✅ | ✅ |
| Voir historique sessions | ✅ | ✅ |
| Envoyer message | ✅ | ✅ |
| Ajouter compte rendu | ✅ | ❌ |
| Voir compte rendu | ❌ | ✅ |

---

# 34. Modèle de données

## User

```text
User
- id
- first_name
- last_name
- email
- password_hash
- role
- avatar_url
- created_at
- updated_at
```

## TeacherStudent

```text
TeacherStudent
- id
- teacher_id
- student_id
- status
- created_at
```

## Course

```text
Course
- id
- teacher_id
- title
- description
- thumbnail_url
- category
- level
- status
- created_at
- updated_at
```

## Module

```text
Module
- id
- course_id
- title
- description
- position
```

## Lesson

```text
Lesson
- id
- module_id
- title
- description
- type
- video_url
- pdf_url
- duration
- position
```

## StudentCourse

```text
StudentCourse
- id
- student_id
- course_id
- progress
- enrolled_at
```

## LessonProgress

```text
LessonProgress
- id
- student_id
- lesson_id
- status
- progress
- last_position
- completed_at
```

---

# 35. Modèle de données — Sessions vidéo

## Session

```text
Session
- id
- teacher_id
- course_id
- title
- description
- start_at
- end_at
- duration
- status
- room_id
- created_at
```

## SessionParticipant

```text
SessionParticipant
- id
- session_id
- student_id
- invited_at
- joined_at
- left_at
- duration
- attendance_status
```

## VideoRoom

```text
VideoRoom
- id
- session_id
- provider
- room_identifier
- status
- started_at
- ended_at
```

## SessionNote

```text
SessionNote
- id
- session_id
- teacher_id
- student_id
- content
- created_at
```

---

# 36. Architecture fonctionnelle

```text
                    PLATEFORME
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   COURS             SESSIONS         ÉTUDIANTS
        │                │                │
        │          ┌─────┴─────┐          │
        │          │           │          │
     Vidéos      Planning    Vidéo     Progression
     PDF         Rappels     Live      Présence
     Modules     Historique  Audio     Activité
     Leçons      Notes       Chat
        │          │           │
        └──────────┴───────────┘
                   │
              NOTIFICATIONS
                   │
                MESSAGERIE
```

---

# 37. Architecture technique

Architecture recommandée :

```text
                 WEB / MOBILE
                     │
                     ▼
               FRONTEND APP
                     │
                     ▼
                  API
                     │
        ┌────────────┼────────────┐
        │            │            │
      Auth         Courses      Sessions
        │            │            │
        └────────────┼────────────┘
                     │
                  DATABASE
                 PostgreSQL
                     │
          ┌──────────┴──────────┐
          │                     │
      File Storage         Video Service
      Vidéos / PDF         Audio / Vidéo
```

---

# 38. Technologie vidéo

La vidéo en temps réel doit être basée sur une technologie adaptée à la communication temps réel, par exemple **WebRTC** ou un service spécialisé compatible WebRTC.

Le service vidéo doit gérer :

- connexion des participants ;
- audio ;
- vidéo ;
- qualité réseau ;
- reconnexion ;
- salle privée ;
- sécurité ;
- partage d'écran.

Pour le MVP, il est préférable d'utiliser un service spécialisé plutôt que de développer toute l'infrastructure vidéo temps réel soi-même.

---

# 39. Sécurité des sessions

Chaque session doit posséder une salle privée.

Un étudiant ne doit pas pouvoir rejoindre une session à laquelle il n'est pas invité.

Le serveur doit vérifier :

```text
Utilisateur connecté ?
       ↓
Session existante ?
       ↓
Utilisateur autorisé ?
       ↓
Session active ?
       ↓
Autoriser l'accès
```

Les liens ou tokens d'accès à une salle vidéo doivent être temporaires et sécurisés.

---

# 40. Stockage des vidéos et PDF

Les vidéos et documents ne doivent pas être stockés directement dans la base de données.

Architecture :

```text
Application
     │
     ├── Database
     │
     └── Storage
           ├── Videos
           ├── PDFs
           └── Images
```

Les permissions d'accès doivent être contrôlées par le backend.

---

# 41. Notifications

Le système de notifications doit être centralisé.

```text
Notification
- id
- user_id
- type
- title
- content
- data
- read_at
- created_at
```

Types :

```text
NEW_COURSE
NEW_SESSION
SESSION_REMINDER
SESSION_STARTED
SESSION_CANCELLED
NEW_MESSAGE
SESSION_SUMMARY
COURSE_COMPLETED
```

---

# 42. MVP

La première version doit rester focalisée.

## Authentification

- inscription ;
- connexion ;
- récupération mot de passe ;
- rôles.

## Professeur

- dashboard ;
- gestion étudiants ;
- invitation étudiants ;
- création cours ;
- modules ;
- leçons ;
- vidéos ;
- PDF ;
- attribution cours ;
- calendrier ;
- création sessions vidéo ;
- salle vidéo ;
- historique ;
- compte rendu.

## Étudiant

- dashboard ;
- mes cours ;
- vidéos ;
- PDF ;
- progression ;
- calendrier ;
- sessions vidéo ;
- historique ;
- notifications.

## Session vidéo MVP

La salle doit absolument supporter :

- caméra ;
- microphone ;
- vidéo ;
- audio ;
- rejoindre/quitter ;
- chat ;
- chronomètre ;
- présence.

---

# 43. V2

Après validation du MVP :

- partage d'écran ;
- tableau blanc ;
- partage de fichiers pendant la session ;
- enregistrement vidéo ;
- transcription ;
- sous-titres ;
- quiz ;
- exercices ;
- devoirs ;
- notation ;
- statistiques avancées ;
- application mobile ;
- notifications push.

---

# 44. V3 — Monétisation

La plateforme pourra ensuite permettre aux professeurs de vendre :

### Cours

```text
Mathématiques Niveau 1
49 €

[ Acheter ]
```

### Sessions individuelles

```text
Session individuelle
60 minutes
30 €

[ Réserver ]
```

### Packs

```text
Pack 5 sessions
125 €

Pack 10 sessions
230 €
```

### Abonnements

```text
Basic
9 €/mois

Pro
19 €/mois

Premium
39 €/mois
```

---

# 45. User Stories — Professeur

### US-P01

En tant que professeur, je veux créer un cours afin de proposer du contenu pédagogique à mes étudiants.

### US-P02

En tant que professeur, je veux organiser mon cours en modules et leçons afin de structurer mon enseignement.

### US-P03

En tant que professeur, je veux ajouter des vidéos afin de proposer des cours enregistrés.

### US-P04

En tant que professeur, je veux ajouter des PDF afin de fournir des documents pédagogiques.

### US-P05

En tant que professeur, je veux inviter des étudiants afin de les intégrer à mon espace.

### US-P06

En tant que professeur, je veux attribuer un cours à un étudiant afin de contrôler son accès.

### US-P07

En tant que professeur, je veux programmer une session vidéo afin d'organiser un cours en direct.

### US-P08

En tant que professeur, je veux rejoindre une salle vidéo avec mon étudiant afin de donner un cours en direct.

### US-P09

En tant que professeur, je veux voir la présence de mon étudiant afin de savoir s'il a participé à la session.

### US-P10

En tant que professeur, je veux ajouter un compte rendu après la session afin de garder une trace du cours.

### US-P11

En tant que professeur, je veux suivre la progression de mes étudiants afin d'adapter mon enseignement.

---

# 46. User Stories — Étudiant

### US-S01

En tant qu'étudiant, je veux accéder à mes cours afin de consulter mon programme.

### US-S02

En tant qu'étudiant, je veux regarder une vidéo afin d'apprendre le contenu.

### US-S03

En tant qu'étudiant, je veux consulter un PDF afin de travailler mes cours.

### US-S04

En tant qu'étudiant, je veux retrouver ma position dans une vidéo afin de reprendre mon apprentissage.

### US-S05

En tant qu'étudiant, je veux voir ma progression afin de savoir où j'en suis.

### US-S06

En tant qu'étudiant, je veux voir mes prochaines sessions afin de connaître mon planning.

### US-S07

En tant qu'étudiant, je veux recevoir un rappel avant une session afin de ne pas l'oublier.

### US-S08

En tant qu'étudiant, je veux rejoindre une session vidéo afin de suivre mon cours avec mon professeur.

### US-S09

En tant qu'étudiant, je veux utiliser mon microphone et ma caméra afin d'interagir avec mon professeur.

### US-S10

En tant qu'étudiant, je veux consulter le compte rendu d'une session afin de connaître les points travaillés et les exercices à faire.

---

# 47. Critères d'acceptation — Session vidéo

Une session est correctement créée lorsque :

- le professeur est authentifié ;
- un étudiant est sélectionné ;
- une date est définie ;
- une heure est définie ;
- une durée est définie ;
- la session est enregistrée.

Une session est accessible lorsque :

- l'utilisateur est authentifié ;
- l'utilisateur appartient à la session ;
- la session est dans une période autorisée.

Une session est considérée comme terminée lorsque :

- tous les participants ont quitté la salle ;
- ou l'heure de fin est atteinte ;
- le statut passe à `COMPLETED`.

La présence est automatiquement enregistrée.

---

# 48. Critères d'acceptation — Cours

Un étudiant peut accéder à un cours uniquement si :

```text
StudentCourse existe
        +
Course.status = PUBLISHED
```

Une vidéo peut être regardée uniquement par un utilisateur autorisé.

Une progression doit être sauvegardée automatiquement.

---

# 49. Navigation — Professeur

```text
🏠 Dashboard

📚 Mes cours
   ├── Tous les cours
   ├── Créer un cours
   └── Brouillons

👨‍🎓 Mes étudiants
   ├── Tous
   └── Ajouter

🎥 Sessions
   ├── Calendrier
   ├── À venir
   ├── En direct
   └── Historique

💬 Messages

🔔 Notifications

⚙️ Paramètres
```

---

# 50. Navigation — Étudiant

```text
🏠 Accueil

📚 Mes cours

🎥 Sessions
   ├── À venir
   ├── En direct
   └── Historique

📅 Calendrier

💬 Messages

🔔 Notifications

👤 Mon profil
```

---

# 51. Parcours complet du professeur

```text
Créer un compte
      ↓
Créer son profil
      ↓
Créer un cours
      ↓
Créer les modules
      ↓
Ajouter vidéos / PDF
      ↓
Inviter les étudiants
      ↓
Attribuer les cours
      ↓
Programmer une session
      ↓
Étudiant reçoit une notification
      ↓
Professeur rejoint la salle
      ↓
Étudiant rejoint la salle
      ↓
🎥 SESSION VIDÉO
      ↓
Fin de session
      ↓
Présence enregistrée
      ↓
Professeur ajoute un compte rendu
      ↓
Étudiant consulte le compte rendu
      ↓
Progression mise à jour
```

---

# 52. Parcours complet de l'étudiant

```text
Créer un compte
      ↓
Accepter invitation
      ↓
Voir ses cours
      ↓
Commencer un cours
      ↓
Regarder une vidéo
      ↓
Consulter un PDF
      ↓
Progression enregistrée
      ↓
Recevoir invitation à une session
      ↓
Recevoir rappel
      ↓
🎥 Rejoindre la session vidéo
      ↓
Cours avec le professeur
      ↓
Session terminée
      ↓
Consulter le compte rendu
      ↓
Continuer son cours
```

---

# 53. Priorités de développement

## P0 — Obligatoire

- Authentification ;
- gestion des rôles ;
- gestion des étudiants ;
- gestion des cours ;
- vidéos ;
- PDF ;
- attribution des cours ;
- progression ;
- sessions vidéo ;
- calendrier ;
- notifications de sessions ;
- présence ;
- historique.

## P1 — Important

- messagerie ;
- compte rendu ;
- partage d'écran ;
- fichiers pendant les sessions ;
- statistiques.

## P2 — Plus tard

- tableau blanc ;
- enregistrement ;
- transcription ;
- quiz ;
- devoirs ;
- certificats ;
- paiements ;
- abonnements ;
- application mobile.

---

# 54. Roadmap

### Phase 1 — Fondation

```text
Auth
Profils
Rôles
Dashboard
Étudiants
```

### Phase 2 — Cours

```text
Cours
Modules
Leçons
Vidéos
PDF
Progression
```

### Phase 3 — Live

```text
Sessions
Calendrier
Salle vidéo
Audio
Caméra
Chat
Présence
Historique
```

### Phase 4 — Communication

```text
Messages
Notifications
Compte rendu
```

### Phase 5 — Évolution

```text
Quiz
Devoirs
Partage écran
Enregistrement
Paiements
Abonnements
Mobile
```

---

# 55. Indicateurs de succès

Les principaux KPIs du produit seront :

### Engagement professeur

- nombre de cours créés ;
- nombre de vidéos publiées ;
- nombre de sessions créées ;
- nombre de sessions réalisées.

### Engagement étudiant

- nombre de cours commencés ;
- taux de complétion ;
- temps de visionnage ;
- nombre de sessions suivies ;
- taux de présence.

### Qualité des sessions

- sessions programmées ;
- sessions réalisées ;
- sessions annulées ;
- absences ;
- durée moyenne des sessions.

---

# 56. Résumé du MVP

Le MVP doit répondre à une question simple :

> **Un professeur peut-il gérer ses étudiants, leur donner accès à ses cours et réaliser des cours vidéo en direct avec eux depuis une seule plateforme ?**

Si la réponse est oui, le MVP remplit son objectif.

Le cœur du produit est donc :

```text
                 PROFESSEUR
                     │
       ┌─────────────┼─────────────┐
       │             │             │
     COURS        ÉTUDIANTS      SESSIONS
       │             │             │
   ┌───┴───┐         │        ┌────┴────┐
   │       │         │        │         │
 VIDÉOS   PDF        │      AUDIO      VIDÉO
   │       │         │        │         │
   └───┬───┘         │        └────┬────┘
       │             │             │
       └─────────────┼─────────────┘
                     │
               PROGRESSION
                     │
               HISTORIQUE
```

**Le produit doit donc être pensé comme une plateforme de cours hybride :**

**📚 Contenu enregistré + 🎥 cours vidéo en direct + 👨‍🎓 gestion des étudiants + 📊 suivi pédagogique.**
# PRD — Plateforme de cours en ligne avec sessions vidéo en direct

**Version :** 2.1  
**Date :** 2026-10-10  
**Statut :** Product Requirements Document — prêt pour la planification d'implémentation  
**Type de produit :** Plateforme SaaS d'enseignement en ligne (contenu enregistré + sessions en direct + suivi pédagogique)  
**Marché :** Maghreb (Tunisie, Algérie, Maroc) + France  
**Langues de l'interface :** FR (défaut), AR (RTL), EN  
**Document précédent :** v1.0 archivée dans `docs/archive/PRD-v1.0.md`  
**Résumé anglais (point d'entrée des plans) :** `docs/superpowers/specs/2026-10-10-plateforme-cours-design.md`

> Ce document est la **source de vérité unique** du produit. Il est écrit pour qu'une équipe de construction compétente puisse planifier et implémenter sans revenir vers le product owner, sauf pour les questions listées en §20. Chaque ligne décide quelque chose ; ce qui n'est pas décidé ici est explicitement laissé au builder (§22).

---

## Historique des versions

| Version | Date | Changements |
|---|---|---|
| 1.0 | 2026-10 | Première rédaction : vision, professeur/étudiant, cours (vidéo/PDF), sessions live, présence, compte rendu, messagerie, modèle de données initial, MVP/V2/V3. |
| 2.0 | 2026-10-10 | Réécriture complète, implémentation-ready. **Ajouts :** multi-tenant (espaces personnels + organisations), rôles Admin d'organisation / Tuteur (parent) / Assistant / Super-admin, matrice de permissions par rôle et par espace, mineurs & consentement parental, conformité RGPD + INPDP (TN) + loi 09-08 (MA) + loi 18-07 (DZ), i18n FR/AR(RTL)/EN, fuseaux horaires & DST, disponibilités + réservation étudiant, récurrence (RRULE), lobby/pré-join/contrôles de salle/reconnexion/repli audio, règles de présence paramétrables, calendrier ICS, rappels multi-canaux, upload reprenable, états de transcodage, URLs signées, filigrane, verrouillage de modules (drip/prérequis), duplication de cours, types de leçons supplémentaires, quiz/devoirs/certificats, messagerie de groupe, analytics avec définitions précises, IA (V2/V3), export/suppression RGPD, journal d'audit, machines à états complètes, modèle de données complet, surface API/WebSocket, exigences non fonctionnelles chiffrées, critères d'acceptation Given/When/Then, découpage en sous-projets. **Corrections v1 :** partage d'écran retiré des permissions MVP ; le professeur voit les comptes rendus ; `UPCOMING` est un état dérivé, non stocké ; `NO_SHOW` uniquement après l'heure de début ; fin de session avec délai de grâce (reconnexion) ; formule de progression définie ; `TeacherStudent` remplacé par `Membership` d'espace. |
| 2.1 | 2026-10-10 | Revue « builder » intégrée. **Nouvelles décisions propriétaire :** D-O5 consentement parental **par espace** (révocation = suspension de l'adhésion de cet espace seulement, pas de purge automatique) ; D-O6 vérification légère des professeurs + garde-fous (email et téléphone vérifiés, code de conduite, bouton de signalement, suspension par le super-admin ; vérification d'identité/diplômes en V2) ; D-O7 pas d'espace personnel automatique pour un professeur invité dans une organisation (`allow_personal_workspaces`) ; D-O8 protection vidéo = jetons porteurs signés 2 h + filigrane visible, sans DRM (risque résiduel accepté). **Arbitrages planificateur :** dépassement de session (fin auto à `end_at + 60`, prolongations 30 min ×2, plafond +120) ; révocation d'inscription (session en cours conservée, participations futures annulées, vérification du jeton de salle) ; base de calcul de la présence (recouvrement fenêtre planifiée / fenêtre live, temps déconnecté jamais compté) ; rappels portés par la session uniquement (suppression de `User.reminder_offsets_min`). **Contradictions corrigées :** activation = cours *publié* ; retrait d'un étudiant (org : admins seulement) ; suppression de cours (DRAFT/ARCHIVED seulement) ; exemple de présence §8.9. Nouvelles entités `AbuseReport`, statut `SUSPENDED_CONSENT_REVOKED`, `User.phone_verified_at`, `Workspace.allow_personal_workspaces`. |

---

## Sommaire

1. [Intention et pourquoi](#1-intention-et-pourquoi)
2. [Objectifs, non-objectifs, anti-objectifs](#2-objectifs-non-objectifs-anti-objectifs)
3. [Contraintes](#3-contraintes)
4. [Décisions](#4-décisions)
5. [Périmètre et priorités](#5-périmètre-et-priorités)
6. [Utilisateurs, rôles et tenancy](#6-utilisateurs-rôles-et-tenancy)
7. [Matrice de permissions](#7-matrice-de-permissions)
8. [Spécification fonctionnelle par domaine](#8-spécification-fonctionnelle-par-domaine)
9. [Navigation et écrans](#9-navigation-et-écrans)
10. [Machines à états](#10-machines-à-états)
11. [Modèle de données](#11-modèle-de-données)
12. [Surface API et événements WebSocket](#12-surface-api-et-événements-websocket)
13. [Architecture technique](#13-architecture-technique)
14. [Exigences non fonctionnelles](#14-exigences-non-fonctionnelles)
15. [Critères d'acceptation (Given/When/Then)](#15-critères-dacceptation)
16. [User stories](#16-user-stories)
17. [Roadmap](#17-roadmap)
18. [Plan de découpage pour l'implémentation](#18-plan-de-découpage-pour-limplémentation)
19. [Risques et mitigations](#19-risques-et-mitigations)
20. [Questions ouvertes pour le product owner](#20-questions-ouvertes-pour-le-product-owner)
21. [Glossaire FR/EN](#21-glossaire-fren)
22. [Ce qui est laissé au builder](#22-ce-qui-est-laissé-au-builder)
23. [Indicateurs de succès](#23-indicateurs-de-succès)

---

# 1. Intention et pourquoi

## 1.1 Le problème

Un professeur indépendant (cours particuliers, soutien scolaire, langues, préparation aux concours) ou une petite structure (école privée, académie, centre de formation) jongle aujourd'hui entre quatre outils : un drive pour les PDF, YouTube/WhatsApp pour les vidéos, Zoom/Meet pour le direct, et un cahier ou un tableur pour la présence, les paiements et le suivi. Résultat : perte de temps, absence de suivi fiable, contenus qui fuient, parents sans visibilité.

## 1.2 La réponse

Une seule application où le professeur :

1. publie des **cours enregistrés** (vidéos, PDF, contenu texte) organisés en modules et leçons ;
2. donne des **sessions vidéo en direct** (individuelles ou collectives) planifiées dans un calendrier, avec rappels automatiques ;
3. dispose d'un **suivi pédagogique** automatique : progression, présence, historique, comptes rendus, alertes sur les étudiants à risque.

L'étudiant (et, s'il est mineur, son tuteur) voit ses cours, ses sessions, sa progression et communique avec le professeur depuis le même endroit.

## 1.3 Pourquoi maintenant, pourquoi ce marché

- Maghreb + France : fort marché du soutien scolaire et des cours en ligne, forte pénétration mobile (Android), connexions parfois instables → le produit doit être **mobile-first, léger, tolérant aux coupures réseau** (reconnexion, repli audio).
- Trilinguisme FR/AR/EN et RTL natif : différenciant face aux outils génériques.
- Les outils génériques (Zoom + Drive + WhatsApp) ne font pas de suivi pédagogique ni de protection des contenus.

## 1.4 Principes de conception

| Principe | Conséquence concrète |
|---|---|
| Le professeur est le client | Le temps de mise en route d'un professeur (compte → premier cours → premier étudiant invité → première session) doit tenir en 15 minutes. |
| Fiabilité avant richesse | Une session en direct qui ne démarre pas est un échec produit. Le live et les rappels sont P0 et doivent être les composants les plus testés. |
| Réseau instable par défaut | Reconnexion automatique, repli audio seul, upload reprenable, PWA avec cache des pages. |
| Multi-tenant dès le premier jour | Chaque ligne « appartenant » à un tenant porte `workspace_id` ; isolation au niveau ligne. Un professeur indépendant est simplement un espace de type `PERSONAL`. |
| Conformité intégrée | Consentement, mineurs, droit d'accès/suppression, journal d'audit : dans le MVP, pas « plus tard ». |
| Fonctionnalité = décision | Tout ce qui est dans ce document a une priorité, un propriétaire de décision et des critères d'acceptation. |

---

# 2. Objectifs, non-objectifs, anti-objectifs

## 2.1 Objectifs (MVP, mesurables à 90 jours après lancement)

| # | Objectif | Mesure cible |
|---|---|---|
| O1 | Un professeur peut gérer étudiants, cours et sessions en direct depuis une seule application. | Activation : ≥ 60 % des professeurs inscrits **publient** 1 cours **et** invitent ≥ 1 étudiant sous 7 jours. |
| O2 | Les sessions en direct sont fiables. | ≥ 98 % des tentatives de connexion à une salle réussissent ; médiane « clic → média distant » < 3 s. |
| O3 | Le suivi pédagogique est automatique et compréhensible. | 100 % des sessions terminées ont une présence calculée sans action manuelle ; ≥ 70 % des sessions terminées ont un compte rendu sous 48 h. |
| O4 | Le produit fonctionne en FR, AR (RTL) et EN, sur mobile. | 0 défaut bloquant RTL en recette ; ≥ 50 % des sessions étudiantes réalisées depuis un mobile sans incident. |
| O5 | Conformité RGPD / INPDP opérationnelle. | Export et suppression de compte fonctionnels ; consentement parental obligatoire pour tout mineur ; registre des traitements rédigé. |

## 2.2 Non-objectifs (volontairement hors MVP, voir roadmap)

- Marketplace publique de cours / découverte / SEO de cours.
- Paiements et abonnements (V3, derrière une abstraction prévue dès maintenant).
- Application mobile native (la PWA couvre le MVP).
- Tableau blanc collaboratif, enregistrement des sessions, IA (V2/V3).
- Intégration LMS externes (SCORM, xAPI, Moodle), SSO entreprise.
- Sessions à grande audience (> 12 étudiants en vidéo) — voir §14.2.

## 2.3 Anti-objectifs (ce que le produit ne doit jamais devenir)

- **Pas un YouTube pédagogique** : pas de contenu public, pas d'algorithme de recommandation inter-professeurs.
- **Pas un Zoom générique** : la salle vidéo n'existe que rattachée à une session planifiée, un professeur, des participants identifiés et une présence calculée.
- **Pas un réseau social** : pas de profils publics, pas de messagerie étudiant ↔ étudiant hors d'un canal de cours modéré par le professeur.
- **Pas de surveillance intrusive** : pas de proctoring, pas de capture d'écran de l'étudiant, pas de suivi de la webcam hors session. Les données de présence et d'activité servent le suivi pédagogique, jamais la notation disciplinaire automatisée.
- **Pas d'IA non sollicitée** : toute fonctionnalité IA est opt-in par espace, signalée à l'utilisateur, et n'entraîne jamais de modèle sur les données des utilisateurs.

---

# 3. Contraintes

## 3.1 Marché et utilisateurs

- Connexions mobiles 3G/4G fréquentes, parfois < 1 Mbit/s en upload : la vidéo doit s'adapter (simulcast, repli audio) ; les uploads doivent être reprenables.
- Appareils majoritairement Android milieu de gamme + ordinateurs portables modestes : budget de performance frontend strict (§14.1).
- Étudiants souvent mineurs (collège/lycée) → consentement parental et compte tuteur.
- WhatsApp est le canal de communication dominant au Maghreb : les rappels WhatsApp sont P1 (V2), pas dans le MVP (coût et validation de modèles de messages).

## 3.2 Légales et réglementaires

| Juridiction | Texte | Conséquences produit |
|---|---|---|
| UE / France | RGPD ; CNIL | Base légale documentée par traitement, consentement explicite pour mineurs < 15 ans (France) — nous appliquons **< 18 ans partout** (décision §4.2), droits d'accès/portabilité/effacement sous 30 jours, registre des traitements, DPA avec sous-traitants, notification de violation sous 72 h, hébergement UE. |
| Tunisie | Loi organique 2004-63 ; INPDP | Déclaration/autorisation préalable auprès de l'INPDP pour le traitement de données personnelles ; autorisation requise pour le transfert de données hors Tunisie (vers l'UE) ; données de mineurs = consentement du tuteur. |
| Maroc | Loi 09-08 ; CNDP | Déclaration auprès de la CNDP ; transfert transfrontalier soumis à autorisation sauf pays à protection adéquate. |
| Algérie | Loi 18-07 ; ANPDP | Déclaration/autorisation ; transfert hors Algérie soumis à autorisation ; obligations de sécurité. |

Conséquence : hébergement principal dans l'UE (décision §4.2), un **registre des traitements** et des **déclarations par pays** sont des livrables du lancement (hors code, mais listés dans les critères de sortie de phase).

## 3.3 Techniques (décision propriétaire, §4.1)

Monorepo TypeScript (pnpm + Turborepo) ; Next.js App Router (web + PWA) ; NestJS ; PostgreSQL + Prisma ; Redis + BullMQ ; stockage objet compatible S3 ; VOD managé avec lecture signée ; LiveKit (WebRTC) avec jetons courts émis par le serveur ; fournisseur d'email transactionnel ; WebSockets pour chat et notifications.

## 3.4 Équipe et délais

Pas de contrainte de date imposée par le propriétaire. Le découpage (§18) suppose une petite équipe (1 à 3 développeurs) et un ordre de construction qui livre une valeur testable à chaque sous-projet.

---

# 4. Décisions

## 4.1 Décisions du product owner (contraignantes)

| ID | Décision |
|---|---|
| D-O1 | **Tenancy : les deux.** Professeur indépendant par défaut (espace personnel) + espace « Organisation » optionnel (école/académie) avec administrateurs et plusieurs professeurs. Modèle multi-tenant dès le premier jour : chaque ligne appartenant à un tenant porte un `workspace_id` ; isolation au niveau ligne. |
| D-O2 | **Stack** : monorepo TypeScript (pnpm + Turborepo) ; Next.js App Router (web + PWA) ; API NestJS ; PostgreSQL + Prisma ; Redis + BullMQ (jobs, rappels, transitions d'état des sessions) ; stockage objet compatible S3 ; VOD managé (Mux ou Cloudflare Stream) avec lecture signée ; LiveKit (WebRTC) pour les salles avec jetons courts émis par le serveur ; fournisseur d'email transactionnel ; WebSockets pour chat/notifications. |
| D-O3 | **Marché** : Maghreb + France. UI FR (défaut), AR (RTL), EN. Planification sensible aux fuseaux (Africa/Tunis, Africa/Algiers, Africa/Casablanca, Europe/Paris…). Conformité RGPD + loi tunisienne (INPDP, 2004-63), équivalents marocain (09-08) et algérien (18-07). Données de mineurs → consentement parental / comptes tuteurs. Paiements plus tard : Stripe + passerelles locales (Konnect, Flouci, CMI) derrière une abstraction. |
| D-O4 | **Périmètre : produit complet, phasé.** Toutes les fonctionnalités de valeur sont spécifiées, le MVP reste serré ; le reste est en V2/V3 avec priorités P0/P1/P2 justifiées. |
| D-O5 | **Consentement parental par espace.** Le consentement du tuteur est donné **par espace** (professeur indépendant ou organisation) ; l'email de consentement nomme l'espace et le professeur. Si un mineur rejoint un second espace, le tuteur consent à nouveau pour cet espace. Une révocation suspend **uniquement l'adhésion de cet espace** (`SUSPENDED_CONSENT_REVOKED`). L'historique pédagogique est conservé pendant la durée légale de rétention ; les données personnelles ne sont purgées qu'à la suppression du compte ou sur demande d'effacement, jamais automatiquement après une révocation. |
| D-O6 | **Vérification des professeurs au MVP = contrôles légers + garde-fous** : email et téléphone vérifiés, acceptation des CGU et d'un code de conduite, bouton « Signaler un abus » dans les salles, la messagerie et les profils, suspension d'un professeur par le super-admin, visibilité des sessions du mineur par son tuteur. Vérification complète d'identité/diplômes en **V2**. |
| D-O7 | **Pas d'espace personnel automatique pour un professeur invité dans une organisation.** Il peut en créer un plus tard, sauf si l'organisation l'interdit (paramètre `allow_personal_workspaces`, défaut `true`). Un professeur qui s'inscrit seul obtient toujours un espace personnel. |
| D-O8 | **Protection des vidéos enregistrées = jetons de lecture signés courts (2 h) + filigrane visible** avec l'email de l'étudiant. Pas de DRM, pas de proxy de lecture lié à l'utilisateur. Les jetons sont des **jetons porteurs** (bearer) : quiconque en possède un peut lire pendant sa validité ; ce risque résiduel est **accepté**. |

## 4.2 Décisions du planificateur (choix du planificateur — à revoir par le propriétaire)

Chaque ligne est marquée **(choix du planificateur)**. Le propriétaire peut en renverser n'importe laquelle ; le reste du document en dépend là où c'est indiqué.

| ID | Décision (choix du planificateur) | Justification | Impact si renversée |
|---|---|---|---|
| D-P1 | **VOD par défaut : Cloudflare Stream ; alternative : Mux.** | Tarification simple et prévisible (stockage + minutes délivrées, pas de frais d'egress), CDN avec points de présence à Tunis, Alger, Casablanca et Paris (latence de lecture), upload direct reprenable (tus), jetons de lecture signés, synergie avec R2 (stockage S3 sans egress). Mux a une meilleure DX et des analytics plus riches (Mux Data) mais coûte plus cher à volume égal. Les deux sont derrière une interface `VideoProvider` (§13.4). | Changer de fournisseur = implémenter l'interface ; aucune autre partie du document ne change. |
| D-P2 | **Capacité d'une salle MVP : 1 professeur + 12 étudiants max** (vidéo bidirectionnelle). V2 : « mode classe » jusqu'à 40 (vidéo professeur seule, étudiants audio + caméra sur demande). | Le SFU LiveKit supporte bien plus ; la limite est le client : 13 tuiles vidéo en simulcast sur un Android milieu de gamme en 4G est le maximum raisonnable, et 12 correspond à une grille 4×3 lisible. Pédagogiquement, au-delà de 12 l'interaction individuelle disparaît. | Augmenter N exige le mode classe (V2). |
| D-P3 | **Minorité = < 18 ans dans toutes les juridictions** ; consentement du tuteur obligatoire avant tout accès au contenu ou aux sessions. | Majorité civile à 18 ans en TN/MA/DZ ; en France le seuil numérique est 15 ans mais un seul seuil simplifie le produit et reste conforme (plus strict). | Paramètre `minor_age_threshold` par pays (prévu dans le modèle, non exposé en UI au MVP). |
| D-P4 | **Hébergement UE (région Paris)** pour la base, le stockage et le SFU principal ; LiveKit Cloud (managé) au MVP, auto-hébergement envisageable ensuite. | Adéquation RGPD, latence acceptable vers le Maghreb (40–80 ms), simplicité opérationnelle. Transfert TN/MA/DZ → UE soumis à autorisation (INPDP/CNDP/ANPDP) : livrable juridique, pas technique. | Hébergement local (TN) = changement d'infrastructure, pas de modèle. |
| D-P5 | **Cycle de vie des sessions** : `LIVE` quand le professeur ouvre la salle ; étudiants en lobby avant ; fin explicite par le professeur, ou automatique après **5 min** de salle vide (grâce de reconnexion) ; reprise possible par le professeur dans les 10 min suivant une fin automatique ; `NO_SHOW` fixé à `end_at` si le professeur n'a jamais ouvert la salle ; **dépassement** : sans prolongation, fin automatique à `end_at + 60 min` avec avertissement à `end_at + 50 min` (« se termine dans 10 min ») ; le professeur peut prolonger de 30 min, **au plus deux fois**, chaque prolongation repoussant la fin automatique de 30 min ; plafond absolu = `end_at` d'origine + 120 min. | Résout le conflit v1 « terminée quand tout le monde quitte » vs reconnexion ; borne les salles oubliées ouvertes. | Paramètres d'espace, modifiables sans migration. |
| D-P6 | **Fenêtres d'accès** : professeur peut ouvrir la salle 15 min avant `start_at` ; étudiants entrent dans le lobby 10 min avant ; entrée tardive autorisée jusqu'à `end_at` (puis refusée sauf si la session est encore `LIVE`). | Correspond aux usages ; évite les salles ouvertes des heures à l'avance. | Paramètres d'espace. |
| D-P7 | **Règles de présence par défaut** : `PRESENT` si première entrée ≤ 10 min après le début de référence **et** présence cumulée ≥ 75 % de la durée effective ; `LATE` si entrée > 10 min et présence ≥ 75 % ; `PARTIAL` si présence entre 25 % et 75 % ; `ABSENT` si < 25 % ou jamais entré. Paramétrable par espace. | Seuils standard du soutien scolaire ; paramétrables. | Aucun impact structurel. |
| D-P21 | **Base de calcul de la présence** : durée effective = recouvrement de la fenêtre planifiée `[start_at, end_at (+ prolongations)]` avec la fenêtre réellement live `[live_started_at, live_ended_at]` ; un professeur qui ouvre la salle en avance ne pénalise jamais un étudiant à l'heure ; présence = somme du temps réellement connecté (± 5 s) ; les coupures de reconnexion < 5 min sont **fusionnées pour l'affichage** en un seul intervalle mais le temps déconnecté **ne compte jamais** comme présence. | Équitable pour l'étudiant, robuste aux ouvertures anticipées et aux reconnexions. | Aucun impact structurel. |
| D-P22 | **Révocation d'une inscription pendant une session** : l'étudiant conserve la session **en cours** jusqu'à ce qu'il la quitte, mais ne peut pas la rejoindre ensuite ; ses participations aux sessions **futures** liées à ce cours sont annulées automatiquement, étudiant et professeur notifiés. Avant d'émettre un jeton de salle, le serveur vérifie : participant de la session **et** adhésion active à l'espace **et** (session sans cours **ou** inscription active). | Évite de couper un cours en direct tout en fermant l'accès dès la sortie. | Aucun. |
| D-P23 | **Rappels portés par la session** : `Session.reminder_offsets_min` est le seul calendrier de rappels ; les jobs restent par session et par offset. Les utilisateurs choisissent les **canaux** (email, in-app, push P1) par type de notification et peuvent se désabonner des rappels, mais ne définissent pas d'offsets personnels. | Un seul calendrier par session = jobs simples et idempotents. | Offsets personnels = V2 au plus tôt. |
| D-P8 | **Formule de progression** : leçon vidéo terminée à ≥ 90 % de durée *unique* visionnée ou marquage manuel ; PDF/texte terminés au marquage manuel (bouton « Terminé ») après ouverture ; progression de module = leçons obligatoires terminées / leçons obligatoires publiées ; progression de cours = idem sur l'ensemble du cours (pas de pondération au MVP). | Simple, explicable à l'étudiant, robuste aux ajouts de leçons (recalcul). | Pondération par durée = V2, champ `weight` prévu. |
| D-P9 | **Rappels par défaut** : J-1 (24 h), 15 min avant, au début. Canaux MVP : in-app + email. Web push P1, WhatsApp/SMS P1 (V2). Préférences par utilisateur et par type. | Conserve la v1 ; aligne les canaux sur ce qui est faisable sans validation externe. | Aucun. |
| D-P10 | **Réservation en libre-service par l'étudiant (disponibilités + booking) = P1 (V2)**, la planification par le professeur (y compris récurrente) = P0. | Le MVP doit valider le cœur (professeur planifie, étudiant rejoint). La réservation est un sous-produit à part entière (politiques, annulation). Modèle de données prévu dès le MVP. | Si remontée en P0 : sous-projet 5b ajouté au MVP, +2 à 3 semaines. |
| D-P11 | **Messagerie MVP = 1:1 professeur ↔ étudiant, texte seul** ; canaux de cours/groupe, pièces jointes, modération = P1. Chat de salle persisté dans le même modèle (`Conversation` de type `SESSION`). | Un seul modèle de messages ; le MVP reste serré. | Aucun. |
| D-P12 | **2FA (TOTP + codes de secours)** : obligatoire pour `SUPER_ADMIN` et pour `OWNER`/`ADMIN` d'un espace `ORGANIZATION` ; disponible pour tous ; une organisation peut l'imposer à ses professeurs (politique d'espace, P1). | Risque proportionné ; ne freine pas l'onboarding des professeurs indépendants. | Si obligatoire pour tous les professeurs : simple changement de politique. |
| D-P13 | **Isolation tenant** : extension Prisma injectant `workspace_id` dans toute requête tenant **et** politiques RLS PostgreSQL (`SET LOCAL app.workspace_id`) en défense en profondeur. | Deux barrières indépendantes contre la fuite inter-tenant, principal risque d'un SaaS multi-tenant. | Retirer RLS = perte d'une barrière, pas de changement fonctionnel. |
| D-P14 | **API REST versionnée `/api/v1`, ressources tenant sous `/workspaces/{workspaceId}/…`, vues agrégées cross-espaces sous `/me/…`.** | Contexte tenant explicite dans l'URL (audit, cache, tests) ; l'étudiant multi-professeurs a besoin d'agrégats. | Alternative : en-tête `X-Workspace-Id` ; même modèle. |
| D-P15 | **Limites d'upload** : vidéo 4 Go / 4 h par fichier ; PDF 50 Mo ; image 5 Mo ; pièce jointe de message 10 Mo. Quota de stockage par espace : 20 Go (personnel), 200 Go (organisation) au MVP, paramétrable. | Évite les abus avant la monétisation ; couvre les usages réels. | Paramètres d'espace. |
| D-P16 | **Chiffres arabes occidentaux (0-9) par défaut en locale AR**, calendrier grégorien, dates au format local. | Usage majoritaire au Maghreb. | Option de locale `ar-MA-u-nu-arab` si demandé. |
| D-P17 | **Fournisseurs IA (V2/V3)** : transcription via fournisseur STT abstrait (défaut à valider : Deepgram ou Whisper hébergé, selon qualité FR/AR darija mesurée) ; génération (résumés, comptes rendus, quiz) via modèles Claude (`claude-opus-5-5` par défaut, `claude-haiku-5-5` pour les tâches de classification bon marché) ; opt-in par espace ; aucune donnée utilisée pour l'entraînement ; contrats DPA. | Qualité en français, support de l'arabe, API simple. | Changement de modèle = configuration. |
| D-P18 | **Invitations par email strictement liées à l'adresse invitée** (un compte connecté sous une autre adresse doit se déconnecter) ; **liens/codes d'invitation de groupe** non liés à une adresse, avec approbation optionnelle du professeur. | Évite qu'un étudiant « capture » l'invitation d'un autre ; les codes de groupe couvrent le cas classe. | Aucun. |
| D-P19 | **Rétention** : messages conservés tant que l'espace est actif ; enregistrements 12 mois (3–24 paramétrable, V2) ; logs applicatifs 30 jours ; journal d'audit 2 ans ; compte supprimé → 30 jours de grâce puis purge ; sauvegardes 30 jours. | Équilibre pédagogique (historique) / minimisation. | Paramètres. |
| D-P20 | **Édition concurrente** : verrouillage optimiste (`version` entier, en-tête `If-Match`, réponse `409`) sur cours, modules, leçons, sessions. | Simple, sans serveur de collaboration. | Collaboration temps réel = V3 au plus tôt. |

---

# 5. Périmètre et priorités

## 5.1 Définition des priorités

| Priorité | Signification | Version cible |
|---|---|---|
| **P0** | Indispensable au lancement du MVP. Sans elle, la question « un professeur peut-il gérer ses étudiants, leur donner accès à ses cours et faire des cours en direct avec eux ? » n'a pas de réponse. | MVP (V1) |
| **P1** | Nécessaire pour vendre à des organisations et retenir les professeurs après le MVP ; les fondations (modèle de données) sont posées au MVP. | V2 |
| **P2** | Différenciation, monétisation, confort. | V3 |

## 5.2 Carte des fonctionnalités

| Domaine | P0 (MVP) | P1 (V2) | P2 (V3) |
|---|---|---|---|
| Comptes & auth | Inscription, connexion, reset, vérification email, vérification téléphone + code de conduite (professeurs), signalement d'abus, suspension d'un professeur, sessions/appareils, 2FA (obligatoire admins) | Vérification d'identité/diplômes des professeurs, 2FA imposée par politique d'espace, connexion Google/Apple | SSO organisation (SAML/OIDC) |
| Tenancy | Espace personnel, espace organisation (création, admins, invitation de professeurs), isolation | Rôle Assistant, politiques d'espace, branding (logo/couleurs), rapports d'organisation | Multi-sites, facturation par organisation |
| Étudiants | Invitation email, lien/code de groupe, import CSV, profil pédagogique, mineurs + consentement tuteur, retrait | Compte tuteur (vue lecture), groupes/classes, champs personnalisés | — |
| Cours & contenu | Cours/modules/leçons ; leçons VIDÉO, PDF, TEXTE ; upload reprenable ; transcodage ; lecture signée ; filigrane visible (lecteur et visionneuse) ; téléchargement PDF par leçon ; verrouillage séquentiel & par module ; attribution | Leçons LIEN, EMBED ; drip par date / jours après inscription ; estampillage serveur des PDF téléchargés ; duplication de cours ; déverrouillage manuel par étudiant | Modèles de cours, pondération des leçons, versions de cours |
| Progression | Formule §8.6, position de lecture, activité | Timeline d'activité détaillée, export | — |
| Planification | Sessions ponctuelles et récurrentes (RRULE), calendrier, fuseaux/DST, détection de conflits, modification/annulation, ICS | Disponibilités + réservation étudiant, politiques d'annulation, liste d'attente | Synchro Google/Outlook bidirectionnelle |
| Salle live | Pré-join (test caméra/micro), lobby, jetons courts, vidéo/audio, chat, minuteur, contrôles professeur (couper micro, retirer), reconnexion, repli audio, 1+12 | Partage d'écran, lever la main, réactions, enregistrement (consentement), mode classe (40) | Tableau blanc, sous-titres live, sous-salles |
| Présence | Calcul automatique §8.9, correction manuelle par le professeur | Export, règles par organisation | — |
| Compte rendu | Compte rendu visible étudiant + note privée, recommandations de leçons, planifier la suite | Modèles de compte rendu, brouillon IA | — |
| Notifications | In-app + email, préférences par type, rappels J-1/15 min/début | Web push, WhatsApp/SMS, digest quotidien | — |
| Messagerie | 1:1 professeur ↔ étudiant, non lus, historique, chat de salle | Canaux de cours, groupes, pièces jointes, accusés de lecture, modération, annonces | — |
| Évaluations | — | Quiz (QCM, V/F, réponse courte), devoirs (dépôt, notation, feedback) | Grilles (rubriques), certificats |
| Analytics | Dashboard professeur (KPIs définis §8.14), dashboard étudiant | Alertes étudiants à risque, exports CSV/PDF, dashboard organisation | Cohortes, comparaisons |
| IA | — | Transcription + résumé de session, brouillon de compte rendu | Génération de quiz, assistant Q/R sur le contenu |
| Conformité | Consentements, export des données, suppression de compte, journal d'audit, registre des traitements | Portail tuteur, rétention paramétrable | — |
| Monétisation | — | — | Produits, commandes, abonnements, Stripe + Konnect/Flouci/CMI |
| Plateforme | Console super-admin minimale (espaces, suspension, santé) | Support (vue lecture), feature flags par espace | — |

## 5.3 Question à laquelle le MVP répond

> Un professeur (indépendant ou membre d'une organisation) peut-il, en FR/AR/EN et depuis un mobile, gérer ses étudiants (y compris mineurs), leur donner accès à ses cours, planifier et réaliser des sessions vidéo en direct fiables, et disposer d'une présence et d'une progression calculées automatiquement ?

---

# 6. Utilisateurs, rôles et tenancy

## 6.1 Modèle de tenancy

```text
Plateforme
 ├── Workspace (type = PERSONAL)        ← professeur indépendant
 │     ├── Membership OWNER   : le professeur
 │     ├── Membership STUDENT : ses étudiants
 │     └── Membership GUARDIAN: tuteurs (lecture)
 │
 └── Workspace (type = ORGANIZATION)    ← école / académie / centre
       ├── Membership OWNER   : fondateur / directeur
       ├── Membership ADMIN   : administrateurs
       ├── Membership TEACHER : professeurs
       ├── Membership ASSISTANT (P1)
       ├── Membership STUDENT
       └── Membership GUARDIAN (P1)
```

Règles :

- **Un `User` est global** (une adresse email = un compte) et peut avoir plusieurs `Membership` : étudiant chez deux professeurs, professeur dans une organisation **et** dans son espace personnel.
- À l'inscription **autonome** (« Je suis professeur »), un professeur obtient automatiquement un espace `PERSONAL` dont il est `OWNER`. Un professeur **invité dans une organisation** n'obtient **pas** d'espace personnel (D-O7) ; il peut en créer un plus tard depuis ses paramètres (« Créer mon espace personnel ») sauf si l'organisation l'interdit (`Workspace.allow_personal_workspaces = false` sur l'organisation ; vérifié pour chacune de ses organisations). Un étudiant inscrit via invitation n'a pas d'espace propre.
- Un espace `ORGANIZATION` est créé par un professeur ou un administrateur depuis ses paramètres (« Créer une organisation ») ; il en devient `OWNER`.
- **Toutes les données pédagogiques appartiennent à un espace** (`workspace_id` non nul) : cours, sessions, inscriptions, messages, médias, comptes rendus, notifications liées, **consentements parentaux et liens tuteur (D-O5)**. Les données globales (profil `User`, préférences de langue/fuseau, consentements CGU/confidentialité, appareils) n'en ont pas.
- L'utilisateur choisit l'espace courant via un sélecteur (en-tête) ; les vues « Mes cours », « Mes sessions » de l'étudiant agrègent tous ses espaces (`/me/…`).
- La suppression d'un espace (par son `OWNER`) est un soft-delete de 30 jours puis purge de toutes ses données tenant (médias compris).

## 6.2 Rôles

| Rôle (code) | FR | Portée | Description |
|---|---|---|---|
| `SUPER_ADMIN` | Super-administrateur | Plateforme (champ `User.platform_role`) | Équipe de la plateforme. Gère les espaces (liste, suspension, quotas), la santé, les feature flags ; traite les signalements d'abus et peut **suspendre un professeur** (D-O6). **N'accède pas** au contenu pédagogique sans « vue support » explicitement journalisée (P1), hors instantané gelé d'un signalement. |
| `OWNER` | Propriétaire | Espace | Créateur de l'espace. Tous les droits `ADMIN` + suppression de l'espace + transfert de propriété + facturation (V3). Dans un espace `PERSONAL`, le propriétaire **est** le professeur (il a aussi tous les droits `TEACHER`). |
| `ADMIN` | Administrateur d'organisation | Espace `ORGANIZATION` | Gère membres, professeurs, étudiants, paramètres, voit tous les cours/sessions/présences/comptes rendus de l'organisation en lecture, peut réaffecter un cours à un autre professeur. Ne donne pas de cours lui-même sauf s'il a aussi `TEACHER`. |
| `TEACHER` | Professeur | Espace | Crée et gère ses cours, ses étudiants (dans une organisation : les étudiants que l'admin lui affecte ou qu'il invite), ses sessions, ses comptes rendus. Voit uniquement ses propres étudiants/cours/sessions dans une organisation (sauf cours partagés, P1). |
| `ASSISTANT` (P1) | Assistant pédagogique | Espace | Rattaché à un ou plusieurs professeurs. Peut co-animer une session (contrôles de salle), corriger des devoirs, répondre aux messages, marquer la présence ; ne peut ni supprimer un cours ni gérer les membres. |
| `STUDENT` | Étudiant | Espace | Accède aux cours attribués, sessions auxquelles il est invité, sa progression, messagerie avec ses professeurs. |
| `GUARDIAN` (consentement P0, compte P1) | Tuteur / parent | Espace, lié à ≥ 1 étudiant | Lecture seule : progression, sessions (calendrier), présence, comptes rendus de ses enfants ; gère le consentement ; peut envoyer un message au professeur (P1). Ne rejoint pas les salles. |

Règles de cumul : un utilisateur a **au plus un `Membership` par espace** ; le rôle est unique par espace. Un professeur d'organisation qui a aussi besoin d'administrer est `ADMIN` avec le flag `can_teach = true` (la matrice §7 traite `ADMIN + can_teach` comme `ADMIN ∪ TEACHER`).

## 6.3 Personas de référence

- **Mohamed, 34 ans, professeur de mathématiques indépendant à Sfax** : 30 étudiants de lycée, cours en groupes de 4 à 8, 1:1 pour les terminales. Travaille depuis un portable, les étudiants depuis Android. Besoin : zéro friction, rappels fiables, les parents veulent savoir si leur enfant assiste.
- **Académie Nour, Casablanca** : 6 professeurs de langues, 180 étudiants dont 60 % mineurs. Besoin : un admin qui voit tout, des professeurs qui ne voient que leurs étudiants, présence exportable.
- **Léa, 29 ans, Lyon, cours de FLE en ligne** : étudiants adultes au Maghreb et en France, fuseaux différents, 1:1 surtout, veut que les étudiants réservent eux-mêmes (P1).
- **Ahmed, 16 ans, Tunis, étudiant** : téléphone Android, connexion partagée, rejoint depuis le bus. Besoin : rejoindre en un clic, repli audio, reprendre une vidéo là où il s'était arrêté.
- **Mme Ben Ali, mère d'Ahmed** : veut une visibilité sans gérer un outil : un email de consentement, puis (V2) un accès lecture.

---

# 7. Matrice de permissions

Légende : ✅ autorisé · 🔒 autorisé sur ses propres ressources seulement (cours qu'il possède, étudiants qui lui sont rattachés, sessions qu'il anime, enfants qui lui sont liés) · 👁 lecture seule · ❌ interdit · (P1)/(P2) = non disponible au MVP.

Toute permission est **évaluée dans un espace donné** (le `Membership` de l'utilisateur dans l'espace de la ressource). `SUPER_ADMIN` est hors matrice (console plateforme uniquement).

| Capacité | OWNER / ADMIN (org) | TEACHER (ou OWNER d'espace personnel) | ASSISTANT (P1) | STUDENT | GUARDIAN |
|---|---|---|---|---|---|
| **Espace** | | | | | |
| Modifier paramètres de l'espace (présence, fenêtres, fuseau par défaut) | ✅ | ✅ (espace personnel) / ❌ (org) | ❌ | ❌ | ❌ |
| Inviter / retirer un professeur, un admin | ✅ | ❌ | ❌ | ❌ | ❌ |
| Supprimer l'espace, transférer la propriété | OWNER seul | OWNER seul | ❌ | ❌ | ❌ |
| Voir le journal d'audit de l'espace | ✅ | ✅ (personnel) | ❌ | ❌ | ❌ |
| **Étudiants** | | | | | |
| Inviter un étudiant (email, lien, CSV) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Affecter un étudiant à un professeur (org) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Voir le profil pédagogique | ✅ | 🔒 | 🔒 | 👁 (le sien) | 👁 (ses enfants) |
| Modifier les informations d'un étudiant | ✅ | 🔒 | ❌ | ✅ (le sien, hors email vérifié) | ❌ |
| Retirer un étudiant de l'espace | ✅ (org : admins/owner seulement) | ✅ (espace personnel, en tant qu'OWNER) / ❌ (org) | ❌ | ❌ | ❌ |
| Signaler un abus (salle, message, profil) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Traiter un signalement | ✅ (de son organisation) ; super-admin pour la plateforme | ❌ | ❌ | ❌ | ❌ |
| **Cours** | | | | | |
| Créer un cours | ✅ (si `can_teach`) | ✅ | ❌ | ❌ | ❌ |
| Modifier / publier / archiver | ✅ | 🔒 | ❌ | ❌ | ❌ |
| Supprimer un cours | ✅ | 🔒 | ❌ | ❌ | ❌ |
| Ajouter vidéo / PDF / texte | ✅ | 🔒 | 🔒 (P1) | ❌ | ❌ |
| Attribuer / retirer un cours à un étudiant | ✅ | 🔒 | ❌ | ❌ | ❌ |
| Réaffecter un cours à un autre professeur | ✅ | ❌ | ❌ | ❌ | ❌ |
| Consulter un cours (contenu) | 👁 | 🔒 | 🔒 | ✅ (si inscrit et publié) | ❌ (titres et progression seulement) |
| Télécharger un PDF | ✅ | 🔒 | 🔒 | ✅ si `allow_download` | ❌ |
| Voir la progression d'un étudiant | ✅ | 🔒 | 🔒 | ✅ (la sienne) | 👁 (ses enfants) |
| **Sessions** | | | | | |
| Programmer / modifier / annuler une session | ✅ | 🔒 | ❌ | ❌ (réserver : P1) | ❌ |
| Ouvrir la salle (démarrer `LIVE`), terminer la session | ❌ (sauf `can_teach`, 🔒) | 🔒 | 🔒 (co-animateur, P1) | ❌ | ❌ |
| Rejoindre la salle | 👁 (observateur, P1) | 🔒 | 🔒 | ✅ si participant | ❌ |
| Caméra / micro | ✅ | ✅ | ✅ | ✅ | — |
| Partager l'écran (P1) | ✅ | ✅ | ✅ | ✅ si autorisé par le professeur | — |
| Couper le micro d'un participant, retirer un participant | ❌ | 🔒 | 🔒 | ❌ | ❌ |
| Voir le calendrier | ✅ (toute l'org) | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants) |
| Voir l'historique des sessions | ✅ | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants) |
| Voir / corriger la présence | ✅ / ✅ | 🔒 / 🔒 | 🔒 / 🔒 | 👁 (la sienne) | 👁 |
| **Compte rendu** | | | | | |
| Rédiger / modifier un compte rendu | ❌ | 🔒 | 🔒 (brouillon, P1) | ❌ | ❌ |
| Voir le compte rendu (partie visible étudiant) | 👁 | 🔒 | 🔒 | ✅ (le sien) | 👁 (ses enfants) |
| Voir la note privée du professeur | ❌ | 🔒 | ❌ | ❌ | ❌ |
| **Messagerie** | | | | | |
| Message 1:1 avec un étudiant | ✅ | 🔒 | 🔒 | ✅ (ses professeurs) | ✅ (professeurs de ses enfants, P1) |
| Canal de cours (P1) : écrire / modérer | ✅ / ✅ | 🔒 / 🔒 | 🔒 / 🔒 | ✅ si inscrit / ❌ | ❌ |
| Message étudiant ↔ étudiant | ❌ | ❌ | ❌ | ❌ (hors canal de cours) | ❌ |
| **Évaluations (P1)** | | | | | |
| Créer quiz / devoir | ✅ | 🔒 | ❌ | ❌ | ❌ |
| Répondre / déposer | ❌ | ❌ | ❌ | ✅ | ❌ |
| Noter / commenter | ✅ | 🔒 | 🔒 | ❌ | ❌ |
| Voir ses résultats | 👁 | 🔒 | 🔒 | ✅ | 👁 |
| **Analytics** | | | | | |
| Dashboard professeur | ✅ (le sien si `can_teach`) | 🔒 | 🔒 | ❌ | ❌ |
| Dashboard organisation (P1) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Exports CSV/PDF (P1) | ✅ | 🔒 | ❌ | ✅ (ses données, RGPD) | ✅ (données de ses enfants) |
| **Compte** | | | | | |
| Exporter ses données personnelles | ✅ | ✅ | ✅ | ✅ (mineur : via tuteur ou lui-même) | ✅ |
| Supprimer son compte | ✅ (après transfert de propriété) | ✅ (supprime l'espace personnel) | ✅ | ✅ | ✅ (si aucun lien actif avec un mineur, sinon transfert) |

Corrections par rapport à la v1 : le professeur **voit** les comptes rendus (il les rédige) ; le partage d'écran est **P1**, donc absent des permissions MVP ; l'étudiant ne programme pas de session au MVP (réservation P1).

---

# 8. Spécification fonctionnelle par domaine

Chaque sous-section indique la priorité de ses éléments. Les critères d'acceptation détaillés sont en §15 ; les identifiants `AC-…` y renvoient.

## 8.1 Comptes, authentification et onboarding

### 8.1.1 Inscription (P0)

- Deux chemins : **« Je suis professeur »** (crée un `User` + espace `PERSONAL`) et **« J'ai une invitation »** (crée un `User` rattaché à l'espace invitant). Un étudiant ne peut pas s'inscrire sans invitation ni code (anti-objectif « pas un réseau social »).
- Champs : prénom, nom, email, mot de passe, langue (pré-remplie depuis le navigateur), fuseau (auto-détecté, modifiable), date de naissance **(étudiants seulement, obligatoire)**, acceptation CGU + politique de confidentialité (consentement `TERMS` + `PRIVACY`, version horodatée).
- Vérification de l'email par lien (24 h). Avant vérification : accès à l'application limité à la page « Vérifiez votre email » et au renvoi du lien.
- Mot de passe : ≥ 12 caractères, pas de règles de composition, rejet des mots de passe compromis (vérification k-anonymity HIBP) et des 10 000 plus courants, hachage argon2id.
- Mineur (< 18 ans à l'inscription, D-P3) : l'étudiant saisit l'email du tuteur ; son adhésion à l'espace passe en `PENDING_GUARDIAN_CONSENT` ; voir §8.3.5.
- **Professeurs (D-O6)** : numéro de téléphone obligatoire et vérifié par OTP SMS (`User.phone_verified_at`), acceptation du **code de conduite** (consentement `CODE_OF_CONDUCT`, versionné) en plus des CGU. Tant que l'email et le téléphone ne sont pas vérifiés et le code de conduite accepté, le professeur ne peut ni inviter d'étudiant ni publier de cours ni ouvrir de salle (`403 TEACHER_NOT_VERIFIED`). Un professeur invité dans une organisation passe par les mêmes vérifications lors de l'acceptation de l'invitation, et n'obtient pas d'espace personnel (D-O7).

### 8.1.2 Connexion et sessions (P0)

- Email + mot de passe ; option « se souvenir de cet appareil » (30 jours).
- Jeton d'accès JWT 15 min + jeton de rafraîchissement rotatif 30 jours en cookie `httpOnly; Secure; SameSite=Lax`, détection de réutilisation (invalidation de la famille).
- Liste des appareils/sessions actives dans les paramètres, révocation individuelle et globale (« Déconnecter partout »).
- Limitation : 5 tentatives/min par couple IP+email, puis backoff exponentiel ; verrouillage 15 min après 10 échecs avec email d'alerte.
- 2FA TOTP (+ 10 codes de secours) : obligatoire pour `SUPER_ADMIN`, `OWNER`/`ADMIN` d'organisation (forcée à la première connexion suivant l'obtention du rôle) ; optionnelle sinon (D-P12).
- Réinitialisation du mot de passe par lien (1 h, usage unique) ; invalide toutes les sessions.
- Connexion sociale Google/Apple : P1.

### 8.1.3 Onboarding professeur (P0)

Checklist persistante sur le dashboard tant qu'elle n'est pas complète :

```text
Bienvenue Mohamed 👋   Votre espace est prêt à 2/5

[✓] Compléter mon profil (photo, matière, bio)
[✓] Vérifier mon email
[ ] Créer mon premier cours          → 3 min
[ ] Inviter mes étudiants            → 1 min
[ ] Programmer ma première session   → 1 min
```

Chaque item ouvre directement l'action. Objectif : première session programmée en < 15 min (O1).

### 8.1.4 Onboarding étudiant (P0)

Lien d'invitation → page d'accueil nominative (« Mohamed vous invite à rejoindre *Mathématiques Niveau 1* ») → création du compte (ou connexion si l'adresse a déjà un compte) → **test matériel optionnel** (caméra/micro/connexion, réutilisé par le pré-join §8.8.2) → « Mes cours ».

### 8.1.5 Profil (P0)

`User` : prénom, nom, avatar, langue, fuseau, téléphone (obligatoire et vérifié pour les professeurs ; optionnel sinon, utilisé pour WhatsApp/SMS P1), date de naissance (étudiants). Profil professeur par espace (`TeacherProfile`) : matière(s), bio, lien externe. Changement d'email : double confirmation (ancienne et nouvelle adresse) ; changement de téléphone d'un professeur : nouvelle vérification OTP.

### 8.1.6 Garde-fous et signalement d'abus (P0, D-O6)

- Bouton « Signaler » sur : un participant dans la salle, un message, un profil professeur ou étudiant, un cours. Crée un `AbuseReport` (catégorie : `HARASSMENT`, `INAPPROPRIATE_CONTENT`, `IMPERSONATION`, `MINOR_SAFETY`, `OTHER` ; description ; référence de l'entité ; captures facultatives). Le signalant reçoit un accusé ; l'entité et le contexte sont gelés en lecture pour instruction (le message signalé n'est plus supprimable par son auteur).
- Traitement : signalement dans une organisation → visible par les admins de l'organisation **et** par le super-admin ; dans un espace personnel → super-admin seulement (un professeur indépendant n'instruit pas les signalements qui le visent). Catégorie `MINOR_SAFETY` → toujours remontée au super-admin, délai de première réponse 24 h.
- Sanctions : super-admin peut **suspendre un professeur** (`User.status = SUSPENDED`, motif) : déconnexion immédiate, ses sessions futures sont annulées avec notification aux participants et admins, ses cours restent accessibles en lecture aux inscrits (l'organisation peut les réaffecter), son espace personnel passe en lecture seule. Réactivation journalisée.
- Vérification complète d'identité et de diplômes : **V2** (roadmap §17), avec badge « profil vérifié ».

## 8.2 Espaces et organisations

### 8.2.1 Espace personnel (P0)

Créé automatiquement, nommé « Espace de {prénom} », renommable. Paramètres de l'espace (valeurs par défaut en §4.2) :

| Paramètre | Clé | Défaut | Portée |
|---|---|---|---|
| Fuseau par défaut des sessions | `default_timezone` | fuseau du propriétaire | sessions |
| Fenêtre d'ouverture professeur | `teacher_join_window_min` | 15 | salle |
| Fenêtre d'entrée étudiant | `student_join_window_min` | 10 | salle |
| Grâce salle vide | `empty_room_grace_min` | 5 | salle |
| Seuil retard | `late_threshold_min` | 10 | présence |
| Seuil présent | `present_ratio` | 0,75 | présence |
| Seuil partiel | `partial_ratio` | 0,25 | présence |
| Leçons séquentielles par défaut | `default_sequential_lessons` | false | cours |
| Téléchargement PDF par défaut | `default_pdf_download` | false | contenu |
| Rappels pré-remplis dans le formulaire de session | `default_reminder_offsets_min` | [1440, 15, 0] | sessions (copié dans `Session.reminder_offsets_min` à la création ; D-P23) |

### 8.2.2 Organisation (P0 création & rôles ; P1 fonctions avancées)

- Création depuis « Paramètres → Créer une organisation » : nom, pays, fuseau, logo (P1). Le créateur devient `OWNER`.
- Invitation de professeurs et d'admins par email (`Invitation` avec `role`), même mécanique que les étudiants (§8.3). Un professeur invité **n'obtient pas d'espace personnel** (D-O7) ; le paramètre d'organisation `allow_personal_workspaces` (défaut `true`) autorise ou interdit à ses professeurs d'en créer un ; passer ce paramètre à `false` n'affecte pas les espaces personnels déjà existants (ils sont listés à l'admin, qui peut demander leur fermeture au professeur — pas de suppression forcée).
- **Affectation** : l'admin affecte des étudiants à un ou plusieurs professeurs (`TeacherStudentAssignment`) ; un professeur ne voit que ses étudiants affectés ou invités par lui. L'admin voit tout.
- Réaffectation d'un cours à un autre professeur (`Course.owner_user_id`), avec journal d'audit.
- P1 : politiques (2FA imposée, rétention, filigrane obligatoire), branding (logo, couleur), dashboard organisation, rôle `ASSISTANT`, cours partagés entre professeurs (`CourseTeacher`).
- Départ d'un professeur d'une organisation : ses cours et sessions restent dans l'organisation (propriété de l'espace) ; l'admin doit réaffecter les sessions futures ou les annuler (assistant de départ, P1 ; au MVP : blocage du retrait tant qu'il reste des sessions futures non réaffectées).

## 8.3 Étudiants et invitations

### 8.3.1 Liste et profil pédagogique (P0)

```text
Mes étudiants (32)                       [+ Inviter] [Importer CSV]

Nom            Cours                 Progression  Présence  Dernière activité
Ahmed Ben Ali  Maths N1, Physique    75 %         92 %      aujourd'hui
Sarah Trabelsi Physique              42 %         80 %      il y a 3 jours
Yassine Gharbi Algèbre               90 %         100 %     hier
Lina Mansour   —                     —            —         invitation en attente ⏳
```

Profil : identité, statut (actif / en attente de consentement / consentement refusé ou révoqué pour cet espace / invitation en attente / retiré), tuteur lié (par espace), cours attribués (+ attribuer/retirer), progression par cours, sessions passées et à venir, présence (taux + détail), comptes rendus, messages (raccourci), historique d'activité (P0 : 50 derniers événements ; P1 : timeline complète et export).

### 8.3.2 Invitation par email (P0)

```text
Professeur ──▶ Inviter (email, prénom optionnel, cours à attribuer, message)
                   │
                   ▼
           Invitation PENDING (jeton haché, expire 7 j)
                   │  email « Mohamed vous invite… »
                   ▼
   ┌───────────────┴───────────────┐
   │ Pas de compte                 │ Compte existant avec cet email
   ▼                               ▼
Créer le compte (email verrouillé)  Se connecter → « Rejoindre l'espace ? »
   │                               │
   └───────────────┬───────────────┘
                   ▼
        Membership STUDENT ACTIVE + attribution des cours listés
        Invitation ACCEPTED, notification au professeur
```

Règles :

- Jeton aléatoire 32 octets, stocké haché (SHA-256) ; lien `/invite/{token}` ; expiration 7 jours ; usage unique.
- **Adresse liée (D-P18)** : si l'utilisateur connecté a un autre email, la page propose « Se déconnecter et continuer avec {email invité} ».
- Renvoi : génère un nouveau jeton, invalide l'ancien, renvoie l'email ; limité à 1 renvoi / 10 min / invitation.
- Expirée : page « Invitation expirée — demandez à votre professeur de la renvoyer » ; le professeur voit le statut `EXPIRED` et un bouton « Renvoyer ».
- Révocation par le professeur : `REVOKED`, lien inactif.
- Adresse déjà membre de l'espace : erreur « déjà membre » immédiate.
- Adresse appartenant à un professeur de l'espace : refus (un professeur n'est pas étudiant du même espace).
- Mineur : l'invitation peut porter `guardian_email` pré-rempli par le professeur ; sinon demandé à l'étudiant à l'inscription (§8.3.5).

### 8.3.3 Lien et code d'invitation de groupe (P0)

- Le professeur crée un `InviteLink` : code court lisible (8 caractères, sans ambiguïté O/0/I/1), lien `/join/{code}`, limite d'utilisations (défaut 50), expiration (défaut 30 jours), cours auto-attribués, `requires_approval` (défaut : false pour l'espace personnel, true pour les organisations).
- Un étudiant qui utilise le code devient `ACTIVE` ou `PENDING_APPROVAL` ; le professeur approuve/refuse depuis la liste.
- Désactivation à tout moment ; les comptes déjà créés restent.

### 8.3.4 Import CSV (P0 minimal, P1 complet)

- Colonnes : `email` (obligatoire), `first_name`, `last_name`, `guardian_email`, `birth_date`, `course_codes` (séparés par `;`).
- Prévisualisation : lignes valides / en erreur (email invalide, doublon, déjà membre) ; l'utilisateur confirme ; une invitation par ligne valide ; rapport téléchargeable.
- Limite 500 lignes par import au MVP ; traitement en job BullMQ avec progression.

### 8.3.5 Mineurs et consentement du tuteur (P0)

Le consentement est **par espace** (D-O5) : il protège la relation entre le mineur et un professeur ou une organisation donnés.

```text
Étudiant mineur rejoint l'espace de Mohamed (invitation ou code)
        │
        ▼
Membership(espace Mohamed) = PENDING_GUARDIAN_CONSENT
Email au tuteur : « Ahmed souhaite rejoindre l'espace de Mohamed (Mathématiques, Sfax) »
        │                    (lien signé, 14 jours, nomme l'espace et le professeur)
        ▼
Tuteur : identité (nom, lien de parenté), lecture notice mineurs,
         case « J'autorise Ahmed à utiliser l'espace de Mohamed »,
         (option) créer un compte tuteur (P1)
        │
        ▼
Consent GUARDIAN_PARENTAL (workspace_id = espace Mohamed ; IP, horodatage, version)
GuardianLink(student, espace Mohamed) = ACTIVE
Membership → ACTIVE ; notification étudiant + professeur
        │
        ▼
Ahmed rejoint plus tard l'Académie Nour → nouveau cycle complet pour cet espace
```

- Tant que le consentement n'est pas donné pour un espace : l'étudiant peut se connecter, voit cet espace en page d'attente et peut renvoyer l'email au tuteur ; aucun cours ni session **de cet espace** accessible ; ses autres espaces consentis fonctionnent normalement.
- Le professeur voit le statut et peut saisir/corriger l'email du tuteur (audité).
- Refus ou absence de réponse à 14 jours : `Membership → SUSPENDED_NO_CONSENT` pour cet espace ; l'étudiant et le professeur sont notifiés ; le professeur peut relancer (nouveau lien, nouveau délai de 14 jours). **Aucune purge automatique** : les données personnelles ne sont supprimées qu'à la suppression du compte ou sur demande d'effacement (§8.16.2).
- Révocation par le tuteur (lien dans l'email de confirmation, puis portail P1) : `Membership → SUSPENDED_CONSENT_REVOKED` **pour cet espace seulement** ; déconnexion des salles de cet espace en ≤ 60 s, participations futures de cet espace annulées, professeur et admin notifiés. L'historique pédagogique (présences, progression, comptes rendus) est conservé pendant la durée légale de rétention. Un nouveau consentement du tuteur réactive l'adhésion.
- `GuardianLink` est créé par espace dès le consentement, même sans compte tuteur (email seul), pour le portail P1 ; un même tuteur a donc un lien par espace de l'enfant.
- Le tuteur voit, dès le MVP, la liste des sessions planifiées du mineur dans l'email de confirmation et via un lien signé « Sessions de Ahmed » (lecture seule, sans compte) ; vue complète dans le portail P1.

### 8.3.6 Retrait d'un étudiant (P0)

- Retirer un cours : l'inscription passe `REVOKED` ; l'étudiant perd l'accès au contenu **immédiatement** (lecteur vidéo interrompu à la prochaine sauvegarde de progression, ≤ 10 s, AC-ENR-04) ; sa progression est conservée (réattribution possible). **Sessions (D-P22)** : une session **en cours** liée à ce cours où l'étudiant est connecté est conservée jusqu'à ce qu'il la quitte (pas de nouveau jeton ensuite) ; ses participations aux sessions **futures** liées à ce cours sont annulées automatiquement (`SessionParticipant.removed_at`, motif `ENROLLMENT_REVOKED`), avec notification à l'étudiant et au professeur. Les sessions sans cours ne sont pas affectées.
- Retirer de l'espace : dans une **organisation, seuls les admins/owner** le peuvent ; dans un espace personnel, le professeur (owner). `Membership` → `REMOVED` ; déconnexion des salles en ≤ 60 s ; sessions futures : participation annulée + notification ; historique conservé pour le professeur ; l'étudiant ne voit plus l'espace.

## 8.4 Cours, modules, leçons et médias

### 8.4.1 Cours (P0)

Champs : titre, description (texte riche), image de couverture, catégorie (liste libre par espace), niveau (`PRIMAIRE`, `COLLEGE`, `LYCEE`, `SUPERIEUR`, `ADULTE`, `AUTRE`), langue d'enseignement, durée estimée (dérivée : somme des durées des leçons, surchargeable), `sequential_lessons` (bool), statut (`DRAFT`, `PUBLISHED`, `ARCHIVED`), `version` (verrou optimiste).

Règles :

- Un cours `DRAFT` n'est visible que de ses professeurs/admins.
- Publier exige ≥ 1 module contenant ≥ 1 leçon `READY` (média prêt).
- Archiver conserve l'accès en lecture aux étudiants inscrits (progression figée) ; pas de nouvelles attributions ; les sessions liées restent possibles.
- Supprimer : uniquement depuis `DRAFT` ou `ARCHIVED`, **et** uniquement si aucune inscription `ACTIVE` ; un cours `PUBLISHED` doit d'abord être archivé (l'UI propose « Archiver puis supprimer »). Suppression = soft-delete 30 jours (médias non partagés purgés à la fin).
- Duplication (P1) : copie structure + leçons + références médias (pas de recopie des fichiers), statut `DRAFT`.
- Modèles de cours (P2).

### 8.4.2 Modules (P0)

Titre, description, position, `unlock_rule` (§8.5.2), `is_optional` (les leçons d'un module optionnel ne comptent pas dans la progression). Réordonnancement par glisser-déposer (positions renumérotées en une transaction).

### 8.4.3 Leçons (P0 : VIDEO, PDF, TEXT ; P1 : LINK, EMBED, QUIZ, ASSIGNMENT)

| Type | Contenu | Règle de complétion |
|---|---|---|
| `VIDEO` | `MediaAsset` vidéo (transcodé, lecture signée) | ≥ 90 % de durée unique visionnée **ou** « Marquer comme terminé » |
| `PDF` | `MediaAsset` PDF, `allow_download` | ouvert **puis** « Marquer comme terminé » |
| `TEXT` | contenu riche (JSON Tiptap/ProseMirror), images inline (`MediaAsset` IMAGE) | « Marquer comme terminé » |
| `LINK` (P1) | URL externe, ouverte dans un nouvel onglet | « Marquer comme terminé » |
| `EMBED` (P1) | iframe autorisée (YouTube, Vimeo, Genially, GeoGebra — liste blanche de domaines) | « Marquer comme terminé » |
| `QUIZ` (P1) | `Quiz` | tentative soumise avec score ≥ seuil |
| `ASSIGNMENT` (P1) | `Assignment` | dépôt `GRADED` ou `SUBMITTED` selon réglage |

Champs communs : titre, description, position, `is_required` (défaut true), `estimated_minutes`, `is_preview` (visible sans inscription — réservé à la V3 marketplace, champ prévu), `version`.

Le lecteur vidéo mémorise la position (`LessonProgress.last_position_s`, sauvegarde toutes les 10 s et à la sortie) et les segments vus (`watched_segments` : liste d'intervalles fusionnés, pour calculer la durée *unique* et empêcher la complétion par simple avance rapide).

### 8.4.4 Médias : upload, transcodage, lecture (P0)

```text
UPLOADING ──(upload terminé)──▶ PROCESSING ──(webhook ready)──▶ READY
    │                               │
    └──(abandon > 24 h)──▶ FAILED   └──(webhook error / timeout 6 h)──▶ FAILED
```

- **Vidéo** : upload direct reprenable (tus) vers le fournisseur VOD depuis le navigateur, via une URL d'upload créée par l'API (`POST /media/uploads`, TTL 1 h). Max 4 Go / 4 h (D-P15). Webhook signé du fournisseur → `READY` (durée, résolutions, miniature) ou `FAILED` (raison). Le professeur peut quitter la page : l'upload reprend au retour (état local + identifiant tus) ; une leçon peut référencer un média `PROCESSING` (affiché « en cours de traitement » aux étudiants, non comptée pour la publication).
- **PDF / image / fichier** : upload multipart présigné vers S3 (parties de 8 Mo, reprise par partie), puis `POST /media/{id}/complete` qui vérifie taille, type MIME (détection par signature, pas par extension), scanne (ClamAV ou service équivalent, P1) et passe `READY`.
- **Lecture signée (D-O8)** : vidéo → jeton de lecture signé émis par l'API (TTL 2 h, lié à l'asset, journalisé avec l'`user_id` demandeur) après vérification de l'inscription ; PDF → URL présignée TTL 5 min, `Content-Disposition: inline` (visionneuse PDF.js intégrée) ; téléchargement → URL présignée TTL 5 min avec `attachment` uniquement si `allow_download`. Aucune URL de stockage brute n'est jamais exposée. **Les jetons et URLs signés sont des jetons porteurs** : ils ne sont pas vérifiés contre l'utilisateur à la lecture (le fournisseur VOD ne connaît pas nos utilisateurs) ; quiconque en obtient un peut lire jusqu'à expiration. Risque résiduel **accepté** par le propriétaire ; pas de DRM, pas de proxy de lecture.
- **Anti-hotlinking** : tous les accès passent par des jetons/URLs signés courts ; aucun bucket public ; en-têtes `Referrer-Policy`, CSP ; les URLs ne sont pas listables ; limitation à 30 jetons de lecture / heure / utilisateur (alerte au-delà).
- **Filigrane (P0, D-O8)** : surcouche visible (email de l'étudiant + horodatage, semi-transparente, position variable toutes les 30 s) sur le lecteur vidéo et la visionneuse PDF ; non désactivable par l'étudiant. Estampillage côté serveur (pdf-lib) sur les PDF téléchargés : P1. Dissuasif, non infaillible — explicité dans les CGU.
- Quota de stockage par espace, affiché dans les paramètres, blocage de l'upload à 100 % avec message.
- Suppression d'un média : refusée s'il est référencé par une leçon publiée ; sinon suppression chez le fournisseur en job asynchrone.

## 8.5 Attribution et verrouillage

### 8.5.1 Attribution (P0)

- Attribution = `Enrollment(student, course)` à `ACTIVE`. Depuis le cours (cases à cocher par étudiant, recherche) ou depuis l'étudiant.
- Un étudiant accède au contenu si : `Membership` `ACTIVE` dans l'espace **et** `Enrollment` `ACTIVE` **et** `Course.status ∈ {PUBLISHED, ARCHIVED}` **et** consentement tuteur OK si mineur.
- Attribution d'un cours `DRAFT` : possible (préparation), l'étudiant ne le voit qu'à la publication (notification `COURSE_PUBLISHED`).
- Retrait : `REVOKED`, voir §8.3.6. Réattribution : retour à `ACTIVE`, progression retrouvée.
- Dans une organisation, l'admin peut attribuer n'importe quel cours à n'importe quel étudiant ; le professeur uniquement ses cours à ses étudiants affectés.

### 8.5.2 Verrouillage des modules et leçons

Un module est **verrouillé** pour un étudiant si sa `unlock_rule` n'est pas satisfaite :

| `unlock_rule.type` | Paramètres | Déverrouillé quand | Priorité |
|---|---|---|---|
| `NONE` | — | toujours | P0 |
| `PREVIOUS_MODULE_COMPLETED` | — | le module précédent non optionnel est à 100 % | P0 |
| `AFTER_DATE` | `date` (UTC) | `now ≥ date` | P1 |
| `DAYS_AFTER_ENROLLMENT` | `days` | `now ≥ enrollment.activated_at + days` | P1 |
| `MANUAL` | — | le professeur a déverrouillé pour cet étudiant (`ModuleUnlock`) | P1 |

- Un module verrouillé apparaît dans le plan (titre, 🔒, raison : « Terminez le module 2 » / « Disponible le 15/11 ») ; son contenu n'est pas servi (API `403 MODULE_LOCKED`).
- `Course.sequential_lessons = true` : une leçon n'est accessible que si toutes les leçons obligatoires précédentes du même module sont terminées (`403 LESSON_LOCKED`). Les leçons optionnelles ne bloquent jamais.
- Le professeur et l'admin voient toujours tout.
- Déverrouillage manuel par étudiant (P1) prime sur toutes les règles.

## 8.6 Progression (P0)

Définitions (D-P8) :

```text
leçons_obligatoires(M)   = leçons de M avec is_required = true, dans un module non optionnel
progression(M, étudiant) = terminées(M) / leçons_obligatoires(M)       (0 si dénominateur 0)
progression(C, étudiant) = Σ terminées / Σ leçons_obligatoires sur tous les modules non optionnels de C
```

- Stockée dénormalisée dans `Enrollment.progress_percent` (entier 0–100, arrondi inférieur) et `Enrollment.completed_at` à 100 %.
- Recalculée : à chaque complétion de leçon (synchrone), et par job lorsque la structure du cours change (ajout/suppression/`is_required`/`is_optional`) — la progression **peut baisser** si le professeur ajoute une leçon ; `completed_at` est conservé mais un cours peut repasser sous 100 % (affiché « 95 % — nouveau contenu »).
- `LessonProgress.status` : `NOT_STARTED` → `IN_PROGRESS` (première ouverture) → `COMPLETED`. Un étudiant peut « Annuler terminé » (retour `IN_PROGRESS`) ; le professeur ne modifie pas la progression (anti-objectif surveillance), mais peut la réinitialiser sur demande (P1, audité).
- Événements d'activité (`ActivityEvent`) alimentant la « dernière activité » et les dashboards : `LESSON_STARTED`, `LESSON_COMPLETED`, `VIDEO_WATCHED` (agrégé par tranche de 60 s), `PDF_OPENED`, `SESSION_ATTENDED`, `MESSAGE_SENT`, `QUIZ_SUBMITTED` (P1), `ASSIGNMENT_SUBMITTED` (P1).
- Temps passé : somme des tranches `VIDEO_WATCHED` + temps de session ; pas de suivi de la présence sur les pages texte/PDF au-delà de l'ouverture (anti-objectif).

Affichage étudiant :

```text
Mathématiques Niveau 1                   Progression : 75 %  ███████████░░░

Module 1 — Introduction            ✓ 100 %
Module 2 — Algèbre                 ✓ 100 %
Module 3 — Géométrie               ● 70 %
   ├── ✓ Leçon 1 — Triangles (vidéo, 12 min)
   ├── ✓ Leçon 2 — Exercices (PDF)
   └── → Leçon 3 — Cercles (vidéo, 18 min)   [▶ Reprendre à 06:40]
Module 4 — Trigonométrie           🔒 Terminez le module 3
```

## 8.7 Planification : sessions, récurrence, disponibilités, calendrier

### 8.7.1 Session (P0)

Une session est un rendez-vous pédagogique en direct, rattaché à un espace, animé par un professeur (`host_user_id`), optionnellement lié à un cours, avec 1 à 12 participants étudiants (D-P2).

Formulaire de création :

```text
Nouvelle session

Titre            [ Révision des équations            ]
Cours (option)   [ Mathématiques Niveau 1          ▾ ]
Participants     [ Ahmed Ben Ali ×  Sarah Trabelsi × ]  (1 à 12)
Date             [ 15/10/2026 ]   Heure  [ 15:00 ]   Fuseau  [ Africa/Tunis ▾ ]
Durée            [ 60 min ▾ ]      (15 à 240, pas de 5)
Répéter          [ Non ▾ ]  → Chaque semaine le mercredi, jusqu'au 17/12/2026
Description      [ Révision du chapitre 3           ]
Rappels          [ J-1 ✓ ] [ 15 min ✓ ] [ Au début ✓ ]   (pré-remplis par l'espace ; seul calendrier de rappels, D-P23)

⚠ Conflit : vous avez déjà « Physique — Sarah » de 15:00 à 15:45.
                                            [ Programmer quand même ] [ Annuler ]
```

Règles :

- `start_at` stocké en UTC (`timestamptz`) **avec** `timezone` IANA de création ; `end_at = start_at + duration`. Affichage dans le fuseau du spectateur, avec mention du fuseau s'il diffère de celui de la session (« 15:00 (Tunis) · 16:00 pour vous (Paris) »).
- Création dans le passé : refusée (`start_at ≥ now + 5 min`), sauf « session immédiate » (bouton « Démarrer une session maintenant », `start_at = now`, P0).
- **Détection de conflits** (P0) : chevauchement avec une autre session du même professeur, ou d'un participant (hors `CANCELLED`) → avertissement non bloquant pour le professeur ; **blocage** en cas de double réservation d'un même créneau via booking (P1, §8.7.3). Contrainte d'unicité : pas deux sessions `SCHEDULED/LIVE` du même hôte avec exactement le même `start_at` et `end_at` (contrainte partielle, protège contre le double-clic).
- Modification : titre, description, participants (jusqu'à `end_at`) ; date/heure/durée uniquement si `SCHEDULED` ; toute modification de date → notification `SESSION_RESCHEDULED` + rappels replanifiés + ICS mis à jour (même `UID`, `SEQUENCE` + 1).
- Annulation : `SCHEDULED → CANCELLED` avec motif (optionnel) et `cancelled_by` ; notification immédiate ; rappels annulés. Une session `LIVE` ne s'annule pas, elle se termine.
- Verrou optimiste (`version`).
- Sessions d'organisation : un admin peut créer une session pour un professeur (hôte) ; le professeur reste celui qui ouvre la salle.

### 8.7.2 Récurrence (P0)

- `RecurrenceRule` : `rrule` au format RFC 5545 (sous-ensemble supporté : `FREQ=DAILY|WEEKLY`, `INTERVAL`, `BYDAY`, `UNTIL` ou `COUNT ≤ 52`), `timezone`, `dtstart`.
- Les occurrences sont **matérialisées** en lignes `Session` (`series_id`, `occurrence_index`) sur un horizon glissant de 12 semaines ; un job quotidien étend l'horizon. Chaque occurrence a son propre cycle de vie, ses participants (copiés à la création, modifiables individuellement) et ses rappels.
- Expansion **dans le fuseau de la série** : une session hebdomadaire à 15:00 Africa/Tunis reste à 15:00 Tunis après un changement d'heure en Europe (et change donc d'heure UTC) — AC-SCH-05.
- Modification « cette occurrence » (détache : `is_detached = true`), « cette occurrence et les suivantes » (clôture la série à l'occurrence précédente, crée une nouvelle série), « toutes » (modifie la règle et régénère les occurrences futures non détachées non `LIVE/COMPLETED`).
- Annulation suivant la même logique.

### 8.7.3 Disponibilités et réservation par l'étudiant (P1)

- `AvailabilityRule` par professeur : jour de semaine, `start_time`, `end_time`, `timezone`, durées proposées (ex. 30/45/60), prix (V3).
- `AvailabilityOverride` : date précise bloquée ou ajoutée (congés, exception).
- `BookingPolicy` par professeur : `min_notice_hours` (défaut 12), `max_advance_days` (défaut 60), `buffer_before_min`/`buffer_after_min` (défaut 10), `slot_step_min` (30), `requires_approval` (défaut false), `student_cancel_deadline_hours` (défaut 24), `max_pending_per_student` (2), `max_bookings_per_week_per_student` (optionnel).
- Créneaux calculés = disponibilités − sessions existantes (avec tampons) − overrides, dans le fuseau de l'étudiant.
- Flux : étudiant choisit un créneau → `Booking` `PENDING` (si approbation) ou `CONFIRMED` (crée la `Session`) ; conflit concurrent → `409 SLOT_TAKEN` (verrou transactionnel sur `(host, start_at)`), AC-BKG.
- Annulation étudiant avant la date limite : `CANCELLED_BY_STUDENT`, session annulée ; après : `LATE_CANCELLED` (comptabilisée, affichée au professeur ; facturable en V3). Annulation professeur : toujours possible, motif obligatoire. Reprogrammation = annulation + nouvelle réservation au sein de la politique, en une action UI.
- Liste d'attente sur un créneau complet (groupe) : P2.

### 8.7.4 Calendrier (P0)

- Vues semaine/mois (professeur), liste « à venir » + mois (étudiant), tuteur (P1).
- Actions professeur : créer, modifier, déplacer (glisser-déposer = modification de date avec confirmation), annuler, rejoindre.
- **Export ICS** (P0) : flux `webcal://…/calendar/{token}.ics` par utilisateur (jeton révocable), `VEVENT` par session avec `UID` stable, `DTSTART;TZID`, `SEQUENCE`, `STATUS:CANCELLED` pour les annulées, `URL` de la salle. Invitation ICS jointe aux emails de session (`METHOD:REQUEST`/`CANCEL`).
- Synchronisation Google/Outlook bidirectionnelle (P2).

### 8.7.5 Fuseaux horaires (P0)

- Tout horodatage en UTC en base ; fuseau utilisateur (`User.timezone`) pour l'affichage ; fuseau de session pour les règles de récurrence et l'ICS.
- Le sélecteur de fuseau propose en tête : Africa/Tunis, Africa/Algiers, Africa/Casablanca, Europe/Paris, puis la liste IANA.
- Changement de fuseau de l'utilisateur : n'altère aucune session, modifie uniquement l'affichage ; bannière si le fuseau détecté du navigateur diffère du fuseau du profil (« Vous semblez être à Paris ; afficher en Europe/Paris ? »).
- DST : les rappels sont calculés sur `start_at` UTC, donc justes ; les occurrences récurrentes sont expandées dans le fuseau de la série (AC-SCH-05). Africa/Casablanca a des règles DST particulières (Ramadan) : s'appuyer exclusivement sur la base tz du système (`Intl` / `@date-fns/tz` ou `luxon`), jamais sur un décalage fixe.

## 8.8 Salle en direct

### 8.8.1 Principes (P0)

- Une salle n'existe que pour une session ; identifiant de salle LiveKit = `session_{id}`.
- Accès par **jeton LiveKit émis par l'API** après vérification (D-P22) : utilisateur authentifié → adhésion `ACTIVE` à l'espace (donc consentement tuteur OK) → participant non retiré (ou hôte) de la session → **(session sans cours OU inscription `ACTIVE` au cours de la session)** → session dans sa fenêtre d'accès → compte non suspendu. Jeton TTL **10 min** (valable pour se connecter ; une fois connecté, la connexion persiste), `identity = user_id`, `metadata` = rôle dans la salle, permissions LiveKit calquées sur le rôle (`canPublish`, `canSubscribe`, `canPublishData`, `roomAdmin` pour l'hôte).
- Reconnexion : le client redemande un jeton ; l'API revalide **toute** la chaîne ci-dessus → un participant retiré, dont l'inscription au cours a été révoquée ou dont l'adhésion est suspendue ne peut pas revenir (AC-ROOM-06, AC-ROOM-07). Une révocation d'inscription ne déconnecte **pas** une connexion en cours (D-P22) ; un retrait de l'espace ou une révocation de consentement la déconnecte (≤ 60 s).
- Expiration du jeton **en cours de session** : sans effet sur la connexion en cours (comportement LiveKit) ; en cas de coupure réseau le client obtient un nouveau jeton. Le client rafraîchit préventivement son jeton toutes les 8 min pendant la session pour que la reconnexion soit immédiate.

### 8.8.2 Pré-join (P0)

```text
┌────────────────────────────────────────┐
│ Révision des équations · 15:00–16:00   │
│                                        │
│   [ aperçu caméra ]                    │
│                                        │
│ Caméra   [ Intégrée ▾ ]   🎥 activée   │
│ Micro    [ Par défaut ▾ ] 🎤 niveau ▂▄▆│
│ Haut-parleur [ Par défaut ▾ ] ▶ Tester │
│ Connexion : bonne (42 ms, 3,2 Mbit/s)  │
│                                        │
│ ☐ Rejoindre en audio seul              │
│           [ Rejoindre ]                │
└────────────────────────────────────────┘
```

Sélection des périphériques (mémorisée), test micro (vu-mètre), test haut-parleur, test de connexion (ping SFU + estimation de bande passante), choix « audio seul ». Permissions navigateur refusées → aide contextuelle par navigateur.

### 8.8.3 Lobby et fenêtres d'accès (P0)

- Professeur : « Rejoindre » actif dès `start_at − teacher_join_window_min` (15) ; son entrée passe la session à `LIVE` et admet automatiquement les étudiants en lobby.
- Étudiant : « Rejoindre » actif dès `start_at − student_join_window_min` (10) ; avant l'ouverture par le professeur, il attend dans le lobby (« Votre professeur n'a pas encore ouvert la salle ») — pas de média publié, un signal de présence est envoyé pour que le professeur voie « 3 étudiants attendent ».
- Entrée tardive autorisée jusqu'à `end_at` ; au-delà, uniquement si la session est encore `LIVE` (dépassement).
- Hors fenêtre : bouton désactivé avec compte à rebours (« ouvre dans 12 min »).
- Option P1 : « autoriser les étudiants à entrer avant moi ».

### 8.8.4 Dans la salle (P0)

```text
┌──────────────────────────────────────────────────────────┐
│ Révision des équations          ⏱ 23:40 / 60:00   ● LIVE  │
├──────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────┐ ┌───────────┐          │
│  │               │  │  Ahmed    │ │  Sarah    │          │
│  │   MOHAMED     │  │ 🎤        │ │ 🎤✗       │          │
│  │  (professeur) │  └───────────┘ └───────────┘          │
│  │               │  ┌───────────┐ ┌───────────┐          │
│  └───────────────┘  │  Yassine  │ │  Lina     │          │
│                     │ 🎤  ⚠ réseau │ 🎤       │          │
│                     └───────────┘ └───────────┘          │
├──────────────────────────────────────────────────────────┤
│ 🎤 Micro  📹 Caméra  💬 Chat (2)  👥 Participants  ⚙      │
│                     [ 🔴 Quitter ]   [ ■ Terminer la session ] (professeur)
└──────────────────────────────────────────────────────────┘
```

Fonctions MVP : vidéo/audio (simulcast 180p/360p/720p ; professeur jusqu'à 720p, étudiants 360p), couper/activer micro et caméra, liste des participants avec indicateur réseau, chat texte persisté (§8.12), minuteur (temps écoulé / prévu, alerte visuelle à −5 min et au dépassement), plein écran, épingler un participant, mode « galerie / orateur ».

Contrôles du professeur (et co-animateur P1) :

- **Couper le micro** d'un participant (il peut le réactiver, sauf si « verrouiller les micros », P1) ; **couper tous les micros**.
- **Retirer un participant** : déconnexion immédiate, retour interdit pour cette session (`SessionParticipant.removed_at`), motif optionnel, consigné.
- **Terminer la session** : déconnecte tout le monde, `COMPLETED`, calcul de présence, redirection du professeur vers le compte rendu.
- Demande d'activation caméra/micro d'un étudiant (il accepte ou refuse).

Reconnexion et dégradation (P0) :

- Perte réseau : bannière « Reconnexion… », tentative automatique (LiveKit) jusqu'à 60 s, puis nouveau jeton et reconnexion complète ; au-delà de 5 min hors salle, l'intervalle est clos et un nouvel intervalle démarre au retour (présence correcte, AC-ATT-03).
- Qualité : le client suit la qualité de connexion LiveKit ; en « poor » pendant 20 s, proposition « Passer en audio seul » ; passage automatique en audio seul si la perte de paquets > 25 % pendant 30 s, avec bouton de retour en vidéo ; le professeur voit l'icône réseau de chaque participant.
- Le professeur perd la connexion : la session reste `LIVE`, les étudiants voient « Le professeur se reconnecte… » ; fin automatique si la salle est vide 5 min (D-P5).

V2 (P1) : partage d'écran (professeur ; étudiant sur autorisation), lever la main, réactions, enregistrement (bandeau + consentement `RECORDING` des participants ou tuteurs, enregistrement composite stocké en `MediaAsset` lié à la session, lecture signée), mode classe (40 participants, vidéo professeur seule). V3 (P2) : tableau blanc, sous-titres live, sous-salles.

### 8.8.5 Fin de session et dépassement (P0, D-P5)

- Fin explicite par le professeur → `COMPLETED` (définitif).
- Salle vide (0 participant connecté) pendant 5 min après avoir été `LIVE` → `COMPLETED` (auto) ; le professeur peut « Reprendre la session » dans les 10 min (retour `LIVE`, même salle, présence cumulée).
- **Dépassement (D-P5)** : la session porte `auto_end_at`, initialisé à `end_at + 60 min`. À `auto_end_at − 10 min` (soit `end_at + 50 min` sans prolongation) encore `LIVE` : notification `SESSION_ENDING_SOON` au professeur « la session se termine dans 10 min » avec bouton « Prolonger de 30 min ». Chaque prolongation (au plus **deux**) fait `auto_end_at += 30 min`, borné par le plafond absolu `end_at` d'origine `+ 120 min`, et replanifie l'avertissement. À `auto_end_at` : fin automatique (`end_reason = TIMEOUT`), tous déconnectés, présence calculée. Les prolongations étendent la fenêtre planifiée utilisée pour la présence (§8.9).
- `NO_SHOW` : job à `end_at` ; si la session est encore `SCHEDULED` (le professeur n'a jamais ouvert la salle) → `NO_SHOW`, `no_show_reason = TEACHER` si des étudiants ont attendu dans le lobby, `NOBODY` sinon ; notification au professeur et à l'admin. Un étudiant qui n'est jamais venu alors que la session a eu lieu n'est pas un `NO_SHOW` de session : il est `ABSENT` dans la présence.
- Rappel au professeur à `start_at + 5 min` si la salle n'est pas ouverte (« Vos étudiants vous attendent », in-app + email + push P1).

## 8.9 Présence (P0)

- Source de vérité : webhooks LiveKit `participant_joined` / `participant_left` (+ réconciliation périodique via API de salle), stockés en `AttendanceInterval(session_participant_id, joined_at, left_at)`. Les signaux de lobby ne comptent pas comme présence.
- Calcul au passage `COMPLETED` (et recalcul à toute reprise) :

```text
sched_start = start_at
sched_end   = end_at + prolongations (= auto_end_at − 60 min si prolongée, sinon end_at)
live_start  = première ouverture de la salle par le professeur (live_started_at)
live_end    = fin de session (live_ended_at)
W           = [max(sched_start, live_start), min(sched_end, live_end)]   (fenêtre de référence, D-P21)
D           = durée de W                                                 (durée effective ; si W vide → D = 0, tous NOT_APPLICABLE)
P(étudiant) = somme de ses intervalles de connexion ∩ W  (temps réellement connecté, ± 5 s ;
              le temps déconnecté entre deux intervalles ne compte jamais)
first_join  = début du premier intervalle ∩ W
ref_start   = début de W

PRESENT  si first_join ≤ ref_start + late_threshold_min  et  P/D ≥ present_ratio
LATE     si first_join >  ref_start + late_threshold_min  et  P/D ≥ present_ratio
PARTIAL  si partial_ratio ≤ P/D < present_ratio
ABSENT   si P/D < partial_ratio  ou aucun intervalle
```

- Conséquences : un professeur qui ouvre la salle à 14:50 pour une session à 15:00 ne pénalise pas un étudiant entré à 15:00 (W commence à 15:00) ; un professeur qui ouvre en retard à 15:20 décale `ref_start` à 15:20 (AC-ATT-05) ; une session qui déborde jusqu'à 16:30 sans prolongation ne compte que jusqu'à 16:00 ; avec une prolongation de 30 min, W s'étend jusqu'à 16:30.
- Affichage : les coupures < 5 min entre deux intervalles sont **fusionnées visuellement** en un seul intervalle (« 15:02–16:00, 1 reconnexion ») ; le calcul de P utilise toujours les intervalles bruts.
- Session `NO_SHOW` ou `CANCELLED` : aucune présence calculée (participants `NOT_APPLICABLE`).
- Correction manuelle par le professeur (motif obligatoire, journalisée, `attendance_status_override`) ; l'étudiant voit la valeur corrigée et la mention « corrigé par le professeur ».
- Vue :

```text
Présence — Révision des équations (15/10, prévue 15:00–16:00, salle ouverte 14:55–16:02 → référence 15:00–16:00, 60 min)

Participant   Entrée   Sortie   Présence        Statut
Ahmed         14:58    16:02    60 min (100 %)  ✓ Présent
Sarah         15:14    16:00    46 min (77 %)   ⏰ En retard
Yassine       15:03    15:20    17 min (28 %)   ◐ Partiel   (15:03–15:20, 1 reconnexion)
Lina          —        —        0 min (0 %)     ✗ Absent    [Corriger]
```

- Taux de présence d'un étudiant = (PRESENT + LATE) / participations à des sessions `COMPLETED` (hors `NOT_APPLICABLE`). Retards comptés présents mais affichés.

## 8.10 Compte rendu et actions post-session

### 8.10.1 Compte rendu (P0)

```text
Session terminée — Révision des équations · 60 min · 4 participants

Compte rendu (visible par les étudiants et tuteurs)
[ Nous avons travaillé les équations du second degré. Exercices 4 à 8 à
  terminer pour mercredi. ]

Devoirs / à faire        [ Exercices 4 à 8, p. 42 ]
Recommandations          [📹 Équations — Vidéo 3 ×] [📄 Exercices ch. 4 ×]  [+ Ajouter]
Note privée (vous seul)  [ Sarah a du mal avec les discriminants. ]

Comptes rendus individuels (option, par participant)  [ Ahmed ▾ ]

[ Enregistrer ]   [ Enregistrer et programmer la suite → ]
```

- `SessionReport` : un par session (portée `SESSION`) + optionnellement un par participant (portée `PARTICIPANT`), texte riche, `homework`, `recommendations` (références de leçons), `private_notes` (jamais exposé aux étudiants/tuteurs/admins), `published_at`.
- Brouillon auto-sauvegardé ; **publication** déclenche `SESSION_REPORT_PUBLISHED` vers les participants concernés (et tuteurs P1). Modifiable après publication (horodatage « modifié »).
- Visible par : professeur hôte, co-animateur (P1), admin (lecture, hors note privée), étudiant (son compte rendu de session + le sien individuel), tuteur.
- Rappel au professeur 24 h après la fin si aucun compte rendu (préférence désactivable).
- P1 : modèles de compte rendu par professeur ; brouillon généré par IA depuis la transcription (§8.15).

### 8.10.2 Actions post-session (P0)

Depuis l'écran de fin : rédiger le compte rendu, attribuer un cours, recommander des leçons (lien dans le compte rendu + notification), programmer la prochaine session (formulaire pré-rempli : mêmes participants, +7 jours, même heure), consulter la présence.

## 8.11 Notifications et rappels

### 8.11.1 Catalogue (P0 sauf mention)

| Type | Destinataire | Déclencheur | Canaux par défaut |
|---|---|---|---|
| `INVITATION_RECEIVED` | invité | création/renvoi d'invitation | email |
| `INVITATION_ACCEPTED` | professeur | acceptation | in-app |
| `GUARDIAN_CONSENT_REQUESTED` | tuteur | inscription d'un mineur | email |
| `GUARDIAN_CONSENT_GRANTED` / `REVOKED` | étudiant, professeur | action du tuteur | in-app, email |
| `COURSE_ASSIGNED` | étudiant | attribution (cours publié) | in-app, email |
| `COURSE_PUBLISHED` | étudiants inscrits | passage `PUBLISHED` | in-app |
| `LESSON_ADDED` | étudiants inscrits | nouvelle leçon `READY` dans un cours publié (agrégé : 1 notification / cours / heure) | in-app |
| `SESSION_SCHEDULED` | participants | création | in-app, email (+ ICS) |
| `SESSION_RESCHEDULED` | participants | changement de date/heure | in-app, email (+ ICS) |
| `SESSION_CANCELLED` | participants (ou professeur si annulation étudiant P1) | annulation | in-app, email |
| `SESSION_REMINDER` | participants + hôte | J-1, 15 min, début (configurable) | in-app, email ; push P1 ; WhatsApp/SMS P1 |
| `SESSION_STARTED` | participants | passage `LIVE` | in-app (+ push P1) |
| `SESSION_TEACHER_LATE` | professeur (+ admin) | `start_at + 5 min` sans ouverture | in-app, email |
| `SESSION_NO_SHOW` | professeur, admin | `NO_SHOW` | in-app, email |
| `SESSION_ENDING_SOON` | professeur | `auto_end_at − 10 min` (replanifié à chaque prolongation) | in-app |
| `ENROLLMENT_REVOKED_SESSIONS_CANCELLED` | étudiant, professeur | annulation automatique des participations futures après révocation d'inscription (D-P22) | in-app, email |
| `ABUSE_REPORT_RECEIVED` / `ABUSE_REPORT_RESOLVED` | admins/super-admin ; signalant | signalement créé / traité | in-app, email |
| `TEACHER_SUSPENDED` | professeur, admins, participants des sessions annulées | suspension par le super-admin | email, in-app |
| `SESSION_REPORT_PUBLISHED` | participants, tuteurs (P1) | publication | in-app, email |
| `SESSION_REPORT_MISSING` | professeur | 24 h après fin sans compte rendu | in-app |
| `ATTENDANCE_ABSENT` | professeur ; tuteur (P1) | étudiant `ABSENT` à une session terminée | in-app |
| `NEW_MESSAGE` | destinataire | message non lu après 2 min sans lecture (anti-spam) | in-app, email (digest si > 3 en 10 min) |
| `COURSE_COMPLETED` | étudiant, professeur | 100 % | in-app |
| `STUDENT_AT_RISK` (P1) | professeur | règle §8.14 | in-app, email |
| `BOOKING_*` (P1) | professeur/étudiant | demandes, confirmations, annulations | in-app, email |
| `ASSIGNMENT_*`, `QUIZ_*` (P1) | selon | dépôt, notation, échéance | in-app, email |
| `ACCOUNT_SECURITY` | utilisateur | nouvel appareil, mot de passe changé, 2FA | email (non désactivable) |

### 8.11.2 Mécanique (P0)

- `Notification` persistée (in-app) ; livraison par canal via `NotificationDelivery` (statut `QUEUED/SENT/FAILED/SKIPPED`), jobs BullMQ avec retry (3 tentatives, backoff exponentiel), webhooks du fournisseur email pour les rebonds (adresse marquée `bounced`, alerte au professeur).
- **Rappels** : à la création/modification d'une session, les jobs `session.reminder` sont (re)planifiés avec `jobId = session:{id}:v{version}:offset:{min}` ; les anciens jobs de la version précédente sont supprimés ; à l'exécution, le job revérifie que la session est toujours `SCHEDULED`, à la même date, et que l'utilisateur est toujours participant (idempotence, AC-NOT-02).
- **Préférences** (`NotificationPreference`) par utilisateur : pour chaque catégorie (sessions, rappels, cours, messages, comptes rendus, sécurité) × canal : activé/désactivé. Un utilisateur peut se désabonner des rappels (toutes catégories « rappels » désactivées), mais **ne définit pas d'offsets personnels** : les offsets sont ceux de la session (`Session.reminder_offsets_min`, D-P23) ; heures calmes pour push/WhatsApp (P1). Les notifications de sécurité et de consentement ne sont pas désactivables.
- Emails : templates FR/AR/EN (RTL pour AR), expéditeur de la plateforme avec nom du professeur en `reply-to` (non exposé si le professeur refuse, paramètre), pied de page légal, lien de préférences, lien ICS.
- In-app : centre de notifications (non lues, tout marquer lu), badge, livraison temps réel via WebSocket `notification.created`.
- P1 : Web Push (VAPID, service worker PWA ; iOS ≥ 16.4 avec PWA installée), WhatsApp (API Business Cloud, modèles pré-approuvés, numéro vérifié par OTP, opt-in explicite `WHATSAPP` consent), SMS (fallback, fournisseur avec couverture TN/DZ/MA/FR), digest quotidien.

## 8.12 Messagerie

### 8.12.1 MVP (P0, D-P11)

- `Conversation` de type `DIRECT` entre un professeur et un étudiant du même espace (créée à la volée, unique par paire + espace) ; type `SESSION` pour le chat d'une salle (créée à l'ouverture de la salle, lecture seule après la fin, visible dans l'historique de la session).
- Messages texte (Markdown limité : gras, italique, listes, liens), 4 000 caractères max, émojis.
- Non lus par conversation (`last_read_at` par participant), badge global, liste triée par dernier message, recherche par nom.
- Temps réel via WebSocket (`message.created`, `conversation.read`), indicateur « en train d'écrire » (éphémère).
- Suppression de son propre message dans les 15 min (remplacé par « message supprimé ») ; pas d'édition au MVP.
- Signalement d'un message à l'admin/plateforme (P1).

### 8.12.2 V2 (P1)

- Canaux de cours (`COURSE`) : tous les inscrits + professeurs ; annonces épinglées ; le professeur peut fermer l'écriture (annonces seules) ; modération (supprimer, exclure du canal, mots interdits par espace).
- Groupes (`GROUP`) créés par le professeur.
- Pièces jointes (`Attachment` → `MediaAsset` FILE, images/PDF/docx ≤ 10 Mo, scan antivirus), accusés de lecture (vu par), réponses citées, édition 15 min.
- Tuteur → professeur (`DIRECT` avec `GUARDIAN`).
- Export de conversation (RGPD) et rétention paramétrable.

## 8.13 Évaluations (P1 quiz & devoirs ; P2 rubriques & certificats)

- **Quiz** (`Quiz`, `Question`, `Choice`, `QuizAttempt`, `Answer`) : questions `MCQ_SINGLE`, `MCQ_MULTI`, `TRUE_FALSE`, `SHORT_ANSWER` (correction automatique par correspondance exacte/insensible à la casse ou liste de réponses acceptées, sinon correction manuelle) ; points par question ; seuil de réussite ; tentatives max ; mélange des questions/choix ; durée limite optionnelle ; feedback par question après soumission ; leçon de type `QUIZ` comptée terminée à la réussite.
- **Devoirs** (`Assignment`, `Submission`) : consigne riche, pièces jointes du professeur, échéance (fuseau de l'étudiant affiché), dépôt texte et/ou fichiers (≤ 50 Mo au total), remise en retard autorisée ou non, notation (note sur N ou barème lettré), feedback riche, demande de reprise (`RETURNED`), historique des versions de dépôt.
- **Rubriques** (P2) : grille critères × niveaux, note calculée.
- **Certificats** (P2) : PDF généré à 100 % d'un cours marqué « certifiant », numéro unique vérifiable par URL publique, nom de l'espace, signature du professeur (image).

## 8.14 Dashboards et analytics

### 8.14.1 Définitions (P0)

| Indicateur | Définition exacte |
|---|---|
| Étudiants | `Membership STUDENT ACTIVE` de l'espace (professeur : ses étudiants affectés). |
| Cours | cours non supprimés (ventilés `DRAFT/PUBLISHED/ARCHIVED`). |
| Sessions aujourd'hui | sessions `SCHEDULED/LIVE` dont `start_at` est dans la journée civile du fuseau du professeur. |
| Étudiant actif (7 j / 30 j) | étudiant ayant ≥ 1 `ActivityEvent` parmi `LESSON_STARTED`, `LESSON_COMPLETED`, `VIDEO_WATCHED` (≥ 60 s cumulées), `PDF_OPENED`, `SESSION_ATTENDED`, `QUIZ_SUBMITTED`, `ASSIGNMENT_SUBMITTED` dans la fenêtre. `MESSAGE_SENT` ne compte pas (bruit). |
| Progression moyenne | moyenne arithmétique de `Enrollment.progress_percent` sur les inscriptions `ACTIVE` de cours `PUBLISHED`. |
| Taux de présence | (PRESENT + LATE) / participations à des sessions `COMPLETED`, sur la période choisie (défaut 30 j). |
| Taux de réalisation des sessions | `COMPLETED` / (`COMPLETED` + `NO_SHOW` + `CANCELLED` dont l'annulation est < 24 h avant) sur la période. |
| Dernière activité | horodatage du dernier `ActivityEvent` de l'étudiant dans l'espace. |
| Temps d'apprentissage | Σ tranches `VIDEO_WATCHED` + Σ présence en session. |
| Étudiant à risque (P1) | au moins un : aucune activité depuis 14 j alors qu'il a une inscription active ; 2 absences consécutives ; taux de présence < 60 % sur les 5 dernières sessions ; progression < 25 % à 30 j après inscription. Alerte `STUDENT_AT_RISK` une fois par étudiant et par semaine max. |

### 8.14.2 Dashboard professeur (P0)

```text
Bonjour Mohamed 👋                          Espace de Mohamed ▾   mer. 15 oct.

┌ Étudiants ──┐ ┌ Actifs 7 j ─┐ ┌ Cours ─────┐ ┌ Sessions auj. ┐ ┌ Présence 30 j ┐
│     32      │ │  24 (75 %)  │ │  12 (9 pub)│ │      3        │ │     91 %       │
└─────────────┘ └─────────────┘ └────────────┘ └───────────────┘ └────────────────┘

PROCHAINES SESSIONS                          À FAIRE
15:00  Ahmed       Maths — Révision   [Rejoindre]   ✎ 2 comptes rendus à rédiger
16:00  Groupe B    Physique           [Rejoindre]   ⏳ 3 invitations en attente
Demain 10:00 Sarah Algèbre                          ⚠ 2 étudiants sans activité 14 j (P1)

ACTIVITÉ RÉCENTE
Ahmed a terminé « Équations — Chapitre 2 »                 il y a 12 min
Sarah a regardé « Introduction à la physique » (18 min)    il y a 1 h
Yassine a participé à « Révision » (présent, 55 min)       hier
```

### 8.14.3 Dashboard étudiant (P0)

Prochaine session (bouton rejoindre avec compte à rebours), mes cours (progression, « reprendre »), devoirs à rendre (P1), dernières activités, derniers comptes rendus.

### 8.14.4 Dashboard organisation (P1)

Mêmes KPIs agrégés + par professeur ; sessions de la semaine par professeur ; taux de présence par professeur/cours ; exports CSV (étudiants, présences, progression) et PDF (bulletin de suivi par étudiant sur une période).

### 8.14.5 Analytics plateforme (P0 instrumentation, P1 tableau)

Événements produit (anonymisés par espace, sans contenu) : `teacher_signed_up`, `course_published`, `student_invited`, `invitation_accepted`, `session_scheduled`, `room_join_attempted`, `room_join_succeeded` (avec `time_to_media_ms`), `session_completed`, `report_published`, `lesson_completed`. Cibles en §23.

## 8.15 Intelligence artificielle (P1/P2, opt-in, D-P17)

Principes : activation par espace (`WorkspaceSettings.ai_enabled`) par un `OWNER/ADMIN` ; information des participants (bandeau « cette session est transcrite ») ; consentement `AI_PROCESSING` des étudiants (tuteurs pour les mineurs) avant toute transcription ; aucune donnée utilisée pour l'entraînement ; fournisseurs sous DPA ; suppression des transcriptions avec l'enregistrement ; sorties toujours présentées comme **brouillons** à valider par le professeur.

| Fonction | Priorité | Entrée | Sortie | Modèle |
|---|---|---|---|---|
| Transcription de session enregistrée | P1 | enregistrement (V2) | `Transcript` horodaté, langue détectée (FR/AR/EN, code-switching) | STT abstrait |
| Résumé de session | P1 | transcript | résumé structuré (points abordés, difficultés, devoirs) | `claude-opus-5-5` |
| Brouillon de compte rendu | P1 | transcript + résumé + cours lié | `SessionReport` pré-rempli, marqué « généré par IA » tant que non édité | `claude-opus-5-5` |
| Génération de quiz | P2 | PDF ou transcript d'une leçon | brouillon de `Quiz` (5–15 questions, QCM/V-F), à relire | `claude-opus-5-5` |
| Assistant Q/R étudiant | P2 | question + contenu des leçons accessibles à l'étudiant (RAG sur texte/transcripts/PDF) | réponse avec citations des leçons ; refus hors périmètre du cours | `claude-opus-5-5` ; `claude-haiku-5-5` pour le routage |

Garde-fous : l'assistant Q/R n'a accès qu'au contenu auquel l'étudiant a accès (même contrôle d'accès que l'API) ; pas d'accès aux messages ni aux notes privées ; journal des requêtes IA par espace ; quota mensuel par espace.

## 8.16 Paramètres, i18n, conformité

### 8.16.1 Internationalisation (P0)

- Locales : `fr` (défaut), `ar` (RTL), `en`. Détection : préférence utilisateur > paramètre d'espace > `Accept-Language`.
- RTL : `dir="rtl"` sur `<html>`, propriétés CSS logiques (`margin-inline-start`…), icônes directionnelles miroir, composants testés en RTL (listes, calendrier, lecteur vidéo, salle).
- Polices avec support arabe (ex. IBM Plex Sans Arabic / Noto Sans Arabic) ; chiffres 0-9 (D-P16) ; dates via `Intl.DateTimeFormat` ; pluriels via ICU MessageFormat.
- Le contenu pédagogique (cours, messages) n'est pas traduit ; chaque cours déclare sa langue (pour la direction du texte des titres).
- Emails et notifications dans la langue du destinataire.

### 8.16.2 Droits des personnes (P0)

- **Export** : « Télécharger mes données » → job → archive ZIP (JSON + fichiers déposés par l'utilisateur, hors contenus du professeur) disponible 7 jours via lien signé ; email à la fin. Pour un mineur : accessible par le tuteur (P1) ou l'étudiant.
- **Suppression de compte** : confirmation par mot de passe (+ 2FA) ; `OWNER` d'organisation doit d'abord transférer ; professeur indépendant : avertissement que l'espace et ses contenus seront supprimés et que les étudiants perdront l'accès ; soft-delete 30 jours (réactivation possible par connexion), puis purge : `User` anonymisé (`deleted_user_{id}`), médias supprimés, messages conservés anonymisés chez les autres participants (« Utilisateur supprimé »), présences conservées anonymisées pour les statistiques du professeur.
- **Rectification** : édition du profil ; email via double confirmation.
- **Consentements** (`Consent`) : `TERMS`, `PRIVACY`, `GUARDIAN_PARENTAL`, `RECORDING` (P1), `AI_PROCESSING` (P1), `WHATSAPP` (P1), `MARKETING` ; versionnés ; page « Mes consentements » avec retrait.
- Registre des traitements, politique de confidentialité FR/AR/EN, notice mineurs, DPA sous-traitants : livrables documentaires de la phase 0/MVP (hors code).

### 8.16.3 Journal d'audit (P0)

`AuditLog` immuable (append-only, 2 ans) : qui (acteur, rôle, IP, user-agent), quoi (`action` ex. `course.deleted`, `enrollment.revoked`, `session.cancelled`, `attendance.overridden`, `member.role_changed`, `invitation.created`, `export.requested`, `consent.granted`, `auth.login_failed`, `admin.support_view`), sur quoi (`entity_type`, `entity_id`, `workspace_id`), avant/après (diff JSON des champs sensibles). Consultable par `OWNER/ADMIN` (filtrable), export CSV (P1).

### 8.16.4 Console super-admin (P0 minimal)

Liste des espaces (type, membres, stockage, créé le), suspension/réactivation (avec motif ; un espace suspendu est en lecture seule avec bannière), quotas, état des jobs/webhooks, **file des signalements d'abus** (filtres, instantané gelé, statut, résolution), **suspension/réactivation d'un professeur** avec motif (§8.1.6), feature flags par espace (P1), « vue support » en lecture seule avec motif consigné et notification au `OWNER` (P1). Aucune édition de contenu pédagogique. Endpoints : `GET /admin/abuse-reports`, `PATCH /admin/abuse-reports/{id}`, `POST /admin/users/{uid}/suspend`, `/unsuspend` (et `GET/PATCH /workspaces/{wid}/abuse-reports` pour les admins d'organisation ; `POST /workspaces/{wid}/abuse-reports` pour tout membre).

## 8.17 Monétisation (P2, esquisse)

- `Product` (`COURSE_ACCESS`, `SESSION_PACK`, `SUBSCRIPTION`), `Price` (devise TND/MAD/DZD/EUR, montant, périodicité), `Order`/`OrderItem`, `Payment` (`provider`, `provider_ref`, `status`), `Subscription`, `Entitlement` (ce que l'achat accorde : inscription à un cours, crédits de sessions, accès espace).
- `PaymentProvider` : `createCheckout(order) → url`, `handleWebhook(payload) → PaymentEvent`, `refund(payment)`. Implémentations : Stripe (FR, cartes internationales), Konnect & Flouci (TN), CMI (MA) ; Algérie : à qualifier (CIB/Edahabia via SATIM) — question ouverte §20.
- Crédits de sessions consommés à `COMPLETED` ; `LATE_CANCELLED` consomme le crédit selon la politique ; `NO_SHOW` professeur rembourse.
- Facturation de la plateforme aux professeurs (abonnement SaaS) : même modèle, `workspace` comme client.

---

# 9. Navigation et écrans

## 9.1 Professeur (et admin avec `can_teach`)

```text
🏠 Dashboard
📚 Cours            Tous · Brouillons · Archivés · + Créer
👨‍🎓 Étudiants        Tous · En attente · + Inviter · Importer CSV
🎥 Sessions         Calendrier · À venir · En direct · Historique · + Nouvelle session
💬 Messages
🔔 Notifications
📊 Statistiques (P1 : vue détaillée ; P0 : dans le dashboard)
⚙️ Paramètres       Profil · Sécurité (2FA, appareils) · Notifications · Espace · Organisation · Données & confidentialité
[ Sélecteur d'espace ▾ ]  (si plusieurs)
```

## 9.2 Administrateur d'organisation

```text
🏠 Tableau de bord organisation (P1 ; P0 : dashboard simplifié = KPIs globaux + sessions du jour)
👩‍🏫 Professeurs       liste, invitations, affectations
👨‍🎓 Étudiants         liste globale, affectation, consentements
📚 Cours              tous les cours de l'organisation (lecture + réaffectation)
🎥 Sessions           calendrier de l'organisation
📜 Journal d'audit
⚙️ Paramètres         organisation, politiques (P1), branding (P1)
```

## 9.3 Étudiant

```text
🏠 Accueil           prochaine session, mes cours, à faire
📚 Mes cours         (tous espaces confondus, filtrables par professeur)
🎥 Sessions          À venir · En direct · Historique
📅 Calendrier        (+ s'abonner ICS)
💬 Messages
🔔 Notifications
👤 Mon profil        Profil · Sécurité · Notifications · Fuseau & langue · Mes données · Mon tuteur
```

## 9.4 Tuteur (P1)

```text
🏠 Mes enfants       (un onglet par enfant) progression · sessions · présence · comptes rendus
📅 Calendrier
💬 Messages          (professeurs de mes enfants)
🛡 Consentements
```

## 9.5 Écrans clés et états

| Écran | États à concevoir |
|---|---|
| Liste de cours | vide (CTA créer), chargement, erreur, brouillons, archivés |
| Éditeur de cours | structure (modules/leçons), édition de leçon par type, upload en cours/échoué/traitement, prévisualisation étudiant, conflit d'édition (409) |
| Lecteur de leçon | vidéo (reprise, vitesse, qualité auto, plein écran, filigrane P1), PDF (visionneuse, télécharger si autorisé), texte, verrouillé, média en traitement, accès révoqué |
| Pré-join / Lobby / Salle | permissions refusées, aucun périphérique, hors fenêtre (compte à rebours), lobby, reconnexion, audio seul, retiré, session terminée, dépassement |
| Calendrier | semaine/mois, vide, conflit, DST (affichage fuseau), récurrence (modifier cette occurrence/suivantes/toutes) |
| Compte rendu | brouillon, publié, modifié, rappel manquant |
| Invitations | en attente, expirée, révoquée, acceptée, compte existant, mineur en attente de consentement |
| Consentement tuteur | page publique (lien signé), expirée, déjà traitée, refus |

---

# 10. Machines à états

Convention : `ÉTAT —(déclencheur, acteur)→ ÉTAT`. « système » = job BullMQ ou webhook. Toute transition est journalisée (`AuditLog` pour les actions humaines, table d'état pour les transitions système).

## 10.1 Session

```text
            ┌────────────────────────────────────────────────────────────────┐
            │                                                                │
SCHEDULED ──┼─(professeur ouvre la salle, dans la fenêtre)────────────▶ LIVE │
   │        │                                                           │    │
   │        │  (dérivé, non stocké : UPCOMING = SCHEDULED et            │    │
   │        │   start_at − 24 h ≤ now ; JOINABLE = SCHEDULED/LIVE et    │    │
   │        │   now ≥ start_at − fenêtre du rôle)                        │    │
   │        │                                                           │    │
   ├─(annuler, professeur/admin ; étudiant via booking P1)──▶ CANCELLED │    │
   │                                                                    │    │
   └─(job à end_at, encore SCHEDULED)───────────────────────▶ NO_SHOW   │    │
                                                                        │    │
LIVE ─(terminer, professeur)────────────────────────────────▶ COMPLETED │    │
LIVE ─(salle vide 5 min, système)───────────────────────────▶ COMPLETED │    │
LIVE ─(auto_end_at atteint, système)────────────────────────▶ COMPLETED │    │
COMPLETED ─(reprendre ≤ 10 min après fin auto, professeur)──▶ LIVE ─────┘    │
                                                                             │
Fin : CANCELLED, NO_SHOW, COMPLETED (sauf reprise ci-dessus)                 │
```

Transition interne sans changement d'état : `LIVE ─(prolonger, professeur, ≤ 2 fois)→ LIVE` avec `auto_end_at += 30 min`, borné à `end_at + 120 min` (D-P5) ; `auto_end_at` est initialisé à `end_at + 60 min` à l'ouverture de la salle.

Invariants : `LIVE` implique `VideoRoom.status = OPEN` ; `COMPLETED` déclenche le calcul de présence et la création du brouillon de compte rendu ; `end_reason ∈ {TEACHER_ENDED, EMPTY_ROOM, TIMEOUT}` est renseigné à chaque passage en `COMPLETED` ; `CANCELLED`/`NO_SHOW` annulent les rappels ; une session de série détachée suit la même machine indépendamment ; la suspension du professeur hôte (D-O6) annule ses sessions `SCHEDULED` et termine ses sessions `LIVE` (`TEACHER_ENDED` par le système, audité).

## 10.2 Booking (P1)

```text
PENDING ─(professeur approuve)──────────────▶ CONFIRMED (crée Session SCHEDULED)
PENDING ─(professeur refuse)────────────────▶ REJECTED
PENDING ─(étudiant retire)──────────────────▶ WITHDRAWN
PENDING ─(72 h sans réponse, système)───────▶ EXPIRED
CONFIRMED ─(étudiant annule avant délai)────▶ CANCELLED_BY_STUDENT  (Session → CANCELLED)
CONFIRMED ─(étudiant annule après délai)────▶ LATE_CANCELLED        (Session → CANCELLED)
CONFIRMED ─(professeur annule)──────────────▶ CANCELLED_BY_TEACHER  (Session → CANCELLED)
CONFIRMED ─(Session COMPLETED/NO_SHOW)──────▶ FULFILLED / NO_SHOW   (miroir de la session)
Politique sans approbation : création directe en CONFIRMED.
```

## 10.3 Invitation

```text
PENDING ─(accepter avec l'email lié)────────▶ ACCEPTED
PENDING ─(expires_at atteint, système)──────▶ EXPIRED
PENDING ─(révoquer, professeur/admin)───────▶ REVOKED
EXPIRED ─(renvoyer)─────────────────────────▶ PENDING (nouveau jeton, nouvelle expiration)
PENDING ─(renvoyer)─────────────────────────▶ PENDING (nouveau jeton ; l'ancien devient invalide)
Lien de groupe (InviteLink) : ACTIVE ⇄ DISABLED ; EXHAUSTED (max_uses) ; EXPIRED.
```

## 10.4 Membership (étudiant)

Une adhésion est propre à un espace ; les états de consentement ci-dessous ne concernent que l'espace de l'adhésion (D-O5).

```text
INVITED (implicite via Invitation) ─(majeur)──────────────────────▶ ACTIVE
                                   ─(code de groupe avec approbation)▶ PENDING_APPROVAL ─(approuver / refuser)▶ ACTIVE | REJECTED
                                   ─(mineur)──────────────────────▶ PENDING_GUARDIAN_CONSENT
PENDING_GUARDIAN_CONSENT ─(tuteur consent pour cet espace)─────────▶ ACTIVE
PENDING_GUARDIAN_CONSENT ─(refus du tuteur, ou 14 j, système)──────▶ SUSPENDED_NO_CONSENT ─(relance acceptée)→ ACTIVE
ACTIVE ─(tuteur révoque pour cet espace)───────────────────────────▶ SUSPENDED_CONSENT_REVOKED ─(nouveau consentement)→ ACTIVE
ACTIVE ─(retirer : OWNER de l'espace personnel ; OWNER/ADMIN d'une organisation)▶ REMOVED ─(réinviter)→ ACTIVE (même Membership réactivé)
Tout état ─(espace suspendu par super-admin)→ accès en lecture seule (flag d'espace, pas d'état de membership)
Aucune transition automatique vers une purge : les données personnelles ne partent qu'avec le compte (§8.16.2).
```

## 10.5 MediaAsset

```text
UPLOADING ─(upload terminé : webhook VOD / complete S3)──▶ PROCESSING
UPLOADING ─(24 h sans complétion, système)───────────────▶ FAILED (abandon)
PROCESSING ─(webhook ready / validation OK)──────────────▶ READY
PROCESSING ─(webhook error / 6 h, système)───────────────▶ FAILED
FAILED ─(réessayer : nouvel upload)──────────────────────▶ nouvel asset (l'ancien est purgé)
READY ─(supprimer, professeur ; non référencé)───────────▶ DELETING ─(fournisseur OK)→ supprimé
```

## 10.6 Submission (devoir, P1)

```text
DRAFT ─(déposer, étudiant)──────────────▶ SUBMITTED  (LATE_SUBMITTED si après échéance et autorisé)
SUBMITTED ─(noter, professeur/assistant)▶ GRADED
SUBMITTED ─(renvoyer pour reprise)──────▶ RETURNED ─(redéposer)→ SUBMITTED (nouvelle version)
GRADED ─(modifier la note)──────────────▶ GRADED (historique)
```

## 10.7 Course

```text
DRAFT ─(publier ; ≥ 1 leçon READY, professeur/admin)──▶ PUBLISHED
PUBLISHED ─(dépublier, professeur/admin)──────────────▶ DRAFT   (les inscrits perdent l'accès ; notification)
PUBLISHED ─(archiver)─────────────────────────────────▶ ARCHIVED (lecture seule pour les inscrits, pas de nouvelle attribution)
ARCHIVED ─(restaurer)─────────────────────────────────▶ PUBLISHED
DRAFT | ARCHIVED ─(supprimer ; aucune inscription active)▶ DELETED (soft, 30 j) ─(purge)→ supprimé
```

## 10.8 Enrollment

```text
ACTIVE ─(retirer le cours)──▶ REVOKED ─(réattribuer)→ ACTIVE (progression conservée)
ACTIVE ─(100 %)─────────────▶ ACTIVE + completed_at (pas un état séparé ; peut redescendre si nouveau contenu)
```

Effets de `ACTIVE → REVOKED` (D-P22) : accès au contenu coupé immédiatement ; session `LIVE` liée au cours où l'étudiant est connecté conservée jusqu'à sa sortie (aucun nouveau jeton) ; participations `SCHEDULED` futures liées au cours → `removed_at` + motif `ENROLLMENT_REVOKED`, notification `ENROLLMENT_REVOKED_SESSIONS_CANCELLED` à l'étudiant et au professeur. `REVOKED → ACTIVE` ne restaure pas les participations annulées (le professeur les ré-ajoute explicitement).

## 10.9 Lesson progress

```text
NOT_STARTED ─(ouvrir)→ IN_PROGRESS ─(règle de complétion ou « Terminé »)→ COMPLETED ─(« Annuler terminé »)→ IN_PROGRESS
```

---

# 11. Modèle de données

Conventions : PostgreSQL ; identifiants `uuid v7` (ordonnés dans le temps) ; `created_at`/`updated_at` `timestamptz` sur toutes les tables ; soft-delete via `deleted_at` là où indiqué ; `workspace_id` **obligatoire** sur toute table tenant (marquée 🏢) et indexé en tête de chaque index composite ; RLS activée sur les tables 🏢 (D-P13) ; noms en anglais (glossaire §21). Les types sont donnés en notation Prisma simplifiée.

## 11.1 Énumérations

```text
WorkspaceType        PERSONAL | ORGANIZATION
WorkspaceStatus      ACTIVE | SUSPENDED | DELETING
PlatformRole         NONE | SUPER_ADMIN
MembershipRole       OWNER | ADMIN | TEACHER | ASSISTANT | STUDENT | GUARDIAN
MembershipStatus     ACTIVE | PENDING_APPROVAL | PENDING_GUARDIAN_CONSENT | SUSPENDED_NO_CONSENT | SUSPENDED_CONSENT_REVOKED | REMOVED | REJECTED
UserStatus           ACTIVE | SUSPENDED | DELETING | DELETED
AbuseCategory        HARASSMENT | INAPPROPRIATE_CONTENT | IMPERSONATION | MINOR_SAFETY | OTHER
AbuseReportStatus    OPEN | IN_REVIEW | RESOLVED | DISMISSED
ParticipantRemovalReason  HOST_REMOVED | ENROLLMENT_REVOKED | MEMBERSHIP_REMOVED | CONSENT_REVOKED | TEACHER_SUSPENDED
InvitationStatus     PENDING | ACCEPTED | EXPIRED | REVOKED
InviteLinkStatus     ACTIVE | DISABLED | EXHAUSTED | EXPIRED
GuardianLinkStatus   PENDING | ACTIVE | REVOKED
ConsentType          TERMS | PRIVACY | CODE_OF_CONDUCT | GUARDIAN_PARENTAL | RECORDING | AI_PROCESSING | WHATSAPP | MARKETING
CourseStatus         DRAFT | PUBLISHED | ARCHIVED
CourseLevel          PRIMAIRE | COLLEGE | LYCEE | SUPERIEUR | ADULTE | AUTRE
LessonType           VIDEO | PDF | TEXT | LINK | EMBED | QUIZ | ASSIGNMENT
UnlockRuleType       NONE | PREVIOUS_MODULE_COMPLETED | AFTER_DATE | DAYS_AFTER_ENROLLMENT | MANUAL
EnrollmentStatus     ACTIVE | REVOKED
LessonProgressStatus NOT_STARTED | IN_PROGRESS | COMPLETED
MediaKind            VIDEO | PDF | IMAGE | FILE | RECORDING
MediaStatus          UPLOADING | PROCESSING | READY | FAILED | DELETING
MediaProvider        CLOUDFLARE_STREAM | MUX | S3
SessionStatus        SCHEDULED | LIVE | COMPLETED | CANCELLED | NO_SHOW
NoShowReason         TEACHER | NOBODY
SessionEndReason     TEACHER_ENDED | EMPTY_ROOM | TIMEOUT
ParticipantRole      HOST | COHOST | STUDENT | OBSERVER
AttendanceStatus     PRESENT | LATE | PARTIAL | ABSENT | NOT_APPLICABLE
VideoRoomStatus      PENDING | OPEN | CLOSED
BookingStatus        PENDING | CONFIRMED | REJECTED | WITHDRAWN | EXPIRED | CANCELLED_BY_STUDENT | LATE_CANCELLED | CANCELLED_BY_TEACHER | FULFILLED | NO_SHOW
ConversationType     DIRECT | SESSION | COURSE | GROUP
MessageStatus        ACTIVE | DELETED
NotificationChannel  IN_APP | EMAIL | WEB_PUSH | WHATSAPP | SMS
DeliveryStatus       QUEUED | SENT | FAILED | SKIPPED | BOUNCED
QuestionType         MCQ_SINGLE | MCQ_MULTI | TRUE_FALSE | SHORT_ANSWER
AttemptStatus        IN_PROGRESS | SUBMITTED | GRADED
SubmissionStatus     DRAFT | SUBMITTED | LATE_SUBMITTED | RETURNED | GRADED
ReportScope          SESSION | PARTICIPANT
ActivityType         LESSON_STARTED | LESSON_COMPLETED | VIDEO_WATCHED | PDF_OPENED | SESSION_ATTENDED | MESSAGE_SENT | QUIZ_SUBMITTED | ASSIGNMENT_SUBMITTED
Locale               fr | ar | en
```

## 11.2 Identité et tenancy

```text
User
- id                 uuid PK
- email              citext UNIQUE
- email_verified_at  timestamptz?
- password_hash      text?                       (null si connexion sociale seule, P1)
- first_name, last_name  text
- avatar_media_id    uuid? → MediaAsset
- locale             Locale  default fr
- timezone           text    default 'Africa/Tunis'   (IANA)
- phone_e164         text? ; phone_verified_at timestamptz?   (obligatoire et vérifié pour tout TEACHER/OWNER/ADMIN, D-O6)
- birth_date         date?                       (obligatoire pour STUDENT ; sert au calcul de minorité)
- platform_role      PlatformRole default NONE
- totp_secret_enc    text? ; totp_enabled_at timestamptz? ; recovery_codes_hash text[]
- status             UserStatus default ACTIVE   (SUSPENDED par le super-admin, D-O6 ; suspended_reason text? ; suspended_at?)
- deleted_at         timestamptz?
- last_login_at      timestamptz?
Index : (email), (status)

UserSession                                       (sessions d'authentification)
- id uuid PK ; user_id → User ; refresh_token_hash text UNIQUE ; family_id uuid
- device_label text ; ip inet ; user_agent text ; created_at ; last_seen_at ; expires_at ; revoked_at?
Index : (user_id), (family_id)

Workspace
- id uuid PK ; type WorkspaceType ; name text ; slug citext UNIQUE
- status WorkspaceStatus default ACTIVE ; suspended_reason text?
- owner_user_id → User
- country char(2)? ; default_timezone text ; default_locale Locale
- logo_media_id uuid? ; brand_color text?        (P1)
- storage_quota_bytes bigint ; storage_used_bytes bigint default 0
- settings jsonb                                  (clés §8.2.1 ; validées par schéma zod versionné)
- ai_enabled bool default false
- allow_personal_workspaces bool default true     (ORGANIZATION seulement, D-O7)
- deleted_at?
Index : (owner_user_id), (status)

Membership 🏢
- id uuid PK ; workspace_id → Workspace ; user_id → User
- role MembershipRole ; can_teach bool default false   (ADMIN qui enseigne)
- status MembershipStatus
- invited_by_user_id uuid? ; joined_at timestamptz? ; removed_at? ; removal_reason text?
UNIQUE (workspace_id, user_id)
Index : (workspace_id, role, status), (user_id)

TeacherStudentAssignment 🏢                         (organisation : quel professeur voit quel étudiant)
- id ; workspace_id ; teacher_user_id → User ; student_user_id → User ; assigned_by_user_id ; created_at
UNIQUE (workspace_id, teacher_user_id, student_user_id)
Règle : dans un espace PERSONAL, une ligne est créée automatiquement (owner, étudiant) pour unifier les requêtes.

TeacherProfile 🏢
- id ; workspace_id ; user_id ; subjects text[] ; bio text ; external_url text?
UNIQUE (workspace_id, user_id)

Invitation 🏢
- id ; workspace_id ; email citext ; role MembershipRole ; first_name text? ; last_name text?
- guardian_email citext? ; birth_date date?
- token_hash text UNIQUE ; expires_at timestamptz ; status InvitationStatus
- invited_by_user_id ; message text? ; course_ids uuid[] ; teacher_user_id uuid?  (affectation org)
- accepted_by_user_id uuid? ; accepted_at? ; revoked_at? ; resent_count int default 0 ; last_sent_at
Index : (workspace_id, status), (workspace_id, email), (token_hash)
Contrainte : au plus une PENDING par (workspace_id, email)  → index unique partiel

InviteLink 🏢
- id ; workspace_id ; code text UNIQUE (8 car.) ; role = STUDENT ; created_by_user_id ; teacher_user_id?
- course_ids uuid[] ; requires_approval bool ; max_uses int ; uses_count int ; expires_at? ; status InviteLinkStatus

GuardianLink 🏢                                   (un lien par espace et par enfant, D-O5)
- id ; workspace_id → Workspace ; guardian_user_id uuid? → User (null tant qu'aucun compte tuteur) ; guardian_email citext
- student_user_id → User ; relationship text (parent, tuteur légal, autre) ; status GuardianLinkStatus
- consent_id uuid? → Consent ; sessions_view_token_hash text? (lien signé « sessions de l'enfant », MVP) ; created_at ; revoked_at?
UNIQUE (student_user_id, workspace_id)
Index : (workspace_id, student_user_id), (guardian_user_id), (guardian_email)

Consent
- id ; user_id → User (la personne concernée) ; granted_by_user_id uuid? ; granted_by_email citext?
- type ConsentType ; version text (ex. 'privacy-2026-10') ; granted bool
- granted_at timestamptz ; revoked_at? ; ip inet ; user_agent text
- workspace_id uuid?  (NULL pour TERMS/PRIVACY/CODE_OF_CONDUCT/MARKETING ; obligatoire pour GUARDIAN_PARENTAL, RECORDING, AI_PROCESSING, WHATSAPP)
Index : (user_id, type), (workspace_id, type)
Index unique partiel : (user_id, workspace_id, type) WHERE type = 'GUARDIAN_PARENTAL' AND revoked_at IS NULL
```

## 11.3 Cours et contenu

```text
Course 🏢
- id ; workspace_id ; owner_user_id → User (professeur)
- title text ; description jsonb (texte riche) ; cover_media_id? ; category text? ; level CourseLevel?
- language Locale ; estimated_minutes int? ; sequential_lessons bool ; is_certifying bool default false (P2)
- status CourseStatus ; published_at? ; archived_at? ; deleted_at?
- version int default 1 ; source_course_id uuid? (duplication, P1)
Index : (workspace_id, owner_user_id, status), (workspace_id, status)

CourseTeacher 🏢 (P1)                              co-professeurs
- course_id ; user_id ; role TEACHER | ASSISTANT ; UNIQUE (course_id, user_id)

Module 🏢
- id ; workspace_id ; course_id → Course ; title ; description text? ; position int
- is_optional bool default false
- unlock_rule jsonb { type: UnlockRuleType, date?: timestamptz, days?: int }
- version int
UNIQUE (course_id, position) DEFERRABLE ; Index : (course_id)

Lesson 🏢
- id ; workspace_id ; module_id → Module ; title ; description text? ; type LessonType ; position int
- is_required bool default true ; estimated_minutes int? ; is_preview bool default false
- media_asset_id uuid? → MediaAsset        (VIDEO, PDF)
- allow_download bool default false        (PDF)
- content jsonb?                           (TEXT : document ProseMirror)
- external_url text? ; embed_url text?     (LINK, EMBED — domaine sur liste blanche)
- quiz_id uuid? ; assignment_id uuid?      (P1)
- version int
UNIQUE (module_id, position) DEFERRABLE ; Index : (module_id), (media_asset_id)
Check : exactement un des (media_asset_id, content, external_url, embed_url, quiz_id, assignment_id) selon type

MediaAsset 🏢
- id ; workspace_id ; owner_user_id ; kind MediaKind ; provider MediaProvider
- provider_asset_id text? (uid Stream / asset id Mux) ; storage_key text? (S3)
- status MediaStatus ; failure_reason text?
- original_filename text ; mime_type text ; size_bytes bigint ; checksum_sha256 text?
- duration_s int? ; width int? ; height int? ; thumbnail_url text? ; page_count int? (PDF)
- upload_url_expires_at? ; processing_started_at? ; ready_at? ; deleted_at?
- session_id uuid? (RECORDING)
Index : (workspace_id, status), (provider, provider_asset_id) UNIQUE partiel, (owner_user_id)

Enrollment 🏢
- id ; workspace_id ; course_id ; student_user_id ; status EnrollmentStatus
- assigned_by_user_id ; activated_at timestamptz ; revoked_at? ; revoked_reason text?
- progress_percent smallint default 0 ; completed_at? ; last_activity_at?
UNIQUE (course_id, student_user_id) ; Index : (workspace_id, student_user_id), (course_id, status)

ModuleUnlock 🏢 (P1)
- module_id ; student_user_id ; unlocked_by_user_id ; created_at ; UNIQUE (module_id, student_user_id)

LessonProgress 🏢
- id ; workspace_id ; lesson_id ; student_user_id ; status LessonProgressStatus
- last_position_s int default 0 ; watched_segments jsonb (array de [start_s, end_s] fusionnés) ; unique_watched_s int
- opened_at? ; completed_at? ; completed_manually bool
UNIQUE (lesson_id, student_user_id) ; Index : (student_user_id, status)

ActivityEvent 🏢
- id ; workspace_id ; user_id ; type ActivityType ; course_id? ; lesson_id? ; session_id? ; value_int int? (secondes) ; occurred_at
Index : (workspace_id, user_id, occurred_at DESC), (workspace_id, occurred_at DESC)
Partition mensuelle recommandée à partir de 10 M de lignes (laissé au builder).
```

## 11.4 Planification et sessions

```text
RecurrenceRule 🏢
- id ; workspace_id ; rrule text (RFC 5545) ; timezone text ; dtstart timestamptz ; until timestamptz? ; count int?
- template jsonb (titre, durée, cours, participants, rappels) ; horizon_generated_until timestamptz
- created_by_user_id ; cancelled_at?

Session 🏢
- id ; workspace_id ; host_user_id → User ; course_id? ; title ; description text?
- start_at timestamptz ; end_at timestamptz ; timezone text ; duration_min int (dérivé, stocké)
- status SessionStatus ; no_show_reason NoShowReason? ; end_reason SessionEndReason?
- series_id uuid? → RecurrenceRule ; occurrence_index int? ; is_detached bool default false
- live_started_at? ; live_ended_at? ; auto_end_at timestamptz? (= end_at + 60 min à l'ouverture, +30 par prolongation, ≤ end_at + 120) ; extension_count smallint default 0 (max 2)
- cancelled_at? ; cancelled_by_user_id? ; cancel_reason text?
- reminder_offsets_min int[] default '{1440,15,0}'
- booking_id uuid? (P1) ; max_participants smallint default 12
- version int ; created_by_user_id
Index : (workspace_id, host_user_id, start_at), (workspace_id, status, start_at), (series_id, occurrence_index)
Index unique partiel : (host_user_id, start_at, end_at) WHERE status IN ('SCHEDULED','LIVE')
Check : end_at > start_at ; duration_min BETWEEN 15 AND 240

SessionParticipant 🏢
- id ; workspace_id ; session_id ; user_id ; role ParticipantRole
- invited_at ; removed_at? ; removed_by_user_id? ; removal_reason ParticipantRemovalReason? ; removal_note text?
- attendance_status AttendanceStatus? ; presence_s int? ; first_joined_at? ; last_left_at?
- attendance_override AttendanceStatus? ; override_reason text? ; override_by_user_id? ; override_at?
UNIQUE (session_id, user_id) ; Index : (user_id, session_id), (workspace_id, user_id)

AttendanceInterval 🏢
- id ; workspace_id ; session_participant_id ; joined_at ; left_at? ; source LIVEKIT_WEBHOOK | RECONCILIATION
Index : (session_participant_id, joined_at)

VideoRoom 🏢
- id ; workspace_id ; session_id UNIQUE ; provider = LIVEKIT ; room_name text UNIQUE ; status VideoRoomStatus
- opened_at? ; closed_at? ; recording_media_id? (P1) ; provider_metadata jsonb

SessionReport 🏢
- id ; workspace_id ; session_id ; scope ReportScope ; participant_user_id? (si PARTICIPANT)
- author_user_id ; content jsonb (texte riche) ; homework text? ; recommendations jsonb (array {lesson_id, note?})
- private_notes jsonb? ; ai_generated bool default false ; published_at? ; updated_after_publish bool
UNIQUE (session_id, scope, participant_user_id) NULLS NOT DISTINCT

AvailabilityRule 🏢 (P1)
- id ; workspace_id ; teacher_user_id ; weekday smallint (0-6) ; start_time time ; end_time time ; timezone text
- durations_min int[] ; valid_from date? ; valid_until date? ; active bool

AvailabilityOverride 🏢 (P1)
- id ; workspace_id ; teacher_user_id ; date date ; kind BLOCKED | ADDED ; start_time? ; end_time? ; reason text?

BookingPolicy 🏢 (P1)
- id ; workspace_id ; teacher_user_id UNIQUE ; min_notice_hours int ; max_advance_days int ; buffer_before_min ; buffer_after_min
- slot_step_min ; requires_approval bool ; student_cancel_deadline_hours int ; max_pending_per_student int ; max_bookings_per_week_per_student int?

Booking 🏢 (P1)
- id ; workspace_id ; teacher_user_id ; student_user_id ; start_at ; end_at ; status BookingStatus
- session_id uuid? UNIQUE ; message text? ; decided_at? ; decided_by_user_id? ; cancel_reason text?
Index : (teacher_user_id, start_at), (student_user_id, status)
Index unique partiel : (teacher_user_id, start_at) WHERE status IN ('PENDING','CONFIRMED')

CalendarFeedToken
- id ; user_id ; token_hash UNIQUE ; created_at ; revoked_at?
```

## 11.5 Communication

```text
Conversation 🏢
- id ; workspace_id ; type ConversationType ; title text? ; course_id? ; session_id? UNIQUE ; created_by_user_id
- last_message_at? ; is_read_only bool default false (SESSION après fin ; COURSE en mode annonces)
Index : (workspace_id, type, last_message_at DESC)
Index unique partiel DIRECT : (workspace_id, LEAST(a,b), GREATEST(a,b)) — matérialisé via colonne direct_key text UNIQUE

ConversationParticipant 🏢
- conversation_id ; user_id ; joined_at ; left_at? ; last_read_at? ; muted bool ; role MEMBER | MODERATOR
UNIQUE (conversation_id, user_id) ; Index : (user_id, last_read_at)

Message 🏢
- id (uuid v7 → ordre temporel) ; workspace_id ; conversation_id ; sender_user_id ; body text ; body_format MARKDOWN_LITE
- status MessageStatus ; deleted_at? ; deleted_by_user_id? ; edited_at? (P1) ; reply_to_message_id? (P1) ; pinned bool (P1)
Index : (conversation_id, id DESC)

Attachment 🏢 (P1)
- id ; workspace_id ; message_id ; media_asset_id ; filename ; size_bytes ; mime_type

Notification
- id ; user_id ; workspace_id uuid? ; type text ; title_key text ; body_key text ; params jsonb ; link text?
- read_at? ; created_at ; dedupe_key text? (ex. lesson_added:{course}:{hour})
Index : (user_id, read_at, created_at DESC) ; UNIQUE partiel (user_id, dedupe_key)

NotificationDelivery
- id ; notification_id ; channel NotificationChannel ; status DeliveryStatus ; provider_message_id text? ; error text?
- attempts smallint ; sent_at? ; created_at
Index : (notification_id), (status, created_at)

NotificationPreference
- id ; user_id ; category text (sessions | reminders | courses | messages | reports | security) ; channel NotificationChannel ; enabled bool
UNIQUE (user_id, category, channel)
+ User.quiet_hours jsonb? (P1). Pas d'offsets de rappel par utilisateur : le calendrier des rappels est `Session.reminder_offsets_min` (D-P23).

PushSubscription (P1) : user_id ; endpoint text UNIQUE ; keys jsonb ; user_agent ; created_at ; failed_at?
```

## 11.6 Évaluations (P1)

```text
Quiz 🏢 : id ; workspace_id ; course_id ; title ; instructions jsonb ; passing_score_pct smallint ; max_attempts smallint? ; time_limit_min int? ; shuffle bool ; show_feedback bool ; version
Question 🏢 : id ; quiz_id ; type QuestionType ; prompt jsonb ; points numeric(5,2) ; position ; explanation jsonb? ; accepted_answers text[] (SHORT_ANSWER)
Choice 🏢 : id ; question_id ; label text ; is_correct bool ; position
QuizAttempt 🏢 : id ; workspace_id ; quiz_id ; student_user_id ; attempt_no smallint ; status AttemptStatus ; started_at ; submitted_at? ; score_pct numeric(5,2)? ; graded_by_user_id? ; UNIQUE (quiz_id, student_user_id, attempt_no)
Answer 🏢 : id ; attempt_id ; question_id ; selected_choice_ids uuid[] ; text_answer text? ; is_correct bool? ; points_awarded numeric(5,2)? ; feedback text?
Assignment 🏢 : id ; workspace_id ; course_id ; lesson_id? ; title ; instructions jsonb ; attachments uuid[] ; due_at timestamptz? ; allow_late bool ; max_score numeric(6,2) ; grading_scheme POINTS | LETTER ; rubric_id? (P2) ; version
Submission 🏢 : id ; workspace_id ; assignment_id ; student_user_id ; version_no smallint ; status SubmissionStatus ; text jsonb? ; attachments uuid[] ; submitted_at? ; score numeric(6,2)? ; grade_letter text? ; feedback jsonb? ; graded_by_user_id? ; graded_at? ; UNIQUE (assignment_id, student_user_id, version_no)
Rubric 🏢 (P2) : id ; workspace_id ; title ; criteria jsonb
Certificate 🏢 (P2) : id ; workspace_id ; course_id ; student_user_id ; serial text UNIQUE ; issued_at ; pdf_media_id ; verification_token UNIQUE
```

## 11.7 Conformité et plateforme

```text
AuditLog                                   (append-only ; pas d'UPDATE/DELETE ; rôle DB dédié en écriture seule)
- id uuid v7 ; workspace_id uuid? ; actor_user_id uuid? ; actor_role text ; action text ; entity_type text ; entity_id uuid?
- before jsonb? ; after jsonb? ; ip inet? ; user_agent text? ; request_id text ; created_at
Index : (workspace_id, created_at DESC), (entity_type, entity_id), (actor_user_id, created_at DESC)

DataExportRequest : id ; user_id ; requested_by_user_id ; status QUEUED | RUNNING | READY | FAILED | EXPIRED ; archive_storage_key? ; expires_at? ; created_at
AccountDeletionRequest : id ; user_id ; requested_at ; scheduled_purge_at ; cancelled_at? ; purged_at?
AbuseReport : id ; workspace_id uuid? (NULL si hors espace, ex. profil) ; reporter_user_id ; category AbuseCategory ; description text ; entity_type text (USER | MESSAGE | SESSION | COURSE) ; entity_id uuid ; context_snapshot jsonb (copie gelée de l'entité au moment du signalement) ; attachments uuid[] ; status AbuseReportStatus ; assigned_to_user_id? ; resolution text? ; resolved_at? ; created_at
  Index : (workspace_id, status, created_at DESC), (entity_type, entity_id) ; catégorie MINOR_SAFETY toujours visible du super-admin.
FeatureFlag (P1) : key text ; workspace_id uuid? ; enabled bool ; UNIQUE (key, workspace_id)
WebhookEvent : id ; provider (LIVEKIT | STREAM | MUX | EMAIL | PAYMENT) ; provider_event_id text UNIQUE ; payload jsonb ; received_at ; processed_at? ; error?   (idempotence des webhooks)
AiJob 🏢 (P1) : id ; workspace_id ; type TRANSCRIBE | SUMMARIZE | DRAFT_REPORT | GENERATE_QUIZ ; session_id? ; lesson_id? ; status ; input_ref ; output_ref ; tokens_in ; tokens_out ; cost_cents ; created_at
Transcript 🏢 (P1) : id ; workspace_id ; session_id ; language ; segments jsonb ; media_id ; created_at
```

## 11.8 Monétisation (V3, esquisse)

```text
Product 🏢 : id ; workspace_id ; type COURSE_ACCESS | SESSION_PACK | SUBSCRIPTION ; name ; course_id? ; session_credits int? ; active
Price 🏢 : id ; product_id ; currency TND | MAD | DZD | EUR ; amount_minor int ; interval NONE | MONTH | YEAR
Order 🏢 : id ; workspace_id ; buyer_user_id ; status PENDING | PAID | FAILED | REFUNDED ; total_minor ; currency
OrderItem 🏢 : order_id ; product_id ; price_id ; quantity
Payment 🏢 : id ; order_id ; provider STRIPE | KONNECT | FLOUCI | CMI ; provider_ref ; status ; raw jsonb ; paid_at?
Subscription 🏢 : id ; workspace_id ; user_id ; product_id ; status ACTIVE | PAST_DUE | CANCELLED ; current_period_end ; provider_ref
Entitlement 🏢 : id ; workspace_id ; user_id ; kind COURSE | SESSION_CREDITS | WORKSPACE_PLAN ; course_id? ; credits_remaining int? ; expires_at? ; source_order_id?
```

## 11.9 Diagramme de relations (principal)

```text
User ──< Membership >── Workspace ──< Course ──< Module ──< Lesson ──> MediaAsset
 │            │              │           │
 │            │              │           └──< Enrollment >── User(student) ──< LessonProgress
 │            │              │
 │            │              ├──< Session ──< SessionParticipant ──< AttendanceInterval
 │            │              │       │  └── VideoRoom
 │            │              │       └──< SessionReport
 │            │              ├──< Conversation ──< Message
 │            │              ├──< Invitation / InviteLink
 │            │              └──< AuditLog
 ├──< GuardianLink >── User(student)
 ├──< Consent
 ├──< Notification ──< NotificationDelivery
 └──< UserSession
```

---

# 12. Surface API et événements WebSocket

Conventions (D-P14) : REST JSON sous `/api/v1` ; authentification par jeton d'accès (cookie ou `Authorization: Bearer`) ; ressources tenant sous `/workspaces/{wid}` ; agrégats utilisateur sous `/me` ; pagination par curseur (`?cursor=&limit=`), filtres en query ; erreurs au format `{ code, message, details?, requestId }` avec codes stables (`MODULE_LOCKED`, `SLOT_TAKEN`, `VERSION_CONFLICT`, `NOT_A_PARTICIPANT`, `OUTSIDE_JOIN_WINDOW`, `GUARDIAN_CONSENT_REQUIRED`, `QUOTA_EXCEEDED`…) ; `If-Match: "{version}"` sur les mises à jour verrouillées (`409 VERSION_CONFLICT`) ; `Idempotency-Key` sur les créations sensibles (sessions, invitations, réservations) ; OpenAPI généré depuis NestJS et partagé avec le front via un package du monorepo.

## 12.1 Endpoints REST (niveau ressource)

| Domaine | Endpoints | Priorité |
|---|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/refresh`, `/auth/verify-email`, `/auth/resend-verification`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/2fa/setup`, `/auth/2fa/verify`, `/auth/2fa/disable`, `/auth/2fa/recovery`, `GET/DELETE /auth/sessions`, `DELETE /auth/sessions/{id}` | P0 |
| Moi | `GET/PATCH /me`, `PATCH /me/password`, `POST /me/email-change`, `GET/PUT /me/notification-preferences`, `GET /me/workspaces`, `GET /me/courses`, `GET /me/sessions?from&to&status`, `GET /me/notifications`, `POST /me/notifications/read-all`, `GET /me/consents`, `POST /me/consents/{type}/revoke`, `POST /me/export`, `GET /me/export/{id}`, `POST /me/delete`, `POST /me/delete/cancel`, `GET/POST/DELETE /me/calendar-feed` | P0 |
| Invitations publiques | `GET /invitations/{token}` (aperçu), `POST /invitations/{token}/accept`, `GET /join/{code}`, `POST /join/{code}/accept`, `GET /guardian-consent/{token}`, `POST /guardian-consent/{token}` (accorder/refuser) | P0 |
| Espaces | `POST /workspaces` (organisation), `GET/PATCH /workspaces/{wid}`, `GET/PATCH /workspaces/{wid}/settings`, `DELETE /workspaces/{wid}`, `POST /workspaces/{wid}/transfer-ownership`, `GET /workspaces/{wid}/audit-log`, `GET /workspaces/{wid}/storage` | P0 |
| Membres | `GET /workspaces/{wid}/members?role&status&q`, `GET /workspaces/{wid}/members/{uid}`, `PATCH …/members/{uid}` (rôle, can_teach), `DELETE …/members/{uid}`, `POST …/members/{uid}/approve`, `POST …/members/{uid}/reject`, `GET/POST/DELETE /workspaces/{wid}/assignments` (professeur ↔ étudiant) | P0 |
| Invitations | `GET/POST /workspaces/{wid}/invitations`, `POST …/invitations/{id}/resend`, `DELETE …/invitations/{id}`, `POST …/invitations/import` (CSV → job), `GET …/invitations/import/{jobId}`, `GET/POST /workspaces/{wid}/invite-links`, `PATCH/DELETE …/invite-links/{id}` | P0 |
| Étudiants (vue professeur) | `GET /workspaces/{wid}/students` (liste enrichie : progression, présence, dernière activité), `GET …/students/{uid}/profile`, `GET …/students/{uid}/activity`, `GET …/students/{uid}/progress`, `GET …/students/{uid}/sessions`, `GET …/students/{uid}/attendance`, `PATCH …/students/{uid}` (prénom/nom/tuteur), `POST …/students/{uid}/guardian/resend-consent` | P0 |
| Cours | `GET/POST /workspaces/{wid}/courses`, `GET/PATCH/DELETE …/courses/{cid}`, `POST …/courses/{cid}/publish`, `/unpublish`, `/archive`, `/restore`, `/duplicate` (P1), `POST …/courses/{cid}/reassign` (admin), `GET …/courses/{cid}/structure` (modules + leçons + statuts médias), `GET …/courses/{cid}/enrollments`, `POST …/courses/{cid}/enrollments` (batch), `DELETE …/courses/{cid}/enrollments/{uid}`, `GET …/courses/{cid}/progress` (par étudiant) | P0 |
| Modules / leçons | `POST …/courses/{cid}/modules`, `PATCH/DELETE …/modules/{mid}`, `POST …/courses/{cid}/modules/reorder`, `POST …/modules/{mid}/lessons`, `PATCH/DELETE …/lessons/{lid}`, `POST …/modules/{mid}/lessons/reorder`, `POST …/modules/{mid}/unlock/{uid}` (P1) | P0 |
| Médias | `POST /workspaces/{wid}/media/uploads` (→ URL tus ou multipart présignée + `mediaId`), `POST …/media/{id}/complete`, `GET …/media/{id}`, `DELETE …/media/{id}`, `GET …/media/{id}/playback` (jeton signé vidéo / URL inline PDF), `GET …/media/{id}/download` (si autorisé), `POST /webhooks/media/{provider}` (signé) | P0 |
| Apprentissage (étudiant) | `GET /me/courses/{cid}` (structure avec verrous et progression), `GET /me/lessons/{lid}` (contenu + playback), `POST /me/lessons/{lid}/progress` (position, segments — batché toutes les 10 s), `POST /me/lessons/{lid}/complete`, `POST /me/lessons/{lid}/uncomplete`, `POST /me/lessons/{lid}/opened` | P0 |
| Sessions | `GET /workspaces/{wid}/sessions?from&to&status&hostId&studentId`, `POST …/sessions` (ponctuelle, récurrente ou immédiate), `GET/PATCH …/sessions/{sid}` (`?scope=this|following|all` pour les séries), `POST …/sessions/{sid}/cancel` (`?scope`), `POST …/sessions/{sid}/participants`, `DELETE …/sessions/{sid}/participants/{uid}`, `GET …/sessions/{sid}/conflicts` (pré-vérification), `GET …/sessions/{sid}/attendance`, `PATCH …/sessions/{sid}/attendance/{uid}` (correction), `GET …/sessions/{sid}/history` (transitions) | P0 |
| Salle | `POST /workspaces/{wid}/sessions/{sid}/room/token` (→ jeton LiveKit, URL SFU, rôle, `joinable_at`), `POST …/room/open` (hôte → LIVE), `POST …/room/end`, `POST …/room/resume`, `POST …/room/extend`, `POST …/room/participants/{uid}/mute`, `POST …/room/mute-all`, `POST …/room/participants/{uid}/remove`, `GET …/room/lobby` (qui attend), `POST /webhooks/livekit` (signé) | P0 |
| Comptes rendus | `GET …/sessions/{sid}/reports`, `PUT …/sessions/{sid}/reports/{scope}/{uid?}` (upsert brouillon), `POST …/reports/{rid}/publish`, `GET /me/sessions/{sid}/report` | P0 |
| Calendrier | `GET /me/calendar?from&to` (sessions + bookings), `GET /calendar/{token}.ics` (public, jeton), `GET …/sessions/{sid}/ics` | P0 |
| Disponibilités / réservation (P1) | `GET/PUT /workspaces/{wid}/teachers/{uid}/availability`, `GET/POST/DELETE …/availability/overrides`, `GET/PUT …/teachers/{uid}/booking-policy`, `GET …/teachers/{uid}/slots?from&to&duration&tz`, `POST …/bookings`, `GET /me/bookings`, `POST …/bookings/{id}/approve`, `/reject`, `/cancel`, `/reschedule` | P1 |
| Messagerie | `GET /me/conversations`, `POST /workspaces/{wid}/conversations` (DIRECT/GROUP/COURSE), `GET …/conversations/{id}/messages?cursor`, `POST …/conversations/{id}/messages`, `DELETE …/messages/{mid}`, `POST …/conversations/{id}/read`, `POST …/messages/{mid}/report` (P1), `POST …/conversations/{id}/attachments` (P1) | P0 |
| Notifications | (voir `/me/notifications`), `POST /me/push-subscriptions` (P1), `POST /webhooks/email` (rebonds) | P0 |
| Évaluations (P1) | `…/courses/{cid}/quizzes` CRUD, `…/quizzes/{qid}/questions` CRUD, `POST /me/quizzes/{qid}/attempts`, `PUT /me/attempts/{aid}/answers`, `POST /me/attempts/{aid}/submit`, `…/assignments` CRUD, `POST /me/assignments/{aid}/submissions`, `POST …/submissions/{sid}/grade`, `/return` | P1 |
| Analytics | `GET /workspaces/{wid}/dashboard/teacher?period`, `GET …/dashboard/organization?period` (P1), `GET …/reports/export?type=students|attendance|progress&format=csv` (P1), `GET …/students/{uid}/report.pdf?from&to` (P1), `POST /analytics/events` (front → événements produit, batché) | P0/P1 |
| Signalements (D-O6) | `POST /workspaces/{wid}/abuse-reports` (tout membre ; `POST /abuse-reports` pour un profil hors espace), `GET /me/abuse-reports`, `GET/PATCH /workspaces/{wid}/abuse-reports` (admins d'organisation), `GET/PATCH /admin/abuse-reports` (super-admin) | P0 |
| Super-admin | `GET /admin/workspaces`, `POST /admin/workspaces/{wid}/suspend`, `/unsuspend`, `PATCH /admin/workspaces/{wid}/quota`, `POST /admin/users/{uid}/suspend`, `/unsuspend` (D-O6), `GET /admin/health` (jobs, webhooks, files d'attente), `GET/PUT /admin/feature-flags` (P1), `POST /admin/support-view` (P1) | P0 |
| IA (P1/P2) | `POST …/sessions/{sid}/ai/transcribe`, `POST …/sessions/{sid}/ai/draft-report`, `POST …/lessons/{lid}/ai/generate-quiz`, `POST /me/courses/{cid}/ai/ask`, `GET …/ai/jobs/{id}` | P1/P2 |

## 12.2 WebSocket

Socket.IO (ou équivalent) avec adaptateur Redis ; authentification à la connexion (même jeton) ; un socket rejoint les « rooms » : `user:{uid}`, `workspace:{wid}:user:{uid}`, `conversation:{cid}` (à l'ouverture d'une conversation), `session:{sid}` (lobby et salle). Les événements de média (audio/vidéo) passent par LiveKit, pas par ce canal.

| Espace de noms | Événement (serveur → client) | Charge utile | Priorité |
|---|---|---|---|
| `/notifications` | `notification.created` | notification complète | P0 |
| | `notification.read` | `{ id }` (sync multi-onglets) | P0 |
| | `unread.count` | `{ notifications, messages }` | P0 |
| `/chat` | `message.created` | message | P0 |
| | `message.deleted` | `{ conversationId, messageId }` | P0 |
| | `conversation.read` | `{ conversationId, userId, lastReadAt }` | P0 |
| | `typing` (client ↔ serveur, éphémère, débit limité 1/2 s) | `{ conversationId, userId }` | P0 |
| | `attachment.ready` | `{ messageId, attachment }` | P1 |
| `/sessions` | `session.status_changed` | `{ sessionId, status, liveStartedAt?, endReason? }` | P0 |
| | `session.updated` | `{ sessionId, startAt, endAt, version }` | P0 |
| | `lobby.updated` | `{ sessionId, waiting: [{ userId, since }] }` (hôte) | P0 |
| | `room.participant_joined` / `room.participant_left` | `{ sessionId, userId, at }` (miroir des webhooks, pour la liste côté hôte) | P0 |
| | `room.control` | `{ action: MUTE | UNMUTE_REQUEST | CAMERA_REQUEST | REMOVED | ENDING_SOON | ENDED, by, reason? }` vers un participant | P0 |
| | `room.token_refresh_hint` | `{ sessionId }` (8 min) | P0 |
| `/media` | `media.status_changed` | `{ mediaId, status, failureReason? }` (éditeur de cours) | P0 |
| `/jobs` | `job.progress` | `{ jobId, type, percent, result? }` (import CSV, export, IA) | P0 |

Événements client → serveur hors `typing` : aucun (toutes les mutations passent par REST pour l'audit et l'idempotence).

## 12.3 Webhooks entrants

| Source | Événements traités | Garanties |
|---|---|---|
| LiveKit | `room_started`, `room_finished`, `participant_joined`, `participant_left`, (`egress_ended` P1) | signature vérifiée ; stockage dans `WebhookEvent` (idempotence par `provider_event_id`) ; traitement en job ; réconciliation toutes les 60 s pendant `LIVE` via l'API LiveKit (liste des participants) pour corriger les webhooks perdus |
| VOD (Stream/Mux) | `video.ready`, `video.error`, (`live` non utilisé) | signature ; idempotence ; mise à jour `MediaAsset` + événement `media.status_changed` |
| Email | `bounce`, `complaint`, `delivered` | marque `NotificationDelivery` ; adresse `bounced` après 2 rebonds durs |
| Paiement (V3) | selon fournisseur | signature ; idempotence ; machine d'état `Order` |

---

# 13. Architecture technique

## 13.1 Vue d'ensemble

```text
                        ┌──────────────────────────────┐
   Navigateur / PWA ───▶│  apps/web  (Next.js, App     │
   (FR/AR/EN, RTL)      │  Router, SSR + RSC, next-intl)│
                        └──────────────┬───────────────┘
                                       │ HTTPS (REST /api/v1, WS)
                        ┌──────────────▼───────────────┐
                        │  apps/api  (NestJS)           │
                        │  modules : auth, workspaces,  │
                        │  members, courses, media,     │
                        │  learning, scheduling, rooms, │
                        │  attendance, reports, chat,   │
                        │  notifications, analytics,    │
                        │  compliance, admin            │
                        └───┬──────────┬──────────┬─────┘
                            │          │          │
             ┌──────────────▼──┐  ┌────▼─────┐  ┌─▼──────────────┐
             │ PostgreSQL      │  │ Redis    │  │ apps/worker    │
             │ (Prisma, RLS)   │  │ (cache,  │  │ (BullMQ :      │
             │                 │  │ BullMQ,  │  │ rappels, état  │
             └─────────────────┘  │ WS adapt)│  │ sessions,      │
                                  └──────────┘  │ présence, mails│
                                                │ imports, export│
                                                │ purge, IA)     │
                                                └────────────────┘
   Services externes (tous derrière une interface dans packages/providers) :
   LiveKit Cloud (SFU + webhooks) · Cloudflare Stream (VOD) · S3-compatible (R2/S3)
   · Email transactionnel (ex. Resend/Postmark/SES) · Web Push (VAPID) · WhatsApp Cloud API (P1)
   · STT + Claude (P1/P2) · Stripe/Konnect/Flouci/CMI (V3)
```

## 13.2 Monorepo (structure cible, laissée au builder pour le détail)

```text
apps/web          Next.js (App Router), PWA (service worker : cache des shells, page hors-ligne, push P1)
apps/api          NestJS (REST + gateways WebSocket)
apps/worker       NestJS standalone (processeurs BullMQ) — même code base que l'API, processus séparé
packages/db       schéma Prisma, migrations, extension d'isolation tenant, seeds
packages/contracts  schémas zod + types partagés + client OpenAPI généré
packages/providers  interfaces VideoProvider, StorageProvider, LiveProvider, EmailProvider, PushProvider, PaymentProvider (V3), SttProvider/LlmProvider (P1) + implémentations
packages/ui       composants (design system, RTL-ready), lecteur vidéo, visionneuse PDF, composants de salle
packages/i18n     messages FR/AR/EN, utilitaires de formatage
packages/config   eslint, tsconfig, tailwind, jest
```

## 13.3 Isolation multi-tenant (D-P13)

1. Chaque requête authentifiée résout `(user, workspace)` depuis l'URL ; un garde NestJS vérifie le `Membership` et charge les permissions (§7) dans le contexte de requête.
2. L'extension Prisma `tenantScoped` ajoute `where: { workspace_id }` à toute opération sur une table 🏢 et refuse toute requête sans contexte tenant (sauf chemins explicitement marqués `crossTenant` : `/me/…`, super-admin, jobs système — qui passent toujours par des requêtes filtrées par `user_id`).
3. PostgreSQL RLS : politiques `USING (workspace_id = current_setting('app.workspace_id')::uuid)` sur les tables 🏢 ; l'API exécute `SET LOCAL app.workspace_id` dans chaque transaction ; le rôle de connexion n'a pas `BYPASSRLS` ; un rôle `app_system` (worker, migrations) l'a, avec journalisation.
4. Tests d'isolation automatisés : pour chaque endpoint tenant, un test tente l'accès avec un membre d'un autre espace et attend `403/404`.

## 13.4 Interfaces fournisseurs (contrats minimaux)

```text
VideoProvider      createDirectUpload(maxBytes, maxDurationS) → { uploadUrl, providerAssetId, expiresAt }
                   getAsset(id) → { status, durationS, width, height, thumbnailUrl }
                   signPlayback(id, { userId, ttlS }) → { token | url }
                   delete(id) ; verifyWebhook(req) → events[]
StorageProvider    createMultipartUpload(key, mime) ; signPartUrl ; completeMultipart ; signGetUrl(key, ttlS, disposition) ; delete ; head
LiveProvider       createRoom(name, opts) ; issueToken({ room, identity, role, ttlS, permissions }) ; listParticipants(room)
                   removeParticipant(room, identity) ; mutePublishedTrack(room, identity, kind) ; endRoom(room) ; verifyWebhook(req) → events[]
EmailProvider      send({ to, templateKey, locale, params, ics? }) → providerMessageId ; verifyWebhook
PushProvider       send(subscription, payload)
MessagingProvider  (P1) sendTemplate({ phone, templateKey, locale, params }) — WhatsApp / SMS
SttProvider        (P1) transcribe(mediaUrl, langHints[]) → Transcript
LlmProvider        (P1) complete({ model, system, input, schema? }) — implémentation Claude
PaymentProvider    (V3) createCheckout ; handleWebhook ; refund
```

## 13.5 Jobs (BullMQ) — files et responsabilités

| File | Jobs | Déclencheur | Idempotence |
|---|---|---|---|
| `sessions` | `session.reminder`, `session.no_show_check` (à `end_at`), `session.teacher_late_check` (`start_at + 5`), `session.empty_room_check`, `session.ending_soon` (à `auto_end_at − 10`), `session.auto_end` (à `auto_end_at`, replanifiés à chaque prolongation), `session.finalize` (présence, brouillon de compte rendu), `series.extend_horizon` (quotidien) | planification des sessions, webhooks | `jobId` déterministe incluant `version` ; revérification de l'état à l'exécution |
| `notifications` | `notification.deliver.{channel}` | création de notification | clé `notification_id + channel` |
| `media` | `media.webhook.process`, `media.cleanup_abandoned` (horaire), `media.delete` | webhooks, planification | `WebhookEvent` unique |
| `imports` | `invitations.import_csv` | upload CSV | job unique par fichier |
| `compliance` | `account.export`, `account.purge`, `workspace.purge`, `consent.expire` (quotidien), `audit.retention` | demandes utilisateur, calendrier | par identifiant de demande |
| `analytics` | `progress.recompute_course` (changement de structure), `activity.rollup_daily`, `risk.evaluate_weekly` (P1) | mutations, calendrier | par cours / jour |
| `ai` (P1) | `ai.transcribe`, `ai.summarize`, `ai.draft_report`, `ai.generate_quiz` | demandes | par `AiJob` |

## 13.6 Environnements et déploiement

- Environnements : `dev` (local : docker-compose Postgres + Redis + LiveKit dev + MinIO ; fournisseurs VOD/email en mode sandbox ou mock), `staging` (copie de prod avec données de démo), `prod` (UE-Paris, D-P4).
- Déploiement conteneurisé (web, api, worker) ; migrations Prisma exécutées avant le déploiement (expand/contract pour les changements non rétrocompatibles) ; rollback = redéploiement de l'image précédente.
- Secrets dans le gestionnaire du fournisseur d'hébergement ; aucune clé dans le dépôt ; rotation des clés LiveKit/VOD semestrielle.
- Le choix précis de l'hébergeur (PaaS vs Kubernetes) est laissé au builder sous contrainte des NFR §14.

---

# 14. Exigences non fonctionnelles

Toutes les valeurs sont des exigences de recette (mesurées en staging avec des données représentatives : 200 espaces, 5 000 étudiants, 20 000 leçons, 50 000 sessions) sauf mention « cible de production ».

## 14.1 Performance

| Mesure | Exigence |
|---|---|
| API lecture (p95) | < 300 ms (listes paginées ≤ 50 éléments) |
| API écriture (p95) | < 600 ms ; création de session récurrente (52 occurrences) < 2 s |
| Émission d'un jeton de salle | p95 < 200 ms |
| Web : LCP (p75, Android milieu de gamme, 4G simulée) | < 2,5 s sur dashboard, liste de cours, page de leçon |
| Web : INP (p75) | < 200 ms |
| Poids JS initial (route étudiant) | < 250 Ko gzip hors lecteur vidéo (chargé à la demande) |
| Démarrage de lecture vidéo (p75) | < 2 s après clic (HLS, qualité initiale adaptée) |
| Reprise de position vidéo | exacte à ± 2 s |
| Livraison WebSocket (message/notification) | < 500 ms p95 serveur → client |
| Rappels | déclenchés à ± 60 s de l'offset |
| Upload | reprise sans perte après coupure ; débit limité uniquement par le réseau |

## 14.2 Qualité du direct (D-P2)

| Mesure | Exigence |
|---|---|
| Capacité | 1 hôte + 12 étudiants en vidéo (MVP) ; 1 + 40 en mode classe (P1) |
| Temps « clic Rejoindre → premier média distant » | p50 < 3 s, p95 < 8 s |
| Taux de succès de connexion | ≥ 98 % (cible prod ≥ 99 %) |
| Reconnexion après coupure < 60 s | automatique, sans action utilisateur, présence continue |
| Qualité | simulcast 180p/360p/720p ; adaptation automatique ; audio Opus 32 kbps avec suppression de bruit ; repli audio seul manuel et automatique |
| Latence audio/vidéo (SFU UE ↔ Maghreb) | < 300 ms bout en bout en conditions normales |
| Exactitude de la présence | intervalles exacts à ± 5 s ; aucune session `COMPLETED` sans statut de présence calculé |

## 14.3 Disponibilité et résilience

- SLO disponibilité mensuelle : **99,5 %** au MVP (≈ 3,6 h d'indisponibilité/mois), cible 99,9 % en V2 ; fenêtre de maintenance annoncée (hors 8h–22h heure de Tunis).
- SLO spécifique « salle joignable » : 99,5 % des sessions planifiées dont la salle est ouvrable dans la fenêtre.
- Dégradation gracieuse : panne VOD → lecture indisponible mais le reste fonctionne ; panne email → notifications in-app + file de retry ; panne Redis → API en lecture dégradée (pas de temps réel), jobs reprennent ; panne LiveKit → message explicite et rappel automatique quand rétabli.
- Health checks (`/health/live`, `/health/ready`) sur web, api, worker ; redémarrage automatique.

## 14.4 Scalabilité (hypothèses)

- An 1 : 500 espaces, 15 000 utilisateurs, 300 sessions/jour (pointes 60 simultanées = ~500 participants), 2 To de vidéo.
- Stateless web/api/worker (scalables horizontalement) ; Redis pour l'état partagé ; PostgreSQL managé avec réplica de lecture prévu (pas nécessaire au MVP).
- Index composés `workspace_id`-first ; pas de requêtes N+1 (tests de budget de requêtes par endpoint) ; agrégats du dashboard calculés par requêtes SQL dédiées (pas d'ORM naïf) et mis en cache 60 s par espace.

## 14.5 Accessibilité et internationalisation

- WCAG 2.1 niveau AA : contraste, navigation clavier complète (y compris salle : raccourcis micro/caméra), focus visible, étiquettes ARIA, lecteur vidéo accessible (sous-titres P2), messages d'erreur liés aux champs, pas de contenu clignotant.
- RTL complet en AR ; capture d'écran de recette de chaque écran clé en AR ; test automatisé de direction sur les composants du design system.
- Tailles de police ajustables (zoom 200 % sans perte de fonction) ; cibles tactiles ≥ 44 px.

## 14.6 Compatibilité

- Navigateurs : Chrome, Edge, Firefox, Safari — 2 dernières versions majeures ; Safari iOS ≥ 16.4 ; Chrome Android ≥ 110 ; Samsung Internet 2 dernières. Salle vidéo : mêmes navigateurs (WebRTC) ; détection et message explicite sinon.
- Appareils : Android 10+, iOS 16.4+, écrans ≥ 360 px de large.
- PWA : installable, shell hors-ligne (« vous êtes hors ligne, vos sessions à venir : … » depuis le cache), push P1.
- Pas d'application native au MVP (P2 : Capacitor ou React Native sur la même API).

## 14.7 Sécurité

- Référentiel : **OWASP ASVS 4.0 niveau 2** ; revue de sécurité avant lancement ; tests d'intrusion avant ouverture aux organisations (P1).
- Transport : TLS 1.2+ (1.3 préféré), HSTS, cookies `Secure/HttpOnly/SameSite`, CSP stricte (nonce), `X-Frame-Options`/`frame-ancestors` (sauf embeds autorisés), CORS restreint.
- Stockage : chiffrement au repos (PostgreSQL managé, S3 SSE), secrets TOTP chiffrés applicativement (AES-256-GCM, clé en KMS), sauvegardes chiffrées.
- Authentification : §8.1.2 (argon2id, 2FA, rotation des jetons, détection de réutilisation), limitation de débit (login 5/min, API 600 req/min/utilisateur, 60 req/min par IP non authentifiée, jetons de salle 10/min/utilisateur), verrouillage progressif, emails de sécurité.
- Autorisation : matrice §7 encodée en politiques testées ; isolation §13.3 ; aucune autorisation côté client seulement.
- Entrées : validation zod sur toutes les entrées ; texte riche assaini (liste blanche de nœuds/attributs) ; fichiers vérifiés par signature ; iframes limitées à une liste blanche ; URLs signées courtes.
- Webhooks : signatures vérifiées, horodatage ± 5 min, idempotence.
- Journalisation : `AuditLog` §8.16.3 ; journaux applicatifs sans données personnelles sensibles (emails hachés), `request_id` corrélé.
- Dépendances : analyse automatique (Dependabot/Renovate + audit), images de base mises à jour mensuellement.
- Mineurs : aucune donnée de mineur dans les outils d'analytics tiers ; pas de publicité ; pas de profilage.
- Signalement d'abus : adresse dédiée + bouton de signalement (P1) ; procédure de notification de violation (72 h) documentée.

## 14.8 Sauvegardes et reprise

- PostgreSQL : sauvegarde complète quotidienne + archivage WAL continu → **RPO ≤ 15 min** ; **RTO ≤ 4 h** (restauration testée trimestriellement en staging).
- Stockage objet : versioning + réplication inter-régions UE ; vidéos VOD : le fournisseur conserve, les originaux ne sont **pas** dupliqués (le professeur est informé de garder ses fichiers sources — décision de coût, planificateur).
- Redis : non critique (reconstruit) ; les jobs planifiés sont re-dérivables depuis la base (job quotidien de réconciliation `sessions.reschedule_missing_jobs`).
- Rétention des sauvegardes : 30 jours.

## 14.9 Observabilité

- Logs structurés JSON (pino) avec `request_id`, `user_id` (haché), `workspace_id` ; centralisés ; 30 jours.
- Métriques (Prometheus/OpenTelemetry) : latence par route, erreurs, profondeur des files, délais des rappels, succès de jointure de salle, `time_to_media_ms`, webhooks en retard, utilisation du stockage par espace.
- Traces distribuées (OpenTelemetry) web → api → db/jobs sur 10 % des requêtes, 100 % des erreurs.
- Erreurs front et back (Sentry ou équivalent) avec `release` ; alertes : taux d'erreur 5xx > 1 % 5 min, rappels en retard > 2 min, échecs de jointure > 5 % 10 min, file `sessions` > 1 000 jobs en attente, webhooks LiveKit absents pendant une session `LIVE` > 3 min.
- Tableau de bord opérationnel + page de statut publique (P1).

## 14.10 Rétention des données (D-P19)

| Donnée | Rétention | Suppression |
|---|---|---|
| Comptes supprimés | 30 j de grâce | anonymisation + purge des médias |
| Espaces supprimés | 30 j | purge complète (médias chez les fournisseurs inclus) |
| Messages | durée de vie de l'espace ; conversations `SESSION` : 12 mois après la session | job mensuel |
| Enregistrements de session (P1) | 12 mois par défaut (3–24 par espace) | job quotidien + notification 7 j avant |
| Transcriptions (P1) | identique à l'enregistrement | idem |
| Présences, comptes rendus, progression | durée de vie de l'inscription/espace | avec l'espace |
| Journal d'audit | 2 ans | job mensuel |
| Logs applicatifs | 30 j | rotation |
| Événements produit | 13 mois, agrégés ensuite | rollup |
| Invitations expirées | 90 j | job |
| Exports RGPD | 7 j | job |
| Sauvegardes | 30 j | rotation |

## 14.11 Qualité logicielle

- Tests : unitaires (règles de présence, progression, récurrence/DST, politiques de réservation, permissions), intégration (API + base, isolation tenant par endpoint), bout en bout (Playwright : parcours professeur et étudiant complets, FR et AR, mobile viewport), tests de salle avec clients LiveKit simulés (jointure, reconnexion, retrait).
- CI : lint, typecheck, tests, build, migration à blanc ; déploiement staging automatique ; prod sur approbation.
- Définition de « terminé » d'une fonctionnalité : critères d'acceptation §15 automatisés ou vérifiés en recette, traductions FR/AR/EN présentes, RTL vérifié, événements d'audit et d'analytics émis, documentation d'exploitation (runbook) mise à jour.

---

# 15. Critères d'acceptation

Format : **Étant donné** (contexte) / **Quand** (action) / **Alors** (résultat observable). Tous les critères ci-dessous couvrent des fonctionnalités **P0** sauf les blocs marqués (P1), fournis pour les sous-projets dont le modèle est posé au MVP. Chaque critère doit être automatisé (unitaire, intégration ou E2E) ou vérifié en recette avec preuve.

## 15.1 Authentification et compte (AC-AUTH)

- **AC-AUTH-01** Étant donné un visiteur sur « Je suis professeur » / Quand il s'inscrit avec un email valide et un mot de passe de 12 caractères non compromis / Alors un `User`, un `Workspace PERSONAL` (`OWNER`) et un email de vérification sont créés, et l'accès est limité à la page de vérification jusqu'au clic.
- **AC-AUTH-02** Étant donné un mot de passe présent dans la liste des mots de passe compromis / Quand l'utilisateur tente de l'utiliser / Alors l'inscription est refusée avec un message explicite, sans révéler la source.
- **AC-AUTH-03** Étant donné 5 échecs de connexion en 1 min pour un même email+IP / Quand une 6e tentative arrive / Alors elle est refusée (`429`) avec délai croissant ; après 10 échecs un email d'alerte est envoyé et le compte est verrouillé 15 min.
- **AC-AUTH-04** Étant donné un jeton de rafraîchissement déjà utilisé (rotation) / Quand il est présenté à nouveau / Alors toute la famille de jetons est révoquée et l'utilisateur est déconnecté de tous ses appareils, avec email de sécurité.
- **AC-AUTH-05** Étant donné un utilisateur promu `ADMIN` d'une organisation sans 2FA / Quand il se connecte / Alors il est forcé de configurer TOTP (et de télécharger ses codes de secours) avant d'accéder à l'organisation.
- **AC-AUTH-06** Étant donné un lien de réinitialisation de plus d'1 h ou déjà utilisé / Quand il est ouvert / Alors une page « lien expiré » propose d'en demander un nouveau ; aucune information sur l'existence du compte n'est révélée.
- **AC-AUTH-07** Étant donné un utilisateur connecté sur 3 appareils / Quand il clique « Déconnecter partout » / Alors les 3 sessions sont révoquées en ≤ 15 s (expiration du jeton d'accès) et listées comme révoquées.

## 15.2 Espaces, membres, permissions (AC-WS)

- **AC-WS-01** Étant donné un professeur `TEACHER` de l'organisation A / Quand il appelle n'importe quel endpoint `/workspaces/{B}/…` d'une organisation B dont il n'est pas membre / Alors la réponse est `404` (jamais `403` révélant l'existence) et un événement d'audit `auth.forbidden_workspace` est enregistré.
- **AC-WS-02** Étant donné un professeur `TEACHER` d'une organisation avec 2 étudiants affectés sur 50 / Quand il liste `/students` / Alors il ne voit que ses 2 étudiants ; l'`ADMIN` voit les 50.
- **AC-WS-03** Étant donné un `ADMIN` sans `can_teach` / Quand il tente de créer un cours / Alors `403 PERMISSION_DENIED` ; avec `can_teach = true`, le cours est créé avec `owner_user_id` = lui.
- **AC-WS-04** Étant donné un `OWNER` d'organisation / Quand il transfère la propriété à un `ADMIN` / Alors l'ancien devient `ADMIN`, le nouveau `OWNER`, l'action est auditée et les deux sont notifiés.
- **AC-WS-05** Étant donné un professeur membre de l'organisation A ayant 3 sessions futures / Quand l'admin tente de le retirer / Alors le retrait est refusé avec la liste des sessions à réaffecter ou annuler.
- **AC-WS-06** Étant donné un espace suspendu par le super-admin / Quand un membre se connecte / Alors il voit une bannière, toutes les mutations renvoient `423 WORKSPACE_SUSPENDED`, la lecture reste possible.
- **AC-WS-07** Étant donné une requête tenant exécutée sans `SET LOCAL app.workspace_id` (test d'intégration) / Quand elle touche une table 🏢 / Alors PostgreSQL renvoie 0 ligne (RLS) et l'extension Prisma lève une erreur `TENANT_CONTEXT_MISSING`.
- **AC-WS-08 (D-O7)** Étant donné un professeur ayant accepté une invitation d'organisation / Quand son compte est créé / Alors il n'a aucun espace `PERSONAL` et son sélecteur d'espace ne montre que l'organisation ; Quand il clique « Créer mon espace personnel » / Alors l'espace est créé si toutes ses organisations ont `allow_personal_workspaces = true`, sinon `403 PERSONAL_WORKSPACE_FORBIDDEN` nommant l'organisation qui l'interdit ; un professeur inscrit seul (« Je suis professeur ») obtient toujours son espace personnel.

## 15.3 Invitations et étudiants (AC-INV)

- **AC-INV-01** Étant donné un professeur / Quand il invite `ahmed@example.com` avec le cours « Maths N1 » / Alors une `Invitation PENDING` (expire à +7 j) et un email contenant le lien unique sont créés ; l'étudiant apparaît « invitation en attente ».
- **AC-INV-02** Étant donné une invitation PENDING pour `ahmed@example.com` / Quand un utilisateur connecté sous `sarah@example.com` ouvre le lien / Alors la page affiche « Cette invitation est destinée à ahmed@… » avec l'option de se déconnecter ; l'acceptation est impossible avec le compte courant.
- **AC-INV-03** Étant donné une invitation PENDING pour une adresse ayant déjà un compte / Quand l'utilisateur ouvre le lien et se connecte / Alors il voit « Rejoindre l'espace de Mohamed ? », et après acceptation un `Membership STUDENT ACTIVE` et l'`Enrollment` à « Maths N1 » existent ; le professeur reçoit `INVITATION_ACCEPTED`.
- **AC-INV-04** Étant donné une invitation expirée / Quand le professeur clique « Renvoyer » / Alors un nouveau jeton remplace l'ancien (l'ancien lien renvoie « expiré »), `expires_at` est repoussé de 7 j, `resent_count` incrémenté, et un second renvoi dans les 10 min est refusé.
- **AC-INV-05** Étant donné une invitation PENDING / Quand le professeur la révoque / Alors le lien renvoie « invitation révoquée » et aucune acceptation n'est possible.
- **AC-INV-06** Étant donné une adresse déjà membre `ACTIVE` de l'espace / Quand le professeur l'invite / Alors l'API renvoie `409 ALREADY_MEMBER` sans créer d'invitation ni d'email.
- **AC-INV-07** Étant donné un CSV de 100 lignes dont 3 emails invalides et 2 doublons / Quand le professeur importe / Alors la prévisualisation signale les 5 lignes, l'import crée 95 invitations en job, et un rapport est téléchargeable.
- **AC-INV-08** Étant donné un code de groupe `requires_approval = true` avec `max_uses = 2` / Quand 3 étudiants l'utilisent / Alors les 2 premiers sont `PENDING_APPROVAL`, le 3e reçoit « code épuisé », et le professeur peut approuver/refuser chacun.
- **AC-INV-09** Étant donné un étudiant déclarant une date de naissance le rendant mineur / Quand il crée son compte / Alors il est `PENDING_GUARDIAN_CONSENT`, un email est envoyé au tuteur, et tout accès à un cours ou une session renvoie `403 GUARDIAN_CONSENT_REQUIRED`.
- **AC-INV-10** Étant donné le lien de consentement reçu par le tuteur / Quand il accorde le consentement / Alors un `Consent GUARDIAN_PARENTAL` (IP, horodatage, version) et un `GuardianLink ACTIVE` sont créés, l'étudiant passe `ACTIVE`, l'étudiant et le professeur sont notifiés.
- **AC-INV-11** Étant donné Ahmed (mineur) membre `ACTIVE` de l'espace de Mohamed et de l'Académie Nour avec deux consentements distincts / Quand le tuteur révoque le consentement pour l'espace de Mohamed / Alors l'adhésion à l'espace de Mohamed passe `SUSPENDED_CONSENT_REVOKED` en ≤ 60 s, Ahmed est déconnecté des salles de cet espace, ses participations futures y sont annulées, Mohamed (et l'admin le cas échéant) est notifié ; l'adhésion à l'Académie Nour reste `ACTIVE` ; les présences, la progression et les comptes rendus de l'espace de Mohamed restent consultables par Mohamed ; aucune donnée n'est purgée.
- **AC-INV-12** Étant donné une adhésion `PENDING_GUARDIAN_CONSENT` depuis 14 jours / Quand le job quotidien s'exécute / Alors elle passe `SUSPENDED_NO_CONSENT`, l'étudiant et le professeur sont notifiés, le professeur peut relancer (nouveau lien, 14 jours) ; aucune purge n'est planifiée, le compte de l'étudiant reste utilisable dans ses autres espaces.
- **AC-INV-13** Étant donné Ahmed (mineur) déjà consenti pour l'espace de Mohamed / Quand il accepte une invitation de l'Académie Nour / Alors une nouvelle adhésion `PENDING_GUARDIAN_CONSENT` est créée pour l'Académie, le tuteur reçoit un email nommant « Académie Nour », et le consentement existant pour Mohamed n'est ni réutilisé ni modifié ; après consentement, un second `GuardianLink` (unique par `(student, workspace)`) existe.

## 15.4 Cours, contenu, médias (AC-CRS / AC-MED)

- **AC-CRS-01** Étant donné un cours sans leçon `READY` / Quand le professeur clique « Publier » / Alors la publication est refusée avec la liste des prérequis manquants.
- **AC-CRS-02** Étant donné un cours `PUBLISHED` attribué à 3 étudiants / Quand le professeur le dépublie / Alors les 3 étudiants ne le voient plus (`/me/courses`) et toute lecture renvoie `403 COURSE_NOT_AVAILABLE` ; leur progression est conservée.
- **AC-CRS-03** Étant donné deux onglets éditant le même cours (version 7) / Quand le premier enregistre (→ version 8) puis le second enregistre avec `If-Match: "7"` / Alors le second reçoit `409 VERSION_CONFLICT` avec la version courante et l'UI propose « recharger » ou « écraser » (écraser = renvoyer avec `If-Match: "8"`).
- **AC-CRS-04** Étant donné un module avec 5 leçons / Quand le professeur réordonne par glisser-déposer / Alors les positions sont renumérotées 1..5 en une transaction, sans violation d'unicité (contrainte différée).
- **AC-CRS-05** Étant donné un cours avec une inscription `ACTIVE` / Quand le professeur tente de le supprimer / Alors la suppression est refusée et « Archiver » est proposé.
- **AC-MED-01** Étant donné un professeur uploadant une vidéo de 1,5 Go / Quand la connexion coupe à 40 % puis revient (même navigateur) / Alors l'upload reprend à ≥ 40 % sans réenvoyer le début, et l'asset reste `UPLOADING` entre-temps.
- **AC-MED-02** Étant donné un upload terminé / Quand le webhook `ready` du fournisseur arrive / Alors l'asset passe `READY` avec durée/miniature, l'éditeur reçoit `media.status_changed` en temps réel et la leçon devient publiable ; un webhook reçu deux fois n'a aucun effet supplémentaire.
- **AC-MED-03** Étant donné un asset `PROCESSING` depuis 6 h sans webhook / Quand le job de nettoyage passe / Alors l'asset est `FAILED` (raison `TIMEOUT`), le professeur est notifié et peut réessayer.
- **AC-MED-04** Étant donné un fichier `.pdf` dont la signature binaire est celle d'un exécutable / Quand `complete` est appelé / Alors l'asset est rejeté (`415 INVALID_FILE_SIGNATURE`) et le fichier supprimé du stockage.
- **AC-MED-05** Étant donné un étudiant inscrit / Quand il demande `playback` d'une vidéo / Alors il reçoit un jeton signé TTL 2 h lié à l'asset (l'émission est journalisée avec son `user_id`) ; un étudiant non inscrit reçoit `403` ; après 2 h le jeton est refusé par le fournisseur et le lecteur en redemande un silencieusement (refusé si l'inscription a été révoquée entre-temps). Le jeton est un **jeton porteur** (D-O8) : le test ne doit **pas** vérifier qu'un autre utilisateur ne peut pas l'utiliser ; il vérifie en revanche que le lecteur affiche le filigrane avec l'email de l'étudiant connecté (AC-MED-09).
- **AC-MED-09** Étant donné un étudiant lisant une vidéo ou un PDF / Quand le contenu est affiché / Alors un filigrane semi-transparent avec son email et l'heure est visible, change de position au moins toutes les 30 s, et n'est pas désactivable depuis l'interface (test E2E : élément présent et non masquable par les contrôles du lecteur).
- **AC-MED-06** Étant donné une leçon PDF avec `allow_download = false` / Quand l'étudiant appelle `download` / Alors `403 DOWNLOAD_NOT_ALLOWED` ; la visionneuse fonctionne via une URL inline TTL 5 min ; après 5 min, l'URL renvoie `403` et la visionneuse en redemande une silencieusement.
- **AC-MED-07** Étant donné un espace à 100 % de son quota / Quand le professeur demande une URL d'upload / Alors `402 QUOTA_EXCEEDED` avec l'usage courant.
- **AC-MED-08** Étant donné un média référencé par une leçon d'un cours `PUBLISHED` / Quand le professeur tente de le supprimer / Alors la suppression est refusée avec la liste des leçons.

## 15.5 Attribution, verrouillage, progression (AC-ENR / AC-PRG)

- **AC-ENR-01** Étant donné un cours `PUBLISHED` / Quand le professeur l'attribue à Ahmed / Alors `Enrollment ACTIVE`, notification `COURSE_ASSIGNED` (in-app + email), et le cours apparaît dans `/me/courses` d'Ahmed.
- **AC-ENR-02** Étant donné un cours `DRAFT` attribué à Ahmed / Quand le professeur publie / Alors Ahmed reçoit `COURSE_PUBLISHED` et accède au contenu ; avant publication il ne voyait pas le cours.
- **AC-ENR-03** Étant donné un module 2 avec `PREVIOUS_MODULE_COMPLETED` et un module 1 à 80 % / Quand Ahmed ouvre une leçon du module 2 / Alors `403 MODULE_LOCKED` avec `reason = PREVIOUS_MODULE_INCOMPLETE` et l'UI affiche « Terminez le module 1 (80 %) ».
- **AC-ENR-04 (accès révoqué pendant la lecture)** Étant donné Ahmed regardant une vidéo (jeton de lecture valide 2 h) / Quand le professeur retire le cours / Alors l'inscription est `REVOKED`, la prochaine sauvegarde de progression (≤ 10 s) renvoie `403 ENROLLMENT_REVOKED`, le lecteur s'arrête avec le message « Vous n'avez plus accès à ce cours », et toute nouvelle demande de `playback` est refusée ; le jeton VOD déjà émis n'est pas révoqué (jeton porteur, D-O8) et expire naturellement (≤ 2 h) — accepté. Si Ahmed était inscrit à deux sessions futures liées à ce cours, les deux participations sont annulées (`removal_reason = ENROLLMENT_REVOKED`) et Ahmed comme le professeur reçoivent `ENROLLMENT_REVOKED_SESSIONS_CANCELLED` ; une session future sans cours n'est pas touchée.
- **AC-ENR-05** Étant donné un cours réattribué à Ahmed après révocation / Quand il l'ouvre / Alors sa progression et ses positions de lecture sont intactes.
- **AC-PRG-01** Étant donné une vidéo de 600 s / Quand Ahmed regarde 0–300 s puis 250–560 s (segments fusionnés 0–560 = 560 s = 93 %) / Alors la leçon passe `COMPLETED` automatiquement ; s'il avait seulement avancé le curseur à 590 s sans lecture, `unique_watched_s` reste < 540 et la leçon reste `IN_PROGRESS`.
- **AC-PRG-02** Étant donné un cours de 10 leçons obligatoires + 2 optionnelles, Ahmed ayant terminé 7 obligatoires et 2 optionnelles / Quand la progression est calculée / Alors `progress_percent = 70`.
- **AC-PRG-03** Étant donné Ahmed à 100 % (`completed_at` renseigné) / Quand le professeur ajoute une 11e leçon obligatoire / Alors le job de recalcul passe Ahmed à 90 %, `completed_at` est conservé, l'UI affiche « 90 % — nouveau contenu ».
- **AC-PRG-04** Étant donné Ahmed quittant une vidéo à 06:40 / Quand il la rouvre sur un autre appareil / Alors le lecteur propose « Reprendre à 06:40 » (± 2 s).
- **AC-PRG-05** Étant donné une leçon PDF jamais ouverte / Quand Ahmed clique « Marquer comme terminé » sans l'avoir ouverte / Alors l'action est refusée (`409 LESSON_NOT_OPENED`) ; après ouverture, elle réussit.

## 15.6 Planification et calendrier (AC-SCH)

- **AC-SCH-01** Étant donné un professeur en `Africa/Tunis` / Quand il crée une session le 15/10/2026 à 15:00 (60 min) avec Ahmed / Alors `start_at = 2026-10-15T14:00:00Z`, `timezone = Africa/Tunis`, Ahmed (en `Europe/Paris`) la voit « 16:00 (Paris) · 15:00 Tunis », tous deux reçoivent `SESSION_SCHEDULED` avec un ICS, et 3 jobs de rappel sont planifiés.
- **AC-SCH-02 (double réservation)** Étant donné une session de 15:00 à 16:00 avec Sarah / Quand le professeur crée une session 15:30–16:15 avec Ahmed / Alors un avertissement de conflit (professeur) est affiché avec le détail ; s'il confirme, la session est créée. Quand il crée une session 15:00–16:00 strictement identique (double-clic) / Alors la seconde est refusée (`409 DUPLICATE_SESSION`) par la contrainte d'unicité partielle.
- **AC-SCH-03** Étant donné une session `SCHEDULED` version 3 / Quand le professeur la déplace de 15:00 à 17:00 / Alors `version = 4`, les 3 anciens jobs de rappel sont supprimés et 3 nouveaux planifiés, les participants reçoivent `SESSION_RESCHEDULED` et un ICS avec `SEQUENCE: 1` et le même `UID`.
- **AC-SCH-04** Étant donné une session dans 10 min / Quand le professeur l'annule / Alors `CANCELLED`, les participants sont notifiés immédiatement (in-app + email, ICS `METHOD:CANCEL`), le rappel « au début » n'est pas envoyé.
- **AC-SCH-05 (DST)** Étant donné une série hebdomadaire créée le 7/10/2026 à 15:00 `Europe/Paris` (UTC+2) / Quand on consulte l'occurrence du 4/11/2026 (après le passage à UTC+1) / Alors elle est à 15:00 Paris = `14:00Z` (et non `13:00Z`) ; un participant à Tunis (UTC+1 toute l'année) la voit passer de 14:00 à 15:00 heure locale, avec une mention « horaire modifié par le changement d'heure en France ».
- **AC-SCH-06** Étant donné une série de 12 occurrences dont la 3e a été détachée (déplacée) / Quand le professeur modifie « toutes les occurrences » (durée 45 → 60 min) / Alors les occurrences 1-2 et 4-12 non terminées passent à 60 min, la 3e reste inchangée, les `COMPLETED` ne bougent pas.
- **AC-SCH-07** Étant donné un étudiant abonné au flux ICS / Quand une session est créée, déplacée puis annulée / Alors le flux expose le `VEVENT` avec `SEQUENCE` croissante puis `STATUS:CANCELLED` ; la révocation du jeton rend l'URL `404`.
- **AC-SCH-08** Étant donné un professeur en `Africa/Casablanca` pendant la période du Ramadan (décalage temporaire) / Quand il crée une session à 10:00 locale / Alors l'heure UTC stockée correspond au décalage réel de la base tz du jour concerné (test avec date fixée).
- **AC-SCH-09** Étant donné une tentative de création à `start_at = now − 1 min` / Quand elle est soumise / Alors `422 START_IN_PAST` ; « Démarrer maintenant » crée une session `start_at = now` et ouvre directement la salle.
- **AC-SCH-10** Étant donné une session avec 12 participants / Quand le professeur en ajoute un 13e / Alors `422 MAX_PARTICIPANTS` (limite `max_participants`).

## 15.7 Salle en direct (AC-ROOM)

- **AC-ROOM-01** Étant donné une session à 15:00 / Quand Ahmed clique « Rejoindre » à 14:45 / Alors le bouton est désactivé avec « ouvre dans 5 min » ; à 14:50 il entre dans le lobby (« votre professeur n'a pas encore ouvert la salle ») ; le professeur voit « 1 étudiant attend ».
- **AC-ROOM-02** Étant donné un professeur ouvrant la salle à 14:50 / Quand il rejoint / Alors la session passe `LIVE` (`live_started_at`), `VideoRoom OPEN`, les étudiants en lobby sont admis automatiquement en ≤ 3 s, `SESSION_STARTED` est envoyé aux participants absents.
- **AC-ROOM-03** Étant donné un utilisateur non participant (ou d'un autre espace) / Quand il demande un jeton de salle / Alors `403 NOT_A_PARTICIPANT` (ou `404` hors espace) et aucun jeton n'est émis ; l'événement est audité.
- **AC-ROOM-04** Étant donné le pré-join / Quand la permission caméra est refusée par le navigateur / Alors l'utilisateur peut quand même rejoindre en audio seul, avec une aide « Autoriser la caméra » spécifique au navigateur.
- **AC-ROOM-05 (expiration du jeton en salle)** Étant donné Ahmed connecté depuis 12 min avec un jeton TTL 10 min / Quand sa connexion est stable / Alors il reste connecté sans interruption ; Quand sa connexion coupe 20 s / Alors le client obtient un nouveau jeton et se reconnecte automatiquement sans action ; deux intervalles bruts sont enregistrés (`left` puis `joined`), **affichés** comme un seul intervalle « 1 reconnexion » (coupure < 5 min), et les 20 s déconnectées ne sont **pas** comptées dans `presence_s` (D-P21).
- **AC-ROOM-06 (retrait)** Étant donné Ahmed dans la salle / Quand le professeur le retire / Alors Ahmed est déconnecté en ≤ 3 s avec « Vous avez été retiré de la session », `removed_at` est renseigné, toute nouvelle demande de jeton renvoie `403 REMOVED_FROM_SESSION`, et l'action est auditée.
- **AC-ROOM-07 (inscription révoquée pendant la session, D-P22)** Étant donné Ahmed connecté dans une salle liée au cours « Maths N1 » / Quand le professeur retire ce cours à Ahmed pendant la session / Alors Ahmed **reste** connecté jusqu'à ce qu'il quitte ; s'il quitte (ou perd la connexion) puis redemande un jeton, il reçoit `403 ENROLLMENT_REVOKED` ; ses participations aux sessions futures de « Maths N1 » sont annulées avec notification aux deux parties ; Quand le cours de la session est `null` / Alors la révocation d'une inscription quelconque n'a aucun effet sur cette session ; Quand c'est l'étudiant lui-même qui est retiré de l'espace (ou son consentement révoqué) / Alors il est déconnecté de la salle en ≤ 60 s et ses futures participations de l'espace sont annulées.
- **AC-ROOM-08** Étant donné une connexion avec > 25 % de perte de paquets pendant 30 s / Quand le client le détecte / Alors il bascule en audio seul avec une notification et un bouton « Réactiver la vidéo » ; le professeur voit l'icône réseau dégradé sur la tuile.
- **AC-ROOM-09** Étant donné le professeur qui perd sa connexion / Quand 3 étudiants restent / Alors la session reste `LIVE`, ils voient « Le professeur se reconnecte… » ; si tout le monde quitte, la session passe `COMPLETED (EMPTY_ROOM)` après 5 min ; le professeur peut « Reprendre » dans les 10 min, la présence est cumulée sur les deux périodes.
- **AC-ROOM-10 (dépassement, D-P5)** Étant donné une session 15:00–16:00 encore `LIVE` à 16:50 / Quand le job s'exécute / Alors le professeur reçoit `SESSION_ENDING_SOON` (« se termine dans 10 min ») avec « Prolonger de 30 min » ; sans action, à 17:00 la session est terminée (`TIMEOUT`) et tous déconnectés. Quand le professeur prolonge à 16:55 / Alors `auto_end_at = 17:30`, un nouvel avertissement est planifié à 17:20 ; une seconde prolongation donne 18:00 ; une troisième est refusée (`422 MAX_EXTENSIONS`) ; dans tous les cas la session est terminée au plus tard à 18:00 (`end_at + 120`). La présence utilise la fenêtre étendue (15:00–17:30 après une prolongation).
- **AC-ROOM-11** Étant donné une session `SCHEDULED` à `end_at` jamais ouverte, avec 2 étudiants passés par le lobby / Quand le job `no_show_check` s'exécute / Alors `NO_SHOW (TEACHER)`, notifications au professeur et à l'admin, aucune présence calculée.
- **AC-ROOM-12** Étant donné un message envoyé dans le chat de salle / Quand la session est terminée / Alors le message est consultable dans l'historique de la session (conversation `SESSION`, lecture seule) par les participants et le professeur.
- **AC-ROOM-13** Étant donné 13 participants (1 + 12) connectés avec vidéo en 4G simulée (2 Mbit/s descendant) / Quand la session dure 30 min / Alors aucun participant n'est déconnecté par le système, et le temps « clic → média » p95 reste < 8 s (test de charge en staging).
- **AC-ROOM-14** Étant donné le professeur / Quand il coupe le micro d'Ahmed / Alors le micro d'Ahmed est coupé en ≤ 1 s avec un message, Ahmed peut le réactiver ; « Couper tous les micros » coupe tous les étudiants mais pas le professeur.
- **AC-ROOM-15** Étant donné une session prévue à 15:00 dont la salle n'est pas ouverte à 15:05 / Quand le job `teacher_late_check` s'exécute / Alors le professeur reçoit `SESSION_TEACHER_LATE` (in-app + email) une seule fois, l'admin d'organisation est notifié in-app, et aucun rappel n'est envoyé si la salle a été ouverte entre-temps ou si la session est `CANCELLED`.

## 15.8 Présence (AC-ATT)

- **AC-ATT-01** Étant donné une session ouverte à 15:00 et terminée à 16:00 (D = 60 min), Ahmed entré à 15:02 et sorti à 16:00 / Quand la présence est calculée / Alors `PRESENT`, `presence_s = 3480`.
- **AC-ATT-02** Étant donné Sarah entrée à 15:14 et sortie à 16:00 / Alors `LATE` (entrée > 10 min, présence 77 % ≥ 75 %).
- **AC-ATT-03** Étant donné Yassine présent 15:03–15:20 puis 15:40–15:50 (27 min = 45 %) / Alors `PARTIAL` avec 2 intervalles affichés.
- **AC-ATT-04** Étant donné Lina passée par le lobby mais jamais admise (professeur absent, session NO_SHOW) / Alors `NOT_APPLICABLE` ; dans une session `COMPLETED` où elle n'est jamais entrée : `ABSENT`.
- **AC-ATT-05** Étant donné un professeur en retard ouvrant à 15:20 une session prévue à 15:00–16:00, Ahmed entré à 15:21 et resté jusqu'à 16:00 / Alors la fenêtre de référence est 15:20–16:00 (D = 40 min), `ref_start = 15:20`, Ahmed est `PRESENT` (39/40, pas `LATE`).
- **AC-ATT-08 (ouverture anticipée, D-P21)** Étant donné une session prévue 15:00–16:00, salle ouverte à 14:40, Ahmed entré à 15:00 pile et sorti à 16:00 / Alors la fenêtre de référence est 15:00–16:00, Ahmed est `PRESENT` à 100 % ; un étudiant présent de 14:40 à 15:30 a 30 min (50 %) → `PARTIAL`.
- **AC-ATT-09 (dépassement sans prolongation)** Étant donné une session 15:00–16:00 restée `LIVE` jusqu'à 16:40 sans prolongation, Sarah présente de 15:30 à 16:40 / Alors la fenêtre est 15:00–16:00, P = 30 min (50 %), Sarah est `PARTIAL` ; avec une prolongation de 30 min, la fenêtre est 15:00–16:30, P = 60/90 = 67 % → `PARTIAL` également, mais `presence_s = 3600`.
- **AC-ATT-10 (temps déconnecté)** Étant donné Yassine connecté 15:00–15:30, déconnecté 15:30–15:33, reconnecté 15:33–16:00 / Alors `presence_s = 3420` (57 min, 95 %) → `PRESENT`, affiché « 15:00–16:00, 1 reconnexion ».
- **AC-ATT-06** Étant donné un webhook `participant_left` perdu / Quand la réconciliation à 60 s constate qu'Ahmed n'est plus dans la salle / Alors un intervalle est clos à l'horodatage de la réconciliation (`source = RECONCILIATION`), précision ± 60 s acceptée.
- **AC-ATT-07** Étant donné une présence `ABSENT` / Quand le professeur la corrige en `PRESENT` avec motif / Alors `attendance_override` est stocké, l'audit enregistre avant/après, l'étudiant voit « Présent (corrigé par le professeur) », le taux de présence utilise la valeur corrigée.

## 15.9 Compte rendu (AC-RPT)

- **AC-RPT-01** Étant donné une session `COMPLETED` / Quand le professeur termine la session / Alors il est redirigé vers l'écran de compte rendu, un brouillon (`published_at = null`) est créé, auto-sauvegardé toutes les 5 s de modification.
- **AC-RPT-02** Étant donné un brouillon avec note privée / Quand le professeur publie / Alors les participants reçoivent `SESSION_REPORT_PUBLISHED`, voient le contenu, les devoirs et les recommandations (liens vers les leçons), mais jamais `private_notes` (test d'API : champ absent de la réponse étudiant et admin).
- **AC-RPT-03** Étant donné une session terminée depuis 24 h sans compte rendu publié / Quand le job passe / Alors `SESSION_REPORT_MISSING` est envoyé au professeur une seule fois.
- **AC-RPT-04** Étant donné un compte rendu individuel pour Ahmed dans une session de groupe / Quand Sarah consulte la session / Alors elle voit le compte rendu de session mais pas celui d'Ahmed.

## 15.10 Notifications et rappels (AC-NOT)

- **AC-NOT-01** Étant donné une session créée pour demain 15:00 / Quand les jobs s'exécutent / Alors Ahmed reçoit « demain à 15:00 (heure de Paris) » à J-1 ± 60 s, « dans 15 min » à 14:45 ± 60 s, « commence maintenant » à 15:00 ± 60 s, in-app et email dans sa langue (AR en RTL si `locale = ar`).
- **AC-NOT-02 (idempotence)** Étant donné une session déplacée 2 fois en 1 min / Quand les jobs des versions périmées s'exécutent / Alors ils constatent le changement de version et ne livrent rien ; seuls les rappels de la dernière version partent.
- **AC-NOT-03** Étant donné Ahmed ayant désactivé les emails de rappel / Quand un rappel est dû / Alors la livraison email est `SKIPPED` et l'in-app est livrée.
- **AC-NOT-04** Étant donné 5 messages reçus en 10 min sans lecture / Quand les notifications email sont dues / Alors un seul email « 5 nouveaux messages de Mohamed » est envoyé (digest) ; l'in-app est immédiate.
- **AC-NOT-05** Étant donné un email en rebond dur deux fois / Quand une nouvelle notification email est due / Alors elle est `SKIPPED (BOUNCED)` et le professeur voit un indicateur « email invalide » sur l'étudiant.
- **AC-NOT-06** Étant donné un utilisateur ayant 2 onglets ouverts / Quand il marque une notification lue dans l'un / Alors le badge se met à jour dans l'autre en ≤ 2 s.

## 15.11 Messagerie (AC-MSG)

- **AC-MSG-01** Étant donné Ahmed (étudiant de Mohamed) / Quand il ouvre « Messages » et choisit Mohamed / Alors une conversation `DIRECT` unique est créée ou retrouvée (deux clics simultanés ne créent pas deux conversations — clé `direct_key` unique).
- **AC-MSG-02** Étant donné Ahmed et Sarah, étudiants du même espace / Quand Ahmed tente de créer une conversation avec Sarah / Alors `403 PERMISSION_DENIED`.
- **AC-MSG-03** Étant donné un message envoyé / Quand Mohamed a la conversation ouverte / Alors il le reçoit en < 500 ms via WebSocket et `last_read_at` est mis à jour ; sinon une notification `NEW_MESSAGE` est créée après 2 min sans lecture.
- **AC-MSG-04** Étant donné un message de 4 001 caractères / Quand il est envoyé / Alors `422 MESSAGE_TOO_LONG`.
- **AC-MSG-05** Étant donné un message envoyé il y a 16 min / Quand l'auteur tente de le supprimer / Alors refus (`409 DELETE_WINDOW_EXPIRED`) ; à 14 min, il est remplacé par « message supprimé » chez les deux participants.
- **AC-MSG-06** Étant donné un étudiant retiré de l'espace / Quand il ouvre la conversation / Alors elle est en lecture seule (« vous ne faites plus partie de cet espace ») ; le professeur conserve l'historique.

## 15.12 Dashboards (AC-DASH)

- **AC-DASH-01** Étant donné 32 étudiants dont 24 avec un `ActivityEvent` qualifiant dans les 7 derniers jours / Quand le dashboard est chargé / Alors « Actifs 7 j : 24 (75 %) » ; un étudiant n'ayant envoyé qu'un message n'est pas compté.
- **AC-DASH-02** Étant donné un professeur en `Africa/Tunis` à 23:30 heure locale / Quand il charge « Sessions aujourd'hui » / Alors seules les sessions du jour civil de Tunis sont comptées (pas celles de demain 00:30 Tunis = aujourd'hui 23:30 UTC).
- **AC-DASH-03** Étant donné 10 sessions terminées, 1 NO_SHOW, 1 annulée 2 h avant, 1 annulée 3 jours avant / Alors « taux de réalisation = 10 / 12 = 83 % ».
- **AC-DASH-04** Étant donné le dashboard d'un espace de 5 000 étudiants / Quand il est chargé / Alors p95 < 300 ms (agrégats SQL + cache 60 s).

## 15.13 Conformité (AC-GDPR)

- **AC-GDPR-01** Étant donné Ahmed / Quand il demande l'export de ses données / Alors un job génère un ZIP (profil, inscriptions, progression, présences, comptes rendus le concernant, messages envoyés, consentements, journal de ses connexions) sous 24 h, lien signé valable 7 j, email de notification.
- **AC-GDPR-02** Étant donné un professeur indépendant avec 10 étudiants / Quand il supprime son compte / Alors l'avertissement liste les conséquences, son espace passe `DELETING`, les étudiants reçoivent une notification, et après 30 j l'espace est purgé (médias supprimés chez les fournisseurs, vérifiable par l'absence de l'asset).
- **AC-GDPR-03** Étant donné un compte en période de grâce / Quand l'utilisateur se reconnecte et annule / Alors le compte et l'espace sont restaurés intégralement.
- **AC-GDPR-04** Étant donné un `OWNER` d'organisation / Quand il tente de supprimer son compte / Alors refus tant que la propriété n'est pas transférée.
- **AC-GDPR-05** Étant donné toute action listée en §8.16.3 / Quand elle est exécutée / Alors une ligne `AuditLog` existe avec acteur, action, entité, avant/après, et aucune mise à jour/suppression n'est possible sur cette table avec le rôle applicatif (test de privilège).
- **AC-GDPR-06** Étant donné un utilisateur ayant accepté les CGU v1 / Quand une v2 est publiée / Alors une bannière bloquante demande l'acceptation à la connexion suivante ; un nouveau `Consent` versionné est créé.

## 15.14 Internationalisation (AC-I18N)

- **AC-I18N-01** Étant donné un utilisateur `locale = ar` / Quand il ouvre n'importe quel écran P0 / Alors `dir="rtl"`, aucune chaîne non traduite (clé brute) n'apparaît (test automatisé de couverture des clés), les icônes directionnelles sont inversées, les dates sont au format local avec chiffres 0-9.
- **AC-I18N-02** Étant donné un email de rappel pour un utilisateur `ar` / Alors le gabarit est en arabe, RTL, avec l'heure dans son fuseau.
- **AC-I18N-03** Étant donné un cours en arabe affiché à un utilisateur en interface FR / Alors les titres du cours sont rendus avec `dir="auto"` (direction par contenu).

## 15.15 Réservation (P1, AC-BKG)

- **AC-BKG-01** Étant donné un professeur disponible le mardi 14:00–18:00 (Tunis), tampon 10 min, une session existante 15:00–16:00 / Quand Léa (Paris) consulte les créneaux de 60 min / Alors elle voit 15:00–16:00 et 17:10–18:10 (Paris) = 14:00–15:00 et 16:10–17:10 (Tunis) ; 16:00–17:00 Tunis est exclu (tampon).
- **AC-BKG-02** Étant donné deux étudiants réservant le même créneau à la même seconde / Quand les deux requêtes arrivent / Alors une seule réussit, l'autre reçoit `409 SLOT_TAKEN`.
- **AC-BKG-03** Étant donné une réservation confirmée dans 20 h, délai d'annulation 24 h / Quand l'étudiant annule / Alors `LATE_CANCELLED`, la session est annulée, le professeur est notifié avec la mention « annulation tardive ».
- **AC-BKG-04** Étant donné `min_notice_hours = 12` / Quand un étudiant tente de réserver dans 6 h / Alors le créneau n'est pas proposé et l'API renvoie `422 NOTICE_TOO_SHORT`.

## 15.16 Garde-fous et vérification des professeurs (AC-SAFE, D-O6)

- **AC-SAFE-01** Étant donné un professeur inscrit avec email vérifié mais téléphone non vérifié / Quand il tente d'inviter un étudiant, de publier un cours ou d'ouvrir une salle / Alors `403 TEACHER_NOT_VERIFIED` avec la liste des étapes manquantes ; après OTP SMS valide (`phone_verified_at`) et acceptation du code de conduite (`Consent CODE_OF_CONDUCT`), les trois actions sont autorisées.
- **AC-SAFE-02** Étant donné Ahmed dans une salle / Quand il signale le professeur (catégorie `HARASSMENT`, description) / Alors un `AbuseReport OPEN` est créé avec un instantané du contexte (session, participants, 50 derniers messages du chat de salle), Ahmed reçoit un accusé, le super-admin (et les admins de l'organisation le cas échéant) reçoivent `ABUSE_REPORT_RECEIVED` ; le professeur n'est pas informé de l'identité du signalant.
- **AC-SAFE-03** Étant donné un message signalé / Quand son auteur tente de le supprimer dans la fenêtre de 15 min / Alors la suppression est refusée (`409 MESSAGE_UNDER_REVIEW`) tant que le signalement est `OPEN`/`IN_REVIEW`.
- **AC-SAFE-04** Étant donné un professeur avec 2 sessions `SCHEDULED` et 1 session `LIVE` / Quand le super-admin le suspend avec motif / Alors il est déconnecté en ≤ 15 s, la session `LIVE` est terminée (`TEACHER_ENDED`, acteur système), les 2 sessions futures sont `CANCELLED` avec `TEACHER_SUSPENDED` aux participants et admins, ses cours restent lisibles par les inscrits, son espace personnel est en lecture seule, l'action est auditée ; la réactivation restaure les accès mais pas les sessions annulées.
- **AC-SAFE-05** Étant donné un signalement de catégorie `MINOR_SAFETY` dans une organisation / Quand il est créé / Alors il est visible du super-admin même si l'organisation le traite, et un rappel est envoyé au super-admin s'il est encore `OPEN` après 24 h.
- **AC-SAFE-06** Étant donné le tuteur d'Ahmed ayant consenti pour l'espace de Mohamed / Quand il ouvre le lien « Sessions de Ahmed » de l'email de confirmation / Alors il voit, sans compte, la liste des sessions planifiées et passées d'Ahmed dans cet espace (titre, date, professeur, statut de présence), et rien d'un autre espace.

---

# 16. User stories

Les identifiants de la v1 sont conservés (US-P01…US-P11, US-S01…US-S10). Nouvelles séries : US-P12+ (professeur), US-S11+ (étudiant), US-A (admin d'organisation), US-G (tuteur), US-T (assistant), US-X (super-admin), US-ALL (transverses). Colonne AC = critères d'acceptation liés (§15).

## 16.1 Professeur

| ID | En tant que professeur, je veux… | afin de… | Prio | AC |
|---|---|---|---|---|
| US-P01 | créer un cours | proposer du contenu pédagogique à mes étudiants | P0 | AC-CRS-01, 03, 05 |
| US-P02 | organiser mon cours en modules et leçons | structurer mon enseignement | P0 | AC-CRS-04 |
| US-P03 | ajouter des vidéos (upload reprenable) | proposer des cours enregistrés même avec une connexion instable | P0 | AC-MED-01…03, 07, 08 |
| US-P04 | ajouter des PDF et choisir s'ils sont téléchargeables | fournir des documents en gardant le contrôle | P0 | AC-MED-04, 06 |
| US-P05 | inviter des étudiants par email, lien de groupe ou CSV | les intégrer rapidement à mon espace | P0 | AC-INV-01…08 |
| US-P06 | attribuer ou retirer un cours à un étudiant | contrôler son accès | P0 | AC-ENR-01, 02, 04, 05 |
| US-P07 | programmer une session (ponctuelle, récurrente ou immédiate) dans mon fuseau | organiser mes cours en direct | P0 | AC-SCH-01…10 |
| US-P08 | ouvrir la salle, admettre les étudiants et animer la session (micro, caméra, chat, contrôles) | donner un cours en direct fiable | P0 | AC-ROOM-01…15 |
| US-P09 | voir et corriger la présence de mes étudiants | savoir qui a participé et combien de temps | P0 | AC-ATT-01…07 |
| US-P10 | rédiger un compte rendu (visible) et une note privée après la session | garder une trace et informer l'étudiant | P0 | AC-RPT-01…04 |
| US-P11 | suivre la progression de mes étudiants | adapter mon enseignement | P0 | AC-PRG-01…05, AC-DASH-01 |
| US-P12 | ajouter des leçons texte (contenu riche) | compléter vidéos et PDF sans fichier | P0 | AC-CRS-01 |
| US-P13 | verrouiller un module jusqu'à la fin du précédent ou imposer l'ordre des leçons | guider la progression | P0 | AC-ENR-03 |
| US-P14 | être averti d'un conflit d'horaire | éviter les doubles réservations | P0 | AC-SCH-02 |
| US-P15 | recevoir une alerte si je n'ai pas ouvert la salle 5 min après l'heure | ne pas laisser mes étudiants attendre | P0 | AC-ROOM-15, AC-ROOM-11 |
| US-P16 | exporter mon calendrier (ICS) | voir mes sessions dans mon agenda habituel | P0 | AC-SCH-07 |
| US-P17 | consulter un dashboard avec étudiants actifs, présence et sessions du jour | piloter mon activité | P0 | AC-DASH-01…04 |
| US-P18 | consulter le journal d'audit de mon espace | savoir qui a fait quoi | P0 | AC-GDPR-05 |
| US-P19 | demander le consentement du tuteur d'un étudiant mineur et voir son statut | être en règle | P0 | AC-INV-09…12 |
| US-P20 | définir mes disponibilités et laisser les étudiants réserver | réduire les allers-retours de planification | P1 | AC-BKG-01…04 |
| US-P21 | partager mon écran | expliquer sur un support | P1 | — |
| US-P22 | enregistrer une session avec consentement | permettre la révision | P1 | — |
| US-P23 | créer un quiz et un devoir, noter et commenter | évaluer mes étudiants | P1 | — |
| US-P24 | ouvrir un canal de cours modéré avec pièces jointes et annonces | communiquer avec le groupe | P1 | — |
| US-P25 | recevoir une alerte « étudiant à risque » | intervenir tôt | P1 | — |
| US-P26 | dupliquer un cours | réutiliser ma structure pour une nouvelle classe | P1 | — |
| US-P27 | obtenir un brouillon de compte rendu généré depuis la transcription | gagner du temps après chaque session | P1 | — |
| US-P28 | exporter présences et progression en CSV/PDF | rendre compte aux parents ou à l'école | P1 | — |
| US-P29 | envoyer les rappels par WhatsApp | atteindre mes étudiants là où ils sont | P1 | — |
| US-P30 | vendre des cours, packs de sessions et abonnements | monétiser | P2 | — |
| US-P31 | générer un quiz depuis un PDF | créer des évaluations rapidement | P2 | — |
| US-P32 | délivrer des certificats | valoriser la complétion | P2 | — |

## 16.2 Étudiant

| ID | En tant qu'étudiant, je veux… | afin de… | Prio | AC |
|---|---|---|---|---|
| US-S01 | accéder à mes cours (tous professeurs confondus) | consulter mon programme | P0 | AC-ENR-01, 02 |
| US-S02 | regarder une vidéo avec qualité adaptative | apprendre même en 4G | P0 | AC-MED-05, AC-PRG-01 |
| US-S03 | consulter un PDF (et le télécharger si autorisé) | travailler mes cours | P0 | AC-MED-06, AC-PRG-05 |
| US-S04 | retrouver ma position dans une vidéo, sur tout appareil | reprendre mon apprentissage | P0 | AC-PRG-04 |
| US-S05 | voir ma progression par cours et module, et pourquoi un module est verrouillé | savoir où j'en suis | P0 | AC-PRG-02, AC-ENR-03 |
| US-S06 | voir mes prochaines sessions dans mon fuseau | connaître mon planning | P0 | AC-SCH-01, 05 |
| US-S07 | recevoir des rappels selon mes préférences | ne pas oublier | P0 | AC-NOT-01…03 |
| US-S08 | tester mon matériel puis rejoindre la session en un clic, et être reconnecté automatiquement | suivre mon cours sans stress technique | P0 | AC-ROOM-01, 04, 05, 08 |
| US-S09 | utiliser mon micro et ma caméra, ou passer en audio seul | interagir selon ma connexion | P0 | AC-ROOM-08 |
| US-S10 | consulter le compte rendu d'une session | connaître les points travaillés et les exercices | P0 | AC-RPT-02, 04 |
| US-S11 | accepter une invitation ou utiliser un code de groupe | rejoindre l'espace de mon professeur | P0 | AC-INV-02, 03, 08 |
| US-S12 | indiquer mon tuteur si je suis mineur et suivre l'état du consentement | pouvoir utiliser la plateforme | P0 | AC-INV-09, 10 |
| US-S13 | écrire à mon professeur | poser mes questions | P0 | AC-MSG-01…06 |
| US-S14 | m'abonner à mon calendrier (ICS) | avoir mes sessions sur mon téléphone | P0 | AC-SCH-07 |
| US-S15 | utiliser l'application en arabe (RTL), français ou anglais | être à l'aise | P0 | AC-I18N-01…03 |
| US-S16 | exporter mes données et supprimer mon compte | exercer mes droits | P0 | AC-GDPR-01, 03 |
| US-S17 | réserver un créneau dans les disponibilités de mon professeur, et l'annuler dans les règles | organiser mes cours moi-même | P1 | AC-BKG-01…04 |
| US-S18 | répondre à un quiz et déposer un devoir, voir ma note et le feedback | être évalué | P1 | — |
| US-S19 | revoir l'enregistrement d'une session | réviser | P1 | — |
| US-S20 | recevoir des notifications push et WhatsApp | ne rien rater | P1 | — |
| US-S21 | poser une question à l'assistant sur le contenu de mon cours | obtenir une aide immédiate | P2 | — |

## 16.3 Administrateur d'organisation

| ID | En tant qu'admin d'organisation, je veux… | afin de… | Prio | AC |
|---|---|---|---|---|
| US-A01 | créer mon organisation et inviter des professeurs et admins | structurer mon école sur la plateforme | P0 | AC-WS-03, 04 |
| US-A02 | affecter des étudiants à des professeurs | que chaque professeur ne voie que ses étudiants | P0 | AC-WS-02 |
| US-A03 | voir tous les cours, sessions, présences et comptes rendus (hors notes privées) | superviser | P0 | AC-RPT-02 |
| US-A04 | réaffecter un cours à un autre professeur | gérer les départs | P0 | AC-WS-05 |
| US-A05 | configurer les règles de présence et fenêtres de salle de l'organisation | appliquer notre règlement | P0 | AC-ATT-01…03 |
| US-A06 | être protégé par la 2FA obligatoire | sécuriser les données des élèves | P0 | AC-AUTH-05 |
| US-A07 | consulter le journal d'audit | tracer les actions | P0 | AC-GDPR-05 |
| US-A08 | voir un dashboard d'organisation et exporter présences/progression | rendre compte | P1 | — |
| US-A09 | imposer des politiques (2FA professeurs, filigrane, rétention) et un branding | adapter la plateforme à mon école | P1 | — |
| US-A10 | créer des rôles Assistant | déléguer | P1 | — |
| US-A11 | gérer la facturation de l'organisation | payer centralement | P2 | — |
| US-A12 | recevoir et traiter les signalements d'abus de mon organisation (hors catégorie sécurité des mineurs, toujours partagée avec la plateforme) | protéger mes élèves et mes professeurs | P0 | AC-SAFE-02, 05 |
| US-A13 | autoriser ou interdire à mes professeurs d'avoir un espace personnel | garder le contrôle de l'offre de mon école | P0 | AC-WS-08 |

## 16.4 Tuteur / parent

| ID | En tant que tuteur, je veux… | afin de… | Prio | AC |
|---|---|---|---|---|
| US-G01 | donner (ou refuser, ou révoquer) mon consentement pour mon enfant mineur, **espace par espace**, sans créer de compte, et voir la liste de ses sessions par un lien sécurisé | être en règle sans effort et savoir avec qui mon enfant a cours | P0 | AC-INV-10, 11, 13, AC-SAFE-06 |
| US-G02 | créer un compte tuteur et voir la progression, les sessions, la présence et les comptes rendus de mes enfants | suivre leur scolarité | P1 | — |
| US-G03 | recevoir une notification en cas d'absence | réagir | P1 | — |
| US-G04 | écrire au professeur | échanger | P1 | — |
| US-G05 | exporter les données de mon enfant | exercer ses droits | P1 | — |

## 16.5 Assistant pédagogique (P1)

| ID | Story | Prio |
|---|---|---|
| US-T01 | co-animer une session (contrôles de salle) pour les professeurs auxquels je suis rattaché | P1 |
| US-T02 | corriger les devoirs et quiz à correction manuelle | P1 |
| US-T03 | répondre aux messages des étudiants de mes professeurs | P1 |
| US-T04 | préparer un brouillon de compte rendu | P1 |

## 16.6 Super-admin

| ID | Story | Prio | AC |
|---|---|---|---|
| US-X01 | lister, suspendre et réactiver des espaces avec motif | P0 | AC-WS-06 |
| US-X02 | voir l'état des files, webhooks et de la santé de la plateforme | P0 | — |
| US-X03 | ajuster les quotas d'un espace | P0 | AC-MED-07 |
| US-X04 | activer des feature flags par espace | P1 | — |
| US-X05 | ouvrir une vue support en lecture seule, tracée et notifiée au propriétaire | P1 | — |
| US-X06 | traiter les signalements d'abus et suspendre un professeur avec motif | P0 | AC-SAFE-02, 04, 05 |

## 16.7 Transverses

| ID | Story | Prio | AC |
|---|---|---|---|
| US-ALL01 | En tant qu'utilisateur, je veux gérer mes appareils connectés et activer la 2FA | P0 | AC-AUTH-04, 05, 07 |
| US-ALL02 | En tant qu'utilisateur, je veux choisir ma langue et mon fuseau, et être prévenu si mon fuseau détecté diffère | P0 | AC-SCH-01, AC-I18N-01 |
| US-ALL03 | En tant qu'utilisateur, je veux régler mes notifications par type et canal | P0 | AC-NOT-03 |
| US-ALL04 | En tant qu'utilisateur, je veux installer l'application (PWA) et voir mes sessions à venir hors ligne | P0 | — |
| US-ALL05 | En tant qu'utilisateur, je veux signaler un abus (participant, message, profil, cours) et être informé du traitement | P0 | AC-SAFE-02, 03 |
| US-ALL06 | En tant que professeur, je veux vérifier mon téléphone et accepter le code de conduite pour activer mon espace, puis (V2) faire vérifier mon identité et mes diplômes pour obtenir un badge | P0 / P1 | AC-SAFE-01 |

---

# 17. Roadmap

| Phase | Objectif | Périmètre | Critères de sortie |
|---|---|---|---|
| **0 — Fondations** | Un monorepo déployable en staging avec auth et isolation tenant. | Sous-projets 0 et 1 (§18) | CI verte ; déploiement staging automatique ; un professeur peut créer son compte et son espace ; tests d'isolation tenant passent ; registre des traitements v0 rédigé. |
| **1 — MVP « cours + étudiants »** | Un professeur publie un cours et ses étudiants (y compris mineurs) y accèdent et progressent. | Sous-projets 2, 3, 4 | AC-INV, AC-CRS, AC-MED, AC-ENR, AC-PRG verts ; upload reprenable vérifié en 4G simulée ; RTL validé sur ces écrans. |
| **2 — MVP « direct »** | Des sessions planifiées, rappelées, réalisées en direct avec présence automatique. | Sous-projets 5, 6, 7 | AC-SCH, AC-ROOM, AC-ATT, AC-NOT verts ; test de charge 1+12 en 4G simulée ; 20 sessions pilotes réelles sans incident bloquant ; SLO « salle joignable » mesuré. |
| **3 — MVP « suivi & communication »** | Comptes rendus, messagerie, dashboards, conformité complète. **Lancement MVP.** | Sous-projets 8, 9, 10, 11 | AC-MSG, AC-RPT, AC-DASH, AC-GDPR, AC-I18N verts ; pentest léger ; politique de confidentialité FR/AR/EN publiée ; déclarations INPDP/CNDP/ANPDP déposées ; 10 professeurs pilotes actifs 4 semaines ; KPIs §23 instrumentés. |
| **4 — V2 « organisations & autonomie »** | Vendre aux écoles ; réduire la charge du professeur. | Vérification d'identité et de diplômes des professeurs (badge « vérifié », D-O6), réservation (5b), rôle Assistant & politiques d'org, dashboard org + exports, canaux de cours & pièces jointes, partage d'écran & enregistrement & mode classe, web push + WhatsApp, quiz & devoirs, drip par date, estampillage serveur des PDF téléchargés, duplication, alertes à risque, portail tuteur, transcription + brouillon IA | 3 organisations payantes pilotes ; SLO 99,9 % ; taux de compte rendu ≥ 80 % avec brouillon IA ; NPS professeurs ≥ 40. |
| **5 — V3 « monétisation & différenciation »** | Revenus pour les professeurs et la plateforme. | Paiements (Stripe + Konnect/Flouci/CMI), packs & abonnements, certificats, rubriques, génération de quiz IA, assistant Q/R, tableau blanc, synchro Google/Outlook, SSO, application native | Première transaction locale (TND/MAD) ; churn mensuel professeurs < 5 %. |

---

# 18. Plan de découpage pour l'implémentation

Chaque sous-projet donnera lieu à **un plan d'implémentation distinct** (`docs/superpowers/plans/`). Ordre = ordre de construction ; « Dépend de » liste les sous-projets requis ; la définition de « terminé » (DoD) inclut toujours : tests automatisés des AC listés, traductions FR/AR/EN, RTL vérifié, audit + analytics émis, runbook à jour.

| # | Sous-projet | Contenu | Dépend de | Definition of Done |
|---|---|---|---|---|
| **0** | **Monorepo & infra** | pnpm + Turborepo ; apps web/api/worker ; packages db/contracts/providers/ui/i18n/config ; docker-compose dev (Postgres, Redis, MinIO, LiveKit dev) ; CI (lint, typecheck, test, build, migrate --dry-run) ; déploiement staging ; logs/metrics/traces de base ; health checks ; gestion des secrets ; squelette i18n (3 locales, RTL) et design system minimal. | — | `pnpm dev` lance tout en local ; CI verte ; staging accessible ; page « hello » en FR/AR/EN avec RTL ; `/health` sur les 3 apps ; schéma Prisma vide migré. |
| **1** | **Auth, tenancy & RBAC** | `User`, `UserSession`, `Workspace`, `Membership`, `TeacherStudentAssignment`, `Consent (TERMS/PRIVACY/CODE_OF_CONDUCT)`, `AuditLog`, `AbuseReport` ; inscription/connexion/vérification email + téléphone (OTP SMS)/reset/2FA/appareils ; garde `TEACHER_NOT_VERIFIED` ; signalement d'abus (API + file de traitement) ; suspension d'un utilisateur par le super-admin ; `allow_personal_workspaces` ; création d'espace personnel et d'organisation ; garde de permissions (matrice §7) ; extension Prisma tenant + RLS ; console super-admin minimale (liste/suspension/quotas) ; préférences langue/fuseau. | 0 | AC-AUTH-01…07, AC-WS-01…08, AC-GDPR-05 (audit), AC-GDPR-06, AC-SAFE-01, 03, 04, 05 ; test d'isolation générique exécuté sur chaque route tenant. |
| **2** | **Étudiants & invitations** | `Invitation`, `InviteLink`, `GuardianLink`, consentement parental (page publique), import CSV (job), liste/profil étudiant (squelette, enrichi ensuite), retrait, notifications d'invitation (email minimal — sous-projet 7 généralise). | 1 | AC-INV-01…13, AC-SAFE-06 ; emails FR/AR/EN nommant l'espace ; job d'expiration des consentements (par espace, sans purge). |
| **3** | **Cours, contenu & médias** | `Course`, `Module`, `Lesson` (VIDEO/PDF/TEXT), `MediaAsset`, `Enrollment` ; éditeur de cours ; upload reprenable (tus + multipart S3) ; `VideoProvider` (Cloudflare Stream) + `StorageProvider` ; webhooks ; lecture signée (jetons porteurs 2 h, D-O8) ; filigrane visible (lecteur vidéo et visionneuse PDF) ; visionneuse PDF ; verrouillage (NONE / PREVIOUS_MODULE_COMPLETED / séquentiel) ; attribution ; quotas ; publication/archivage/suppression (DRAFT/ARCHIVED seulement) ; verrou optimiste. | 1 | AC-CRS-01…05, AC-MED-01…09, AC-ENR-01…03, 05 ; test de reprise d'upload ; test d'idempotence des webhooks. |
| **4** | **Progression & activité** | `LessonProgress` (segments uniques), `ActivityEvent`, calcul et recalcul de progression (job), complétion manuelle, « reprendre à », vue cours étudiant avec verrous, profil pédagogique enrichi, révocation en cours de lecture. | 3 | AC-PRG-01…05, AC-ENR-04 ; test de propriété : la progression ne dépasse jamais 100 et ne compte pas les leçons optionnelles. |
| **5** | **Planification & calendrier** | `Session`, `RecurrenceRule`, `SessionParticipant` (invitation), conflits, modification/annulation (scopes de série), fuseaux/DST, vues calendrier, ICS (flux + pièces jointes), `CalendarFeedToken`, jobs `series.extend_horizon`, `no_show_check` (état seulement). | 2, 3 | AC-SCH-01…10 (hors notifications, vérifiées en 7) ; tests DST (Paris, Casablanca Ramadan) ; test de double-clic. |
| **6** | **Salle en direct & présence** | `VideoRoom`, `AttendanceInterval`, `LiveProvider` (LiveKit), jetons, pré-join, lobby, salle (packages/ui), contrôles hôte, reconnexion, repli audio, webhooks + réconciliation, machine d'état session (open/end/resume/extend/empty/hard cap), calcul de présence, correction manuelle, chat de salle (persisté via sous-projet 8 ; à ce stade conversation `SESSION` minimale). | 5 | AC-ROOM-01…15, AC-ATT-01…10, AC-SAFE-02 (signalement en salle) ; test de charge 1+12 ; test E2E avec clients LiveKit simulés (jointure, retrait, reconnexion). |
| **7** | **Notifications & rappels** | `Notification`, `NotificationDelivery`, `NotificationPreference`, `EmailProvider`, gabarits FR/AR/EN, centre in-app + WebSocket, rappels idempotents (BullMQ), digest messages, rebonds, notifications de tout le catalogue §8.11.1 P0 (remplace les emails minimaux des sous-projets 2/5). | 5, 6 | AC-NOT-01…06 ; précision des rappels ± 60 s mesurée en staging ; job de réconciliation des jobs manquants. |
| **8** | **Messagerie** | `Conversation` (DIRECT, SESSION), `ConversationParticipant`, `Message`, gateway WebSocket `/chat`, non lus, suppression 15 min, lecture seule après retrait/fin de session. | 1, 7 | AC-MSG-01…06, AC-ROOM-12. |
| **9** | **Comptes rendus** | `SessionReport` (SESSION/PARTICIPANT), brouillon auto, publication, recommandations de leçons, note privée, rappel 24 h, écran post-session (programmer la suite pré-rempli). | 6, 7 | AC-RPT-01…04. |
| **10** | **Dashboards & analytics** | Dashboard professeur (KPIs §8.14.1, requêtes SQL + cache), dashboard étudiant, activité récente, événements produit `/analytics/events`, tableau super-admin de santé. | 4, 6, 9 | AC-DASH-01…04 ; KPIs §23 calculables. |
| **11** | **Conformité & lancement MVP** | Export de données (job + ZIP), suppression de compte/espace (grâce 30 j + purge chez les fournisseurs), page consentements, bannière nouvelle version CGU, rétention (jobs), PWA (installable, hors-ligne minimal), revue sécurité ASVS L2, pentest, documentation légale, runbooks, page de statut. | tous | AC-GDPR-01…04 ; checklist ASVS L2 ; restauration de sauvegarde testée ; critères de sortie phase 3. |
| **V2-a** | Réservation étudiant | `AvailabilityRule/Override`, `BookingPolicy`, `Booking`, créneaux, approbation, annulations, notifications `BOOKING_*`. | 5, 7 | AC-BKG-01…04. |
| **V2-b** | Organisations avancées | `ASSISTANT`, `CourseTeacher`, politiques d'espace, branding, dashboard org, exports CSV/PDF, assistant de départ d'un professeur, portail tuteur (compte `GUARDIAN`, vues lecture, messages). | 10, 11 | US-A08…A10, US-G02…G05. |
| **V2-c** | Salle avancée | Partage d'écran, lever la main, réactions, enregistrement (egress + consentement `RECORDING` + `MediaAsset RECORDING` + lecture), mode classe 1+40, option « entrer avant le professeur ». | 6 | US-P21, P22. |
| **V2-d** | Canaux & pièces jointes | `COURSE`/`GROUP`, `Attachment`, modération, annonces, accusés de lecture, édition, signalement. | 8 | US-P24. |
| **V2-e** | Push & WhatsApp | `PushSubscription`, service worker push, `MessagingProvider` WhatsApp Cloud + SMS, consentement `WHATSAPP`, heures calmes, digest quotidien. | 7 | US-S20, P29. |
| **V2-f** | Évaluations | Quiz, devoirs, leçons QUIZ/ASSIGNMENT, notation, feedback, notifications. | 3, 4, 7 | US-P23, S18. |
| **V2-g** | Contenu avancé | Leçons LINK/EMBED, drip AFTER_DATE / DAYS_AFTER_ENROLLMENT / MANUAL, estampillage serveur des PDF téléchargés (le filigrane visible est P0, D-O8), duplication de cours, scan antivirus. | 3 | US-P26. |
| **V2-h** | Alertes & IA v1 | Règle « étudiant à risque », `SttProvider`, `LlmProvider` (Claude), transcription + résumé + brouillon de compte rendu, consentement `AI_PROCESSING`, quotas IA, `AiJob`. | V2-c, 9 | US-P25, P27. |
| **V3-a** | Paiements | `PaymentProvider` (Stripe, Konnect, Flouci, CMI), produits/prix/commandes/abonnements/entitlements, crédits de sessions, facturation plateforme. | V2-a | US-P30, A11. |
| **V3-b** | Différenciation | Certificats, rubriques, génération de quiz IA, assistant Q/R (RAG), tableau blanc, sous-titres, synchro Google/Outlook, SSO, application native. | V2-* | US-P31, P32, S21. |

Parallélisation possible : après le sous-projet 1, les sous-projets 2 et 3 sont indépendants ; 5 peut démarrer dès que 2 est fini (participants) même si 3 n'est pas terminé (le lien cours est optionnel) ; 8 peut avancer en parallèle de 6.

---

# 19. Risques et mitigations

| # | Risque | Probabilité / impact | Mitigation |
|---|---|---|---|
| R1 | Qualité du direct insuffisante sur les réseaux maghrébins (perte de paquets, upload faible) | Élevée / critique | Simulcast + adaptation, repli audio automatique, SFU en UE-Paris, test de charge en conditions dégradées dès le sous-projet 6, limite 1+12, métriques `time_to_media` et taux de succès surveillés ; plan B : SFU plus proche (région additionnelle) si latence > 300 ms. |
| R2 | Fuite inter-tenant | Faible / critique | Double barrière (extension Prisma + RLS), tests d'isolation systématiques, revue de code obligatoire sur les requêtes `crossTenant`. |
| R3 | Non-conformité mineurs / transferts internationaux | Moyenne / élevé | Consentement parental bloquant au MVP, hébergement UE, déclarations INPDP/CNDP/ANPDP comme critères de sortie, DPA avec tous les fournisseurs, DPO ou référent nommé (question §20). |
| R4 | Rappels non livrés ou en double (bug critique pour la confiance) | Moyenne / élevé | Jobs idempotents versionnés, revérification à l'exécution, réconciliation quotidienne, alerte sur retard > 2 min, tests AC-NOT-02. |
| R5 | Coûts VOD/stockage non maîtrisés | Moyenne / moyen | Quotas par espace, tarification Stream prévisible, suppression effective des médias purgés, tableau de bord des coûts par espace (super-admin). |
| R6 | Fuite de contenu (téléchargement ou partage de jetons de lecture) | Élevée / moyen | Jetons porteurs signés 2 h, pas de téléchargement vidéo, filigrane visible dès le MVP, limitation du nombre de jetons par utilisateur, CGU. **Décision propriétaire D-O8 : pas de DRM ni de proxy lié à l'utilisateur ; risque résiduel accepté.** |
| R7 | Complexité des fuseaux/DST (Casablanca, Ramadan) | Moyenne / moyen | Base tz système à jour, tests de dates fixées, affichage systématique du fuseau, expansion des séries dans le fuseau de la série. |
| R8 | Adoption : professeurs peu technophiles | Moyenne / élevé | Checklist d'onboarding, parcours < 15 min, sessions pilotes accompagnées, support WhatsApp humain au lancement. |
| R9 | Dépendance à LiveKit Cloud / Cloudflare | Faible / moyen | Interfaces `LiveProvider`/`VideoProvider`, LiveKit auto-hébergeable, Mux en alternative documentée. |
| R10 | Dérive du périmètre MVP | Élevée / élevé | Priorités P0/P1/P2 figées dans ce document ; toute remontée en P0 passe par une décision du propriétaire et une mise à jour de §4. |
| R11 | Webhooks perdus (LiveKit, VOD) faussant présence/états | Moyenne / moyen | Table `WebhookEvent`, réconciliation périodique, timeouts (`PROCESSING` 6 h). |
| R12 | Accessibilité/RTL insuffisante découverte tard | Moyenne / moyen | Design system RTL-ready dès le sous-projet 0, recette AR par écran, tests automatisés de direction. |

---

# 20. Questions ouvertes pour le product owner

Seules les questions que le planificateur ne peut pas trancher seul. Chacune a une **hypothèse par défaut** retenue dans ce document ; l'implémentation peut démarrer avec elle.

| # | Question | Hypothèse par défaut |
|---|---|---|
| Q1 | Nom du produit, domaine et identité visuelle (nécessaires pour les emails, la PWA et les ICS). | Nom de code « Plateforme cours » ; variables de marque centralisées. |
| Q2 | Modèle économique de la plateforme elle-même au MVP : gratuit pour tous les professeurs pilotes ? Jusqu'à quand ? Quotas gratuits ? | Gratuit pendant le MVP, quotas D-P15. |
| Q3 | Faut-il une entité juridique / un hébergement en Tunisie à terme (certains établissements publics l'exigent) ? Qui dépose les déclarations INPDP/CNDP/ANPDP et qui est le DPO/référent ? | Hébergement UE ; déclarations par le propriétaire avec appui juridique. |
| Q4 | Algérie : quelle passerelle de paiement viser en V3 (SATIM/CIB, Edahabia) et accepte-t-on le paiement hors plateforme (virement/espèces) avec validation manuelle ? | V3 : Stripe + Konnect + Flouci + CMI ; Algérie à qualifier. |
| Q5 | Les étudiants majeurs peuvent-ils s'inscrire seuls (sans invitation) pour découvrir un professeur via un lien public ? | Non (anti-objectif marketplace) ; les codes de groupe couvrent ce besoin. |
| Q6 | Confirmer D-P10 : la réservation en libre-service reste-t-elle en V2 ? (Léa, persona FLE, en a besoin tôt.) | V2. |
| Q7 | Confirmer D-P2 (1+12) et le besoin réel du mode classe 1+40 en V2 pour les organisations cibles. | 1+12 MVP, 1+40 V2. |
| Q8 | Faut-il un canal de support intégré (chat avec l'équipe plateforme) au MVP, ou un support externe (WhatsApp/email) suffit-il ? | Externe. |
| Q9 | Les enregistrements de sessions (V2) sont-ils partagés par défaut avec les étudiants, ou sur décision du professeur par session ? | Décision du professeur par session, défaut « non partagé ». |

---

# 21. Glossaire FR/EN

Les noms anglais sont ceux utilisés dans le code, la base de données et l'API ; les noms français sont ceux de l'interface.

| Français (UI) | Anglais (code) | Définition |
|---|---|---|
| Espace | `Workspace` | Tenant : espace personnel d'un professeur ou organisation. |
| Organisation | `Workspace(type=ORGANIZATION)` | École, académie, centre de formation. |
| Membre / adhésion | `Membership` | Lien utilisateur ↔ espace avec un rôle. |
| Propriétaire / Admin / Professeur / Assistant / Étudiant / Tuteur | `OWNER / ADMIN / TEACHER / ASSISTANT / STUDENT / GUARDIAN` | Rôles d'espace. |
| Super-administrateur | `SUPER_ADMIN` | Rôle plateforme. |
| Affectation (professeur–étudiant) | `TeacherStudentAssignment` | Visibilité d'un étudiant pour un professeur dans une organisation. |
| Invitation / lien de groupe / code | `Invitation / InviteLink / code` | Mécanismes d'entrée dans un espace. |
| Tuteur, consentement parental | `GuardianLink`, `Consent(GUARDIAN_PARENTAL)` | Lien et consentement pour un mineur, **par espace** (D-O5). |
| Signalement d'abus | `AbuseReport` | Signalement d'un participant, message, profil ou cours (D-O6). |
| Code de conduite | `Consent(CODE_OF_CONDUCT)` | Engagement accepté par les professeurs. |
| Suspension (d'un professeur) | `User.status = SUSPENDED` | Sanction prononcée par le super-admin. |
| Fin automatique, prolongation | `auto_end_at`, `extension_count` | Dépassement de session (D-P5). |
| Fenêtre de référence (présence) | `W` | Recouvrement fenêtre planifiée / fenêtre live (D-P21). |
| Cours / module / leçon | `Course / Module / Lesson` | Structure pédagogique. |
| Média, fichier vidéo/PDF | `MediaAsset` | Fichier uploadé, avec statut de traitement. |
| Attribution (d'un cours) / inscription | `Enrollment` | Accès d'un étudiant à un cours. |
| Verrouillage, règle de déverrouillage | `unlock_rule`, `ModuleUnlock` | Conditions d'accès à un module. |
| Progression | `LessonProgress`, `Enrollment.progress_percent` | Avancement. |
| Activité | `ActivityEvent` | Événement d'apprentissage. |
| Session (vidéo, en direct) | `Session` | Rendez-vous pédagogique en direct. |
| Série / récurrence | `RecurrenceRule`, `series_id` | Sessions répétées. |
| Participant | `SessionParticipant` | Étudiant (ou co-animateur) invité à une session. |
| Salle (vidéo) | `VideoRoom` | Salle LiveKit d'une session. |
| Salle d'attente, lobby | `lobby` | Attente avant ouverture par le professeur. |
| Pré-join, test matériel | `pre-join` | Écran de vérification caméra/micro. |
| Présence (présent / en retard / partiel / absent) | `AttendanceStatus (PRESENT / LATE / PARTIAL / ABSENT)` | Résultat du calcul de présence. |
| Intervalle de présence | `AttendanceInterval` | Période connectée à la salle. |
| Absence du professeur (session non tenue) | `NO_SHOW` | Session jamais ouverte. |
| Compte rendu | `SessionReport` | Bilan de session visible par l'étudiant. |
| Note privée | `SessionReport.private_notes` | Visible du professeur seul. |
| Devoirs (à faire) | `homework` | Travail demandé dans le compte rendu. |
| Disponibilité / réservation / politique de réservation | `AvailabilityRule / Booking / BookingPolicy` | Libre-service (V2). |
| Annulation tardive | `LATE_CANCELLED` | Annulation après le délai. |
| Rappel | `SESSION_REMINDER` | Notification avant session. |
| Notification / préférence / livraison | `Notification / NotificationPreference / NotificationDelivery` | Système de notifications. |
| Conversation / message / pièce jointe | `Conversation / Message / Attachment` | Messagerie. |
| Canal de cours | `Conversation(type=COURSE)` | Discussion de groupe d'un cours (V2). |
| Quiz / question / tentative | `Quiz / Question / QuizAttempt` | Évaluation automatique (V2). |
| Devoir / dépôt / note | `Assignment / Submission / grade` | Évaluation manuelle (V2). |
| Grille d'évaluation | `Rubric` | V3. |
| Certificat | `Certificate` | V3. |
| Journal d'audit | `AuditLog` | Traçabilité. |
| Consentement | `Consent` | Accord versionné. |
| Export de données / suppression de compte | `DataExportRequest / AccountDeletionRequest` | Droits RGPD. |
| Fuseau horaire | `timezone` (IANA) | Ex. `Africa/Tunis`. |
| Fenêtre d'accès | `join window` | Période où « Rejoindre » est actif. |
| Délai de grâce (salle vide) | `empty_room_grace_min` | Avant fin automatique. |
| Dépassement | `overrun` | Session au-delà de `end_at`. |
| Repli audio | `audio-only fallback` | Mode dégradé. |
| Brouillon / publié / archivé | `DRAFT / PUBLISHED / ARCHIVED` | Statuts de cours. |
| Filigrane | `watermark` | Surcouche d'identification. |
| Quota de stockage | `storage_quota_bytes` | Limite par espace. |

---

# 22. Ce qui est laissé au builder

Décidé ici : *quoi*, *pourquoi*, les règles, les limites, les contrats. Laissé au builder (à documenter dans chaque plan d'implémentation) :

- Détail de l'arborescence du monorepo, conventions de nommage internes, choix des bibliothèques UI (Tailwind + Radix/shadcn ou autre), de formulaires, de dates (`luxon`, `date-fns` + tz, `temporal` polyfill), de l'éditeur de texte riche (Tiptap recommandé, non imposé), de la visionneuse PDF (PDF.js), du client LiveKit (`livekit-client` + composants `@livekit/components-react`), du lecteur HLS.
- Design visuel (maquettes haute fidélité), palette, typographies — sous contraintes §14.5 et D-P16.
- Hébergeur et topologie exacts (PaaS vs Kubernetes), fournisseur d'email transactionnel, outil d'observabilité — sous contraintes §13.6, §14.
- Schéma physique final (Prisma) à partir de §11, y compris partitionnement, index supplémentaires, stratégie de migrations expand/contract.
- Stratégie de cache (Redis) par endpoint, pagination exacte des réponses, forme des DTO, génération du client API.
- Implémentation du service worker PWA et de la stratégie hors-ligne minimale.
- Détails d'implémentation des jobs (concurrence, retries, dead-letter), de la réconciliation LiveKit, du calcul des segments vidéo uniques côté client.
- Jeux de données de démo et de test, scénarios E2E précis, outils de test de charge pour la salle.
- Textes définitifs des emails et de l'interface (le PRD fixe le sens ; la rédaction FR/AR/EN est à produire avec relecture native pour l'arabe).

Le builder **ne doit pas** modifier sans décision du propriétaire : les priorités P0/P1/P2, les règles de présence (seuils et base de calcul D-P21) et de progression, les fenêtres, délais, prolongations et plafond de session (D-P5, D-P6), la règle de révocation d'inscription et la chaîne de vérification du jeton de salle (D-P22), le calendrier des rappels porté par la session (D-P23), la portée **par espace** du consentement parental et l'absence de purge automatique (D-O5), les garde-fous professeurs (D-O6), la règle d'espace personnel des professeurs invités (D-O7), le choix « jetons porteurs + filigrane, sans DRM » (D-O8), la matrice de permissions, les limites (participants, uploads, quotas), les choix de fournisseurs par défaut, les exigences de conformité.

---

# 23. Indicateurs de succès

## 23.1 KPIs produit (plateforme) et cibles à 90 jours après lancement MVP

| KPI | Définition | Cible |
|---|---|---|
| Activation professeur | % de professeurs inscrits ayant publié 1 cours **et** invité ≥ 1 étudiant sous 7 j | ≥ 60 % |
| Temps jusqu'à la première session | médiane entre inscription et première session `COMPLETED` | ≤ 7 jours |
| Acceptation des invitations | invitations `ACCEPTED` / envoyées (hors révoquées) sous 7 j | ≥ 70 % |
| Rétention professeur S8 | % de professeurs avec ≥ 1 session `COMPLETED` dans la 8e semaine après inscription | ≥ 40 % |
| Taux de réalisation des sessions | définition §8.14.1 | ≥ 85 % |
| Succès de jointure de salle | `room_join_succeeded` / `room_join_attempted` | ≥ 98 % |
| Temps « clic → média » | médiane de `time_to_media_ms` | < 3 s |
| Taux de présence | définition §8.14.1, toutes sessions | ≥ 85 % |
| Comptes rendus | sessions `COMPLETED` avec compte rendu publié sous 48 h | ≥ 70 % |
| Complétion de cours | inscriptions à 100 % à 90 j / inscriptions actives depuis ≥ 90 j | ≥ 50 % |
| Étudiants actifs hebdo | définition §8.14.1, agrégée plateforme | ≥ 60 % des inscrits |
| NPS professeurs | enquête trimestrielle | ≥ 40 |
| Incidents critiques (live indisponible) | par mois | 0 |
| Consentement parental | mineurs `ACTIVE` / mineurs inscrits à 14 j | ≥ 80 % |

## 23.2 KPIs d'engagement (repris de la v1, avec définitions)

- Professeur : cours créés/publiés, vidéos publiées, sessions créées/réalisées, comptes rendus publiés, messages envoyés — par semaine, par espace.
- Étudiant : cours commencés (≥ 1 leçon `IN_PROGRESS`), taux de complétion, minutes de vidéo uniques, sessions suivies, taux de présence, dernière activité.
- Qualité des sessions : programmées, réalisées, annulées (avec délai), `NO_SHOW`, durée moyenne effective vs prévue, taux de repli audio, reconnexions par session.

---

*Fin du PRD v2.0 — toute modification doit incrémenter la version et compléter l'historique.*

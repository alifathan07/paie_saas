# Analyse du projet — Paie Train

## 1. Vue d'ensemble

**Paie Train** est une application web de gestion de la paie marocaine. Elle couvre le cycle complet d'un bulletin de paie : gestion des salariés, saisie des éléments variables du mois, calcul déterministe des cotisations et de l'impôt, génération et validation des bulletins, puis édition de documents PDF et d'états déclaratifs.

L'application est multi-entreprise : un utilisateur appartient à une ou plusieurs sociétés (`Company`) et toutes les données métier sont cloisonnées par la société active. Un espace d'administration permet de gérer les comptes clients, leurs limites de sociétés, leur blocage, ainsi que la consultation des journaux d'audit.

Le flux métier principal est le suivant :

```text
Connexion
  -> Sélection d'une société (ou société unique automatique)
  -> Création / sélection d'un employé
  -> Saisie des éléments du mois (absences, heures sup., primes, avances...)
  -> Prévisualisation du calcul (/calculate)
  -> Génération du bulletin (/generate)
  -> Validation / clôture du bulletin
  -> Téléchargement du PDF et production des états (CNSS, AMO, IR, journal, livre de paie)
```

---

## 2. Stack technique

| Domaine | Technologie |
|---|---|
| Runtime | Node.js, modules ES (`"type": "module"`) |
| Serveur web | Express 5 |
| Vues | EJS (`src/views`) |
| Base de données | MySQL |
| ORM | Prisma 6.19 (`provider = "mysql"`) |
| Sessions | `express-session` + `express-mysql-session` (stockage MySQL) |
| Authentification | `bcryptjs` |
| Génération PDF | `pdfkit` |
| Import de fichiers | `multer`, `xlsx` |
| Scripts TypeScript | `tsx` (seeds Prisma) |
| Tunnel / exposition | `@ngrok/ngrok` |
| Process manager | `ecosystem.config.cjs` (PM2) |

Le point d'entrée est `index.js`. Le client Prisma est généré dans `src/generated/prisma`.

---

## 3. Structure du dépôt

```text
paie_train/
├── index.js                 # Bootstrap Express, sessions, montage des routes, période active
├── prisma/
│   ├── schema.prisma        # Modèle de données complet
│   ├── migrations/          # Migrations SQL
│   └── seed*.ts             # Seeds (rubriques, employés, données de base)
├── middlewares/
│   ├── auth.js              # isAuth, requireActiveCompany
│   ├── admin.js             # isAdminUser / contrôle d'accès admin
│   └── security.js          # En-têtes de sécurité, protection same-origin
├── src/
│   ├── routes/              # Déclaration des routes par domaine
│   ├── controllers/         # Logique de requête/réponse
│   ├── services/            # Logique métier et accès Prisma
│   ├── payroll-engine/      # Moteur de paie déterministe (calculs, règles, utilitaires)
│   ├── pdf/                 # Génération des bulletins et états PDF
│   ├── lib/                 # Connexion Prisma, société active, période de bulletin
│   ├── data/                # Données statiques (import employés)
│   ├── views/               # Templates EJS (layouts, partials, pages)
│   └── generated/prisma/    # Client Prisma généré
├── public/                  # Assets statiques (CSS, JS, images)
├── test/                    # Tests d'intégration / scénarios
├── test_*.js                # Scripts de test ciblés à la racine
└── *.md                     # Documentation (explain.md, project_description.md, etc.)
```

---

## 4. Authentification, sessions et isolation multi-entreprise

### Connexion

- Page `GET /auth`, formulaire `POST /auth/login`.
- `src/services/auth.service.js` charge l'utilisateur et vérifie le mot de passe avec `bcrypt.compare`.
- En cas de succès, la session contient uniquement des données non sensibles :
  `id`, `name`, `email`, `isAdmin`, `isBlocked`, `activeCompanyId`.
- Le hash du mot de passe n'est jamais placé en session.
- Les réponses d'erreur de connexion sont génériques pour ne pas révéler l'existence d'un compte.

### Sessions

- Sessions persistées côté serveur dans MySQL (`express-mysql-session`).
- Cookie `httpOnly`, `SameSite=Lax` par défaut, durée de 2 heures.
- Cookie `secure` activé uniquement en production (`NODE_ENV=production`).
- `SESSION_SECRET` est obligatoire en production ; une valeur de développement est utilisée localement.

### Middlewares d'autorisation

1. **`isAuth`** : vérifie la présence de `req.session.user`, sinon redirection vers `/auth`.
2. **`isAdminUser` / `isAdmin`** : protège toutes les routes `/admin`. Le rôle est relu en base pour éviter les sessions obsolètes, avec un repli sur la variable `ADMIN_EMAIL`.
3. **`requireActiveCompany`** :
   - refuse un utilisateur non-admin bloqué (`403 ACCOUNT_BLOCKED`) ;
   - valide `activeCompanyId` ;
   - vérifie l'appartenance via la table `userCompanies` ;
   - expose `req.activeCompanyId` aux contrôleurs.

### Isolation des données

Les requêtes métier (employés, bulletins, éditions, rapports) filtrent systématiquement par `companyId`. La sélection de société est validée contre les appartenances de l'utilisateur : un identifiant de société présent dans l'URL ne suffit jamais.

### Mode client administrateur

Un administrateur peut « entrer » dans le contexte d'un client depuis `/admin/clients`. Le mode est stocké dans `req.session.adminClientMode` (utilisateur cible + société), validé côté serveur, puis restauré à la sortie du mode. Il ne s'agit pas d'une nouvelle authentification : l'identité administrative reste distincte de celle du client.

### Journaux d'audit

Les actions administratives sont enregistrées dans `audit_logs` : acteur, action, cible, société éventuelle, métadonnées, adresse IP et horodatage. Actions notamment suivies : `BLOCK_USER`, `UNBLOCK_USER`, `CHANGE_COMPANY_LIMIT`, `CREATE_COMPANY`, `CREATE_USER`, `ENTER_SUPPORT_MODE`, `EXIT_SUPPORT_MODE`, `UPDATE_REPORT`.

---

## 5. Modèle de données

Défini dans `prisma/schema.prisma`.

### Sociétés et utilisateurs

- **`Company`** : identité légale et paramètres de paie (ICE, IF, RC, affiliation CNSS, SMIG, mode de temps de travail `DAYS`/`HOURS`, jours/heures mensuels standards, taux d'indemnité de représentation).
- **`Users`** : compte de connexion, hash bcrypt, `isAdmin`, `isBlocked`, `blockReason`, `maxCompanies` (0 = illimité).
- **`UserCompany`** : table de jointure utilisateur ↔ société (clé composite), qui définit le périmètre d'accès.
- **`Report`** : tickets clients (sujet, message, note admin, statut `OPEN`/`IN_PROGRESS`/`SOLVED`/`CLOSED`).
- **`AuditLog`** : traçabilité des actions administratives.

### Employés et rémunération

- **`Employee`** : état civil, contrat, ancienneté, catégorie, fonction, chantier, situation familiale, charges de famille, coordonnées bancaires, CNSS, salaire de base, taux CIMR, indemnité de représentation, indicateurs `actif` / `blocageSaisiePaie` / `bulletinMasque`.
- **`EmployeeCategory`**, **`EmployeeFunction`**, **`Chantier`** : référentiels par société ou issus d'une API externe pour les chantiers.
- **`Bonus`** / **`EmployeeBonus`** : primes récurrentes configurables, avec options d'inclusion dans la base congés payés et jours fériés.
- **`Avance`** / **`AvanceDeduction`** : avances sur salaire et leur imputation sur les bulletins.

### Bulletins de paie

- **`Payslip`** : instantané mensuel complet d'un employé pour un mois/année donnés.
  - Temps de travail : `workedDays`, `workedHours`, `paidLeaveDays`, `joursFeries`, mode et bases standard.
  - Statut : `DRAFT`, `GENERATED`, `VALIDATED`, `CLOSED`, `ERROR`, avec `validatedAt` / `validatedById`.
  - Montants : salaire de base, ancienneté, primes imposables/non imposables, congés payés, jours fériés, `brutGlobal`, `sbg`, `sbi`, `cnss`, `amo`, `cimr`, `fraisPro`, `sni`, `netAPayer`, avances, absences, heures supplémentaires.
  - Cumuls IR : `sniCumule`, `moisEcoules`, `sniAnnuelEstime`, `irAnnuelEstime`, `irCumule`, `irPrecedent`, `irNet`, `irBrut`, `irTheorique`, `sommeADeduire`, `chargesDeFamille`.
  - Taux historisés : CNSS, AMO, CIMR, frais professionnels, IR.
  - Contrainte d'unicité : `(employeeId, month, year)`.
- **`PayslipBonus`** : lignes de primes du bulletin, avec code, montant, base source (pour proratisation) et caractère imposable.
- **`PayslipRetenu`** : retenues du bulletin rattachées à une rubrique.
- **`BulletinMask`** : masquage d'un bulletin pour un employé et une période.

### Paramétrage de paie

- **`PayrollConfig`** : taux et plafonds par défaut (CNSS salariale 4,48 % et plafond 6 000 DH, AMO 2,26 %, frais professionnels 35 %/25 % avec plafonds, charges de famille 50 DH/personne, maximum 6 personnes).
- **`RubriqueBase`**, **`RubriqueRetenu`**, **`RubriqueImposable`** : catalogue de rubriques par société (base, retenues, éléments imposables).
- Tables legacy conservées (`LegacyBulletinRubrique`, `LegacyRubriqueImposable`) pour ne pas supprimer de données existantes.

---

## 6. Moteur de paie

Le moteur se trouve dans `src/payroll-engine/`. `PayrollEngine.js` expose `calculatePayroll(employee, overrides)` et sert de **source unique de vérité** pour la prévisualisation (`/calculate`) comme pour la génération (`/generate`).

### Chaîne de calcul

1. **Période de référence** : date de fin du mois de paie (ou `periodDate` fourni).
2. **Temps de travail** : normalisation `DAYS` / `HOURS` à partir de la configuration société et des surcharges.
3. **Salaire de base** : proratisation selon le ratio jours/heures travaillés.
4. **Ancienneté** : calcul du nombre de mois depuis `dateEmbauche`, puis application du taux d'ancienneté.
5. **Primes variables imposables** : saisies mensuelles.
6. **Heures supplémentaires** : majorations 25 %, 50 %, 100 %.
7. **Indemnité de représentation** : taux propre à l'employé ou taux société, avec proratisation.
8. **Indemnités non imposables** : intégration au brut global, avec plafonds et proratisation éventuelle.
9. **Congés payés et jours fériés** : calcul des bases et des montants correspondants.
10. **Absences** : déduction selon les règles d'absence.
11. **Cotisations** : CNSS salariale/patronale, AMO salariale/patronale, CIMR.
12. **Frais professionnels** : taux et plafonds selon le niveau de salaire.
13. **SNI** (Salaire Net Imposable) : base imposable après cotisations et frais professionnels.
14. **IR** : barème progressif, charges de famille, lissage et cumul annuel.
15. **Net à payer** : brut global moins cotisations, IR et avances.
16. **Cumuls annuels** : `sniCumule`, `irCumule`, `irPrecedent`, estimation annuelle, nombre de mois écoulés.

### Modules du moteur

```text
src/payroll-engine/
├── PayrollEngine.js
├── netToBase.js
├── calculators/
│   ├── anciennete.calculator.js
│   ├── cnss.calculator.js
│   ├── amo.calculator.js
│   ├── cimr.calculator.js
│   ├── fraisProfessionnels.calculator.js
│   ├── ir.calculator.js
│   ├── cumulativeIr.calculator.js
│   ├── overtime.calculator.js
│   └── period.calculator.js
├── rules/
│   ├── absence.rules.js
│   ├── anciennete.rules.js
│   ├── cnss.rules.js
│   ├── amo.rules.js
│   ├── fraisProfessionnels.rules.js
│   ├── ir.rules.js
│   └── overtime.rules.js
└── utils/
    ├── calculateMonths.js
    └── workingTime.js
```

La séparation `calculators` / `rules` isole les formules des paramètres légaux, ce qui facilite les mises à jour de barèmes et de taux.

### Cas particuliers gérés

- Employé inactif ou `blocageSaisiePaie` : les entrées payables sont neutralisées avant calcul.
- Indemnités non imposables proratisées mais plafonnées.
- Indemnité de représentation propre à l'employé vs taux société.
- CIMR avec base réduite imposable optionnelle.
- Cumul IR sur l'année et régularisation.
- Calcul inverse « net vers base » (`netToBase.js`).

---

## 7. Fonctionnalités applicatives

### Tableau de bord — `/dashboard`

Vue synthétique de l'activité de la société active : effectifs, bulletins, indicateurs de paie et accès rapides.

### Employés — `/employees`

- Liste, création, modification, suppression et consultation des employés.
- Import de fichiers (Excel/CSV via `multer` + `xlsx`) avec service dédié.
- Gestion des catégories et fonctions.
- Données de paie : salaire de base, primes récurrentes, avances, coordonnées bancaires, CNSS/CIMR.
- Rafraîchissement des données de paie des employés (`employeePayrollRefresh.service.js`).

### Bulletins — `/bulletins`

- Saisie des éléments variables du mois.
- Prévisualisation du calcul sans persistance.
- Génération, régénération, validation et clôture des bulletins.
- Gestion des bulletins masqués.
- Téléchargement PDF unitaire.
- Verrouillage de période : on ne peut pas ouvrir un mois postérieur au mois actif tant que celui-ci n'est pas clôturé (`src/lib/bulletinPeriod.js`, route `/period`).

### Éditions — `/editions`

Production des états de paie et déclarations :

- **État CNSS**
- **État AMO**
- **Journal de paie**
- **Livre de paie**
- **État IR**

Ces états sont disponibles à l'écran et en PDF via `src/pdf/contributionReportsPdf.js`.

### Paramétrage — `/parametrage`

Configuration de la société active (identité, paramètres de temps de travail, taux, coordonnées bancaires, etc.) et des référentiels de paie.

### Indemnités — `/indemnites`

Gestion des indemnités (imposables/non imposables), taux, plafonds et règles de proratisation.

### Primes — `/primes`

Catalogue des primes récurrentes et affectation aux employés.

### Rubriques — `/rubriques`

Gestion des rubriques de base, de retenue et imposables, avec codes et clés de calcul.

### Avances — `/avances`

Enregistrement des avances sur salaire et suivi de leur solde et de leur imputation sur les bulletins.

### Rapports clients — `/reports`

Création et suivi de tickets par les clients, traitement et réponse par l'administrateur.

### Profil — `/profile`

Consultation et mise à jour du compte connecté.

### Administration — `/admin`

- Tableau de bord avec statistiques (utilisateurs, actifs/bloqués, sociétés, employés, rapports ouverts, activité récente).
- Liste et recherche des utilisateurs.
- Blocage/déblocage avec motif.
- Modification de la limite de sociétés (`maxCompanies`).
- Création de sociétés pour un client, contrôlée par la limite et exécutée en transaction.
- Création d'utilisateurs (validation serveur, hash bcrypt, `isAdmin = false` forcé).
- Détail utilisateur avec sociétés et historique d'activité.
- Liste et détail des sociétés.
- Journal d'audit filtrable par action.
- Page « Usage / Limites ».
- Mode support / client.

---

## 8. Vues et interface

Les templates EJS sont organisés par domaine dans `src/views/` :

```text
views/
├── layouts/     # Gabarits communs
├── partials/    # Header, navbar, sidebar, composants réutilisables
├── admin/
├── auth/
├── avances/
├── bulletins/
├── companies/
├── dashboard/
├── editions/
├── employees/
├── indemnites/
├── parametrage/
├── primes/
├── profile/
├── reports/
└── rubriques/
```

Le rendu est majoritairement serveur. Les interactions dynamiques utilisent du JavaScript côté client dans `public/js/` (sidebar, dialogues, sélecteur de période). HTMX est pris en charge côté serveur via l'en-tête `HX-Redirect` lors des redirections de connexion.

Le sélecteur de période est centralisé : la route `/period` est le seul point autorisé à changer la période active ; les autres pages consomment la période stockée en session.

---

## 9. PDF et documents

- `src/pdf/bulletinPdf.js` : génération du bulletin de paie individuel.
- `src/pdf/contributionReportsPdf.js` : états CNSS/AMO, journal de paie et livre de paie.
- Les montants sont formatés en locale `fr-MA`.
- Les documents incluent les informations de la société (logo, identité légale, affiliation CNSS) et les cumuls nécessaires.

---

## 10. Sécurité

Mesures déjà présentes :

- Mots de passe hachés avec `bcryptjs` ; hash jamais exposé.
- Sessions serveur MySQL et cookie HTTP-only.
- Contrôle d'accès admin relu en base.
- Vérification d'appartenance à la société avant toute opération métier.
- Requêtes filtrées par société.
- Blocage des utilisateurs non-admin.
- Validation des identifiants numériques.
- Échappement EJS par défaut.
- Journaux d'audit administratifs.
- Validation same-origin (`Origin` / `Referer`) pour les requêtes mutantes (middleware disponible, actuellement commenté dans `index.js`).
- Limitation du débit des tentatives de connexion par IP (stockage local au processus).
- En-têtes de sécurité (nosniff, framing, referrer, permissions, HSTS en production) — middleware disponible mais également commenté dans `index.js`.

Points de durcissement identifiés :

- `SESSION_SECRET` de développement à remplacer impérativement en production.
- Cookies `secure` à activer derrière HTTPS.
- Protection CSRF par jeton synchronisé non implémentée (seule la vérification same-origin existe).
- Rate limiting local au processus : prévoir un store partagé en multi-instance.
- Les middlewares `securityHeaders` et `sameOriginProtection` existent mais sont désactivés dans le bootstrap actuel.
- Les erreurs d'autorisation sont renvoyées en texte brut.
- « Remember me » et « mot de passe oublié » sont présents dans l'UI mais non implémentés côté serveur.

---

## 11. Configuration et exécution

Variables d'environnement (`.env.example`) :

```text
DATABASE_URL=       # URL MySQL utilisée par Prisma
SESSION_SECRET=     # secret de session (obligatoire en production)
SESSION_SAME_SITE=  # SameSite du cookie (défaut : lax)
NODE_ENV=           # development | production
ADMIN_EMAIL=        # repli d'identification administrateur
ADMIN_PASSWORD=     # utilisé par les scripts de seed/admin
```

Le store de session se connecte actuellement à MySQL sur `localhost:3306`, base `paie`, utilisateur `root`, sans mot de passe (configuration en dur dans `index.js`).

Commandes utiles :

```bash
node index.js                 # démarrage du serveur (port 3000 par défaut)
npx prisma generate           # génération du client Prisma
npx prisma migrate deploy     # application des migrations
npm run seed:rubriques        # seed des rubriques
npm run seed:employees        # seed des employés
```

Le dépôt inclut `ecosystem.config.cjs` pour un déploiement PM2 et `@ngrok/ngrok` pour exposer l'application.

---

## 12. Tests

Le projet contient des scripts de test/scénarios ciblés, exécutés directement avec Node :

- `test_payroll_spec.js` : spécifications du moteur de paie.
- `test_annual_cumulative.js`, `test_ir_cumulative.js` : cumuls annuels et IR.
- `test_bulletin_*.js` : périodes, jours travaillés, indemnités, masquage.
- `test_indemnity_bulletin_override.js`, `test_non_taxable_indemnity_proration.js`, `test_representation_indemnity_flow.js` : indemnités et proratisation.
- `test_net_to_base.js` : calcul inverse net → base.
- `test_working_time.js` : modes jours/heures.
- `test_blocked_payroll.js` : blocage de la saisie de paie.
- `test_employee_import_response.js` : import d'employés.
- `verify_frais_pro_rule.js`, `e2e_real_data_test.js`, `smoke_test.js` : vérifications de règles et tests de bout en bout.

Le script `npm test` n'est pas encore configuré ; les tests s'exécutent individuellement (`node test_xxx.js`) ou via les scripts npm dédiés aux indemnités.

---

## 13. Points d'attention / dette technique

- Configuration MySQL des sessions dupliquée en dur dans `index.js` au lieu de variables d'environnement.
- Middlewares de sécurité présents mais désactivés.
- Deux champs de charges de famille (`nbPersonacharge`, `nbEnfantCharge`) à maintenir manuellement ; une table de dépendants serait plus robuste.
- Tables legacy conservées volontairement dans le schéma.
- Certaines règles métier (plafonds, taux, barèmes IR) sont codées en dur dans `rules/` et `PayrollConfig` ; prévoir une version datée des paramètres légaux.
- Le store de rate limiting et la configuration de session ne sont pas adaptés à un déploiement multi-instances sans ajustement.
- Documentation abondante à la racine (`explain.md`, `project_description.md`, `SECURITY_AUDIT.md`, etc.) mais partiellement redondante.

---

## 14. Résumé

Paie Train est une application monolithique Express/EJS/MySQL/Prisma centrée sur la paie marocaine. Sa force réside dans un moteur de calcul déterministe, testé et isolé, une gestion multi-entreprise stricte et un espace d'administration complet avec audit. Le flux principal va de la saisie des éléments variables à la génération, la validation et l'édition des bulletins et états déclaratifs. Les principaux axes d'amélioration concernent la configuration d'environnement, l'activation des protections HTTP/CSRF et le durcissement du déploiement.

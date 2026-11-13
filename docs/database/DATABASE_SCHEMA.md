# Database schema

Prisma models in `prisma/schema.prisma` map to MySQL. This is a description of
the current schema, not a proposal for a normalized redesign. Amounts and
historical payroll results are stored on payslip records and related snapshot
rows so reports can use values from the processed bulletin.

## Models and relationships

| Area | Models | Purpose and key relationships |
|---|---|---|
| Tenancy and users | `Company`, `Users`, `UserCompany`, `AuditLog`, `Report` | Companies hold identity, working-time settings and feature flags, including `primeRendementEnabled` (enabled by default). `Users` stores a unique username, email, password hash, admin/blocked flags, `twoFactorEnabled` (enabled by default for client accounts), and company limits. `UserCompany` joins users to companies. `AuditLog` records an actor and optional company/target. `Report` stores report records. |
| Employees | `Employee`, `Banque`, `Chantier`, `EmployeeCategory`, `EmployeeFunction` | Employees belong to a company and may reference company-specific category, function, bank and worksite data. Important employee fields include `matricule`, `nomComplet`, `baseSalary` and `blocageSaisiePaie`, alongside identity, employment, family and payroll-input fields. |
| Earnings and advances | `Bonus`, `EmployeeBonus`, `Avance`, `AvanceDeduction` | `Bonus` is an earning catalog; `EmployeeBonus` associates recurring earnings with employees. Advances belong to employees and can have deductions associated with payslips. |
| Payroll | `Payslip`, `BulletinMask`, `PayslipBonus`, `PayslipRetenu` | A payslip belongs to an employee and stores `month`, `year`, `status`, working-time inputs, the dedicated Prime rendement input and amount, `sbg`, `sbi`, `sni`, `cnss`, `amo`, `cimr`, `irNet`, `netAPayer` and validation metadata. Related rows store earning/retention lines and payslip masks. |
| Rubriques and configuration | `PayrollConfig`, `RubriqueBase`, `RubriqueRetenu`, `RubriqueImposable` | `PayrollConfig` stores global payroll settings. Rubrique catalogs are company-scoped and provide display/code mapping for base, retention and taxable lines. |
| Legacy | `LegacyBulletinRubrique`, `LegacyRubriqueImposable` | Legacy rubric data models remain in the schema alongside the current rubric tables. Their presence alone does not establish that the current payroll path uses them. |

## Important constraints

- `UserCompany` has a composite primary key `(companyId, userId)` and also
  `@@unique([companyId])`. The latter means the database permits at most one
  user membership per company, despite the join-table shape.
- `Employee.matricule` is unique within a company. CIN, CNSS number and RIB
  have global unique constraints, so the same identifier cannot be reused
  across companies.
- Company ICE, IF and RC identifiers are unique.
- A `Payslip` is unique per employee/month/year. A `BulletinMask` is likewise
  period-specific. Rubrique catalogs use company-scoped unique keys/codes.
- `PayrollConfig` has no company relation and is therefore shared globally.
- Company working-time defaults are represented by `workingTimeMode`,
  `standardMonthlyDays` and `standardMonthlyHours`; the current application
  defaults are documented in
  [the payroll workflow](../business/PAYROLL_WORKFLOW.md).
- Payslip rows include calculation inputs/results such as status, standard
  working time, worked days/hours, gross/taxable bases, contributions, IR,
  net, validation actor and timestamps. `PayslipBonus.baseAmount` preserves a
  base value in addition to the payable line amount.

## Historical and schema caveats

- The schema has legacy rubric models as well as current company-scoped
  rubrique tables; consumers should follow the current services and routes
  rather than infer runtime use from model presence.
- The migration history contains changes that remove and later reintroduce
  public-holiday bulletin fields. The current schema is authoritative for the
  present shape; old migration states should not be treated as current
  behavior.
- `Employee` contains a `natureEmploi` comment describing contribution
  eligibility, but the current payroll engine does not check that field when
  calculating CNSS/AMO. See
  [implemented payroll rules](../business/MOROCCAN_PAYROLL_RULES.md).

See `prisma/schema.prisma` for exact column types, defaults, indexes and
relations.

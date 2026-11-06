# System overview

## Stack and structure

This is a server-rendered Moroccan payroll application built with Node.js
ES modules, Express 5, EJS, Prisma 6 and MySQL. Bootstrap and browser-side
JavaScript provide the UI. The Prisma schema is the data model; there is no
separate ORM model layer.

- `index.js` configures Express, EJS, static assets, sessions, middleware and
  route mounting.
- `src/routes/` defines HTTP endpoints; `src/controllers/` handles requests,
  validation, orchestration, persistence and page rendering.
- `src/services/` contains reusable work such as authentication, rubric
  mapping, audit recording, employee-to-draft refresh and report assembly.
- `src/payroll-engine/` contains the payroll engine, calculators, rules,
  working-time utilities and net-to-base calculation.
- `src/views/` and `public/` contain EJS pages, styles and browser scripts.
- `src/pdf/` generates payslips and payroll reports.
- `prisma/schema.prisma`, `prisma/migrations/` and `prisma/seed*.ts` define,
  migrate and seed the MySQL data.

## Request lifecycle

1. `index.js` loads environment variables, configures EJS and request parsing,
   serves static files and configures a MySQL-backed Express session.
2. Authentication routes are mounted before the global authentication guard.
   The guard protects the remaining application; profile, company-selection
   and admin routes are mounted before the active-company guard.
3. `requireActiveCompany` validates the session's active company and
   membership. Payroll/business routers are mounted after this guard.
   Bulletin routes additionally enforce the active payroll period through
   `middlewares/bulletinPeriod.js`.
4. Controllers resolve company context through `src/lib/company.js`, read or
   update records with Prisma, and render EJS or return JSON/PDF responses.
   Payroll generation passes through `src/payroll-engine/PayrollEngine.js`;
   `src/controllers/bulletins.controller.js` applies cumulative IR and stores
   the resulting bulletin and line snapshots.

## Main capabilities

Route modules cover authentication, company and employee management, employee
imports, bulletins, advances, bonuses/indemnities, rubriques, configuration,
administrative operations and editions. Editions include payslip PDFs and
monthly payroll, CNSS/AMO and IR reports. See `src/routes/`,
`src/controllers/`, `src/services/` and `src/pdf/`.

## Implementation caveats

- `PayrollConfig` is global, not company-scoped. The admin screen edits
  country-wide values, but the payroll engine's calculation rules are also
  hard-coded in `src/payroll-engine/rules/`; changing the database config
  should not be assumed to change every calculated amount.
- Overtime rules declare a 208-hour standard, while a company can default to
  191 hours. See `src/payroll-engine/rules/overtime.rules.js` and
  `src/payroll-engine/utils/workingTime.js`.
- The security-header and same-origin middleware calls in `index.js` are
  commented out; their presence in `middlewares/security.js` does not mean
  they are active for application requests.

Related: [authentication and authorization](AUTH_AND_AUTHORIZATION.md),
[payroll workflow](../business/PAYROLL_WORKFLOW.md).

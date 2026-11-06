# Development and operations commands

## Setup

1. Install the package dependencies with `npm install`. The declared
   `postinstall` script runs `prisma generate`.
2. Copy `.env.example` to `.env` and set at least `DATABASE_URL`,
   `SESSION_SECRET`, and any required admin/environment values.
3. Generate the Prisma client with `npx prisma generate`.

`.env.example` lists `DATABASE_URL`, `SESSION_SECRET`,
`SESSION_SAME_SITE`, `NODE_ENV`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
Prisma migrations use `DATABASE_URL` via `prisma.config.ts`. The Express
session-store connection in `index.js` is separately hard-coded and does not
use that URL; local environment configuration alone does not change it.

## Prisma and seed data

- `npx prisma migrate dev` — apply development migrations.
- `npx prisma migrate deploy` — apply committed migrations in a deployment.
- `npx prisma db seed` — run the configured `prisma/seed.ts`.
- `npm run seed:rubriques` — seed/upsert rubric catalogs for existing
  companies.
- `npm run seed:employees` — seed sample employees into the first company or
  the company selected by `SEED_COMPANY_ID`.

The Prisma CLI commands are not wrapped in npm scripts. `prisma.config.ts`
points to `prisma/schema.prisma`, `prisma/migrations` and the main seed.

## Tests

`npm test` is not configured; it exits with “Error: no test specified”.
Declared focused scripts:

- `npm run test:indemnity-override`
- `npm run test:representation`

Other standalone payroll and workflow checks can be run with `node
test_<name>.js`; examples include `test_payroll_spec.js`,
`test_ir_cumulative.js`, `test_working_time.js`,
`test_bulletin_active_period.js`, `test_blocked_payroll.js` and
`test_non_taxable_indemnity_proration.js`. The integration test can be run
with `node --test test/csrf.integration.test.js`.

## Running and deployment

There are no declared `start` or `dev` scripts. `nodemon` and `tsx` are
dependencies, so a local invocation can use `npx nodemon index.js`. The
deployment configuration is `ecosystem.config.cjs`: PM2 app name `paie`,
working directory `/var/www/paie_saas`, entry `index.js`, interpreter
`./node_modules/.bin/tsx` and `NODE_ENV=production`. PM2 itself and the
deployment/release procedure are not documented in this repository.

No deployment command, health check, backup procedure, or production
environment setup beyond the PM2 config is specified by the source files.

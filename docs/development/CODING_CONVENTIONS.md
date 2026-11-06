# Coding conventions

These are observed repository patterns, not enforced lint rules.

- Application code uses JavaScript ES modules (`"type": "module"`), with
  `.js` extensions on local imports. Prisma config and seed scripts also use
  TypeScript and run through `tsx`.
- HTTP work is organized into Express routers under `src/routes/`, controllers
  under `src/controllers/`, and reusable logic under `src/services/`.
  Payroll math belongs in `src/payroll-engine/` calculators/rules/utilities,
  not EJS templates.
- Prisma is accessed through `src/lib/db.js` or established service/controller
  patterns. Related persistence operations use Prisma transactions where
  atomic updates are needed. The schema and migration history are in
  `prisma/`.
- EJS is server-rendered and localized primarily in French; browser behavior
  lives in `public/js/`. The backend remains authoritative for payroll
  calculations.
- Payroll calculations use explicit calculator/rule modules and two-decimal
  money rounding. Preserve stored bulletin snapshots and cumulative IR
  behavior when changing these paths.
- Existing validation and errors vary by endpoint: controllers commonly
  render/redirect with query or session messages, return JSON for async
  actions, and log caught errors. Follow the specific route's established
  response style.
- No repository-wide formatter, linter, TypeScript build or test framework is
  declared in `package.json`. Standalone root `test_*.js` scripts use direct
  Node execution; `test/csrf.integration.test.js` uses Node's built-in test
  runner.

Key references: `index.js`, `src/routes/`, `src/controllers/`,
`src/services/`, `src/payroll-engine/`, `src/views/`, `public/js/`,
`prisma/schema.prisma`, `package.json`.

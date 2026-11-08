# Business constraints and exceptional cases

## Tenant and employee constraints

- Business data is scoped to the active company selected in the session.
  Controllers must use `resolveCompanyId(req)` rather than trust a company ID
  supplied by the browser.
- An employee matricule is unique within a company, while CIN, CNSS number
  and RIB are unique across the whole database.
- Payroll generation includes employees in the company. An employee with
  `blocageSaisiePaie` receives the blocked/zero payroll treatment and is
  excluded from normal payroll entry/calculation.
- The schema's `UserCompany @@unique([companyId])` currently limits each
  company to one user membership.

## Period and bulletin rules

- A payslip is unique per employee/month/year.
- `getActiveBulletinPeriod` chooses the earliest period whose bulletin is not
  `CLOSED`; if all existing periods are closed, it selects the period after
  the latest one. With no existing rows it uses the current month. An `ERROR`
  status is not closed and therefore counts as unfinished.
- Period middleware rejects periods later than the active period.
- `DRAFT` and `GENERATED` are editable through the normal bulletin flow.
  `VALIDATED` and `CLOSED` are generally locked. A validated bulletin may be
  returned to draft before closure.
- Closure is not absolute immutability: the controller has dedicated
  non-taxable-indemnity operations that accept validated/closed bulletins and
  preserve their status. Other edits remain restricted.
- Validation checks the combined worked, paid-leave, public-holiday and
  birth-leave days against the standard monthly day count.

## Inputs and exceptional behavior

- Working time is configured by company as day- or hour-based; default
  standards are 26 days and 191 hours. Overtime calculation uses the selected
  working-time basis, despite the separate rules file declaring 208 monthly
  hours.
- Paid leave, public holidays and birth leave have distinct inputs and
  calculation paths. Absence days/deductions are currently persisted as
  compatibility zeros, not calculated.
- Advances and manual retention lines are separate from base payroll
  deductions. Advance balances/deductions are handled through their own
  models and services.
- Payroll is rounded to two decimal places at calculation stages, then the
  final net is rounded to whole DH; retain the rounding line when reconciling
  stored totals.
- The configuration screen presents global payroll parameters, but those
  values are not consistently wired into calculation rules. See
  [implemented rules](MOROCCAN_PAYROLL_RULES.md).

Sources: `prisma/schema.prisma`, `src/lib/bulletinPeriod.js`,
`middlewares/bulletinPeriod.js`,
`src/controllers/bulletins.controller.js`,
`src/payroll-engine/utils/workingTime.js`.

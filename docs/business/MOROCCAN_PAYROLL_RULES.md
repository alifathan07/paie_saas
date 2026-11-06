# Implemented Moroccan payroll rules

This document records formulas present in the repository. **They have not
been independently checked against current Moroccan legislation.** Comments
in source code that label a rule “legal” or cite a law are not legal
verification. Confirm rates, caps and treatment with an authoritative,
current source before relying on them for compliance.

## Implemented calculation behavior

| Item | Implementation |
|---|---|
| Working-time basis | Company defaults are 26 monthly days and 191 monthly hours. Day-mode salary uses worked days / standard days; hour-mode uses worked hours / standard hours. See `src/payroll-engine/utils/workingTime.js`. |
| Overtime | The engine applies multipliers 1.25, 1.50 and 2.00 to the hourly base for the 25%, 50% and 100% bands. The hourly base is the current taxable SBI before overtime divided by 191 monthly hours, so the overtime being calculated is not included in its own rate base. |
| Prime rendement | The entered input is multiplied by net payable before Prime rendement / 191; the amount is rounded to two decimals and included as a taxable earning, following the request that it behave like overtime. It is not part of the standard prime catalogue. |
| Seniority | `src/payroll-engine/calculators/anciennete.calculator.js` and `src/payroll-engine/rules/anciennete.rules.js` apply 5%, 10%, 15%, 20% and 25% at 2, 5, 12, 20 and 25 years. |
| Employee CNSS | 4.48% of the contribution base, capped at 6,000 DH/month, in `src/payroll-engine/rules/cnss.rules.js` and `calculators/cnss.calculator.js`. |
| Employer CNSS | Social benefits 8.98% on the capped base; family allocations 6.40% and professional training 1.60% on the uncapped base. |
| AMO | Employee 2.26% and employer 4.11% in `src/payroll-engine/rules/amo.rules.js` and `calculators/amo.calculator.js`. |
| CIMR | Optional employee CIMR rate is applied when supplied. A separate setting controls whether CIMR reduces the taxable-income base; see `PayrollEngine.js`. |
| Professional expenses | For SBI up to 6,500 DH: 35%, capped at 2,500 DH. Above 6,500 DH: 25%, capped at 2,916.67 DH. See `src/payroll-engine/rules/fraisProfessionnels.rules.js`. |
| IR brackets | `src/payroll-engine/rules/ir.rules.js` defines annual bands: 0% through 40,000; then 10%, 20%, 30%, 34%, and 37% through the configured thresholds, using deductions of 4,000, 10,000, 18,000, 22,000 and 27,400 DH. The cumulative calculator annualizes/cumulates SNI across periods and accounts for eligible prior validated/closed bulletins. |
| Family deduction | The engine hard-codes 50 DH per dependent, capped at six, and subtracts it from gross IR subject to a zero floor. See `src/payroll-engine/PayrollEngine.js` and cumulative IR calculation. |
| Rounding | Monetary calculator outputs are generally rounded to two decimals. Final payable net is rounded to the nearest whole dirham and the difference is stored as the rounding line. |

The engine builds gross and taxable bases from prorated salary, seniority,
taxable earnings, overtime and applicable indemnities. Non-taxable indemnities
are tracked separately from SBI/SNI. Exact line mapping and formula order are
implemented in `src/payroll-engine/PayrollEngine.js` and
`src/controllers/bulletins.controller.js`.

## Unverified items and implementation inconsistencies

- `PayrollConfig` and the admin form expose rates, caps, expense thresholds
  and family-deduction values. The core engine uses constants in
  `src/payroll-engine/rules/` and calculator modules; database configuration
  is read separately for bulletin fields/refreshes and is not passed through
  all calculation paths. Do not assume editing the global form changes every
  calculation.
- The employee schema comment says `natureEmploi` controls CNSS/AMO treatment,
  but `PayrollEngine.js` calculates those contributions without checking it.
- The engine keeps `absenceDays` and `absenceDeduction` as zero-valued
  compatibility fields; absence deductions are not implemented in the
  calculation path.
- Paid-leave base construction filters bonus lines by taxable status, while
  historical data migration/configuration can mark non-taxable indemnities
  as applicable to leave. Those paths are not consistent.
- Monthly contribution reporting adds a separate 1.85% AMO participation
  amount in `src/services/monthlyContributionReports.service.js`; this is
  distinct from the 2.26% employee and 4.11% employer AMO rates in the
  payroll calculators.
- `src/payroll-engine/reports/cnss.report.js` recalculates payroll from
  employee data instead of consuming a saved payslip. Prefer
  `src/services/monthlyContributionReports.service.js` for historical
  bulletin-based values.

No rule in this document is presented as legally verified.

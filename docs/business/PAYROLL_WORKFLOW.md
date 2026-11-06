# Payroll workflow

## From employee data to payslip

1. **Maintain company and employee data.** Company working-time defaults and
   employee salary, status, family information, recurring bonuses, advances
   and payroll-block flags are stored through the employee/configuration
   routes and Prisma models. Employee edits can refresh open payslip drafts
   through `src/services/employeePayrollRefresh.service.js`.
2. **Select the payroll period.** The active period is computed from the
   company's existing payslips by `src/lib/bulletinPeriod.js` and enforced by
   `middlewares/bulletinPeriod.js`. A period later than the active period is
   rejected.
3. **Enter monthly inputs.** Bulletin forms accept worked days or hours,
   overtime, paid leave, public-holiday and birth-leave days, monthly
   taxable/non-taxable lines and permitted manual deductions. Company defaults
   are 26 days and 191 hours unless configured otherwise.
4. **Calculate.** `src/controllers/bulletins.controller.js` loads the employee
   and company context, calls `src/payroll-engine/PayrollEngine.js`, applies
   cumulative IR using eligible prior payslips, and maps the results to the
   payslip schema. The engine prorates the base salary by working time and
   calculates seniority, taxable earnings, overtime, Prime rendement, indemnities,
   contributions, professional expenses, IR inputs and net pay.
5. **Persist the bulletin and line snapshots.** The controller creates or
   updates the employee/period-unique `Payslip` and its `PayslipBonus` and
   `PayslipRetenu` rows. It retains the generated calculation values for
   later display and reporting rather than relying solely on current employee
   data.
6. **Review and lock.** Bulletin statuses are `DRAFT`, `GENERATED`,
   `VALIDATED`, `CLOSED` and `ERROR`. Generated bulletins can be reviewed;
   validation records the validating user/time, and a validated bulletin can
   return to draft before closure. Closed periods/bulletins are generally
   locked, with a special endpoint that still permits some non-taxable
   indemnity edits.
7. **Produce outputs.** `src/views/bulletins/` renders the bulletin;
   `src/pdf/bulletinPdf.js` generates payslip PDFs. `src/services/` assembles
   monthly payroll journals, IR and contribution reports, which
   `src/routes/editions.js` renders or exports as PDFs.

## Calculation order in the engine

`src/payroll-engine/PayrollEngine.js` computes the effective base, seniority,
taxable variable earnings, overtime, Prime rendement, representation indemnity, recurring
employee bonus lines and leave/holiday amounts, then SBG/SBI, employee and
employer contributions, professional expenses, SNI, family deductions, IR
and net. Bulletin persistence applies cumulative IR over the selected year;
the engine's standalone monthly result is not the final cumulative result
used by the bulletin controller.

## Historical reporting

The monthly payroll journal reads stored payslip values. The monthly
contribution report also uses stored payslip bases/deductions, then calculates
employer contribution figures from the current calculator rules. This means
the employee-level historical values are preserved, but employer components
are not a complete historical snapshot if those source rules change.

Sources: `src/controllers/bulletins.controller.js`,
`src/services/employeePayrollRefresh.service.js`,
`src/services/monthlyPayrollJournal.service.js`,
`src/services/monthlyContributionReports.service.js`,
`src/services/monthlyIrReport.service.js`,
`src/payroll-engine/PayrollEngine.js`,
`src/lib/bulletinPeriod.js`, `middlewares/bulletinPeriod.js`.

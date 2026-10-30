# États mensuels CNSS / AMO

## Implemented

The Éditions section now contains a combined monthly CNSS/AMO statement page at:

- /editions/contributions
- /editions/contributions/pdf

The existing Éditions CNSS and AMO cards now open this page. A selected month and year automatically load three reports:

1. ÉTAT CNSS employee details.
2. ÉTAT DES VIREMENTS CNSS.
3. ÉTAT MUTUELLE AMO.

The page provides a combined CNSS PDF export and a dedicated AMO PDF export at `/editions/contributions/amo/pdf`. The AMO web section and PDF both use the three reference categories: participation AMO, employee contributions, and employer contributions.

## Files

Created:

- src/services/monthlyContributionReports.service.js
- src/views/editions/contributions.ejs
- src/pdf/contributionReportsPdf.js
- ETAT_CNSS_IMPLEMENTATION_DETAILS.md

Modified:

- src/routes/editions.js
- src/views/editions/index.ejs
- public/css/custom.css

## Database fields reused

Company:

- Company.name
- Company.numeroAffiliationCnss

Employee:

- Employee.matricule
- Employee.nomComplet
- Employee.cin
- Employee.numeroCNSS
- Employee.companyId

Payslip:

- Payslip.month
- Payslip.year
- Payslip.status
- Payslip.workedDays
- Payslip.paidLeaveDays
- Payslip.sbi
- Payslip.cnss
- Payslip.amo

No new database table or migration was required. The existing unique constraint on employeeId, month, year prevents duplicate payroll records.

## Monthly selection and company isolation

Reports select payslips using:

- The selected month and year.
- The active company resolved through resolveCompanyId(req).
- Statuses GENERATED, VALIDATED, or CLOSED.

Draft, error, missing, masked, or unrelated-company records are not silently included. A period without eligible payslips produces an explicit message.

The company CNSS number is required. The report does not substitute a hardcoded company number.

## Calculation mapping

The service uses persisted historical payslip values for employee contributions:

- CNSS salary contribution: persisted Payslip.cnss.
- AMO salary contribution: persisted Payslip.amo.
- CNSS salary base: persisted Payslip.sbi.
- Capped CNSS base: min(sbi, 6000).

Employer CNSS components reuse calculateCNSSPatronale(sbi):

- Family allowance: 6.40% of uncapped SBI.
- Social benefits: 8.98% of capped SBI.
- Professional training: 1.60% of uncapped SBI.

The CNSS transfer statement combines employee CNSS with employer social benefits for the 13.46% prestations row, matching the supplied PDF arithmetic.

The supplied PDF uses 1.85% AMO participation and 2.2600% for both AMO salary and employer rows. The statement therefore uses the supplied administrative rate for the employer AMO row while preserving the persisted payslip employee AMO amount.

This is intentionally documented because the current payroll engine AMO_RULES defines employer AMO as 4.11%. Changing that payroll rule was outside the reporting feature and would alter existing payroll results.

## Rounding and reconciliation

Amounts are rounded to two decimal places at report-row level. Totals are calculated from the generated report rows and rounded consistently.

The CNSS transfer total is calculated from its component totals. Therefore, the known one-cent difference between the employee detail total and the transfer summary is not artificially corrected.

## PDF

The combined PDF contains:

1. Landscape employee-level CNSS table.
2. Portrait CNSS transfer summary.

The dedicated AMO PDF is a portrait A4 statement with the reference's three AMO rows. The PDF renderer uses a fixed A4 corporate header/footer, bounded cell text, alternating rows, a highlighted total row, and real pagination with repeated detail headers. It also keeps the footer within PDFKit's printable bottom margin so footer text cannot create accidental blank pages.

The PDF includes company name, generation date, CNSS affiliation number, selected period, administrative headings, contribution tables, and totals.

## Validation performed

- Confirmed the reference PDF has three A4 pages.
- Extracted and compared its CNSS employee columns and summary arithmetic.
- Reused the existing payslip uniqueness constraint.
- Scoped all payslip queries through the active company.
- Verified JavaScript syntax with node --check.
- Rendered a representative 24-employee PDF, verified it contains three pages (two detail pages plus the transfer page), and visually inspected the rasterized output.
- Rendered and visually inspected a representative AMO PDF, confirming one portrait A4 page with all three sections and reconciled total.
- Verified the EJS template compiles successfully.
- Verified git diff --check.

## Limitations and assumptions

- The supplied PDF was not generated from the current workspace database, so its sample employee values are not hardcoded.
- AMO follows the supplied reference statement rates: participation 1.85%, employee 2.2600%, and employer 2.2600%. The existing payroll engine's employer AMO rule is not changed by the report.
- The requested 8.28% rate is a PREST. PAT. rate and has no corresponding AMO row in the reference's three-row AMO statement. It is therefore not applied to AMO or silently substituted for an AMO rate; applying it would require an explicit change to the CNSS/business-rule specification.
- The PDF renderer reproduces the reference's structure and column organization using the application's existing PDFKit convention; exact font metrics may differ from the PDF24-produced source document.

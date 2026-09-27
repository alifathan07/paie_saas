# `ai_built_in_rules`

## Purpose

These are built-in Moroccan payroll and payslip rules for the application.

The AI MUST treat these rules as system constraints when generating, modifying, reviewing, or explaining payroll and payslip logic.

These rules are based on the Moroccan payroll bulletin requirements described by Humantal's 2026 guide, referencing Articles 370–375 of the Moroccan Labour Code.

---

## 1. Payslip Requirement

Every salary payment must generate a payslip.

The payslip must be clear, understandable, and contain the required payroll information.

The payslip must represent the actual payroll calculation for the employee and pay period.

Never generate a payslip containing fabricated, missing, or unexplained payroll values.

---

## 2. Employer Information

The payslip must contain:

* Company legal name / denomination
* Company address
* CNSS affiliation number
* Tax identification number (IF)
* ICE

These values must come from the company's stored information.

The AI MUST NOT invent these values.

If required company information is missing, the system should identify the missing field rather than fabricate it.

---

## 3. Employee Information

The payslip must contain:

* Employee first name
* Employee last name
* Internal employee number / matricule
* CNSS registration number
* Position / employment
* Qualification when available
* Employment start date

These values must come from the employee record.

---

## 4. Payroll Period and Working Time

The payslip must identify:

* Payroll period
* Number of days worked
* Number of normal hours paid
* Overtime hours
* Overtime applicable increase rate
* Night hours when applicable
* Public holidays worked when applicable

Working-time information must correspond to the payroll calculation.

Do not display working-time values that were not actually used or recorded.

---

## 5. Earnings

The payslip must distinguish individual earning components.

Supported earning categories include:

### Base salary

The employee's contractual/base salary.

### Seniority bonus

Prime d'ancienneté must be represented separately when applicable.

### Overtime

Overtime must show:

* Number of hours
* Applicable rate / increase
* Calculated amount

### Bonuses and gratuities

Examples:

* Performance bonus
* Attendance bonus
* Other taxable bonuses

Each bonus should appear as its own payroll line where practical.

### Allowances / indemnities

Examples:

* Transport
* Meal / panier
* Housing
* Other applicable indemnities

The system must preserve the fiscal/social treatment of each allowance.

### Benefits in kind

Benefits in kind must be represented and valued when applicable.

---

## 6. Payroll Line Structure

Every payroll line should have enough information to explain the calculation.

Preferred structure:

* Label
* Category
* Base
* Rate / quantity
* Earnings
* Deduction
* Taxable status
* CNSS status
* AMO status
* IR status

Never hide a material payroll component inside a generic total.

---

## 7. Employee Deductions

The payslip must separately identify applicable employee deductions.

Possible deductions include:

* CNSS employee contribution
* AMO employee contribution
* Income tax (IR)
* Complementary retirement contribution such as CIMR
* Advances
* Loans
* Wage garnishments
* Other authorized deductions

Only applicable deductions should appear.

---

## 8. CNSS

For the 2026 rules represented by this source:

* Employee CNSS rate: 4.48%
* CNSS monthly contribution base ceiling: 6,000 MAD

The CNSS calculation must respect the applicable ceiling.

Example:

For a CNSS-eligible salary above 6,000 MAD:

`CNSS Base = MIN(CNSS Eligible Base, 6000)`

`Employee CNSS = CNSS Base × 4.48%`

The payslip should show CNSS as an employee deduction.

---

## 9. AMO

For the 2026 rules represented by this source:

* Employee AMO rate: 2.26%
* Employer AMO rate: 4.11%
* AMO has no salary ceiling according to the source.

Employee AMO must be calculated separately from CNSS.

The employee's AMO contribution appears as a deduction.

The employer contribution must NOT be deducted from the employee's net salary.

---

## 10. Income Tax (IR)

IR must be calculated from the applicable taxable income / RNI according to the applicable Moroccan tax rules.

The source describes the following 2026 monthly RNI brackets:

| Monthly RNI             | Rate |    Deduction |
| ----------------------- | ---: | -----------: |
| 0 – 2,500 MAD           |   0% |            0 |
| 2,501 – 4,166.67 MAD    |  10% |      250 MAD |
| 4,166.68 – 5,000 MAD    |  20% |   666.67 MAD |
| 5,000.01 – 6,666.67 MAD |  30% | 1,166.67 MAD |
| 6,666.68 – 15,000 MAD   |  34% | 1,433.33 MAD |
| > 15,000 MAD            |  37% | 1,883.33 MAD |

The source also describes:

* Family deduction: 30 MAD/month per dependent
* Maximum 6 dependents
* Certain housing-loan interest deductions subject to conditions
* Eligible complementary retirement contributions such as CIMR

IMPORTANT:

Tax rules must be implemented as versioned configuration/rules, not hardcoded throughout the application.

The AI must not assume that a tax rate or threshold remains permanently valid.

---

## 11. Professional Expenses

The source describes professional expenses as:

`20% of applicable income`

with:

`Maximum deduction = 2,500 MAD/month`

The exact eligibility and treatment must be controlled by the payroll rules configuration.

Do not apply the deduction blindly to every payroll component.

---

## 12. Gross Salary

The payslip must provide a clear gross salary total.

Conceptually:

`Gross Salary = Sum of applicable earning components`

The system must distinguish between:

* Gross salary
* Taxable gross salary
* Social-security contribution bases
* Net taxable income
* Net salary

These values are NOT interchangeable.

---

## 13. Net Salary

The payslip must display the final amount payable to the employee.

Basic structure:

`Net Salary = Gross Salary - Employee Deductions`

Employee deductions may include:

* CNSS
* AMO
* IR
* CIMR
* Advances
* Loans
* Other authorized deductions

Employer contributions must never be subtracted from the employee's net salary.

---

## 14. Leave Balance

The payslip should contain paid-leave information:

* Leave acquired
* Leave taken
* Remaining balance

Example:

`Acquired: 18 days`

`Taken: 5 days`

`Remaining: 13 days`

Only use actual employee leave data.

Never invent leave balances.

---

## 15. Payment Information

The payslip must identify the payment method where applicable:

* Bank transfer
* Cheque
* Cash

The payment method must come from the payroll/payment record.

---

## 16. Payslip Totals

The bottom of the payslip must clearly display:

* Total gross salary
* Total employee deductions
* Net salary payable

The totals must reconcile mathematically.

Required invariant:

`Net Salary = Gross Salary - Total Employee Deductions`

Any discrepancy must be treated as a payroll calculation error.

---

## 17. Employer Contributions

Employer contributions are payroll costs and must be separated from employee deductions.

They must not reduce:

* Gross salary
* Employee net salary

Where employer contributions are displayed, they should be clearly labelled as employer-paid contributions.

---

## 18. Payroll Transparency

Every important amount on the payslip should be traceable to:

`Employee Data → Payroll Input → Payroll Rule → Calculation → Payslip Line`

The system should make it possible to explain how a final amount was obtained.

The AI must prefer explicit calculation components over unexplained totals.

---

## 19. No Fabrication Rule

The AI MUST NEVER invent:

* CNSS numbers
* IF
* ICE
* Employee identifiers
* Salary amounts
* Tax rates
* Contribution rates
* Legal thresholds
* Working hours
* Leave balances
* Payment information

If required information is unavailable, explicitly identify the missing information.

---

## 20. Legal Rule Versioning

Payroll regulations can change.

Therefore:

* Tax rates must be versioned.
* CNSS rules must be versioned.
* AMO rules must be versioned.
* Thresholds must be versioned.
* Legal calculation rules must have an effective date.
* Historical payroll runs must retain the rules applicable to their payroll period.

Never silently replace historical rules with current rules.

---

## 21. AI Development Rules

When modifying payroll functionality:

1. Inspect the existing payroll architecture first.
2. Identify the affected payroll rules.
3. Do not modify legal calculation logic without identifying the rule being changed.
4. Keep payroll calculations deterministic.
5. Keep calculation rules separate from controllers, routes, UI, and database access.
6. Prefer configuration-driven rules for rates, ceilings, thresholds, and effective dates.
7. Add or update tests for every payroll-rule change.
8. Verify mathematical reconciliation.
9. Never silently change an existing payroll calculation.
10. Explain the impact of legal-rule changes before implementing them.

---

## 22. Source Priority

The Humantal article is a secondary reference.

For production legal compliance, official Moroccan sources must take precedence, including:

* Moroccan Labour Code
* Official Bulletin / SGG
* DGI
* CNSS
* Ministry of Labour

If a secondary source conflicts with an official source, the official source wins.

---

## 23. Important Implementation Principle

These rules describe the **payslip requirements and payroll-domain constraints**.

They must NOT become one giant calculation function.

Recommended separation:

`rules/`
→ Legal rules and versioned configuration

`calculators/`
→ Pure payroll calculations

`services/`
→ Payroll orchestration

`repositories/`
→ Database access

`payslip/`
→ Payslip data preparation and rendering

`tests/`
→ Payroll and compliance tests

The AI must preserve this separation when modifying the application.
# Global Language Rule

## Language: French

The entire payroll application MUST be in French.

This applies to:

* User interface
* Dashboard
* Forms
* Buttons
* Labels
* Tables
* Employee information
* Payroll terminology
* Payslips
* Notifications
* Validation messages
* Error messages shown to users
* Success messages
* Reports
* PDF documents
* Payroll explanations
* Help text
* Tooltips
* Empty states
* Confirmation dialogs

All payroll-domain terminology MUST use standard French terminology used in Moroccan payroll.

Examples:

* Employee → Employé
* Employer → Employeur
* Base salary → Salaire de base
* Gross salary → Salaire brut
* Gross taxable salary → Salaire brut imposable (SBI)
* Seniority bonus → Prime d'ancienneté
* Taxable bonus → Prime imposable
* Non-taxable bonus → Prime non imposable
* CNSS employee contribution → Part salariale CNSS
* CNSS employer contribution → Part patronale CNSS
* AMO → AMO
* Income tax → Impôt sur le revenu (IR)
* Net salary → Salaire net
* Payslip → Bulletin de paie
* Payroll → Paie
* Employee number → Matricule
* Leave → Congé
* Paid leave → Congé payé
* Payment method → Mode de paiement

### Code Language

Code identifiers MAY remain in English when appropriate for programming conventions.

For example:

* `calculateGrossSalary()`
* `calculateCNSS()`
* `employeeId`
* `payrollRun`

However, all user-facing text MUST be French.

### Database

Database table and field names may remain in English if that is the established project convention.

Do not rename existing technical identifiers solely to translate them.

### AI Responses

When working on this payroll application, the AI should communicate with the developer in English unless the developer explicitly requests French.

However, any text intended to appear inside the application MUST be written in French.

### No Mixed User Interface

Do not create interfaces mixing French and English.

Bad:

`Ajouter Employee`

Good:

`Ajouter un employé`

Bad:

`Employee not found`

Good:

`Employé introuvable`

Bad:

`Save Payroll`

Good:

`Enregistrer la paie`

### Moroccan Context

French terminology should be appropriate to the Moroccan payroll context.

Do not mechanically translate English payroll terminology when an established French payroll term exists.

When uncertain about a payroll/legal term, preserve the official French terminology used by the relevant Moroccan authority or legal source.

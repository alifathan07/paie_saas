# Skill — Moroccan Payroll & Payslip Calculation Engine

## 1. Purpose

This skill defines the exact business logic for calculating a Moroccan employee payslip (`Bulletin de paie`).

The AI MUST follow these rules exactly when modifying, creating, reviewing, or debugging payroll calculation code.

The payroll calculation is structured as a step-by-step "Carte Mentale":

```text
SBG
 ↓
SBI
 ↓
CNSS + AMO + Frais Professionnels
 ↓
SNI
 ↓
Cumulative / Annualized IR
 ↓
IR Brut
 ↓
Charges de Famille
 ↓
IR Net
 ↓
Net à Payer
```

Do NOT invent alternative payroll formulas.

Do NOT change the business rules unless explicitly instructed.

---

# 2. Payslip Database Model

The main database entity is:

```prisma
model Payslip {
  id         Int @id @default(autoincrement())
  employeeId Int

  month      Int // 1 - 12
  year       Int // e.g. 2026

  workedDays Int @default(26)

  // Money amounts
  baseSalary      Decimal @db.Decimal(12, 2)
  primeAnciennete Decimal @default(0.00) @db.Decimal(12, 2)
  bonusesIMP      Decimal @default(0.00) @db.Decimal(12, 2)
  bonusesNIMP     Decimal @default(0.00) @db.Decimal(12, 2)

  sbg             Decimal @db.Decimal(12, 2)
  sbi             Decimal @db.Decimal(12, 2)

  cnss            Decimal @db.Decimal(12, 2)
  amo             Decimal @db.Decimal(12, 2)
  fraisPro        Decimal @db.Decimal(12, 2)

  sni             Decimal @db.Decimal(12, 2)

  // Cumulative IR
  sniCumule       Decimal @default(0.00) @db.Decimal(14, 2)
  moisEcoules     Int
  sniAnnuelEstime Decimal @default(0.00) @db.Decimal(14, 2)
  irAnnuelEstime  Decimal @default(0.00) @db.Decimal(14, 2)
  irCumule        Decimal @default(0.00) @db.Decimal(14, 2)
  irPrecedent     Decimal @default(0.00) @db.Decimal(14, 2)

  irNet           Decimal @default(0.00) @db.Decimal(12, 2)
  irBrut          Decimal @db.Decimal(12, 2)

  chargesDeFamille Decimal @default(0.00) @db.Decimal(12, 2)

  netAPayer       Decimal @db.Decimal(12, 2)

  // Rates
  cnssRate        Decimal? @db.Decimal(6, 4)
  amoRate         Decimal? @db.Decimal(6, 4)
  fraisProRate    Decimal? @db.Decimal(6, 4)
  irRate          Decimal? @db.Decimal(6, 4)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  employee Employee @relation(fields: [employeeId], references: [id], onDelete: Cascade)

  bonuses PayslipBonus[]

  @@unique([employeeId, month, year])
  @@index([employeeId])
  @@map("payslips")
}
```

The schema already contains the required fields.

**Do NOT add additional fields unless explicitly requested.**

---

# 3. Step 1 — Salaire Brut Global (SBG)

SBG represents all remuneration earned by the employee before deductions.

Formula:

```text
SBG =
Salaire de base
+ Primes
+ Indemnités imposables
+ Indemnités non imposables
```

In the current model, the relevant components include:

```text
baseSalary
primeAnciennete
bonusesIMP
bonusesNIMP
```

Therefore, conceptually:

```text
SBG = baseSalary
    + primeAnciennete
    + bonusesIMP
    + bonusesNIMP
```

Important:

Non-imposable amounts can still be part of SBG.

They are removed later when calculating SBI.

---

# 4. Step 2 — Salaire Brut Imposable (SBI)

SBI is the taxable gross salary.

Formula:

```text
SBI =
SBG
- Indemnités non imposables / exonérées
```

Example:

```text
SBG = 10,000 DH
Non-imposable indemnities = 500 DH

SBI = 10,000 - 500
    = 9,500 DH
```

The code must respect the applicable legal exemption limits when determining whether an indemnity is actually non-taxable.

Do NOT simply remove every amount classified as "non-imposable" without applying the applicable exemption rules.

---

# 5. Step 3 — CNSS

Employee CNSS contribution:

```text
CNSS =
min(SBI, 6,000)
× 4.48%
```

Therefore:

```text
CNSS base = min(SBI, 6000)
CNSS = CNSS base × 0.0448
```

Maximum employee CNSS:

```text
6,000 × 4.48%
= 268.80 DH
```

Examples:

```text
SBI = 5,000

CNSS = 5,000 × 4.48%
     = 224 DH
```

and:

```text
SBI = 10,000

CNSS = 6,000 × 4.48%
     = 268.80 DH
```

CNSS must therefore NEVER exceed:

```text
268.80 DH
```

under this rule.

---

# 6. Step 3 — AMO

Employee AMO contribution:

```text
AMO = SBI × 2.26%
```

There is no salary ceiling for this calculation in this business logic.

Therefore:

```text
AMO = SBI × 0.0226
```

Example:

```text
SBI = 10,000

AMO = 10,000 × 2.26%
    = 226 DH
```

---

# 7. Step 3 — Frais Professionnels

Frais Professionnels are a fiscal deduction.

They reduce the taxable income used to calculate IR.

They are NOT a cash deduction from the employee's gross salary in the final Net à Payer formula.

Rules:

### Annual gross taxable income threshold

If annual gross taxable income does not exceed:

```text
78,000 DH/year
```

use:

```text
35%
```

Otherwise:

```text
25%
```

Maximum monthly deduction:

```text
2,916.67 DH/month
```

Maximum annual deduction:

```text
35,000 DH/year
```

Therefore:

```text
Frais Pro =
min(SBI × applicable rate, 2,916.67)
```

The annual threshold is approximately:

```text
78,000 / 12 = 6,500 DH/month
```

but the business rule is defined using the annual threshold.

---

# 8. Step 4 — Salaire Net Imposable (SNI)

SNI is the base used for IR calculation.

Formula:

```text
SNI =
SBI
- CNSS
- AMO
- Frais Professionnels
```

Example:

```text
SBI       = 10,000
CNSS      =    268.80
AMO       =    226.00
Frais Pro =  2,500.00

SNI = 10,000
    - 268.80
    - 226.00
    - 2,500.00

SNI = 7,005.20 DH
```

---

# 9. IR — IMPORTANT: Monthly Payment, Annualized/Cumulative Calculation

The Moroccan IR is withheld monthly, but the calculation must account for the employee's income over the year.

This is especially important when salary changes during the year.

The system therefore maintains cumulative and annual-estimation fields.

The relevant fields are:

```text
sniCumule
moisEcoules
sniAnnuelEstime
irAnnuelEstime
irCumule
irPrecedent
irBrut
chargesDeFamille
irNet
```

---

# 10. sniCumule

`sniCumule` represents the total SNI from January through the current month.

Formula:

```text
sniCumule =
SNI January
+ SNI February
+ ...
+ SNI current month
```

Example:

```text
January = 9,000
February = 9,000

February sniCumule =
9,000 + 9,000
= 18,000 DH
```

If salary changes:

```text
January = 9,000
February = 9,000
March   = 10,000
April   = 12,000
May     = 12,000
```

Then in May:

```text
sniCumule =
9,000
+ 9,000
+ 10,000
+ 12,000
+ 12,000

= 52,000 DH
```

---

# 11. moisEcoules

`moisEcoules` is the number of months elapsed in the payroll calculation.

For normal monthly payroll:

```text
January   = 1
February  = 2
March     = 3
April     = 4
...
December  = 12
```

This value is used for annualizing the cumulative SNI.

---

# 12. sniAnnuelEstime

The annual estimated SNI projects the cumulative SNI over a full 12-month period.

Formula:

```text
sniAnnuelEstime =
sniCumule × 12 ÷ moisEcoules
```

Example — February:

```text
sniCumule = 18,000
moisEcoules = 2

sniAnnuelEstime =
18,000 × 12 ÷ 2

= 108,000 DH
```

This is an estimate of the employee's annual SNI based on the income observed so far.

---

# 13. IR Annual Estimate

`irAnnuelEstime` is calculated by applying the Moroccan progressive IR tax schedule to the estimated annual taxable income.

Conceptually:

```text
irAnnuelEstime =
ProgressiveIR(sniAnnuelEstime)
```

The progressive tax schedule must be kept separate from the cumulative mechanics.

Do NOT replace the progressive calculation with a single flat rate.

The applicable tax brackets/rates and deductible amounts must come from the configured/current Moroccan IR rules used by the application.

---

# 14. irCumule

`irCumule` represents the amount of IR that should have been withheld cumulatively from January through the current month.

The monthly withholding is calculated by allocating the estimated annual IR across the elapsed months:

```text
irCumule =
irAnnuelEstime × moisEcoules ÷ 12
```

Example — February:

```text
irAnnuelEstime = 11,084.44
moisEcoules = 2

irCumule =
11,084.44 × 2 ÷ 12

= 1,847.41 DH
```

IMPORTANT:

`irCumule` is NOT the IR for February alone.

It represents the total IR due from January through February.

---

# 15. irPrecedent

`irPrecedent` represents the IR that has already been actually withheld before the current month.

It is NOT simply the previous month's `irCumule`.

Example:

```text
January IR actually withheld = 457.56 DH
```

Then for February:

```text
irPrecedent = 457.56 DH
```

Conceptually:

```text
irPrecedent =
sum of actual IR retained on previous payslips
```

This distinction is critical.

---

# 16. Current Month IR Before Family Charges

The current month's IR withholding is obtained by comparing cumulative IR due with IR already withheld.

Formula:

```text
IR current month =
irCumule
- irPrecedent
```

Example:

```text
irCumule    = 1,847.41
irPrecedent =   457.56

IR February =
1,847.41 - 457.56

= 1,389.85 DH
```

This is the amount that should be considered for the current month's IR calculation before applying the current month's family-charge deduction.

---

# 17. IR Brut

The application must distinguish between:

```text
IR annual estimated
IR cumulative
IR current month
IR brut
IR net
```

Do NOT treat these values as interchangeable.

The exact implementation should preserve the meaning of each database field.

`irBrut` represents the IR before family-charge deduction for the current payslip according to the application's final monthly calculation.

The cumulative calculation is used to determine the current month's withholding.

---

# 18. Charges de Famille

Family charges are deducted AFTER calculating IR Brut.

Rule:

```text
50 DH/month/person
```

Maximum:

```text
6 persons
```

Therefore:

```text
maximum =
6 × 50
= 300 DH/month
```

Formula:

```text
chargesDeFamille =
min(nombrePersonnesACharge × 50, 300)
```

Examples:

```text
0 dependents → 0 DH
1 dependent   → 50 DH
2 dependents  → 100 DH
3 dependents  → 150 DH
4 dependents  → 200 DH
5 dependents  → 250 DH
6 dependents  → 300 DH
7 dependents  → 300 DH
```

The deduction occurs AFTER IR Brut.

---

# 19. IR Net

Formula:

```text
IR Net =
IR Brut
- Charges de Famille
```

The result should not become negative.

Therefore the implementation should ensure:

```text
IR Net >= 0
```

Conceptually:

```text
irNet = max(irBrut - chargesDeFamille, 0)
```

---

# 20. Net à Payer

The final salary actually paid to the employee is:

```text
Net à Payer =
SBG
- CNSS
- AMO
- IR Net
```

IMPORTANT:

Frais Professionnels are NOT subtracted here.

Why?

Because Frais Professionnels are a fiscal deduction used to calculate SNI.

They are not an amount actually withheld from the employee.

Therefore DO NOT calculate:

```text
SBG
- CNSS
- AMO
- Frais Pro
- IR
```

That would incorrectly deduct Frais Pro twice conceptually.

Correct:

```text
netAPayer =
SBG
- CNSS
- AMO
- irNet
```

---

# 21. Complete Mental Model

The entire calculation must be understood as:

```text
                SALARY
                   │
                   ▼
        ┌────────────────────┐
        │ SBG                │
        │ Gross Global       │
        └─────────┬──────────┘
                  │
                  │ - non-taxable amounts
                  ▼
        ┌────────────────────┐
        │ SBI                │
        │ Gross Taxable      │
        └─────────┬──────────┘
                  │
          ┌───────┼────────┐
          │       │        │
          ▼       ▼        ▼
        CNSS     AMO    Frais Pro
          │       │        │
          └───────┼────────┘
                  ▼
        ┌────────────────────┐
        │ SNI                │
        │ Net Taxable        │
        └─────────┬──────────┘
                  │
                  ▼
        CUMULATIVE / ANNUAL IR
                  │
                  ▼
        ┌────────────────────┐
        │ IR Brut            │
        └─────────┬──────────┘
                  │
                  │ - family charges
                  ▼
        ┌────────────────────┐
        │ IR Net             │
        └─────────┬──────────┘
                  │
                  ▼
        ┌────────────────────┐
        │ Net à Payer        │
        └────────────────────┘
```

---

# 22. Critical Rules for Salary Changes

The employee's salary can change during the year.

The calculation MUST NOT assume that the current month's salary is the same as January's salary.

Example:

```text
January = 9,000
February = 9,000
March = 10,000
April = 12,000
May = 12,000
```

For May:

```text
sniCumule =
January SNI
+ February SNI
+ March SNI
+ April SNI
+ May SNI
```

Then:

```text
sniAnnuelEstime =
sniCumule × 12 ÷ 5
```

Then:

```text
irAnnuelEstime =
ProgressiveIR(sniAnnuelEstime)
```

Then:

```text
irCumule =
irAnnuelEstime × 5 ÷ 12
```

Then:

```text
IR current month =
irCumule
- irPrecedent
```

This allows the system to adjust the current month's withholding when the employee's salary changes.

---

# 23. Database Field Meaning — Strict Definitions

Never confuse these fields:

### `sni`

SNI for the current month.

```text
Current month's SNI
```

### `sniCumule`

SNI accumulated from January through current month.

```text
Σ monthly SNI from January
```

### `moisEcoules`

Number of elapsed payroll months.

```text
January = 1
February = 2
...
December = 12
```

### `sniAnnuelEstime`

Projected annual SNI.

```text
sniCumule × 12 ÷ moisEcoules
```

### `irAnnuelEstime`

Estimated full-year IR calculated using the progressive IR schedule.

### `irCumule`

Cumulative IR that should have been withheld through the current month.

```text
irAnnuelEstime × moisEcoules ÷ 12
```

### `irPrecedent`

Actual IR already withheld before the current month.

```text
Σ previous payslips' actual IR
```

### `irBrut`

Current payslip's IR before family-charge deduction.

### `chargesDeFamille`

Current month's family-charge deduction.

```text
min(dependents × 50, 300)
```

### `irNet`

Actual current-month IR after family charges.

```text
max(irBrut - chargesDeFamille, 0)
```

### `netAPayer`

Final salary paid to employee.

```text
SBG - CNSS - AMO - IR Net
```

---

# 24. Implementation Rules

When modifying the code:

1. Inspect the existing payroll calculation first.
2. Do NOT rewrite the entire payroll engine unnecessarily.
3. Modify one calculation step at a time.
4. Preserve existing business logic that is not related to the requested change.
5. Use Decimal-safe arithmetic for monetary values.
6. Round monetary results consistently to 2 decimal places.
7. Do not use JavaScript floating-point arithmetic carelessly for financial calculations.
8. Do not calculate cumulative IR using only the current month's salary.
9. Always consider previous payslips for cumulative calculations.
10. `irPrecedent` must represent actual previously retained IR.
11. Do not confuse `irCumule` with the current month's IR.
12. Do not deduct Frais Professionnels from Net à Payer.
13. Family charges are applied after IR Brut.
14. Family charges cannot exceed 300 DH/month.
15. CNSS cannot exceed 268.80 DH under the defined rule.
16. AMO has no ceiling under the defined rule.
17. The IR calculation must use progressive tax brackets.
18. Never silently invent a tax bracket or legal threshold.
19. If a tax rule is ambiguous or missing, stop and ask rather than inventing it.
20. Do not modify the Prisma schema unless explicitly requested.

---

# 25. Order of Implementation

When implementing the calculation in code, follow this order:

```text
STEP 1
Calculate SBG

STEP 2
Calculate SBI

STEP 3
Calculate CNSS

STEP 4
Calculate AMO

STEP 5
Calculate Frais Professionnels

STEP 6
Calculate SNI

STEP 7
Retrieve previous payslips

STEP 8
Calculate sniCumule

STEP 9
Calculate moisEcoules

STEP 10
Calculate sniAnnuelEstime

STEP 11
Calculate irAnnuelEstime using progressive IR

STEP 12
Calculate irCumule

STEP 13
Calculate irPrecedent

STEP 14
Calculate current-month IR

STEP 15
Calculate IR Brut

STEP 16
Calculate charges de famille

STEP 17
Calculate IR Net

STEP 18
Calculate Net à Payer

STEP 19
Save all calculation components to Payslip
```

---

# 26. Golden Rule

The AI must always think of the payslip as:

```text
SBG
→ SBI
→ Contributions / Fiscal deductions
→ SNI
→ Annualized cumulative IR
→ Current month's IR
→ Family charges
→ IR Net
→ Net à Payer
```

The objective is NOT simply to calculate a monthly salary.

The objective is to calculate the employee's **correct monthly withholding while maintaining the correct cumulative/annual IR position throughout the year**.

The payroll engine must therefore remain consistent from January through December, including cases where:

* salary changes,
* bonuses change,
* taxable/non-taxable indemnities change,
* CNSS/AMO amounts change,
* the employee's taxable income changes,
* family charges apply,
* previous IR withholding must be taken into account.

Always preserve the distinction between:

```text
MONTHLY
CUMULATIVE
ANNUAL ESTIMATE
ACTUAL WITHHOLDING
```

These are not the same thing.

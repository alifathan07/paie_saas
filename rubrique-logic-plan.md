# Plan: company-managed rubrique codes

## Goal

The company must decide the rubrique code shown on the bulletin.

This must work for fixed payroll lines such as:

- Base salary
- Seniority bonus
- Taxable gross salary
- CNSS
- AMO
- CIMR
- Income tax (IR)
- Salary advance
- Professional expenses
- Taxable net salary
- Rounding
- Net salary to pay

Catalog items already have a code in `Bonus.code`. This includes taxable primes and non-taxable indemnities. Their code should also be shown on the bulletin.

The final rule should be simple:

> Every bulletin line gets its displayed rubrique from the active company configuration or from its company catalog item. No payroll display code is hardcoded in a view, PDF, controller, or payroll engine.

## Important business split

There are three different kinds of bulletin elements. They should not be mixed:

1. **Fixed calculated earnings and totals**: base salary, seniority, taxable gross salary, taxable net salary, and net salary. The payroll rules calculate these values. The company only chooses the code shown on the bulletin.
2. **Fixed deductions / withholdings**: CNSS, AMO, CIMR, IR, salary advance, and similar deductions. The payroll rules already calculate these values. The company only chooses the code shown on the bulletin.
3. **Company-added taxable lines**: overtime 25%, overtime 50%, overtime 100%, paid leave, salary back pay, and other taxable additions. These are added for an employee or for one bulletin. They need a company catalogue with a code, label, and amount or calculation behavior.

The third group must never become part of the fixed salary or deduction tables. Its amount is added to the taxable gross calculation as a separate taxable earning line.

## What exists today

The codebase already has `BulletinRubrique` and a settings form. However, it is not company-scoped:

- `BulletinRubrique` has only `name` and `code`.
- `name` is globally unique.
- `listBulletinRubriques()` does not receive a company ID.
- `updateBulletinRubriques()` can change the same rows for every company.
- The seed data is global.

There is also a `RubriqueImposable` table. It is currently global and not connected to the active bulletin flow. It is the right concept for the company-added taxable catalogue, but it must be redesigned and connected before it is used.

Some codes are already read from `rubriqueCodes`, but many fallbacks remain hardcoded:

| Bulletin element | Current code source |
|---|---|
| Salaire de base | Configured value, fallback `10001` |
| Prime d'ancienneté | Configured value, fallback `1002` |
| Salaire brut imposable | Configured value, fallback `RUB-3001` |
| Salaire net à payer | Configured value, fallback `RUB-4001` |
| Representation indemnity | Hardcoded `1003` in `PayrollEngine` |
| AMO | Hardcoded `196` in the PDF |
| CNSS | Hardcoded `197` in the PDF |
| CIMR | Hardcoded `199` in the PDF |
| IR | Hardcoded `198` in the PDF |
| Avance sur salaire | Hardcoded `400` in the PDF |
| Arrondi | Hardcoded `410` in the PDF |
| Prime or indemnity catalog lines | `Bonus.code` |

The HTML bulletin currently leaves some fixed codes empty, while the PDF gives them hardcoded values. This can produce different results between the screen and the PDF.

## Possible solutions

### Option 1: Keep one global rubrique table

Keep the current `BulletinRubrique` table and continue editing its codes from company settings.

This is the smallest change, but it is not correct for multiple companies. Changing one company would change every company. I do not recommend this.

### Option 2: Store all codes in a JSON field on Company

Add something like `company.rubriqueCodes` as JSON.

This is easy to start, but it makes validation, migrations, unique codes, reporting, and future rubrique management harder. It also makes the database less clear. I do not recommend this as the main design.

### Option 3: Use a company-scoped rubrique table

Store one row per company and per fixed bulletin key. Use a stable internal key instead of using the French display name as the identity.

Example:

```text
companyId       12
key             base_salary
label           Salaire de base
code            10001
category        EARNING
active          true
```

This gives each company its own values, keeps the business identity stable, and makes the same code source available to the HTML bulletin and the PDF.

This is the recommended solution.

## Final solution

### 1. Make fixed rubriques company-scoped

Change the existing `BulletinRubrique` model into a company-owned configuration table.

Recommended fields:

```text
id          Int
companyId  Int
key         String       // stable technical identity
label       String       // visible French label
code        String       // company-defined rubrique
category    String       // EARNING, DEDUCTION, SUMMARY, OTHER
active      Boolean
createdAt   DateTime
updatedAt   DateTime
```

Recommended constraints:

```text
unique(companyId, key)
unique(companyId, code)
index(companyId)
```

The `key` must never depend on a translated label. For example, use `base_salary`, not `Salaire de base`.

### 2. Use a fixed key registry

Create one central registry in the rubrique service. It is a list of supported fixed bulletin elements, not a list of company codes.

Initial keys:

```text
base_salary
seniority_bonus
taxable_gross_salary
cnss
amo
cimr
income_tax
salary_advance
professional_expenses
taxable_net_salary
rounding
net_salary
```

Only elements that are actually rendered as bulletin lines should be included. `TOTAUX`, table headers, and layout labels are not rubriques.

If overtime becomes a separate visible line later, add a new key such as `overtime` through a migration and the registry.

### 3. Seed defaults per company

When a company is created, create all required rubrique rows for that company.

For existing companies, add a migration or an idempotent backfill that creates missing rows only. Existing company-specific values must not be overwritten.

The current defaults can be used only as migration seed values:

```text
base_salary          10001
seniority_bonus      1002
taxable_gross_salary RUB-3001
cnss                 197
amo                  196
cimr                 199
income_tax           198
salary_advance       400
professional_expenses  (empty until the business decides a default)
taxable_net_salary   (empty until the business decides a default)
rounding             410
net_salary           RUB-4001
```

After migration, these values must come from the company rows. They must not remain as runtime fallbacks.

### 4. Fix the settings flow

The company settings page should load rows with the active company ID:

```text
listCompanyBulletinRubriques(companyId)
updateCompanyBulletinRubriques(companyId, rows)
```

The form should submit the stable row ID or key and the new code. The server must verify that every updated row belongs to the active company.

The page should clearly say:

> These rubrique codes are printed on this company's bulletins.

The page should show a warning for a missing code if the company has not configured one yet.

### 5. Use keys everywhere in the bulletin flow

Replace name-based lookup such as:

```js
rubriqueCodes['Salaire de base']
```

with key-based lookup such as:

```js
rubriqueCodes.base_salary
```

The service should return a map like:

```js
{
  base_salary: '10001',
  seniority_bonus: '1002',
  taxable_gross_salary: 'RUB-3001',
  net_salary: 'RUB-4001'
}
```

The bulletin controller should load this map using the active employee company. It should pass the same map to:

- The bulletin HTML view
- The PDF renderer
- Any live calculation response that displays a rubrique

This prevents the HTML and PDF from showing different codes.

### 6. Remove hardcoded fixed codes

The implementation should remove runtime fallback codes from:

- `src/views/bulletins/show.ejs`
- `src/pdf/bulletinPdf.js`
- `src/payroll-engine/PayrollEngine.js`
- Any bulletin controller that creates a fixed line

The payroll engine should stay calculation-focused. It should receive a `rubriqueCodes` context when it needs to create a line, for example for the representation indemnity.

For catalog lines:

- Taxable primes use `Bonus.code`.
- Non-taxable indemnities use `Bonus.code`.
- Representation uses the representation `Bonus.code` from the company catalog, not a hardcoded `1003`.

If a fixed code is missing, the system should show an empty code or a visible configuration warning. It should never silently use a hardcoded default after the migration.

### 7. Decide how catalog items relate to fixed rubriques

Do not copy every `Bonus` into the fixed rubrique table.

The two concepts are different:

- Fixed rubrique: a standard payroll calculation line owned by the payroll system.
- Bonus catalog item: a company-created prime or indemnity with its own code.

Both can appear on the same bulletin, but they should keep their own source of truth.

The representation indemnity is the only special case. It is already a catalog item, so its displayed code should come from its `Bonus.code`. The company fixed-rubrique table should not also contain a second representation row.

## Migration order

1. Add `companyId`, `key`, `label`, `category`, and `active` to the rubrique model.
2. Create company-scoped rows for every existing company.
3. Copy the current global codes into every company as migration defaults.
4. Add the company relation and unique constraints.
5. Update the rubrique service to require `companyId`.
6. Update the company settings controller and page.
7. Update bulletin controller data loading to use the employee's company.
8. Update the HTML bulletin and PDF to use the same key map.
9. Update the payroll engine representation line to receive the catalog code.
10. Remove hardcoded runtime fallbacks.
11. Keep the old `RubriqueImposable` table unused for now, then remove it in a later cleanup migration after confirming no production data depends on it.

## Validation and safety rules

- A user can only view or edit rubriques belonging to the active company.
- A rubrique code is required for a configured fixed line.
- Codes must be trimmed and limited to 64 characters.
- Codes must be unique inside one company.
- The same code may exist in another company.
- Changing a code affects future display and regenerated drafts according to the product rule; already issued historical bulletins should keep their saved line codes.
- A PDF and the HTML view for the same bulletin must receive the same rubrique map.

## Tests required after implementation

1. Company A changes `base_salary`; Company B keeps its old code.
2. Company A changes `cnss`; both HTML and PDF show the new code.
3. A missing code is shown as a configuration problem, not replaced by a hardcoded fallback.
4. A taxable prime displays `Bonus.code`.
5. A non-taxable indemnity displays `Bonus.code`.
6. Representation displays its catalog rubrique, including a custom rubrique entered by the company.
7. Updating a code does not change the payroll amount calculation.
8. Historical saved bulletin lines keep their saved codes when the company later changes its configuration.
9. A user cannot update another company's rubrique by changing a posted ID.

## Updated final solution

The following design supersedes the older single-table wording above.

### Table 1: fixed earning and summary rubrique codes

Use the company-scoped `BulletinRubrique` table for display-only codes for fixed earning and summary lines:

- `base_salary`
- `seniority_bonus`
- `taxable_gross_salary`
- `taxable_net_salary`
- `net_salary`

This table stores the code and label only. It does not store an amount and it does not contain payroll rules. The payroll engine already calculates these values.

### Table 2: fixed deduction / retenue rubrique codes

Create a separate company-scoped `RubriqueRetenue` table for fixed deductions:

- `cnss`
- `amo`
- `cimr`
- `income_tax`
- `salary_advance`
- `rounding`

Recommended fields:

```text
id, companyId, key, label, code, active, createdAt, updatedAt
```

Recommended constraints:

```text
unique(companyId, key)
unique(companyId, code)
```

This table is only for displaying the rubrique code. CNSS, AMO, CIMR, and IR rules remain in the current calculators. The table must never change the calculation.

### Table 3: company-added taxable rubrique catalogue

Use `RubriqueImposable` for lines that the company can add to an employee bulletin:

- Heures supplémentaires 25%
- Heures supplémentaires 50%
- Heures supplémentaires 100%
- Congé payé
- Rappel sur salaire
- Other taxable additions

Recommended fields:

```text
id
companyId
code
name
defaultAmount
entryType       // MANUAL_AMOUNT or CALCULATED
calculationKey  // optional: overtime_25, overtime_50, overtime_100, etc.
active
createdAt
updatedAt
```

Recommended constraints:

```text
unique(companyId, code)
unique(companyId, name)
index(companyId, active)
```

This table is a company catalogue. It does not directly represent one employee's monthly amount.

### How a taxable line enters one bulletin

The user selects or creates a `RubriqueImposable` in the bulletin, chooses the employee-specific amount, and the bulletin stores a snapshot line in the existing `PayslipBonus` table:

```text
payslipId
rubriqueImposableId  // nullable for old historical rows
code                 // snapshot of the catalogue code
name                 // snapshot of the catalogue label
amount               // employee/bulletin amount
taxable = true
```

The snapshot is important. If the company changes a catalogue label or code later, an already issued bulletin must keep the old printed value.

The existing `PayslipBonus` table is therefore reused for bulletin instances. No separate monthly transaction table is needed.

### Rules for overtime and similar calculated additions

For manual additions such as `Rappel sur salaire`, the user enters the amount.

For calculated additions such as overtime, the catalogue row contains a `calculationKey`. The payroll engine calculates the amount using the existing rule, then stores/displays the line with the catalogue code.

The rule and the rubrique are separate:

- `calculationKey` chooses the calculation.
- `code` chooses what is printed in the RUB column.
- The amount is added to taxable gross salary.

For example:

```text
calculationKey: overtime_25
code:          HS25
name:          Heures supplémentaires 25%
amount:        calculated by the overtime rule
```

### What must not be put in `RubriqueImposable`

Do not create company-added catalogue rows for:

- Salaire de base
- Prime d'ancienneté
- Salaire brut imposable
- CNSS
- AMO
- CIMR
- IR
- Salaire net à payer

These are fixed payroll elements. Their rules already exist. They only need a company-defined display code in the fixed earning, summary, or retenue table.

### Recommended implementation order

1. Make fixed `BulletinRubrique` rows company-scoped.
2. Add company-scoped `RubriqueRetenue` rows for fixed deductions.
3. Redesign the existing `RubriqueImposable` table with `companyId`, `defaultAmount`, `entryType`, `calculationKey`, and `active`.
4. Backfill every company with default fixed rows without overwriting existing values.
5. Backfill current taxable catalogue items into `RubriqueImposable` or create an explicit compatibility mapping from the current taxable `Bonus` rows.
6. Add `rubriqueImposableId` to `PayslipBonus` as an optional relation and preserve code/name snapshots.
7. Change the prime-add popup in the bulletin to use the company taxable catalogue.
8. Add the overtime and other calculation keys without putting their rules in the database.
9. Load fixed earning codes and retenue codes by company in the bulletin controller.
10. Pass the same code maps to the HTML view and PDF renderer.
11. Remove hardcoded runtime codes from the HTML, PDF, and payroll engine.
12. Add tests for company isolation, code display, calculated additions, and historical bulletin snapshots.

## Final decision

Use **three separate concerns**:

1. `BulletinRubrique`: fixed earning and summary display codes.
2. `RubriqueRetenue`: fixed deduction display codes only.
3. `RubriqueImposable`: company-created taxable additions, with optional calculation keys.

Reuse `PayslipBonus` for the actual taxable line saved on a bulletin, with a reference to the catalogue and a snapshot of its code and label.

This keeps payroll rules in the payroll engine, keeps fixed deductions display-only, lets companies create taxable additions, and prevents a later code change from rewriting historical bulletins.

No implementation should start until the exact fixed line list and the migration policy for existing taxable `Bonus` rows are confirmed. The architecture above is the solution to implement.

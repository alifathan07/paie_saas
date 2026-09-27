# Bulletins: developer guide

**Read time: about 3 minutes.** Start with the workflow below, then open the linked code when you need details.

## 1. Generate the month’s bulletins

Click **Traitement par liste** for the selected month and year.

1. Load the company’s active employees, including blocked employees.
2. Skip employees who already have a bulletin for that period.
3. Calculate payroll, then apply cumulative IR.
4. Save each new bulletin and its bonus lines in one transaction.
5. Show how many were created, skipped, or failed.

**Code:** `generateBulkBulletins` in [bulletins.controller.js](src/controllers/bulletins.controller.js).

## 2. Show only useful action buttons

The list checks the actual bulletin statuses before displaying each button:

| Button | Show it when… | What it does |
| --- | --- | --- |
| Traitement par liste | An employee has no bulletin | Creates missing bulletins |
| Valider par liste | A bulletin is draft/generated | Validates it and records who/when |
| Retourner en brouillon | A bulletin is validated | Returns it to draft and clears validation metadata |
| Clôturer le mois | A bulletin is not closed | Closes the month’s bulletins |

Generation, validation, and draft actions sit in the **period bar**. Closure sits in the **header**. Validation is green; draft is amber.

**Code:** [index.ejs](src/views/bulletins/index.ejs), plus `validateBulkBulletins`, `returnBulkBulletinsToDraft`, and `closeBulkBulletins` in the controller.

**One detail to know:** bulk closure already allowed any non-closed status. It does not require prior validation. Generation/validation target active employees; draft/closure target all matching company bulletins.

## 3. Generate zero payroll for blocked employees

When `blocageSaisiePaie` is enabled:

1. **Before calculation**, set payable inputs to zero: base, days, overtime, advances, bonuses, and indemnities.
2. Run the normal payroll engine. Its calculated current payroll amounts are zero.
3. Keep monthly IR at zero, even if previous months would normally cause a cumulative adjustment.
4. Save those zero values in the bulletin.

The employee’s contractual salary and earlier bulletins stay intact. Historical cumulative amounts and rates can remain nonzero; they are not current pay.

**Code:** the `payrollBlocked` branch in [PayrollEngine.js](src/payroll-engine/PayrollEngine.js), and `applyCumulativeIR` in the controller.

## 4. Edit working days directly in the list

The list now shows **Brut imposable (SBI)** instead of the old indemnity column, plus **Jours travaillés**.

Here is the complete edit flow:

```text
Type days → GET preview → update SBI and net pay in the row
Press Enter or leave the field → POST save → show “Enregistré”
```

- Days must be an integer from **0 to 26**.
- Typing waits 300 ms before requesting a preview.
- **Tab saves through the blur event.** Clicking outside also saves.
- Enter saves directly. There is no Save button.
- Blocked, validated, and closed bulletins cannot edit days.
- Older preview responses cannot overwrite newer results.
- Failed saves show an error and keep the edit marked unsaved.

**Code:** [bulletins-list.js](public/js/bulletins-list.js).

## 5. Understand what the server saves

Both requests use `updateBulletinWorkedDays`:

```text
GET  /bulletins/:id/worked-days   → preview only
POST /bulletins/:id/worked-days   → recalculate and save
Inputs: month, year, workedDays
```

The handler does this in order:

1. Validate the inputs.
2. Find the bulletin within the selected company and period.
3. Reject missing, locked, or blocked bulletins.
4. Load the bulletin’s **saved** base, bonuses, indemnities, overtime, and advances.
5. Change only the days input, then run the engine and cumulative IR calculation.
6. For POST, save the calculated fields while keeping the original status.

The key formula is:

```text
Effective base = saved base ÷ 26 × worked days
```

Saved bonus rows and the Employee record are preserved. The handler does not add today’s recurring bonuses again.

**Important distinction:** zero days alone can still leave bonuses or indemnities payable. A blocked employee has all payable inputs zeroed.

The write also rechecks status and blocking. If the bulletin became locked, it returns **409** instead of saving. This does not detect every possible simultaneous edit.

**Code:** `updateBulletinWorkedDays` and `buildPayslipData` in [bulletins.controller.js](src/controllers/bulletins.controller.js). Routes are in [bulletins.js](src/routes/bulletins.js), behind the existing period middleware.

## 6. Understand the detail page changes

In [show.ejs](src/views/bulletins/show.ejs):

- Month and year appear in the title.
- Payment date is removed.
- Dependents are displayed as a fixed value at the top.
- Working days are editable in the salary row.
- Retour is aligned left.
- Explicit font sizes in the final style block were increased by 2px.

In [show-bulletin.js](public/js/show-bulletin.js):

1. Editing days previews after 350 ms.
2. Amounts, contributions, seniority, and annual totals refresh.
3. Enter or blur saves through the same days-only endpoint.

**This automatic save applies to existing bulletins.** An unsaved bulletin still uses the existing preview flow. Days-only saving uses saved payroll inputs; it does not save other pending edits in the detail form. PDF generation was not changed.

## 7. Verify the behavior

Run the two new focused tests:

```bash
node test_blocked_payroll.js
node test_bulletin_worked_days.js
```

They check zero payroll, preview/save parity, preserved inputs, company scope, locks, and list rendering. Prisma calls are mocked: these are not live database tests.

Existing active-period, annual-total, and cumulative-IR checks also passed. One older `test_bulletin_period.js` run failed because an unmocked lookup required `DATABASE_URL`.

For a quick manual check:

1. Generate a missing bulletin.
2. Change its days from 26 to 13: confirm SBI/net update.
3. Press Tab, reload, and confirm 13 remains saved.
4. Change days again and press Enter.
5. Validate: confirm days become read-only and the validation button disappears when all are validated.
6. Generate a blocked employee’s next bulletin: confirm saved days, IR, and current pay are zero.

---

**Where to start debugging:** wrong amounts → engine/controller; save problems → `updateBulletinWorkedDays`; keyboard behavior → the page’s JavaScript; layout/buttons → its EJS template.

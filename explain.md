# Paie Train: How the Application Works

This document explains the application from the beginning: login, employee management, payroll calculation, bulletin generation, validation, and PDF download.

## 1. The Big Picture

The application is a payroll web application built with:

- **Node.js and Express**: the web server and routes.
- **EJS**: the HTML pages shown in the browser.
- **Prisma**: the database access layer.
- **MySQL**: the database.
- **PDFKit**: PDF generation.
- **Multer**: employee photo and document uploads.

The main business flow is:

```text
Login
  -> Company selected from the session
  -> Create or select an employee
  -> Enter monthly payroll information
  -> Preview the calculation
  -> Generate a monthly bulletin
  -> Validate the bulletin
  -> Download the PDF
```

There are two different kinds of information:

1. **Employee information**: long-term information such as name, contract, salary, CNSS, bank, and recurring bonuses.
2. **Monthly payroll information**: information that changes for a particular month, such as absences, overtime, advances, and monthly primes.

The employee record is reused every month. A payslip is a monthly snapshot.

## 2. Starting the Application

The main entry point is `index.js`.

It does the following:

1. Loads environment variables from `.env`.
2. Creates the Express application.
3. Serves files from `public/`.
4. Reads JSON and normal HTML form requests.
5. Configures EJS views from `src/views`.
6. Configures sessions using MySQL.
7. Registers authentication routes.
8. Protects the application routes with `middlewares/auth.js`.
9. Registers dashboard, employee, and bulletin routes.
10. Starts the server, normally on port `3000`.

The server is normally started with:

```bash
node index.js
```

The application needs two database-related configurations:

- `DATABASE_URL` is used by Prisma.
- The session store in `index.js` connects to MySQL on `localhost:3306`, database `paie`, user `root`, with an empty password in the current code.

These settings must match the local MySQL installation.

## 3. Login and Company Context

Authentication is handled by:

- `src/routes/auth.js`
- `src/controllers/auth.controller.js`
- `src/services/auth.service.js`
- `middlewares/auth.js`
- `src/lib/company.js`

The login process is:

1. The user opens the login page.
2. The user submits an email and password.
3. `auth.service.js` searches for the user and verifies the bcrypt password.
4. The controller stores the user in `req.session.user`.
5. The controller also stores or resolves the user's company.
6. Protected pages use this session to know which company is active.

If a route is protected, `middlewares/auth.js` checks that a user is logged in. If not, the user is sent back to login.

The company is important because employees and recurring bonus definitions belong to a company.

## 4. Dashboard

The dashboard route is in `src/routes/dashboard.js`.

The dashboard controller calls `src/services/dashboard.service.js` to calculate statistics such as:

- Total employees.
- Active employees.
- Total active salaries.
- Average salary.
- Recently created employees.

The dashboard page is:

```text
src/views/dashboard/index.ejs
```

Most employee statistics are filtered by the current company.

## 5. Employee CRUD

CRUD means:

- **Create** an employee.
- **Read** or list employee information.
- **Update** employee information.
- **Delete** an employee.

The routes are in `src/routes/employee.js`:

| Action | Method and URL | Purpose |
|---|---|---|
| List | `GET /employees` | Show all employees |
| Create page | `GET /employees/create` | Show the create form |
| Create | `POST /employees/create` | Save a new employee |
| Details | `GET /employees/:id` | Show one employee and a payroll projection |
| Edit page | `GET /employees/:id/edit` | Show the edit form |
| Update | `POST /employees/:id/edit` | Save changes |
| Delete | `POST /employees/:id/delete` | Delete an employee |

The controller is:

```text
src/controllers/employee.controller.js
```

The database service is:

```text
src/services/employeeService.js
```

The pages are:

```text
src/views/employees/index.ejs
src/views/employees/create.ejs
src/views/employees/edit.ejs
src/views/employees/show.ejs
```

### Employee data categories

The employee forms contain these groups of information:

- Identity: name, first name, CIN, birth date, and sex.
- Family: marital status, people dependent on the employee, and children.
- Employment: matricule, job, department, hiring date, seniority date, status, and employment type.
- Contract: start and end dates for a CDD.
- Departure: exit date and active status.
- Contact: address and city.
- Salary: base salary and CIMR rate.
- CNSS: registration number and affiliation date.
- Payment: payment method, bank, branch, and RIB.
- Payroll controls: CIMR option and payroll-entry blocking.
- Recurring bonuses: bonuses assigned to the employee every month.
- Photo and attachment: employee image and a document.

### CDD contract dates

The employment type field is called `natureEmploi`.

The value for a CDD is `OCCASIONNEL`.

JavaScript in the create and edit pages hides `Contrat du` and `Contrat au` unless the selected employment type is `OCCASIONNEL`. When the fields are hidden, they are disabled and are not submitted by the browser.

### What happens when an employee is saved

1. The browser submits the form.
2. The employee route receives the request.
3. The controller separates bonus fields and normal employee fields.
4. The controller converts uploaded files into public paths.
5. `employeeService.js` converts dates and numeric values.
6. Prisma writes the employee into MySQL.
7. Recurring bonus assignments are saved in `EmployeeBonus`.
8. The user is redirected to the employee list or detail page.

## 6. Employee Uploads

Employee forms use:

```html
method="POST"
enctype="multipart/form-data"
```

This is required for sending files. Normal URL-encoded forms cannot send file contents.

Uploads are configured in:

```text
middlewares/employeeUploads.js
```

The routes use this middleware before the employee controller:

```text
employee.post("/create", employeeUploads, handleCreateEmployee)
employee.post("/:id/edit", employeeUploads, handleUpdateEmployee)
```

Files are stored in:

```text
public/uploads/employees
```

Because `public/` is served statically by Express, a saved file such as:

```text
/uploads/employees/example.png
```

can be opened by the browser.

Current upload rules:

- Maximum size: 5 MB.
- Employee photo: JPEG, PNG, or WEBP.
- Attachment: PDF, Word, JPEG, PNG, or WEBP.
- The database stores the file path, not the file bytes.
- On edit, if no new file is selected, the old path is preserved.

The database fields are:

- `Employee.image` for the employee photo.
- `Employee.pieceJointeUrl` for the attachment path.

## 7. Recurring Bonuses

A recurring bonus is a bonus that is automatically considered during monthly payroll calculation.

The relevant models are:

- `Bonus`: the company's bonus catalog.
- `EmployeeBonus`: the link between an employee and a bonus, including the amount.

When a user selects a catalog bonus, the controller sends its ID and amount. When a user types a new bonus, `employeeService.js` creates a catalog definition and assigns it to the employee.

The payroll engine separates recurring bonuses into:

- Taxable bonuses: `variablePrimes` and `bonusesIMP`.
- Non-taxable bonuses: `nimpLines` and `bonusesNIMP`.

## 8. Payroll Bulletin Pages

The bulletin routes are in:

```text
src/routes/bulletins.js
```

The main controller is:

```text
src/controllers/bulletins.controller.js
```

Important routes:

| Action | Method and URL | Purpose |
|---|---|---|
| List | `GET /bulletins` | List active employees for a month |
| Live calculation | `GET /bulletins/:id/calculate` | Calculate without saving |
| Generate | `POST /ulletins/:id/generate` | Save oneb monthly bulletin |
| Bulk generate | `POST /bulletins/generate-bulk` | Generate bulletins for eligible employees |
| Validate | `POST /bulletins/:id/validate` | Mark a bulletin as validated |
| PDF | `GET /bulletins/:id/pdf` | Download a saved bulletin as PDF |
| Details | `GET /bulletins/:id` | Show history or the monthly bulletin page |

The main bulletin page is:

```text
src/views/bulletins/show.ejs
```

### Live preview versus generation

These are different operations.

**Live preview** calls `calculatePayroll()` and returns JSON. It does not save anything in the database.

**Generate** calls the same payroll engine, then saves the result in the `Payslip` table. This means the preview and the generated bulletin use the same calculation logic.

### Monthly values

The monthly bulletin can use values such as:

- Absence days.
- Overtime at 25 percent.
- Overtime at 50 percent.
- Overtime at 100 percent.
- Variable taxable primes.
- Overrides for non-taxable bonus amounts.
- Salary override for the month.
- Family dependents.
- Advances.

These values belong to the monthly payslip calculation. They do not permanently change the employee's base profile unless the user edits the employee record separately.

### Bulk generation

Bulk generation selects employees that are:

- In the current company.
- Active (`actif = true`).
- Not blocked from payroll entry (`blocageSaisiePaie = false`).

A payslip is unique for an employee, month, and year. This prevents duplicate monthly payslips.

### Validation

Validation changes the payslip status to `VALIDATED` and records validation information.

After validation, generation should not overwrite the validated payslip. In the interface, validated bulletins are displayed as read-only.

## 9. Payroll Calculation

The single calculation entry point is:

```text
src/payroll-engine/PayrollEngine.js
```

The main function is:

```javascript
calculatePayroll(employee, overrides)
```

It returns a calculation object. It does not write to the database.

The calculation sequence is:

```text
Base salary
  -> Absence deduction
  -> Seniority bonus
  -> Taxable primes
  -> Overtime
  -> Non-taxable bonuses
  -> SBG
  -> SBI
  -> CNSS and AMO
  -> CIMR
  -> Professional expenses
  -> SNI
  -> IR
  -> Family deductions
  -> Advances
  -> Net to pay
```

### Main payroll values

- **Base salary**: the employee's salary, or a monthly override.
- **Absence deduction**: salary deduction based on absence days.
- **Prime d'anciennete**: seniority bonus calculated from hiring date and the payroll period.
- **Overtime**: calculated by overtime category.
- **SBG**: Salaire Brut Global, the total gross salary.
- **SBI**: Salaire Brut Imposable, the taxable gross salary.
- **CNSS**: employee social security contribution.
- **AMO**: employee health insurance contribution.
- **CIMR**: optional retirement contribution.
- **Frais professionnels**: fiscal deduction used for IR calculation, not a cash deduction from net salary.
- **SNI**: Salaire Net Imposable.
- **IR**: income tax.
- **Charges de famille**: family deduction based on dependents.
- **Avances**: salary advances deducted from the amount to pay.
- **Net a payer**: final amount paid to the employee.

Supporting calculators are in:

```text
src/payroll-engine/calculators/
```

The legal rules are in:

```text
src/payroll-engine/rules/
```

Important calculators include:

- `absence.calculator.js`
- `anciennete.calculator.js`
- `overtime.calculator.js`
- `cnss.calculator.js`
- `amo.calculator.js`
- `cimr.calculator.js`
- `fraisProfessionnels.calculator.js`
- `ir.calculator.js`

## 10. Saving a Payslip

When a bulletin is generated, the controller:

1. Loads the employee and recurring bonuses.
2. Reads the selected month and year.
3. Reads monthly overrides.
4. Calls `calculatePayroll()`.
5. Builds the payslip data.
6. Saves the calculation in `Payslip`.
7. Replaces the payslip bonus lines in `PayslipBonus`.
8. Redirects to the bulletin page.

The payslip stores the values used at that time. This is important because an employee's salary or bonus configuration may change later, but an old payslip should remain a historical snapshot.

## 11. PDF Download

PDF generation is handled by:

```text
src/pdf/bulletinPdf.js
```

The controller function is `downloadPdfBulletin()` in:

```text
src/controllers/bulletins.controller.js
```

The PDF route loads a saved payslip, employee, company, and bonus data. It then uses PDFKit to stream a PDF to the browser.

A PDF can be downloaded only after the payslip has been generated and saved. A live preview is not enough to create a PDF.

## 12. Database Models

The main schema is:

```text
prisma/schema.prisma
```

The important models are:

### Company

Represents the employer. A company owns employees and bonus definitions.

### Users

Represents application users who can log in.

### UserCompany

Connects users to companies.

### Employee

Stores the long-term employee profile, including personal data, contract data, salary, bank information, CNSS, CIMR, uploads, and active/blocking flags.

### Bonus

A reusable company-level bonus definition.

### EmployeeBonus

Assigns a bonus and amount to one employee.

### Payslip

Stores one monthly payroll result.

The database has a unique rule for:

```text
employeeId + month + year
```

This means one employee cannot have two payslips for the same month and year.

### PayslipBonus

Stores the bonus lines copied into a payslip. This preserves the bonus details used in the historical calculation.

## 13. Recommended User Workflow

Use the application in this order:

1. Start MySQL and confirm the `paie` database is available.
2. Start the application with `node index.js`.
3. Log in.
4. Confirm the active company.
5. Create an employee.
6. Complete identity, employment, salary, CNSS, banking, and family information.
7. Select `Occasionnel (CDD)` if the employee has a fixed-term contract.
8. Enter `Contrat du` and `Contrat au` only for that CDD.
9. Upload a photo or attachment if needed.
10. Add recurring bonuses if the employee receives them every month.
11. Open `Bulletins`.
12. Select the month and year.
13. Open the employee bulletin page.
14. Enter monthly absences, overtime, primes, or advances.
15. Use the live preview to check the calculation.
16. Generate the bulletin.
17. Review the saved amounts.
18. Validate the bulletin.
19. Download the PDF.

## 14. Setup and Tests

Prisma configuration is in:

```text
prisma.config.ts
```

The Prisma seed command is configured in `package.json`:

```bash
npx tsx prisma/seed.ts
```

The project currently has no real `npm test` command. The current script intentionally exits with an error:

```text
Error: no test specified
```

Available direct test files include:

```bash
node test_payroll_spec.js
node smoke_test.js
node e2e_real_data_test.js
node verify_frais_pro_rule.js
```

These tests may require:

- MySQL running.
- A valid `DATABASE_URL` in `.env`.
- Migrations applied.
- The Prisma client generated.
- Seed data available.

Some JavaScript files import TypeScript files directly. If plain Node has a module-loading problem, use the project's `tsx` setup or run the relevant file through `npx tsx`.

## 15. Current Limitations to Know

This section describes the current code, not the ideal future version.

### Employee creation and CNSS affiliation

`createEmployee()` uses `dateAffiliationCnss`. Check that this field is included in the destructured input data in `src/services/employeeService.js`. If it is not destructured, employee creation can fail with a `ReferenceError`.

### Company security

The employee list is company-filtered, but some detail, edit, delete, and bulletin lookups use only a numeric ID. Those operations should also verify the employee's `companyId` against the logged-in company.

### Upload storage

Uploads are stored on the local server filesystem. In a production deployment, files should use durable storage and should be cleaned up when replaced or when an employee is deleted.

### Payroll configuration

The database contains payroll configuration fields, but some payroll calculations still use rule modules with hard-coded legal values. Changing configuration does not necessarily change every calculation.

### Cumulative IR

The payslip stores cumulative-looking IR fields, but the current implementation does not provide a complete legally cumulative annual IR calculation. Treat those fields carefully until the cumulative logic is completed.

### CNSS report

`src/payroll-engine/reports/cnss.report.js` contains CNSS report logic, but there is currently no complete report route and view connected to the application.

### Bonus taxation

The form currently presents catalog bonuses as exempt. New bonus definitions are also created as non-taxable. If taxable recurring bonuses are needed, the form and bonus creation flow must expose and preserve the taxable choice.

## 16. Simple Mental Model

Remember these five ideas:

1. **Employee** is the permanent HR profile.
2. **Monthly overrides** are values for one payroll month.
3. **`calculatePayroll()`** calculates results without saving them.
4. **Payslip** saves one monthly result as a historical snapshot.
5. **PDF** is generated from the saved payslip, not directly from the live preview.

If you understand that sequence, you understand the core of the application:

```text
Employee profile
  -> Monthly payroll inputs
  -> PayrollEngine calculation
  -> Payslip database snapshot
  -> Validated bulletin
  -> PDF
```

import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

const showView = fs.readFileSync("./src/views/bulletins/show.ejs", "utf8");
const showScript = fs.readFileSync("./public/js/show-bulletin.js", "utf8");
const listScript = fs.readFileSync("./public/js/bulletins-list.js", "utf8");
const controller = fs.readFileSync("./src/controllers/bulletins.controller.js", "utf8");
const addSection = controller.slice(
    controller.indexOf("export const addMonthlyIndemnity"),
    controller.indexOf("export const stickMonthlyIndemnity")
);

const employee = {
    baseSalary: 10000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    bonuses: [{ amount: 130, taxable: false, name: "Indemnité transport" }],
    company: {
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
    },
};

const fullMonth = calculatePayroll(employee, { workedDays: 26 });
const reducedMonth = calculatePayroll(employee, { workedDays: 20 });
const fullLine = fullMonth.nimpLines.find(line => line.label === "Indemnité transport");
const reducedLine = reducedMonth.nimpLines.find(line => line.label === "Indemnité transport");

assert.equal(fullLine.amount, 130, "26 days must pay the full fiche amount");
assert.equal(reducedLine.amount, 100, "20 days must prorate 130 to 100");

assert.match(showView, /class="live-input nimp-amount-input"/);
assert.match(showView, /data-original-amount="<%= payableAmount %>"/);
assert.match(showScript, /document\.querySelectorAll\('\.nimp-amount-input'\)/);
assert.match(showScript, /\/indemnities\/update/);
assert.match(showScript, /saveEmployee: false/);
assert.match(showScript, /calculate\(\{ preserveIndemnityInputs: true, allowLocked: true \}\)/);
assert.match(showScript, /if \(!preserveIndemnityInputs\) amountInput\.value/);
assert.match(showScript, /state\.textContent = 'Aperçu · non enregistré'/);
assert.match(showView, /id="save-payroll-changes"/);
assert.match(showView, /show-bulletin\.js\?v=live-preview-6/);
assert.doesNotMatch(showScript, /saveAvanceDeduction|savePaidLeaveDays|savePublicHolidayDays|saveBirthLeaveDays/);
const saveStart = showScript.indexOf("const saveBeforeSwitch = async () => {");
const saveEnd = showScript.indexOf("document.querySelector('#save-payroll-changes')", saveStart);
assert.notEqual(saveStart, -1);
assert.notEqual(saveEnd, -1);
const saveFlow = showScript.slice(saveStart, saveEnd);
assert.ok(saveFlow.indexOf("await calculateWorkingTime()") < saveFlow.indexOf("fetch(form.action"));
assert.match(showScript, /function previewWorkingTime\(\)/);
const nimpSaveSetup = showScript.indexOf("if (input.disabled) return;");
const nimpSaveStart = showScript.lastIndexOf("document.querySelectorAll('.nimp-amount-input').forEach(input => {", nimpSaveSetup);
const nimpSaveEnd = showScript.indexOf("lines?.addEventListener('keydown'", nimpSaveStart);
assert.notEqual(nimpSaveStart, -1);
assert.notEqual(nimpSaveEnd, -1);
assert.doesNotMatch(showScript.slice(nimpSaveStart, nimpSaveEnd), /window\.location\.reload\(\)/);

assert.match(addSection, /const workingTime = resolveWorkingTimeForPayslip\(emp, existing\)/);
assert.match(addSection, /const indemnityRatio = workingTime\.mode === "HOURS"/);
assert.match(addSection, /const payableAmount = Number\(\(monthlyAmount \* indemnityRatio\)\.toFixed\(2\)\)/);
assert.match(addSection, /baseAmount: monthlyAmount/);
assert.equal(Number((1500 * 23 / 26).toFixed(2)), 1326.92, "a 1,500 DH monthly indemnity must prorate to 23 of 26 days");

const workedDaysSection = controller.slice(
    controller.indexOf("export const updateBulletinWorkedDays"),
    controller.indexOf("export const updateBulletinPaidLeave")
);
const liveCalculationSection = controller.slice(
    controller.indexOf("export const calculateLive"),
    controller.indexOf("export const changeBulletinPeriod")
);
assert.match(workedDaysSection, /prorateMonthlyNimpLines\(/);
assert.match(workedDaysSection, /persistPayslipBonuses\(existing\.id, calc, transaction\)/);
assert.match(liveCalculationSection, /overrides\.monthlyNimpLines = prorateMonthlyNimpLines\(/);
assert.match(liveCalculationSection, /monthlyNimpLines:\s*enteredMonthlyNimpLines/);
assert.doesNotMatch(showView, /data-nimp-payable/);
assert.match(showScript, /\/calculate\?\$\{body\}/);
assert.match(showScript, /amountInput\.value = Number\(line\.amount \|\| 0\)\.toFixed\(2\)/);
assert.match(listScript, /input\.value = Number\(line\.amount \|\| 0\)\.toFixed\(2\)/);
assert.doesNotMatch(listScript, /Payable : /);
assert.equal(Number((500 * 21 / 26).toFixed(2)), 403.85, "a 500 DH monthly ceiling must prorate to 21 of 26 days");

const updateSection = controller.slice(
    controller.indexOf("export const updateMonthlyIndemnity"),
    controller.indexOf("export const deleteMonthlyIndemnity")
);
assert.match(updateSection, /const ficheRatio = Number\(workingTime\.ratio \|\| 0\)/);
assert.match(updateSection, /const payableAmount = Math\.min\(amount, ficheMaximum/);
assert.doesNotMatch(updateSection, /employeeBonus\.(update|upsert|delete)/);

console.log("Bulletin show indemnity diagnostic passed:");
console.log("- payable field is rendered and wired to the show-page update endpoint");
console.log("- 26 days: 130.00 DH; 20 days: 100.00 DH");
console.log("- update is bulletin-only and capped by worked-time proration");

import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

const showView = fs.readFileSync("./src/views/bulletins/show.ejs", "utf8");
const showScript = fs.readFileSync("./public/js/show-bulletin.js", "utf8");
const controller = fs.readFileSync("./src/controllers/bulletins.controller.js", "utf8");

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

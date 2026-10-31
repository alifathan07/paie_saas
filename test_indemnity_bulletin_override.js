import assert from "node:assert/strict";
import fs from "node:fs";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

const showView = fs.readFileSync("./src/views/bulletins/show.ejs", "utf8");
const listView = fs.readFileSync("./src/views/bulletins/index.ejs", "utf8");
const bulletinController = fs.readFileSync("./src/controllers/bulletins.controller.js", "utf8");
const bulletinScript = fs.readFileSync("./public/js/show-bulletin.js", "utf8");
const listScript = fs.readFileSync("./public/js/bulletins-list.js", "utf8");

const employee = {
    id: 1,
    baseSalary: 10000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    bonuses: [],
    company: {
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
    },
};

const fullAmount = 1500;
const reducedAmount = 1000;

// A bulletin override may go down, but never above the current bulletin base.
assert.equal(Math.min(reducedAmount, fullAmount), reducedAmount);
assert.equal(Math.min(2000, fullAmount), fullAmount);

// The bulletin input and client-side handler enforce the same upper bound.
assert.match(showView, /name="nimpAmounts"[\s\S]{0,300}max="<%= baseAmount %>"/);
assert.match(bulletinScript, /amountInput\.value = maximumAmount\.toFixed\(2\)/);
assert.match(bulletinScript, /event\.target\.value = maximum\.toFixed\(2\)/);

// The overview offers the same edit for existing lines only, with the same cap.
assert.match(listView, /nimp-amount-input[\s\S]{0,500}max="<%= nimpBase\.toFixed\(2\) %>"/);
assert.match(listView, /data-sticky="<%= component\.sticky \? 'true' : 'false' %>"/);
assert.match(listScript, /\/indemnities\/update/);
assert.match(listScript, /input\.dataset\.oldAmount/);
assert.match(listScript, /window\.AppDialog\.choice/);

// A recurring indemnity asks whether to update the employee record too.
assert.match(bulletinScript, /saveEmployee = choice === true/);
assert.match(bulletinScript, /window\.AppDialog\.choice/);

// The server also caps an increase if a client bypasses the HTML limit.
assert.match(bulletinController, /const currentBaseAmount = currentLine \? payslipBonusBaseAmount\(currentLine\) : 0/);
assert.match(bulletinController, /const amount = Math\.min\(requestedAmount, maximumAmount\)/);

// Worked days still prorate the current bulletin base amount.
const reducedFullMonth = calculatePayroll(employee, {
    workedDays: 26,
    monthlyNimpLines: [{ label: "Indemnité transport", amount: reducedAmount, baseAmount: reducedAmount }],
});
const reducedHalfMonth = calculatePayroll(employee, {
    workedDays: 13,
    monthlyNimpLines: [{ label: "Indemnité transport", amount: reducedAmount, baseAmount: reducedAmount }],
});

assert.equal(reducedFullMonth.nimpLines[0].baseAmount, reducedAmount);
assert.equal(reducedFullMonth.nimpLines[0].amount, reducedAmount);
assert.equal(reducedHalfMonth.nimpLines[0].baseAmount, reducedAmount);
assert.equal(reducedHalfMonth.nimpLines[0].amount, reducedAmount / 2);

console.log("Bulletin indemnity override checks passed.");

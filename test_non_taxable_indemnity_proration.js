import assert from "node:assert/strict";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

const employee = {
  id: 1,
  baseSalary: 10000,
  dateEmbauche: new Date("2020-01-01"),
  nbPersonacharge: 0,
  bonuses: [{ name: "Indemnité transport", amount: 1500, taxable: false }],
  company: {
    workingTimeMode: "HOURS",
    standardMonthlyDays: 26,
    standardMonthlyHours: 191,
  },
};

const fullMonth = calculatePayroll(employee, { workedHours: 191 });
assert.equal(fullMonth.nimpLines[0].baseAmount, 1500);
assert.equal(fullMonth.nimpLines[0].amount, 1500);

const partialMonth = calculatePayroll(employee, { workedHours: 130 });
assert.equal(partialMonth.nimpLines[0].baseAmount, 1500);
assert.equal(partialMonth.nimpLines[0].amount.toFixed(2), "1020.94");
assert.equal(partialMonth.bonusesNIMP.toFixed(2), "1020.94");
assert.equal((partialMonth.sbg - partialMonth.sbi).toFixed(2), "1020.94");

const zeroMonth = calculatePayroll(employee, { workedHours: 0 });
assert.equal(zeroMonth.nimpLines[0].amount, 0);
assert.equal(zeroMonth.bonusesNIMP, 0);

const daysEmployee = { ...employee, company: { ...employee.company, workingTimeMode: "DAYS" } };
const halfMonth = calculatePayroll(daysEmployee, { workedDays: 13 });
assert.equal(halfMonth.nimpLines[0].amount, 750);

console.log("Non-taxable indemnity proration checks passed.");

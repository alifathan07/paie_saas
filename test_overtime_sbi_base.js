import assert from "node:assert/strict";
import { calculateOvertime } from "./src/payroll-engine/calculators/overtime.calculator.js";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

const employee = {
    baseSalary: 10000,
    dateEmbauche: new Date("2026-09-30"),
    bonuses: [{ name: "Prime taxable", amount: 2000, taxable: true }],
    company: {
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
    },
};

const payroll = calculatePayroll(employee, {
    month: 9,
    year: 2026,
    workedDays: 26,
    heuresSup25: 1,
});

assert.equal(payroll.primeAnciennete, 0);
assert.equal(payroll.heuresSupAmount, 78.53);
assert.equal(payroll.sbi, 12078.53);
assert.equal(calculateOvertime(1910, 1).hourlyRate, 10, "default overtime denominator is 191 hours");

console.log("Overtime uses pre-overtime SBI divided by 191 hours.");

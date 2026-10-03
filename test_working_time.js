import assert from "node:assert/strict";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import {
    calculateWorkedDaysFromHours,
    calculateWorkedHoursFromDays,
    normalizeWorkingTime,
} from "./src/payroll-engine/utils/workingTime.js";

const basis = { standardMonthlyDays: 26, standardMonthlyHours: 191 };

assert.equal(calculateWorkedHoursFromDays(26, 26, 191), 191);
assert.equal(calculateWorkedHoursFromDays(24, 26, 191), 176.31);
assert.equal(calculateWorkedDaysFromHours(191, 26, 191), 26);
assert.equal(calculateWorkedDaysFromHours(176.31, 26, 191), 24);

const days = normalizeWorkingTime({ workingTimeMode: "DAYS", ...basis, workedDays: 24 });
const hours = normalizeWorkingTime({ workingTimeMode: "HOURS", ...basis, workedHours: 176.31 });
assert.equal(days.workedHours, 176.31);
assert.equal(hours.workedDays, 24);
assert.equal(days.ratio, hours.ratio);

const employee = {
    id: 1,
    dateEmbauche: new Date("2020-01-01"),
    baseSalary: 5000,
    bonuses: [],
    company: { workingTimeMode: "DAYS", ...basis },
};
const daysPayroll = calculatePayroll(employee, { workedDays: 24, heuresSup25: 5 });
const hoursPayroll = calculatePayroll({
    ...employee,
    company: { workingTimeMode: "HOURS", ...basis },
}, { workedHours: 176.31, heuresSup25: 5 });
assert.equal(daysPayroll.workedDays, 24);
assert.equal(daysPayroll.workedHours, 176.31);
assert.equal(hoursPayroll.workedDays, 24);
assert.equal(hoursPayroll.workedHours, 176.31);
assert.equal(daysPayroll.baseSalary, hoursPayroll.baseSalary);
assert.equal(daysPayroll.heuresSup25, hoursPayroll.heuresSup25);

for (const invalid of [
    { workingTimeMode: "INVALID", workedDays: 1 },
    { workingTimeMode: "DAYS", workedDays: -1 },
    { workingTimeMode: "HOURS", workedHours: -1 },
    { workingTimeMode: "DAYS", standardMonthlyDays: 0, workedDays: 1 },
    { workingTimeMode: "HOURS", standardMonthlyHours: 0, workedHours: 1 },
]) {
    assert.throws(() => normalizeWorkingTime(invalid));
}

console.log("Working-time DAYS/HOURS checks passed.");

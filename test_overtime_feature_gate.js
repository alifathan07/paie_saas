import assert from "node:assert/strict";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import {
    applyCompanyOvertimeSetting,
    hideOvertimeFromView,
    isOvertimeEnabled,
} from "./src/lib/overtimeFeature.js";

const company = {
    overtimeEnabled: true,
    workingTimeMode: "DAYS",
    standardMonthlyDays: 26,
    standardMonthlyHours: 191,
};
const employee = {
    baseSalary: 1910,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    bonuses: [],
    company,
};
const submitted = { workedDays: 26, heuresSup25: 8, heuresSup50: 2, heuresSup100: 1 };

assert.equal(isOvertimeEnabled(company), true);
assert.equal(isOvertimeEnabled({}), true, "missing settings preserve existing overtime behavior");
const enabledPayroll = calculatePayroll(employee, applyCompanyOvertimeSetting(company, submitted));
assert.equal(enabledPayroll.heuresSup25, 8);
assert.ok(enabledPayroll.heuresSupAmount > 0);

const disabledCompany = { ...company, overtimeEnabled: false };
const disabledInputs = applyCompanyOvertimeSetting(disabledCompany, submitted);
const disabledPayroll = calculatePayroll(employee, disabledInputs);
assert.deepEqual(
    [disabledPayroll.heuresSup25, disabledPayroll.heuresSup50, disabledPayroll.heuresSup100, disabledPayroll.heuresSupAmount],
    [0, 0, 0, 0],
);
assert.deepEqual(submitted, { workedDays: 26, heuresSup25: 8, heuresSup50: 2, heuresSup100: 1 });
assert.deepEqual(
    hideOvertimeFromView({ heuresSup25: 8, hs25Amount: 100, heuresSupAmount: 100 }, false),
    { heuresSup25: 0, hs25Amount: 0, heuresSupAmount: 0, heuresSup50: 0, heuresSup100: 0, hs50Amount: 0, hs100Amount: 0 },
);

console.log("Company overtime feature gate passed.");

import assert from "node:assert/strict";
import { calculateBirthLeaveCompensation } from "./src/payroll-engine/calculators/congeNaissance.calculator.js";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import { listBirthLeaveReferencePayslips } from "./src/services/congeNaissance.service.js";

const payslip = (year, month, sbi, overrides = {}) => ({
    year,
    month,
    sbi,
    status: "CLOSED",
    workingTimeMode: "DAYS",
    workedDays: 26,
    workedHours: null,
    ...overrides,
});

const nineMonths = Array.from({ length: 9 }, (_, index) => payslip(2025, index + 1, (index + 1) * 1000));
const nineMonthResult = calculateBirthLeaveCompensation({
    leaveDays: 3,
    historicalPayslips: nineMonths,
    year: 2025,
    month: 10,
});
assert.equal(nineMonthResult.referenceMonths, 9);
assert.equal(nineMonthResult.cumulativeSBI, 45000);
assert.equal(nineMonthResult.baseCongeNaissance, 5000);
assert.equal(nineMonthResult.congeNaissanceAmount, 576.92);

const twelveMonths = Array.from({ length: 12 }, (_, index) => payslip(2025, index + 1, 2600));
const twelveMonthResult = calculateBirthLeaveCompensation({
    leaveDays: 5,
    historicalPayslips: twelveMonths,
    year: 2026,
    month: 1,
});
assert.equal(twelveMonthResult.referenceMonths, 12);
assert.equal(twelveMonthResult.congeNaissanceAmount, 500);

const eighteenMonths = Array.from({ length: 18 }, (_, index) => {
    const periodIndex = 2024 * 12 + index;
    return payslip(Math.floor(periodIndex / 12), periodIndex % 12 + 1, (index + 1) * 1000);
});
const eighteenMonthResult = calculateBirthLeaveCompensation({
    leaveDays: 2,
    historicalPayslips: eighteenMonths,
    year: 2026,
    month: 1,
});
assert.equal(eighteenMonthResult.referenceMonths, 12);
assert.equal(eighteenMonthResult.cumulativeSBI, 150000, "only the latest 12 worked months contribute");
assert.equal(eighteenMonthResult.baseCongeNaissance, 12500);
assert.equal(eighteenMonthResult.congeNaissanceAmount, 961.54);

const sparseHistory = [
    payslip(2025, 1, 1000),
    payslip(2025, 3, 2000),
    payslip(2025, 7, 3000),
    payslip(2025, 8, 99999, { status: "DRAFT" }),
    payslip(2025, 8, 99999, { workedDays: 0 }),
    payslip(2025, 8, 99999),
    payslip(2025, 9, 99999),
];
const sparseResult = calculateBirthLeaveCompensation({
    leaveDays: 4,
    historicalPayslips: sparseHistory,
    year: 2025,
    month: 8,
});
assert.equal(sparseResult.referenceMonths, 3, "missing, unfinalized, unworked, and current months are excluded");
assert.equal(sparseResult.cumulativeSBI, 6000);
assert.equal(sparseResult.congeNaissanceAmount, 307.69);

const oneDay = calculateBirthLeaveCompensation({
    leaveDays: 1,
    historicalPayslips: [payslip(2025, 1, 2600)],
    year: 2025,
    month: 2,
});
const fiveDays = calculateBirthLeaveCompensation({
    leaveDays: 5,
    historicalPayslips: [payslip(2025, 1, 2600)],
    year: 2025,
    month: 2,
});
assert.equal(oneDay.congeNaissanceAmount, 100);
assert.equal(fiveDays.congeNaissanceAmount, 500);

const rounded = calculateBirthLeaveCompensation({
    leaveDays: 1,
    historicalPayslips: [
        payslip(2025, 1, 1000.01),
        payslip(2025, 2, 1000.02),
        payslip(2025, 3, 1000.02),
    ],
    year: 2025,
    month: 4,
});
assert.equal(rounded.baseCongeNaissance, 1000.02);
assert.equal(rounded.congeNaissanceAmount, 38.46);

const noHistory = calculateBirthLeaveCompensation({
    leaveDays: 3,
    historicalPayslips: [],
    year: 2025,
    month: 1,
});
assert.equal(noHistory.referenceMonths, 0);
assert.equal(noHistory.baseCongeNaissance, 0);
assert.equal(noHistory.congeNaissanceAmount, 0);

let capturedQuery;
await listBirthLeaveReferencePayslips(
    { employeeId: 55, companyId: 9, year: 2026, month: 4 },
    { payslip: { findMany: async query => { capturedQuery = query; return []; } } },
);
assert.equal(capturedQuery.where.employeeId, 55);
assert.deepEqual(capturedQuery.where.employee, { companyId: 9 });
assert.deepEqual(capturedQuery.where.status, { in: ["VALIDATED", "CLOSED"] });
assert.deepEqual(capturedQuery.where.OR, [
    { year: { lt: 2026 } },
    { year: 2026, month: { lt: 4 } },
]);
assert.deepEqual(capturedQuery.orderBy, [{ year: "desc" }, { month: "desc" }]);
assert.equal(capturedQuery.take, 12);

const payroll = calculatePayroll({
    baseSalary: 12000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    bonuses: [],
    company: {
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
    },
}, {
    year: 2025,
    month: 10,
    workedDays: 26,
    congeNaissanceDays: 3,
    birthLeaveHistory: nineMonths,
});
assert.equal(payroll.baseCongeNaissance, 5000);
assert.equal(payroll.congeNaissanceAmount, 576.92);

console.log("Congé de naissance SBI compensation checks passed.");

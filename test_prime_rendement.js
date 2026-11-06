import assert from "node:assert/strict";
import { prisma } from "./src/lib/db.js";
import { calculateLive } from "./src/controllers/bulletins.controller.js";
import { calculatePrimeRendement } from "./src/payroll-engine/calculators/primeRendement.calculator.js";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import { calculateCumulativeIR } from "./src/payroll-engine/calculators/cumulativeIr.calculator.js";
import { refreshDraftPayslips } from "./src/services/employeePayrollRefresh.service.js";
import {
    applyCompanyPrimeRendementSetting,
    hidePrimeRendementFromView,
    isPrimeRendementEnabled,
} from "./src/lib/primeRendementFeature.js";

assert.equal(calculatePrimeRendement(1910, 2), 20);
assert.equal(calculatePrimeRendement(1000, 1), 5.24);
assert.equal(calculatePrimeRendement(0, 5), 0);
assert.throws(() => calculatePrimeRendement(1000, -1), /PRIME_RENDEMENT_INPUT_INVALID/);

assert.equal(isPrimeRendementEnabled({}), true);
assert.deepEqual(
    applyCompanyPrimeRendementSetting({ primeRendementEnabled: false }, { primeRendementInput: 2, primeRendementAmount: 20 }),
    { primeRendementInput: 0, primeRendementAmount: 0 },
);
assert.deepEqual(
    hidePrimeRendementFromView({
        primeRendementInput: 2,
        primeRendementAmount: 20,
        taxableAdditions: [{ calculationKey: "prime_rendement", amount: 20 }, { calculationKey: "overtime_25", amount: 10 }],
    }, false),
    {
        primeRendementInput: 0,
        primeRendementAmount: 0,
        taxableAdditions: [{ calculationKey: "overtime_25", amount: 10 }],
    },
);

const employee = {
    id: 8,
    companyId: 3,
    baseSalary: 12000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    actif: true,
    blocageSaisiePaie: false,
    company: {
        overtimeEnabled: true,
        primeRendementEnabled: true,
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
    },
    bonuses: [],
};

const restores = [];
function mock(target, name, implementation) {
    const original = target[name];
    restores.push(() => { target[name] = original; });
    target[name] = implementation;
}

try {
    mock(prisma.employee, "findFirst", async () => employee);
    mock(prisma.rubriqueBase, "findMany", async () => []);
    mock(prisma.rubriqueRetenu, "findMany", async () => []);
    mock(prisma.rubriqueImposable, "findMany", async () => []);
    mock(prisma.payslip, "findUnique", async () => null);
    mock(prisma.payslip, "findFirst", async () => null);
    mock(prisma.payslip, "findMany", async () => []);

    async function preview(query) {
        const response = {
            status(code) { this.code = code; return this; },
            json(body) { this.body = body; return this; },
        };
        await calculateLive({
            params: { id: "8" },
            session: { user: { activeCompanyId: 3 } },
            query: { month: "9", year: "2026", workedDays: "26", ...query },
        }, response);
        assert.equal(response.body.ok, true);
        return response.body;
    }

    const baseline = await preview({});
    const withPrime = await preview({ primeRendementInput: "1" });
    const expectedAmount = Number((baseline.netAPayer / 191).toFixed(2));
    assert.equal(withPrime.primeRendementInput, 1);
    assert.equal(withPrime.primeRendementAmount, expectedAmount);
    assert.equal(withPrime.sbi, Number((baseline.sbi + expectedAmount).toFixed(2)));
    assert.equal(withPrime.primeRendementEnabled, true);

    employee.company.primeRendementEnabled = false;
    const disabled = await preview({ primeRendementInput: "1" });
    assert.equal(disabled.primeRendementInput, 0);
    assert.equal(disabled.primeRendementAmount, 0);
    assert.equal(disabled.primeRendementEnabled, false);

    employee.company.primeRendementEnabled = true;
    const draft = {
        id: 12,
        month: 9,
        year: 2026,
        status: "DRAFT",
        workedDays: 26,
        workedHours: 191,
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
        primeRendementInput: 1,
        avanceDeduction: 0,
        bonuses: [],
        retenus: [],
    };
    let updatedDraft;
    const tx = {
        payslip: {
            async findMany({ where }) {
                return where.employeeId && where.status?.in?.includes("DRAFT") ? [draft] : [];
            },
            async update({ data }) { updatedDraft = data; return { ...draft, ...data }; },
        },
        payrollConfig: { async findFirst() { return null; } },
        payslipBonus: {
            async deleteMany() {},
            async createMany() {},
        },
    };
    await refreshDraftPayslips(tx, employee);
    const beforeRefreshPrime = calculatePayroll(employee, {
        month: draft.month,
        year: draft.year,
        workedDays: draft.workedDays,
        workedHours: draft.workedHours,
        workingTimeMode: draft.workingTimeMode,
        standardMonthlyDays: draft.standardMonthlyDays,
        standardMonthlyHours: draft.standardMonthlyHours,
    });
    const baselineIR = calculateCumulativeIR({
        employeeId: employee.id,
        year: draft.year,
        month: draft.month,
        previousPayslips: [],
        currentSNI: beforeRefreshPrime.sni,
    });
    const baselineNet = Math.max(0, Number((
        beforeRefreshPrime.sbg - beforeRefreshPrime.cnss - beforeRefreshPrime.amo
        - beforeRefreshPrime.cimr - Math.max(0, baselineIR.currentMonthIR - beforeRefreshPrime.chargesDeFamille)
    ).toFixed(2)));
    assert.equal(updatedDraft.primeRendementInput, 1);
    assert.equal(updatedDraft.primeRendementAmount, calculatePrimeRendement(baselineNet, 1));

    console.log("Prime rendement formula, taxable integration, and company feature gate passed.");
} finally {
    for (const restore of restores.reverse()) restore();
}

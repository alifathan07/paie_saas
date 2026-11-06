import assert from "node:assert/strict";
import { prisma } from "./src/lib/db.js";
import { calculateLive } from "./src/controllers/bulletins.controller.js";
import { refreshDraftPayslips } from "./src/services/employeePayrollRefresh.service.js";

const employee = {
    id: 7,
    companyId: 3,
    baseSalary: 12000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    actif: true,
    blocageSaisiePaie: false,
    company: {
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
        overtimeEnabled: true,
    },
    bonuses: [
        {
            amount: 500,
            bonus: { name: "Prime de performance", code: "P01", taxable: true, defaultAmount: 100 },
        },
        {
            amount: 300,
            bonus: { name: "Transport", code: "N01", taxable: false, defaultAmount: 100 },
        },
    ],
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
    mock(prisma.payslip, "findMany", async () => []);

    const response = {
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
    };
    await calculateLive({
        params: { id: "7" },
        session: { user: { activeCompanyId: 3 } },
        query: {
            month: "9",
            year: "2026",
            primesLabels: ["Prime de performance"],
            primesAmounts: ["0"],
        },
    }, response);

    assert.equal(response.body.ok, true);
    assert.deepEqual(
        response.body.variablePrimes.map(({ label, amount }) => ({ label, amount })),
        [{ label: "Prime de performance", amount: 0 }],
    );
    assert.equal(response.body.nimpLines.find(line => line.label === "Transport").amount, 100);

    const persistedBonusRows = [];
    const draftPayslip = {
        id: 88,
        month: 9,
        year: 2026,
        status: "DRAFT",
        workedDays: 26,
        workedHours: 191,
        workingTimeMode: "DAYS",
        standardMonthlyDays: 26,
        standardMonthlyHours: 191,
        bonuses: [{ name: "Prime de performance", amount: 0, taxable: true }],
    };
    let draftRead = false;
    const tx = {
        payslip: {
            async findMany({ where }) {
                if (!draftRead && where.status) {
                    draftRead = true;
                    return [draftPayslip];
                }
                return [];
            },
            async update({ data }) { return { ...draftPayslip, ...data }; },
        },
        payrollConfig: { async findFirst() { return null; } },
        payslipBonus: {
            async deleteMany() {},
            async createMany({ data }) { persistedBonusRows.push(...data); },
        },
    };
    await refreshDraftPayslips(tx, employee);
    assert.deepEqual(
        persistedBonusRows.filter(row => row.taxable).map(({ name, amount }) => ({ name, amount })),
        [{ name: "Prime de performance", amount: 0 }],
    );

    console.log("Taxable prime zero overrides pass through preview and draft refresh; NIMP ceiling remains intact.");
} finally {
    for (const restore of restores.reverse()) restore();
}

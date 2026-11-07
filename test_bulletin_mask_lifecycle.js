import assert from "node:assert/strict";
import prisma from "./db.ts";
import { employeeBulletinVisibilityWhere } from "./src/lib/bulletinMask.js";
import { maskBulletin } from "./src/controllers/bulletins.controller.js";
import { updateEmployee } from "./src/services/employeeService.js";

const originals = [];
function mock(target, key, value) {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = value;
}

const employeeUpdates = [];
const employee = {
    id: 7,
    companyId: 3,
    blocageSaisiePaie: true,
    actif: true,
    baseSalary: 5000,
    dateEmbauche: new Date("2020-01-01"),
    nbPersonacharge: 0,
    bonuses: [],
    company: { workingTimeMode: "DAYS", standardMonthlyDays: 26, standardMonthlyHours: 191 },
};
const blockedDraft = {
    id: 20,
    employeeId: 7,
    month: 9,
    year: 2026,
    status: "GENERATED",
    workedDays: 0,
    workedHours: 0,
    workingTimeMode: "DAYS",
    standardMonthlyDays: 26,
    standardMonthlyHours: 191,
    bonuses: [],
    retenus: [],
    heuresSup25: 0,
    heuresSup50: 0,
    heuresSup100: 0,
    primeRendementInput: 0,
    paidLeaveDays: 0,
    congeNaissanceDays: 0,
    joursFeries: 0,
    absenceDays: 0,
    avanceDeduction: 0,
};
const blockedHoursDraft = {
    ...blockedDraft,
    id: 21,
    month: 10,
    workingTimeMode: "HOURS",
};
const refreshedPayslips = new Map();
mock(prisma.employee, "findFirst", async () => ({ id: 7, companyId: 3, blocageSaisiePaie: true }));
mock(prisma.company, "findUnique", async () => ({ chantiersEnabled: true }));
mock(prisma.employee, "update", async ({ data }) => {
    employeeUpdates.push(data);
    const definedData = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    return {
        ...employee,
        ...definedData,
        company: { ...employee.company, overtimeEnabled: true, primeRendementEnabled: false },
    };
});
mock(prisma.payslip, "findMany", async ({ where }) => {
    if (where.status?.in && where.month === undefined && where.OR === undefined) {
        assert.deepEqual(where.status, { in: ["DRAFT", "GENERATED"] });
        return [blockedDraft, blockedHoursDraft];
    }
    return [];
});
mock(prisma.payrollConfig, "findFirst", async () => null);
mock(prisma.payslip, "update", async ({ data }) => {
    const id = data.month === blockedHoursDraft.month ? blockedHoursDraft.id : blockedDraft.id;
    refreshedPayslips.set(id, data);
    return { id, ...data };
});
mock(prisma.payslipBonus, "deleteMany", async () => ({ count: 0 }));
mock(prisma, "$transaction", async callback => callback(prisma));

try {
    const response = {
        redirect(url) { this.url = url; return this; },
        status(code) { this.code = code; return this; },
        send(body) { this.body = body; return this; },
    };
    await maskBulletin({
        params: { id: "7" },
        body: { month: "9", year: "2026", scope: "future" },
        session: { user: { activeCompanyId: 3 } },
    }, response);
    assert.equal(response.url, "/bulletins?month=9&year=2026");
    assert.equal(employeeUpdates[0].bulletinMasque, true);
    assert.equal(employeeUpdates[0].bulletinMasqueDepuis, 202609);

    assert.deepEqual(employeeBulletinVisibilityWhere(8, 2026), {
        OR: [
            { bulletinMasque: false },
            { bulletinMasqueDepuis: { gt: 202608 } },
        ],
    }, "The employee remains visible before the selected masking month");
    assert.deepEqual(employeeBulletinVisibilityWhere(9, 2026), {
        OR: [
            { bulletinMasque: false },
            { bulletinMasqueDepuis: { gt: 202609 } },
        ],
    }, "The employee is hidden from the selected month onward while blocked");

    await updateEmployee(7, { blocageSaisiePaie: false }, 3);
    assert.equal(employeeUpdates[1].blocageSaisiePaie, false);
    assert.equal(employeeUpdates[1].bulletinMasque, false);
    assert.equal(employeeUpdates[1].bulletinMasqueDepuis, null);
    const refreshedDaysPayslip = refreshedPayslips.get(blockedDraft.id);
    assert.equal(Number(refreshedDaysPayslip.workedDays), 26);
    assert.ok(Number(refreshedDaysPayslip.sbg) > 0, "Unblocking must recalculate a previously zeroed draft");
    assert.ok(Number(refreshedDaysPayslip.netAPayer) > 0, "The refreshed draft must have a nonzero payable amount");
    const refreshedHoursPayslip = refreshedPayslips.get(blockedHoursDraft.id);
    assert.equal(Number(refreshedHoursPayslip.workedHours), 191);
    assert.ok(Number(refreshedHoursPayslip.sbg) > 0, "Hour-mode drafts must also be restored when unblocked");

    console.log("Bulletin mask lifecycle checks passed.");
} finally {
    for (const restore of originals.reverse()) restore();
    await prisma.$disconnect();
}

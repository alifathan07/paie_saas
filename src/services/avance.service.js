import { prisma } from "../lib/db.js";

function companyKey(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("NO_ACTIVE_COMPANY");
    return id;
}

function parseAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("INVALID_ADVANCE_AMOUNT");
    return Number(amount.toFixed(2));
}

function parseDate(value) {
    const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00`);
    if (!value || Number.isNaN(date.getTime())) throw new Error("INVALID_ADVANCE_DATE");
    return date;
}

export async function listAvances(companyId) {
    const id = companyKey(companyId);
    return prisma.avance.findMany({
        where: { employee: { companyId: id } },
        include: { employee: { select: { id: true, matricule: true, nomComplet: true } } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
    });
}

export async function listCompanyEmployees(companyId) {
    const id = companyKey(companyId);
    return prisma.employee.findMany({
        where: { companyId: id, actif: true },
        select: { id: true, matricule: true, nomComplet: true },
        orderBy: [{ nomComplet: "asc" }, { matricule: "asc" }],
    });
}

export async function createAvance(companyId, data) {
    const id = companyKey(companyId);
    const matricule = String(data.matricule || "").trim();
    if (!matricule) throw new Error("EMPLOYEE_MATRICULE_REQUIRED");
    const employee = await prisma.employee.findFirst({
        where: { companyId: id, matricule },
        select: { id: true },
    });
    if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
    const amount = parseAmount(data.amount);
    const date = parseDate(data.date);
    return prisma.avance.create({
        data: { employeeId: employee.id, amount, solde: amount, date },
        include: { employee: { select: { id: true, matricule: true, nomComplet: true } } },
    });
}

export async function listEmployeeAvances(employeeId) {
    return prisma.avance.findMany({
        where: { employeeId: Number(employeeId), solde: { gt: 0 } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, solde: true, date: true },
    });
}

export async function deductAvance({ companyId, employeeId, month, year, avanceId, amount }) {
    const deduction = parseAmount(amount);
    const company = companyKey(companyId);
    return prisma.$transaction(async tx => {
        const payslip = await tx.payslip.findFirst({
            where: { employeeId: Number(employeeId), month: Number(month), year: Number(year), employee: { companyId: company } },
            select: { id: true, status: true, avanceDeduction: true, netAPayer: true },
        });
        if (!payslip) throw new Error("PAYSLIP_REQUIRED");
        if (["VALIDATED", "CLOSED"].includes(payslip.status)) throw new Error("BULLETIN_LOCKED");
        const updated = await tx.avance.updateMany({
            where: { id: Number(avanceId), employeeId: Number(employeeId), solde: { gte: deduction } },
            data: { solde: { decrement: deduction } },
        });
        if (updated.count !== 1) throw new Error("ADVANCE_BALANCE_TOO_LOW");
        const row = await tx.avanceDeduction.create({ data: { avanceId: Number(avanceId), payslipId: payslip.id, amount: deduction } });
        const total = Number((Number(payslip.avanceDeduction || 0) + deduction).toFixed(2));
        await tx.payslip.update({ where: { id: payslip.id }, data: { avanceDeduction: total, netAPayer: Math.max(0, Number((Number(payslip.netAPayer || 0) - deduction).toFixed(2))) } });
        return row;
    });
}

export async function setAvanceDeduction({ companyId, employeeId, month, year, amount }) {
    const requested = Number(amount);
    if (!Number.isFinite(requested) || requested < 0) throw new Error("INVALID_ADVANCE_AMOUNT");
    const company = companyKey(companyId);
    return prisma.$transaction(async tx => {
        const payslip = await tx.payslip.findFirst({
            where: { employeeId: Number(employeeId), month: Number(month), year: Number(year), employee: { companyId: company } },
            select: { id: true, status: true, avanceDeduction: true, netAPayer: true },
        });
        if (!payslip) throw new Error("PAYSLIP_REQUIRED");
        if (["VALIDATED", "CLOSED"].includes(payslip.status)) throw new Error("BULLETIN_LOCKED");

        const previous = await tx.avanceDeduction.findMany({ where: { payslipId: payslip.id } });
        const previousTotal = previous.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        for (const row of previous) {
            await tx.avance.update({ where: { id: row.avanceId }, data: { solde: { increment: row.amount } } });
        }
        await tx.avanceDeduction.deleteMany({ where: { payslipId: payslip.id } });

        const advances = await tx.avance.findMany({
            where: { employeeId: Number(employeeId), solde: { gt: 0 } },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            select: { id: true, solde: true },
        });
        const available = advances.reduce((sum, row) => sum + Number(row.solde || 0), 0);
        if (requested > available + 0.005) throw new Error("ADVANCE_BALANCE_TOO_LOW");

        let remaining = Number(requested.toFixed(2));
        for (const advance of advances) {
            if (remaining <= 0) break;
            const part = Math.min(remaining, Number(advance.solde));
            if (part <= 0) continue;
            await tx.avance.update({ where: { id: advance.id }, data: { solde: { decrement: part } } });
            await tx.avanceDeduction.create({ data: { avanceId: advance.id, payslipId: payslip.id, amount: Number(part.toFixed(2)) } });
            remaining = Number((remaining - part).toFixed(2));
        }
        const originalNet = Number(payslip.netAPayer || 0) + previousTotal;
        await tx.payslip.update({
            where: { id: payslip.id },
            data: { avanceDeduction: Number(requested.toFixed(2)), avanceDeductionConfigured: true, netAPayer: Math.max(0, Number((originalNet - requested).toFixed(2))) },
        });
    });
}

export async function removeAvanceDeduction({ companyId, employeeId, month, year, deductionId }) {
    const company = companyKey(companyId);
    return prisma.$transaction(async tx => {
        const payslip = await tx.payslip.findFirst({
            where: { employeeId: Number(employeeId), month: Number(month), year: Number(year), employee: { companyId: company } },
            select: { id: true, status: true, avanceDeduction: true, netAPayer: true },
        });
        if (!payslip) throw new Error("PAYSLIP_REQUIRED");
        if (["VALIDATED", "CLOSED"].includes(payslip.status)) throw new Error("BULLETIN_LOCKED");
        const row = await tx.avanceDeduction.findFirst({ where: { id: Number(deductionId), payslipId: payslip.id } });
        if (!row) throw new Error("DEDUCTION_NOT_FOUND");
        await tx.avance.update({ where: { id: row.avanceId }, data: { solde: { increment: row.amount } } });
        await tx.avanceDeduction.delete({ where: { id: row.id } });
        const total = Math.max(0, Number((Number(payslip.avanceDeduction || 0) - Number(row.amount)).toFixed(2)));
        await tx.payslip.update({ where: { id: payslip.id }, data: { avanceDeduction: total, netAPayer: Number((Number(payslip.netAPayer || 0) + Number(row.amount)).toFixed(2)) } });
        return row;
    });
}

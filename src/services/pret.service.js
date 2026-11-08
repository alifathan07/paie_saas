import { prisma } from "../lib/db.js";

function companyKey(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("NO_ACTIVE_COMPANY");
    return id;
}

function parseAmount(value, allowZero = false) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || (allowZero ? amount < 0 : amount <= 0)) throw new Error("INVALID_PRET_AMOUNT");
    return Number(amount.toFixed(2));
}

function parseDate(value) {
    const date = new Date(`${String(value || "").slice(0, 10)}T00:00:00`);
    if (!value || Number.isNaN(date.getTime())) throw new Error("INVALID_PRET_DATE");
    return date;
}

export async function listPrets(companyId) {
    return prisma.pret.findMany({
        where: { employee: { companyId: companyKey(companyId) } },
        include: { employee: { select: { id: true, matricule: true, nomComplet: true } } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
    });
}

export async function listCompanyEmployees(companyId) {
    return prisma.employee.findMany({
        where: { companyId: companyKey(companyId), blocageSaisiePaie: false },
        select: { id: true, matricule: true, nomComplet: true },
        orderBy: [{ nomComplet: "asc" }, { matricule: "asc" }],
    });
}

export async function createPret(companyId, data) {
    const matricule = String(data.matricule || "").trim();
    if (!matricule) throw new Error("EMPLOYEE_MATRICULE_REQUIRED");
    const employee = await prisma.employee.findFirst({ where: { companyId: companyKey(companyId), matricule }, select: { id: true } });
    if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
    const amount = parseAmount(data.amount);
    const monthlyAmount = parseAmount(data.monthlyAmount, true);
    if (monthlyAmount > amount) throw new Error("INVALID_PRET_MONTHLY_AMOUNT");
    return prisma.pret.create({
        data: { employeeId: employee.id, amount, monthlyAmount, solde: amount, date: parseDate(data.date) },
        include: { employee: { select: { id: true, matricule: true, nomComplet: true } } },
    });
}

export async function updatePret(companyId, pretId, data) {
    const company = companyKey(companyId);
    const amount = parseAmount(data.amount);
    const monthlyAmount = parseAmount(data.monthlyAmount, true);
    if (monthlyAmount > amount) throw new Error("INVALID_PRET_MONTHLY_AMOUNT");
    return prisma.$transaction(async tx => {
        const pret = await tx.pret.findFirst({
            where: { id: Number(pretId), employee: { companyId: company } },
            include: { deductions: { select: { amount: true } } },
        });
        if (!pret) throw new Error("PRET_NOT_FOUND");
        const repaid = pret.deductions.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        if (amount + 0.005 < repaid) throw new Error("PRET_AMOUNT_BELOW_REPAID");
        const solde = Number((amount - repaid).toFixed(2));
        return tx.pret.update({ where: { id: pret.id }, data: { amount, monthlyAmount, solde } });
    });
}

export async function listEmployeePrets(employeeId) {
    return prisma.pret.findMany({
        where: { employeeId: Number(employeeId), solde: { gt: 0 } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { id: true, amount: true, monthlyAmount: true, solde: true, date: true },
    });
}

export async function setPretDeduction({ companyId, employeeId, month, year, amount }) {
    const requested = parseAmount(amount, true);
    return prisma.$transaction(async tx => {
        const payslip = await tx.payslip.findFirst({
            where: { employeeId: Number(employeeId), month: Number(month), year: Number(year), employee: { companyId: companyKey(companyId) } },
            select: { id: true, status: true, pretDeduction: true, netAPayer: true },
        });
        if (!payslip) throw new Error("PAYSLIP_REQUIRED");
        if (["VALIDATED", "CLOSED"].includes(payslip.status)) throw new Error("BULLETIN_LOCKED");

        const previous = await tx.pretDeduction.findMany({ where: { payslipId: payslip.id } });
        const previousTotal = previous.reduce((sum, row) => sum + Number(row.amount || 0), 0);
        for (const row of previous) await tx.pret.update({ where: { id: row.pretId }, data: { solde: { increment: row.amount } } });
        await tx.pretDeduction.deleteMany({ where: { payslipId: payslip.id } });

        const prets = await tx.pret.findMany({
            where: { employeeId: Number(employeeId), solde: { gt: 0 } },
            orderBy: [{ date: "asc" }, { id: "asc" }],
            select: { id: true, solde: true },
        });
        const available = prets.reduce((sum, row) => sum + Number(row.solde || 0), 0);
        if (requested > available + 0.005) throw new Error("PRET_BALANCE_TOO_LOW");
        let remaining = requested;
        for (const pret of prets) {
            if (remaining <= 0) break;
            const part = Math.min(remaining, Number(pret.solde));
            if (part <= 0) continue;
            await tx.pret.update({ where: { id: pret.id }, data: { solde: { decrement: part } } });
            await tx.pretDeduction.create({ data: { pretId: pret.id, payslipId: payslip.id, amount: Number(part.toFixed(2)) } });
            remaining = Number((remaining - part).toFixed(2));
        }
        const originalNet = Number(payslip.netAPayer || 0) + previousTotal;
        await tx.payslip.update({
            where: { id: payslip.id },
            data: { pretDeduction: requested, pretDeductionConfigured: true, netAPayer: Math.max(0, Number((originalNet - requested).toFixed(2))) },
        });
    });
}

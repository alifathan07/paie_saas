import { prisma } from "../lib/db.js";

const logPret = (event, details) => console.info("[pret]", JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
const errorDetails = error => ({
    name: error?.name,
    message: error?.message,
    code: error?.code,
    meta: error?.meta,
    stack: error?.stack,
});

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

export async function createPret(companyId, data, { requestId = null } = {}) {
    let stage = "validate_company";
    try {
        const company = companyKey(companyId);
        stage = "validate_input";
        const matricule = String(data.matricule || "").trim();
        if (!matricule) throw new Error("EMPLOYEE_MATRICULE_REQUIRED");
        const amount = parseAmount(data.amount);
        const monthlyAmount = parseAmount(data.monthlyAmount, true);
        if (monthlyAmount > amount) throw new Error("INVALID_PRET_MONTHLY_AMOUNT");
        const date = parseDate(data.date);

        stage = "find_employee";
        const employee = await prisma.employee.findFirst({ where: { companyId: company, matricule }, select: { id: true } });
        if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");

        stage = "insert_pret";
        const pret = await prisma.pret.create({
            data: { employeeId: employee.id, amount, monthlyAmount, solde: amount, date },
            include: { employee: { select: { id: true, matricule: true, nomComplet: true } } },
        });
        logPret("create.service.completed", { requestId, companyId: company, employeeId: employee.id, pretId: pret.id });
        return pret;
    } catch (error) {
        logPret("create.service.failed", { requestId, companyId, stage, error: errorDetails(error) });
        throw error;
    }
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

export async function setPretDeduction({ companyId, employeeId, month, year, amount, client = prisma }) {
    let stage = "validate_amount";
    let payslipId = null;
    let allocatedAmount = 0;
    try {
        const requested = parseAmount(amount, true);
        const reconcile = async tx => {
            stage = "find_payslip";
            const payslip = await tx.payslip.findFirst({
                where: { employeeId: Number(employeeId), month: Number(month), year: Number(year), employee: { companyId: companyKey(companyId) } },
                select: { id: true, status: true, pretDeduction: true, netAPayer: true },
            });
            if (!payslip) throw new Error("PAYSLIP_REQUIRED");
            if (["VALIDATED", "CLOSED"].includes(payslip.status)) throw new Error("BULLETIN_LOCKED");
            payslipId = payslip.id;

            stage = "restore_previous_allocations";
            const previous = await tx.pretDeduction.findMany({ where: { payslipId: payslip.id } });
            const previousTotal = previous.reduce((sum, row) => sum + Number(row.amount || 0), 0);
            for (const row of previous) await tx.pret.update({ where: { id: row.pretId }, data: { solde: { increment: row.amount } } });
            await tx.pretDeduction.deleteMany({ where: { payslipId: payslip.id } });

            stage = "load_available_loans";
            const prets = await tx.pret.findMany({
                where: { employeeId: Number(employeeId), solde: { gt: 0 } },
                orderBy: [{ date: "asc" }, { id: "asc" }],
                select: { id: true, solde: true },
            });
            const available = prets.reduce((sum, row) => sum + Number(row.solde || 0), 0);
            if (requested > available + 0.005) throw new Error("PRET_BALANCE_TOO_LOW");
            let remaining = requested;
            stage = "allocate_loans";
            for (const pret of prets) {
                if (remaining <= 0) break;
                const part = Math.min(remaining, Number(pret.solde));
                if (part <= 0) continue;
                await tx.pret.update({ where: { id: pret.id }, data: { solde: { decrement: part } } });
                await tx.pretDeduction.create({ data: { pretId: pret.id, payslipId: payslip.id, amount: Number(part.toFixed(2)) } });
                allocatedAmount = Number((allocatedAmount + part).toFixed(2));
                remaining = Number((remaining - part).toFixed(2));
            }
            const originalNet = Number(payslip.netAPayer || 0) + previousTotal;
            stage = "update_payslip";
            await tx.payslip.update({
                where: { id: payslip.id },
                data: { pretDeduction: requested, pretDeductionConfigured: true, netAPayer: Math.max(0, Number((originalNet - requested).toFixed(2))) },
            });
        };
        if (client === prisma) await prisma.$transaction(reconcile);
        else await reconcile(client);
        if (client === prisma) {
            logPret("deduction.applied", { companyId, employeeId, month, year, payslipId, amount: requested, allocatedAmount });
        }
    } catch (error) {
        logPret("deduction.failed", {
            companyId,
            employeeId,
            month,
            year,
            payslipId,
            stage,
            error: errorDetails(error),
        });
        throw error;
    }
}

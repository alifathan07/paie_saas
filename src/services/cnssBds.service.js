import { prisma } from "../lib/db.js";
import {
    generateCnssBdsFile,
} from "../payroll-engine/reports/cnssBds.report.js";

const INCLUDED_STATUSES = ["GENERATED", "VALIDATED", "CLOSED"];

export async function generateMonthlyCnssBdsFile(companyId, month, year, templateFile) {
    const company = await prisma.company.findUnique({
        where: { id: Number(companyId) },
        select: { id: true, numeroAffiliationCnss: true },
    });
    if (!company) throw new Error("COMPANY_NOT_FOUND");
    const companyAffiliation = String(company.numeroAffiliationCnss || "").trim();
    if (!companyAffiliation) throw new Error("COMPANY_CNSS_NUMBER_MISSING");

    const payrollConfig = await prisma.payrollConfig.findFirst({ orderBy: { id: "asc" }, select: { cnssPlafond: true } });
    const payslips = await prisma.payslip.findMany({
        where: {
            month: Number(month),
            year: Number(year),
            status: { in: INCLUDED_STATUSES },
            employee: { companyId: Number(companyId) },
        },
        select: {
            workedDays: true,
            sbg: true,
            sbi: true,
            employee: { select: { matricule: true, nomComplet: true, cin: true, numeroCNSS: true, blocageSaisiePaie: true, blocageSaisiePaieMotif: true } },
        },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");

    const blockedEmployees = await prisma.employee.findMany({
        where: {
            companyId: Number(companyId),
            blocageSaisiePaie: true,
            numeroCNSS: { not: null },
        },
        select: { numeroCNSS: true },
    });
    const blockedCnss = new Set(blockedEmployees.map(employee => String(employee.numeroCNSS).trim()));

    const payrollData = payslips.filter(payslip => !payslip.employee.blocageSaisiePaie).map(payslip => {
        const cnss = String(payslip.employee.numeroCNSS || "").trim();
        if (!/^\d{9}$/.test(cnss)) throw new Error(`EMPLOYEE_CNSS_MISSING:${payslip.employee.matricule}`);
        const blocked = Boolean(payslip.employee.blocageSaisiePaie);
        return {
            cnss_immatriculation: cnss,
            employeeName: payslip.employee.nomComplet,
            cin: payslip.employee.cin,
            days_worked: blocked ? 0 : Number(payslip.workedDays),
            // CNSS BDS real salary is the taxable gross base. Non-taxable
            // indemnities included in brut global must not be declared here.
            gross_salary: blocked ? 0 : payslip.sbi,
            bds_situation: blocked ? (payslip.employee.blocageSaisiePaieMotif || "MS") : undefined,
        };
    });

    return generateCnssBdsFile(templateFile, payrollData, {
        affiliation: companyAffiliation,
        period: `${year}${String(month).padStart(2, "0")}`,
        excludedPreEstablishedCnss: [...blockedCnss],
        salaryCeilingCents: Math.round(Number(payrollConfig?.cnssPlafond ?? 6000) * 100),
    });
}

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
            employee: { select: { matricule: true, numeroCNSS: true } },
        },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");

    const payrollData = payslips.map(payslip => {
        const cnss = String(payslip.employee.numeroCNSS || "").trim();
        if (!/^\d{9}$/.test(cnss)) {
            throw new Error(`EMPLOYEE_CNSS_MISSING:${payslip.employee.matricule}`);
        }
        return {
            cnss_immatriculation: cnss,
            days_worked: Number(payslip.workedDays),
            // These are the saved bulletin gross and AMO base used by payroll reports.
            gross_salary: payslip.sbg,
            amo_salary_base: payslip.sbi,
        };
    });

    return generateCnssBdsFile(templateFile, payrollData);
}

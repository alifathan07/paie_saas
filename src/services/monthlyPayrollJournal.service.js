import { prisma } from "../lib/db.js";

const INCLUDED_STATUSES = ["GENERATED", "VALIDATED", "CLOSED"];
const round = value => Number(Number(value || 0).toFixed(2));

export async function getMonthlyPayrollJournal(companyId, month, year) {
    const company = await prisma.company.findUnique({ where: { id: Number(companyId) } });
    if (!company) throw new Error("COMPANY_NOT_FOUND");

    const payslips = await prisma.payslip.findMany({
        where: {
            month: Number(month),
            year: Number(year),
            status: { in: INCLUDED_STATUSES },
            employee: { companyId: Number(companyId) },
        },
        include: { employee: { select: { matricule: true, nomComplet: true } } },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");

    const rows = payslips.map(payslip => ({
        payslipId: payslip.id,
        matricule: payslip.employee.matricule,
        nomPrenom: payslip.employee.nomComplet,
        nbHr: payslip.workingTimeMode === "HOURS" && payslip.workedHours !== null && payslip.workedHours !== undefined
            ? round(payslip.workedHours)
            : "",
        jours: round(payslip.workedDays),
        brut: round(payslip.sbg),
        retraite: round(payslip.cimr),
        baseIr: round(payslip.sni),
        // These values are read from the selected bulletin. The journal must
        // never recalculate IR or replace the bulletin's stored deductions.
        ir: round(payslip.irNet),
        cnss: round(payslip.cnss),
        mutuel: round(payslip.amo),
        net: round(payslip.netAPayer),
    }));

    const sum = key => round(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
    return {
        company: { id: company.id, name: company.name },
        month: Number(month),
        year: Number(year),
        generatedAt: new Date(),
        rows,
        totals: {
            effectif: rows.length,
            nbHr: sum("nbHr"),
            jours: sum("jours"),
            brut: sum("brut"),
            retraite: sum("retraite"),
            baseIr: sum("baseIr"),
            ir: sum("ir"),
            cnss: sum("cnss"),
            mutuel: sum("mutuel"),
            net: sum("net"),
        },
    };
}

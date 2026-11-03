import { prisma } from "../lib/db.js";

const INCLUDED_STATUSES = ["GENERATED", "VALIDATED", "CLOSED"];
const round = value => Number(Number(value || 0).toFixed(2));

export async function getMonthlyIrReport(companyId, month, year) {
    const company = await prisma.company.findUnique({ where: { id: Number(companyId) } });
    if (!company) throw new Error("COMPANY_NOT_FOUND");

    const payslips = await prisma.payslip.findMany({
        where: {
            month: Number(month),
            year: Number(year),
            status: { in: INCLUDED_STATUSES },
            employee: { companyId: Number(companyId) },
        },
        include: {
            employee: {
                select: {
                    matricule: true,
                    nomComplet: true,
                    nbPersonacharge: true,
                    nbEnfantCharge: true,
                },
            },
        },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");

    const rows = payslips.map(payslip => {
        const dependentsCount = Number(payslip.chargesDeFamille || 0) > 0
            ? Math.round(Number(payslip.chargesDeFamille) / 50)
            : (payslip.employee?.nbPersonacharge || 0);

        const brutInd = round(
            Number(payslip.brutGlobal) > 0
                ? payslip.brutGlobal
                : (Number(payslip.sbi || 0) + Number(payslip.bonusesNIMP || 0))
        );
        const indemnites = round(payslip.bonusesNIMP);
        const salBrut = round(payslip.sbi);
        const baseIr = round(payslip.sni);
        const ir = round(payslip.irNet);
        const jours = round(payslip.workedDays);

        return {
            payslipId: payslip.id,
            matricule: payslip.employee.matricule,
            nomPrenom: payslip.employee.nomComplet,
            enfants: dependentsCount > 0 ? dependentsCount : "",
            jours,
            brutInd,
            indemnites,
            salBrut,
            baseIr,
            ir,
        };
    });

    const sum = key => round(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
    return {
        company: { id: company.id, name: company.name },
        month: Number(month),
        year: Number(year),
        generatedAt: new Date(),
        rows,
        totals: {
            effectif: rows.length,
            jours: sum("jours"),
            brutInd: sum("brutInd"),
            indemnites: sum("indemnites"),
            salBrut: sum("salBrut"),
            baseIr: sum("baseIr"),
            ir: sum("ir"),
        },
    };
}

import { prisma } from "../lib/db.js";
import { calculateCNSSPatronale } from "../payroll-engine/calculators/cnss.calculator.js";
import { calculateAMOPatronale } from "../payroll-engine/calculators/amo.calculator.js";

const INCLUDED_STATUSES = ["GENERATED", "VALIDATED", "CLOSED"];
const round = value => Number(Number(value || 0).toFixed(2));

export async function getMonthlyContributionReports(companyId, month, year) {
    const company = await prisma.company.findUnique({ where: { id: Number(companyId) } });
    if (!company) throw new Error("COMPANY_NOT_FOUND");
    if (!String(company.numeroAffiliationCnss || "").trim()) throw new Error("COMPANY_CNSS_NUMBER_MISSING");
    const payslips = await prisma.payslip.findMany({
        where: { month: Number(month), year: Number(year), status: { in: INCLUDED_STATUSES }, employee: { companyId: Number(companyId) } },
        include: { employee: { select: { matricule: true, nomComplet: true, cin: true, numeroCNSS: true } } },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");
    const rows = payslips.map(payslip => {
        // Contribution reports are historical statements: use the values
        // saved on the selected bulletin, never recalculate the employee.
        const sbi = round(payslip.sbi);
        const patronale = calculateCNSSPatronale(sbi);
        const amoPatronale = calculateAMOPatronale(sbi);
        const cnssSalariale = round(payslip.cnss);
        const allocFam = round(patronale.allocationsFamiliales);
        const prestations = round(patronale.prestationsSociales);
        const formation = round(patronale.formationProfessionnelle);
        const patronaleTotal = round(allocFam + prestations + formation);
        return {
            payslipId: payslip.id, matricule: payslip.employee.matricule, nomPrenom: payslip.employee.nomComplet,
            cin: payslip.employee.cin, numeroCNSS: payslip.employee.numeroCNSS || "—",
            jours: round(payslip.workedDays), jrCg: round(payslip.paidLeaveDays),
            totalJours: round(Number(payslip.workedDays) + Number(payslip.paidLeaveDays)),
            sansLimitePlafonne: sbi, dansLimitePlafonne: round(Math.min(sbi, 6000)),
            retenuSal: cnssSalariale, allocFam, prestations, formation,
            cotisTot: round(cnssSalariale + patronaleTotal), patronaleTotal,
            amoParticipation: round(sbi * 0.0185),
            amoSalariale: round(payslip.amo),
            amoPatronale: round(amoPatronale),
            amoCotisTot: round((sbi * 0.0185) + Number(payslip.amo || 0) + amoPatronale),
        };
    });
    const sum = key => round(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
    const cnssTotals = {
        effectif: rows.length, jours: sum("jours"), jrCg: sum("jrCg"), totalJours: sum("totalJours"),
        sansLimitePlafonne: sum("sansLimitePlafonne"), dansLimitePlafonne: sum("dansLimitePlafonne"),
        retenuSal: sum("retenuSal"), allocFam: sum("allocFam"), prestations: sum("prestations"),
        formation: sum("formation"), cotisTot: sum("cotisTot"), patronaleTotal: sum("patronaleTotal"),
    };
    const amoTotals = {
        effectif: rows.length,
        masse: sum("sansLimitePlafonne"),
        participationRate: 0.0185,
        salarialesRate: 0.0226,
        patronalesRate: 0.0411,
        participation: sum("amoParticipation"),
        participationParPersonne: rows.length ? round(sum("amoParticipation") / rows.length) : 0,
        salariales: sum("amoSalariale"),
        patronales: sum("amoPatronale"),
        cotisTot: sum("amoCotisTot"),
    };
    amoTotals.total = amoTotals.cotisTot;
    return {
        company: { id: company.id, name: company.name, numeroAffiliationCnss: company.numeroAffiliationCnss },
        month: Number(month), year: Number(year), generatedAt: new Date(), rows, cnssTotals, amoTotals,
        transfer: {
            allocation: cnssTotals.allocFam,
            prestations: round(cnssTotals.prestations + cnssTotals.retenuSal),
            formation: cnssTotals.formation,
            total: round(cnssTotals.allocFam + cnssTotals.prestations + cnssTotals.retenuSal + cnssTotals.formation),
            salariales: cnssTotals.retenuSal,
            patronales: round(cnssTotals.allocFam + cnssTotals.prestations + cnssTotals.formation),
        },
    };
}

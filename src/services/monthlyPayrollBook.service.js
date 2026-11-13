import { prisma } from "../lib/db.js";

const INCLUDED_STATUSES = ["GENERATED", "VALIDATED", "CLOSED"];
const round = value => Number(Number(value || 0).toFixed(2));
const percent = (amount, base) => base > 0 ? round((amount / base) * 100) : 0;

export async function getMonthlyPayrollBook(companyId, month, year) {
    const id = Number(companyId);
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) throw new Error("COMPANY_NOT_FOUND");

    const payslips = await prisma.payslip.findMany({
        where: { month: Number(month), year: Number(year), status: { in: INCLUDED_STATUSES }, employee: { companyId: id } },
        include: { employee: { include: { employeeFunction: { select: { name: true } } } } },
        orderBy: [{ employee: { matricule: "asc" } }, { id: "asc" }],
    });
    if (!payslips.length) throw new Error("NO_MONTHLY_PAYROLL");

    const rows = payslips.map(payslip => {
        const employee = payslip.employee;
        const baseSalary = round(payslip.baseSalary);
        const hours = round(payslip.standardMonthlyHours || payslip.workedHours);
        return {
            numero: employee.matricule,
            matricule: employee.matricule,
            nomPrenom: employee.nomComplet,
            numeroCNSS: employee.numeroCNSS || "",
            emploi: employee.employeeFunction?.name || "",
            dateNaissance: employee.dateNaissance,
            dateEmbauche: employee.dateEmbauche,
            sexe: employee.sexe || "",
            situationFamiliale: employee.situationFam === "MARIE" ? "M" : employee.situationFam === "CELIBATAIRE" ? "C" : "",
            enfants: Number(employee.nbEnfantCharge || 0),
            heuresNormales: hours,
            tauxHoraire: hours > 0 ? round(baseSalary / hours) : 0,
            hs25: round(payslip.heuresSup25),
            hs50: round(payslip.heuresSup50),
            hs100: round(payslip.heuresSup100),
            jours: round(payslip.workedDays),
            joursConge: round(payslip.paidLeaveDays),
            montantConge: round(payslip.paidLeaveAmount),
            // Match the existing historical CNSS report: capped base from the
            // saved taxable salary, without recalculating the payslip.
            plfCns: round(Math.min(Number(payslip.sbi || 0), 6000)),
            salaireBase: baseSalary,
            ancienneteRate: percent(Number(payslip.primeAnciennete), baseSalary),
            anciennete: round(payslip.primeAnciennete),
            primesImposables: round(payslip.bonusesIMP),
            primesNonImposables: round(payslip.bonusesNIMP),
            // No Tahfiz field exists in the current payslip schema. Keep it
            // empty rather than inventing a value in a legal payroll report.
            tahfiz: null,
            salaireBrut: round(payslip.sbg),
            tahfiz: null,
            retraite: round(payslip.cimr),
            mutuelle: null,
            amo: round(payslip.amo),
            salaireNetImposable: round(payslip.sni),
            ir: round(payslip.irNet),
            cnss: round(payslip.cnss),
            avances: round(Number(payslip.avanceDeduction) + Number(payslip.pretDeduction)),
            net: round(payslip.netAPayer),
            // The current schema has no reliable values for unemployment days,
            // mutual reimbursement, IPE, or miscellaneous indemnities.
            // Keep these report cells blank instead of inferring business meaning.
            joursChomage: null,
            remboursementMutuelle: null,
            avanceAc: null,
            indemniteDivers: null,
            ipe: null,
        };
    });

    const sum = key => round(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
    return {
        company: {
            id: company.id,
            name: company.name,
            logoData: company.logoData,
            adresse: company.adresse,
            ville: company.ville,
            ifNumber: company.ifNumber,
            ice: company.ice,
            numeroAffiliationCnss: company.numeroAffiliationCnss,
        },
        month: Number(month),
        year: Number(year),
        generatedAt: new Date(),
        rows,
        totals: Object.fromEntries([
            "heuresNormales", "hs25", "hs50", "hs100", "jours", "joursConge", "montantConge", "plfCns",
            "salaireBase", "anciennete", "primesImposables", "salaireBrut", "retraite",
            "amo", "salaireNetImposable", "ir", "cnss", "avances", "net", "primesNonImposables",
        ].map(key => [key, sum(key)])),
    };
}


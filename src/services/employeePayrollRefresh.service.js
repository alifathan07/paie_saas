import { calculatePayroll } from "../payroll-engine/PayrollEngine.js";
import { normalizeWorkingTime } from "../payroll-engine/utils/workingTime.js";
import { calculateCumulativeIR } from "../payroll-engine/calculators/cumulativeIr.calculator.js";

// GENERATED bulletins are displayed as "Brouillon" in the UI and remain
// editable. They must be refreshed when employee-level payroll attributes,
// including the representation indemnity, change.
const OPEN_STATUSES = ["DRAFT", "GENERATED"];

async function applyDraftCumulativeIR(tx, employeeId, month, year, calc, dependents, payslip) {
    const previous = await tx.payslip.findMany({
        where: { employeeId, year, month: { lt: month }, status: { in: ["VALIDATED", "CLOSED"] } },
        select: { employeeId: true, year: true, month: true, sni: true, irNet: true, chargesDeFamille: true },
    });
    const cumulative = calculateCumulativeIR({ employeeId, year, month, previousPayslips: previous, currentSNI: calc.sni });
    const chargesDeFamille = Number(calc.chargesDeFamille || 0);
    const irNet = Math.max(0, Number((cumulative.currentMonthIR - chargesDeFamille).toFixed(2)));
    const annualRows = await tx.payslip.findMany({
        where: { employeeId, year, OR: [{ status: { in: ["VALIDATED", "CLOSED"] } }, { month }] },
        select: { month: true, workedDays: true, workedHours: true, standardMonthlyDays: true, standardMonthlyHours: true, sni: true, irNet: true, cnss: true, sbi: true, amo: true },
    });
    const annualCumulative = annualRows.reduce((total, row) => ({
        workedDays: total.workedDays + Number(row.workedDays || 0),
        workedHours: total.workedHours + Number(row.workedHours || 0),
        sni: Number((total.sni + Number(row.sni || 0)).toFixed(2)),
        irNet: Number((total.irNet + Number(row.irNet || 0)).toFixed(2)),
        cnss: Number((total.cnss + Number(row.cnss || 0)).toFixed(2)),
        sbi: Number((total.sbi + Number(row.sbi || 0)).toFixed(2)),
        amo: Number((total.amo + Number(row.amo || 0)).toFixed(2)),
    }), { workedDays: 0, workedHours: 0, sni: 0, irNet: 0, cnss: 0, sbi: 0, amo: 0 });

    return {
        ...calc,
        irTaux: cumulative.rate,
        irTheorique: cumulative.theoreticalIR,
        sommeADeduire: cumulative.deduction,
        irBrut: cumulative.currentMonthIR,
        irNet,
        netAPayer: Number((calc.sbg - calc.cnss - calc.amo - calc.cimr - irNet - Number(payslip.avanceDeduction || 0)).toFixed(2)),
        irCumulative: {
            sniCumule: cumulative.cumulativeSNI,
            moisEcoules: cumulative.elapsedPeriods,
            sniAnnuelEstime: cumulative.annualizedSNI,
            irAnnuelEstime: cumulative.annualIR,
            irPrecedent: cumulative.previousIRWithheld,
            irCumule: cumulative.cumulativeIRDue,
        },
        annualCumulative,
    };
}

function payslipData(employee, calc, payslip, rates) {
    const ir = calc.irCumulative;
    return {
        employeeId: employee.id,
        month: payslip.month,
        year: payslip.year,
        workedDays: calc.workedDays,
        workedHours: calc.workedHours,
        paidLeaveDays: calc.paidLeaveDays,
        joursFeries: calc.joursFeries,
        workingTimeMode: calc.workingTimeMode,
        standardMonthlyDays: calc.standardMonthlyDays,
        standardMonthlyHours: calc.standardMonthlyHours,
        status: payslip.status,
        baseSalary: calc.rawBaseSalary,
        primeAnciennete: calc.primeAnciennete,
        bonusesIMP: calc.bonusesIMP,
        bonusesNIMP: calc.bonusesNIMP,
        brutGlobal: calc.brutGlobal ?? calc.sbg,
        baseConge: calc.baseConge,
        paidLeaveAmount: calc.paidLeaveAmount,
        baseFerie: calc.baseFerie,
        joursFeriesAmount: calc.joursFeriesAmount,
        sbg: calc.sbg,
        sbi: calc.sbi,
        cnss: calc.cnss,
        cnssRate: rates.cnssRate,
        amo: calc.amo,
        amoRate: rates.amoRate,
        cimr: calc.cimr || 0,
        cimrRate: calc.cimrRate || null,
        fraisPro: calc.fraisPro,
        fraisProRate: calc.fraisProRate,
        sni: calc.sni,
        irBrut: calc.irBrut,
        irTheorique: calc.irTheorique || 0,
        sommeADeduire: calc.sommeADeduire || 0,
        irRate: calc.irTaux,
        chargesDeFamille: calc.chargesDeFamille,
        irNet: calc.irNet,
        netAPayer: calc.netAPayer,
        absenceDays: payslip.absenceDays || 0,
        absenceDeduction: payslip.absenceDeduction || 0,
        avanceDeduction: payslip.avanceDeduction || 0,
        heuresSup25: calc.heuresSup25,
        heuresSup50: calc.heuresSup50,
        heuresSup100: calc.heuresSup100,
        sniCumule: ir.sniCumule,
        moisEcoules: ir.moisEcoules,
        sniAnnuelEstime: ir.sniAnnuelEstime,
        irAnnuelEstime: ir.irAnnuelEstime,
        irCumule: ir.irCumule,
        irPrecedent: ir.irPrecedent,
        ...ir,
    };
}

async function replacePayslipLines(tx, payslipId, calc) {
    await tx.payslipBonus.deleteMany({ where: { payslipId } });
    const rows = [
        ...(calc.variablePrimes || []).filter(line => line.amount > 0).map(line => ({ payslipId, code: line.code || '', name: line.label, amount: line.amount, taxable: true })),
        ...(calc.nimpLines || []).filter(line => line.amount > 0).map(line => ({ payslipId, code: line.code || '', name: line.label, amount: line.amount, taxable: false })),
    ];
    if (rows.length) await tx.payslipBonus.createMany({ data: rows });
}

export async function refreshDraftPayslips(tx, employee) {
    const drafts = await tx.payslip.findMany({ where: { employeeId: employee.id, status: { in: OPEN_STATUSES } }, include: { bonuses: true } });
    if (!drafts.length) return;
    const config = await tx.payrollConfig.findFirst({ orderBy: { id: "asc" } });
    const rates = {
        cnssRate: config ? Number(config.cnssSalarialeRate) : 0.0448,
        amoRate: config ? Number(config.amoSalarialeRate) : 0.0226,
    };
    const fixedTaxable = new Set((employee.bonuses || []).filter(item => item.bonus?.taxable).map(item => item.bonus.name.toLowerCase()));
    const fixedNimp = new Set((employee.bonuses || []).filter(item => !item.bonus?.taxable).map(item => item.bonus.name.toLowerCase()));

    for (const payslip of drafts) {
        const variablePrimes = payslip.bonuses.filter(line => line.taxable && !fixedTaxable.has(line.name.toLowerCase())).map(line => ({ label: line.name, amount: Number(line.amount) }));
        const monthlyNimpLines = payslip.bonuses.filter(line => !line.taxable && !fixedNimp.has(line.name.toLowerCase())).map(line => ({ label: line.name, amount: Number(line.amount) }));
        const workingTime = normalizeWorkingTime({
            workingTimeMode: payslip.workingTimeMode || employee.company.workingTimeMode,
            standardMonthlyDays: Number(payslip.standardMonthlyDays || employee.company.standardMonthlyDays),
            standardMonthlyHours: Number(payslip.standardMonthlyHours || employee.company.standardMonthlyHours),
            workedDays: payslip.workingTimeMode === "HOURS" ? undefined : payslip.workedDays,
            workedHours: payslip.workingTimeMode === "HOURS" ? payslip.workedHours : undefined,
        });
        const monthly = calculatePayroll(employee, {
            month: payslip.month,
            year: payslip.year,
            ...workingTime,
            heuresSup25: Number(payslip.heuresSup25 || 0),
            heuresSup50: Number(payslip.heuresSup50 || 0),
            heuresSup100: Number(payslip.heuresSup100 || 0),
            paidLeaveDays: Number(payslip.paidLeaveDays || 0),
            joursFeries: Number(payslip.joursFeries || 0),
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyDraftCumulativeIR(tx, employee.id, payslip.month, payslip.year, monthly, employee.nbPersonacharge, payslip);
        const data = payslipData(employee, calc, payslip, rates);
        const updated = await tx.payslip.update({ where: { id: payslip.id }, data });
        await replacePayslipLines(tx, updated.id, calc);
    }
}

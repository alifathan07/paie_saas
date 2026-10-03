/**
 * bulletins.controller.js
 *
 * Production-ready Prisma controller for the Bulletins payroll module.
 * Replaces all mock store calls with real Prisma database queries.
 *
 * Calculations delegated to calculatePayroll() in PayrollEngine.js.
 */

import { prisma } from "../lib/db.js";
import { resolveCompanyId } from "../lib/company.js";
import { calculatePayroll, normalizeWorkedDays, PAYROLL_WORKED_DAYS } from "../payroll-engine/PayrollEngine.js";
import { calculateWorkedHoursFromDays, DEFAULT_STANDARD_MONTHLY_HOURS, DEFAULT_STANDARD_MONTHLY_DAYS, normalizeWorkingTime } from "../payroll-engine/utils/workingTime.js";
import { calculateCumulativeIR } from "../payroll-engine/calculators/cumulativeIr.calculator.js";
import { generateBulletinPdf } from "../pdf/bulletinPdf.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTH_NAMES_FR = [
    "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

const BULLETIN_STATUS = Object.freeze({
    DRAFT: "DRAFT",
    GENERATED: "GENERATED",
    VALIDATED: "VALIDATED",
    CLOSED: "CLOSED",
    ERROR: "ERROR",
});

const isLockedBulletin = (status) => status === BULLETIN_STATUS.VALIDATED || status === BULLETIN_STATUS.CLOSED;
const isClosedBulletin = (status) => status === BULLETIN_STATUS.CLOSED;

function rejectLockedBulletin(res, payslip, action = "modifier") {
    if (!payslip || !isLockedBulletin(payslip.status)) return false;
    const message = payslip.status === BULLETIN_STATUS.CLOSED
        ? "Ce bulletin est clôturé. Seule une indemnité non imposable peut être modifiée."
        : "Ce bulletin est validé et verrouillé. Utilisez Retourner en brouillon avant de le modifier.";
    res.status(403).send(`Impossible de ${action} : ${message}`);
    return true;
}

function fmt(amount) {
    return Number(amount || 0).toLocaleString("fr-MA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function currentYear() { return new Date().getFullYear(); }
function currentMonth() { return new Date().getMonth() + 1; }

async function getActiveEmployee(req, employeeId, include = {}) {
    const companyId = resolveCompanyId(req);
    if (!companyId) return null;
    return prisma.employee.findFirst({ where: { id: Number(employeeId), companyId }, include: { company: true, ...include } });
}

async function getPayrollRates() {
    const config = await prisma.payrollConfig.findFirst({ orderBy: { id: "asc" } });
    return {

        cnssRate: config ? Number(config.cnssSalarialeRate) : 0.0448,
        amoRate: config ? Number(config.amoSalarialeRate) : 0.0226,
    };
}

/**
 * Returns the employee/year payroll cumulative from official history and the
 * selected current bulletin, without counting that month twice.
 */
export async function getAnnualPayrollCumulative(employeeId, year, currentMonth, currentValues = null, )  {
    const selectedMonth = Number(currentMonth);
    const hasSelectedMonth = Number.isInteger(selectedMonth) && selectedMonth >= 1 && selectedMonth <= 12;
    const payslips = await prisma.payslip.findMany({
        where: {
            employeeId,
            year,
            ...(hasSelectedMonth ? { month: { lte: selectedMonth } } : {}),
            OR: [
                { status: { in: [BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED] } },
                ...(hasSelectedMonth ? [{ month: selectedMonth }] : []),
            ],
        },
        select: { id: true, month: true, workedDays: true, workedHours: true, workingTimeMode: true, standardMonthlyDays: true, standardMonthlyHours: true, sni: true, irNet: true, cnss: true, sbi: true, amo : true },
        orderBy: { month: "asc" },
    });

    const currentRow = currentValues && hasSelectedMonth
        ? { month: selectedMonth, ...currentValues }
        : null;
    const rows = currentRow
        ? payslips.filter(payslip => payslip.month !== selectedMonth).concat(currentRow)
        : payslips;

    return rows.reduce((totals, payslip) => ({
        workedDays: totals.workedDays + Number(payslip.workedDays || 0),
        workedHours: totals.workedHours + Number(payslip.workedHours ?? calculateWorkedHoursFromDays(
            Number(payslip.workedDays || 0),
            Number(payslip.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS),
            Number(payslip.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS),
        )),
        sni: Number((totals.sni + Number(payslip.sni || 0)).toFixed(2)),
        irNet: Number((totals.irNet + Number(payslip.irNet || 0)).toFixed(2)),
        cnss: Number((totals.cnss + Number(payslip.cnss || 0)).toFixed(2)),
        sbi: Number((totals.sbi + Number(payslip.sbi || 0)).toFixed(2)),
        amo: Number((totals.amo + Number(payslip.amo || 0)).toFixed(2)),
    }), { workedDays: 0, workedHours: 0, sni: 0, irNet: 0, cnss: 0, sbi: 0, amo: 0 });
}

// PDF-only cumulative view: keeps the existing annual cumulative API stable
// while also collecting the gross, AMO and CIMR totals needed by the layout.
export async function getBulletinPdfCumulative(employeeId, year, month, currentPayslip) {
    const annual = await getAnnualPayrollCumulative(employeeId, year, month, {
        workedDays: currentPayslip.workedDays,
        workedHours: currentPayslip.workedHours,
        sni: currentPayslip.sni,
        irNet: currentPayslip.irNet,
        cnss: currentPayslip.cnss,
        sbi: currentPayslip.sbi,
        amo: currentPayslip.amo,
    });
    const rows = await prisma.payslip.findMany({
        where: {
            employeeId,
            year,
            month: { lte: month },
            OR: [
                { status: { in: [BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED] } },
                { month },
            ],
        },
        select: { month: true, sbg: true, amo: true, cimr: true },
    });
    const previous = rows.filter(row => row.month !== month);
    const sbg = previous.reduce((total, row) => total + Number(row.sbg || 0), Number(currentPayslip.sbg || 0));
    const amo = previous.reduce((total, row) => total + Number(row.amo || 0), Number(currentPayslip.amo || 0));
    const cimr = previous.reduce((total, row) => total + Number(row.cimr || 0), Number(currentPayslip.cimr || 0));
    return {
        ...annual,
        sbg: Number(sbg.toFixed(2)),
        amo: Number(amo.toFixed(2)),
        cimr: Number(cimr.toFixed(2)),
        deductions: Number((annual.cnss + amo + cimr + annual.irNet).toFixed(2)),
    };
}

async function applyCumulativeIR(employeeId, month, year, calc, dependents) {
    const previous = await prisma.payslip.findMany({
        where: {
            employeeId,
            year,
            month: { lt: month },
            status: { in: [BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED] },
        },
        select: { employeeId: true, year: true, month: true, sni: true, irNet: true, chargesDeFamille: true },
    });
    const cumulative = calculateCumulativeIR({
        employeeId,
        year,
        month,
        previousPayslips: previous,
        currentSNI: calc.sni,
    });
    // A blocked month has no withholding or refund, even with prior taxable pay.
    if (calc.payrollBlocked) {
        return {
            ...calc,
            periode: cumulative.elapsedPeriods,
            irCumulative: {
                sniCumule: cumulative.cumulativeSNI,
                moisEcoules: cumulative.elapsedPeriods,
                sniAnnuelEstime: cumulative.annualizedSNI,
                irAnnuelEstime: cumulative.annualIR,
                irPrecedent: cumulative.previousIRWithheld,
                irCumule: cumulative.previousIRWithheld,
            },
            annualCumulative: await getAnnualPayrollCumulative(employeeId, year, month, calc),
        };
    }
    const { cumulativeSNI: sniCumule, elapsedPeriods: moisEcoules, annualizedSNI: sniAnnuelEstime,
        annualIR: irAnnuelEstime, cumulativeIRDue: irCumule, previousIRWithheld: irPrecedent, currentMonthIR: irBrut,
        rate: irTaux, theoreticalIR: irTheorique, deduction: sommeADeduire } = cumulative;
    // IR net is the current bulletin's gross IR after the family allowance.
    // The cumulative calculation supplies the gross amount to withhold for
    // this month; do not replace it with the annual/cumulative IR amount.
    const chargesDeFamille = Number(calc.chargesDeFamille || 0);
    const irNet = Math.max(0, Number((irBrut - chargesDeFamille).toFixed(2)));
    const netAPayer = Number((calc.sbg - calc.cnss - calc.amo - calc.cimr - irNet - calc.avances).toFixed(2));
    const annualCumulative = await getAnnualPayrollCumulative(employeeId, year, month, {
        workedDays: calc.workedDays,
        sni: calc.sni,
        irNet,
        cnss: calc.cnss,
        sbi: calc.sbi,
        amo: calc.amo,
    });

    return {
        ...calc,
        periode: moisEcoules,
        irTaux,
        irTheorique,
        sommeADeduire,
        irBrut,
        irNet,
        netAPayer,
        irCumulative: {
            sniCumule,
            moisEcoules,
            sniAnnuelEstime,
            irAnnuelEstime,
            irPrecedent,
            irCumule,
        },
        annualCumulative,
    };
}

async function persistPayslipBonuses(payslipId, calc, client = prisma) {
    await client.payslipBonus.deleteMany({ where: { payslipId } });
    const taxable = (calc.variablePrimes || [])
        .filter(p => p.amount > 0)
        .map(p => ({ payslipId, name: p.label, amount: p.amount, taxable: true }));
    const nimp = (calc.nimpLines || [])
        .filter(p => p.amount > 0)
        .map(p => ({ payslipId, name: p.label, amount: p.amount, taxable: false }));
    const rows = [...taxable, ...nimp];
    if (rows.length > 0) {
        await client.payslipBonus.createMany({ data: rows });
        
    }
}

async function savePayslipWithBonuses(payslipData, payslipId, calc) {
    return prisma.$transaction(async transaction => {
        const payslip = payslipId
            ? await transaction.payslip.update({ where: { id: payslipId }, data: payslipData })
            : await transaction.payslip.create({ data: payslipData });
        await persistPayslipBonuses(payslip.id, calc, transaction);
        return payslip;
    });
}

async function buildPayslipData(emp, calc, month, year, rates, status = BULLETIN_STATUS.GENERATED) {
    if (!calc.irCumulative) {
        throw new Error("CUMULATIVE_IR_REQUIRED: payroll must be processed through applyCumulativeIR()");
    }
    const irFields = calc.irCumulative;
    return {
        employeeId: emp.id,
        month,
        year,
        workedDays: calc.workedDays,
        workedHours: calc.workedHours,
        workingTimeMode: calc.workingTimeMode,
        standardMonthlyDays: calc.standardMonthlyDays,
        standardMonthlyHours: calc.standardMonthlyHours,
        status,
        // Store the contractual base so later payslip edits do not prorate an already prorated amount.
        baseSalary: calc.rawBaseSalary,
        primeAnciennete: calc.primeAnciennete,
        bonusesIMP: calc.bonusesIMP,
        bonusesNIMP: calc.bonusesNIMP,
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
        absenceDays: 0,
        absenceDeduction: 0,
        heuresSup25: calc.heuresSup25,
        heuresSup50: calc.heuresSup50,
        heuresSup100: calc.heuresSup100,
        avances: calc.avances,
        ...irFields,
    };
}

/**
 * Maps a Prisma Employee object + optional monthly overrides into the unified
 * calculatePayroll() calculation engine.
 */
function runEmployeeCalculation(emp, overrides = {}) {
    return calculatePayroll(emp, overrides);
}

function resolveWorkingTimeForPayslip(emp, payslip = null, input = {}) {
    const mode = payslip?.workingTimeMode || emp.company?.workingTimeMode || "DAYS";
    const standardMonthlyDays = Number(payslip?.standardMonthlyDays || emp.company?.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS);
    const standardMonthlyHours = Number(payslip?.standardMonthlyHours || emp.company?.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS);
    return normalizeWorkingTime({
        workingTimeMode: mode,
        standardMonthlyDays,
        standardMonthlyHours,
        workedDays: mode === "DAYS" ? (input.workedDays ?? payslip?.workedDays) : undefined,
        workedHours: mode === "HOURS" ? (input.workedHours ?? payslip?.workedHours) : undefined,
    });
}


/**
 * Maps a Prisma Payslip DB record to the view model format expected by EJS views.
 */
export function mapPayslipToViewModel(p) {
    if (!p) return null;
    const variablePrimes = (p.bonuses || [])
        .filter(b => b.taxable)
        .map(b => ({ label: b.name, amount: Number(b.amount) }));
    const nimpLines = (p.bonuses || [])
        .filter(b => !b.taxable)
        .map(b => ({ label: b.name, amount: Number(b.amount) }));

    const sniNum = Number(p.sni);
    const irRateNum = p.irRate ? Number(p.irRate) : 0;
    // Read stored values directly — do NOT recompute from rates (lossy)
    const irTheorique = p.irTheorique !== undefined && p.irTheorique !== null
        ? Number(p.irTheorique)
        : Number((sniNum * irRateNum).toFixed(2));
    const irBrutNum = Number(p.irBrut);
    const sommeADeduire = p.sommeADeduire !== undefined && p.sommeADeduire !== null
        ? Number(p.sommeADeduire)
        : Math.max(0, Number((irTheorique - irBrutNum).toFixed(2)));

    const hs25 = Number(p.heuresSup25 || 0);
    const hs50 = Number(p.heuresSup50 || 0);
    const hs100 = Number(p.heuresSup100 || 0);
    const storedBaseSalary = Number(p.baseSalary || 0);
    const workedDays = p.workedDays === null || p.workedDays === undefined
        ? PAYROLL_WORKED_DAYS
        : Number(p.workedDays);
    const standardMonthlyDays = Number(p.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS);
    const standardMonthlyHours = Number(p.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS);
    const workingTimeMode = p.workingTimeMode || "DAYS";
    const workedHours = p.workedHours === null || p.workedHours === undefined
        ? calculateWorkedHoursFromDays(workedDays, standardMonthlyDays, standardMonthlyHours)
        : Number(p.workedHours);
    const effectiveBase = Number((storedBaseSalary * (workedDays / standardMonthlyDays)).toFixed(2));
    const hourlyRate = effectiveBase / standardMonthlyHours;
    const hs25Amount = hs25 * hourlyRate * 1.25;
    const hs50Amount = hs50 * hourlyRate * 1.50;
    const hs100Amount = hs100 * hourlyRate * 2.00;
    const heuresSupAmount = hs25Amount + hs50Amount + hs100Amount;

    const sbiNum = Number(p.sbi || 0);
    const cnssPatronale = Number((
        Math.min(sbiNum, 6000) * 0.0898 +
        sbiNum * 0.0640 +
        sbiNum * 0.0160
    ).toFixed(2));
    const amoPatronale = Number((sbiNum * 0.0411).toFixed(2));
    const partPatronal = Number((cnssPatronale + amoPatronale).toFixed(2));
    const exactNetAPayer = Number((Number(p.sbg || 0) - Number(p.cnss || 0) - Number(p.amo || 0)
        - Number(p.cimr || 0) - Number(p.irNet || 0) - Number(p.avances || 0)).toFixed(2));
    const arrondi = Number((Math.round(exactNetAPayer) - exactNetAPayer).toFixed(2));

    return {
        id: p.id,
        employeeId: p.employeeId,
        month: p.month,
        year: p.year,
        periode: p.moisEcoules,
        workedDays,
        workedHours,
        workingTimeMode,
        standardMonthlyDays,
        standardMonthlyHours,
        status: (p.status || 'DRAFT').toLowerCase(),
        rawStatus: p.status,
        baseSalary: effectiveBase,
        rawBaseSalary: storedBaseSalary,
        primeAnciennete: Number(p.primeAnciennete),
        ancienneteRate: effectiveBase > 0 ? Number((Number(p.primeAnciennete) / effectiveBase).toFixed(2)) : 0,
        bonusesIMP: Number(p.bonusesIMP),
        bonusesNIMP: Number(p.bonusesNIMP),
        sbg: Number(p.sbg),
        sbi: Number(p.sbi),
        cnss: Number(p.cnss),
        cnssRate: p.cnssRate ? Number(p.cnssRate) : 0.0448,
        cnssPatronale,
        amo: Number(p.amo),
        amoRate: p.amoRate ? Number(p.amoRate) : 0.0226,
        amoPatronale,
        partPatronal,
        cimr: Number(p.cimr || 0),
        cimrRate: p.cimrRate ? Number(p.cimrRate) : null,
        fraisPro: Number(p.fraisPro),
        fraisProRate: p.fraisProRate ? Number(p.fraisProRate) : 0.25,
        sni: sniNum,
        irTheorique,
        sommeADeduire,
        irBrut: irBrutNum,
        irTaux: irRateNum,
        chargesDeFamille: Number(p.chargesDeFamille),
        irNet: Number(p.irNet),
        exactNetAPayer,
        arrondi,
        netAPayer: Number((exactNetAPayer + arrondi).toFixed(2)),
        absenceDays: 0,
        absenceDeduction: 0,
        heuresSup25: hs25,
        heuresSup50: hs50,
        heuresSup100: hs100,
        hs25Amount,
        hs50Amount,
        hs100Amount,
        heuresSupAmount,
        avances: Number(p.avances || 0),
        variablePrimes,
        nimpLines,
        createdAt: p.createdAt ? p.createdAt.toISOString() : null,
        validatedAt: p.validatedAt ? p.validatedAt.toISOString() : null,
    };
}


// ---------------------------------------------------------------------------
// GET /bulletins  — Page 1: employee payroll list for period
// ---------------------------------------------------------------------------
export const listBulletins = async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) {
            return res.status(400).send("Aucune entreprise associée à cette session.");
        }
        const month = parseInt(req.query.month) || currentMonth();
        const year = parseInt(req.query.year) || currentYear();
        const bulkResult = req.query.bulkResult
            ? JSON.parse(decodeURIComponent(req.query.bulkResult))
            : null;

        // Keep inactive employees visible so their payroll state is explicit in the list.
        const dbEmployees = await prisma.employee.findMany({
            where: { companyId, bulletinMasque: false },
            orderBy: [{ nomComplet: 'asc' }, { id: 'asc' }],
            include: {
                company: true,
                payslips: {
                    where: { month, year },
                    include: { bonuses: true },
                    take: 1
                },
                bulletinMasks: {
                    where: { month, year },
                    take: 1,
                }
            }
        });

        const employees = dbEmployees.map(emp => {
            const payslip = emp.payslips[0] || null;
            let status = payslip ? payslip.status.toLowerCase() : "none";
            if (emp.blocageSaisiePaie || !emp.actif) {
                status = "blocked";
            }

            const variablesEntered = payslip ? (
                Number(payslip.workedDays) < Number(emp.company?.standardMonthlyDays || PAYROLL_WORKED_DAYS) ||
                Number(payslip.heuresSup25 || 0) > 0 ||
                Number(payslip.heuresSup50 || 0) > 0 ||
                Number(payslip.heuresSup100 || 0) > 0 ||
                Number(payslip.avances || 0) > 0 ||
                (payslip.bonuses && payslip.bonuses.length > 0)
            ) : false;

            return {
                id: emp.id,
                nomComplet: emp.nomComplet,
                matricule: emp.matricule,
                baseSalary: Number(emp.baseSalary),
                dateEmbauche: emp.dateEmbauche,
                blocageSaisiePaie: emp.blocageSaisiePaie,
                actif: emp.actif,
                workingTimeMode: emp.company?.workingTimeMode || "DAYS",
                standardMonthlyDays: Number(emp.company?.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS),
                standardMonthlyHours: Number(emp.company?.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS),
                maskedForPeriod: emp.bulletinMasks.length > 0,
                bulletin: payslip ? mapPayslipToViewModel(payslip) : null,
                bulletinStatus: status,
                variablesEntered,
            };
        }).filter(emp => !emp.maskedForPeriod);


        const closeResult = req.session.closeBulletinsResult || null;
        delete req.session.closeBulletinsResult;
        const validateResult = req.session.validateBulletinsResult || null;
        delete req.session.validateBulletinsResult;
        const draftResult = req.session.draftBulletinsResult || null;
        delete req.session.draftBulletinsResult;

        res.render("bulletins/index", {
            title: "Bulletins de Paie",
            currentPage: "bulletins",
            user: req.session.user,
            employees,
            month,
            year,
            monthName: MONTH_NAMES_FR[month],
            monthNames: MONTH_NAMES_FR,
            fmt,
            bulkResult,
            closeResult,
            validateResult,
            draftResult,
        });
    } catch (err) {
        console.error("Error listing bulletins:", err);
        res.status(500).redirect("/bulletins");
    }
};

// POST /bulletins/:id/mask — hide an employee from this period or all periods.
export const maskBulletin = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const scope = req.body.scope === "all" ? "all" : "month";

    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040) {
        return res.status(400).send("Période invalide.");
    }

    try {
        const companyId = await resolveCompanyId(req);
        const employee = await prisma.employee.findFirst({ where: { id: empId, companyId } });
        if (!employee) return res.status(404).send("Employé introuvable.");
        if (!employee.blocageSaisiePaie) return res.status(400).send("Seuls les employés dont la saisie de paie est bloquée peuvent être masqués.");

        if (scope === "all") {
            await prisma.employee.update({ where: { id: empId }, data: { bulletinMasque: true } });
        } else {
            await prisma.bulletinMask.upsert({
                where: { employeeId_month_year: { employeeId: empId, month, year } },
                create: { employeeId: empId, month, year },
                update: {},
            });
        }

        return res.redirect(`/bulletins?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Mask bulletin error:", err);
        return res.status(500).send("Impossible de masquer ce bulletin.");
    }
};

// Validate eligible bulletins for active, unblocked employees in the selected period.
export const validateBulkBulletins = async (req, res) => {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040) {
        return res.status(400).send("Période invalide. Sélectionnez un mois et une année valides.");
    }

    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) {
            return res.status(400).send("Aucune entreprise associée à cette session.");
        }
        const result = await prisma.payslip.updateMany({
            where: {
                month,
                year,
                employee: { companyId, actif: true },
                status: { in: [BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED] },
            },
            data: {
                status: BULLETIN_STATUS.VALIDATED,
                validatedAt: new Date(),
                validatedById: req.session?.user?.id || null,
            },
        });
        req.session.validateBulletinsResult = { count: result.count, month, year };
        return res.redirect(`/bulletins?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Bulk validate bulletins error:", err);
        return res.status(500).send("Impossible de valider les bulletins. Veuillez réessayer.");
    }
};

// Return validated bulletins to draft for the selected company and period.
export const returnBulkBulletinsToDraft = async (req, res) => {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040) {
        return res.status(400).send("Période invalide. Sélectionnez un mois et une année valides.");
    }

    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) {
            return res.status(400).send("Aucune entreprise associée à cette session.");
        }
        const result = await prisma.payslip.updateMany({
            where: {
                month,
                year,
                employee: { companyId },
                status: BULLETIN_STATUS.VALIDATED,
            },
            data: {
                status: BULLETIN_STATUS.DRAFT,
                validatedAt: null,
                validatedById: null,
            },
        });
        req.session.draftBulletinsResult = { count: result.count, month, year };
        return res.redirect(`/bulletins?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Bulk return bulletins to draft error:", err);
        return res.status(500).send("Impossible de retourner les bulletins en brouillon. Veuillez réessayer.");
    }
};

// Close all existing bulletins for the selected company and period.
export const closeBulkBulletins = async (req, res) => {
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040) {
        return res.status(400).send("Période invalide. Sélectionnez un mois et une année valides.");
    }

    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) {
            return res.status(400).send("Aucune entreprise associée à cette session.");
        }
        const result = await prisma.payslip.updateMany({
            where: {
                month,
                year,
                employee: { companyId },
                status: { not: BULLETIN_STATUS.CLOSED },
            },
            data: { status: BULLETIN_STATUS.CLOSED },
        });
        req.session.closeBulletinsResult = { count: result.count, month, year };
        return res.redirect(`/bulletins?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Bulk close bulletins error:", err);
        return res.status(500).send("Impossible de clôturer les bulletins. Veuillez réessayer.");
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/generate-bulk  — Bulk generate for selected period
// ---------------------------------------------------------------------------
export const generateBulkBulletins = async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) {
            return res.redirect("/bulletins");
        }
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const rates = await getPayrollRates();

        // Include blocked employees: the engine generates their zero payroll.
        const eligibleEmployees = await prisma.employee.findMany({
            where: { companyId, actif: true },
            include: {
                company: true,
                bonuses: {
                    include: { bonus: true }
                },
                payslips: {
                    where: { month, year },
                    take: 1,
                },
            }
        });

        let created = 0;
        let skipped = 0;
        const errors = [];

        for (const emp of eligibleEmployees) {
            try {
                const existing = emp.payslips[0] || null;
                if (existing) {
                    skipped++;
                    continue;
                }
                const monthlyCalc = runEmployeeCalculation(emp, { month, year });
                const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
                const payslipData = await buildPayslipData(emp, calc, month, year, rates);

                await savePayslipWithBonuses(payslipData, null, calc);
                created++;
            } catch (err) {
                // Catch unique constraint violation (P2002) as idempotency source of truth
                if (err.code === 'P2002') {
                    skipped++;
                } else {
                    console.error(`Error bulk generating for emp ${emp.id}:`, err);
                    errors.push({ empId: emp.id, message: err.message });
                }
            }

        }

        const bulkResult = encodeURIComponent(JSON.stringify({ created, skipped, errors }));
        res.redirect(`/bulletins?month=${month}&year=${year}&bulkResult=${bulkResult}`);
    } catch (err) {
        console.error("Bulk generate error:", err);
        res.redirect("/bulletins");
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/generate  — Generate / Update a single bulletin
// ---------------------------------------------------------------------------
export const generateBulletin = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month || req.query.month) || currentMonth();
        const year = parseInt(req.body.year || req.query.year) || currentYear();

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } }
        });
        if (!emp) return res.status(404).redirect("/bulletins");
        if (!emp.actif) return res.status(400).send("Impossible de générer le bulletin : cet employé est inactif.");

        // Check if existing bulletin is already VALIDATED
        const existing = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } }
        });
        if (rejectLockedBulletin(res, existing)) return;

        // Parse variable primes submitted from workspace
        const rawLabels = req.body.primesLabels || req.query.primesLabels;
        const rawAmounts = req.body.primesAmounts || req.query.primesAmounts;

        const labelsArray = Array.isArray(rawLabels)
            ? rawLabels
            : (rawLabels !== undefined && rawLabels !== null && rawLabels !== '' ? [rawLabels] : []);
        const amountsArray = Array.isArray(rawAmounts)
            ? rawAmounts
            : (rawAmounts !== undefined && rawAmounts !== null && rawAmounts !== '' ? [rawAmounts] : []);


        const variablePrimes = [];
        const count = Math.min(labelsArray.length, amountsArray.length);
        for (let i = 0; i < count; i++) {
            const label = String(labelsArray[i] || '').trim();
            const amount = Number(amountsArray[i]) || 0;
            if (label && amount > 0) {
                variablePrimes.push({ label, amount });
            }
        }
        const rawNimpLabels = req.body.nimpLabels || req.query.nimpLabels;
        const rawNimpAmounts = req.body.nimpAmounts || req.query.nimpAmounts;
        const nimpLabels = Array.isArray(rawNimpLabels) ? rawNimpLabels : (rawNimpLabels ? [rawNimpLabels] : []);
        const nimpAmounts = Array.isArray(rawNimpAmounts) ? rawNimpAmounts : (rawNimpAmounts ? [rawNimpAmounts] : []);
        const monthlyNimpLines = nimpLabels.map((label, index) => ({ label: String(label || '').trim(), amount: Number(nimpAmounts[index]) || 0 })).filter(line => line.label && line.amount > 0);
        // Parse non-imposable overrides
        const niimpOverrides = {};
        const sourceObj = { ...req.query, ...req.body };
        for (const [k, v] of Object.entries(sourceObj)) {
            if (k.startsWith("nimp_")) {
                niimpOverrides[decodeURIComponent(k.slice(5))] = v;
            }
        }
        const overrides = {
            month,
            year,
            baseSalary: req.body.baseSalary || req.query.baseSalary,
            dependents: req.body.dependents || req.query.dependents,
            ...resolveWorkingTimeForPayslip(emp, existing, {
                workedDays: emp.blocageSaisiePaie || !emp.actif ? 0 : (req.body.workedDays ?? req.query.workedDays),
                workedHours: emp.blocageSaisiePaie || !emp.actif ? 0 : (req.body.workedHours ?? req.query.workedHours),
            }),
            heuresSup25: req.body.heuresSup25 || req.query.heuresSup25 || 0,
            heuresSup50: req.body.heuresSup50 || req.query.heuresSup50 || 0,
            heuresSup100: req.body.heuresSup100 || req.query.heuresSup100 || 0,
            avances: req.body.avances || req.query.avances || 0,
            variablePrimes,
            monthlyNimpLines,
            niimpOverrides,
            
        };

        const monthlyCalc = runEmployeeCalculation(emp, overrides);
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, overrides.dependents ?? emp.nbPersonacharge);
        const submittedBaseSalary = overrides.baseSalary !== undefined && overrides.baseSalary !== null && overrides.baseSalary !== ''
            ? Number(overrides.baseSalary)
            : Number(emp.baseSalary);
        if (!Number.isFinite(submittedBaseSalary) || submittedBaseSalary < 0) {
            return res.status(400).send("Le salaire de base doit être un montant positif ou nul.");
        }

        // Keep the employee's contractual salary aligned with the latest payroll input.
        if (!emp.blocageSaisiePaie && emp.actif) {
            await prisma.employee.update({
                where: { id: empId },
                data: { baseSalary: submittedBaseSalary },
            });
        }

        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates);

        let payslip;
        if (existing) {
            payslip = await prisma.payslip.update({
                where: { id: existing.id },
                data: payslipData
            });
        } else {
            payslip = await prisma.payslip.create({
                data: payslipData
            });
        }

        await persistPayslipBonuses(payslip.id, calc);

        res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Single generate error:", err);
        res.redirect("/bulletins");
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/primes  — Add one taxable prime to the current payslip
// ---------------------------------------------------------------------------
export const addMonthlyPrime = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);

        if (!label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "Le libellé et le montant de la prime sont obligatoires." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } }
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie || !emp.actif) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée pour cet employé." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true }
        });
        if (existing && isLockedBulletin(existing.status)) {
            return res.status(403).json({ ok: false, error: existing.status === BULLETIN_STATUS.CLOSED
                ? "Ce bulletin est clôturé. Seule une indemnité non imposable peut être modifiée."
                : "Ce bulletin est validé et verrouillé." });
        }

        const previousMonthlyPrimes = (existing?.bonuses || [])
            .filter(bonus => bonus.taxable)
            .map(bonus => ({ label: bonus.name, amount: Number(bonus.amount) }));
        // Keep the bulletin's monthly non-taxable lines when adding a taxable
        // prime. Without passing them back to the engine, the recalculation
        // rebuilt the payslip with only taxable lines and deleted the NIMP
        // entries during persistPayslipBonuses().
        const fixedNimpLabels = new Set((emp.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = (existing?.bonuses || [])
            .filter(bonus => !bonus.taxable && !fixedNimpLabels.has(String(bonus.name).toLowerCase()))
            .map(bonus => ({ label: bonus.name, amount: Number(bonus.amount) }));
        const variablePrimes = [...previousMonthlyPrimes, { label, amount }];
        const monthlyCalc = runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: existing ? Number(existing.baseSalary) : undefined,
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing?.heuresSup25 || 0,
            heuresSup50: existing?.heuresSup50 || 0,
            heuresSup100: existing?.heuresSup100 || 0,
            avances: existing?.avances || 0,
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates);
        const payslip = existing
            ? await prisma.payslip.update({ where: { id: existing.id }, data: payslipData })
            : await prisma.payslip.create({ data: payslipData });

        await persistPayslipBonuses(payslip.id, calc);
        return res.json({ ok: true, bonus: { label, amount }, payroll: calc });
    } catch (err) {
        console.error("Add monthly prime error:", err);
        return res.status(500).json({ ok: false, error: "Impossible d'enregistrer la prime." });
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/primes/delete  — Delete one monthly taxable prime
// ---------------------------------------------------------------------------
export const deleteMonthlyPrime = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);

        if (!label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "La prime à supprimer est invalide." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie || !emp.actif) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }
        const fixedPrimeKeys = new Set((emp.bonuses || [])
            .filter(b => (b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => `${String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()}|${Number(b.amount)}`));
        const variablePrimes = existing.bonuses
            .filter(b => b.taxable && !fixedPrimeKeys.has(`${String(b.name).toLowerCase()}|${Number(b.amount)}`))
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const deleteIndex = variablePrimes.findIndex(prime =>
            prime.label.toLowerCase() === label.toLowerCase() && prime.amount === amount
        );
        if (deleteIndex === -1) {
            return res.status(404).json({ ok: false, error: "Cette prime n'existe pas sur ce bulletin." });
        }
        variablePrimes.splice(deleteIndex, 1);

        const monthlyNimpLines = existing.bonuses
            .filter(b => !b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const monthlyCalc = runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            avances: existing.avances || 0,
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates);
        const payslip = await prisma.payslip.update({ where: { id: existing.id }, data: payslipData });

        await persistPayslipBonuses(payslip.id, calc);
        return res.json({ ok: true, payroll: calc });
    } catch (err) {
        console.error("Delete monthly prime error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de supprimer la prime." });
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/indemnities  — Add one monthly non-taxable indemnity
// ---------------------------------------------------------------------------
export const addMonthlyIndemnity = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);
        if (!label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "Le libellé et le montant sont obligatoires." });
        }

        const emp = await getActiveEmployee(req, empId, { bonuses: { include: { bonus: true } } });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie || !emp.actif) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true }
        });
        if (existing && ![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }

        const fixedNimpLabels = new Set((emp.bonuses || []).filter(b => !(b.bonus ? b.bonus.taxable : b.taxable)).map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = (existing?.bonuses || [])
            .filter(b => !b.taxable && !fixedNimpLabels.has(String(b.name).toLowerCase()))
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        monthlyNimpLines.push({ label, amount });
        const variablePrimes = (existing?.bonuses || []).filter(b => b.taxable).map(b => ({ label: b.name, amount: Number(b.amount) }));
        const monthlyCalc = runEmployeeCalculation(emp, {
            month, year,
            baseSalary: existing ? Number(existing.baseSalary) : undefined,
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing?.heuresSup25 || 0,
            heuresSup50: existing?.heuresSup50 || 0,
            heuresSup100: existing?.heuresSup100 || 0,
            avances: existing?.avances || 0,
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(
            emp,
            calc,
            month,
            year,
            rates,
            existing?.status === BULLETIN_STATUS.VALIDATED
                ? BULLETIN_STATUS.VALIDATED
                : (isClosedBulletin(existing?.status) ? BULLETIN_STATUS.CLOSED : BULLETIN_STATUS.GENERATED)
        );
        const payslip = await savePayslipWithBonuses(payslipData, existing?.id, calc);
        return res.json({ ok: true, bonus: { label, amount }, payroll: calc });
    } catch (err) {
        console.error("Add monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'indemnité." });
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/indemnities/update — Edit a monthly non-taxable indemnity
// ---------------------------------------------------------------------------
export const updateMonthlyIndemnity = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const oldLabel = String(req.body.oldLabel || '').trim();
        const oldAmount = Number(req.body.oldAmount);
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);

        if (!oldLabel || !Number.isFinite(oldAmount) || oldAmount <= 0 || !label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "L'indemnité à modifier est invalide." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie || !emp.actif) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }

        const fixedNimpLabels = new Set((emp.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = existing.bonuses
            .filter(b => !b.taxable && !fixedNimpLabels.has(String(b.name).toLowerCase()))
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const updateIndex = monthlyNimpLines.findIndex(line =>
            line.label.toLowerCase() === oldLabel.toLowerCase() && line.amount === oldAmount
        );
        if (updateIndex === -1) return res.status(404).json({ ok: false, error: "Cette indemnité n'existe pas sur ce bulletin." });
        monthlyNimpLines[updateIndex] = { label, amount };

        const variablePrimes = existing.bonuses
            .filter(b => b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const monthlyCalc = runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            avances: existing.avances || 0,
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(
            emp,
            calc,
            month,
            year,
            rates,
            existing.status
        );
        const payslip = await savePayslipWithBonuses(payslipData, existing.id, calc);
        return res.json({ ok: true, bonus: { label, amount }, payroll: calc, payslipId: payslip.id });
    } catch (err) {
        console.error("Update monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de modifier l'indemnité." });
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/indemnities/delete  — Delete one monthly indemnity
// ---------------------------------------------------------------------------
export const deleteMonthlyIndemnity = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);

        if (!label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "L'indemnité à supprimer est invalide." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie || !emp.actif) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }

        const fixedNimpLabels = new Set((emp.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = existing.bonuses
            .filter(b => !b.taxable && !fixedNimpLabels.has(String(b.name).toLowerCase()))
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const deleteIndex = monthlyNimpLines.findIndex(line =>
            line.label.toLowerCase() === label.toLowerCase() && line.amount === amount
        );
        if (deleteIndex === -1) {
            return res.status(404).json({ ok: false, error: "Cette indemnité n'existe pas sur ce bulletin." });
        }
        monthlyNimpLines.splice(deleteIndex, 1);

        const variablePrimes = existing.bonuses
            .filter(b => b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const monthlyCalc = runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            avances: existing.avances || 0,
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(
            emp,
            calc,
            month,
            year,
            rates,
            existing.status === BULLETIN_STATUS.VALIDATED
                ? BULLETIN_STATUS.VALIDATED
                : (isClosedBulletin(existing.status) ? BULLETIN_STATUS.CLOSED : BULLETIN_STATUS.GENERATED)
        );
        const payslip = await savePayslipWithBonuses(payslipData, existing.id, calc);
        return res.json({ ok: true, payroll: calc });
    } catch (err) {
        console.error("Delete monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de supprimer l'indemnité." });
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/validate  — Validate a bulletin (freeze inputs)
// ---------------------------------------------------------------------------
export const validateBulletin = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month || req.query.month) || currentMonth();
        const year = parseInt(req.body.year || req.query.year) || currentYear();

        const existing = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } }
        });

        if (!existing) {
            return res.status(404).send("Aucun bulletin trouvé à valider.");
        }

        if (existing.status === BULLETIN_STATUS.VALIDATED) {
            return res.status(403).send("Ce bulletin est déjà validé.");
        }
        if (existing.status === BULLETIN_STATUS.CLOSED) {
            return res.status(403).send("Ce bulletin est clôturé.");
        }

        const userId = req.session?.user?.id || null;

        await prisma.payslip.update({
            where: { id: existing.id },
            data: {
                status: BULLETIN_STATUS.VALIDATED,
                validatedAt: new Date(),
                validatedById: userId,
            }
        });

        res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Validate bulletin error:", err);
        res.redirect("/bulletins");
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/draft — Return a validated bulletin to draft
// ---------------------------------------------------------------------------
export const returnBulletinToDraft = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month || req.query.month) || currentMonth();
        const year = parseInt(req.body.year || req.query.year) || currentYear();
        const existing = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } }
        });

        if (!existing) return res.status(404).send("Aucun bulletin trouvé.");
        if (existing.status === BULLETIN_STATUS.CLOSED) return res.status(403).send("Ce bulletin est clôturé.");
        if (existing.status !== BULLETIN_STATUS.VALIDATED) return res.status(400).send("Seul un bulletin validé peut revenir en brouillon.");

        await prisma.payslip.update({
            where: { id: existing.id },
            data: { status: BULLETIN_STATUS.DRAFT, validatedAt: null, validatedById: null }
        });
        res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Return bulletin to draft error:", err);
        res.redirect("/bulletins");
    }
};

// ---------------------------------------------------------------------------
// POST /bulletins/:id/close — Close a validated bulletin
// ---------------------------------------------------------------------------
export const closeBulletin = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month || req.query.month) || currentMonth();
        const year = parseInt(req.body.year || req.query.year) || currentYear();
        const existing = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } }
        });

        if (!existing) return res.status(404).send("Aucun bulletin trouvé.");
        if (existing.status === BULLETIN_STATUS.CLOSED) return res.status(403).send("Ce bulletin est déjà clôturé.");
        if (existing.status !== BULLETIN_STATUS.VALIDATED) return res.status(400).send("Seul un bulletin validé peut être clôturé.");

        await prisma.payslip.update({ where: { id: existing.id }, data: { status: BULLETIN_STATUS.CLOSED } });
        res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Close bulletin error:", err);
        res.redirect("/bulletins");
    }
};

// ---------------------------------------------------------------------------
// GET /bulletins/:id/calculate  — Live recalculation (JSON preview, no DB write)
// ---------------------------------------------------------------------------
// Preview or save a days-only edit using the persisted bulletin's other inputs.
export const updateBulletinWorkedDays = async (req, res) => {
    const input = req.method === 'POST' ? req.body : req.query;
    const employeeId = Number(req.params.id);
    const month = Number(input.month);
    const year = Number(input.year);
    const requestedDays = input.workedDays;
    const requestedHours = input.workedHours;
    if (!Number.isInteger(employeeId) || employeeId <= 0
        || !Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040
        || (requestedDays === undefined && requestedHours === undefined)) {
        return res.status(400).json({ ok: false, error: 'Saisissez une période valide et une valeur de temps de travail valide.' });
    }
    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) return res.status(400).json({ ok: false, error: 'Aucune entreprise associée à cette session.' });
        const existing = await prisma.payslip.findFirst({
            where: { employeeId, month, year, employee: { companyId } },
            include: { employee: { include: { company: true } }, bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: 'Générez le bulletin avant de modifier les jours.' });
        if (existing.employee.blocageSaisiePaie || ![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: 'Ce bulletin est verrouillé ou la saisie de paie est bloquée.' });
        }
        const company = existing.employee.company;
        const workingTime = normalizeWorkingTime({
            workingTimeMode: company?.workingTimeMode || existing.workingTimeMode || "DAYS",
            standardMonthlyDays: company?.standardMonthlyDays || existing.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS,
            standardMonthlyHours: company?.standardMonthlyHours || existing.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS,
            workedDays: company?.workingTimeMode === "HOURS" ? undefined : requestedDays,
            workedHours: company?.workingTimeMode === "HOURS" ? requestedHours : undefined,
        });
        // Use the saved bonus lines, without adding today's recurring bonuses again.
        const employee = { ...existing.employee, bonuses: [], cimrRate: existing.cimrRate };
        const monthlyCalc = runEmployeeCalculation(employee, {
            month, year, ...workingTime,
            baseSalary: Number(existing.baseSalary),
            dependents: Number(existing.chargesDeFamille || 0) / 50,
            heuresSup25: Number(existing.heuresSup25 || 0),
            heuresSup50: Number(existing.heuresSup50 || 0),
            heuresSup100: Number(existing.heuresSup100 || 0),
            avances: Number(existing.avances || 0),
            variablePrimes: existing.bonuses.filter(b => b.taxable).map(b => ({ label: b.name, amount: Number(b.amount) })),
            monthlyNimpLines: existing.bonuses.filter(b => !b.taxable).map(b => ({ label: b.name, amount: Number(b.amount) })),
        });
        const calc = await applyCumulativeIR(employeeId, month, year, monthlyCalc, employee.nbPersonacharge);
        if (req.method === 'POST') {
            const data = await buildPayslipData(employee, calc, month, year, {
                cnssRate: Number(existing.cnssRate), amoRate: Number(existing.amoRate),
            }, existing.status);
            // Keep the saved bonus rows intact; only days and calculated amounts change.
            const updated = await prisma.payslip.updateMany({
                where: {
                    id: existing.id, status: existing.status,
                    employee: { companyId, blocageSaisiePaie: false },
                },
                data,
            });
            if (!updated.count) return res.status(409).json({ ok: false, error: 'Le bulletin a été verrouillé. Rechargez la liste.' });
        }
        return res.json({ ok: true, payroll: calc, saved: req.method === 'POST' });
    } catch (err) {
        console.error('Worked days update failed:', err);
        return res.status(500).json({ ok: false, error: 'Impossible de recalculer ou enregistrer les jours. Veuillez réessayer.' });
    }
};

export const calculateLive = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        if (isNaN(empId) || empId <= 0) {
            return res.status(400).json({ ok: false, error: "Identifiant d'employé invalide" });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
            company: true,
        });
        if (!emp) {
            return res.status(404).json({ ok: false, error: "Employé introuvable" });
        }

        const month = parseInt(req.query.month) || currentMonth();
        const year = parseInt(req.query.year) || currentYear();

        const rawLabels = req.query.primesLabels;
        const rawAmounts = req.query.primesAmounts;

        const labelsArray = Array.isArray(rawLabels)
            ? rawLabels
            : (rawLabels !== undefined && rawLabels !== null && rawLabels !== '' ? [rawLabels] : []);
        const amountsArray = Array.isArray(rawAmounts)
            ? rawAmounts
            : (rawAmounts !== undefined && rawAmounts !== null && rawAmounts !== '' ? [rawAmounts] : []);

        const variablePrimes = [];
        const count = Math.min(labelsArray.length, amountsArray.length);
        for (let i = 0; i < count; i++) {
            const label = String(labelsArray[i] || '').trim();
            const amount = Math.max(0, Number(amountsArray[i]) || 0);
            if (label && amount > 0) {
                variablePrimes.push({ label, amount });
            }
        }

        const nimpLabels = Array.isArray(req.query.nimpLabels) ? req.query.nimpLabels : (req.query.nimpLabels ? [req.query.nimpLabels] : []);
        const nimpAmounts = Array.isArray(req.query.nimpAmounts) ? req.query.nimpAmounts : (req.query.nimpAmounts ? [req.query.nimpAmounts] : []);
        const monthlyNimpLines = nimpLabels.map((label, index) => ({ label: String(label || '').trim(), amount: Number(nimpAmounts[index]) || 0 })).filter(line => line.label && line.amount > 0);

        const niimpOverrides = {};
        for (const [k, v] of Object.entries(req.query)) {
            if (k.startsWith("nimp_")) {
                niimpOverrides[decodeURIComponent(k.slice(5))] = Math.max(0, Number(v) || 0);
            }
        }

        const overrides = {
            month,
            year,
            baseSalary: req.query.baseSalary !== undefined && req.query.baseSalary !== '' ? Math.max(0, Number(req.query.baseSalary) || 0) : undefined,
            dependents: req.query.dependents !== undefined && req.query.dependents !== '' ? Math.max(0, Number(req.query.dependents) || 0) : undefined,
            ...normalizeWorkingTime({
                workingTimeMode: emp.company?.workingTimeMode || "DAYS",
                standardMonthlyDays: emp.company?.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS,
                standardMonthlyHours: emp.company?.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS,
                workedDays: emp.blocageSaisiePaie || !emp.actif ? 0 : (emp.company?.workingTimeMode === "HOURS" ? undefined : req.query.workedDays),
                workedHours: emp.blocageSaisiePaie || !emp.actif ? 0 : (emp.company?.workingTimeMode === "HOURS" ? req.query.workedHours : undefined),
            }),
            heuresSup25: Math.max(0, Number(req.query.heuresSup25) || 0),
            heuresSup50: Math.max(0, Number(req.query.heuresSup50) || 0),
            heuresSup100: Math.max(0, Number(req.query.heuresSup100) || 0),
            avances: Math.max(0, Number(req.query.avances) || 0),
            variablePrimes,
            monthlyNimpLines,
            niimpOverrides,
        };

        const monthlyResult = runEmployeeCalculation(emp, overrides);
        const result = await applyCumulativeIR(emp.id, month, year, monthlyResult, overrides.dependents ?? emp.nbPersonacharge);

        res.json({
            ok: true,
            baseSalary: result.baseSalary,
            primeAnciennete: result.primeAnciennete,
            ancienneteRate: result.ancienneteRate,
            variablePrimes: result.variablePrimes,
            heuresSup25: result.heuresSup25,
            heuresSup50: result.heuresSup50,
            heuresSup100: result.heuresSup100,
            heuresSupAmount: result.heuresSupAmount,
            sbg: result.sbg,
            workedDays: result.workedDays,
            workedHours: result.workedHours,
            workingTimeMode: result.workingTimeMode,
            bonusesNIMP: result.bonusesNIMP,
            nimpLines: result.nimpLines || [],
            sbi: result.sbi,
            cnss: result.cnss,
            cnssPatronale: result.cnssPatronale,
            amo: result.amo,
            amoPatronale: result.amoPatronale,
            partPatronal: result.partPatronal,
            cimr: result.cimr,
            cimrRate: result.cimrRate,
            fraisPro: result.fraisPro,
            fraisProRate: result.fraisProRate,
            sni: result.sni,
            irTaux: result.irTaux,
            irTheorique: result.irTheorique,
            sommeADeduire: result.sommeADeduire,
            irBrut: result.irBrut,
            chargesDeFamille: result.chargesDeFamille,
            irNet: result.irNet,
            avances: result.avances,
            netAPayer: result.netAPayer,
            annualCumulative: result.annualCumulative,
            periode: result.periode,
        });

    } catch (err) {
        console.error("Live calc error:", err);
        res.status(400).json({ ok: false, error: err.message || "Erreur de calcul" });
    }
};


// ---------------------------------------------------------------------------
// GET /bulletins/:id  — Page 2: employee bulletin space
// ---------------------------------------------------------------------------
export const changeBulletinPeriod = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    // The shared period guard checks persisted statuses for every bulletin route.
    return res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
};

export const showBulletin = async (req, res) => {
    const requestId = `bulletin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.info("[bulletin-show] request.started", {
        requestId,
        employeeId: req.params.id,
        month: req.query.month || null,
        year: req.query.year || null,
        companyId: resolveCompanyId(req),
    });
    try {
        const empId = parseInt(req.params.id);
        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } }
        });
        if (!emp) {
            console.warn("[bulletin-show] employee.not-found", { requestId, employeeId: empId, companyId: resolveCompanyId(req) });
            return res.status(404).send("Employé introuvable dans cette entreprise.");
        }

        const month = req.query.month ? parseInt(req.query.month) : null;
        const year = req.query.year ? parseInt(req.query.year) : null;
        const hasPeriod = month && year;
        console.info("[bulletin-show] employee.loaded", { requestId, employeeId: emp.id, employeeName: emp.nomComplet, hasPeriod, month, year });

        // Follow the active employee list, with ID breaking ties for identical names.
        const previousEmployee = await prisma.employee.findFirst({
            where: {
                companyId: emp.companyId,
                actif: true,
                OR: [
                    { nomComplet: { lt: emp.nomComplet } },
                    { nomComplet: emp.nomComplet, id: { lt: emp.id } },
                ],
            },
            orderBy: [{ nomComplet: 'desc' }, { id: 'desc' }],
            select: { id: true, nomComplet: true },
        });
        const previousBulletinUrl = previousEmployee
            ? `/bulletins/${previousEmployee.id}${hasPeriod ? `?month=${month}&year=${year}` : ''}`
            : null;
        const nextEmployee = await prisma.employee.findFirst({
            where: {
                companyId: emp.companyId,
                actif: true,
                OR: [
                    { nomComplet: { gt: emp.nomComplet } },
                    { nomComplet: emp.nomComplet, id: { gt: emp.id } },
                ],
            },
            orderBy: [{ nomComplet: 'asc' }, { id: 'asc' }],
            select: { id: true, nomComplet: true },
        });
        const nextBulletinUrl = nextEmployee
            ? `/bulletins/${nextEmployee.id}${hasPeriod ? `?month=${month}&year=${year}` : ''}`
            : null;


        if (!hasPeriod) {
            // History mode: query all Payslips for this employee ordered by year/month desc
            const dbHistory = await prisma.payslip.findMany({
                where: { employeeId: empId },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
                include: { bonuses: true }
            });

            const history = dbHistory.map(mapPayslipToViewModel);

            return res.render("bulletins/show", {
                title: `${emp.nomComplet} — Bulletins`,
                currentPage: "bulletins",
                user: req.session.user,
                emp,
                previousEmployee,
                previousBulletinUrl,
                nextEmployee,
                nextBulletinUrl,
                mode: "history",
                history,
                bulletin: null,
                month: null,
                year: null,
                monthName: null,
                periode: null,
                monthNames: MONTH_NAMES_FR,

                fmt,
            });
        }

        // Single bulletin mode
        const dbPayslip = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } },
            include: { bonuses: true }
        });
        console.info("[bulletin-show] payslip.loaded", { requestId, employeeId: empId, month, year, found: Boolean(dbPayslip) });

        const bulletin = mapPayslipToViewModel(dbPayslip);
        if (bulletin) {
            const fixedNimpLabels = new Set((emp.bonuses || [])
                .filter(bonus => !(bonus.bonus ? bonus.bonus.taxable : bonus.taxable))
                .map(bonus => String(bonus.bonus ? bonus.bonus.name : bonus.name || '').toLowerCase()));
            bulletin.fixedNimpLines = bulletin.nimpLines.filter(line => fixedNimpLabels.has(String(line.label).toLowerCase()));
            bulletin.monthlyNimpLines = bulletin.nimpLines.filter(line => !fixedNimpLabels.has(String(line.label).toLowerCase()));
        }

        // Pre-compute preview result if no payslip exists yet in DB
        let previewResult = null;
        if (!bulletin) {
            try {
                const monthlyPreview = runEmployeeCalculation(emp, { month, year });
                previewResult = await applyCumulativeIR(emp.id, month, year, monthlyPreview, emp.nbPersonacharge);
            } catch (e) {
                previewResult = null;
            }
        }

        const annualCumulative = await getAnnualPayrollCumulative(
            emp.id,
            year,
            month,
            previewResult
        );
        const bulletinViewModel = bulletin
            ? { ...bulletin, annualCumulative }
            : null;
        const previewViewModel = previewResult
            ? { ...previewResult, annualCumulative }
            : null;

        res.render("bulletins/show", {
            title: `${emp.nomComplet} — ${MONTH_NAMES_FR[month]} ${year}`,
            currentPage: "bulletins",
            user: req.session.user,
            emp,
            previousEmployee,
            previousBulletinUrl,
            nextEmployee,
            nextBulletinUrl,
            periodBlocked: req.query.periodBlocked === "1",
            mode: "single",
            bulletin: bulletinViewModel,
            previewResult: previewViewModel,
            history: null,
            month,
            year,
            monthName: MONTH_NAMES_FR[month],
            monthNames: MONTH_NAMES_FR,
            annualCumulative,
            periode: bulletin?.periode ?? previewResult?.periode ?? 1,
            fmt,
        });
    } catch (err) {
        console.error("[bulletin-show] request.failed", {
            requestId,
            employeeId: req.params.id,
            month: req.query.month || null,
            year: req.query.year || null,
            error: err.message,
            stack: err.stack,
        });
        return res.status(500).send(`Impossible d’ouvrir le bulletin : ${err.message}`);
    }
};

// ---------------------------------------------------------------------------
// GET /bulletins/:id/pdf  — Download bulletin PDF (saved real Payslips only)
// ---------------------------------------------------------------------------
export const downloadPdfBulletin = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.query.month) || currentMonth();
        const year = parseInt(req.query.year) || currentYear();

        // Query real saved Payslip record from Prisma
        const payslip = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } },
            include: {
                bonuses: true,
                employee: {
                    include: { company: true }
                }
            }
        });

        if (!payslip) {
            return res.status(404).send("Aucun bulletin enregistré pour cette période. Veuillez d'abord créer le bulletin.");
        }

        const emp = payslip.employee;
        const comp = emp.company || {};
        const monthName = MONTH_NAMES_FR[month] || "Mois";

        const hireDate = new Date(emp.dateEmbauche);
        const seniorityYears = Math.max(0, Math.floor((new Date() - hireDate) / (1000 * 60 * 60 * 24 * 365.25)));

        const variablePrimes = (payslip.bonuses || [])
            .filter(b => b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount) }));
        const cumulative = await getBulletinPdfCumulative(empId, year, month, payslip);

        const pdfData = {
            ...mapPayslipToViewModel(payslip),
            employeeName: emp.nomComplet,
            employeeMatricule: emp.matricule,
            employeeCNSS: emp.numeroCNSS || '—',
            employeeFonction: emp.fonction || '—',
            employeeAddress: emp.adresse || '—',
            codeService: emp.codeService || '—',
            birthDate: emp.dateNaissance ? new Date(emp.dateNaissance).toLocaleDateString('fr-MA') : '—',
            hireDate: emp.dateEmbauche ? new Date(emp.dateEmbauche).toLocaleDateString('fr-MA') : '—',
            sexe: emp.sexe || '—',
            children: emp.nbEnfantCharge,
            dependents: emp.nbPersonacharge,
            cin: emp.cin || '—',
            seniorityYears,
            companyName: comp.name || 'CONFONDA',
            companyAddress: comp.adresse || 'hay sikaktyne',
            companyCNSS: comp.numeroAffiliationCnss || '—',
            companyIF: comp.ifNumber || '565653486',
            companyICE: comp.ice || '120521852812821',
            month,
            year,
            monthName,
            paymentDate: `${year}-${String(month).padStart(2, '0')}-25`,
            paymentMethod: emp.modePaiement || 'Virement',
            variablePrimes,
            cumulative,
        };

        const fileName = `bulletin-${emp.nomComplet.toLowerCase()}-${month}-${year}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

        generateBulletinPdf(pdfData, res);
    } catch (err) {
        console.error("PDF download error:", err);
        res.status(500).send("Erreur lors de la génération du PDF.");
    }
};

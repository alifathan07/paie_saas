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
import { employeeBulletinVisibilityWhere } from "../lib/bulletinMask.js";
import { applyCompanyOvertimeSetting, hideOvertimeFromView, isOvertimeEnabled } from "../lib/overtimeFeature.js";
import { applyCompanyPrimeRendementSetting, hidePrimeRendementFromView, isPrimeRendementEnabled } from "../lib/primeRendementFeature.js";
import { isImposableRubriqueVisible, isRubriqueVisible } from "../lib/rubriqueVisibility.js";
import { filterEmployeesByChantier, isChantiersEnabled, resolveChantierFilter } from "../lib/chantiersFeature.js";
import { calculatePayroll, normalizeWorkedDays, PAYROLL_WORKED_DAYS } from "../payroll-engine/PayrollEngine.js";
import { calculatePrimeRendement } from "../payroll-engine/calculators/primeRendement.calculator.js";
import { calculateWorkedHoursFromDays, DEFAULT_STANDARD_MONTHLY_HOURS, DEFAULT_STANDARD_MONTHLY_DAYS, normalizeWorkingTime } from "../payroll-engine/utils/workingTime.js";
import { calculateCumulativeIR } from "../payroll-engine/calculators/cumulativeIr.calculator.js";
import { generateBulletinPdf } from "../pdf/bulletinPdf.js";
import { getBulletinRubriqueCodes } from "../services/bulletinRubrique.service.js";
import { getRubriqueMaps } from "../services/rubrique.service.js";
import { listEmployeeAvances, removeAvanceDeduction, setAvanceDeduction } from "../services/avance.service.js";
import { listEmployeePrets, setPretDeduction } from "../services/pret.service.js";
import { createPrimes } from "../services/primeService.js";
import { createIndemnite, listIndemnites } from "../services/indemniteService.js";
import { listChantiers } from "../services/chantier.service.js";
import { listBirthLeaveReferencePayslips } from "../services/congeNaissance.service.js";

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
const EXCLUDED_NIMP_PREFIX = "__bulletin_excluded_employee_indemnity__:";
const payslipBonusBaseAmount = bonus => Number(bonus.baseAmount ?? bonus.amount ?? 0);
const indemnityRatioForWorkingTime = workingTime => workingTime.mode === "HOURS"
    ? workingTime.workedHours / workingTime.standardMonthlyHours
    : workingTime.ratio;
const PAID_LEAVE_CONFLICT_MESSAGE = "Veuillez vérifier les jours travaillés, congés payés, congés de naissance et jours fériés : leur total ne peut pas dépasser le nombre de jours du mois.";

function prorateMonthlyNimpLines(lines, referenceLines, previousRatio, targetRatio, sourceRatios = []) {
    const referencesByLabel = new Map((referenceLines || [])
        .filter(line => !line.taxable)
        .map(line => [String(line.name || line.label || '').trim().toLowerCase(), line]));

    return lines.map((line, index) => {
        const label = String(line.label || line.name || '').trim();
        const reference = referencesByLabel.get(label.toLowerCase());
        const monthlyMaximum = Number(reference
            ? payslipBonusBaseAmount(reference)
            : line.baseAmount ?? line.amount ?? 0);
        const enteredAmount = Math.max(0, Number(line.amount) || 0);
        const sourceRatioValue = line.sourceRatio ?? sourceRatios[index];
        const sourceRatio = sourceRatioValue === '' || sourceRatioValue === undefined || sourceRatioValue === null
            ? Number.NaN
            : Number(sourceRatioValue);
        const amountRatio = Number.isFinite(sourceRatio) && sourceRatio >= 0
            ? sourceRatio
            : previousRatio;
        const monthlyAmount = amountRatio > 0
            ? enteredAmount / amountRatio
            : monthlyMaximum;
        const cappedMonthlyAmount = monthlyMaximum > 0
            ? Math.min(monthlyAmount, monthlyMaximum)
            : monthlyAmount;
        const payrollLine = { ...line };
        delete payrollLine.sourceRatio;
        return {
            ...payrollLine,
            amount: Number((cappedMonthlyAmount * targetRatio).toFixed(2)),
            baseAmount: monthlyMaximum > 0 ? monthlyMaximum : cappedMonthlyAmount,
        };
    });
}

function hasPaidLeaveConflict(workedDays, paidLeaveDays, standardMonthlyDays = PAYROLL_WORKED_DAYS, publicHolidayDays = 0, birthLeaveDays = 0) {
    const worked = Number(workedDays);
    const leave = Number(paidLeaveDays);
    const holidays = Number(publicHolidayDays);
    const birthLeave = Number(birthLeaveDays);
    // Leave/worked-day overlap is bounded by the payroll engine's monthly
    // calendar basis, not by a company's prorating basis.
    const maximum = PAYROLL_WORKED_DAYS;
    return Number.isFinite(worked) && Number.isFinite(leave) && Number.isFinite(holidays) && Number.isFinite(birthLeave)
        && worked + leave + holidays + birthLeave > maximum;
}

function rejectPaidLeaveConflict(res, acceptsJson = false) {
    if (acceptsJson) return res.status(400).json({ ok: false, error: PAID_LEAVE_CONFLICT_MESSAGE });
    return res.status(400).send(PAID_LEAVE_CONFLICT_MESSAGE);
}

function taxableAdditionLines(values, catalogue = [], overtimeEnabled = true, rubriqueVisibility = null, primeRendementEnabled = true) {
    if (!overtimeEnabled && !primeRendementEnabled) return [];
    const byKey = new Map(catalogue.map(row => [row.calculationKey, row]));
    const effectiveBase = Number(values.baseSalary || 0);
    const standardHours = Number(values.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS);
    const hourlyRate = standardHours > 0 ? effectiveBase / standardHours : 0;
    const definitions = overtimeEnabled ? [
        ['overtime_25', Number(values.heuresSup25 || 0), 1.25],
        ['overtime_50', Number(values.heuresSup50 || 0), 1.5],
        ['overtime_100', Number(values.heuresSup100 || 0), 2],
    ] : [];
    const overtimeLines = definitions.map(([key, hours, multiplier]) => {
        const definition = byKey.get(key);
        const amount = Number((hours * hourlyRate * multiplier).toFixed(2));
        return definition && definition.visible !== false
            && isImposableRubriqueVisible(rubriqueVisibility, { rubriqueImposableId: definition.id, calculationKey: key, code: definition.code })
            && amount > 0
            ? { code: definition.code, label: definition.name, amount, rubriqueImposableId: definition.id, calculationKey: key }
            : null;
    }).filter(Boolean);
    const primeRendement = primeRendementEnabled
        ? [{
            code: '',
            label: 'Prime rendement',
            base: Number(values.primeRendementInput || 0),
            amount: Number(values.primeRendementAmount || 0),
            calculationKey: 'prime_rendement',
        }]
        : [];
    return [...overtimeLines, ...primeRendement];
}

const manualRetenueTotal = rows => (rows || []).reduce((total, row) => total + Number(row.amount || 0), 0);

async function applyManualRetenuesToNet(payslipId, calculatedNet, client = prisma) {
    const rows = await client.payslipRetenu.findMany({ where: { payslipId }, select: { amount: true } });
    const netAPayer = Math.max(0, Number((Number(calculatedNet || 0) - manualRetenueTotal(rows)).toFixed(2)));
    await client.payslip.update({ where: { id: payslipId }, data: { netAPayer } });
    return netAPayer;
}

function rejectLockedBulletin(res, payslip, action = "modifier") {
    if (!payslip || !isLockedBulletin(payslip.status)) return false;
    const message = payslip.status === BULLETIN_STATUS.CLOSED
        ? "Ce bulletin est clôturé. Seule une indemnité non imposable peut être modifiée."
        : "Ce bulletin est validé et verrouillé. Utilisez Retourner en brouillon avant de le modifier.";
    const error = `Impossible de ${action} : ${message}`;
    if (String(res.req?.headers?.accept || '').includes('application/json')) {
        res.status(403).json({ ok: false, error });
    } else {
        const month = res.req?.body?.month || res.req?.query?.month || currentMonth();
        const year = res.req?.body?.year || res.req?.query?.year || currentYear();
        res.redirect(`/bulletins?month=${encodeURIComponent(month)}&year=${encodeURIComponent(year)}&bulletinError=${encodeURIComponent(error)}`);
    }
    return true;
}

function fmt(amount) {
    return Number(amount || 0).toLocaleString("fr-MA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function parseVariablePrimes(rawLabels, rawAmounts) {
    const labels = Array.isArray(rawLabels)
        ? rawLabels
        : (rawLabels !== undefined && rawLabels !== null && rawLabels !== '' ? [rawLabels] : []);
    const amounts = Array.isArray(rawAmounts)
        ? rawAmounts
        : (rawAmounts !== undefined && rawAmounts !== null && rawAmounts !== '' ? [rawAmounts] : []);

    return labels.flatMap((rawLabel, index) => {
        const label = String(rawLabel || '').trim();
        const rawAmount = amounts[index];
        if (!label || rawAmount === undefined || rawAmount === null || rawAmount === '') return [];
        const amount = Number(rawAmount);
        return Number.isFinite(amount) && amount >= 0 ? [{ label, amount }] : [];
    });
}

function listBulletinComponents(values, rubriqueMaps, recurringNimpLabels = new Set(), overtimeEnabled = true, primeRendementEnabled = true) {
    const v = values || {};
    const codes = rubriqueMaps.codes || {};
    const visible = (category, key) => isRubriqueVisible(rubriqueMaps.rubriqueVisibility, category, key);
    const money = value => value === null || value === undefined ? null : Number(value || 0);
    const row = (code, label, base = null, rate = null, gains = null, retenues = null, patronal = null) => ({
        code: code || '', label, base: money(base), rate: rate === null || rate === undefined ? null : Number(rate),
        gains: money(gains), retenues: money(retenues), patronal: money(patronal),
    });
    const withVisibility = (component, category, key) => ({
        ...component,
        rubriqueVisibilityCategory: category,
        rubriqueVisibilityKey: key,
    });
    const primes = v.variablePrimes || [];
    const isPaidLeaveDefinition = definition => {
        const key = String(definition.calculationKey || '').trim().toLowerCase();
        const name = String(definition.name || '').trim().toLowerCase();
        return ['paid_leave', 'paid_leave_days'].includes(key)
            || name === 'congé payé'
            || name === 'nombre jours congé payé';
    };
    const primeRows = (rubriqueMaps.imposableRows || [])
        .filter(definition => definition.active !== false && definition.visible !== false && !String(definition.calculationKey || '').startsWith('overtime_')
            && !isPaidLeaveDefinition(definition)
            && isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, {
                rubriqueImposableId: definition.id,
                calculationKey: definition.calculationKey,
                code: definition.code,
            }))
        .map(definition => {
            const prime = primes.find(item => Number(item.rubriqueImposableId) === Number(definition.id)
                || String(item.label || '').trim().toLowerCase() === String(definition.name).trim().toLowerCase());
            return {
                ...row(definition.code, definition.name, null, null, prime?.amount || 0),
                rubriqueImposableId: definition.id,
                calculationKey: definition.calculationKey,
                rubriqueVisibilityCategory: 'imposable',
                rubriqueVisibilityKey: `id:${definition.id}`,
            };
        });
    const cataloguePrimeLabels = new Set(primeRows.map(item => String(item.label || '').trim().toLowerCase()));
    const manualPrimeRows = primes
        .filter(item => !cataloguePrimeLabels.has(String(item.label || '').trim().toLowerCase()))
        .map(item => ({
            ...row(item.code, item.label, null, null, item.amount),
            rubriqueImposableId: item.rubriqueImposableId,
            ...(item.rubriqueImposableId !== null && item.rubriqueImposableId !== undefined
                ? { rubriqueVisibilityCategory: 'imposable', rubriqueVisibilityKey: `id:${item.rubriqueImposableId}` }
                : {}),
        }));
    const standardHours = Number(v.standardMonthlyHours || 191);
    const baseSalary = Number(v.baseSalary || 0);
    const overtime = [
        ['overtime_25', v.heuresSup25, 1.25, 'Heures supplémentaires 25%'],
        ['overtime_50', v.heuresSup50, 1.50, 'Heures supplémentaires 50%'],
        ['overtime_100', v.heuresSup100, 2, 'Heures supplémentaires 100%'],
    ].map(([key, hours, multiplier, fallback]) => {
        const definition = (rubriqueMaps.imposableRows || []).find(item => item.calculationKey === key);
        const amount = Number((Number(hours || 0) * baseSalary / standardHours * multiplier).toFixed(2));
        return {
            ...row(definition?.code, definition?.name || fallback, hours || 0, null, amount),
            // Keep the payroll override field name for the bulletin-list input.
            key: key.replace('overtime_', 'heuresSup'),
            rubriqueImposableId: definition?.id,
            calculationKey: key,
            rubriqueVisibilityCategory: 'imposable',
            rubriqueVisibilityKey: definition?.id ? `id:${definition.id}` : `key:${key}`,
        };
    });
    const components = [
        ...(visible('base', 'base_salary') ? [withVisibility(row(codes['Salaire de base'], 'Salaire de base', v.workingTimeMode === 'HOURS' ? v.workedHours : v.workedDays, null, v.baseSalary), 'base', 'base_salary')] : []),
        ...(visible('base', 'seniority_bonus') ? [withVisibility(row(codes["Prime d'ancienneté"], "Prime d'ancienneté", v.baseSalary, v.ancienneteRate, v.primeAnciennete), 'base', 'seniority_bonus')] : []),
        ...primeRows,
        ...manualPrimeRows,
        ...(overtimeEnabled ? overtime.filter(item => {
            const calculationKey = item.key.replace('heuresSup', 'overtime_');
            const definition = (rubriqueMaps.imposableRows || []).find(row => row.calculationKey === calculationKey);
            return !definition || isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, {
                rubriqueImposableId: definition.id,
                calculationKey,
                code: definition.code,
            });
        }) : []),
        ...(primeRendementEnabled ? [{
            ...row('', 'Prime rendement', v.primeRendementInput, null, v.primeRendementAmount),
            key: 'primeRendementInput',
            calculationKey: 'prime_rendement',
        }] : []),
        ...(visible('base', 'paid_leave_days') ? [withVisibility(row(codes['Nombre jours congé payé'], 'Congé payé', v.paidLeaveDays, null, v.paidLeaveAmount), 'base', 'paid_leave_days')] : []),
        ...(visible('base', 'birth_leave_days') ? [withVisibility(row(codes['Nombre jours congé de naissance'], 'Congé de naissance', v.congeNaissanceDays, null, v.congeNaissanceAmount), 'base', 'birth_leave_days')] : []),
        ...(visible('base', 'public_holiday_days') ? [withVisibility(row(codes['Nombre jours fériés'], 'Jours fériés', v.joursFeries, null, v.joursFeriesAmount), 'base', 'public_holiday_days')] : []),
        ...(visible('base', 'taxable_gross_salary') ? [withVisibility(row(codes['Salaire brut imposable'], 'Salaire brut imposable', null, null, v.sbi), 'base', 'taxable_gross_salary')] : []),
        ...(visible('retenu', 'amo') ? [withVisibility(row(codes.AMO, 'AMO', v.sbi, v.amoRate, null, v.amo, v.amoPatronale), 'retenu', 'amo')] : []),
        ...(visible('retenu', 'cnss') ? [withVisibility(row(codes.CNSS, 'CNSS', Math.min(Number(v.sbi || 0), 6000), v.cnssRate, null, v.cnss, v.cnssPatronale), 'retenu', 'cnss')] : []),
        ...(visible('retenu', 'cimr') ? [withVisibility(row(codes.CIMR, 'CIMR', v.sbi, v.cimrRate, null, v.cimr), 'retenu', 'cimr')] : []),
        ...(visible('retenu', 'professional_expenses') ? [withVisibility(row(codes['Frais professionnels'], 'Frais professionnels', v.sbi, v.fraisProRate, null, v.fraisPro), 'retenu', 'professional_expenses')] : []),
        // SNI is a calculated amount, so put it in gains for the bulletin
        // list renderer (the base field is only used for calculation context).
        ...(visible('base', 'taxable_net_salary') ? [withVisibility(row(codes['Salaire net imposable'], 'SNI', null, null, v.sni), 'base', 'taxable_net_salary')] : []),
        ...(visible('retenu', 'income_tax') ? [withVisibility(row(codes['Impôt sur le revenu'], 'IR', v.sni, v.irTaux, null, v.irNet), 'retenu', 'income_tax')] : []),
        ...(v.retenus || []).filter(item => item.rubriqueRetenuId === null || item.rubriqueRetenuId === undefined
            || isRubriqueVisible(rubriqueMaps.rubriqueVisibility, 'retenu', `id:${item.rubriqueRetenuId}`))
            .map(item => ({
                ...row(item.code, item.label, null, null, null, item.amount),
                rubriqueRetenuId: item.rubriqueRetenuId,
                rubriqueVisibilityCategory: 'retenu',
                rubriqueVisibilityKey: item.rubriqueRetenuId !== null && item.rubriqueRetenuId !== undefined
                    ? `id:${item.rubriqueRetenuId}`
                    : `code:${item.code}`,
            })),
        ...(v.nimpLines || []).map(item => {
            const baseAmount = Number(item.baseAmount ?? item.amount ?? 0);
            return {
                ...row(item.code, item.label, null, null, item.amount),
                // The list edits the monthly base, exactly like the bulletin
                // page. The payable amount is still shown underneath.
                baseAmount,
                sticky: recurringNimpLabels.has(String(item.label || '').trim().toLowerCase()),
            };
        }),
    ];
    const primeLabels = new Set([...primeRows, ...manualPrimeRows].map(item => item.label));
    const nimpLabels = new Set((v.nimpLines || []).map(item => item.label));
    const componentKind = item => {
        if (item.calculationKey === 'prime_rendement') return 'primeRendement';
        const baseKind = {
            base_salary: 'salary',
            paid_leave_days: 'paidLeave',
            birth_leave_days: 'birthLeave',
            public_holiday_days: 'holiday',
        }[item.rubriqueVisibilityKey];
        if (item.rubriqueVisibilityCategory === 'base') return baseKind || 'display';
        if (item.rubriqueVisibilityCategory === 'imposable') {
            return String(item.calculationKey || '').startsWith('overtime_') ? 'overtime' : 'prime';
        }
        if (item.rubriqueVisibilityCategory === 'retenu') return 'display';
        if (primeLabels.has(item.label)) return 'prime';
        if (nimpLabels.has(item.label)) return 'nimp';
        return 'display';
    };
    return components.map(item => ({
        ...item,
        kind: componentKind(item),
    }));
}

function filterInvisibleRubriqueLines(values, rubriqueVisibility) {
    if (!values) return values;
    return {
        ...values,
        variablePrimes: (values.variablePrimes || []).filter(line =>
            line.rubriqueImposableId === null || line.rubriqueImposableId === undefined
                || isImposableRubriqueVisible(rubriqueVisibility, line)),
        retenus: (values.retenus || []).filter(line => line.rubriqueRetenuId !== null && line.rubriqueRetenuId !== undefined
            ? isRubriqueVisible(rubriqueVisibility, "retenu", `id:${line.rubriqueRetenuId}`)
            : !line.code || isRubriqueVisible(rubriqueVisibility, "retenu", `code:${line.code}`)),
        taxableAdditions: (values.taxableAdditions || []).filter(line => isImposableRubriqueVisible(rubriqueVisibility, line)),
    };
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
        select: { id: true, month: true, workedDays: true, workedHours: true, workingTimeMode: true, standardMonthlyDays: true, standardMonthlyHours: true, sni: true, irNet: true, cnss: true, sbi: true, brutGlobal: true, bonusesNIMP: true, amo : true },
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
        brutGlobal: Number((totals.brutGlobal + Number(payslip.brutGlobal ?? Number(payslip.sbi || 0) + Number(payslip.bonusesNIMP || 0))).toFixed(2)),
        amo: Number((totals.amo + Number(payslip.amo || 0)).toFixed(2)),
    }), { workedDays: 0, workedHours: 0, sni: 0, irNet: 0, cnss: 0, sbi: 0, brutGlobal: 0, amo: 0 });
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
        bonusesNIMP: currentPayslip.bonusesNIMP,
        brutGlobal: currentPayslip.brutGlobal,
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
    const netAPayer = Number((calc.sbg - calc.cnss - calc.amo - calc.cimr - irNet).toFixed(2));
    const annualCumulative = await getAnnualPayrollCumulative(employeeId, year, month, {
        workedDays: calc.workedDays,
        sni: calc.sni,
        irNet,
        cnss: calc.cnss,
        sbi: calc.sbi,
        bonusesNIMP: calc.bonusesNIMP,
        brutGlobal: calc.brutGlobal ?? calc.sbg,
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

async function persistPayslipBonuses(payslipId, calc, client = prisma, excludedNimpLabels = []) {
    const existingExclusions = await client.payslipBonus.findMany({
        where: { payslipId, name: { startsWith: EXCLUDED_NIMP_PREFIX } },
        select: { name: true, amount: true },
    });
    await client.payslipBonus.deleteMany({ where: { payslipId } });
    const taxable = (calc.variablePrimes || [])
        .filter(p => p.amount > 0 || p.rubriqueImposableId || (p.amount === 0 && String(p.label || '').trim()))
        .map(p => ({ payslipId, rubriqueImposableId: p.rubriqueImposableId || null, code: p.code || '', name: p.label, amount: p.amount, taxable: true }));
    const nimp = (calc.nimpLines || [])
        .filter(p => Number(p.baseAmount ?? p.amount) > 0)
        .map(p => ({ payslipId, code: p.code || '', name: p.label, amount: p.amount, baseAmount: p.baseAmount ?? p.amount, taxable: false }));
    const exclusionRows = [
        ...existingExclusions.map(item => ({
            label: String(item.name).slice(EXCLUDED_NIMP_PREFIX.length),
            amount: Number(item.amount) || 0,
        })),
        ...excludedNimpLabels.map(item => typeof item === 'string'
            ? { label: item, amount: 0 }
            : { label: item.label, amount: Number(item.amount) || 0 }),
    ];
    const exclusions = [...new Map(exclusionRows
        .map(item => [String(item.label || '').trim().toLowerCase(), item])
        .filter(([label]) => label))
        .values()]
        .map(item => ({ payslipId, name: `${EXCLUDED_NIMP_PREFIX}${String(item.label).trim()}`, amount: item.amount, taxable: false }));
    const rows = [...taxable, ...nimp, ...exclusions];
    if (rows.length > 0) {
        await client.payslipBonus.createMany({ data: rows });
        
    }
}

async function savePayslipWithBonuses(payslipData, payslipId, calc, excludedNimpLabels = [], clearExcludedNimpLabels = [], client = prisma) {
    const persist = async transaction => {
        const payslip = payslipId
            ? await transaction.payslip.update({ where: { id: payslipId }, data: payslipData })
            : await transaction.payslip.create({ data: payslipData });
        const clearLabels = new Set(clearExcludedNimpLabels.map(label => String(label || '').trim().toLowerCase()));
        if (clearLabels.size) {
            const markers = await transaction.payslipBonus.findMany({
                where: { payslipId: payslip.id, name: { startsWith: EXCLUDED_NIMP_PREFIX } },
                select: { id: true, name: true },
            });
            await transaction.payslipBonus.deleteMany({
                where: {
                    id: { in: markers
                        .filter(marker => clearLabels.has(String(marker.name).slice(EXCLUDED_NIMP_PREFIX.length).trim().toLowerCase()))
                        .map(marker => marker.id) },
                },
            });
        }
        await persistPayslipBonuses(payslip.id, calc, transaction, excludedNimpLabels);
        await applyManualRetenuesToNet(payslip.id, calc.netAPayer, transaction);
        // Reload the relation after replacing the lines. The bulletin view uses
        // these persisted rows to display recurring and monthly indemnities.
        return transaction.payslip.findUnique({
            where: { id: payslip.id },
            include: { bonuses: true, retenus: true },
        });
    };
    return client === prisma ? prisma.$transaction(persist) : persist(client);
}

async function buildPayslipData(emp, calc, month, year, rates, status = BULLETIN_STATUS.GENERATED) {
    if (!calc.irCumulative) {
        throw new Error("CUMULATIVE_IR_REQUIRED: payroll must be processed through applyCumulativeIR()");
    }
    // Preserve an advance retention whenever another bulletin input is recalculated.
    // The advance balance is managed separately, but its amount is part of the
    // bulletin's retention/net-pay result.
    if (!Number(calc.avanceDeduction || 0)) {
        const savedPayslip = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: emp.id, month, year } },
            select: { avanceDeduction: true },
        });
        const savedAdvance = Number(savedPayslip?.avanceDeduction || 0);
        if (savedAdvance > 0) {
            calc.avanceDeduction = savedAdvance;
            calc.netAPayer = Math.max(0, Number((Number(calc.netAPayer || 0) - savedAdvance).toFixed(2)));
        }
    }
    if (!Number(calc.pretDeduction || 0)) {
        const savedPayslip = await prisma.payslip.findUnique({ where: { employeeId_month_year: { employeeId: emp.id, month, year } }, select: { pretDeduction: true } });
        const savedPret = Number(savedPayslip?.pretDeduction || 0);
        if (savedPret > 0) {
            calc.pretDeduction = savedPret;
            calc.netAPayer = Math.max(0, Number((Number(calc.netAPayer || 0) - savedPret).toFixed(2)));
        }
    }
    const irFields = calc.irCumulative;
    return {
        employeeId: emp.id,
        month,
        year,
        workedDays: calc.workedDays,
        workedHours: calc.workedHours,
        paidLeaveDays: calc.paidLeaveDays,
        congeNaissanceDays: calc.congeNaissanceDays,
        joursFeries: calc.joursFeries,
        workingTimeMode: calc.workingTimeMode,
        standardMonthlyDays: calc.standardMonthlyDays,
        standardMonthlyHours: calc.standardMonthlyHours,
        status,
        // Store the contractual base so later payslip edits do not prorate an already prorated amount.
        baseSalary: calc.rawBaseSalary,
        primeAnciennete: calc.primeAnciennete,
        bonusesIMP: calc.bonusesIMP,
        bonusesNIMP: calc.bonusesNIMP,
        brutGlobal: calc.brutGlobal ?? calc.sbg,
        baseConge: calc.baseConge,
        paidLeaveAmount: calc.paidLeaveAmount,
        baseCongeNaissance: calc.baseCongeNaissance,
        congeNaissanceAmount: calc.congeNaissanceAmount,
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
        avanceDeduction: calc.avanceDeduction || 0,
        pretDeduction: calc.pretDeduction || 0,
        absenceDays: 0,
        absenceDeduction: 0,
        heuresSup25: calc.heuresSup25,
        heuresSup50: calc.heuresSup50,
        heuresSup100: calc.heuresSup100,
        primeRendementInput: calc.primeRendementInput,
        primeRendementAmount: calc.primeRendementAmount,
        ...irFields,
    };
}

/**
 * Maps a Prisma Employee object + optional monthly overrides into the unified
 * calculatePayroll() calculation engine.
 */
async function runEmployeeCalculation(emp, overrides = {}) {
    let birthLeaveHistory = [];
    if (Number(overrides.congeNaissanceDays || 0) > 0) {
        const periodDate = overrides.periodDate || (
            overrides.month && overrides.year
                ? new Date(Number(overrides.year), Number(overrides.month), 0)
                : new Date()
        );
        const target = new Date(periodDate);
        birthLeaveHistory = await listBirthLeaveReferencePayslips({
            employeeId: emp.id,
            companyId: emp.companyId,
            year: target.getFullYear(),
            month: target.getMonth() + 1,
        });
    }
    const rawPrimeRendementInput = overrides.primeRendementInput ?? 0;
    const parsedPrimeRendementInput = Number(rawPrimeRendementInput);
    if (!Number.isFinite(parsedPrimeRendementInput) || parsedPrimeRendementInput < 0) {
        throw new Error("PRIME_RENDEMENT_INPUT_INVALID");
    }
    const primeRendementInput = isPrimeRendementEnabled(emp.company) ? parsedPrimeRendementInput : 0;
    const calculate = values => calculatePayroll(emp, applyCompanyPrimeRendementSetting(emp.company,
        applyCompanyOvertimeSetting(emp.company, values)));
    const calculationOverrides = {
        ...overrides,
        birthLeaveHistory,
        primeRendementInput,
        primeRendementAmount: 0,
    };
    const withoutPrime = calculate(calculationOverrides);
    if (!primeRendementInput || !isPrimeRendementEnabled(emp.company)) return withoutPrime;

    const beforePrimeCumulative = await applyCumulativeIR(
        emp.id,
        Number(overrides.month),
        Number(overrides.year),
        withoutPrime,
        overrides.dependents ?? emp.nbPersonacharge,
    );
    const savedDeductions = await prisma.payslip.findFirst({
        where: {
            employeeId: emp.id,
            month: Number(overrides.month),
            year: Number(overrides.year),
            employee: { companyId: emp.companyId },
        },
        select: {
            avanceDeduction: true,
            pretDeduction: true,
            retenus: { select: { amount: true } },
        },
    });
    const avanceDeduction = overrides.avanceDeduction ?? savedDeductions?.avanceDeduction ?? 0;
    const pretDeduction = overrides.pretDeduction ?? savedDeductions?.pretDeduction ?? 0;
    const manualRetenues = overrides.manualRetenuesTotal
        ?? manualRetenueTotal(savedDeductions?.retenus || []);
    const netAPayerBeforePrime = Math.max(0, Number(beforePrimeCumulative.netAPayer || 0)
        - Math.max(0, Number(avanceDeduction || 0))
        - Math.max(0, Number(pretDeduction || 0))
        - Math.max(0, Number(manualRetenues || 0)));
    const primeRendementAmount = calculatePrimeRendement(netAPayerBeforePrime, primeRendementInput);
    return calculate({
        ...calculationOverrides,
        primeRendementAmount,
    });
}

// Draft/generated bulletins follow the employee's current contract data.
// Validated and closed bulletins remain immutable snapshots.
async function refreshOpenBulletinFromEmployee(emp, payslip) {
    if (!payslip || isLockedBulletin(payslip.status)) return payslip;

    const excludedNimpLabels = new Set((payslip.bonuses || [])
        .filter(item => String(item.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
        .map(item => String(item.name).slice(EXCLUDED_NIMP_PREFIX.length).trim().toLowerCase()));
    const payslipWorkingTime = resolveWorkingTimeForPayslip(emp, payslip);
    const payslipRatio = Number(payslipWorkingTime.ratio || 0);
    const ficheNimpAmounts = new Map((emp.bonuses || [])
        .filter(item => !(item.bonus ? item.bonus.taxable : item.taxable))
        .map(item => [
            String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase(),
            Number(item.amount || 0) * payslipRatio,
        ]));
    const employeeRepresentationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
    if (employeeRepresentationLabel) {
        ficheNimpAmounts.set(
            employeeRepresentationLabel,
            Number(emp.baseSalary || 0) * Number(emp.indemniteRepresentationRate || 0) * payslipRatio
        );
    }
    const overriddenNimpLabels = new Set((payslip.bonuses || [])
        .filter(item => !item.taxable
            && !String(item.name || '').startsWith(EXCLUDED_NIMP_PREFIX)
            && (ficheNimpAmounts.has(String(item.name || '').trim().toLowerCase())
                ? Math.abs(ficheNimpAmounts.get(String(item.name || '').trim().toLowerCase()) - Number(item.amount || 0)) > 0.005
                : Math.abs(payslipBonusBaseAmount(item) - Number(item.amount || 0)) > 0.005))
        .map(item => String(item.name || '').trim().toLowerCase()));
    const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
    const representationOverridden = overriddenNimpLabels.has(representationLabel);
    const calculationEmployee = {
        ...emp,
        bonuses: (emp.bonuses || []).filter(item => !excludedNimpLabels.has(
            String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase()
        ) && !overriddenNimpLabels.has(
            String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase()
        )),
        ...(excludedNimpLabels.has(representationLabel) || representationOverridden
            ? { indemniteRepresentationName: null, indemniteRepresentationRate: null }
            : {}),
    };
    const fixedTaxableLabels = new Set((calculationEmployee.bonuses || [])
        .filter(b => b.bonus ? Boolean(b.bonus.taxable) : Boolean(b.taxable))
        .map(b => `${String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()}|${Number(b.amount)}`));
    const fixedNimpLabels = new Set((calculationEmployee.bonuses || [])
        .filter(item => item.bonus ? !Boolean(item.bonus.taxable) : !Boolean(item.taxable))
        .map(item => String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase()));
    const variablePrimes = (payslip.bonuses || [])
        .filter(item => item.taxable && !fixedTaxableLabels.has(String(item.name).trim().toLowerCase()))
        .map(item => ({ rubriqueImposableId: item.rubriqueImposableId || null, code: item.code || '', label: item.name, amount: Number(item.amount), baseAmount: payslipBonusBaseAmount(item) }));
        const monthlyNimpLines = (payslip.bonuses || [])
        .filter(item => !item.taxable
            && (!fixedNimpLabels.has(String(item.name).trim().toLowerCase())
                || overriddenNimpLabels.has(String(item.name).trim().toLowerCase()))
            && (!representationLabel
                || String(item.name).trim().toLowerCase() !== representationLabel
                || representationOverridden)
            && !String(item.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
        .map(item => ({ code: item.code || '', label: item.name, amount: Number(item.amount), baseAmount: payslipBonusBaseAmount(item) }));

    const monthlyCalc = await runEmployeeCalculation(calculationEmployee, {
        month: payslip.month,
        year: payslip.year,
        ...resolveWorkingTimeForPayslip(calculationEmployee, payslip),
        // No baseSalary override: use the employee's current base salary.
        heuresSup25: Number(payslip.heuresSup25 || 0),
        heuresSup50: Number(payslip.heuresSup50 || 0),
        heuresSup100: Number(payslip.heuresSup100 || 0),
        primeRendementInput: Number(payslip.primeRendementInput || 0),
            paidLeaveDays: Number(payslip.paidLeaveDays || 0),
            congeNaissanceDays: Number(payslip.congeNaissanceDays || 0),
            joursFeries: Number(payslip.joursFeries || 0),
            variablePrimes,
        monthlyNimpLines,
    });
    const calc = await applyCumulativeIR(calculationEmployee.id, payslip.month, payslip.year, monthlyCalc, calculationEmployee.nbPersonacharge);
    calc.avanceDeduction = Number(payslip.avanceDeduction || 0);
    calc.netAPayer = Math.max(0, Number((Number(calc.netAPayer || 0) - calc.avanceDeduction).toFixed(2)));
    const rates = await getPayrollRates();
    const data = await buildPayslipData(calculationEmployee, calc, payslip.month, payslip.year, rates, payslip.status);
    return savePayslipWithBonuses(data, payslip.id, calc);
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
export function mapPayslipToViewModel(p, representationRate = null) {
    if (!p) return null;
    const variablePrimes = (p.bonuses || [])
        .filter(b => b.taxable && !String(b.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
        .map(b => ({ rubriqueImposableId: b.rubriqueImposableId || null, code: b.code || '', label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
    const nimpLines = (p.bonuses || [])
        .filter(b => !b.taxable && !String(b.name || '').startsWith(EXCLUDED_NIMP_PREFIX) && payslipBonusBaseAmount(b) > 0)
        .map(b => ({ code: b.code || '', label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
    const retenus = (p.retenus || []).map(row => ({
        id: row.id,
        rubriqueRetenuId: row.rubriqueRetenuId,
        code: row.code,
        label: row.name,
        amount: Number(row.amount),
    }));
    const avanceDeductions = (p.avanceDeductions || []).map(row => ({
        id: row.id,
        avanceId: row.avanceId,
        amount: Number(row.amount || 0),
        avanceSolde: row.avance ? Number(row.avance.solde || 0) : null,
    }));
    const pretDeductions = (p.pretDeductions || []).map(row => ({
        id: row.id,
        pretId: row.pretId,
        amount: Number(row.amount || 0),
        pretSolde: row.pret ? Number(row.pret.solde || 0) : null,
    }));
    // An exclusion marker can mean two things: the indemnity was removed from
    // this bulletin, or its recurring amount was overridden here. Only the
    // former should offer a "restore" action; an override already has an
    // editable line above.
    const nimpLabelKeys = new Set(nimpLines.map(line => String(line.label || '').trim().toLowerCase()));
    const excludedNimpLines = (p.bonuses || [])
        .filter(b => String(b.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
        .map(b => ({ label: String(b.name).slice(EXCLUDED_NIMP_PREFIX.length), amount: Number(b.amount) }))
        .filter(line => !nimpLabelKeys.has(String(line.label || '').trim().toLowerCase()));

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
        - Number(p.cimr || 0) - Number(p.irNet || 0)).toFixed(2));
    const arrondi = Number((Math.round(exactNetAPayer) - exactNetAPayer).toFixed(2));

    return {
        id: p.id,
        employeeId: p.employeeId,
        month: p.month,
        year: p.year,
        periode: p.moisEcoules,
        workedDays,
        workedHours,
        paidLeaveDays: Number(p.paidLeaveDays || 0),
        congeNaissanceDays: Number(p.congeNaissanceDays || 0),
        joursFeries: Number(p.joursFeries || 0),
        workingTimeMode,
        standardMonthlyDays,
        standardMonthlyHours,
        status: (p.status || 'DRAFT').toLowerCase(),
        rawStatus: p.status,
        baseSalary: effectiveBase,
        rawBaseSalary: storedBaseSalary,
        // Keep the configured percentage separate from the rounded indemnity
        // amount. Reconstructing it from amount / base can display 10.01% for
        // an exact 10% rate when the amount was rounded to cents.
        indemniteNonImposableRate: representationRate === null || representationRate === undefined
            ? null
            : Number(representationRate),
        primeAnciennete: Number(p.primeAnciennete),
        ancienneteRate: effectiveBase > 0 ? Number((Number(p.primeAnciennete) / effectiveBase).toFixed(2)) : 0,
        bonusesIMP: Number(p.bonusesIMP),
        bonusesNIMP: Number(p.bonusesNIMP),
        brutGlobal: Number(p.brutGlobal ?? p.sbg),
        baseConge: Number(p.baseConge || 0),
        paidLeaveAmount: Number(p.paidLeaveAmount || 0),
        baseCongeNaissance: Number(p.baseCongeNaissance || 0),
        congeNaissanceAmount: Number(p.congeNaissanceAmount || 0),
        baseFerie: Number(p.baseFerie || 0),
        joursFeriesAmount: Number(p.joursFeriesAmount || 0),
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
        avanceDeduction: Number(p.avanceDeduction || 0),
        avanceDeductionConfigured: Boolean(p.avanceDeductionConfigured || Number(p.avanceDeduction || 0) > 0),
        pretDeduction: Number(p.pretDeduction || 0),
        pretDeductionConfigured: Boolean(p.pretDeductionConfigured || Number(p.pretDeduction || 0) > 0),
        netAPayer: p.netAPayer !== null && p.netAPayer !== undefined
            ? Number(p.netAPayer)
            : Number((exactNetAPayer + arrondi - Number(p.avanceDeduction || 0) - Number(p.pretDeduction || 0)).toFixed(2)),
        absenceDays: 0,
        absenceDeduction: 0,
        heuresSup25: hs25,
        heuresSup50: hs50,
        heuresSup100: hs100,
        primeRendementInput: Number(p.primeRendementInput || 0),
        primeRendementAmount: Number(p.primeRendementAmount || 0),
        hs25Amount,
        hs50Amount,
        hs100Amount,
        heuresSupAmount,
        variablePrimes,
        nimpLines,
        retenus,
        avanceDeductions,
        pretDeductions,
        manualRetenusTotal: manualRetenueTotal(retenus),
        excludedNimpLines,
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
        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
        const netMin = req.query.netMin !== undefined && req.query.netMin !== '' && Number.isFinite(Number(req.query.netMin)) ? Number(req.query.netMin) : null;
        const netMax = req.query.netMax !== undefined && req.query.netMax !== '' && Number.isFinite(Number(req.query.netMax)) ? Number(req.query.netMax) : null;
        const bulkResult = req.query.bulkResult
            ? JSON.parse(decodeURIComponent(req.query.bulkResult))
            : null;
        const bulletinError = req.query.bulletinError ? String(req.query.bulletinError) : null;
        const companySettings = await prisma.company.findUnique({
            where: { id: companyId },
            select: { overtimeEnabled: true, primeRendementEnabled: true, chantiersEnabled: true },
        });
        const overtimeEnabled = isOvertimeEnabled(companySettings);
        const primeRendementEnabled = isPrimeRendementEnabled(companySettings);
        const chantiersEnabled = isChantiersEnabled(companySettings);
        const chantierId = resolveChantierFilter(req.query.chantierId, chantiersEnabled);

        // Keep inactive employees visible so their payroll state is explicit in the list.
        // Push list filters into SQL and select only fields used by this page;
        // loading complete employee/company/payroll graphs made this endpoint
        // increasingly expensive as the workforce grew.
        const employeeWhere = {
            companyId,
            ...employeeBulletinVisibilityWhere(month, year),
            bulletinMasks: { none: { month, year } },
        };
        const dbEmployees = await prisma.employee.findMany({
            where: employeeWhere,
            orderBy: [{ matricule: 'asc' }, { nomComplet: 'asc' }, { id: 'asc' }],
            select: {
                id: true,
                nomComplet: true,
                matricule: true,
                categoryId: true,
                ...(chantiersEnabled ? { chantierId: true, chantierNom: true } : {}),
                blocageSaisiePaie: true,
                baseSalary: true,
                indemniteRepresentationName: true,
                indemniteRepresentationRate: true,
                company: {
                    select: {
                        workingTimeMode: true,
                        standardMonthlyDays: true,
                        standardMonthlyHours: true,
                        chantiersEnabled: true,
                        primeRendementEnabled: true,
                    },
                },
                category: { select: { name: true } },
                bonuses: {
                    select: {
                        amount: true,
                        bonus: {
                            select: {
                                code: true,
                                name: true,
                                defaultAmount: true,
                                taxable: true,
                            },
                        },
                    },
                },
                prets: {
                    where: { solde: { gt: 0 } },
                    select: { monthlyAmount: true, solde: true },
                },
                payslips: {
                    where: { month, year },
                    select: {
                        id: true,
                        employeeId: true,
                        month: true,
                        year: true,
                        workedDays: true,
                        workedHours: true,
                        paidLeaveDays: true,
                        congeNaissanceDays: true,
                        joursFeries: true,
                        workingTimeMode: true,
                        standardMonthlyDays: true,
                        standardMonthlyHours: true,
                        status: true,
                        validatedAt: true,
                        baseSalary: true,
                        primeAnciennete: true,
                        bonusesIMP: true,
                        bonusesNIMP: true,
                        baseConge: true,
                        paidLeaveAmount: true,
                        baseCongeNaissance: true,
                        congeNaissanceAmount: true,
                        baseFerie: true,
                        joursFeriesAmount: true,
                        brutGlobal: true,
                        sbg: true,
                        sbi: true,
                        cnss: true,
                        cnssRate: true,
                        amo: true,
                        amoRate: true,
                        cimr: true,
                        cimrRate: true,
                        fraisPro: true,
                        fraisProRate: true,
                        sni: true,
                        moisEcoules: true,
                        irRate: true,
                        irNet: true,
                        irBrut: true,
                        irTheorique: true,
                        sommeADeduire: true,
                        chargesDeFamille: true,
                        netAPayer: true,
                        avanceDeduction: true,
                        avanceDeductionConfigured: true,
                        pretDeduction: true,
                        pretDeductionConfigured: true,
                        heuresSup25: true,
                        heuresSup50: true,
                        heuresSup100: true,
                        primeRendementInput: true,
                        primeRendementAmount: true,
                        createdAt: true,
                        bonuses: {
                            select: {
                                id: true,
                                rubriqueImposableId: true,
                                name: true,
                                code: true,
                                amount: true,
                                baseAmount: true,
                                taxable: true,
                            },
                        },
                    },
                    take: 1
                }
            }
        });
        const rubriqueMaps = await getRubriqueMaps(companyId);

        const mappedEmployees = dbEmployees.map(emp => {
            const payslip = emp.payslips[0] || null;
            const savedPretDeduction = Number(payslip?.pretDeduction || 0);
            const scheduledPretDeduction = (emp.prets || []).reduce(
                (total, pret) => total + Math.min(Number(pret.monthlyAmount || 0), Number(pret.solde || 0)),
                0,
            );
            const canUseScheduledPret = !emp.blocageSaisiePaie && (!payslip || !isLockedBulletin(payslip.status));
            const pretDeduction = savedPretDeduction > 0
                ? savedPretDeduction
                : canUseScheduledPret ? Number(scheduledPretDeduction.toFixed(2)) : 0;
            let status = payslip ? payslip.status.toLowerCase() : "none";
            if (emp.blocageSaisiePaie) {
                status = "blocked";
            }

            const recurringNimpLabels = new Set((emp.bonuses || [])
                .filter(item => !(item.bonus ? item.bonus.taxable : item.taxable))
                .map(item => String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase()));
            if (emp.indemniteRepresentationName) {
                recurringNimpLabels.add(String(emp.indemniteRepresentationName).trim().toLowerCase());
            }

            const variablesEntered = payslip ? (
                Number(payslip.workedDays) < Number(emp.company?.standardMonthlyDays || PAYROLL_WORKED_DAYS) ||
                (overtimeEnabled && (
                    Number(payslip.heuresSup25 || 0) > 0 ||
                    Number(payslip.heuresSup50 || 0) > 0 ||
                    Number(payslip.heuresSup100 || 0) > 0
                )) ||
                (primeRendementEnabled && Number(payslip.primeRendementInput || 0) > 0) ||
                (payslip.bonuses && payslip.bonuses.length > 0)
            ) : false;
            const rawBulletinView = payslip
                ? hidePrimeRendementFromView(
                    hideOvertimeFromView(mapPayslipToViewModel(payslip, emp.indemniteRepresentationRate), overtimeEnabled),
                    primeRendementEnabled,
                )
                : null;
            const bulletinView = rawBulletinView
                ? filterInvisibleRubriqueLines(rawBulletinView, rubriqueMaps.rubriqueVisibility)
                : null;
            const bulletinComponents = listBulletinComponents(bulletinView, rubriqueMaps, recurringNimpLabels, overtimeEnabled, primeRendementEnabled);
            const workingTime = payslip ? resolveWorkingTimeForPayslip(emp, payslip) : null;
            const rubriqueVisibilityInputs = [];
            if (rawBulletinView) {
                rawBulletinView.variablePrimes
                    .filter(line => line.rubriqueImposableId !== null && line.rubriqueImposableId !== undefined
                        && !isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, line))
                    .forEach(line => {
                        rubriqueVisibilityInputs.push(
                            { name: 'primesLabels', value: line.label },
                            { name: 'primesAmounts', value: line.amount },
                        );
                    });
                [
                    ['heuresSup25', 'overtime_25'],
                    ['heuresSup50', 'overtime_50'],
                    ['heuresSup100', 'overtime_100'],
                ].forEach(([field, calculationKey]) => {
                    if (!overtimeEnabled || !isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, { calculationKey })) {
                        rubriqueVisibilityInputs.push({ name: field, value: rawBulletinView[field] || 0 });
                    }
                });
                if (!isRubriqueVisible(rubriqueMaps.rubriqueVisibility, 'base', 'base_salary')) {
                    const field = (emp.company?.workingTimeMode || rawBulletinView.workingTimeMode) === 'HOURS'
                        ? 'workedHours'
                        : 'workedDays';
                    rubriqueVisibilityInputs.push({ name: field, value: rawBulletinView[field] || 0 });
                }
            }
            const ficheRatio = Number(workingTime?.ratio || 1);
            const ficheAmounts = new Map((emp.bonuses || [])
                .filter(item => !(item.bonus ? item.bonus.taxable : item.taxable))
                .map(item => [
                    String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase(),
                    Number(item.bonus?.defaultAmount ?? item.amount ?? 0) * ficheRatio,
                ]));
            const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
            if (representationLabel) {
                ficheAmounts.set(
                    representationLabel,
                    Number(emp.baseSalary || 0) * Number(emp.indemniteRepresentationRate || 0) * ficheRatio
                );
            }
            const editableBulletinComponents = bulletinComponents.map(component => {
                if (component.kind !== 'nimp') return component;
                const key = String(component.label || '').trim().toLowerCase();
                return {
                    ...component,
                    maxAmount: ficheAmounts.has(key) ? ficheAmounts.get(key) : Number(component.baseAmount ?? component.gains ?? 0),
                };
            });

            return {
                id: emp.id,
                nomComplet: emp.nomComplet,
                matricule: emp.matricule,
                categoryId: emp.categoryId,
                categoryName: emp.category?.name || '',
                chantierId: chantiersEnabled ? emp.chantierId : null,
                chantierNom: chantiersEnabled ? (emp.chantierNom || '') : '',
                // A generated bulletin is a monthly snapshot. Prefer it over the
                // employee's current contract values for this period.
                baseSalary: payslip ? Number(payslip.baseSalary) : Number(emp.baseSalary),
                dateEmbauche: emp.dateEmbauche,
                blocageSaisiePaie: emp.blocageSaisiePaie,
                // The overview follows the company's configured input mode.
                // Do not expose the other unit from a saved/validated snapshot.
                workingTimeMode: emp.company?.workingTimeMode || payslip?.workingTimeMode || "DAYS",
                standardMonthlyDays: Number(emp.company?.standardMonthlyDays || payslip?.standardMonthlyDays || DEFAULT_STANDARD_MONTHLY_DAYS),
                standardMonthlyHours: Number(emp.company?.standardMonthlyHours || payslip?.standardMonthlyHours || DEFAULT_STANDARD_MONTHLY_HOURS),
                overtimeEnabled,
                primeRendementEnabled,
                maskedForPeriod: false,
                bulletin: bulletinView,
                hasPret: (emp.prets || []).length > 0 || savedPretDeduction > 0,
                pretDeduction,
                pretDeductionSource: savedPretDeduction > 0 ? 'applied' : pretDeduction > 0 ? 'scheduled' : null,
                bulletinComponents: editableBulletinComponents,
                rubriqueVisibilityInputs,
                bulletinStatus: status,
                variablesEntered,
            };
        }).filter(emp => !categoryId || emp.categoryId === categoryId);
        const employees = filterEmployeesByChantier(mappedEmployees, chantierId, chantiersEnabled)
            .filter(emp => netMin === null || (emp.bulletin && Number(emp.bulletin.netAPayer) >= netMin))
            .filter(emp => netMax === null || (emp.bulletin && Number(emp.bulletin.netAPayer) <= netMax));
        const hasPretColumn = employees.some(emp => emp.hasPret);
        const rubriqueColumns = [];
        const rubriqueColumnKeys = new Set();
        employees.forEach(employee => (employee.bulletinComponents || []).forEach(component => {
            const key = `${component.code}|${component.label}`;
            if (rubriqueColumnKeys.has(key)) return;
            rubriqueColumnKeys.add(key);
            rubriqueColumns.push({
                key,
                code: component.code,
                label: component.label,
                kind: component.kind,
                rubriqueVisibilityCategory: component.rubriqueVisibilityCategory,
                rubriqueVisibilityKey: component.rubriqueVisibilityKey,
            });
        }));

        const categories = await prisma.employeeCategory.findMany({
            where: { companyId },
            orderBy: { name: 'asc' },
            select: { id: true, name: true },
        });
        const apiChantiers = chantiersEnabled ? await listChantiers() : [];
        const knownChantierIds = new Set(apiChantiers.map(item => Number(item.id)));
        const storedChantiers = dbEmployees
            .filter(emp => emp.chantierId && !knownChantierIds.has(Number(emp.chantierId)))
            .map(emp => ({ id: Number(emp.chantierId), nom: emp.chantierNom || `Chantier ${emp.chantierId}` }));
        const chantiers = [...apiChantiers, ...storedChantiers]
            .filter((item, index, rows) => rows.findIndex(candidate => Number(candidate.id) === Number(item.id)) === index)
            .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));


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
            hasPretColumn,
            rubriqueColumns,
            month,
            year,
            monthName: MONTH_NAMES_FR[month],
            monthNames: MONTH_NAMES_FR,
            fmt,
            bulkResult,
            bulletinError,
            closeResult,
            validateResult,
            draftResult,
            overtimeEnabled,
            primeRendementEnabled,
            chantiersEnabled,
            rubriqueVisibility: rubriqueMaps.rubriqueVisibility,
            categories,
            chantiers,
            filters: { categoryId: categoryId || '', chantierId: chantierId || '', netMin: netMin ?? '', netMax: netMax ?? '' },
        });
    } catch (err) {
        console.error("Error listing bulletins:", err);
        res.status(500).redirect("/bulletins");
    }
};

// POST /bulletins/:id/mask — hide an employee from this period or this and later periods.
export const maskBulletin = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.body.month);
    const year = Number(req.body.year);
    const scope = ["all", "future"].includes(req.body.scope) ? "future" : "month";

    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040) {
        return res.status(400).send("Période invalide.");
    }

    try {
        const companyId = await resolveCompanyId(req);
        const employee = await prisma.employee.findFirst({ where: { id: empId, companyId } });
        if (!employee) return res.status(404).send("Employé introuvable.");
        if (!employee.blocageSaisiePaie) return res.status(400).send("Seuls les employés dont la saisie de paie est bloquée peuvent être masqués.");

        if (scope === "future") {
            await prisma.employee.update({
                where: { id: empId },
                data: { bulletinMasque: true, bulletinMasqueDepuis: year * 100 + month },
            });
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
        const eligiblePayslips = await prisma.payslip.findMany({
            where: {
                month,
                year,
                employee: { companyId, blocageSaisiePaie: false },
                status: { in: [BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED] },
            },
            select: { workedDays: true, paidLeaveDays: true, congeNaissanceDays: true, joursFeries: true, standardMonthlyDays: true },
        });
        if (eligiblePayslips.some(row => hasPaidLeaveConflict(row.workedDays, row.paidLeaveDays, row.standardMonthlyDays, row.joursFeries, row.congeNaissanceDays))) {
            return rejectPaidLeaveConflict(res, false);
        }
        const result = await prisma.payslip.updateMany({
            where: {
                month,
                year,
                employee: { companyId, blocageSaisiePaie: false },
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
        if (result.count > 0 && !(month === 12 && year === 2040)) {
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            req.session.selectedPeriod = { month: nextMonth, year: nextYear };
            return res.redirect(`/bulletins?month=${nextMonth}&year=${nextYear}`);
        }
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
            where: { companyId },
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
        let pretDeductionsApplied = 0;
        const errors = [];

        for (const emp of eligibleEmployees) {
            try {
                const existing = emp.payslips[0] || null;
                if (existing) {
                    if (!emp.blocageSaisiePaie && !isLockedBulletin(existing.status) && Number(existing.pretDeduction || 0) <= 0) {
                        const employeePrets = await listEmployeePrets(emp.id);
                        const automaticPretDeduction = employeePrets.reduce(
                            (total, pret) => total + Math.min(Number(pret.monthlyAmount || 0), Number(pret.solde || 0)),
                            0,
                        );
                        if (automaticPretDeduction > 0) {
                            await setPretDeduction({
                                companyId,
                                employeeId: emp.id,
                                month,
                                year,
                                amount: automaticPretDeduction,
                            });
                            pretDeductionsApplied++;
                            console.info("[pret] bulk_deduction.applied", {
                                companyId,
                                employeeId: emp.id,
                                month,
                                year,
                                amount: Number(automaticPretDeduction.toFixed(2)),
                            });
                        }
                    }
                    skipped++;
                    continue;
                }
                const monthlyCalc = await runEmployeeCalculation(emp, { month, year });
                const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
                const employeePrets = emp.blocageSaisiePaie ? [] : await listEmployeePrets(emp.id);
                const automaticPretDeduction = employeePrets.reduce(
                    (total, pret) => total + Math.min(Number(pret.monthlyAmount || 0), Number(pret.solde || 0)),
                    0,
                );
                calc.pretDeduction = Number(automaticPretDeduction.toFixed(2));
                const payslipData = await buildPayslipData(emp, calc, month, year, rates);

                await prisma.$transaction(async transaction => {
                    await savePayslipWithBonuses(payslipData, null, calc, [], [], transaction);
                    if (automaticPretDeduction > 0) {
                        await setPretDeduction({
                            companyId,
                            employeeId: emp.id,
                            month,
                            year,
                            amount: automaticPretDeduction,
                            client: transaction,
                        });
                    }
                });
                if (automaticPretDeduction > 0) {
                    pretDeductionsApplied++;
                    console.info("[pret] bulk_deduction.applied", {
                        companyId,
                        employeeId: emp.id,
                        month,
                        year,
                        amount: Number(automaticPretDeduction.toFixed(2)),
                    });
                }
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

        const bulkResult = encodeURIComponent(JSON.stringify({ created, skipped, pretDeductionsApplied, errors }));
        res.redirect(`/bulletins?month=${month}&year=${year}&bulkResult=${bulkResult}`);
    } catch (err) {
        console.error("Bulk generate error:", err);
        res.redirect("/bulletins");
    }
};

// Generate bulletins from imported Livre de paie inputs while keeping every
// calculation inside the normal payroll engine and cumulative IR workflow.
export const generateBulletinsFromPayrollBook = async ({ companyId, month, year, rows }) => {
    const rates = await getPayrollRates();
    const employeeIds = rows.map(row => Number(row.employeeId)).filter(Number.isInteger);
    const employees = await prisma.employee.findMany({
        where: { companyId: Number(companyId), id: { in: employeeIds } },
        include: { company: true, bonuses: { include: { bonus: true } } },
    });
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const result = { created: 0, updated: 0, skipped: 0, errors: [] };

    for (const row of rows) {
        const employee = employeesById.get(Number(row.employeeId));
        if (!employee) {
            result.errors.push({ sourceRow: row.sourceRow, message: "Salarié introuvable dans la société active." });
            continue;
        }
        if (employee.blocageSaisiePaie) {
            result.skipped += 1;
            result.errors.push({ sourceRow: row.sourceRow, message: `${employee.nomComplet}: saisie bloquée.` });
            continue;
        }
        try {
            const existing = await prisma.payslip.findUnique({ where: { employeeId_month_year: { employeeId: employee.id, month: Number(month), year: Number(year) } } });
            if (existing && isLockedBulletin(existing.status)) {
                result.skipped += 1;
                result.errors.push({ sourceRow: row.sourceRow, message: `${employee.nomComplet}: bulletin validé ou clôturé, non modifié.` });
                continue;
            }
            const hasImportedNimpTotal = row.totalPrimeNonImposable !== null && row.totalPrimeNonImposable !== undefined;
            const importedNimpTotal = hasImportedNimpTotal ? Number(row.totalPrimeNonImposable) : null;
            if (hasImportedNimpTotal && (!Number.isFinite(importedNimpTotal) || importedNimpTotal < 0 || importedNimpTotal > 999999.99)) {
                throw new Error("PAYROLL_BOOK_NIMP_TOTAL_INVALID");
            }
            // A supplied aggregate covers all non-taxable lines in the source
            // bulletin. Replace recurring NIMP inputs for this import only,
            // then retain the aggregate as one bulletin detail line.
            const calculationEmployee = hasImportedNimpTotal
                ? {
                    ...employee,
                    bonuses: (employee.bonuses || []).filter(item => item.bonus ? Boolean(item.bonus.taxable) : Boolean(item.taxable)),
                    indemniteRepresentationName: null,
                    indemniteRepresentationRate: null,
                }
                : employee;
            const monthlyNimpLines = hasImportedNimpTotal
                ? importedNimpTotal > 0
                    ? [{ label: "Total primes non imposables", amount: Number(importedNimpTotal.toFixed(2)), baseAmount: Number(importedNimpTotal.toFixed(2)) }]
                    : []
                : row.nimpLines;
            const monthlyCalc = await runEmployeeCalculation(calculationEmployee, {
                month: Number(month),
                year: Number(year),
                baseSalary: row.baseSalary ?? undefined,
                workedDays: row.workedDays ?? undefined,
                workedHours: row.workedHours ?? undefined,
                heuresSup25: row.heuresSup25,
                heuresSup50: row.heuresSup50,
                heuresSup100: row.heuresSup100,
                paidLeaveDays: row.paidLeaveDays,
                congeNaissanceDays: row.congeNaissanceDays,
                joursFeries: row.joursFeries,
                avanceDeduction: row.avances,
                pretDeduction: row.pretDeduction,
                variablePrimes: row.variablePrimes,
                monthlyNimpLines,
            });
            const calc = await applyCumulativeIR(employee.id, Number(month), Number(year), monthlyCalc, employee.nbPersonacharge);
            const payslipData = await buildPayslipData(employee, calc, Number(month), Number(year), rates, existing?.status || BULLETIN_STATUS.GENERATED);
            await savePayslipWithBonuses(payslipData, existing?.id || null, calc);
            existing ? result.updated += 1 : result.created += 1;
        } catch (error) {
            console.error("Livre de paie bulletin generation error:", { employeeId: employee.id, sourceRow: row.sourceRow, error });
            result.errors.push({ sourceRow: row.sourceRow, message: `${employee.nomComplet}: impossible de générer le bulletin.` });
        }
    }
    return result;
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
        if (emp.blocageSaisiePaie) return res.status(400).send("Impossible de générer le bulletin : la saisie est bloquée pour cet employé.");

        // Check if existing bulletin is already VALIDATED
        const existing = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } }
        });
        if (rejectLockedBulletin(res, existing)) return;
        const rawPrimeRendementInput = req.body.primeRendementInput
            ?? req.query.primeRendementInput
            ?? existing?.primeRendementInput
            ?? 0;
        const parsedPrimeRendementInput = Number(rawPrimeRendementInput);
        if (!Number.isFinite(parsedPrimeRendementInput) || parsedPrimeRendementInput < 0 || parsedPrimeRendementInput > 999999.99) {
            return res.status(400).send("La saisie de la prime rendement doit être un nombre positif ou nul.");
        }
        const primeRendementInput = Number(parsedPrimeRendementInput.toFixed(2));
        const availableAvances = existing ? null : await listEmployeeAvances(emp.id);
        const initialAvanceDeduction = availableAvances
            ? availableAvances.reduce((total, avance) => total + Number(avance.solde || 0), 0)
            : 0;
        const submittedAvanceDeduction = req.body.avanceDeduction !== undefined
            ? Math.max(0, Number(req.body.avanceDeduction) || 0)
            : Number(existing?.avanceDeduction || initialAvanceDeduction);
        const employeePretsForDefault = await listEmployeePrets(emp.id);
        const automaticPretDeduction = employeePretsForDefault.reduce((total, pret) => total + Math.min(Number(pret.monthlyAmount || 0), Number(pret.solde || 0)), 0);
        const requestedPretDeduction = req.body.pretDeduction === undefined
            ? 0
            : Math.max(0, Number(req.body.pretDeduction) || 0);
        const submittedPretDeduction = requestedPretDeduction > 0
            ? requestedPretDeduction
            : Number(existing?.pretDeduction || 0) > 0
                ? Number(existing.pretDeduction)
                : automaticPretDeduction;

        // Parse variable primes submitted from workspace
        const rawLabels = req.body.primesLabels ?? req.query.primesLabels;
        const rawAmounts = req.body.primesAmounts ?? req.query.primesAmounts;
        const variablePrimes = parseVariablePrimes(rawLabels, rawAmounts);
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
                workedDays: emp.blocageSaisiePaie ? 0 : (req.body.workedDays ?? req.query.workedDays),
                workedHours: emp.blocageSaisiePaie ? 0 : (req.body.workedHours ?? req.query.workedHours),
            }),
            heuresSup25: req.body.heuresSup25 || req.query.heuresSup25 || 0,
            heuresSup50: req.body.heuresSup50 || req.query.heuresSup50 || 0,
            heuresSup100: req.body.heuresSup100 || req.query.heuresSup100 || 0,
            primeRendementInput,
            paidLeaveDays: req.body.paidLeaveDays ?? req.query.paidLeaveDays ?? existing?.paidLeaveDays ?? 0,
            congeNaissanceDays: req.body.congeNaissanceDays ?? req.query.congeNaissanceDays ?? existing?.congeNaissanceDays ?? 0,
            joursFeries: req.body.joursFeries ?? req.query.joursFeries ?? existing?.joursFeries ?? 0,
            variablePrimes,
            monthlyNimpLines,
            niimpOverrides,
            avanceDeduction: submittedAvanceDeduction,
            pretDeduction: submittedPretDeduction,
            
        };

        if (!Number.isInteger(Number(overrides.congeNaissanceDays)) || Number(overrides.congeNaissanceDays) < 0 || Number(overrides.congeNaissanceDays) > PAYROLL_WORKED_DAYS) {
            const error = "Le congé de naissance doit être saisi en jours entiers, entre 0 et 26.";
            return String(req.headers.accept || '').includes('application/json')
                ? res.status(400).json({ ok: false, error })
                : res.status(400).send(error);
        }
        if (hasPaidLeaveConflict(overrides.workedDays, overrides.paidLeaveDays, overrides.standardMonthlyDays, overrides.joursFeries, overrides.congeNaissanceDays)) {
            return rejectPaidLeaveConflict(res, String(req.headers.accept || '').includes('application/json'));
        }

        const monthlyCalc = await runEmployeeCalculation(emp, overrides);
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, overrides.dependents ?? emp.nbPersonacharge);
        calc.avanceDeduction = submittedAvanceDeduction;
        calc.pretDeduction = submittedPretDeduction;
        calc.netAPayer = Math.max(0, Number((Number(calc.netAPayer || 0) - calc.avanceDeduction - calc.pretDeduction).toFixed(2)));
        const submittedBaseSalary = overrides.baseSalary !== undefined && overrides.baseSalary !== null && overrides.baseSalary !== ''
            ? Number(overrides.baseSalary)
            : Number(emp.baseSalary);
        if (!Number.isFinite(submittedBaseSalary) || submittedBaseSalary < 0) {
            return res.status(400).send("Le salaire de base doit être un montant positif ou nul.");
        }

        // Keep the employee's contractual salary aligned with the latest payroll input.
        if (!emp.blocageSaisiePaie) {
            await prisma.employee.update({
                where: { id: empId },
                data: { baseSalary: submittedBaseSalary },
            });
        }

        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates, existing?.status || BULLETIN_STATUS.GENERATED);

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

        await setAvanceDeduction({
            companyId: resolveCompanyId(req),
            employeeId: empId,
            month,
            year,
            amount: submittedAvanceDeduction,
        });
        await setPretDeduction({ companyId: resolveCompanyId(req), employeeId: empId, month, year, amount: submittedPretDeduction });

        await persistPayslipBonuses(payslip.id, calc);
        await applyManualRetenuesToNet(payslip.id, calc.netAPayer);

        if (String(req.headers.accept || '').includes('application/json')) {
            return res.json({ ok: true, payslipId: payslip.id });
        }
        res.redirect(`/bulletins?month=${month}&year=${year}`);
    } catch (err) {
        console.error("Single generate error:", err);
        if (String(req.headers.accept || '').includes('application/json')) {
            return res.status(500).json({ ok: false, error: err.message || "Impossible d'enregistrer le bulletin." });
        }
        res.redirect("/bulletins");
    }
};

export const addAvanceDeduction = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.body.month || req.query.month);
    const year = Number(req.body.year || req.query.year);
    try {
        await setAvanceDeduction({ companyId: resolveCompanyId(req), employeeId: empId, month, year, amount: req.body.amount });
        if (String(req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
        return res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (error) {
        const messages = {
            PAYSLIP_REQUIRED: "Générez le bulletin avant d'ajouter une avance.",
            BULLETIN_LOCKED: "Ce bulletin est verrouillé.",
            ADVANCE_BALANCE_TOO_LOW: "Le montant dépasse le solde disponible de l'avance.",
            INVALID_ADVANCE_AMOUNT: "Saisissez un montant d'avance valide.",
        };
        const message = messages[error.message] || "Impossible d'ajouter la déduction.";
        if (String(req.headers.accept || '').includes('application/json')) return res.status(400).json({ ok: false, error: message });
        return res.status(400).send(message);
    }
};

export const deleteAvanceDeduction = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.body.month || req.query.month);
    const year = Number(req.body.year || req.query.year);
    try {
        await removeAvanceDeduction({ companyId: resolveCompanyId(req), employeeId: empId, month, year, deductionId: req.body.deductionId });
        return res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (error) {
        return res.status(400).send(error.message === "BULLETIN_LOCKED" ? "Ce bulletin est verrouillé." : "Impossible de supprimer la déduction.");
    }
};

export const addPretDeduction = async (req, res) => {
    const empId = Number(req.params.id);
    const month = Number(req.body.month || req.query.month);
    const year = Number(req.body.year || req.query.year);
    try {
        await setPretDeduction({ companyId: resolveCompanyId(req), employeeId: empId, month, year, amount: req.body.amount });
        if (String(req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
        return res.redirect(`/bulletins/${empId}?month=${month}&year=${year}`);
    } catch (error) {
        const messages = { PAYSLIP_REQUIRED: "Générez le bulletin avant d'ajouter un prêt.", BULLETIN_LOCKED: "Ce bulletin est verrouillé.", PRET_BALANCE_TOO_LOW: "Le montant dépasse le solde disponible du prêt.", INVALID_PRET_AMOUNT: "Saisissez un montant de prêt valide." };
        const message = messages[error.message] || "Impossible d'ajouter la déduction du prêt.";
        if (String(req.headers.accept || '').includes('application/json')) return res.status(400).json({ ok: false, error: message });
        return res.status(400).send(message);
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
        const rubriqueImposableId = req.body.rubriqueImposableId ? Number(req.body.rubriqueImposableId) : null;
        let code = String(req.body.code || '').trim();
        let label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } }
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée pour cet employé." });
        let taxableDefinition = null;
        if (rubriqueImposableId) {
            taxableDefinition = await prisma.rubriqueImposable.findFirst({ where: { id: rubriqueImposableId, companyId: emp.companyId, active: true } });
            if (!taxableDefinition) return res.status(400).json({ ok: false, error: "Rubrique imposable introuvable pour cette société." });
            code = taxableDefinition.code;
            label = taxableDefinition.name;
        }
        if (!code || !label || !Number.isFinite(amount) || amount < 0 || (!amount && !rubriqueImposableId)) {
            return res.status(400).json({ ok: false, error: "Le code rubrique, le libellé et le montant de la prime sont obligatoires." });
        }

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
        .map(bonus => ({ code: bonus.code || '', label: bonus.name, amount: Number(bonus.amount), baseAmount: payslipBonusBaseAmount(bonus), rubriqueImposableId: bonus.rubriqueImposableId || null }));
        // Keep the bulletin's monthly non-taxable lines when adding a taxable
        // prime. Without passing them back to the engine, the recalculation
        // rebuilt the payslip with only taxable lines and deleted the NIMP
        // entries during persistPayslipBonuses().
        const fixedNimpLabels = new Set((emp.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = (existing?.bonuses || [])
            .filter(bonus => !bonus.taxable && !fixedNimpLabels.has(String(bonus.name).toLowerCase()))
            .map(bonus => ({ code: bonus.code || '', label: bonus.name, amount: Number(bonus.amount), baseAmount: payslipBonusBaseAmount(bonus) }));
        const variablePrimes = [...previousMonthlyPrimes, { code, label, amount, rubriqueImposableId: taxableDefinition?.id || null }];
        const monthlyCalc = await runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: existing ? Number(existing.baseSalary) : undefined,
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing?.heuresSup25 || 0,
            heuresSup50: existing?.heuresSup50 || 0,
            heuresSup100: existing?.heuresSup100 || 0,
            primeRendementInput: Number(existing?.primeRendementInput || 0),
            paidLeaveDays: Number(existing?.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing?.congeNaissanceDays || 0),
            joursFeries: Number(existing?.joursFeries || 0),
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
        await applyManualRetenuesToNet(payslip.id, calc.netAPayer);
        return res.json({ ok: true, bonus: { code, label, amount, rubriqueImposableId: taxableDefinition?.id || null }, payroll: calc });
    } catch (err) {
        console.error("Add monthly prime error:", err);
        return res.status(500).json({ ok: false, error: "Impossible d'enregistrer la prime." });
    }
};

export const createBulletinPrimeCatalogue = async (req, res) => {
    try {
        const emp = await getActiveEmployee(req, Number(req.params.id));
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        const [prime] = await createPrimes({
            companyId: emp.companyId,
            rows: [{ code: req.body.code, name: req.body.label, defaultAmount: req.body.amount }],
        });
        return res.json({ ok: true, prime });
    } catch (error) {
        return res.status(400).json({ ok: false, error: error.code === "P2002" ? "Cette prime existe déjà dans le catalogue." : "Code, libellé ou montant invalide." });
    }
};

export const createBulletinIndemniteCatalogue = async (req, res) => {
    try {
        const emp = await getActiveEmployee(req, Number(req.params.id));
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        const indemnity = await createIndemnite({
            companyId: emp.companyId,
            code: req.body.code,
            name: req.body.label,
            defaultAmount: req.body.amount,
        });
        return res.json({ ok: true, indemnity });
    } catch (error) {
        return res.status(400).json({ ok: false, error: error.code === "P2002" ? "Cette indemnité existe déjà dans le catalogue." : "Code, libellé ou montant invalide." });
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
        const empFixedPrimeKeys = new Set((emp.bonuses || [])
            .filter(b => (b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => `${String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()}|${Number(b.amount)}`));
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

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
            .map(b => ({ code: b.code || '', label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const deleteIndex = variablePrimes.findIndex(prime =>
            prime.label.toLowerCase() === label.toLowerCase() && prime.amount === amount
        );
        if (deleteIndex === -1) {
            return res.status(404).json({ ok: false, error: "Cette prime n'existe pas sur ce bulletin." });
        }
        variablePrimes.splice(deleteIndex, 1);

        const monthlyNimpLines = existing.bonuses
            .filter(b => !b.taxable && !String(b.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
            .map(b => ({ label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const monthlyCalc = await runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            primeRendementInput: Number(existing.primeRendementInput || 0),
            paidLeaveDays: Number(existing.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing.congeNaissanceDays || 0),
            joursFeries: Number(existing.joursFeries || 0),
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates);
        const payslip = await prisma.payslip.update({ where: { id: existing.id }, data: payslipData });

        await persistPayslipBonuses(payslip.id, calc);
        await applyManualRetenuesToNet(payslip.id, calc.netAPayer);
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
        const code = String(req.body.code || '').trim();
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);
        if (!code || !label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "Le code rubrique, le libellé et le montant sont obligatoires." });
        }

        const emp = await getActiveEmployee(req, empId, { bonuses: { include: { bonus: true } } });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

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
            .map(b => ({ label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const workingTime = resolveWorkingTimeForPayslip(emp, existing);
        const catalogueIndemnity = await prisma.bonus.findFirst({
            where: { companyId: emp.companyId, taxable: false, OR: [{ code }, { name: label }] },
            select: { defaultAmount: true },
        });
        const catalogueAmount = Number(catalogueIndemnity?.defaultAmount);
        const hasCatalogueCeiling = Number.isFinite(catalogueAmount) && catalogueAmount > 0;
        const monthlyAmount = hasCatalogueCeiling ? Math.min(amount, catalogueAmount) : amount;
        const indemnityRatio = workingTime.mode === "HOURS"
            ? workingTime.workedHours / workingTime.standardMonthlyHours
            : workingTime.ratio;
        const payableAmount = Number((monthlyAmount * indemnityRatio).toFixed(2));
        monthlyNimpLines.push({
            code,
            label,
            amount: payableAmount,
            baseAmount: monthlyAmount,
            maxAmount: hasCatalogueCeiling ? catalogueAmount : null,
        });
        const variablePrimes = (existing?.bonuses || []).filter(b => b.taxable).map(b => ({ label: b.name, amount: Number(b.amount) }));
        const monthlyCalc = await runEmployeeCalculation(emp, {
            month, year,
            baseSalary: existing ? Number(existing.baseSalary) : undefined,
            ...workingTime,
            heuresSup25: existing?.heuresSup25 || 0,
            heuresSup50: existing?.heuresSup50 || 0,
            heuresSup100: existing?.heuresSup100 || 0,
            primeRendementInput: Number(existing?.primeRendementInput || 0),
            paidLeaveDays: Number(existing?.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing?.congeNaissanceDays || 0),
            joursFeries: Number(existing?.joursFeries || 0),
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
        return res.json({ ok: true, bonus: { code, label, amount: payableAmount }, payroll: calc });
    } catch (err) {
        console.error("Add monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible d'enregistrer l'indemnité." });
    }
};

// POST /bulletins/:id/indemnities/stick — Make a monthly indemnity recurring for the employee
export const stickMonthlyIndemnity = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const label = String(req.body.label || '').trim();
        const amount = Number(req.body.amount);
        if (!label || label.length > 191 || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "L'indemnité à conserver est invalide." });
        }

        const emp = await getActiveEmployee(req, empId);
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });

        const bonus = await prisma.bonus.upsert({
            where: { companyId_name: { companyId: emp.companyId, name: label } },
            create: { companyId: emp.companyId, name: label, taxable: false },
            update: {},
        });
        if (bonus.taxable) {
            return res.status(400).json({ ok: false, error: "Cette indemnité existe déjà comme prime imposable." });
        }

        await prisma.employeeBonus.upsert({
            where: { employeeId_bonusId: { employeeId: emp.id, bonusId: bonus.id } },
            create: { employeeId: emp.id, bonusId: bonus.id, amount: Number(amount.toFixed(2)) },
            update: { amount: Number(amount.toFixed(2)) },
        });
        return res.json({ ok: true });
    } catch (err) {
        console.error("Stick monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de conserver l'indemnité pour les prochains bulletins." });
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
        // Bulletin edits always apply to the current payable amount only.
        // The employee fiche amount is never changed from this endpoint.

        if (!oldLabel || !Number.isFinite(oldAmount) || oldAmount <= 0 || !label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "L'indemnité à modifier est invalide." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }

        const fixedNimpBonuses = (emp.bonuses || []).filter(b => !(b.bonus ? b.bonus.taxable : b.taxable));
        const storedBonus = fixedNimpBonuses.find(b =>
            String(b.bonus ? b.bonus.name : b.name || '').trim().toLowerCase() === oldLabel.toLowerCase()
        );
        const workingTime = resolveWorkingTimeForPayslip(emp, existing);
        const ficheRatio = Number(workingTime.ratio || 0);
        const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
        const representationMaximum = representationLabel === oldLabel.toLowerCase()
            ? Number(existing.baseSalary || emp.baseSalary || 0)
                * Number(emp.indemniteRepresentationRate || 0) * ficheRatio
            : 0;
        const currentLine = (existing.bonuses || []).find(b =>
            !b.taxable && String(b.name || '').trim().toLowerCase() === oldLabel.toLowerCase()
        );
        const ficheBaseAmount = storedBonus
            ? Number(storedBonus.amount)
            : representationMaximum > 0
                ? Number(existing.baseSalary || emp.baseSalary || 0) * Number(emp.indemniteRepresentationRate || 0)
                : payslipBonusBaseAmount(currentLine);
        const catalogueAmount = storedBonus?.bonus
            ? Number(storedBonus.bonus.defaultAmount)
            : NaN;
        const ficheMaximum = storedBonus
            ? (Number.isFinite(catalogueAmount) && catalogueAmount > 0 ? catalogueAmount * ficheRatio : 0)
            : representationMaximum > 0
                ? representationMaximum
                : payslipBonusBaseAmount(currentLine);
        const payableAmount = Math.min(amount, ficheMaximum > 0 ? ficheMaximum : amount);

        // Remove the recurring line from the employee calculation and re-add
        // it as a bulletin-only line, preserving the fiche amount as its cap.
        // When the edited line is the employee-specific representation
        // indemnity, disable its automatic percentage calculation for this
        // rebuild. The edited monthly line below is the single source of
        // truth for this bulletin; keeping both creates duplicate columns in
        // the payroll list because their rubric codes differ.
        const isRepresentationEdit = representationLabel === oldLabel.toLowerCase();
        const calculationEmployee = isRepresentationEdit
            ? { ...emp, indemniteRepresentationName: null, indemniteRepresentationRate: null }
            : storedBonus
                ? { ...emp, bonuses: (emp.bonuses || []).filter(b => b !== storedBonus) }
                : emp;
        const fixedNimpLabels = new Set((calculationEmployee.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const monthlyNimpLines = [...new Map(existing.bonuses
            .filter(b => !b.taxable
                && !fixedNimpLabels.has(String(b.name).toLowerCase()))
            .map(b => [String(b.name).trim().toLowerCase(), {
                label: b.name,
                amount: Number(b.amount),
                baseAmount: payslipBonusBaseAmount(b),
            }])).values()];
        const updateIndex = monthlyNimpLines.findIndex(line =>
            line.label.toLowerCase() === oldLabel.toLowerCase()
        );
        if (updateIndex === -1) return res.status(404).json({ ok: false, error: "Cette indemnité n'existe pas sur ce bulletin." });
        monthlyNimpLines[updateIndex] = {
            label,
            amount: payableAmount,
            baseAmount: ficheBaseAmount || oldAmount,
            maxAmount: ficheMaximum > 0 ? ficheMaximum : null,
        };

        const variablePrimes = existing.bonuses
            .filter(b => b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const monthlyCalc = await runEmployeeCalculation(calculationEmployee, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            primeRendementInput: Number(existing.primeRendementInput || 0),
            paidLeaveDays: Number(existing.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing.congeNaissanceDays || 0),
            joursFeries: Number(existing.joursFeries || 0),
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(calculationEmployee.id, month, year, monthlyCalc, calculationEmployee.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(
            calculationEmployee,
            calc,
            month,
            year,
            rates,
            existing.status
        );
        const payslip = await savePayslipWithBonuses(payslipData, existing.id, calc);
        return res.json({ ok: true, bonus: { label, amount: payableAmount }, payroll: calc, payslipId: payslip.id });
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
        const removeEmployee = req.body.removeEmployee === true || req.body.removeEmployee === 'true';

        if (!label || !Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ ok: false, error: "L'indemnité à supprimer est invalide." });
        }

        const emp = await getActiveEmployee(req, empId, {
            bonuses: { include: { bonus: true } },
        });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        if (emp.blocageSaisiePaie) return res.status(400).json({ ok: false, error: "La saisie de paie est bloquée." });

        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (![BULLETIN_STATUS.DRAFT, BULLETIN_STATUS.GENERATED, BULLETIN_STATUS.VALIDATED, BULLETIN_STATUS.CLOSED].includes(existing.status)) {
            return res.status(403).json({ ok: false, error: "Ce bulletin ne peut pas être modifié." });
        }

        const targetLabel = label.toLowerCase();
        const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
        const storedBonus = (emp.bonuses || []).find(b =>
            !(b.bonus ? b.bonus.taxable : b.taxable)
            && String(b.bonus ? b.bonus.name : b.name || '').trim().toLowerCase() === targetLabel
            && Number(b.amount) === amount
        );
        const isRepresentation = Boolean(representationLabel && representationLabel === targetLabel);

        if (removeEmployee && !storedBonus && !isRepresentation) {
            return res.status(404).json({ ok: false, error: "Cette indemnité n'est pas récurrente." });
        }

        let calculationEmployee = emp;
        if (removeEmployee && storedBonus) {
            await prisma.employeeBonus.delete({
                where: { employeeId_bonusId: { employeeId: emp.id, bonusId: storedBonus.bonusId } },
            });
            calculationEmployee = await getActiveEmployee(req, empId, { bonuses: { include: { bonus: true } } });
        } else if (removeEmployee && isRepresentation) {
            await prisma.employee.update({
                where: { id: emp.id },
                data: { indemniteRepresentationName: null, indemniteRepresentationRate: null },
            });
            calculationEmployee = await getActiveEmployee(req, empId, { bonuses: { include: { bonus: true } } });
        } else if (storedBonus) {
            calculationEmployee = { ...emp, bonuses: (emp.bonuses || []).filter(b => b !== storedBonus) };
        } else if (isRepresentation) {
            calculationEmployee = { ...emp, indemniteRepresentationName: null, indemniteRepresentationRate: null };
        }

        const fixedNimpLabels = new Set((calculationEmployee.bonuses || [])
            .filter(b => !(b.bonus ? b.bonus.taxable : b.taxable))
            .map(b => String(b.bonus ? b.bonus.name : b.name || '').toLowerCase()));
        const calculationRepresentationLabel = String(calculationEmployee.indemniteRepresentationName || '').trim().toLowerCase();
        const monthlyNimpLines = existing.bonuses
            .filter(b => !b.taxable
                && !fixedNimpLabels.has(String(b.name).toLowerCase())
                && (!calculationRepresentationLabel || String(b.name).toLowerCase() !== calculationRepresentationLabel))
            .map(b => ({ label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const deleteIndex = monthlyNimpLines.findIndex(line =>
            line.label.toLowerCase() === label.toLowerCase() && line.baseAmount === amount
        );
        if (deleteIndex === -1) {
            return res.status(404).json({ ok: false, error: "Cette indemnité n'existe pas sur ce bulletin." });
        }
        monthlyNimpLines.splice(deleteIndex, 1);

        const variablePrimes = existing.bonuses
            .filter(b => b.taxable)
            .map(b => ({ label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }));
        const monthlyCalc = await runEmployeeCalculation(calculationEmployee, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            primeRendementInput: Number(existing.primeRendementInput || 0),
            paidLeaveDays: Number(existing.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing.congeNaissanceDays || 0),
            joursFeries: Number(existing.joursFeries || 0),
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(calculationEmployee.id, month, year, monthlyCalc, calculationEmployee.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(
            calculationEmployee,
            calc,
            month,
            year,
            rates,
            existing.status === BULLETIN_STATUS.VALIDATED
                ? BULLETIN_STATUS.VALIDATED
                : (isClosedBulletin(existing.status) ? BULLETIN_STATUS.CLOSED : BULLETIN_STATUS.GENERATED)
        );
        const payslip = await savePayslipWithBonuses(
            payslipData,
            existing.id,
            calc,
            [{ label, amount }]
        );
        return res.json({ ok: true, payroll: calc });
    } catch (err) {
        console.error("Delete monthly indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de supprimer l'indemnité." });
    }
};

// POST /bulletins/:id/indemnities/restore — restore an employee indemnity
// removed only from the current bulletin.
export const restoreEmployeeIndemnity = async (req, res) => {
    try {
        const empId = parseInt(req.params.id);
        const month = parseInt(req.body.month) || currentMonth();
        const year = parseInt(req.body.year) || currentYear();
        const label = String(req.body.label || '').trim();
        const key = label.toLowerCase();
        if (!label) return res.status(400).json({ ok: false, error: "Indemnité invalide." });

        const emp = await getActiveEmployee(req, empId, { bonuses: { include: { bonus: true } } });
        if (!emp) return res.status(404).json({ ok: false, error: "Employé introuvable." });
        const existing = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: empId, month, year } },
            include: { bonuses: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (isLockedBulletin(existing.status)) return res.status(403).json({ ok: false, error: "Bulletin verrouillé." });

        const deletedLine = (existing.bonuses || []).find(bonus =>
            String(bonus.name || '').startsWith(EXCLUDED_NIMP_PREFIX)
            && String(bonus.name).slice(EXCLUDED_NIMP_PREFIX.length).trim().toLowerCase() === key
        );
        if (!deletedLine) {
            return res.status(404).json({ ok: false, error: "Cette indemnité n'est pas supprimée du bulletin." });
        }

        const fixedNimpLabels = new Set((emp.bonuses || [])
            .filter(bonus => !(bonus.bonus ? bonus.bonus.taxable : bonus.taxable))
            .map(bonus => String(bonus.bonus ? bonus.bonus.name : bonus.name || '').trim().toLowerCase()));
        const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
        const monthlyNimpLines = existing.bonuses
            .filter(bonus => !bonus.taxable
                && !String(bonus.name || '').startsWith(EXCLUDED_NIMP_PREFIX)
                && !fixedNimpLabels.has(String(bonus.name).trim().toLowerCase())
                && (!representationLabel || String(bonus.name).trim().toLowerCase() !== representationLabel))
            .map(bonus => ({ label: bonus.name, amount: Number(bonus.amount), baseAmount: payslipBonusBaseAmount(bonus) }));
        if (!fixedNimpLabels.has(key) && key !== representationLabel && Number(deletedLine.amount) > 0) {
            monthlyNimpLines.push({ label, amount: Number(deletedLine.amount), baseAmount: payslipBonusBaseAmount(deletedLine) });
        }
        const variablePrimes = existing.bonuses
            .filter(bonus => bonus.taxable)
            .map(bonus => ({ label: bonus.name, amount: Number(bonus.amount) }));
        const monthlyCalc = await runEmployeeCalculation(emp, {
            month,
            year,
            baseSalary: Number(existing.baseSalary),
            ...resolveWorkingTimeForPayslip(emp, existing),
            heuresSup25: existing.heuresSup25 || 0,
            heuresSup50: existing.heuresSup50 || 0,
            heuresSup100: existing.heuresSup100 || 0,
            primeRendementInput: Number(existing.primeRendementInput || 0),
            paidLeaveDays: Number(existing.paidLeaveDays || 0),
            congeNaissanceDays: Number(existing.congeNaissanceDays || 0),
            joursFeries: Number(existing.joursFeries || 0),
            variablePrimes,
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(emp.id, month, year, monthlyCalc, emp.nbPersonacharge);
        const rates = await getPayrollRates();
        const payslipData = await buildPayslipData(emp, calc, month, year, rates, existing.status);
        const payslip = await savePayslipWithBonuses(payslipData, existing.id, calc, [], [label]);
        return res.json({ ok: true, payroll: calc, payslipId: payslip.id });
    } catch (err) {
        console.error("Restore employee indemnity error:", err);
        return res.status(500).json({ ok: false, error: "Impossible de restaurer l'indemnité." });
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
        if (hasPaidLeaveConflict(existing.workedDays, existing.paidLeaveDays, existing.standardMonthlyDays, existing.joursFeries, existing.congeNaissanceDays)) {
            return rejectPaidLeaveConflict(res, false);
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
    const requestedLeaveDays = input.paidLeaveDays;
    const requestedBirthLeaveDays = input.congeNaissanceDays;
    const requestedHolidayDays = input.joursFeries;
    const requestedPrimeRendementInput = input.primeRendementInput;
    const parsedPrimeRendementInput = requestedPrimeRendementInput === undefined
        ? undefined
        : Number(requestedPrimeRendementInput);
    if (parsedPrimeRendementInput !== undefined
        && (!Number.isFinite(parsedPrimeRendementInput) || parsedPrimeRendementInput < 0 || parsedPrimeRendementInput > 999999.99)) {
        return res.status(400).json({ ok: false, error: 'La saisie de la prime rendement doit être un nombre positif ou nul.' });
    }
    if (requestedLeaveDays !== undefined) {
        const leaveDays = Number(requestedLeaveDays);
        if (!Number.isInteger(leaveDays) || leaveDays < 0 || leaveDays > PAYROLL_WORKED_DAYS) {
            return res.status(400).json({ ok: false, error: 'Le congé payé doit être saisi en jours entiers, entre 0 et 26.' });
        }
        if (requestedBirthLeaveDays !== undefined) {
            const birthLeaveDays = Number(requestedBirthLeaveDays);
            if (!Number.isInteger(birthLeaveDays) || birthLeaveDays < 0 || birthLeaveDays > PAYROLL_WORKED_DAYS) {
                return res.status(400).json({ ok: false, error: 'Le congé de naissance doit être saisi en jours entiers, entre 0 et 26.' });
            }
        }
    }
    if (requestedHolidayDays !== undefined) {
        const holidayDays = Number(requestedHolidayDays);
        if (!Number.isInteger(holidayDays) || holidayDays < 0 || holidayDays > PAYROLL_WORKED_DAYS) {
            return res.status(400).json({ ok: false, error: 'Le nombre de jours fériés doit être un entier entre 0 et 26.' });
        }
    }
    if (!Number.isInteger(employeeId) || employeeId <= 0
        || !Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 2020 || year > 2040
        || (requestedDays === undefined && requestedHours === undefined && requestedLeaveDays === undefined && requestedBirthLeaveDays === undefined && requestedHolidayDays === undefined && requestedPrimeRendementInput === undefined)) {
        return res.status(400).json({ ok: false, error: 'Saisissez une période valide et une valeur de temps de travail valide.' });
    }
    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) return res.status(400).json({ ok: false, error: 'Aucune entreprise associée à cette session.' });
        const existing = await prisma.payslip.findFirst({
            where: { employeeId, month, year, employee: { companyId } },
            include: { employee: { include: { company: true, employeeFunction: true, bonuses: { include: { bonus: true } } } }, bonuses: true },
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
            workedDays: company?.workingTimeMode === "HOURS" ? undefined : (requestedDays ?? existing.workedDays),
            workedHours: company?.workingTimeMode === "HOURS" ? (requestedHours ?? existing.workedHours) : undefined,
        });
        const employee = { ...existing.employee, bonuses: existing.employee.bonuses || [], cimrRate: existing.cimrRate };
        const previousRatio = indemnityRatioForWorkingTime(resolveWorkingTimeForPayslip(employee, existing));
        const targetRatio = indemnityRatioForWorkingTime(workingTime);
        if (hasPaidLeaveConflict(workingTime.workedDays, requestedLeaveDays ?? existing.paidLeaveDays, workingTime.standardMonthlyDays, requestedHolidayDays ?? existing.joursFeries, requestedBirthLeaveDays ?? existing.congeNaissanceDays)) {
            return rejectPaidLeaveConflict(res, true);
        }
        // Use the saved bonus lines, without adding today's recurring bonuses again.
        const monthlyNimpLines = prorateMonthlyNimpLines(
            existing.bonuses
                .filter(bonus => !bonus.taxable && !String(bonus.name || '').startsWith(EXCLUDED_NIMP_PREFIX))
                .map(bonus => ({ code: bonus.code || '', label: bonus.name, amount: Number(bonus.amount), baseAmount: payslipBonusBaseAmount(bonus) })),
            existing.bonuses,
            previousRatio,
            targetRatio,
        );
        const monthlyCalc = await runEmployeeCalculation(employee, {
            month, year, ...workingTime,
            baseSalary: Number(existing.baseSalary),
            dependents: Number(existing.chargesDeFamille || 0) / 50,
            heuresSup25: Number(existing.heuresSup25 || 0),
            heuresSup50: Number(existing.heuresSup50 || 0),
            heuresSup100: Number(existing.heuresSup100 || 0),
            primeRendementInput: parsedPrimeRendementInput === undefined
                ? Number(existing.primeRendementInput || 0)
                : Number(parsedPrimeRendementInput.toFixed(2)),
            paidLeaveDays: requestedLeaveDays ?? Number(existing.paidLeaveDays || 0),
            congeNaissanceDays: requestedBirthLeaveDays ?? Number(existing.congeNaissanceDays || 0),
            joursFeries: input.joursFeries ?? Number(existing.joursFeries || 0),
            variablePrimes: existing.bonuses.filter(b => b.taxable).map(b => ({ label: b.name, amount: Number(b.amount) })),
            monthlyNimpLines,
        });
        const calc = await applyCumulativeIR(employeeId, month, year, monthlyCalc, employee.nbPersonacharge);
        if (req.method === 'POST') {
            const data = await buildPayslipData(employee, calc, month, year, {
                cnssRate: Number(existing.cnssRate), amoRate: Number(existing.amoRate),
            }, existing.status);
            // Refresh the saved bonus amounts while preserving their monthly bases.
            const updated = await prisma.$transaction(async transaction => {
                const result = await transaction.payslip.updateMany({
                    where: {
                        id: existing.id, status: existing.status,
                        employee: { companyId, blocageSaisiePaie: false },
                    },
                    data,
                });
                if (!result.count) return 0;
                await persistPayslipBonuses(existing.id, calc, transaction);
                return result.count;
            });
            if (!updated) return res.status(409).json({ ok: false, error: 'Le bulletin a été verrouillé. Rechargez la liste.' });
        }
        return res.json({ ok: true, payroll: calc, saved: req.method === 'POST' });
    } catch (err) {
        console.error('Worked days update failed:', err);
        return res.status(500).json({ ok: false, error: 'Impossible de recalculer ou enregistrer les jours. Veuillez réessayer.' });
    }
};

export const updateBulletinPaidLeave = updateBulletinWorkedDays;
export const updateBulletinPublicHoliday = updateBulletinWorkedDays;
export const updateBulletinBirthLeave = updateBulletinWorkedDays;
export const updateBulletinPrimeRendement = updateBulletinWorkedDays;

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
        const rubriqueMaps = await getRubriqueMaps(emp.companyId);
        const rubriqueCodes = rubriqueMaps.codes;

        const month = parseInt(req.query.month) || currentMonth();
        const year = parseInt(req.query.year) || currentYear();

        const variablePrimes = parseVariablePrimes(req.query.primesLabels, req.query.primesAmounts);

        const nimpLabels = Array.isArray(req.query.nimpLabels) ? req.query.nimpLabels : (req.query.nimpLabels ? [req.query.nimpLabels] : []);
        const nimpAmounts = Array.isArray(req.query.nimpAmounts) ? req.query.nimpAmounts : (req.query.nimpAmounts ? [req.query.nimpAmounts] : []);
        const nimpSourceRatios = Array.isArray(req.query.nimpSourceRatios) ? req.query.nimpSourceRatios : (req.query.nimpSourceRatios ? [req.query.nimpSourceRatios] : []);
        const enteredMonthlyNimpLines = nimpLabels.map((label, index) => ({
            label: String(label || '').trim(),
            amount: Number(nimpAmounts[index]) || 0,
            sourceRatio: nimpSourceRatios[index],
        })).filter(line => line.label && line.amount > 0);

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
                workedDays: emp.blocageSaisiePaie ? 0 : (emp.company?.workingTimeMode === "HOURS" ? undefined : req.query.workedDays),
                workedHours: emp.blocageSaisiePaie ? 0 : (emp.company?.workingTimeMode === "HOURS" ? req.query.workedHours : undefined),
            }),
            heuresSup25: Math.max(0, Number(req.query.heuresSup25) || 0),
            heuresSup50: Math.max(0, Number(req.query.heuresSup50) || 0),
            heuresSup100: Math.max(0, Number(req.query.heuresSup100) || 0),
            paidLeaveDays: Math.max(0, Number(req.query.paidLeaveDays) || 0),
            congeNaissanceDays: Math.max(0, Number(req.query.congeNaissanceDays) || 0),
            joursFeries: Math.max(0, Number(req.query.joursFeries) || 0),
            variablePrimes,
            monthlyNimpLines: enteredMonthlyNimpLines,
            niimpOverrides,
        };

        if (req.query.congeNaissanceDays !== undefined
            && (!Number.isInteger(Number(req.query.congeNaissanceDays)) || Number(req.query.congeNaissanceDays) < 0 || Number(req.query.congeNaissanceDays) > PAYROLL_WORKED_DAYS)) {
            return res.status(400).json({ ok: false, error: 'Le congé de naissance doit être saisi en jours entiers, entre 0 et 26.' });
        }
        if (hasPaidLeaveConflict(overrides.workedDays, overrides.paidLeaveDays, overrides.standardMonthlyDays, overrides.joursFeries, overrides.congeNaissanceDays)) {
            return rejectPaidLeaveConflict(res, true);
        }

        const savedPayslip = await prisma.payslip.findUnique({
            where: { employeeId_month_year: { employeeId: emp.id, month, year } },
            select: {
                workedDays: true,
                workedHours: true,
                workingTimeMode: true,
                standardMonthlyDays: true,
                standardMonthlyHours: true,
                avanceDeduction: true,
                pretDeduction: true,
                primeRendementInput: true,
                bonuses: { select: { name: true, amount: true, baseAmount: true, taxable: true } },
                retenus: { select: { amount: true } },
            },
        });
        const previousRatio = savedPayslip
            ? indemnityRatioForWorkingTime(resolveWorkingTimeForPayslip(emp, savedPayslip))
            : 1;
        const rawPrimeRendementInput = req.query.primeRendementInput
            ?? savedPayslip?.primeRendementInput
            ?? 0;
        const parsedPrimeRendementInput = Number(rawPrimeRendementInput);
        if (!Number.isFinite(parsedPrimeRendementInput) || parsedPrimeRendementInput < 0 || parsedPrimeRendementInput > 999999.99) {
            return res.status(400).json({ ok: false, error: 'La saisie de la prime rendement doit être un nombre positif ou nul.' });
        }
        overrides.primeRendementInput = Number(parsedPrimeRendementInput.toFixed(2));
        overrides.avanceDeduction = req.query.avanceDeduction !== undefined
            ? Math.max(0, Number(req.query.avanceDeduction) || 0)
            : Number(savedPayslip?.avanceDeduction || 0);
        overrides.pretDeduction = req.query.pretDeduction !== undefined
            ? Math.max(0, Number(req.query.pretDeduction) || 0)
            : Number(savedPayslip?.pretDeduction || 0);
        overrides.manualRetenuesTotal = manualRetenueTotal(savedPayslip?.retenus);
        overrides.monthlyNimpLines = prorateMonthlyNimpLines(
            enteredMonthlyNimpLines,
            savedPayslip?.bonuses || [],
            previousRatio,
            indemnityRatioForWorkingTime(overrides),
            nimpSourceRatios,
        );
        const monthlyResult = await runEmployeeCalculation(emp, overrides);
        const result = await applyCumulativeIR(emp.id, month, year, monthlyResult, overrides.dependents ?? emp.nbPersonacharge);
        const manualRetenusTotal = manualRetenueTotal(savedPayslip?.retenus);
        const avanceDeduction = req.query.avanceDeduction !== undefined
            ? Math.max(0, Number(req.query.avanceDeduction) || 0)
            : Number(savedPayslip?.avanceDeduction || 0);
        const pretDeduction = req.query.pretDeduction !== undefined
            ? Math.max(0, Number(req.query.pretDeduction) || 0)
            : Number(savedPayslip?.pretDeduction || 0);

        res.json({
            ok: true,
            primeRendementEnabled: isPrimeRendementEnabled(emp.company),
            baseSalary: result.baseSalary,
            primeAnciennete: result.primeAnciennete,
            ancienneteRate: result.ancienneteRate,
            variablePrimes: result.variablePrimes,
            heuresSup25: result.heuresSup25,
            heuresSup50: result.heuresSup50,
            heuresSup100: result.heuresSup100,
            heuresSupAmount: result.heuresSupAmount,
            primeRendementInput: result.primeRendementInput,
            primeRendementAmount: result.primeRendementAmount,
            paidLeaveDays: result.paidLeaveDays,
            congeNaissanceDays: result.congeNaissanceDays,
            joursFeries: result.joursFeries,
            baseConge: result.baseConge,
            paidLeaveAmount: result.paidLeaveAmount,
            baseCongeNaissance: result.baseCongeNaissance,
            congeNaissanceAmount: result.congeNaissanceAmount,
            baseFerie: result.baseFerie,
            joursFeriesAmount: result.joursFeriesAmount,
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
            avanceDeduction,
            pretDeduction,
            netAPayer: Math.max(0, Number((Number(result.netAPayer || 0) - manualRetenusTotal - avanceDeduction - pretDeduction).toFixed(2))),
            manualRetenusTotal,
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
        const overtimeEnabled = isOvertimeEnabled(emp.company);
        const primeRendementEnabled = isPrimeRendementEnabled(emp.company);
        const rubriqueMaps = await getRubriqueMaps(emp.companyId);
        const rubriqueCodes = rubriqueMaps.codes;
        const availablePrimes = await prisma.bonus.findMany({
            where: { companyId: emp.companyId, taxable: true },
            orderBy: { name: 'asc' },
        });
        const availableIndemnites = await listIndemnites(emp.companyId);

        const month = req.query.month ? parseInt(req.query.month) : null;
        const year = req.query.year ? parseInt(req.query.year) : null;
        const hasPeriod = month && year;
        console.info("[bulletin-show] employee.loaded", { requestId, employeeId: emp.id, employeeName: emp.nomComplet, hasPeriod, month, year });

        // Follow the active employee list, with ID breaking ties for identical names.
        const previousEmployee = await prisma.employee.findFirst({
            where: {
                companyId: emp.companyId,
                blocageSaisiePaie: false,
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
                blocageSaisiePaie: false,
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

        let bulletinEmployees = [];
        if (hasPeriod) {
            const periodEmployees = await prisma.employee.findMany({
                where: {
                    companyId: emp.companyId,
                    OR: [{ blocageSaisiePaie: false }, { id: emp.id }],
                },
                orderBy: [{ nomComplet: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    nomComplet: true,
                    matricule: true,
                    payslips: {
                        where: { month, year },
                        take: 1,
                        select: { status: true, netAPayer: true },
                    },
                },
            });
            bulletinEmployees = periodEmployees.map(employee => {
                const periodBulletin = employee.payslips[0];
                return {
                    id: employee.id,
                    nomComplet: employee.nomComplet,
                    matricule: employee.matricule,
                    status: periodBulletin?.status || BULLETIN_STATUS.DRAFT,
                    netAPayer: periodBulletin ? Number(periodBulletin.netAPayer || 0) : null,
                };
            });
        }


        if (!hasPeriod) {
            // History mode: query all Payslips for this employee ordered by year/month desc
            const dbHistory = await prisma.payslip.findMany({
                where: { employeeId: empId },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
                include: { bonuses: true, retenus: true, avanceDeductions: { include: { avance: true } }, pretDeductions: { include: { pret: true } } }
            });

            const history = dbHistory.map(payslip => filterInvisibleRubriqueLines(
                hidePrimeRendementFromView(
                    hideOvertimeFromView(mapPayslipToViewModel(payslip, emp.indemniteRepresentationRate), overtimeEnabled),
                    primeRendementEnabled,
                ),
                rubriqueMaps.rubriqueVisibility,
            ));

            return res.render("bulletins/show", {
                title: `${emp.nomComplet} — Bulletins`,
                currentPage: "bulletins",
                user: req.session.user,
                emp,
                previousEmployee,
                previousBulletinUrl,
                nextEmployee,
                nextBulletinUrl,
                bulletinEmployees,
                overtimeEnabled,
                primeRendementEnabled,
                rubriqueVisibility: rubriqueMaps.rubriqueVisibility,
                mode: "history",
                history,
                bulletin: null,
                month: null,
                year: null,
                monthName: null,
                periode: null,
                monthNames: MONTH_NAMES_FR,

                fmt,
                rubriqueCodes,
                paidLeaveRubrique: rubriqueMaps.baseRows.find(row => row.key === 'paid_leave_days' && row.active && row.visible !== false) || null,
                birthLeaveRubrique: rubriqueMaps.baseRows.find(row => row.key === 'birth_leave_days' && row.active && row.visible !== false) || null,
                publicHolidayRubrique: rubriqueMaps.baseRows.find(row => row.key === 'public_holiday_days' && row.active && row.visible !== false) || null,
                availablePrimes,
                availableIndemnites,
                taxableRubriques: rubriqueMaps.imposableRows.filter(row => row.active),
                manualRetenuRubriques: rubriqueMaps.retenuRows.filter(row => row.entryType === 'MANUAL' && row.active && row.visible !== false),
                employeeAvances: [],
                employeePrets: [],
            });
        }

        // Single bulletin mode
        const dbPayslip = await prisma.payslip.findFirst({
            where: { employeeId: empId, month, year, employee: { companyId: resolveCompanyId(req) } },
            include: { bonuses: true, retenus: true, avanceDeductions: { include: { avance: true } }, pretDeductions: { include: { pret: true } } }
        });
        console.info("[bulletin-show] payslip.loaded", { requestId, employeeId: empId, month, year, found: Boolean(dbPayslip) });

        const refreshedPayslip = await refreshOpenBulletinFromEmployee(emp, dbPayslip);
        const rawBulletin = hidePrimeRendementFromView(
            hideOvertimeFromView(mapPayslipToViewModel(refreshedPayslip, emp.indemniteRepresentationRate), overtimeEnabled),
            primeRendementEnabled,
        );
        const bulletin = filterInvisibleRubriqueLines(rawBulletin, rubriqueMaps.rubriqueVisibility);
        const rubriqueVisibilityInputs = [];
        if (rawBulletin) {
            rawBulletin.variablePrimes
                .filter(line => line.rubriqueImposableId !== null && line.rubriqueImposableId !== undefined
                    && !isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, line))
                .forEach(line => rubriqueVisibilityInputs.push(
                    { name: 'primesLabels', value: line.label },
                    { name: 'primesAmounts', value: line.amount },
                ));
            [
                ['heuresSup25', 'overtime_25'],
                ['heuresSup50', 'overtime_50'],
                ['heuresSup100', 'overtime_100'],
            ].forEach(([field, calculationKey]) => {
                if (!overtimeEnabled || !isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, { calculationKey })) {
                    rubriqueVisibilityInputs.push({ name: field, value: rawBulletin[field] || 0 });
                }
            });
            if (!isRubriqueVisible(rubriqueMaps.rubriqueVisibility, 'base', 'base_salary')) {
                const field = rawBulletin.workingTimeMode === 'HOURS' ? 'workedHours' : 'workedDays';
                rubriqueVisibilityInputs.push({ name: field, value: rawBulletin[field] || 0 });
            }
        }
        const addTaxableLines = values => taxableAdditionLines(
            values || {},
            rubriqueMaps.imposableRows,
            overtimeEnabled,
            rubriqueMaps.rubriqueVisibility,
            primeRendementEnabled,
        ).filter(line => isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, line));
        if (bulletin) {
            const fixedNimpLabels = new Set((emp.bonuses || [])
                .filter(bonus => !(bonus.bonus ? bonus.bonus.taxable : bonus.taxable))
                .map(bonus => String(bonus.bonus ? bonus.bonus.name : bonus.name || '').toLowerCase()));
            const representationLabel = String(emp.indemniteRepresentationName || '').trim().toLowerCase();
            const workingTime = resolveWorkingTimeForPayslip(emp, bulletin);
            const ficheRatio = Number(workingTime.ratio || 0);
            const ficheNimpAmounts = new Map((emp.bonuses || [])
                .filter(bonus => !(bonus.bonus ? bonus.bonus.taxable : bonus.taxable))
                .map(bonus => [
                    String(bonus.bonus ? bonus.bonus.name : bonus.name || '').trim().toLowerCase(),
                    Number(bonus.amount || 0),
                ]));
            const representationMaximum = representationLabel
                ? Number(bulletin.rawBaseSalary || emp.baseSalary || 0)
                    * Number(emp.indemniteRepresentationRate || 0) * ficheRatio
                : 0;
            const withFicheMaximum = line => {
                const key = String(line.label || '').trim().toLowerCase();
                const ficheAmount = ficheNimpAmounts.get(key);
                const catalogueAmount = (emp.bonuses || []).find(bonus =>
                    String(bonus.bonus ? bonus.bonus.name : bonus.name || '').trim().toLowerCase() === key
                )?.bonus?.defaultAmount;
                const hasCatalogueDefinition = Number.isFinite(Number(catalogueAmount));
                const catalogueMaximum = hasCatalogueDefinition && Number(catalogueAmount) > 0
                    ? Number(catalogueAmount) * ficheRatio
                    : null;
                return {
                    ...line,
                    ficheAmount: ficheAmount !== undefined
                        ? ficheAmount
                        : key === representationLabel && ficheRatio > 0
                            ? representationMaximum / ficheRatio
                            : null,
                    maxAmount: hasCatalogueDefinition
                        ? catalogueMaximum
                        : ficheAmount !== undefined && ficheAmount > 0
                            ? ficheAmount * ficheRatio
                        : key === representationLabel
                            ? representationMaximum
                            : Number(line.baseAmount || line.amount || 0),
                };
            };
            bulletin.fixedNimpLines = bulletin.nimpLines.filter(line => {
                const label = String(line.label).toLowerCase();
                return fixedNimpLabels.has(label) || (representationLabel && label === representationLabel);
            }).map(withFicheMaximum);
            bulletin.monthlyNimpLines = bulletin.nimpLines.filter(line => {
                const label = String(line.label).toLowerCase();
                return !fixedNimpLabels.has(label) && !(representationLabel && label === representationLabel);
            }).map(withFicheMaximum);
        }

        const employeeAvances = await listEmployeeAvances(emp.id);
        const employeePrets = await listEmployeePrets(emp.id);
        const automaticPretDeduction = employeePrets.reduce((total, pret) => total + Math.min(Number(pret.monthlyAmount || 0), Number(pret.solde || 0)), 0);

        // Pre-compute preview result if no payslip exists yet in DB
        let previewResult = null;
        if (!bulletin) {
            try {
                const monthlyPreview = await runEmployeeCalculation(emp, { month, year });
                previewResult = await applyCumulativeIR(emp.id, month, year, monthlyPreview, emp.nbPersonacharge);
                const initialAvanceDeduction = employeeAvances.reduce((total, avance) => total + Number(avance.solde || 0), 0);
                previewResult.avanceDeduction = Number(initialAvanceDeduction.toFixed(2));
                previewResult.netAPayer = Math.max(0, Number((Number(previewResult.netAPayer || 0) - previewResult.avanceDeduction).toFixed(2)));
                previewResult.pretDeduction = Number(automaticPretDeduction.toFixed(2));
                previewResult.netAPayer = Math.max(0, Number((Number(previewResult.netAPayer || 0) - previewResult.pretDeduction).toFixed(2)));
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
            ? { ...bulletin, annualCumulative, taxableAdditions: addTaxableLines(bulletin) }
            : null;
        const previewViewModel = previewResult
            ? {
                ...filterInvisibleRubriqueLines(previewResult, rubriqueMaps.rubriqueVisibility),
                annualCumulative,
                taxableAdditions: addTaxableLines(previewResult),
            }
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
            bulletinEmployees,
            overtimeEnabled,
            primeRendementEnabled,
            rubriqueVisibility: rubriqueMaps.rubriqueVisibility,
            periodBlocked: req.query.periodBlocked === "1",
            mode: "single",
            bulletin: bulletinViewModel,
            rubriqueVisibilityInputs,
            previewResult: previewViewModel,
            history: null,
            month,
            year,
            monthName: MONTH_NAMES_FR[month],
            monthNames: MONTH_NAMES_FR,
            annualCumulative,
            periode: bulletin?.periode ?? previewResult?.periode ?? 1,
            fmt,
            rubriqueCodes,
            paidLeaveRubrique: rubriqueMaps.baseRows.find(row => row.key === 'paid_leave_days' && row.active && row.visible !== false) || null,
            birthLeaveRubrique: rubriqueMaps.baseRows.find(row => row.key === 'birth_leave_days' && row.active && row.visible !== false) || null,
            publicHolidayRubrique: rubriqueMaps.baseRows.find(row => row.key === 'public_holiday_days' && row.active && row.visible !== false) || null,
            availablePrimes,
            availableIndemnites,
            taxableRubriques: rubriqueMaps.imposableRows.filter(row => row.active),
            manualRetenuRubriques: rubriqueMaps.retenuRows.filter(row => row.entryType === 'MANUAL' && row.active && row.visible !== false),
            employeeAvances,
            employeePrets,
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
export const addManualRetenu = async (req, res) => {
    try {
        const employeeId = Number(req.params.id);
        const month = Number(req.body.month) || currentMonth();
        const year = Number(req.body.year) || currentYear();
        const rubriqueRetenuId = Number(req.body.rubriqueRetenuId);
        const amount = Number(req.body.amount);
        const payslip = await prisma.payslip.findFirst({
            where: { employeeId, month, year, employee: { companyId: resolveCompanyId(req) } },
            include: { retenus: true },
        });
        if (!payslip) return res.status(400).json({ ok: false, error: "Générez d'abord le bulletin avant d'ajouter une retenue." });
        if (isLockedBulletin(payslip.status)) return res.status(403).json({ ok: false, error: "Ce bulletin est verrouillé." });
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "Le montant doit être positif." });
        const rubrique = await prisma.rubriqueRetenu.findFirst({ where: { id: rubriqueRetenuId, companyId: resolveCompanyId(req), entryType: 'MANUAL', active: true } });
        if (!rubrique) return res.status(400).json({ ok: false, error: "Cette retenue n'est pas disponible." });
        const row = await prisma.payslipRetenu.create({ data: { payslipId: payslip.id, rubriqueRetenuId: rubrique.id, code: rubrique.code, name: rubrique.name, amount: Number(amount.toFixed(2)) } });
        const netAPayer = await applyManualRetenuesToNet(payslip.id, Number(payslip.netAPayer) + manualRetenueTotal(payslip.retenus));
        if (String(req.headers.accept || '').includes('text/html')) return res.redirect(`/bulletins/${employeeId}?month=${month}&year=${year}`);
        return res.json({ ok: true, retenu: { id: row.id, code: row.code, label: row.name, amount: Number(row.amount) }, netAPayer });
    } catch (error) {
        console.error("Add manual retenu error:", error);
        return res.status(500).json({ ok: false, error: "Impossible d'ajouter la retenue." });
    }
};

export const deleteManualRetenu = async (req, res) => {
    try {
        const employeeId = Number(req.params.id);
        const month = Number(req.body.month) || currentMonth();
        const year = Number(req.body.year) || currentYear();
        const retenuId = Number(req.body.retenuId);
        const payslip = await prisma.payslip.findFirst({ where: { employeeId, month, year, employee: { companyId: resolveCompanyId(req) } }, include: { retenus: true } });
        if (!payslip) return res.status(404).json({ ok: false, error: "Bulletin introuvable." });
        if (isLockedBulletin(payslip.status)) return res.status(403).json({ ok: false, error: "Ce bulletin est verrouillé." });
        const row = payslip.retenus.find(item => item.id === retenuId);
        if (!row) return res.status(404).json({ ok: false, error: "Retenue introuvable." });
        await prisma.payslipRetenu.delete({ where: { id: row.id } });
        const netAPayer = await applyManualRetenuesToNet(payslip.id, Number(payslip.netAPayer) + manualRetenueTotal(payslip.retenus));
        if (String(req.headers.accept || '').includes('text/html')) return res.redirect(`/bulletins/${employeeId}?month=${month}&year=${year}`);
        return res.json({ ok: true, netAPayer });
    } catch (error) {
        console.error("Delete manual retenu error:", error);
        return res.status(500).json({ ok: false, error: "Impossible de supprimer la retenue." });
    }
};

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
                retenus: true,
                employee: {
                    include: { company: true, employeeFunction: true }
                }
            }
        });

        if (!payslip) {
            return res.status(404).send("Aucun bulletin enregistré pour cette période. Veuillez d'abord créer le bulletin.");
        }

        const emp = payslip.employee;
        const comp = emp.company || {};
        const monthName = MONTH_NAMES_FR[month] || "Mois";
        const rubriqueMaps = await getRubriqueMaps(emp.companyId);
        const rubriqueCodes = rubriqueMaps.codes;

        const hireDate = new Date(emp.dateEmbauche);
        const seniorityYears = Math.max(0, Math.floor((new Date() - hireDate) / (1000 * 60 * 60 * 24 * 365.25)));

        const variablePrimes = (payslip.bonuses || [])
            .filter(b => b.taxable)
            .map(b => ({ rubriqueImposableId: b.rubriqueImposableId || null, code: b.code || '', label: b.name, amount: Number(b.amount), baseAmount: payslipBonusBaseAmount(b) }))
            .filter(line => isImposableRubriqueVisible(rubriqueMaps.rubriqueVisibility, line));
        const overtimeEnabled = isOvertimeEnabled(comp);
        const primeRendementEnabled = isPrimeRendementEnabled(comp);
        const bulletinData = filterInvisibleRubriqueLines(
            hidePrimeRendementFromView(
                hideOvertimeFromView(mapPayslipToViewModel(payslip, emp.indemniteRepresentationRate), overtimeEnabled),
                primeRendementEnabled,
            ),
            rubriqueMaps.rubriqueVisibility,
        );
        const cumulative = await getBulletinPdfCumulative(empId, year, month, payslip);

        const pdfData = {
            ...bulletinData,
            employeeName: emp.nomComplet,
            employeeMatricule: emp.matricule,
            employeeCNSS: emp.numeroCNSS || '—',
            employeeFonction: emp.employeeFunction ? emp.employeeFunction.name : '—',
            employeeAddress: emp.adresse || '—',
            birthDate: emp.dateNaissance ? new Date(emp.dateNaissance).toLocaleDateString('fr-MA') : '—',
            hireDate: emp.dateEmbauche ? new Date(emp.dateEmbauche).toLocaleDateString('fr-MA') : '—',
            sexe: emp.sexe || '—',
            children: emp.nbEnfantCharge,
            dependents: emp.nbPersonacharge,
            cin: emp.cin || '—',
            seniorityYears,
            companyName: comp.name || 'CONFONDA',
            companyLogo: comp.logoData || null,
            companyAddress: comp.adresse || 'hay sikaktyne',
            companyCNSS: comp.numeroAffiliationCnss || '—',
            companyIF: comp.ifNumber || '565653486',
            companyICE: comp.ice || '120521852812821',
            month,
            year,
            monthName,
            paymentDate: `${year}-${String(month).padStart(2, '0')}-25`,
            paymentMethod: emp.modePaiement || 'Virement',
            overtimeEnabled,
            primeRendementEnabled,
            rubriqueVisibility: rubriqueMaps.rubriqueVisibility,
            variablePrimes,
            taxableAdditions: taxableAdditionLines(
                bulletinData,
                rubriqueMaps.imposableRows,
                overtimeEnabled,
                rubriqueMaps.rubriqueVisibility,
                primeRendementEnabled,
            ),
            cumulative,
            rubriqueCodes,
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

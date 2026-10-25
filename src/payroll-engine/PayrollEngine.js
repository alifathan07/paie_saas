import { calculateMonths } from "./utils/calculateMonths.js";
import { calculateAnciennete } from "./calculators/anciennete.calculator.js";
import { calculateCNSSSalariale, calculateCNSSPatronale } from "./calculators/cnss.calculator.js";
import { calculateAMOSalariale, calculateAMOPatronale } from "./calculators/amo.calculator.js";
import { calculateCIMR } from "./calculators/cimr.calculator.js";
import { calculateFraisProfessionnels } from "./calculators/fraisProfessionnels.calculator.js";
import { calculateIR } from "./calculators/ir.calculator.js";
import { calculateOvertime } from "./calculators/overtime.calculator.js";
import { normalizeWorkingTime, workingTimeConfigFromCompany } from "./utils/workingTime.js";

export const PAYROLL_WORKED_DAYS = 26;

const prorateAmount = (amount, ratio) => Number((Math.max(0, Number(amount) || 0) * ratio).toFixed(2));

export const normalizeWorkedDays = (value) => {
  if (value === undefined || value === null || value === '') {
    return PAYROLL_WORKED_DAYS;
  }

  const workedDays = Number(value);
  if (!Number.isFinite(workedDays) || workedDays < 0 || workedDays > PAYROLL_WORKED_DAYS) {
    throw new Error(`WORKED_DAYS_INVALID: workedDays must be an integer between 0 and ${PAYROLL_WORKED_DAYS}`);
  }

  return Number(workedDays.toFixed(2));
};

/**
 * Main Deterministic Moroccan Payroll Engine
 * Single Source of Truth for Preview (/calculate) and Generation (/generate).
 *
 * @param {Object} employee Employee Prisma model or plain object
 * @param {Object} overrides Monthly variable overrides from request
 * @returns {Object} Complete payroll breakdown and net calculation
 */
export const calculatePayroll = (employee, overrides = {}) => {
  if (!employee) {
    throw new Error("EMPLOYEE_REQUIRED: Employee object must be provided to calculate payroll");
  }

  // Blocking payroll removes payable inputs before running the normal calculation.
  const payrollBlocked = Boolean(employee.blocageSaisiePaie || employee.actif === false);
  if (payrollBlocked) {
    employee = { ...employee, bonuses: [] };
    overrides = {
      month: overrides.month,
      year: overrides.year,
      periodDate: overrides.periodDate,
      baseSalary: 0,
      workedDays: 0,
      workedHours: 0,
      dependents: 0,
      heuresSup25: 0,
      heuresSup50: 0,
      heuresSup100: 0,
      variablePrimes: [],
      monthlyNimpLines: [],
      bonusesNIMP: 0,
    };
  }

  // 1. Reference period date for exact seniority determination (end of payroll month)
  const targetDate = overrides.periodDate ||
    (overrides.month && overrides.year ? new Date(Number(overrides.year), Number(overrides.month), 0) : new Date());

  const workingTime = normalizeWorkingTime({
    ...workingTimeConfigFromCompany(employee.company),
    ...overrides,
  });

  // 2. Base salary prorated by the company's normalized monthly basis.
  const rawBase = overrides.baseSalary !== undefined && overrides.baseSalary !== null && overrides.baseSalary !== ''
    ? Math.max(0, Number(overrides.baseSalary) || 0)
    : Math.max(0, Number(employee.baseSalary) || 0);

  const workedDays = workingTime.workedDays;
  const workedHours = workingTime.workedHours;
  const effectiveBase = Number((rawBase * workingTime.ratio).toFixed(2));
  // Fixed indemnities follow the entered working-time unit directly. In hours
  // mode this preserves the exact worked-hours ratio (e.g. 130 / 191).
  const indemnityRatio = workingTime.mode === 'HOURS'
    ? workedHours / workingTime.standardMonthlyHours
    : workingTime.ratio;

  // 3. Seniority (Prime d'ancienneté) based on effective base and dateEmbauche relative to payroll period
  const months = calculateMonths(employee.dateEmbauche, targetDate);
  const anciennete = calculateAnciennete(effectiveBase, months);
  const primeAnciennete = anciennete.amount;
  const ancienneteRate = anciennete.rate;

  // 4. Monthly variable taxable primes
  let variablePrimes = [];
  if (Array.isArray(overrides.variablePrimes)) {
    variablePrimes = overrides.variablePrimes.map(p => ({
      label: String(p.label || p.name || 'Prime'),
      code: String(p.code || ''),
      rubriqueImposableId: p.rubriqueImposableId ? Number(p.rubriqueImposableId) : null,
      amount: Math.max(0, Number(p.amount) || 0)
    })).filter(p => p.amount > 0 || p.rubriqueImposableId);
  }
  const variableLabels = new Set(variablePrimes.map(p => p.label.toLowerCase()));

  // 5. Overtime (Heures supplémentaires: 25%, 50%, 100%)
  const overtime = calculateOvertime(
    effectiveBase,
    overrides.heuresSup25,
    overrides.heuresSup50,
    overrides.heuresSup100,
    workingTime.standardMonthlyHours
  );
  const heuresSupAmount = overtime.totalAmount;

  // 6. Employee-specific representation indemnity.
  const nimpLines = [];
  const nimpLabels = new Set();
  const representationRate = Math.max(0, Number(employee.indemniteRepresentationRate) || 0);
  const representationName = String(employee.indemniteRepresentationName || '').trim();
  const representationBonus = (employee.bonuses || []).find(item => {
    const name = String(item.bonus ? item.bonus.name : item.name || '').trim().toLowerCase();
    return name === representationName.toLowerCase();
  });
  const representationCode = String(representationBonus?.bonus?.code || representationBonus?.code || '');
  const representationBaseAmount = representationName && representationRate > 0
    ? Number((rawBase * representationRate).toFixed(2))
    : 0;
  const representationAmount = representationName && representationRate > 0
    ? Number((effectiveBase * representationRate).toFixed(2))
    : 0;
  if (representationName && representationAmount > 0) {
    nimpLines.push({ code: representationCode, label: representationName, baseAmount: representationBaseAmount, amount: representationAmount });
    nimpLabels.add(representationName.toLowerCase());
  }

  // 7. Recurring employee bonuses from DB (EmployeeBonus + Bonus catalog)
  if (employee.bonuses && Array.isArray(employee.bonuses)) {
    employee.bonuses.forEach(eb => {
      const isTaxable = eb.bonus ? Boolean(eb.bonus.taxable) : Boolean(eb.taxable);
      const bonusName = String(eb.bonus ? eb.bonus.name : eb.name || 'Prime');
      let amt = Number(eb.amount) || 0;
      if (overrides.niimpOverrides && overrides.niimpOverrides[bonusName] !== undefined) {
        amt = Math.max(0, Number(overrides.niimpOverrides[bonusName]) || 0);
      }
      if (!isTaxable) {
        // Representation is calculated from the employee percentage above.
        // Ignore a legacy catalog assignment with the same label so it cannot
        // be added a second time as a fixed amount.
        if (representationName && bonusName.trim().toLowerCase() === representationName.toLowerCase()) return;
        nimpLines.push({
          code: String(eb.bonus ? eb.bonus.code || '' : eb.code || ''),
          label: bonusName,
          baseAmount: Number(amt.toFixed(2)),
          amount: prorateAmount(amt, indemnityRatio),
        });
        nimpLabels.add(bonusName.toLowerCase());
      } else if (amt > 0 && !variableLabels.has(bonusName.toLowerCase())) {
        variablePrimes.push({ code: String(eb.bonus ? eb.bonus.code || '' : eb.code || ''), label: bonusName, amount: Number(amt.toFixed(2)) });
        variableLabels.add(bonusName.toLowerCase());
      }
    });
  }

  // Paid leave is taxable. Its hidden calculation base is the full monthly
  // salary, seniority bonus, and employee primes marked for paid leave.
  const paidLeaveDays = Math.max(0, Math.min(PAYROLL_WORKED_DAYS, Number(overrides.paidLeaveDays) || 0));
  const leavePrimeAmount = (employee.bonuses || []).reduce((total, item) => {
    const isTaxable = item.bonus ? Boolean(item.bonus.taxable) : Boolean(item.taxable);
    return total + (isTaxable && item.implementerEnConge ? Number(item.amount) || 0 : 0);
  }, 0);
  // Paid leave and public-holiday bases are full-month contractual bases.
  // They must not use the bulletin's prorated/edited salary or effective days.
  const contractualBaseSalary = Math.max(0, Number(employee.baseSalary) || 0);
  const fullMonthSeniority = calculateAnciennete(contractualBaseSalary, months).amount;
  const baseConge = paidLeaveDays > 0
    ? Number((contractualBaseSalary + fullMonthSeniority + leavePrimeAmount).toFixed(2))
    : 0;
  const paidLeaveAmount = Number((baseConge * paidLeaveDays / PAYROLL_WORKED_DAYS).toFixed(2));
  const joursFeries = Math.max(0, Math.min(PAYROLL_WORKED_DAYS, Number(overrides.joursFeries) || 0));
  const holidayPrimeAmount = (employee.bonuses || []).reduce((total, item) => {
    const isTaxable = item.bonus ? Boolean(item.bonus.taxable) : Boolean(item.taxable);
    return total + (isTaxable && item.implementerEnJourFerie ? Number(item.amount) || 0 : 0);
  }, 0);
  const baseFerie = joursFeries > 0
    ? Number((contractualBaseSalary + fullMonthSeniority + holidayPrimeAmount).toFixed(2))
    : 0;
  const joursFeriesAmount = Number((baseFerie * joursFeries / PAYROLL_WORKED_DAYS).toFixed(2));

  // Monthly non-taxable indemnities belong to the selected payslip only.
  if (Array.isArray(overrides.monthlyNimpLines)) {
    overrides.monthlyNimpLines.forEach(line => {
      const label = String(line.label || line.name || 'Indemnité').trim();
      const baseAmount = Math.max(0, Number(line.baseAmount ?? line.amount) || 0);
      if (label && baseAmount > 0 && !nimpLabels.has(label.toLowerCase())) {
        nimpLines.push({ code: String(line.code || ''), label, baseAmount: Number(baseAmount.toFixed(2)), amount: prorateAmount(baseAmount, indemnityRatio) });
        nimpLabels.add(label.toLowerCase());
      }
    });
  }

  let bonusesNIMP = nimpLines.reduce((sum, p) => sum + p.amount, 0);
  if ((!employee.bonuses || employee.bonuses.length === 0) && overrides.bonusesNIMP !== undefined) {
    bonusesNIMP = prorateAmount(overrides.bonusesNIMP, indemnityRatio);
  }
  bonusesNIMP = Number(bonusesNIMP.toFixed(2));
  const bonusesIMP = Number((variablePrimes.reduce((sum, p) => sum + p.amount, 0) + paidLeaveAmount + joursFeriesAmount).toFixed(2));

  // 8. Salaire Brut Global (SBG)
  // SBG = Base effective + Ancienneté + Primes imposables + Heures sup + Indemnités non imposables
  const sbg = Number((effectiveBase + primeAnciennete + bonusesIMP + heuresSupAmount + bonusesNIMP).toFixed(2));

  // 9. Salaire Brut Imposable (SBI)
  // SBI = SBG - Indemnités non imposables
  const sbi = Math.max(0, Number((sbg - bonusesNIMP).toFixed(2)));

  // 10. Cotisations Sociales Salariales
  // CNSS: 4.48% plafonné à 6 000 DH (max 268.80 DH)
  const cnss = Number(calculateCNSSSalariale(sbi).toFixed(2));
  // AMO: 2.26% non plafonné
  const amo = Number(calculateAMOSalariale(sbi).toFixed(2));

  // Employer side (part patronale) derived from the same payroll base
  const cnssPatronale = Number(calculateCNSSPatronale(sbi).total.toFixed(2));
  const amoPatronale = Number(calculateAMOPatronale(sbi).toFixed(2));
  const partPatronal = Number((cnssPatronale + amoPatronale).toFixed(2));

  // 11. CIMR (Optional / Conditional)
  const rawCimrRate = employee.cimrRate ? Number(employee.cimrRate) : null;
  const cimrRate = rawCimrRate && rawCimrRate > 0 ? rawCimrRate : null;
  const cimr = Number(calculateCIMR(sbi, cimrRate).toFixed(2));
  const cimrReduitBaseImposable = Boolean(employee.cimrReduitBaseImposable);

  // 12. Frais Professionnels (Fiscal Abatement for IR reduction — NOT a cash deduction from salary)
  const fraisPro = calculateFraisProfessionnels(sbi);
  const fraisProAmount = Number(fraisPro.amount.toFixed(2));
  const fraisProRate = fraisPro.rate;

  // 13. Salaire Net Imposable (SNI)
  // SNI = SBI - CNSS - AMO - (CIMR if reducible) - FraisPro
  const baseAvantFraisPro = sbi - cnss - amo - (cimrReduitBaseImposable ? cimr : 0);
  const sni = Math.max(0, Number((baseAvantFraisPro - fraisProAmount).toFixed(2)));

  // 14. Impôt sur le Revenu (IR) selon le barème marocain
  const ir = calculateIR(sni);
  const irTaux = ir.taux;
  const irTheorique = Number((sni * irTaux).toFixed(2));
  const sommeADeduire = Number((ir.sommeADeduire || 0).toFixed(2));
  // Moroccan standard convention: IR Brut is the bracket-adjusted tax before family allowances
  const irBrut = Number(ir.irNet.toFixed(2));

  // 15. Charges de famille: 50 DH per dependent, max 6 dependents (300 DH max)
  const dependentsRaw = overrides.dependents !== undefined && overrides.dependents !== null && overrides.dependents !== ''
    ? Number(overrides.dependents)
    : (employee.nbPersonacharge !== undefined ? Number(employee.nbPersonacharge) : (Number(employee.dependents) || 0));
  const dependents = Math.max(0, Math.min(6, dependentsRaw));
  const chargesDeFamille = Number((dependents * 50).toFixed(2));

  // IR Net = max(0, IR Brut - Charges de famille)
  const irNet = Math.max(0, Number((irBrut - chargesDeFamille).toFixed(2)));

  // 16. Net à Payer
  // Net = SBG - CNSS - AMO - CIMR - IR Net
  // NOTE: Frais Professionnels are NOT subtracted from Net à Payer!
  const exactNetAPayer = Math.max(0, Number((sbg - cnss - amo - cimr - irNet).toFixed(2)));
  // Payroll pays the net rounded to the nearest dirham. Keep the adjustment
  // explicit so the bulletin can show it instead of hiding the centimes.
  const arrondi = Number((Math.round(exactNetAPayer) - exactNetAPayer).toFixed(2));
  const avanceDeduction = Math.max(0, Number(overrides.avanceDeduction || 0));
  const netAPayer = Math.max(0, Number((exactNetAPayer + arrondi - avanceDeduction).toFixed(2)));

  return {
    ok: true,
    payrollBlocked,
    employeeId: employee.id,
    employeeName: employee.nomComplet || employee.name || '',

    baseSalary: effectiveBase,
    rawBaseSalary: rawBase,
    workedDays,
    workedHours,
    workingTimeMode: workingTime.mode,
    standardMonthlyDays: workingTime.standardMonthlyDays,
    standardMonthlyHours: workingTime.standardMonthlyHours,

    primeAnciennete,
    ancienneteRate,
    ancienneteMonths: months,
    ancienneteYears: anciennete.years,

    variablePrimes,
    nimpLines,
    bonusesIMP,
    paidLeaveDays,
    baseConge,
    paidLeaveAmount,
    joursFeries,
    baseFerie,
    joursFeriesAmount,
    indemniteNonImposableRate: representationRate,
    indemniteNonImposable: representationAmount,

    heuresSup25: overtime.heuresSup25,
    heuresSup50: overtime.heuresSup50,
    heuresSup100: overtime.heuresSup100,
    heuresSupAmount,

    sbg,
    brutGlobal: sbg,
    bonusesNIMP,
    sbi,

    // Retained as zero-valued compatibility fields. Salary is prorated only by workedDays.
    absenceDays: 0,
    absenceDeduction: 0,

    cnss,
    amo,
    cnssPatronale,
    amoPatronale,
    partPatronal,

    cimr,
    cimrRate,
    cimrReduitBaseImposable,

    fraisPro: fraisProAmount,
    fraisProRate,

    sni,

    irTaux,
    irTheorique,
    sommeADeduire,
    irBrut,
    chargesDeFamille,
    irNet,

    exactNetAPayer,
    arrondi,
    netAPayer,
    avanceDeduction
  };
};

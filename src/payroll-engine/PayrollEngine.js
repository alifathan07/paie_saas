import { calculateMonths } from "./utils/calculateMonths.js";
import { calculateAnciennete } from "./calculators/anciennete.calculator.js";
import { calculateCNSSSalariale, calculateCNSSPatronale } from "./calculators/cnss.calculator.js";
import { calculateAMOSalariale, calculateAMOPatronale } from "./calculators/amo.calculator.js";
import { calculateCIMR } from "./calculators/cimr.calculator.js";
import { calculateFraisProfessionnels } from "./calculators/fraisProfessionnels.calculator.js";
import { calculateIR } from "./calculators/ir.calculator.js";
import { calculateOvertime } from "./calculators/overtime.calculator.js";

export const PAYROLL_WORKED_DAYS = 26;

export const normalizeWorkedDays = (value) => {
  if (value === undefined || value === null || value === '') {
    return PAYROLL_WORKED_DAYS;
  }

  const workedDays = Number(value);
  if (!Number.isInteger(workedDays) || workedDays < 0 || workedDays > PAYROLL_WORKED_DAYS) {
    throw new Error(`WORKED_DAYS_INVALID: workedDays must be an integer between 0 and ${PAYROLL_WORKED_DAYS}`);
  }

  return workedDays;
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
  const payrollBlocked = Boolean(employee.blocageSaisiePaie);
  if (payrollBlocked) {
    employee = { ...employee, bonuses: [] };
    overrides = {
      month: overrides.month,
      year: overrides.year,
      periodDate: overrides.periodDate,
      baseSalary: 0,
      workedDays: 0,
      dependents: 0,
      heuresSup25: 0,
      heuresSup50: 0,
      heuresSup100: 0,
      avances: 0,
      variablePrimes: [],
      monthlyNimpLines: [],
      bonusesNIMP: 0,
    };
  }

  // 1. Reference period date for exact seniority determination (end of payroll month)
  const targetDate = overrides.periodDate ||
    (overrides.month && overrides.year ? new Date(Number(overrides.year), Number(overrides.month), 0) : new Date());

  // 2. Base salary prorated by worked days using the fixed 26-day reference
  const rawBase = overrides.baseSalary !== undefined && overrides.baseSalary !== null && overrides.baseSalary !== ''
    ? Math.max(0, Number(overrides.baseSalary) || 0)
    : Math.max(0, Number(employee.baseSalary) || 0);

  const workedDays = normalizeWorkedDays(overrides.workedDays);
  const effectiveBase = Number((rawBase / PAYROLL_WORKED_DAYS * workedDays).toFixed(2));

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
      amount: Math.max(0, Number(p.amount) || 0)
    })).filter(p => p.amount > 0);
  }
  const variableLabels = new Set(variablePrimes.map(p => p.label.toLowerCase()));

  // 5. Overtime (Heures supplémentaires: 25%, 50%, 100%)
  const overtime = calculateOvertime(
    effectiveBase,
    overrides.heuresSup25,
    overrides.heuresSup50,
    overrides.heuresSup100
  );
  const heuresSupAmount = overtime.totalAmount;

  // 6. Recurring employee bonuses from DB (EmployeeBonus + Bonus catalog)
  const nimpLines = [];
  const nimpLabels = new Set();
  if (employee.bonuses && Array.isArray(employee.bonuses)) {
    employee.bonuses.forEach(eb => {
      const isTaxable = eb.bonus ? Boolean(eb.bonus.taxable) : Boolean(eb.taxable);
      const bonusName = String(eb.bonus ? eb.bonus.name : eb.name || 'Prime');
      let amt = Number(eb.amount) || 0;
      if (overrides.niimpOverrides && overrides.niimpOverrides[bonusName] !== undefined) {
        amt = Math.max(0, Number(overrides.niimpOverrides[bonusName]) || 0);
      }
      if (!isTaxable) {
        nimpLines.push({ label: bonusName, amount: Number(amt.toFixed(2)) });
        nimpLabels.add(bonusName.toLowerCase());
      } else if (amt > 0 && !variableLabels.has(bonusName.toLowerCase())) {
        variablePrimes.push({ label: bonusName, amount: Number(amt.toFixed(2)) });
        variableLabels.add(bonusName.toLowerCase());
      }
    });
  }

  // Monthly non-taxable indemnities belong to the selected payslip only.
  if (Array.isArray(overrides.monthlyNimpLines)) {
    overrides.monthlyNimpLines.forEach(line => {
      const label = String(line.label || line.name || 'Indemnité').trim();
      const amount = Math.max(0, Number(line.amount) || 0);
      if (label && amount > 0 && !nimpLabels.has(label.toLowerCase())) {
        nimpLines.push({ label, amount: Number(amount.toFixed(2)) });
        nimpLabels.add(label.toLowerCase());
      }
    });
  }

  let bonusesNIMP = nimpLines.reduce((sum, p) => sum + p.amount, 0);
  if ((!employee.bonuses || employee.bonuses.length === 0) && overrides.bonusesNIMP !== undefined) {
    bonusesNIMP = Math.max(0, Number(overrides.bonusesNIMP) || 0);
  }
  bonusesNIMP = Number(bonusesNIMP.toFixed(2));
  const bonusesIMP = Number(variablePrimes.reduce((sum, p) => sum + p.amount, 0).toFixed(2));

  // 7. Salaire Brut Global (SBG)
  // SBG = Base effective + Ancienneté + Primes imposables + Heures sup + Indemnités non imposables
  const sbg = Number((effectiveBase + primeAnciennete + bonusesIMP + heuresSupAmount + bonusesNIMP).toFixed(2));

  // 8. Salaire Brut Imposable (SBI)
  // SBI = SBG - Indemnités non imposables
  const sbi = Math.max(0, Number((sbg - bonusesNIMP).toFixed(2)));

  // 9. Cotisations Sociales Salariales
  // CNSS: 4.48% plafonné à 6 000 DH (max 268.80 DH)
  const cnss = Number(calculateCNSSSalariale(sbi).toFixed(2));
  // AMO: 2.26% non plafonné
  const amo = Number(calculateAMOSalariale(sbi).toFixed(2));

  // Employer side (part patronale) derived from the same payroll base
  const cnssPatronale = Number(calculateCNSSPatronale(sbi).total.toFixed(2));
  const amoPatronale = Number(calculateAMOPatronale(sbi).toFixed(2));
  const partPatronal = Number((cnssPatronale + amoPatronale).toFixed(2));

  // 10. CIMR (Optional / Conditional)
  const rawCimrRate = employee.cimrRate ? Number(employee.cimrRate) : null;
  const cimrRate = rawCimrRate && rawCimrRate > 0 ? rawCimrRate : null;
  const cimr = Number(calculateCIMR(sbi, cimrRate).toFixed(2));
  const cimrReduitBaseImposable = Boolean(employee.cimrReduitBaseImposable);

  // 11. Frais Professionnels (Fiscal Abatement for IR reduction — NOT a cash deduction from salary)
  const fraisPro = calculateFraisProfessionnels(sbi);
  const fraisProAmount = Number(fraisPro.amount.toFixed(2));
  const fraisProRate = fraisPro.rate;

  // 12. Salaire Net Imposable (SNI)
  // SNI = SBI - CNSS - AMO - (CIMR if reducible) - FraisPro
  const baseAvantFraisPro = sbi - cnss - amo - (cimrReduitBaseImposable ? cimr : 0);
  const sni = Math.max(0, Number((baseAvantFraisPro - fraisProAmount).toFixed(2)));

  // 13. Impôt sur le Revenu (IR) selon le barème marocain
  const ir = calculateIR(sni);
  const irTaux = ir.taux;
  const irTheorique = Number((sni * irTaux).toFixed(2));
  const sommeADeduire = Number((ir.sommeADeduire || 0).toFixed(2));
  // Moroccan standard convention: IR Brut is the bracket-adjusted tax before family allowances
  const irBrut = Number(ir.irNet.toFixed(2));

  // 14. Charges de famille: 50 DH per dependent, max 6 dependents (300 DH max)
  const dependentsRaw = overrides.dependents !== undefined && overrides.dependents !== null && overrides.dependents !== ''
    ? Number(overrides.dependents)
    : (employee.nbPersonacharge !== undefined ? Number(employee.nbPersonacharge) : (Number(employee.dependents) || 0));
  const dependents = Math.max(0, Math.min(6, dependentsRaw));
  const chargesDeFamille = Number((dependents * 50).toFixed(2));

  // IR Net = max(0, IR Brut - Charges de famille)
  const irNet = Math.max(0, Number((irBrut - chargesDeFamille).toFixed(2)));

  // 15. Avances (Salary advance cash deduction)
  const avances = Math.max(0, Number(overrides.avances) || 0);

  // 16. Net à Payer
  // Net = SBG - CNSS - AMO - CIMR - IR Net - Avances
  // NOTE: Frais Professionnels are NOT subtracted from Net à Payer!
  const netAPayer = Math.max(0, Number((sbg - cnss - amo - cimr - irNet - avances).toFixed(2)));

  return {
    ok: true,
    payrollBlocked,
    employeeId: employee.id,
    employeeName: employee.nom ? `${employee.nom} ${employee.prenom}` : (employee.name || ''),

    baseSalary: effectiveBase,
    rawBaseSalary: rawBase,
    workedDays,

    primeAnciennete,
    ancienneteRate,
    ancienneteMonths: months,
    ancienneteYears: anciennete.years,

    variablePrimes,
    nimpLines,
    bonusesIMP,

    heuresSup25: overtime.heuresSup25,
    heuresSup50: overtime.heuresSup50,
    heuresSup100: overtime.heuresSup100,
    heuresSupAmount,

    sbg,
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

    avances,

    netAPayer
  };
};
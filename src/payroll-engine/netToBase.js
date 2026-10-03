import { calculatePayroll } from './PayrollEngine.js';
import { calculateCumulativeIR } from './calculators/cumulativeIr.calculator.js';
import { FRAIS_PRO_RULES } from './rules/fraisProfessionnels.rules.js';
import { workingTimeConfigFromCompany } from './utils/workingTime.js';

// Decimal(12, 2), also used by the employee's contractual base salary.
export const MAX_SALARY = 9999999999.99;
const cents = value => Math.round(value * 100);

// A normal full month uses the bulletin's annualized IR calculation, without history.
export function calculateNormalMonth(employee, baseSalary, period) {
    const workingTime = workingTimeConfigFromCompany(employee.company);
    const payroll = calculatePayroll(employee, {
        baseSalary, month: period.month, year: period.year,
        ...workingTime,
        workedDays: workingTime.workingTimeMode === 'DAYS' ? workingTime.standardMonthlyDays : undefined,
        workedHours: workingTime.workingTimeMode === 'HOURS' ? workingTime.standardMonthlyHours : undefined,
        heuresSup25: 0, heuresSup50: 0, heuresSup100: 0, avances: 0,
    });
    const tax = calculateCumulativeIR({
        employeeId: employee.id || 1, ...period, previousPayslips: [], currentSNI: payroll.sni,
    });
    const irBrut = Number(tax.currentMonthIR.toFixed(2));
    const irNet = Math.max(0, Number((irBrut - payroll.chargesDeFamille).toFixed(2)));
    const exactNetAPayer = Number((payroll.sbg - payroll.cnss - payroll.amo - payroll.cimr
        - irNet - payroll.avances).toFixed(2));
    const arrondi = Number((Math.round(exactNetAPayer) - exactNetAPayer).toFixed(2));
    return {
        ...payroll,
        irNet,
        irTaux: tax.rate,
        irTheorique: tax.theoreticalIR,
        sommeADeduire: tax.deduction,
        irBrut,
        exactNetAPayer,
        arrondi,
        netAPayer: Number((exactNetAPayer + arrondi).toFixed(2)),
    };
}

export function findBaseForNet(employee, targetNet, period) {
    if (employee.blocageSaisiePaie) throw new Error('La saisie de paie est bloquée pour cet employé.');
    if (!Number.isFinite(targetNet) || targetNet < 0 || targetNet > MAX_SALARY) {
        throw new Error('Le net souhaité doit être un montant positif ou nul valide.');
    }
    const target = cents(targetNet);
    const maximum = cents(MAX_SALARY);
    const cache = new Map();
    const evaluate = base => {
        if (!cache.has(base)) cache.set(base, calculateNormalMonth(employee, base / 100, period));
        return cache.get(base);
    };
    if (target > cents(evaluate(maximum).netAPayer)) {
        throw new Error('Le net souhaité dépasse la limite calculable du salaire de base.');
    }

    // SBI increases with base. Split at each expense-rate change: net can jump there.
    const starts = [0];
    for (const rule of FRAIS_PRO_RULES.filter(rule => Number.isFinite(rule.maxSalary))) {
        if (evaluate(0).sbi > rule.maxSalary || evaluate(maximum).sbi <= rule.maxSalary) continue;
        let low = 0, high = maximum;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (evaluate(middle).sbi > rule.maxSalary) high = middle;
            else low = middle + 1;
        }
        starts.push(low);
    }
    starts.push(maximum + 1);
    starts.sort((a, b) => a - b);
    // A rate change can lower net below the value at base zero.
    let minimum = Infinity;
    for (let index = 0; index < starts.length - 1; index++) {
        for (let base = starts[index]; base <= Math.min(starts[index] + 32, starts[index + 1] - 1); base++) {
            minimum = Math.min(minimum, cents(evaluate(base).netAPayer));
        }
    }
    if (target < minimum) {
        throw new Error(`Le net souhaité est inférieur au minimum calculable (${(minimum / 100).toFixed(2)} DH) avec ces primes et indemnités.`);
    }
    let best;
    function consider(base) {
        const error = Math.abs(cents(evaluate(base).netAPayer) - target);
        if (!best || error < best.error || (error === best.error && base < best.base)) best = { base, error };
    }
    for (let index = 0; index < starts.length - 1; index++) {
        const left = starts[index], right = starts[index + 1] - 1;
        let low = left, high = right;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (cents(evaluate(middle).netAPayer) >= target) high = middle;
            else low = middle + 1;
        }
        consider(left);
        consider(right);
        // Independent rounding of contributions can cause tiny local reversals.
        // Net rounding creates plateaus that can be wider than the old local
        // search window. Scan enough cents to find the lowest base in the
        // nearest rounded-net plateau.
        for (let base = Math.max(left, low - 128); base <= Math.min(right, low + 128); base++) consider(base);
    }
    const baseSalary = best.base / 100;
    const payroll = calculateNormalMonth(employee, baseSalary, period);
    return {
        baseSalary, payroll,
        targetNet: target / 100,
        difference: (cents(payroll.netAPayer) - target) / 100,
        exact: cents(payroll.netAPayer) === target,
    };
}

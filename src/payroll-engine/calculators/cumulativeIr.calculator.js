import { calculateIR } from "./ir.calculator.js";
import { periodCalculator } from "./period.calculator.js";

// Dated history is required so callers cannot carry amounts across tax years.
export const calculateCumulativeIR = ({ employeeId, year, month, previousPayslips = [], currentSNI }) => {
  if (!Number.isInteger(employeeId) || !Number.isInteger(year) || year < 1 ||
      !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("CUMULATIVE_PERIOD_INVALID: employeeId, year and month are required");
  }
  const previous = previousPayslips.filter(payslip =>
    payslip.employeeId === employeeId && payslip.year === year &&
    Number.isInteger(payslip.month) && payslip.month >= 1 && payslip.month < month
  );
  const priorSNI = previous.reduce((sum, payslip) => sum + Number(payslip.sni || 0), 0);
  const priorIR = previous.reduce((sum, payslip) => sum + Number(payslip.irNet || 0), 0);
  const cumulativeSNI = Number((priorSNI + Number(currentSNI || 0)).toFixed(2));
  const periods = periodCalculator({ employeeId, year, month, previousPayslips: previous });
  const annualizedSNI = Number(((cumulativeSNI / periods) * 12).toFixed(2));
  const annualIR = calculateIR(annualizedSNI);
  const annualIRAmount = Number(annualIR.irNet.toFixed(2));
  const cumulativeIRDue = Number((annualIRAmount * (periods / 12)).toFixed(2));
  const currentMonthIR = Number((cumulativeIRDue - priorIR).toFixed(2));

  return {
    cumulativeSNI,
    elapsedPeriods: periods,
    annualizedSNI,
    annualIR: annualIRAmount,
    cumulativeIRDue,
    previousIRWithheld: Number(priorIR.toFixed(2)),
    currentMonthIR,
    rate: annualIR.taux,
    theoreticalIR: annualIR.irBrut,
    deduction: annualIR.sommeADeduire,
  };
};

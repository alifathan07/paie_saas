import { OVERTIME_RULES } from "../rules/overtime.rules.js";

/**
 * Calculates overtime compensation based on hourly rate derived from effective base salary
 *
 * @param {number} effectiveBase Effective base salary (base minus absence deduction)
 * @param {number} hs25 Hours worked with 25% majoration
 * @param {number} hs50 Hours worked with 50% majoration
 * @param {number} hs100 Hours worked with 100% majoration
 * @returns {Object} Overtime breakdown and total compensation amount
 */
export const calculateOvertime = (effectiveBase, hs25 = 0, hs50 = 0, hs100 = 0, monthlyHours = OVERTIME_RULES.monthlyHours) => {
  const cleanBase = Math.max(0, Number(effectiveBase) || 0);
  const clean25 = Math.max(0, Number(hs25) || 0);
  const clean50 = Math.max(0, Number(hs50) || 0);
  const clean100 = Math.max(0, Number(hs100) || 0);

  const normalizedMonthlyHours = Number(monthlyHours);
  if (!Number.isFinite(normalizedMonthlyHours) || normalizedMonthlyHours <= 0) throw new Error('STANDARD_MONTHLY_HOURS_INVALID');
  const hourlyRate = cleanBase > 0 ? cleanBase / normalizedMonthlyHours : 0;

  const hs25Amount = clean25 * hourlyRate * OVERTIME_RULES.rates.hs25;
  const hs50Amount = clean50 * hourlyRate * OVERTIME_RULES.rates.hs50;
  const hs100Amount = clean100 * hourlyRate * OVERTIME_RULES.rates.hs100;
  const totalAmount = hs25Amount + hs50Amount + hs100Amount;

  return {
    hourlyRate: Number(hourlyRate.toFixed(4)),
    heuresSup25: clean25,
    heuresSup50: clean50,
    heuresSup100: clean100,
    hs25Amount: Number(hs25Amount.toFixed(2)),
    hs50Amount: Number(hs50Amount.toFixed(2)),
    hs100Amount: Number(hs100Amount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2))
  };
};

/**
 * Moroccan Legal Overtime Rules
 * Standard monthly base: 26 working days * 8 hours = 208 hours
 * Standard legal overtime majoration rates: 25%, 50%, 100%
 */
export const OVERTIME_RULES = {
  monthlyHours: 26 * 8, // 208 hours
  rates: {
    hs25: 1.25,
    hs50: 1.50,
    hs100: 2.00
  }
};

/**
 * Moroccan Legal Overtime Rules
 * Monthly hours used as the default overtime denominator: 191 hours
 * Standard legal overtime majoration rates: 25%, 50%, 100%
 */
export const OVERTIME_RULES = {
  monthlyHours: 191,
  rates: {
    hs25: 1.25,
    hs50: 1.50,
    hs100: 2.00
  }
};

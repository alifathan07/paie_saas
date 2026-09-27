export const IR_RULES = [
  { min: 0, max: 40000, taux: 0, deduction: 0 },
  { min: 40000.01, max: 60000, taux: 0.10, deduction: 4000 },
  { min: 60000.01, max: 80000, taux: 0.20, deduction: 10000 },
  { min: 80000.01, max: 100000, taux: 0.30, deduction: 18000 },
  { min: 100000.01, max: 180000, taux: 0.34, deduction: 22000 },
  { min: 180000.01, max: Infinity, taux: 0.37, deduction: 27400 }
];
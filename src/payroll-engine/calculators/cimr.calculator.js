/**
 * CIMR (Caisse Interprofessionnelle Marocaine de Retraite) Calculator
 *
 * @param {number} sbi Salaire Brut Imposable
 * @param {number|null} rate CIMR contribution rate (e.g. 0.03 for 3%, 0.06 for 6%)
 * @returns {number} CIMR deduction amount
 */
export const calculateCIMR = (sbi, rate) => {
  if (!rate || Number(rate) <= 0) return 0;
  return sbi * Number(rate);
};

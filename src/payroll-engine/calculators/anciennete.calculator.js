import { getAncienneteRate } from "../rules/anciennete.rules.js";

export const calculateAnciennete = (baseSalary, months) => {
  const cleanMonths = Math.max(0, Number(months) || 0);
  const cleanBase = Math.max(0, Number(baseSalary) || 0);
  const rate = getAncienneteRate(cleanMonths);
  const years = Math.floor(cleanMonths / 12);
  const amount = Number((cleanBase * rate).toFixed(2));

  return {
    months: cleanMonths,
    years,
    rate,
    amount
  };
};
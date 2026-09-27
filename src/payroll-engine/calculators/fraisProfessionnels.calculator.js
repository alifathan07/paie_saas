import { FRAIS_PRO_RULES } from "../rules/fraisProfessionnels.rules.js";

/**
 * FraisProfessionnelsCalculator
 *
 * Moroccan Tax Code (CGI Art. 59) — Déduction pour Frais Professionnels:
 * - Fiscal abatement applied to determine taxable base (SNI) for IR.
 * - NOT a cotisation, social contribution, or employee cash deduction.
 * - Standard tier: SBI <= 6,500 DH/month (78,000 DH/year) -> Rate = 35%, Cap = 2,500 DH/month (30,000 DH/year).
 * - Higher tier:   SBI > 6,500 DH/month -> Rate = 25%, Cap = 2,916.67 DH/month (35,000 DH/year).
 */
export class FraisProfessionnelsCalculator {
  /**
   * Calculate professional expense abatement from SBI.
   *
   * @param {number} sbi Gross Taxable Salary (Salaire Brut Imposable)
   * @returns {{ rate: number, cap: number, amount: number }}
   */
  static calculate(sbi) {
    const validSbi = Math.max(0, Number(sbi) || 0);
    const rule = FRAIS_PRO_RULES.find(
      r => validSbi <= r.maxSalary
    ) || FRAIS_PRO_RULES[FRAIS_PRO_RULES.length - 1];

    const amount = Math.min(
      validSbi * rule.rate,
      rule.cap
    );

    return {
      rate: rule.rate,
      cap: rule.cap,
      amount: Number(amount.toFixed(2))
    };
  }
}

export const calculateFraisProfessionnels = (sbi) => {
  return FraisProfessionnelsCalculator.calculate(sbi);
};
import { IR_RULES } from "../rules/ir.rules.js";

export const calculateIR = (sni) => {
  if (
    typeof sni !== "number" ||
    Number.isNaN(sni) ||
    sni < 0
  ) {
    throw new Error(
      "SNI invalide : doit être un nombre positif"
    );
  }

  const tranche = IR_RULES.find(
    rule => sni >= rule.min && sni <= rule.max
  );

  if (!tranche) {
    throw new Error(
      `Aucune tranche trouvée pour SNI = ${sni}`
    );
  }

  const irBrut = sni * tranche.taux;

  const irNet = Math.max(
    0,
    irBrut - tranche.deduction
  );

  return {
    taux: tranche.taux,
    sommeADeduire: tranche.deduction,
    irBrut: Number(irBrut.toFixed(2)),
    irNet: Number(irNet.toFixed(2))
  };
};
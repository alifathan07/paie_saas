import { CNSS_RULES } from "../rules/cnss.rules.js";

export const calculateCNSSSalariale = (sbi) => {
  const base = Math.min(
    sbi,
    CNSS_RULES.plafondMensuel
  );

  return base * CNSS_RULES.salariale.taux;
};

export const calculateCNSSPatronale = (sbi) => {
  const basePlafonnee = Math.min(
    sbi,
    CNSS_RULES.plafondMensuel
  );

  const prestationsSociales =
    basePlafonnee *
    CNSS_RULES.patronale.prestationsSociales;

  const allocationsFamiliales =
    sbi *
    CNSS_RULES.patronale.allocationsFamiliales;

  const formationProfessionnelle =
    sbi *
    CNSS_RULES.patronale.formationProfessionnelle;

  return {
    prestationsSociales,
    allocationsFamiliales,
    formationProfessionnelle,
    total:
      prestationsSociales +
      allocationsFamiliales +
      formationProfessionnelle
  };
};
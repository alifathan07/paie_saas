import { AMO_RULES } from "../rules/amo.rules.js";

export const calculateAMOSalariale = (sbi) => {
  return sbi * AMO_RULES.salariale;
};

export const calculateAMOPatronale = (sbi) => {
  return sbi * AMO_RULES.patronale;
};
import { calculatePayroll } from "../PayrollEngine.js";
import { calculateCNSSPatronale } from "../calculators/cnss.calculator.js";

export const calculateEtatCNSS = (employeesList) => {
  if (
    !Array.isArray(employeesList) ||
    employeesList.length === 0
  ) {
    return {
      rows: [],
      totals: {}
    };
  }

  const roundMoney = value =>
    Number(value.toFixed(2));

  let totals = {
    sansLimitePlafonne: 0,
    dansLimitePlafonne: 0,
    retenuSalSalariale: 0,
    allocFamPatronale: 0,
    prestPatPatronale: 0,
    formatProfPatronale: 0,
    totalPatronale: 0,
    cotisTot: 0
  };

  const rows = employeesList.map(employee => {
    const payslip = employee.payslip || employee.payslips?.[0] || {};
    const workedDays = employee.workedDays ?? payslip.workedDays;
    const workedHours = employee.workedHours ?? payslip.workedHours;
    const payroll =
      calculatePayroll(employee, { workedDays, workedHours });

    const sbi =
      roundMoney(payroll.sbi);

    const sbiPlafonne =
      roundMoney(Math.min(sbi, 6000));

    const patronal =
      calculateCNSSPatronale(sbi);

    const totalSalarial =
      roundMoney(payroll.cnss);

    const totalPatronal =
      roundMoney(patronal.total);

    const cotisTot =
      roundMoney(
        totalSalarial +
        totalPatronal
      );

    totals.sansLimitePlafonne += sbi;
    totals.dansLimitePlafonne += sbiPlafonne;
    totals.retenuSalSalariale += totalSalarial;
    totals.allocFamPatronale +=
      patronal.allocationsFamiliales;
    totals.prestPatPatronale +=
      patronal.prestationsSociales;
    totals.formatProfPatronale +=
      patronal.formationProfessionnelle;
    totals.totalPatronale += totalPatronal;
    totals.cotisTot += cotisTot;

    return {
      mle: String(
        employee.mle ||
        employee.id
      ).padStart(4, "0"),

      nomPrenom:
        payroll.employeeName,

      cin:
        employee.cin || "XX000000",

      nCnss:
        employee.cnssNumber || "000000000",

      jours: payroll.workedDays,

      sansLimitePlafonne: sbi,

      dansLimitePlafonne:
        sbiPlafonne,

      retenuSalSalariale:
        totalSalarial,

      allocFamPatronale:
        roundMoney(
          patronal.allocationsFamiliales
        ),

      prestPatPatronale:
        roundMoney(
          patronal.prestationsSociales
        ),

      formatProfPatronale:
        roundMoney(
          patronal.formationProfessionnelle
        ),

      totalPatronale:
        totalPatronal,

      cotisTot
    };
  });

  // Final rounding
  for (const key in totals) {
    totals[key] =
      roundMoney(totals[key]);
  }

  return {
    metadata: {
      totalEffectif:
        employeesList.length
    },

    rows,

    totals
  };
};

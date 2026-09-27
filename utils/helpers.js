// export const getAncienneteRate = (months) => {
//   let rate;

//   if (months >= 24 && months < 60) {
//     rate = 0.05;
//   } else if (months >= 60 && months < 144) {
//     rate = 0.10;
//   } else if (months >= 144 && months <= 240) {
//     rate = 0.15;
//   } else if (months > 240) {
//     rate = 0.20;
//   } else {
//     rate = 0;
//   }

//   return rate;
// };
// export const calculate_CNSS_Salariale = (sbi) => {
//     const sbiPlafonne = Math.min(sbi, 6000);
//     const prelevement = sbiPlafonne * 0.0448;
//     return prelevement;

// };


// export const calculate_CNSS_Patronalle = (sbi) => {
//     const sbiPlafonne = Math.min(sbi, 6000);
//     const prestationsSociales = sbiPlafonne * 0.0898;

//     const allocationsFamiliales = sbi * 0.0640; // 6.40%
//     const amo = sbi * 0.0411;                   // 4.11%
//     const formationProfessionnelle = sbi * 0.0160; // 1.60%

//     const totalPatronal = prestationsSociales + allocationsFamiliales + amo + formationProfessionnelle;
    
//     return totalPatronal;
// };

// export const calculate_AMO_Salariale = (sbi) => {
//     const amo = sbi * 0.0226;
//     return amo;

// }; 
// export const fraisProRateCalcule = (sbi) => {
//     let rate;
//     let cap;

//     if (sbi <= 6500) {
//         rate = 0.35;
//         cap = 2500;
        
//     } else {
//         rate = 0.25;
//         cap = 2916.67;
//     }
//     return { rate, cap };
// };

// export function calculerIR(sni) {
//   if (typeof sni !== 'number' || isNaN(sni) || sni < 0) {
//     throw new Error('SNI invemployeede: doit être un nombre positif');
//   }

//   const bareme = [
//     { min: 0,        max: 3333.33,   taux: 0.00, deduction: 0.00 },
//     { min: 3333.34,  max: 5000.00,   taux: 0.10, deduction: 333.33 },
//     { min: 5000.01,  max: 6666.67,   taux: 0.20, deduction: 833.33 },
//     { min: 6666.68,  max: 8333.33,   taux: 0.30, deduction: 1500.00 },
//     { min: 8333.34,  max: 15000.00,  taux: 0.34, deduction: 1833.33 },
//     { min: 15000.01, max: Infinity,  taux: 0.37, deduction: 2283.33 },
//   ];

//   const tranche = bareme.find(t => sni >= t.min && sni <= t.max);

//   if (!tranche) {
//     throw new Error(`Aucune tranche trouvée pour SNI = ${sni}`);
//   }

//   const irBrut = sni * tranche.taux;
//   const irNet = Math.max(0, irBrut - tranche.deduction);

//   return {
//     taux: tranche.taux,
//     sommeADeduire: tranche.deduction,
//     irBrut: parseFloat(irBrut.toFixed(2)),
//     irNet: parseFloat(irNet.toFixed(2)),
//   };
// }

// const calculateMounths = (dateEmbauche) => {
//   const today = new Date();
//   const start = new Date(dateEmbauche);
//   const yearsDiff = today.getFullYear() - start.getFullYear();
//   const monthsDiff = today.getMonth() - start.getMonth();
//   let mounths = yearsDiff * 12 + monthsDiff;
//   if (today.getDate() < start.getDate()) {
//      mounths--
//   }
//   return mounths;
// };
// export const calculatePayrollBultin = (employee) => {
//     const employeeId = employee.id;
//     const employeeName = employee.name;
//     const baseSalary = employee.baseSalary;
//     const mounths = calculateMounths(employee.dateEmbauche)
//     const primeAnciennete =
//         getAncienneteRate(mounths) * baseSalary;

//     const { bonusesIMP, bonusesNIMP } = employee.bonuses.reduce(
//         (total, bonus) => {
//             if (bonus.taxable) {
//                 total.bonusesIMP += bonus.amount;
//             } else {
//                 total.bonusesNIMP += bonus.amount;
//             }

//             return total;
//         },
//         { bonusesIMP: 0, bonusesNIMP: 0 }
//     );

//     const sbg = baseSalary + primeAnciennete + bonusesIMP + bonusesNIMP;

//     const sbi = sbg - bonusesNIMP;

//     const cnss = calculate_CNSS_Salariale(sbi);
//     const amo = calculate_AMO_Salariale(sbi);

//     const { rate, cap } = fraisProRateCalcule(sbi);

//     const fraisProRate = rate;
//     const fraisPro = Math.min(sbi * fraisProRate, cap);

//     const sni = sbi - cnss - amo - fraisPro;

//     const { irNet, taux } = calculerIR(sni);

//     const chargesDeFamille = Math.min(employee.dependents, 6) * 50;

//     const iR = Math.max(0, irNet - chargesDeFamille);

//     const netAPayer = sbg - cnss - amo - iR;
//     return {
//         employeeId,
//         employeeName,
//         baseSalary,
//         primeAnciennete,
//         bonusesIMP,
//         bonusesNIMP,
//         sbg,
//         sbi,
//         cnss,
//         amo,
//         fraisProRate,
//         fraisPro,
//         sni,
//         chargesDeFamille,
//         iR,
//         netAPayer
//     };




// };
// // ==========================================
// // 1. REPORT ENGINE: INTERNAL ÉTAT CNSS
// // ==========================================
// export const calculate_Etat_Cnss = (employeesList) => {
//   if (!Array.isArray(employeesList) || employeesList.length === 0) {
//     return { rows: [], totals: {} };
//   }

//   const roundMoney = value => Number(value.toFixed(2));

//   let grandTotalSansLimite = 0;
//   let grandTotalDansLimite = 0;
//   let grandTotalRetenuSal = 0;
//   let grandTotalAllocFam = 0;
//   let grandTotalPrestPat = 0;
//   let grandTotalFormatProf = 0;
//   let grandTotalChargesPat = 0;
//   let grandTotalCotisTot = 0;

//   const rows = employeesList.map(employee => {
//     const payroll = calculatePayrollBultin(employee);
//     const sbi = roundMoney(payroll.sbi);
//     const sbiPlafonne = roundMoney(Math.min(sbi, 6000)); // 6,000 MAD Ceiling

//     // Separate specific CNSS-only employer charges
//     const prestationsPatronale = roundMoney(sbiPlafonne * 0.0898);
//     const allocationsFamiliales = roundMoney(sbi * 0.0640); // Uncapped
//     const tfp = roundMoney(sbi * 0.0160);                   // Vocational Training Tax

//     const totalCnssPatronal = roundMoney(prestationsPatronale + allocationsFamiliales + tfp);
//     const totalCnssSalarial = roundMoney(payroll.cnss);

//     const mle = String(employee.mle || employee.id || payroll.employeeId).padStart(4, '0');
//     const cin = String(employee.cin || 'XX000000');
//     const nCnss = String(employee.cnssNumber || '000000000');
//     const jours = Math.min(employee.workedDays || 26, 26);
//     const cotisTot = roundMoney(totalCnssSalarial + totalCnssPatronal);

//     grandTotalSansLimite = roundMoney(grandTotalSansLimite + sbi);
//     grandTotalDansLimite = roundMoney(grandTotalDansLimite + sbiPlafonne);
//     grandTotalRetenuSal = roundMoney(grandTotalRetenuSal + totalCnssSalarial);
//     grandTotalAllocFam = roundMoney(grandTotalAllocFam + allocationsFamiliales);
//     grandTotalPrestPat = roundMoney(grandTotalPrestPat + prestationsPatronale);
//     grandTotalFormatProf = roundMoney(grandTotalFormatProf + tfp);
//     grandTotalChargesPat = roundMoney(grandTotalChargesPat + totalCnssPatronal);
//     grandTotalCotisTot = roundMoney(grandTotalCotisTot + cotisTot);

//     return {
//       mle,
//       nomPrenom: payroll.employeeName,
//       cin,
//       nCnss,
//       jours,
//       sansLimitePlafonne: sbi,
//       dansLimitePlafonne: sbiPlafonne,
//       retenuSalSalariale: totalCnssSalarial,
//       allocFamPatronale: allocationsFamiliales,
//       prestPatPatronale: prestationsPatronale,
//       formatProfPatronale: tfp,
//       totalPatronale: totalCnssPatronal,
//       cotisTot
//     };
//   });

//   const separator = '-'.repeat(140);
//   console.log('\n' + '='.repeat(140));
//   console.log('GENIE STRUCTURE                         E T A T   C N S S                         Date: 24/08/2026');
//   console.log(`Total effectif : ${employeesList.length}                                                            Page N° : 1`);
//   console.log('='.repeat(140));
//   console.log('MLE | NOM & PRENOM | CIN | N° CNSS | JOURS | SANS LIMITE PLAFONNE | DANS LIMITE PLAFONNE | RETENU SAL. 4.48 % (Part Salariale) | ALLOC. FAM. 6.40 % (Part Patronale) | PREST. PAT. 8.98 % (Part Patronale) | FORMAT. PROF. 1.60 % (Part Patronale) | TOTAL PATRONAL (Part Patronale) | COTIS.TOT');
//   console.log(separator);

//   rows.forEach(row => {
//     console.log(
//       `${row.mle} | ${row.nomPrenom} | ${row.cin} | ${row.nCnss} | ${row.jours} | ` +
//       `${row.sansLimitePlafonne.toFixed(2)} | ${row.dansLimitePlafonne.toFixed(2)} | ` +
//       `${row.retenuSalSalariale.toFixed(2)} | ${row.allocFamPatronale.toFixed(2)} | ` +
//       `${row.prestPatPatronale.toFixed(2)} | ${row.formatProfPatronale.toFixed(2)} | ` +
//       `${row.totalPatronale.toFixed(2)} | ${row.cotisTot.toFixed(2)}`
//     );
//   });

//   console.log(separator);
//   console.log(
//     `TOTAL | ${grandTotalSansLimite.toFixed(2)} | ${grandTotalDansLimite.toFixed(2)} | ` +
//     `${grandTotalRetenuSal.toFixed(2)} | ${grandTotalAllocFam.toFixed(2)} | ${grandTotalPrestPat.toFixed(2)} | ` +
//     `${grandTotalFormatProf.toFixed(2)} | ${grandTotalChargesPat.toFixed(2)} | ${grandTotalCotisTot.toFixed(2)}`
//   );
//   console.log('='.repeat(140) + '\n');

//   return {
//     metadata: { totalEffectif: employeesList.length },
//     rows,
//     totals: {
//       sansLimitePlafonne: grandTotalSansLimite,
//       dansLimitePlafonne: grandTotalDansLimite,
//       retenuSalSalariale: grandTotalRetenuSal,
//       allocFamPatronale: grandTotalAllocFam,
//       prestPatPatronale: grandTotalPrestPat,
//       formatProfPatronale: grandTotalFormatProf,
//       totalPatronale: grandTotalChargesPat,
//       cotisTot: grandTotalCotisTot
//     }
//   };
// };



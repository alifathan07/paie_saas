import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import { FraisProfessionnelsCalculator } from "./src/payroll-engine/calculators/fraisProfessionnels.calculator.js";

console.log("=======================================================================");
console.log("VERIFYING FRAIS PROFESSIONNELS: FISCAL ABATEMENT ONLY & NET À PAYER");
console.log("=======================================================================\n");

// 1. Direct unit test of the prompt's exact example: SBI = 10,650 DH
const employeeExample = {
    id: 99,
    nomComplet: "Test FraisPro",
    baseSalary: 10650,
    dateEmbauche: new Date("2026-01-01"), // 0 months seniority
    nbPersonacharge: 0,
    bonuses: []
};

const result = calculatePayroll(employeeExample, {
    baseSalary: 10650,
    dependents: 0,
    absenceDays: 0,
    heuresSup25: 0,
    heuresSup50: 0,
    heuresSup100: 0,
    avances: 0
});

console.log("--- 1. PROMPT EXAMPLE (SBI = 10 650 DH) ---");
console.log("SBG:                  ", result.sbg, "DH");
console.log("SBI:                  ", result.sbi, "DH");
console.log("CNSS (4.48% max 6000):", result.cnss, "DH");
console.log("AMO (2.26%):          ", result.amo, "DH");
console.log("Frais Pro (25%):      ", result.fraisPro, "DH  (Internal fiscal abatement ONLY)");
console.log("SNI:                  ", result.sni, "DH  (SBI - CNSS - AMO - FraisPro)");
console.log("IR Brut:              ", result.irBrut, "DH");
console.log("IR Net:               ", result.irNet, "DH");
console.log("Net à Payer:          ", result.netAPayer, "DH\n");

// Assertions for prompt example
console.assert(result.sbi === 10650, `SBI should be 10650, got ${result.sbi}`);
console.assert(result.cnss === 268.80, `CNSS should be 268.80, got ${result.cnss}`);
console.assert(result.amo === 240.69, `AMO should be 240.69, got ${result.amo}`);
console.assert(result.fraisPro === 2662.50, `Frais Pro should be 2662.50, got ${result.fraisPro}`);
console.assert(result.sni === 7478.01, `SNI should be 7478.01, got ${result.sni}`);
console.assert(result.irNet === 743.40, `IR Net should be 743.40, got ${result.irNet}`);

// Check that Net à Payer is SBG - CNSS - AMO - IR Net = 10650 - 268.80 - 240.69 - 743.40 = 9397.11 DH
const expectedNet = Number((10650 - 268.80 - 240.69 - 743.40).toFixed(2));
console.assert(result.netAPayer === expectedNet, `Net à Payer must be ${expectedNet}, got ${result.netAPayer}`);

// Check that Net à Payer does NOT subtract Frais Pro
const badNet = Number((10650 - 268.80 - 240.69 - 2662.50 - 743.40).toFixed(2));
console.assert(result.netAPayer !== badNet, "Net à Payer must NEVER subtract Frais Pro!");

console.log("✅ Check 1 Passed: Frais Pro is 2 662.50 DH, SNI is 7 478.01 DH, and Net à Payer is 9 397.11 DH (Frais Pro NOT subtracted from cash net).");

// 2. Test dedicated FraisProfessionnelsCalculator class
console.log("\n--- 2. DEDICATED FraisProfessionnelsCalculator SERVICE ---");
const calcStandard = FraisProfessionnelsCalculator.calculate(5000);
console.log("5000 DH SBI ->", calcStandard);
console.assert(calcStandard.rate === 0.35, "Standard tier must be 35%");
console.assert(calcStandard.amount === 1750, "35% of 5000 must be 1750");

const calcHighCapped = FraisProfessionnelsCalculator.calculate(20000);
console.log("20000 DH SBI ->", calcHighCapped);
console.assert(calcHighCapped.rate === 0.25, "High tier must be 25%");
console.assert(calcHighCapped.amount === 2916.67, "Must cap at 2916.67 DH");

console.log("\n=======================================================================");
console.log("✅ ALL FRAIS PROFESSIONNELS FISCAL ABATEMENT VERIFICATIONS PASSED!");
console.log("=======================================================================");

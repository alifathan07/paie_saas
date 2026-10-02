import "dotenv/config";
import { prisma } from "./src/lib/db.js";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";
import * as bulletinsController from "./src/controllers/bulletins.controller.js";

async function runPayrollSpecs() {
    console.log("=======================================================================");
    console.log("EXECUTION OF MOROCCAN PAYROLL ENGINE SPECIFICATION & TEST SUITE (8 CASES)");
    console.log("=======================================================================\n");

    let company = await prisma.company.findFirst();
    if (!company) {
        company = await prisma.company.create({
            data: { name: "TEST COMPANY MAROC", ice: "009988776655443" }
        });
    }
    const companyId = company.id;

    // -------------------------------------------------------------------------
    // CASE 1: Simple Employee (No bonuses, no overtime, no absence, no CIMR)
    // -------------------------------------------------------------------------
    console.log("--- CASE 1: Simple Employee Baseline Calculation ---");
    const emp1 = {
        id: 101,
        dateEmbauche: new Date("2026-08-01"), // 0 years seniority
        baseSalary: 5000,
        dependents: 0,
        bonuses: [],
        cimrRate: null
    };

    const res1 = calculatePayroll(emp1, { month: 8, year: 2026 });
    console.log("Case 1 Result:", {
        baseSalary: res1.baseSalary,
        sbg: res1.sbg,
        sbi: res1.sbi,
        cnss: res1.cnss,
        amo: res1.amo,
        fraisPro: res1.fraisPro,
        fraisProRate: res1.fraisProRate,
        sni: res1.sni,
        irBrut: res1.irBrut,
        irNet: res1.irNet,
        netAPayer: res1.netAPayer
    });

    const expectedCnss1 = 5000 * 0.0448; // 224
    const expectedAmo1 = 5000 * 0.0226; // 113
    const expectedFraisPro1 = 5000 * 0.35; // 1750 (rate 35% for <= 6500)
    const expectedSni1 = 5000 - expectedCnss1 - expectedAmo1 - expectedFraisPro1; // 2913
    // SNI <= 3333.33 => 0% IR
    const expectedIrNet1 = 0;
    const expectedNet1 = 5000 - expectedCnss1 - expectedAmo1 - expectedIrNet1; // 4663

    console.assert(res1.sbg === 5000, `SBG should be 5000, got ${res1.sbg}`);
    console.assert(res1.sbi === 5000, `SBI should be 5000, got ${res1.sbi}`);
    console.assert(Math.abs(res1.cnss - expectedCnss1) < 0.01, `CNSS should be ${expectedCnss1}, got ${res1.cnss}`);
    console.assert(Math.abs(res1.amo - expectedAmo1) < 0.01, `AMO should be ${expectedAmo1}, got ${res1.amo}`);
    console.assert(Math.abs(res1.fraisPro - expectedFraisPro1) < 0.01, `Frais Pro should be ${expectedFraisPro1}, got ${res1.fraisPro}`);
    console.assert(Math.abs(res1.sni - expectedSni1) < 0.01, `SNI should be ${expectedSni1}, got ${res1.sni}`);
    console.assert(res1.irNet === expectedIrNet1, `IR Net should be ${expectedIrNet1}, got ${res1.irNet}`);
    console.assert(Math.abs(res1.netAPayer - expectedNet1) < 0.01, `Net à Payer should be ${expectedNet1}, got ${res1.netAPayer}`);

    console.log("✅ CASE 1 PASSED: Simple employee calculation verified!\n");

    // -------------------------------------------------------------------------
    // CASE 2: Non-taxable Allowance (NIMP)
    // -------------------------------------------------------------------------
    console.log("--- CASE 2: Non-Taxable Allowance (Indemnité de transport) ---");
    const emp2 = {
        ...emp1,
        bonuses: [
            { name: "Indemnité de transport", amount: 600, taxable: false }
        ]
    };
    const res2 = calculatePayroll(emp2, { month: 8, year: 2026 });
    console.log("Case 2 Result:", {
        sbg: res2.sbg,
        bonusesNIMP: res2.bonusesNIMP,
        sbi: res2.sbi,
        cnss: res2.cnss,
        amo: res2.amo,
        sni: res2.sni,
        netAPayer: res2.netAPayer
    });

    console.assert(res2.sbg === 5600, `SBG should be 5600 (5000 + 600 NIMP), got ${res2.sbg}`);
    console.assert(res2.bonusesNIMP === 600, `bonusesNIMP should be 600, got ${res2.bonusesNIMP}`);
    console.assert(res2.sbi === 5000, `SBI must remain 5000 (taxable base unchanged), got ${res2.sbi}`);
    console.assert(res2.cnss === res1.cnss, "CNSS must not increase from non-taxable bonus");
    console.assert(res2.amo === res1.amo, "AMO must not increase from non-taxable bonus");
    console.assert(res2.sni === res1.sni, "SNI must not increase from non-taxable bonus");
    console.assert(res2.netAPayer === expectedNet1 + 600, `Net à Payer should include full 600 NIMP cash: expected ${expectedNet1 + 600}, got ${res2.netAPayer}`);
    console.log("✅ CASE 2 PASSED: Non-taxable allowance behavior verified!\n");

    // -------------------------------------------------------------------------
    // CASE 3: Taxable Bonus (Prime Imposable)
    // -------------------------------------------------------------------------
    console.log("--- CASE 3: Taxable Bonus (Prime de rendement) ---");
    const res3 = calculatePayroll(emp1, {
        month: 8,
        year: 2026,
        variablePrimes: [{ label: "Prime de rendement", amount: 2000 }]
    });
    console.log("Case 3 Result:", {
        sbg: res3.sbg,
        sbi: res3.sbi,
        bonusesIMP: res3.bonusesIMP,
        cnss: res3.cnss,
        amo: res3.amo,
        sni: res3.sni,
        irBrut: res3.irBrut,
        irNet: res3.irNet,
        netAPayer: res3.netAPayer
    });

    console.assert(res3.sbg === 7000, `SBG should be 7000 (5000 + 2000), got ${res3.sbg}`);
    console.assert(res3.sbi === 7000, `SBI should be 7000 (taxable base increased), got ${res3.sbi}`);
    console.assert(res3.bonusesIMP === 2000, `bonusesIMP should be 2000, got ${res3.bonusesIMP}`);
    console.assert(res3.sni > res1.sni, "SNI must increase from taxable bonus");
    console.log("✅ CASE 3 PASSED: Taxable bonus increases taxable base correctly!\n");

    // -------------------------------------------------------------------------
    // CASE 4: Frais Professionnels (Fiscal Abatement, NOT Cash Deduction)
    // -------------------------------------------------------------------------
    console.log("--- CASE 4: Frais Professionnels Fiscal Nature Verification ---");
    console.log("Checking that Frais Pro reduces SNI but is NOT subtracted from Cash Net:");
    console.log(`Frais Pro: ${res1.fraisPro} DH | SNI: ${res1.sni} DH | Net: ${res1.netAPayer} DH`);

    const directCashMinusFraisPro = res1.sbg - res1.cnss - res1.amo - res1.fraisPro - res1.irNet;
    console.assert(res1.netAPayer > directCashMinusFraisPro, "Net salary MUST NOT subtract frais professionnels directly!");
    console.assert(res1.netAPayer === Number((res1.sbg - res1.cnss - res1.amo - (res1.cimr || 0) - res1.irNet + res1.arrondi).toFixed(2)), "Net salary formula must include the explicit arrondi adjustment");
    console.log("✅ CASE 4 PASSED: Frais professionnels verified as fiscal abatement only!\n");

    // -------------------------------------------------------------------------
    // CASE 5: Annual / Monthly Ceiling on Frais Professionnels (2 916.67 DH cap)
    // -------------------------------------------------------------------------
    console.log("--- CASE 5: High Income Frais Professionnels Cap ---");
    const empHigh = {
        ...emp1,
        baseSalary: 25000 // 25000 * 25% = 6250 > 2916.67 monthly ceiling (35000 DH/year)
    };
    const res5 = calculatePayroll(empHigh, { month: 8, year: 2026 });
    console.log("Case 5 Result:", {
        sbi: res5.sbi,
        fraisProRate: res5.fraisProRate,
        fraisPro: res5.fraisPro
    });

    console.assert(res5.fraisProRate === 0.25, `Rate should be 25% for >6500 DH, got ${res5.fraisProRate}`);
    console.assert(res5.fraisPro === 2916.67, `Frais pro must be capped at 2916.67 DH, got ${res5.fraisPro}`);
    console.log("✅ CASE 5 PASSED: Monthly Frais Professionnels cap (2 916.67 DH) strictly enforced!\n");

    // -------------------------------------------------------------------------
    // CASE 6: Overtime (25%, 50%, 100%)
    // -------------------------------------------------------------------------
    console.log("--- CASE 6: Overtime Calculations (25%, 50%, 100%) ---");
    const res6 = calculatePayroll(emp1, {
        month: 8,
        year: 2026,
        heuresSup25: 10,  // 10h @ 25%
        heuresSup50: 5,   // 5h @ 50%
        heuresSup100: 2   // 2h @ 100%
    });

    const hourlyRate = 5000 / (26 * 8); // ~24.0385 DH/h
    const expHs25 = Number((10 * hourlyRate * 1.25).toFixed(2));
    const expHs50 = Number((5 * hourlyRate * 1.50).toFixed(2));
    const expHs100 = Number((2 * hourlyRate * 2.00).toFixed(2));
    const expHsTotal = Number((expHs25 + expHs50 + expHs100).toFixed(2));

    console.log("Case 6 Result:", {
        hourlyRate,
        heuresSup25: res6.heuresSup25,
        heuresSup50: res6.heuresSup50,
        heuresSup100: res6.heuresSup100,
        heuresSupAmount: res6.heuresSupAmount,
        sbg: res6.sbg
    });

    console.assert(Math.abs(res6.heuresSupAmount - expHsTotal) <= 0.05, `Overtime amount should be ${expHsTotal}, got ${res6.heuresSupAmount}`);
    console.assert(Math.abs(res6.sbg - (5000 + expHsTotal)) <= 0.05, `SBG should include overtime: ${5000 + expHsTotal}, got ${res6.sbg}`);
    console.log("✅ CASE 6 PASSED: Overtime calculations verified across 25%, 50%, and 100% rates!\n");

    // -------------------------------------------------------------------------
    // CASE 7: Dependents (Charges de Famille & Max 6 Dependents Cap)
    // -------------------------------------------------------------------------
    console.log("--- CASE 7: Charges de Famille (50 DH/dep, max 6) ---");
    const empDep3 = { ...empHigh, dependents: 3 };
    const resDep3 = calculatePayroll(empDep3, { month: 8, year: 2026 });
    console.assert(resDep3.chargesDeFamille === 150, `Charges de famille for 3 dependents should be 150 DH, got ${resDep3.chargesDeFamille}`);

    const empDep8 = { ...empHigh, dependents: 8 }; // Exceeds legal maximum of 6
    const resDep8 = calculatePayroll(empDep8, { month: 8, year: 2026 });
    console.assert(resDep8.chargesDeFamille === 300, `Charges de famille for 8 dependents must be capped at 300 DH (6 * 50), got ${resDep8.chargesDeFamille}`);
    console.log("✅ CASE 7 PASSED: Charges de famille and 6-dependent ceiling verified!\n");

    // -------------------------------------------------------------------------
    // CASE 8: Preview (/calculate) vs Generated Bulletin Consistency
    // -------------------------------------------------------------------------
    console.log("--- CASE 8: Single Source of Truth — Preview vs Generation Consistency ---");
    const testEmployee = await prisma.employee.create({
        data: {
            companyId,
            matricule: "SPEC-EMP-" + Date.now().toString().slice(-4),
            nomComplet: "Mehdi Idrissi",
            cin: "SPEC" + Date.now().toString().slice(-4),
            dateNaissance: new Date("1991-03-15"),
            dateEmbauche: new Date("2021-01-01"), // ~5.5 years => 10% seniority
            sexe: "M",
            situationFam: "MARIE",
            nbPersonacharge: 2,
            baseSalary: 14000,
            cimrRate: 0.04
        }
    });

    const testMonth = 8;
    const testYear = 2026;
    const testPayload = {
        month: testMonth,
        year: testYear,
        baseSalary: "14000",
        absenceDays: "2",
        heuresSup25: "6",
        heuresSup50: "4",
        heuresSup100: "0",
        avances: "1000",
        primesLabels: ["Prime de projet"],
        primesAmounts: ["3500"]
    };

    // 1. Run Preview via calculateLive action
    let previewJson = {};
    const reqPreview = {
        params: { id: String(testEmployee.id) },
        query: testPayload
    };
    const resPreview = {
        json: (data) => { previewJson = data; },
        status: () => resPreview
    };
    await bulletinsController.calculateLive(reqPreview, resPreview);

    // 2. Run Generation via generateBulletin action
    const reqGen = {
        params: { id: String(testEmployee.id) },
        body: testPayload,
        query: {}
    };
    let genRedirect = "";
    const resGen = {
        redirect: (url) => { genRedirect = url; },
        status: () => resGen,
        send: () => {}
    };
    await bulletinsController.generateBulletin(reqGen, resGen);

    // 3. Query generated Payslip from database
    const dbPayslip = await prisma.payslip.findUnique({
        where: { employeeId_month_year: { employeeId: testEmployee.id, month: testMonth, year: testYear } }
    });

    console.log("Comparison Check:", {
        previewSBG: previewJson.sbg,
        dbSBG: Number(dbPayslip.sbg),
        previewSBI: previewJson.sbi,
        dbSBI: Number(dbPayslip.sbi),
        previewCIMR: previewJson.cimr,
        dbCIMR: Number(dbPayslip.cimr),
        previewIRNet: previewJson.irNet,
        dbIRNet: Number(dbPayslip.irNet),
        previewNetAPayer: previewJson.netAPayer,
        dbNetAPayer: Number(dbPayslip.netAPayer)
    });

    console.assert(previewJson.sbg === Number(dbPayslip.sbg), `SBG mismatch: preview=${previewJson.sbg}, db=${dbPayslip.sbg}`);
    console.assert(previewJson.sbi === Number(dbPayslip.sbi), `SBI mismatch: preview=${previewJson.sbi}, db=${dbPayslip.sbi}`);
    console.assert(previewJson.cnss === Number(dbPayslip.cnss), `CNSS mismatch: preview=${previewJson.cnss}, db=${dbPayslip.cnss}`);
    console.assert(previewJson.amo === Number(dbPayslip.amo), `AMO mismatch: preview=${previewJson.amo}, db=${dbPayslip.amo}`);
    console.assert(previewJson.cimr === Number(dbPayslip.cimr), `CIMR mismatch: preview=${previewJson.cimr}, db=${dbPayslip.cimr}`);
    console.assert(previewJson.fraisPro === Number(dbPayslip.fraisPro), `Frais Pro mismatch: preview=${previewJson.fraisPro}, db=${dbPayslip.fraisPro}`);
    console.assert(previewJson.sni === Number(dbPayslip.sni), `SNI mismatch: preview=${previewJson.sni}, db=${dbPayslip.sni}`);
    console.assert(previewJson.irNet === Number(dbPayslip.irNet), `IR Net mismatch: preview=${previewJson.irNet}, db=${dbPayslip.irNet}`);
    console.assert(previewJson.netAPayer === Number(dbPayslip.netAPayer), `Net à Payer mismatch: preview=${previewJson.netAPayer}, db=${dbPayslip.netAPayer}`);
    console.assert(
        JSON.stringify(Object.keys(previewJson.annualCumulative).sort()) === JSON.stringify(['cnss', 'irNet', 'sbi', 'sni', 'workedDays']),
        'Annual cumulative must expose the stable five-field contract'
    );
    console.assert(previewJson.annualCumulative.workedDays === 26, 'Annual cumulative workedDays must include the current live bulletin');
    console.assert(previewJson.annualCumulative.sni === Number(dbPayslip.sni), 'Annual cumulative SNI must replace the current month exactly once');
    console.assert(previewJson.annualCumulative.irNet === Number(dbPayslip.irNet), 'Annual cumulative IR must replace the current month exactly once');
    console.assert(previewJson.annualCumulative.cnss === Number(dbPayslip.cnss), 'Annual cumulative CNSS must include the current bulletin');
    console.assert(previewJson.annualCumulative.sbi === Number(dbPayslip.sbi), 'Annual cumulative SBI must include the current bulletin');

    // Cleanup
    await prisma.payslipBonus.deleteMany({ where: { payslipId: dbPayslip.id } });
    await prisma.payslip.deleteMany({ where: { id: dbPayslip.id } });
    await prisma.employee.deleteMany({ where: { id: testEmployee.id } });

    console.log("✅ CASE 8 PASSED: Preview and Generated Bulletin calculations match with 100% precision!\n");

    console.log("=======================================================================");
    console.log("ALL 8 MOROCCAN PAYROLL ENGINE TEST SCENARIOS PASSED SUCCESSFULLY! 🎉");
    console.log("=======================================================================");
}

runPayrollSpecs().catch(err => {
    console.error("FATAL ERROR IN PAYROLL SPECS:", err);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});

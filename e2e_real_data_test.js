import "dotenv/config";
import { prisma } from "./src/lib/db.js";
import * as bulletinsController from "./src/controllers/bulletins.controller.js";

async function main() {
    console.log("=================================================================");
    console.log("RUNNING END-TO-END REAL DATA VALIDATION FOR BULLETINS MODULE");
    console.log("=================================================================\n");

    // 1. Setup Company
    let company = await prisma.company.findFirst();
    if (!company) {
        company = await prisma.company.create({
            data: { name: "CONFONDA REAL MAROC", ice: "001122334455667" }
        });
    }
    const companyId = company.id;

    // 2. Setup Non-Taxable Bonus Catalog for Company
    let bonusDef = await prisma.bonus.findFirst({
        where: { companyId, name: "Indemnité de transport" }
    });
    if (!bonusDef) {
        bonusDef = await prisma.bonus.create({
            data: { companyId, name: "Indemnité de transport", taxable: false }
        });
    }

    // 3. Create Real Employee with CIMR rate (e.g. 6%) & non-taxable bonus in profile
    const matricule = "EMP-REAL-" + Date.now().toString().slice(-4);
    const emp = await prisma.employee.create({
        data: {
            companyId,
            matricule,
            nomComplet: "Anas Test",
            cin: "BK" + Date.now().toString().slice(-5),
            dateNaissance: new Date("1989-04-12"),
            dateEmbauche: new Date(), // Today = 0 seniority years for crisp calculation
            sexe: "M",
            situationFam: "MARIE",
            nbPersonacharge: 2,
            nbEnfantCharge: 2,
            baseSalary: 12000,
            cimrRate: 0.06, // 6% CIMR
            cimrReduitBaseImposable: false,
            bonuses: {
                create: [
                    { bonusId: bonusDef.id, amount: 650 } // 650 DH transport
                ]
            }
        },
        include: {
            bonuses: { include: { bonus: true } }
        }
    });

    console.log(`✅ Created real employee in database: ${emp.nomComplet} (${emp.matricule})`);
    console.log(`   Base Salary: ${emp.baseSalary} DH | CIMR Rate: ${emp.cimrRate * 100}% | Profile Bonus: ${emp.bonuses[0].bonus.name} (${emp.bonuses[0].amount} DH)`);

    const month = 8;
    const year = 2026;

    // 4. Test Single Generate with Variable Elements + Prime Imposable
    console.log("\n--- Step 1: Generate Bulletin with Overtime & Prime Imposable ---");
    const reqGen = {
        params: { id: String(emp.id) },
        body: {
            month,
            year,
            baseSalary: "12000",
            absenceDays: "1",      // 1 day absence => deduction = 12000/26 = 461.54 DH
            heuresSup25: "8",      // 8h @ 25%
            heuresSup50: "0",
            heuresSup100: "0",
            avances: "500",
            primesLabels: ["Prime d'expertise"],
            primesAmounts: ["2000"] // 2000 DH imposable bonus
        },
        query: {},
        session: { user: { id: 1, companyId } }
    };

    let redirectUrl = "";
    const resGen = {
        redirect: (url) => { redirectUrl = url; }
    };

    await bulletinsController.generateBulletin(reqGen, resGen);
    console.log("   Generate redirect:", redirectUrl);

    // 5. Query saved Payslip directly from database
    const savedPayslip = await prisma.payslip.findUnique({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        include: { bonuses: true }
    });

    console.log("\n--- Step 2: Verify Database Persistence ---");
    console.log("   Saved Payslip Status:", savedPayslip.status);
    console.log("   Saved Base Salary:", savedPayslip.baseSalary.toString());
    console.log("   Saved SBG:", savedPayslip.sbg.toString());
    console.log("   Saved SBI:", savedPayslip.sbi.toString());
    console.log("   Saved CNSS:", savedPayslip.cnss.toString());
    console.log("   Saved AMO:", savedPayslip.amo.toString());
    console.log("   Saved CIMR (6%):", savedPayslip.cimr.toString());
    console.log("   Saved Frais Pro:", savedPayslip.fraisPro.toString());
    console.log("   Saved SNI:", savedPayslip.sni.toString());
    console.log("   Saved IR Net:", savedPayslip.irNet.toString());
    console.log("   Saved Net à Payer:", savedPayslip.netAPayer.toString());
    console.log("   Saved PayslipBonus rows:", savedPayslip.bonuses.map(b => `${b.name} (${b.amount} DH, taxable: ${b.taxable})`));
    console.log("   Saved NIMP:", savedPayslip.bonusesNIMP.toString(), "| SNI cumulé:", savedPayslip.sniCumule.toString());

    console.assert(Number(savedPayslip.cimr) > 0, "CIMR must be > 0 in saved database record");
    const taxableBonus = savedPayslip.bonuses.find(b => b.taxable);
    const nimpBonus = savedPayslip.bonuses.find(b => !b.taxable);
    console.assert(Boolean(taxableBonus), "Must persist taxable variable prime");
    console.assert(taxableBonus.name === "Prime d'expertise", "Saved taxable bonus name must match");
    console.assert(Boolean(nimpBonus), "Must persist non-taxable profile bonus snapshot");
    console.assert(nimpBonus.name.toLowerCase() === "indemnité de transport", "Saved NIMP bonus name must match");

    // 6. Test Show View Rendering (Page 2 load)
    console.log("\n--- Step 3: Test Show View Load (Controller -> View Model) ---");
    let viewData = {};
    const resShow = {
        render: (view, data) => { viewData = data; }
    };
    await bulletinsController.showBulletin({ params: { id: String(emp.id) }, query: { month, year }, session: { user: { id: 1, companyId } } }, resShow);

    console.log("   View Model Status:", viewData.bulletin?.status);
    console.log("   View Model Net à Payer:", viewData.bulletin?.netAPayer);
    console.log("   View Model CIMR:", viewData.bulletin?.cimr);
    console.log("   View Model Variable Primes:", viewData.bulletin?.variablePrimes);
    console.log("   Annual cumulative:", viewData.annualCumulative);

    console.assert(viewData.bulletin.cimr === Number(savedPayslip.cimr), "View model CIMR must match database record");
    console.assert(viewData.bulletin.variablePrimes.length === 1, "View model must contain the saved prime");
    console.assert(viewData.annualCumulative.workedDays === savedPayslip.workedDays, "Annual cumulative must include the current bulletin once");
    console.assert(viewData.annualCumulative.sni === Number(savedPayslip.sni), "Annual cumulative SNI must match the current bulletin");

    const liveCumulative = await bulletinsController.getAnnualPayrollCumulative(emp.id, year, month, {
        workedDays: 20,
        sni: 100,
        irNet: 10,
        cnss: 5,
        sbi: 120,
    });
    console.assert(liveCumulative.workedDays === 20, "Live current month must replace, not double-count, the saved month");
    console.assert(liveCumulative.sni === 100, "Live current month SNI must replace the saved month");

    // 7. Test Validate Bulletin
    console.log("\n--- Step 4: Validate Bulletin ---");
    const reqVal = {
        params: { id: String(emp.id) },
        body: { month, year },
        session: { user: { id: 42, companyId } }
    };
    await bulletinsController.validateBulletin(reqVal, resGen);

    const validatedPayslip = await prisma.payslip.findUnique({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } }
    });
    console.log("   Validated Status:", validatedPayslip.status, "| ValidatedById:", validatedPayslip.validatedById);
    console.assert(validatedPayslip.status === "VALIDATED", "Status must be VALIDATED");
    console.assert(validatedPayslip.validatedById === 42, "ValidatedById must be recorded");

    // 8. Test Page 1 Listing
    console.log("\n--- Step 5: Test Page 1 Listing ---");
    let page1Data = {};
    const resList = {
        render: (view, data) => { page1Data = data; }
    };
    await bulletinsController.listBulletins({ query: { month, year }, session: { user: { companyId } } }, resList);
    const listedEmp = page1Data.employees.find(e => e.id === emp.id);
    console.log(`   Page 1 entry for ${listedEmp.nomComplet}: status=${listedEmp.bulletinStatus}, variablesEntered=${listedEmp.variablesEntered}, netAPayer=${listedEmp.bulletin?.netAPayer}`);
    console.assert(listedEmp.bulletinStatus === "validated", "Page 1 status must reflect VALIDATED");
    console.assert(listedEmp.variablesEntered === true, "Page 1 variablesEntered must be true");

    // 9. Clean up test record
    await prisma.payslipBonus.deleteMany({ where: { payslipId: savedPayslip.id } });
    await prisma.payslip.deleteMany({ where: { id: savedPayslip.id } });
    await prisma.employeeBonus.deleteMany({ where: { employeeId: emp.id } });
    await prisma.employee.deleteMany({ where: { id: emp.id } });

    console.log("\n=================================================================");
    console.log("ALL REAL DATA VALIDATION CHECKS COMPLETED SUCCESSFULLY! 🎉");
    console.log("=================================================================");
}

main().catch(err => {
    console.error("FATAL ERROR IN E2E REAL DATA TEST:", err);
    process.exit(1);
}).finally(async () => {
    await prisma.$disconnect();
});

import 'dotenv/config';
import { prisma } from "./src/lib/db.js";
import * as bulletinsController from "./src/controllers/bulletins.controller.js";
import { calculatePayroll } from "./src/payroll-engine/PayrollEngine.js";

async function runSystemSmokeTest() {
    console.log("=================================================================");
    console.log("FULL END-TO-END DATABASE & APPLICATION VERIFICATION");
    console.log("=================================================================");

    // 1. Ensure test company and employee exist
    const company = await prisma.company.upsert({
        where: { id: 1 },
        update: {},
        create: {
            name: "CONFONDA TECH SARL",
            ice: "001234567890001",
            ifNumber: "565653486",
            rc: "RC-CASABLANCA-12345"
        }
    });

    const matricule = "MAT-TEST-" + Math.floor(1000 + Math.random() * 9000);
    const cin = "AB" + Math.floor(100000 + Math.random() * 900000);
    const emp = await prisma.employee.create({
        data: {
            matricule,
            nom: "Alami",
            prenom: "Karim",
            cin,
            dateNaissance: new Date("1992-05-15"),
            sexe: "M",
            situationFam: "MARIE",
            nbPersonacharge: 3,
            nbEnfantCharge: 2,
            dateEmbauche: new Date("2021-01-01"), // > 5 years seniority => 10%
            baseSalary: 9500.00,
            modePaiement: "VIREMENT",
            numeroCNSS: "CNSS-" + Math.floor(1000000 + Math.random() * 9000000),
            companyId: company.id,
            actif: true,
            bonuses: {
                create: [
                    {
                        amount: 500.00,
                        bonus: {
                            create: {
                                companyId: company.id,
                                name: "Panier & Transport " + matricule,
                                taxable: false
                            }
                        }
                    }
                ]
            }
        },
        include: {
            bonuses: { include: { bonus: true } }
        }
    });

    console.log(`\n1. Employee created in DB: ${emp.nom} ${emp.prenom} (${emp.matricule})`);
    console.log(`   Base: ${emp.baseSalary} DH, Dependents: ${emp.nbPersonacharge}, Non-taxable bonus: 500 DH`);

    const month = 8;
    const year = 2026;

    // 2. Test Live Calculation API
    console.log("\n2. Testing Live Recalculation API (GET /bulletins/:id/calculate)...");
    let liveJson = null;
    const reqCalc = {
        params: { id: String(emp.id) },
        query: {
            month: String(month),
            year: String(year),
            baseSalary: "9500",
            dependents: "3",
            absenceDays: "0",
            heuresSup25: "4", // 4h @ 25%
            heuresSup50: "0",
            heuresSup100: "0",
            avances: "200",
            primesLabels: ["Prime de rendement"],
            primesAmounts: ["1500"]
        }
    };
    const resCalc = {
        json: (data) => { liveJson = data; },
        status: (code) => ({ json: (data) => { liveJson = { ...data, status: code }; } })
    };

    await bulletinsController.calculateLive(reqCalc, resCalc);
    console.log("   API Response ok:", liveJson.ok);
    console.log("   SBG:", liveJson.sbg, "DH (Base + Ancienneté 10% + Prime 1500 + Heures Sup + 500 NIMP)");
    console.log("   SBI:", liveJson.sbi, "DH");
    console.log("   CNSS:", liveJson.cnss, "DH | AMO:", liveJson.amo, "DH");
    console.log("   Frais Pro:", liveJson.fraisPro, "DH");
    console.log("   SNI:", liveJson.sni, "DH");
    console.log("   Somme à déduire:", liveJson.sommeADeduire, "DH");
    console.log("   IR Net:", liveJson.irNet, "DH (after 3 dependents deduction)");
    console.log("   Net à payer:", liveJson.netAPayer, "DH");

    console.assert(liveJson.ok === true, "Live calc must return ok=true");
    console.assert(liveJson.sommeADeduire > 0, "Somme à déduire must be calculated and returned");

    // 3. Test Generate Bulletin (POST /bulletins/:id/generate)
    console.log("\n3. Testing Bulletin Generation into Database (POST /bulletins/:id/generate)...");
    let redirectGen = "";
    const reqGen = {
        params: { id: String(emp.id) },
        body: {
            month,
            year,
            baseSalary: "9500",
            dependents: "3",
            absenceDays: "0",
            heuresSup25: "4",
            heuresSup50: "0",
            heuresSup100: "0",
            avances: "200",
            primesLabels: ["Prime de rendement"],
            primesAmounts: ["1500"]
        },
        query: {},
        session: { user: { id: 1, companyId: company.id } }
    };
    const resGen = {
        redirect: (url) => { redirectGen = url; }
    };

    await bulletinsController.generateBulletin(reqGen, resGen);
    console.log("   Redirect destination:", redirectGen);

    // 4. Verify Database Record
    const dbPayslip = await prisma.payslip.findUnique({
        where: { employeeId_month_year: { employeeId: emp.id, month, year } },
        include: { bonuses: true }
    });

    console.log("\n4. Verifying DB Record in `payslips` & `payslip_bonuses` tables...");
    console.log("   DB Payslip ID:", dbPayslip.id);
    console.log("   DB Status:", dbPayslip.status);
    console.log("   DB SBG:", dbPayslip.sbg.toString());
    console.log("   DB SBI:", dbPayslip.sbi.toString());
    console.log("   DB Somme à Déduire:", dbPayslip.sommeADeduire.toString());
    console.log("   DB IR Théorique:", dbPayslip.irTheorique.toString());
    console.log("   DB IR Net:", dbPayslip.irNet.toString());
    console.log("   DB Net à Payer:", dbPayslip.netAPayer.toString());
    console.log("   DB Bonuses Count:", dbPayslip.bonuses.length);

    console.assert(Number(dbPayslip.netAPayer) === liveJson.netAPayer, "DB Net à payer must match Live JSON Net à payer exactly");
    console.assert(Number(dbPayslip.sommeADeduire) === liveJson.sommeADeduire, "DB Somme à déduire must match Live JSON Somme à déduire exactly");

    // 5. Test Controller showBulletin (Page 2 ViewModel)
    console.log("\n5. Testing View Model Rendering (GET /bulletins/:id?month=8&year=2026)...");
    let showViewData = null;
    const resShow = {
        render: (view, data) => { showViewData = data; }
    };
    await bulletinsController.showBulletin({
        params: { id: String(emp.id) },
        query: { month, year },
        session: { user: { id: 1, companyId: company.id } }
    }, resShow);

    console.log("   View Model Loaded:", showViewData ? "YES" : "NO");
    console.log("   View Model Bulletin Status:", showViewData.bulletin.status);
    console.log("   View Model Somme à Déduire:", showViewData.bulletin.sommeADeduire);
    console.log("   View Model Primes:", showViewData.bulletin.variablePrimes);

    console.assert(showViewData.bulletin.sommeADeduire === liveJson.sommeADeduire, "View model sommeADeduire must match DB");

    // 6. Test Bulletin Validation (POST /bulletins/:id/validate)
    console.log("\n6. Testing Validation & Locking (POST /bulletins/:id/validate)...");
    let redirectVal = "";
    await bulletinsController.validateBulletin({
        params: { id: String(emp.id) },
        body: { month, year },
        session: { user: { id: 1, companyId: company.id } }
    }, { redirect: (url) => { redirectVal = url; } });

    const validatedPayslip = await prisma.payslip.findUnique({
        where: { id: dbPayslip.id }
    });
    console.log("   Updated Status in DB:", validatedPayslip.status);
    console.log("   Validated At:", validatedPayslip.validatedAt);
    console.assert(validatedPayslip.status === "VALIDATED", "Status in DB must be VALIDATED");

    // 7. Test Page 1 List (GET /bulletins?month=8&year=2026)
    console.log("\n7. Testing Page 1 Overview (GET /bulletins?month=8&year=2026)...");
    let indexViewData = null;
    await bulletinsController.listBulletins({
        query: { month, year },
        session: { user: { id: 1, companyId: company.id } }
    }, { render: (view, data) => { indexViewData = data; } });

    const empInList = indexViewData.employees.find(e => e.id === emp.id);
    console.log("   Employee found in listing:", empInList.nom, empInList.prenom);
    console.log("   Listing status:", empInList.bulletinStatus);
    console.log("   Listing variablesEntered:", empInList.variablesEntered);
    console.log("   Listing Net à payer:", empInList.bulletin.netAPayer);

    console.assert(empInList.bulletinStatus === "validated", "Listing must show validated status");
    console.assert(empInList.variablesEntered === true, "Listing must show variablesEntered=true");
    console.assert(empInList.bulletin.netAPayer === liveJson.netAPayer, "Listing Net à payer must match DB");

    console.log("\n=================================================================");
    console.log("✅ ALL REAL DATABASE CONNECTIVITY TESTS COMPLETED SUCCESSFULLY!");
    console.log("=================================================================");
}

runSystemSmokeTest()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error("Test failed:", err);
        process.exit(1);
    });

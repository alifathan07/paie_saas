import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "./src/lib/db.js";
import { createEmployee, updateEmployee } from "./src/services/employeeService.js";
import { saveEmployeeIndemnites, createIndemnite } from "./src/services/indemniteService.js";
import { generateBulletin } from "./src/controllers/bulletins.controller.js";

const month = 10;
const year = 2026;
const suffix = Date.now().toString();
let company;
let employee;

try {
    console.log("Creating test company and representation indemnity...");
    company = await prisma.company.create({
        data: {
            name: `Representation flow test ${suffix}`,
            ice: `REP${suffix}`.slice(0, 15),
            indemniteRepresentationRate: 0.10,
        },
    });

    const representation = await createIndemnite({
        companyId: company.id,
        name: "Indemnité de représentation",
        defaultAmount: 1,
    });

    console.log("Creating employee...");
    employee = await createEmployee({
        companyId: company.id,
        matricule: `REP-${suffix.slice(-8)}`,
        nomComplet: "Employé Test Représentation",
        cin: `REP-CIN-${suffix}`,
        dateNaissance: "1990-01-01",
        sexe: "M",
        // Keep seniority below the first bracket so the expected SBG isolates
        // the representation indemnity calculation.
        dateEmbauche: "2026-01-01",
        situationFam: "CELIBATAIRE",
        statut: "TITULAIRE",
        natureEmploi: "PERMANENT",
        modePaiement: "VIREMENT",
        baseSalary: 5000,
        actif: true,
        bonusList: [],
    });

    console.log("Assigning representation indemnity through the employee picker...");
    await saveEmployeeIndemnites(employee.id, company.id, [{
        bonusId: representation.id,
        amount: 1,
    }]);

    const assignedEmployee = await prisma.employee.findUnique({
        where: { id: employee.id },
        include: { company: true, bonuses: { include: { bonus: true } } },
    });
    assert.equal(assignedEmployee.indemniteRepresentationName, "Indemnité de représentation");
    assert.equal(Number(assignedEmployee.indemniteRepresentationRate), 0.10);
    assert.equal(assignedEmployee.bonuses.length, 0, "Representation must not be stored as a fixed amount bonus");

    console.log("Generating the bulletin...");
    let redirectUrl = "";
    await generateBulletin(
        {
            params: { id: String(employee.id) },
            body: { month, year, baseSalary: "5000" },
            query: {},
            session: { user: { activeCompanyId: company.id } },
        },
        { redirect: url => { redirectUrl = url; } },
    );
    assert.match(redirectUrl, new RegExp(`/bulletins/${employee.id}`));

    const payslip = await prisma.payslip.findUnique({
        where: { employeeId_month_year: { employeeId: employee.id, month, year } },
        include: { bonuses: true },
    });
    assert.ok(payslip, "The bulletin must be created");

    const representationLine = payslip.bonuses.find(line =>
        line.name.toLowerCase() === "indemnité de représentation"
    );
    assert.ok(representationLine, "Representation indemnity must appear in bulletin lines");
    assert.equal(Number(representationLine.amount), 500);
    assert.equal(representationLine.taxable, false);
    assert.equal(Number(payslip.bonusesNIMP), 500);
    assert.equal(Number(payslip.sbg), 5500);
    assert.equal(Number(payslip.sbi), 5000);

    console.log("Changing the employee rate while the bulletin is still a draft...");
    await updateEmployee(employee.id, {
        indemniteRepresentationRate: "7",
    }, company.id);

    const refreshedPayslip = await prisma.payslip.findUnique({
        where: { id: payslip.id },
        include: { bonuses: true },
    });
    const refreshedRepresentationLine = refreshedPayslip.bonuses.find(line =>
        line.name.toLowerCase() === "indemnité de représentation"
    );
    assert.ok(refreshedRepresentationLine, "The representation line must remain on an editable bulletin");
    assert.equal(Number(refreshedRepresentationLine.amount), 350);
    assert.equal(Number(refreshedPayslip.bonusesNIMP), 350);
    assert.equal(Number(refreshedPayslip.sbg), 5350);
    assert.equal(Number(refreshedPayslip.sbi), 5000);

    console.log("PASS: employee assignment is calculated and saved in the bulletin.");
} finally {
    if (employee) {
        await prisma.employee.delete({ where: { id: employee.id } });
    }
    if (company) {
        await prisma.bonus.deleteMany({ where: { companyId: company.id } });
        await prisma.company.delete({ where: { id: company.id } });
    }
    await prisma.$disconnect();
}

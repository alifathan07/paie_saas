import assert from "node:assert/strict";
import express from "express";
import prisma from "./db.ts";
import {
    generateCnssBdsFile,
} from "./src/payroll-engine/reports/cnssBds.report.js";
import { generateMonthlyCnssBdsFile } from "./src/services/cnssBds.service.js";
import { editions } from "./src/routes/editions.js";

function makeA02(cnss) {
    const identity = `A02${" ".repeat(13)}${cnss}`;
    return identity
        + " ".repeat(77 - identity.length)
        + "00"
        + "0".repeat(24)
        + "N"
        + " ".repeat(8)
        + " ".repeat(260 - 112);
}

function makeTemplate(employeeNumbers = ["000123456", "000999999", "000234567"]) {
    const a00 = `A00${" EMPLOYER HEADER".padEnd(257, " ")}`;
    const a01 = `A01${" EMPLOYEE HEADER".padEnd(257, " ")}`;
    const a03 = `A03123456789202610${" ".repeat(30)}`;
    return [a00, a01, ...employeeNumbers.map(makeA02), a03].join("\r\n") + "\r\n";
}

function getLines(file) {
    assert.ok(!file.replaceAll("\r\n", "").includes("\n"), "Output must use Windows line endings");
    const lines = file.split("\r\n");
    if (lines.at(-1) === "") lines.pop();
    return lines;
}

const originals = [];
function mock(target, key, value) {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = value;
}

try {
    const template = makeTemplate();
    const templateLines = getLines(template);
    const output = generateCnssBdsFile(template, [{
        cnss_immatriculation: "000123456",
        days_worked: 9,
        gross_salary: 6500,
        amo_salary_base: 4500.25,
    }, {
        cnss_immatriculation: "000234567",
        days_worked: 26,
        gross_salary: 100.25,
        amo_salary_base: 200,
    }]);
    const lines = getLines(output);

    assert.equal(lines.length, 6);
    assert.equal(lines[0], templateLines[0], "A00 must remain untouched");
    assert.equal(lines[1], templateLines[1], "A01 must remain untouched");
    assert.equal(lines[2].length, 260);
    assert.equal(lines[2].slice(77, 79), "09");
    assert.equal(lines[2].slice(79, 91), "000000650000");
    assert.equal(lines[2].slice(91, 103), "000000450025");
    assert.equal(lines[2].slice(103, 104), "N");
    assert.equal(lines[2].slice(104, 112), "        ");
    assert.equal(lines[2].slice(112), templateLines[2].slice(112), "The rest of the A02 row must remain aligned");
    assert.equal(lines[3], templateLines[3], "Unmatched template employees must remain unchanged");
    assert.equal(lines[4].slice(79, 91), "000000010025");
    assert.equal(lines[5], "A03123456789202610" + "000003" + "00000000660025" + "00000000470025");
    assert.equal(lines[5].length, 52);

    const capOutput = generateCnssBdsFile(makeTemplate(["000123456"]), new Map([
        ["000123456", {
            days_worked: 30,
            gross_salary: 0,
            amo_salary_base: "0.00",
            situation_code: "S",
            situation_date: "20261107",
        }],
    ]));
    const cappedLine = getLines(capOutput)[2];
    assert.equal(cappedLine.slice(77, 79), "26", "Worked days must be capped at 26");
    assert.equal(cappedLine.slice(103, 112), "S20261107");

    assert.throws(() => generateCnssBdsFile(makeTemplate(["000123456"]), [{
        cnss_immatriculation: "000123456", days_worked: 1.5, gross_salary: 1, amo_salary_base: 1,
    }]), { message: "INVALID_BDS_DAYS" });
    assert.throws(() => generateCnssBdsFile(makeTemplate(["000123456"]), [{
        cnss_immatriculation: "000123456", days_worked: 1, gross_salary: 1, amo_salary_base: 1,
        situation_code: "E", situation_date: "20260230",
    }]), { message: "INVALID_BDS_SITUATION_DATE" });
    assert.throws(() => generateCnssBdsFile(makeTemplate(["000123456"]), [{
        cnss_immatriculation: "000123456", days_worked: 1, gross_salary: 10_000_000_000, amo_salary_base: 1,
    }]), { message: "BDS_AMOUNT_OVERFLOW" });
    assert.throws(() => generateCnssBdsFile(makeTemplate(["000123456"]), [{
        cnss_immatriculation: "000654321", days_worked: 1, gross_salary: 1, amo_salary_base: 1,
    }]), { message: "BDS_PAYROLL_EMPLOYEE_NOT_IN_TEMPLATE" });

    const blockedEmployee = generateCnssBdsFile(makeTemplate(["000123456", "000234567"]), [{
        cnss_immatriculation: "000123456", days_worked: 0, gross_salary: 0, amo_salary_base: 0, bds_situation: "CS",
    }, {
        cnss_immatriculation: "000234567", days_worked: 1, gross_salary: 1, amo_salary_base: 1,
    }]);
    assert.equal(getLines(blockedEmployee).filter(line => line.startsWith("A02")).length, 2);
    assert.equal(getLines(blockedEmployee)[2].slice(103, 112), "CS       ");

    let queriedPayslips;
    mock(prisma.company, "findUnique", async ({ where }) => {
        assert.deepEqual(where, { id: 3 });
        return { id: 3, numeroAffiliationCnss: "123456789" };
    });
    mock(prisma.payslip, "findMany", async args => {
        queriedPayslips = args;
        return [{
            workedDays: 26,
            sbg: "7200.50",
            sbi: "6500.25",
            employee: { matricule: "E-01", numeroCNSS: "000123456" },
        }];
    });
    mock(prisma.employee, "findMany", async () => []);
    const monthlyFile = await generateMonthlyCnssBdsFile(3, 10, 2026, makeTemplate(["000123456"]));
    assert.deepEqual(queriedPayslips.where.employee, { companyId: 3 }, "Payroll lookup must stay company-scoped");
    assert.deepEqual(queriedPayslips.where.status, { in: ["GENERATED", "VALIDATED", "CLOSED"] });
    assert.equal(getLines(monthlyFile)[2].slice(79, 91), "000000720050");
    assert.equal(getLines(monthlyFile)[2].slice(91, 103), "000000650025");

    const mismatchedAffiliationTemplate = makeTemplate(["000123456"]).replace("A03123456789202610", "A03987654321202610");
    const fileWithMismatchedAffiliation = await generateMonthlyCnssBdsFile(3, 10, 2026, mismatchedAffiliationTemplate);
    assert.equal(getLines(fileWithMismatchedAffiliation)[2].slice(79, 91), "000000720050");

    const app = express();
    app.use((req, res, next) => {
        req.session = {
            user: { id: 5, activeCompanyId: 3 },
            selectedPeriod: { month: 10, year: 2026 },
        };
        res.render = function (view, locals) {
            return this.send(JSON.stringify({ view, error: locals.error, declarationDate: locals.declarationDate }));
        };
        next();
    });
    app.use("/editions", editions);
    const server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    try {
        const pageResponse = await fetch(`http://127.0.0.1:${server.address().port}/editions/bds`);
        const page = await pageResponse.json();
        assert.equal(pageResponse.status, 200);
        assert.equal(page.view, "editions/bds");
        assert.equal(page.declarationDate, "2026-10-01");

        const form = new FormData();
        form.append("declarationDate", "2026-10-15");
        const latin1Template = makeTemplate(["000123456"]).replace("HEADER", "HÉADER");
        form.append("template", new Blob([Buffer.from(latin1Template, "latin1")], { type: "text/plain" }), "damancom.txt");
        const response = await fetch(`http://127.0.0.1:${server.address().port}/editions/bds`, {
            method: "POST",
            body: form,
        });
        const downloadedFile = Buffer.from(await response.arrayBuffer()).toString("latin1");
        assert.equal(response.status, 200, downloadedFile);
        assert.match(response.headers.get("content-disposition"), /BDS_CNSS_202610\.txt/);
        assert.equal(getLines(downloadedFile)[0], getLines(latin1Template)[0], "Legacy template characters must survive the download unchanged");
        assert.equal(getLines(downloadedFile)[2].slice(79, 91), "000000720050");
    } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }

    console.log("CNSS BDS generation checks passed.");
} finally {
    for (const restore of originals.reverse()) restore();
    await prisma.$disconnect();
}

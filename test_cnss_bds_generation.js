import assert from "node:assert/strict";
import fs from "node:fs";
import { generateCnssBdsFile } from "./src/payroll-engine/reports/cnssBds.report.js";

const reference = fs.readFileSync("DS_7425342_202610.txt", "latin1");
const referenceLines = reference.split("\r\n").filter(Boolean);
const referenceRecords = referenceLines.filter(line => line.startsWith("B02")).map(line => ({
    cnss_immatriculation: line.slice(16, 25),
    days_worked: Number(line.slice(111, 113)),
    gross_salary: Number(line.slice(113, 126)) / 100,
    salary_plaf_cents: BigInt(line.slice(126, 135)),
    bds_situation: "",
}));

const golden = generateCnssBdsFile(reference, referenceRecords, {
    affiliation: "7425342",
    period: "202610",
    salaryCeilingCents: 600000,
});
assert.equal(golden, reference, "October 2026 reference must be reproduced field-for-field");

const dynamic = generateCnssBdsFile(reference, [
    ...referenceRecords,
    {
        cnss_immatriculation: "999999999",
        employeeName: "NEW ENTRANT",
        cin: "AB123456",
        days_worked: 20,
        gross_salary: 6500,
    },
], {
    affiliation: "7425342",
    period: "202610",
    salaryCeilingCents: 600000,
});
const dynamicLines = dynamic.split("\r\n").filter(Boolean);
assert.equal(dynamicLines.length, 14);
assert.ok(dynamicLines.every(line => line.length === 260));
assert.equal(dynamicLines[0].slice(0, 19), "B0074253422610014B0");
assert.equal(dynamicLines[1], referenceLines[1].replace(/^B01/, "B01"));
assert.equal(dynamicLines[10].slice(16, 22), "000008");
assert.equal(dynamicLines[11].slice(0, 3), "B04");
assert.equal(dynamicLines[11].slice(16, 25), "999999999");
assert.equal(dynamicLines[12].slice(0, 3), "B05");
assert.equal(dynamicLines[12].slice(16, 22), "000001");
assert.equal(dynamicLines[13].slice(0, 3), "B06");
assert.equal(dynamicLines[13].slice(16, 22), "000009");

const noEntrant = generateCnssBdsFile(reference, referenceRecords, { affiliation: "7425342", period: "202610" }).split("\r\n").filter(Boolean);
assert.equal(noEntrant[10].slice(16, 22), "000008");
assert.equal(noEntrant[11].slice(0, 3), "B04");
assert.equal(noEntrant[11].slice(16, 25), "         ");
assert.equal(noEntrant[12].slice(16, 22), "000000");

assert.throws(() => generateCnssBdsFile(reference, referenceRecords.slice(0, 1), { affiliation: "7425342", period: "202610" }), /BDS_PREESTABLISHED_EMPLOYEE_MISSING/);
assert.throws(() => generateCnssBdsFile(reference, [{ ...referenceRecords[0], cnss_immatriculation: "bad" }], { affiliation: "7425342", period: "202610" }), /INVALID_BDS_CNSS_NUMBER/);
assert.throws(() => generateCnssBdsFile(reference, referenceRecords, { affiliation: "1234567", period: "202610" }), /BDS_COMPANY_AFFILIATION_MISMATCH/);
const blockedMissing = generateCnssBdsFile(reference, referenceRecords.slice(0, 7), {
    affiliation: "7425342",
    period: "202610",
    excludedPreEstablishedCnss: [referenceRecords[7].cnss_immatriculation],
});
assert.equal(blockedMissing.split("\r\n").filter(Boolean)[9].slice(16, 22), "000007");

console.log("CNSS BDS golden and dynamic generation checks passed.");

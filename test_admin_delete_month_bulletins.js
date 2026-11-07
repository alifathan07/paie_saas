import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import prisma from "./db.ts";
import { admin } from "./src/routes/admin.js";

const originals = [];
function mock(target, key, value) {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = value;
}

let databaseAdmin = false;
let deductionQuery;
let deletionQuery;
let advanceRestorations = [];
let auditEntry;
let transactionCount = 0;

mock(prisma.users, "findUnique", async () => ({ isAdmin: databaseAdmin }));
mock(prisma.company, "findUnique", async ({ where }) => where.id === 5 ? { id: 5 } : null);
mock(prisma.avanceDeduction, "findMany", async args => {
    deductionQuery = args;
    return [
        { avanceId: 21, amount: "120.25" },
        { avanceId: 21, amount: "9.75" },
        { avanceId: 22, amount: "50.00" },
    ];
});
mock(prisma.avance, "updateMany", async args => {
    advanceRestorations.push(args);
    return { count: 1 };
});
mock(prisma.payslip, "deleteMany", async args => {
    deletionQuery = args;
    return { count: 3 };
});
mock(prisma.auditLog, "create", async ({ data }) => {
    auditEntry = data;
    return data;
});
mock(prisma, "$transaction", async callback => {
    transactionCount++;
    return callback(prisma);
});

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
    req.session = { user: { id: 7, isAdmin: false } };
    next();
});
app.use("/admin", admin);

const server = app.listen(0, "127.0.0.1");

try {
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}/admin/companies/5/bulletins/delete`;
    const post = (fields) => fetch(baseUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
    });

    const unauthorized = await post({ month: "4", year: "2026", confirmDelete: "yes" });
    assert.equal(unauthorized.status, 403, "Non-admin users must not delete bulletins");
    assert.equal(transactionCount, 0);

    databaseAdmin = true;
    const invalidPeriod = await post({ month: "13", year: "2026", confirmDelete: "yes" });
    assert.equal(invalidPeriod.status, 400, "Invalid periods must be rejected");
    assert.equal(transactionCount, 0);

    const missingConfirmation = await post({ month: "4", year: "2026" });
    assert.equal(missingConfirmation.status, 400, "Deletion must require explicit confirmation");
    assert.equal(transactionCount, 0);

    const deleted = await post({ month: "4", year: "2026", confirmDelete: "yes" });
    assert.equal(deleted.status, 302);
    assert.equal(new URL(deleted.headers.get("location"), baseUrl).pathname, "/admin/companies/5");
    assert.deepEqual(deletionQuery, {
        where: { month: 4, year: 2026, employee: { companyId: 5 } },
    }, "Deletion must include the company and period without excluding any bulletin status");
    assert.deepEqual(deductionQuery, {
        where: { payslip: { month: 4, year: 2026, employee: { companyId: 5 } } },
        select: { avanceId: true, amount: true },
    });
    assert.deepEqual(advanceRestorations, [
        { where: { id: 21, employee: { companyId: 5 } }, data: { solde: { increment: 130 } } },
        { where: { id: 22, employee: { companyId: 5 } }, data: { solde: { increment: 50 } } },
    ], "Advance balances must be restored before their payslip deductions cascade-delete");
    assert.equal(auditEntry.action, "DELETE_COMPANY_MONTH_BULLETINS");
    assert.equal(auditEntry.actorUserId, 7);
    assert.equal(auditEntry.companyId, 5);
    assert.deepEqual(auditEntry.metadata, {
        month: 4,
        year: 2026,
        deletedCount: 3,
        restoredAdvanceCount: 2,
    });

    const form = await readFile(new URL("./src/views/admin/company-details.ejs", import.meta.url), "utf8");
    assert.match(form, /\/admin\/companies\/<%= company\.id %>\/bulletins\/delete/);
    assert.match(form, /name="confirmDelete" value="yes" required/);
    assert.match(form, /bulletins validés et clôturés/);

    console.log("Admin month-bulletin deletion checks passed.");
} finally {
    await new Promise(resolve => server.close(resolve));
    for (const restore of originals.reverse()) restore();
}

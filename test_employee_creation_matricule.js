import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import prisma from "./db.ts";
import { employee } from "./src/routes/employee.js";

const originalCompanyFindUnique = prisma.company.findUnique;
const originalCategoryUpsert = prisma.employeeCategory.upsert;
const originalEmployeeCreate = prisma.employee.create;
const createdEmployees = [];

prisma.company.findUnique = async () => ({ chantiersEnabled: false });
prisma.employeeCategory.upsert = async () => ({ id: 7 });
prisma.employee.create = async ({ data }) => {
    createdEmployees.push(data);
    return { id: createdEmployees.length, ...data };
};

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use((req, _res, next) => {
    req.session = { user: { activeCompanyId: 42 } };
    next();
});
app.use("/employees", employee);

const server = app.listen(0, "127.0.0.1");

try {
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });

    const form = await readFile(new URL("./src/views/employees/create.ejs", import.meta.url), "utf8");
    assert.equal((form.match(/name="matricule"/g) || []).length, 1, "The employee fiche must submit one matricule field");

    const submitEmployeeFiche = async matricule => {
        const fields = {
            nomComplet: "Salarié Test",
            cin: `TEST-${createdEmployees.length + 1}`,
            dateNaissance: "1990-01-01",
            dateEmbauche: "2020-01-01",
            baseSalary: "5000",
            matricule,
        };
        const response = await fetch(`http://127.0.0.1:${server.address().port}/employees/create`, {
            method: "POST",
            redirect: "manual",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams(fields),
        });
        assert.equal(response.status, 302);
        assert.equal(response.headers.get("location"), "/employees");
    };

    await submitEmployeeFiche("FICHE-001");
    assert.equal(createdEmployees[0].matricule, "FICHE-001", "The submitted matricule must reach employee creation unchanged");

    await submitEmployeeFiche("");
    assert.match(createdEmployees[1].matricule, /^EMP-\d{4}$/, "A blank fiche matricule must use the existing automatic assignment");

    console.log("Employee creation matricule checks passed.");
} finally {
    await new Promise(resolve => server.close(resolve));
    prisma.company.findUnique = originalCompanyFindUnique;
    prisma.employeeCategory.upsert = originalCategoryUpsert;
    prisma.employee.create = originalEmployeeCreate;
}

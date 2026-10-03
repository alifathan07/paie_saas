import assert from "node:assert/strict";
import XLSX from "xlsx";

process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
process.env.DEEPSEEK_MODEL = "deepseek-chat";
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_MODEL;

const { default: prisma } = await import("./db.ts");
const { importEmployeesFromSpreadsheet, normalizeAIJsonContent } = await import("./src/services/employeeImport.service.js");

const originalFindMany = prisma.employee.findMany;
const originalCreate = prisma.employee.create;
const originalTransaction = prisma.$transaction;
const originalFetch = global.fetch;

const spreadsheet = () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ["Nom", "CIN", "Salaire"],
        ["Test Employé", "AB123456", "5000"]
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Employés");
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
};

const employee = {
    matricule: "EMP-001",
    nomComplet: "Test Employé",
    cin: "AB123456",
    dateNaissance: "1990-01-01",
    sexe: "M",
    dateEmbauche: "2020-01-01",
    dateAnciennete: null,
    dateSortie: null,
    fonction: null,
    codeService: null,
    statut: "TITULAIRE",
    natureEmploi: "PERMANENT",
    contratDateDebut: null,
    contratDateFin: null,
    situationFam: "CELIBATAIRE",
    nbPersonacharge: null,
    nbEnfantCharge: 0,
    adresse: null,
    ville: null,
    numeroCNSS: null,
    dateAffiliationCnss: null,
    modePaiement: "VIREMENT",
    banque: null,
    agence: null,
    rib: null,
    baseSalary: 5000,
    cimrRate: null,
    sourceRow: 2,
};

function response(content) {
    return {
        status: 200,
        ok: true,
        headers: { get: name => name.toLowerCase() === "content-type" ? "application/json" : "123" },
        json: async () => ({ choices: [{ message: { content } }] }),
    };
}

async function run(content) {
    let created = [];
    let requestBody;
    global.fetch = async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return response(content);
    };
    prisma.employee.findMany = async () => [];
    prisma.employee.create = async ({ data }) => {
        created.push(data);
        return { id: created.length, ...data };
    };
    prisma.$transaction = async operations => Promise.all(operations);
    try {
        const result = await importEmployeesFromSpreadsheet({ buffer: spreadsheet(), companyId: 42 });
        return { result, created, requestBody };
    } catch (error) {
        return { error, created, requestBody };
    }
}

try {
    assert.equal(normalizeAIJsonContent('```json\n{"employees":[]}\n```'), '{"employees":[]}');
    assert.equal(normalizeAIJsonContent('{"employees":[]}'), '{"employees":[]}');

    const plain = await run(JSON.stringify({ employees: [employee] }));
    assert.equal(plain.error, undefined);
    assert.equal(plain.result.count, 1);
    assert.equal(plain.created[0].companyId, 42);
    assert.equal(plain.requestBody.model, "deepseek-chat");
    assert.deepEqual(plain.requestBody.response_format, { type: "json_object" });

    const fenced = await run("```json\n" + JSON.stringify({ employees: [employee] }) + "\n```");
    assert.equal(fenced.error, undefined);
    assert.equal(fenced.result.count, 1);

    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_MODEL;
    process.env.GROQ_API_KEY = "legacy-deepseek-key";
    process.env.GROQ_MODEL = "deepseek-flash";
    const legacy = await run(JSON.stringify({ employees: [employee] }));
    assert.equal(legacy.error, undefined);
    assert.equal(legacy.requestBody.model, "deepseek-flash");
    process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
    process.env.DEEPSEEK_MODEL = "deepseek-chat";
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_MODEL;

    for (const [content, expected] of [
        ["", "DEEPSEEK_EMPTY_RESPONSE"],
        ["not json", "DEEPSEEK_INVALID_JSON"],
        [JSON.stringify({}), "DEEPSEEK_ROW_COUNT_MISMATCH"],
        [JSON.stringify({ employees: [] }), "DEEPSEEK_ROW_COUNT_MISMATCH"],
    ]) {
        const failed = await run(content);
        assert.equal(failed.error?.message, expected);
        assert.equal(failed.created.length, 0);
    }

    const invalidEmployee = await run(JSON.stringify({ employees: [{ ...employee, baseSalary: "not-a-number" }] }));
    assert.equal(invalidEmployee.error?.message, "IMPORT_VALIDATION_FAILED");
    assert.equal(invalidEmployee.created.length, 0);

    console.log("Employee import response checks passed.");
} finally {
    prisma.employee.findMany = originalFindMany;
    prisma.employee.create = originalCreate;
    prisma.$transaction = originalTransaction;
    global.fetch = originalFetch;
    await prisma.$disconnect();
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import { isOvertimeEnabled } from "./src/lib/overtimeFeature.js";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const section = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing template marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing template marker: ${endMarker}`);
    return source.slice(start, end + endMarker.length);
};

const adminView = await read("./src/views/admin/company-details.ejs");
const adminSwitch = section(
    adminView,
    '<section class="admin-section-card" id="company-overtime-settings"',
    "</section>",
);
const renderAdminSwitch = company => ejs.render(
    `<% const overtimeEnabled = company.overtimeEnabled !== false; %>${adminSwitch}`,
    { company },
);
const companyOne = { id: 11, overtimeEnabled: true };
const companyTwo = { id: 12, overtimeEnabled: false };
assert.equal(isOvertimeEnabled(companyOne), true);
assert.equal(isOvertimeEnabled(companyTwo), false);
assert.match(renderAdminSwitch(companyOne), /action="\/admin\/companies\/11\/overtime"/);
assert.match(renderAdminSwitch(companyOne), /name="enabled" value="false"/);
assert.match(renderAdminSwitch(companyTwo), /action="\/admin\/companies\/12\/overtime"/);
assert.match(renderAdminSwitch(companyTwo), /name="enabled" value="true"/);

const listView = await read("./src/views/bulletins/index.ejs");
const columnFilter = section(
    listView,
    "<%\n    const isRubriqueVisible",
    "%>",
);
const headerLoop = section(
    listView,
    "<% visibleRubriqueColumns.forEach(column => { %>",
    "<% }); %>",
);
const listColumns = [
    { key: "OT25|Heures supplémentaires 25%", label: "Heures supplémentaires 25%", kind: "overtime" },
    { key: "PR|Prime de rendement", label: "Prime de rendement", kind: "prime" },
    { key: "BONUS|Heures supplémentaires contractuelles", label: "Heures supplémentaires contractuelles", kind: "prime" },
];
const renderColumnHeaders = overtimeEnabled => ejs.render(
    `${columnFilter}${headerLoop}`,
    { overtimeEnabled, rubriqueVisibility: {}, rubriqueColumns: listColumns },
);
assert.doesNotMatch(renderColumnHeaders(false), /Heures supplémentaires 25%/);
assert.match(renderColumnHeaders(false), /Prime de rendement/);
assert.match(renderColumnHeaders(false), /Heures supplémentaires contractuelles/);
assert.match(renderColumnHeaders(true), /Heures supplémentaires 25%/);
assert.equal((listView.match(/visibleRubriqueColumns\.forEach/g) || []).length, 2);
const bulletinsController = await read("./src/controllers/bulletins.controller.js");
assert.match(bulletinsController, /String\(item\.calculationKey \|\| ''\)\.startsWith\('overtime_'\) \? 'overtime' : 'prime'/);

const showView = await read("./src/views/bulletins/show.ejs");
const overtimeRowsStart = showView.indexOf("const overtimeRows =");
const overtimeRowsEnd = showView.indexOf("const taxablePaidLeaveDefinition", overtimeRowsStart);
assert.ok(overtimeRowsStart !== -1 && overtimeRowsEnd !== -1, "Overtime row definition exists");
const overtimeRowsExpression = showView.slice(overtimeRowsStart, overtimeRowsEnd);
const renderOvertimeRowCount = (overtimeEnabled, rubriqueVisibility = {}) => ejs.render(
    `<% ${overtimeRowsExpression} %><%= overtimeRows.length %>`,
    {
        overtimeEnabled,
        rubriqueVisibility,
        isImposableRubriqueVisible: line => rubriqueVisibility.imposable?.[`key:${line.calculationKey}`] !== false,
        values: {},
        emp: { baseSalary: 0 },
        standardMonthlyHours: 191,
        taxableRubriques: [],
    },
);
assert.equal(renderOvertimeRowCount(false), "0");
assert.equal(renderOvertimeRowCount(true), "3");
assert.equal(renderOvertimeRowCount(true, {
    imposable: { "key:overtime_25": false, "key:overtime_50": false, "key:overtime_100": false },
}), "0");
const overtimeDialogStart = showView.indexOf('<% if (overtimeEnabled !== false && overtimeRows.length) { %>', showView.indexOf('id="overtime-dialog"') - 160);
const overtimeDialogEnd = showView.indexOf("<% } %>", showView.indexOf("</dialog>", overtimeDialogStart)) + "<% } %>".length;
assert.ok(overtimeDialogStart !== -1 && overtimeDialogEnd > overtimeDialogStart, "Overtime dialog is guarded");
const overtimeDialogTemplate = showView.slice(overtimeDialogStart, overtimeDialogEnd);
const dialogLocals = {
    overtimeEnabled: true,
    overtimeRows: [{}],
    isImposableRubriqueVisible: () => true,
};
assert.doesNotMatch(ejs.render(overtimeDialogTemplate, { ...dialogLocals, overtimeEnabled: false }), /id="overtime-dialog"/);
assert.match(ejs.render(overtimeDialogTemplate, dialogLocals), /id="overtime-dialog"/);
assert.doesNotMatch(ejs.render(overtimeDialogTemplate, { ...dialogLocals, overtimeRows: [] }), /id="overtime-dialog"/);

const pdfView = await read("./src/pdf/bulletinPdf.js");
assert.match(pdfView, /data\.overtimeEnabled !== false \|\| !String\(line\.calculationKey \|\| ''\)\.startsWith\('overtime_'\)/);
const editionsRoute = await read("./src/routes/editions.js");
assert.match(editionsRoute, /overtimeEnabled,/);
assert.match(editionsRoute, /rubriqueCodes: rubriqueMaps\.codes/);

console.log("Overtime UI gates passed for enabled and disabled companies.");

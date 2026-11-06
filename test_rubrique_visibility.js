import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import {
    buildRubriqueVisibility,
    isImposableRubriqueVisible,
    isRubriqueVisible,
} from "./src/lib/rubriqueVisibility.js";

const visibility = buildRubriqueVisibility({
    base: [{ id: 1, key: "base_salary", code: "1001", visible: false }],
    retenu: [{ id: 2, key: "cnss", code: "2001", visible: false }],
    imposable: [{ id: 3, calculationKey: "overtime_25", code: "1002", visible: false }],
});

assert.equal(isRubriqueVisible(visibility, "base", "base_salary"), false);
assert.equal(isRubriqueVisible(visibility, "retenu", "id:2"), false);
assert.equal(isRubriqueVisible(visibility, "imposable", "3"), false);
assert.equal(isImposableRubriqueVisible(visibility, { rubriqueImposableId: 3 }), false);
assert.equal(isImposableRubriqueVisible(visibility, { calculationKey: "overtime_25" }), false);
assert.equal(isImposableRubriqueVisible(visibility, { code: "1002" }), false);
assert.equal(isRubriqueVisible(visibility, "base", "missing"), true, "unconfigured rubriques stay visible");

const anotherCompanyVisibility = buildRubriqueVisibility({
    base: [{ id: 4, key: "base_salary", code: "1001", visible: true }],
});
assert.equal(isRubriqueVisible(anotherCompanyVisibility, "base", "base_salary"), true);

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const section = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing template marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing template end marker: ${endMarker}`);
    return source.slice(start, end + endMarker.length);
};

const adminView = await read("./src/views/admin/company-details.ejs");
const rubriqueGroups = section(adminView, "<% const rubriqueVisibilityGroups", "%>");
const rubriqueControls = section(
    adminView,
    '<section class="admin-section-card" id="company-rubrique-visibility"',
    "</section>",
);
const renderRubriqueControls = company => ejs.render(
    `${rubriqueGroups}${rubriqueControls}`,
    { company },
);
const adminCompanyOne = {
    id: 21,
    rubriqueBases: [{ id: 1, name: "Salaire de base", key: "base_salary", visible: false }],
    rubriqueRetenus: [{ id: 2, name: "CNSS", key: "cnss", visible: true }],
    rubriquesImposables: [{ id: 3, name: "Prime", calculationKey: "bonus", code: "3001", visible: false }],
};
const adminCompanyTwo = {
    id: 22,
    rubriqueBases: [{ id: 1, name: "Salaire de base", key: "base_salary", visible: true }],
    rubriqueRetenus: [{ id: 2, name: "CNSS", key: "cnss", visible: false }],
    rubriquesImposables: [{ id: 3, name: "Prime", calculationKey: "bonus", code: "3001", visible: true }],
};
const renderedCompanyOne = renderRubriqueControls(adminCompanyOne);
const renderedCompanyTwo = renderRubriqueControls(adminCompanyTwo);
for (const category of ["base", "retenu", "imposable"]) {
    assert.match(renderedCompanyOne, new RegExp(`/companies/21/rubriques/${category}/`));
    assert.match(renderedCompanyTwo, new RegExp(`/companies/22/rubriques/${category}/`));
}
assert.match(renderedCompanyOne, /companies\/21\/rubriques\/base\/1\/visibility">[\s\S]*?name="visible" value="true"/);
assert.match(renderedCompanyOne, /companies\/21\/rubriques\/retenu\/2\/visibility">[\s\S]*?name="visible" value="false"/);
assert.match(renderedCompanyOne, /companies\/21\/rubriques\/imposable\/3\/visibility">[\s\S]*?name="visible" value="true"/);
assert.match(renderedCompanyTwo, /companies\/22\/rubriques\/base\/1\/visibility">[\s\S]*?name="visible" value="false"/);
assert.match(renderedCompanyTwo, /companies\/22\/rubriques\/retenu\/2\/visibility">[\s\S]*?name="visible" value="true"/);
assert.match(renderedCompanyTwo, /companies\/22\/rubriques\/imposable\/3\/visibility">[\s\S]*?name="visible" value="false"/);

const listView = await read("./src/views/bulletins/index.ejs");
const listColumnFilter = section(listView, "<%\n    const isRubriqueVisible", "%>");
const listHeaderLoop = section(
    listView,
    "<% visibleRubriqueColumns.forEach(column => { %>",
    "<% }); %>",
);
const listColumns = [
    { key: "2001|CNSS", code: "2001", label: "CNSS", kind: "display", rubriqueVisibilityCategory: "retenu", rubriqueVisibilityKey: "cnss" },
    { key: "3001|Prime liée", code: "3001", label: "Prime liée", kind: "prime", rubriqueVisibilityCategory: "imposable", rubriqueVisibilityKey: "id:30" },
    { key: "3001|Prime ordinaire", code: "3001", label: "Prime ordinaire", kind: "prime" },
];
const renderedListColumns = ejs.render(`${listColumnFilter}${listHeaderLoop}`, {
    overtimeEnabled: true,
    rubriqueVisibility: {
        base: {},
        retenu: { cnss: false, "id:2": false, "code:2001": false },
        imposable: { "id:30": false, "code:3001": false },
    },
    rubriqueColumns: listColumns,
});
assert.doesNotMatch(renderedListColumns, />CNSS</);
assert.doesNotMatch(renderedListColumns, />Prime liée</);
assert.match(renderedListColumns, />Prime ordinaire</, "unlinked taxable bonuses remain visible");
assert.match(listView, /<strong>Net à payer<\/strong>/, "saved net-pay column remains visible");

const showView = await read("./src/views/bulletins/show.ejs");
assert.match(showView, /isRubriqueVisible\('base', 'base_salary'\)/);
assert.match(showView, /isRubriqueVisible\('retenu', 'cnss'\)/);
assert.match(showView, /isRubriqueVisible\('imposable'/);
assert.match(showView, /rubriqueVisibilityInputs \|\| \[\]/, "hidden saved inputs are preserved");
assert.match(showView, /data-result="totalGains"/);
assert.match(showView, /data-result="deductionsTotal"/);
assert.match(showView, /data-result="netAPayer"/, "saved totals and net pay remain rendered");

console.log("Company rubric visibility checks passed.");

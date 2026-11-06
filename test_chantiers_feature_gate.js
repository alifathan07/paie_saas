import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";
import {
    employeeChantierWriteFields,
    filterEmployeesByChantier,
    isChantiersEnabled,
    resolveChantierFilter,
} from "./src/lib/chantiersFeature.js";

assert.equal(isChantiersEnabled({ chantiersEnabled: true }), true);
assert.equal(isChantiersEnabled({ chantiersEnabled: false }), false);
assert.equal(isChantiersEnabled({}), true, "missing settings preserve existing chantier behavior");

assert.equal(resolveChantierFilter("12", true), 12);
assert.equal(resolveChantierFilter("12", false), null);
assert.equal(resolveChantierFilter("invalid", true), null);

const employees = [{ id: 1, chantierId: 12 }, { id: 2, chantierId: 24 }];
assert.deepEqual(filterEmployeesByChantier(employees, 12, true), [employees[0]]);
assert.deepEqual(filterEmployeesByChantier(employees, 12, false), employees);
assert.deepEqual(employeeChantierWriteFields(false, { chantierId: "12", chantierNom: "Site" }, true), {
    chantierId: null,
    chantierNom: null,
});
assert.deepEqual(employeeChantierWriteFields(false, { chantierId: "12", chantierNom: "Site" }), {});
assert.deepEqual(employeeChantierWriteFields(true, { chantierId: undefined, chantierNom: undefined }), {
    chantierId: undefined,
    chantierNom: undefined,
});

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const section = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing template marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing template end marker: ${endMarker}`);
    return source.slice(start, end + endMarker.length);
};

const companyView = await read("./src/views/admin/company-details.ejs");
const adminToggle = section(
    companyView,
    '<section class="admin-section-card" id="company-chantiers-settings"',
    "</section>",
);
const renderAdminToggle = company => ejs.render(
    `<% const chantiersEnabled = company.chantiersEnabled !== false; %>${adminToggle}`,
    { company },
);
assert.match(renderAdminToggle({ id: 21, chantiersEnabled: true }), /action="\/admin\/companies\/21\/chantiers"/);
assert.match(renderAdminToggle({ id: 21, chantiersEnabled: true }), /name="enabled" value="false"/);
assert.match(renderAdminToggle({ id: 22, chantiersEnabled: false }), /action="\/admin\/companies\/22\/chantiers"/);
assert.match(renderAdminToggle({ id: 22, chantiersEnabled: false }), /name="enabled" value="true"/);

for (const file of ["create.ejs", "edit.ejs"]) {
    const employeeForm = await read(`./src/views/employees/${file}`);
    assert.match(employeeForm, /if \(chantiersEnabled !== false\) \{ %>[\s\S]*?label for="chantierId"/);
}
const employeeShow = await read("./src/views/employees/show.ejs");
assert.match(employeeShow, /if \(chantiersEnabled !== false\) \{ %>[\s\S]*?Chantier:/);

const employeeIndex = await read("./src/views/employees/index.ejs");
assert.doesNotMatch(employeeIndex, /<th[^>]*>\s*Chantier\s*<\/th>/i, "employee list has no chantier column to gate");

const bulletinIndex = await read("./src/views/bulletins/index.ejs");
const chantierFilter = section(
    bulletinIndex,
    '<% if (chantiersEnabled !== false) { %>\n                <label class="bulletin-filter-field">\n                    <span class="bulletin-filter-label">Chantier</span>',
    "<% } %>",
);
const renderChantierFilter = enabled => ejs.render(chantierFilter, {
    chantiersEnabled: enabled,
    chantiers: [{ id: 7, nom: "Site" }],
    filters: { chantierId: "" },
});
assert.match(renderChantierFilter(true), /name="chantierId"/);
assert.doesNotMatch(renderChantierFilter(false), /name="chantierId"/);

console.log("Company chantier feature gate passed.");

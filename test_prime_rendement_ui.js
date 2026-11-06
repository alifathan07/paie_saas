import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ejs from "ejs";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const section = (source, startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `Missing template marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `Missing template end marker: ${endMarker}`);
    return source.slice(start, end + endMarker.length);
};

const adminView = await read("./src/views/admin/company-details.ejs");
const adminToggle = section(
    adminView,
    '<section class="admin-section-card" id="company-prime-rendement-settings"',
    "</section>",
);
const renderAdminToggle = company => ejs.render(
    `<% const primeRendementEnabled = company.primeRendementEnabled !== false; %>${adminToggle}`,
    { company },
);
const companyOne = renderAdminToggle({ id: 21, primeRendementEnabled: true });
const companyTwo = renderAdminToggle({ id: 22, primeRendementEnabled: false });
const companyDefault = renderAdminToggle({ id: 23 });
assert.match(companyOne, /action="\/admin\/companies\/21\/prime-rendement"/);
assert.match(companyOne, /name="enabled" value="false"/);
assert.match(companyTwo, /action="\/admin\/companies\/22\/prime-rendement"/);
assert.match(companyTwo, /name="enabled" value="true"/);
assert.match(companyDefault, /name="enabled" value="false"/, "missing settings default to enabled");

const listView = await read("./src/views/bulletins/index.ejs");
const listColumnFilter = section(listView, "<%\n    const isRubriqueVisible", "%>");
const listHeaderLoop = section(
    listView,
    "<% visibleRubriqueColumns.forEach(column => { %>",
    "<% }); %>",
);
const columns = [
    { key: "|Prime rendement", code: "", label: "Prime rendement", kind: "primeRendement" },
    { key: "3001|Prime ordinaire", code: "3001", label: "Prime ordinaire", kind: "prime" },
];
const renderListHeaders = primeRendementEnabled => ejs.render(
    `${listColumnFilter}${listHeaderLoop}`,
    { primeRendementEnabled, overtimeEnabled: true, rubriqueVisibility: {}, rubriqueColumns: columns },
);
assert.doesNotMatch(renderListHeaders(false), /Prime rendement/);
assert.match(renderListHeaders(false), /Prime ordinaire/, "ordinary taxable primes remain visible");
assert.match(renderListHeaders(true), /Prime rendement/);
assert.match(listView, /component\?\.kind === 'primeRendement' && component\.key === 'primeRendementInput'/);
assert.match(listView, /name="primeRendementInput"/);
assert.match(listView, /max="999999\.99" step="0\.01" required/);
assert.match(listView, /data-prime-rendement-amount/);

const showView = await read("./src/views/bulletins/show.ejs");
const primeRow = section(
    showView,
    '<% if (primeRendementEnabled !== false) { %>\n                    <tr class="prime-row prime-rendement-row">',
    "</tr>\n                <% } %>",
);
const renderPrimeRow = primeRendementEnabled => ejs.render(primeRow, {
    primeRendementEnabled,
    values: { primeRendementInput: 0, primeRendementAmount: 0 },
    locked: false,
    bulletin: { id: 1 },
    fmt: value => Number(value).toFixed(2),
});
const enabledPrimeRow = renderPrimeRow(true);
assert.match(enabledPrimeRow, /name="primeRendementInput"/);
assert.match(enabledPrimeRow, /value="0\.00"/, "zero is a valid prime rendement input");
assert.match(enabledPrimeRow, /data-result="primeRendementAmount"/);
assert.doesNotMatch(renderPrimeRow(false), /primeRendementInput/);
assert.match(showView, /line\.calculationKey !== 'prime_rendement'/, "dedicated row is not duplicated as a generic addition");

const listScript = await read("./public/js/bulletins-list.js");
const showScript = await read("./public/js/show-bulletin.js");
assert.match(listScript, /`\/bulletins\/\$\{employeeId\}\/prime-rendement`/);
assert.match(listScript, /new URLSearchParams\(\{ \.\.\.selectedPeriod\(\), primeRendementInput: field\.value \}\)/);
assert.match(showScript, /`\/bulletins\/\$\{page\.dataset\.employeeId\}\/prime-rendement`/);
assert.match(showScript, /primeRendementInput: input\.value/);
assert.match(showScript, /month: page\.dataset\.month/);
assert.match(showScript, /year: page\.dataset\.year/);
assert.match(showScript, /new FormData\(form\)/, "preview serialization includes the detail-page input");

console.log("Prime rendement UI gates and routes passed for enabled and disabled companies.");

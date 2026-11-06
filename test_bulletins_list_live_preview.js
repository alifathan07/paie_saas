import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const script = await read("./public/js/bulletins-list.js");
const template = await read("./src/views/bulletins/index.ejs");
const start = script.indexOf("const hasWorkedDaysForm = Boolean(row.querySelector('.worked-days-form'));");
const end = script.indexOf("\n    });\n})();", start);

assert.notEqual(start, -1, "list rows should register a live preview handler");
assert.notEqual(end, -1, "live preview handler should be properly closed");
const livePreview = script.slice(start, end);
assert.match(livePreview, /row\.querySelectorAll\('\.bulletin-component-input'\)/);
assert.match(livePreview, /!hasWorkedDaysForm \|\| input\.classList\.contains\('nimp-amount-input'\)/);
assert.match(livePreview, /\/bulletins\/\$\{employeeId\}\/calculate\?/);
assert.match(livePreview, /updatePayrollPreview\(row, result\.payroll \|\| result\)/);
assert.match(template, /<strong data-payroll-net-value>/);
assert.match(template, /data-payroll-status role="status" aria-live="polite"/);

console.log("Bulletin list live-preview wiring passed.");

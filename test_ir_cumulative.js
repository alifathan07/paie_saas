import assert from "node:assert/strict";
import { calculateCumulativeIR } from "./src/payroll-engine/calculators/cumulativeIr.calculator.js";

const first = calculateCumulativeIR({
  employeeId: 1, year: 2026, month: 1,
  previousPayslips: [

  ],
  currentSNI: 11475.53,
});
assert.equal(first.previousIRWithheld, 0);
assert.equal(first.annualizedSNI, 137706.36);
assert.equal(first.annualIR, 24820.16);
assert.equal(first.cumulativeIRDue, 2068.35);
assert.equal(first.currentMonthIR, 2068.35);

const second = calculateCumulativeIR({
  employeeId: 1, year: 2026, month: 2,
  previousPayslips: [
    { employeeId: 1, year: 2026, month: 1, sni: 11475.53, irNet: 2068.35 }
  ],
  currentSNI: 9000,
});
assert.equal(second.cumulativeSNI, 20475.53);
assert.equal(second.annualizedSNI, 122853.18);
assert.equal(second.previousIRWithheld, 2068.35);
assert.equal(second.annualIR, 19770.08);
assert.equal(second.cumulativeIRDue, 3295.01);
assert.equal(second.currentMonthIR, 1226.66);

const third = calculateCumulativeIR({
  employeeId: 1, year: 2026, month: 4,
  previousPayslips: [
    { employeeId: 1, year: 2026, month: 1, sni: 4000, irNet: 66.67 },
    { employeeId: 1, year: 2026, month: 2, sni: 4500, irNet: 116.66 },
    { employeeId: 1, year: 2026, month: 3, sni: 5000, irNet: 116.67 }
  ],
  currentSNI: 6000,
});
assert.equal(third.cumulativeSNI, 19500);
assert.equal(third.annualizedSNI, 58500);
assert.equal(third.annualIR, 1850);
assert.equal(third.cumulativeIRDue, 616.67);
assert.equal(third.previousIRWithheld, 300);
assert.equal(third.currentMonthIR, 316.67);

const differentEmployee = calculateCumulativeIR({
  employeeId: 1, year: 2026, month: 1,
  previousPayslips: [

  ],
  currentSNI: 4500,
});
assert.equal(differentEmployee.previousIRWithheld, 0);
assert.equal(differentEmployee.currentMonthIR, 116.67);

const newTaxYear = calculateCumulativeIR({
  employeeId: 1, year: 2026, month: 1,
  previousPayslips: [

  ],
  currentSNI: 4000,
});
assert.equal(newTaxYear.previousIRWithheld, 0);

console.log("Cumulative IR focused tests passed.");

// Deliberately mixed history: only earlier months of this employee/year count.
const history = [
  { employeeId: 1, year: 2026, month: 12, sni: 90000, irNet: 20000 },
  { employeeId: 2, year: 2027, month: 1, sni: 80000, irNet: 10000 },
  { employeeId: 1, year: 2027, month: 1, sni: 4000, irNet: 0 },
  { employeeId: 1, year: 2027, month: 2, sni: 70000, irNet: 10000 },
];
const january = calculateCumulativeIR({
  employeeId: 1, year: 2027, month: 1, previousPayslips: history, currentSNI: 4000,
});
assert.equal(january.cumulativeSNI, 4000);
assert.equal(january.previousIRWithheld, 0);
assert.equal(january.elapsedPeriods, 1);
const february = calculateCumulativeIR({
  employeeId: 1, year: 2027, month: 2, previousPayslips: history, currentSNI: 4500,
});
assert.equal(february.cumulativeSNI, 8500);
assert.equal(february.previousIRWithheld, 0);
assert.equal(february.elapsedPeriods, 2);
assert.throws(() => calculateCumulativeIR({ currentSNI: 4000 }), /CUMULATIVE_PERIOD_INVALID/);
console.log('Year, employee, and selected month isolation checks passed.');

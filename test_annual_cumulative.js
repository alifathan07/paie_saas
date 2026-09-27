import assert from 'node:assert/strict';
import { prisma } from './src/lib/db.js';
import { getAnnualPayrollCumulative } from './src/controllers/bulletins.controller.js';

const amounts = value => ({ workedDays: 26, sni: value, irNet: value / 10, cnss: 100, sbi: value + 500, amo: 50 });
const history = [
  { employeeId: 1, year: 2026, month: 12, status: 'CLOSED', ...amounts(90000) },
  { employeeId: 1, year: 2027, month: 1, status: 'VALIDATED', ...amounts(4000) },
  { employeeId: 1, year: 2027, month: 2, status: 'VALIDATED', ...amounts(4500) },
  { employeeId: 2, year: 2027, month: 1, status: 'VALIDATED', ...amounts(80000) },
];
const originalFindMany = prisma.payslip.findMany;
try {
  // Exercise the controller query and aggregation without writing to the database.
  prisma.payslip.findMany = async ({ where }) => {
    assert.equal(where.employeeId, 1);
    assert.ok(Number.isInteger(where.year));
    return history.filter(row => row.employeeId === where.employeeId && row.year === where.year &&
      row.month <= where.month.lte && where.OR.some(condition =>
        condition.month === row.month || condition.status?.in.includes(row.status)));
  };
  assert.deepEqual(await getAnnualPayrollCumulative(1, 2026, 12), amounts(90000));
  assert.deepEqual(await getAnnualPayrollCumulative(1, 2027, 1), amounts(4000));
  assert.deepEqual(await getAnnualPayrollCumulative(1, 2027, 2), {
    workedDays: 52, sni: 8500, irNet: 850, cnss: 200, sbi: 9500, amo: 100,
  });
  // A preview replaces January's saved row instead of counting it twice.
  assert.deepEqual(await getAnnualPayrollCumulative(1, 2027, 1, amounts(5000)), amounts(5000));
  assert.deepEqual(await getAnnualPayrollCumulative(1, 2028, 1), {
    workedDays: 0, sni: 0, irNet: 0, cnss: 0, sbi: 0, amo: 0,
  });
  console.log('Annual controller totals: year rollover, employee isolation, and preview checks passed.');
} finally {
  prisma.payslip.findMany = originalFindMany;
  await prisma.$disconnect();
}

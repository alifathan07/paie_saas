import assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import { prisma } from './src/lib/db.js';
import { showBulletin } from './src/controllers/bulletins.controller.js';
import { calculateCumulativeIR } from './src/payroll-engine/calculators/cumulativeIr.calculator.js';

const previous = { employeeId: 1, year: 2026, month: 8, workedDays: 26, sni: 4000, irNet: 0 };
const calculation = calculateCumulativeIR({ employeeId: 1, year: 2026, month: 9, previousPayslips: [previous], currentSNI: 4000 });
assert.equal(calculation.elapsedPeriods, 2);
assert.equal(calculateCumulativeIR({ employeeId: 1, year: 2027, month: 1, previousPayslips: [previous], currentSNI: 4000 }).elapsedPeriods, 1);
const saved = { ...previous, id: 2, month: 9, moisEcoules: calculation.elapsedPeriods, status: 'VALIDATED', bonuses: [] };
const original = [prisma.employee.findUnique, prisma.payslip.findUnique, prisma.payslip.findMany];
try {
    prisma.employee.findUnique = async () => ({ id: 1, nomComplet: 'Test Employee', dateEmbauche: new Date('2020-01-01'), bonuses: [] });
  prisma.payslip.findUnique = async () => saved;
  prisma.payslip.findMany = async () => [previous, saved];
  let rendered;
  await showBulletin({ params: { id: '1' }, query: { month: '9', year: '2026' }, session: { user: {} } }, {
    render: (view, locals) => { rendered = locals; },
    status: () => { throw new Error('Controller failed'); },
  });
  assert.equal(rendered.periode, 2);
  assert.equal(rendered.bulletin.periode, 2);
  assert.equal(rendered.annualCumulative.workedDays, 52);
  const template = fs.readFileSync('src/views/bulletins/show.ejs', 'utf8');
  ejs.compile(template);
  const field = template.match(/<strong data-result="periode">.*?<\/strong>/)[0];
  assert.ok(ejs.render(field, rendered).includes('>2</strong>'));
  console.log('September: 52 days, saved Période 2, display and yearly reset checks passed.');
} finally {
  [prisma.employee.findUnique, prisma.payslip.findUnique, prisma.payslip.findMany] = original;
  await prisma.$disconnect();
}

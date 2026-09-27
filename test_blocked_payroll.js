import assert from 'node:assert/strict';
import { calculatePayroll } from './src/payroll-engine/PayrollEngine.js';
import { prisma } from './src/lib/db.js';
import { generateBulkBulletins, generateBulletin, calculateLive } from './src/controllers/bulletins.controller.js';

const employee = {
    id: 7, companyId: 3, actif: true, blocageSaisiePaie: true,
    baseSalary: 18000, dateEmbauche: new Date('2010-01-01'), nbPersonacharge: 3,
    cimrRate: 0.06, cimrReduitBaseImposable: true, payslips: [],
    bonuses: [
        { amount: 900, bonus: { name: 'Prime', taxable: true } },
        { amount: 600, bonus: { name: 'Transport', taxable: false } },
    ],
};
const inputs = {
    month: 9, year: 2026, workedDays: 26, baseSalary: 22000,
    heuresSup25: 8, heuresSup50: 8, heuresSup100: 8, avances: 1000,
    variablePrimes: [{ label: 'Extra', amount: 500 }],
    monthlyNimpLines: [{ label: 'Extra NIMP', amount: 800 }],
    niimpOverrides: { Transport: 1500 }, bonusesNIMP: 900,
};
const zeroFields = ['workedDays', 'baseSalary', 'primeAnciennete', 'bonusesIMP', 'bonusesNIMP',
    'sbg', 'sbi', 'cnss', 'amo', 'cimr', 'fraisPro', 'sni', 'irBrut', 'irTheorique',
    'sommeADeduire', 'chargesDeFamille', 'irNet', 'netAPayer',
    'heuresSup25', 'heuresSup50', 'heuresSup100', 'avances'];
function assertZero(result) {
    for (const field of zeroFields) assert.equal(result[field], 0, field);
}
const calculated = calculatePayroll(employee, inputs);
assertZero(calculated);
assert.deepEqual(calculated.variablePrimes, []);
assert.deepEqual(calculated.nimpLines, []);
assert.equal(calculated.partPatronal, 0);
assert.equal(employee.baseSalary, 18000);
assert.equal(employee.bonuses.length, 2);
assert.ok(calculatePayroll({ ...employee, blocageSaisiePaie: false }, inputs).netAPayer > 0);

const originals = [];
function mock(target, key, value) {
    const original = target[key];
    originals.push(() => { target[key] = original; });
    target[key] = value;
}
let saved = [];
let bonusDeletes = 0;
const prior = { employeeId: 7, year: 2026, month: 8, status: 'VALIDATED',
    workedDays: 26, sni: 18000, irNet: 4000, cnss: 268.8, sbi: 20000, amo: 452 };
mock(prisma.payrollConfig, 'findFirst', async () => null);
mock(prisma.employee, 'findMany', async ({ where }) => {
    assert.deepEqual(where, { companyId: 3, actif: true });
    return [employee, { ...employee, id: 8, payslips: [{ id: 100, status: 'DRAFT' }] }];
});
mock(prisma.employee, 'findUnique', async () => employee);
mock(prisma.employee, 'update', async () => assert.fail('Must preserve blocked employee salary'));
mock(prisma.payslip, 'findMany', async () => [prior]);
mock(prisma.payslip, 'findUnique', async () => null);
mock(prisma.payslip, 'create', async ({ data }) => {
    assertZero(data);
    assert.equal(data.irPrecedent, 4000);
    assert.equal(data.sniCumule, 18000);
    saved.push(data);
    return { id: saved.length, ...data };
});
mock(prisma.payslip, 'update', async () => assert.fail('Bulk generation must preserve existing bulletins'));
mock(prisma.payslipBonus, 'deleteMany', async () => { bonusDeletes++; });
mock(prisma.payslipBonus, 'createMany', async () => assert.fail('Blocked payroll must have no payable bonuses'));
mock(prisma, '$transaction', async callback => callback(prisma));
const response = () => ({
    redirect(url) { this.url = url; },
    status(code) { this.code = code; return this; },
    send(body) { this.body = body; },
    json(body) { this.body = body; },
});
try {
    const req = { body: inputs, query: inputs, params: { id: '7' }, session: { companyId: 3 } };
    const bulkRes = response();
    await generateBulkBulletins(req, bulkRes);
    assert.equal(saved.length, 1);
    const result = JSON.parse(new URL(bulkRes.url, 'http://localhost').searchParams.get('bulkResult'));
    assert.deepEqual(result, { created: 1, skipped: 1, errors: [] });
    await generateBulletin(req, response());
    assert.equal(saved.length, 2);
    assert.equal(bonusDeletes, 2);
    const liveRes = response();
    await calculateLive(req, liveRes);
    assertZero({ ...liveRes.body, bonusesIMP: liveRes.body.variablePrimes.reduce((sum, prime) => sum + prime.amount, 0) });
    assert.equal(liveRes.body.annualCumulative.irNet, 4000);
    console.log('Blocked payroll checks passed: engine, bulk and single persistence, live preview, prior history, existing bulletins and normal payroll.');
} finally {
    for (const restore of originals.reverse()) restore();
    await prisma.$disconnect();
}

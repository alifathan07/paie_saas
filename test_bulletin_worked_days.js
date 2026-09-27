import assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import { prisma } from './src/lib/db.js';
import { calculatePayroll } from './src/payroll-engine/PayrollEngine.js';
import { updateBulletinWorkedDays } from './src/controllers/bulletins.controller.js';

const employee = { id: 7, companyId: 3, baseSalary: 25000, dateEmbauche: new Date('2015-01-01'), nbPersonacharge: 2, blocageSaisiePaie: false };
let existing = {
    id: 99, employeeId: 7, employee, month: 9, year: 2026, status: 'DRAFT',
    baseSalary: 12000, workedDays: 26, chargesDeFamille: 100,
    heuresSup25: 4, heuresSup50: 2, heuresSup100: 1, avances: 150,
    cnssRate: 0.0448, amoRate: 0.0226, cimrRate: 0.03,
    bonuses: [{ name: 'Prime enregistrée', amount: 500, taxable: true }, { name: 'Transport', amount: 700, taxable: false }],
};
const restore = [];
function mock(target, name, fn) {
    const original = target[name];
    restore.push(() => { target[name] = original; });
    target[name] = fn;
}
let reads = 0;
let updates = 0;
let conflict = false;
mock(prisma.payslip, 'findFirst', async ({ where }) => {
    reads++;
    assert.deepEqual(where, { employeeId: 7, month: 9, year: 2026, employee: { companyId: 3 } });
    return existing;
});
mock(prisma.payslip, 'findMany', async () => []);
mock(prisma.payslip, 'updateMany', async ({ where, data }) => {
    assert.deepEqual(where, { id: 99, status: existing.status, employee: { companyId: 3, blocageSaisiePaie: false } });
    if (conflict) return { count: 0 };
    updates++;
    existing = { ...existing, ...data };
    return { count: 1 };
});
mock(prisma.payslipBonus, 'deleteMany', async () => assert.fail('Saved bonus rows must remain intact'));
mock(prisma.employee, 'update', async () => assert.fail('Contractual salary must remain intact'));
async function request(method = 'GET', days = '13') {
    const values = { month: '9', year: '2026', workedDays: days };
    const req = { method, params: { id: '7' }, body: values, query: values, session: { companyId: 3 } };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await updateBulletinWorkedDays(req, res);
    return res;
}
try {
    const expected = calculatePayroll({ ...employee, bonuses: [], cimrRate: 0.03 }, {
        month: 9, year: 2026, baseSalary: 12000, workedDays: 13, dependents: 2,
        heuresSup25: 4, heuresSup50: 2, heuresSup100: 1, avances: 150,
        variablePrimes: [{ label: 'Prime enregistrée', amount: 500 }],
        monthlyNimpLines: [{ label: 'Transport', amount: 700 }],
    });
    const preview = (await request()).body;
    assert.equal(preview.ok, true);
    assert.equal(preview.saved, false);
    assert.equal(updates, 0);
    assert.equal(existing.workedDays, 26);
    for (const key of ['sbi', 'sbg', 'bonusesIMP', 'bonusesNIMP', 'heuresSupAmount', 'avances', 'cimr']) {
        assert.equal(preview.payroll[key], expected[key], key);
    }
    const bonuses = existing.bonuses;
    const saved = (await request('POST')).body;
    assert.equal(saved.saved, true);
    assert.equal(existing.workedDays, 13);
    assert.equal(existing.sbi, preview.payroll.sbi);
    assert.equal(existing.netAPayer, preview.payroll.netAPayer);
    assert.equal(existing.baseSalary, 12000);
    assert.equal(existing.status, 'DRAFT');
    assert.equal(existing.bonuses, bonuses);
    assert.equal((await request()).body.payroll.sbi, existing.sbi);
    assert.equal((await request('POST', '0')).body.payroll.workedDays, 0);
    const beforeReads = reads;
    for (const days of ['', '-1', '27', '1.5', 'abc']) assert.equal((await request('POST', days)).code, 400);
    assert.equal(reads, beforeReads);
    for (const status of ['VALIDATED', 'CLOSED', 'ERROR']) {
        existing.status = status;
        assert.equal((await request()).code, 403);
        assert.equal((await request('POST')).code, 403);
    }
    existing.status = 'GENERATED';
    existing.employee.blocageSaisiePaie = true;
    assert.equal((await request('POST')).code, 403);
    existing.employee.blocageSaisiePaie = false;
    conflict = true;
    assert.equal((await request('POST')).code, 409);
    existing = null;
    assert.equal((await request('POST')).code, 404);

    const source = fs.readFileSync('src/views/bulletins/index.ejs', 'utf8');
    const table = source.slice(source.indexOf('<!-- Employees payroll table -->'), source.indexOf('<script src='));
    for (const [status, blocked, editable] of [['draft', false, true], ['generated', false, true], ['validated', false, false], ['closed', false, false], ['draft', true, false], ['none', false, false]]) {
        const html = ejs.render(table, { month: 9, year: 2026, fmt: String, employees: [{
            id: 7, nom: 'Test', prenom: 'Employé', matricule: '7', baseSalary: 12000,
            blocageSaisiePaie: blocked, bulletinStatus: status,
            bulletin: status === 'none' ? null : { status, workedDays: 13, sbi: 6500, netAPayer: 6000 },
        }] });
        assert.equal(html.includes('class="worked-days-form"'), editable);
        assert.ok(html.includes('Brut imposable'));
        assert.ok(!html.includes('<th>indemnité</th>'));
    }
    console.log('Working days checks passed: preview/save parity, preserved inputs, persistence, validation, locks, company scope, concurrent locking and row rendering.');
} finally {
    for (const fn of restore.reverse()) fn();
    await prisma.$disconnect();
}

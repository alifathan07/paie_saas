import assert from 'node:assert/strict';
import { calculateNormalMonth, findBaseForNet } from './src/payroll-engine/netToBase.js';
import { calculateNetToBase } from './src/controllers/netToBase.controller.js';
import { prisma } from './src/lib/db.js';
import { createEmployee, updateEmployee } from './src/services/employeeService.js';

const period = { month: 9, year: 2026 };
const basic = { id: 7, dateEmbauche: new Date('2026-09-01'), nbPersonacharge: 0, bonuses: [] };
let checked = 0;
for (const employee of [basic,
    { ...basic, dateEmbauche: new Date('2018-01-01'), bonuses: [{ name: 'Transport', taxable: false, amount: 500 }, { name: 'Panier', taxable: false, amount: 1500 }] },
    { ...basic, dateEmbauche: new Date('1998-01-01'), nbPersonacharge: 3, cimrRate: 0.06, cimrReduitBaseImposable: true },
    { ...basic, cimrRate: 0.2, bonuses: [{ name: 'Prime', taxable: true, amount: 6499 }] },
]) {
    for (const base of [0, 0.01, 1.01, 2500, 5999.99, 6000, 6000.01, 6499.99, 6500, 6500.01, 10000, 11666.68, 12000, 30000, 100000]) {
        const original = structuredClone(employee);
        const forward = calculateNormalMonth(employee, base, period);
        const result = findBaseForNet(employee, forward.netAPayer, period);
        assert.equal(result.exact, true, `net ${forward.netAPayer}, base ${base}`);
        assert.equal(result.payroll.netAPayer, forward.netAPayer);
        assert.ok(result.baseSalary <= base, 'Choose the lowest base when several match');
        assert.deepEqual(employee, original);
        checked++;
    }
}
// Match the complete annualized tax path, not the raw engine's first monthly IR.
assert.ok(calculateNormalMonth(basic, 12000, period).irNet > 0);
const blocked = { ...basic, blocageSaisiePaie: true };
assert.throws(() => findBaseForNet(blocked, 1000, period), /bloquée/);
assert.throws(() => findBaseForNet({ ...basic, bonuses: [{ name: 'Transport', amount: 500, taxable: false }] }, 499, period), /minimum/);
// Brute-force a small range to verify closest-match and lowest-base tie behavior.
const senior = { ...basic, dateEmbauche: new Date('1998-01-01') };
const candidates = Array.from({ length: 301 }, (_, i) => ({ base: i / 100, net: calculateNormalMonth(senior, i / 100, period).netAPayer }));
for (const target of [0.01, 0.03, 0.27, 0.48, 1.01, 1.37]) {
    const expected = [...candidates].sort((a, b) => Math.abs(Math.round(a.net * 100) - Math.round(target * 100)) - Math.abs(Math.round(b.net * 100) - Math.round(target * 100)) || a.base - b.base)[0];
    const result = findBaseForNet(senior, target, period);
    assert.equal(result.baseSalary, expected.base);
    assert.equal(result.payroll.netAPayer, expected.net);
}

const restore = [];
function mock(target, key, fn) { const original = target[key]; restore.push(() => { target[key] = original; }); target[key] = fn; }
const catalog = [{ id: 1, companyId: 3, name: 'Transport', taxable: false }, { id: 2, companyId: 3, name: 'Prime imposable', taxable: true }];
mock(prisma.bonus, 'findMany', async ({ where }) => { assert.deepEqual(where, { companyId: 3 }); return catalog; });
mock(prisma.employee, 'findFirst', async ({ where }) => where.id === 7 && where.companyId === 3 ? { id: 7 } : null);
mock(prisma.company, 'findFirst', async () => ({ id: 3 }));
for (const model of [prisma.employee, prisma.bonus, prisma.employeeBonus, prisma.payslip]) {
    for (const method of ['create', 'update', 'deleteMany']) mock(model, method, async () => assert.fail('Calculation must not write to the database'));
}
const body = { targetNet: 10000, dateEmbauche: '2018-01-01', nbPersonacharge: 2, cimrRate: '',
    cimrReduitBaseImposable: false, blocageSaisiePaie: false,
    indemnities: [{ bonusId: 1, amount: 500 }, { name: 'Panier', amount: 200 }], taxableBonuses: [] };
async function request(changes = {}, session = { companyId: 3 }) {
    const res = { status(code) { this.code = code; return this; }, json(data) { this.body = data; } };
    await calculateNetToBase({ body: { ...body, ...changes }, session }, res);
    return res;
}
try {
    const result = (await request()).body;
    assert.equal(result.ok, true);
    assert.equal(result.payroll.bonusesNIMP, 700);
    assert.equal(result.indemnities[1].name, 'Panier');
    assert.equal(result.workedDays, 26);
    assert.equal(result.payroll.avances, 0);
    assert.equal((await request({ employeeId: 7 })).body.ok, true);
    assert.equal((await request({ employeeId: 8 })).code, 404);
    assert.equal((await request({}, {})).body.ok, true);
    assert.equal((await request({ blocageSaisiePaie: true })).code, 403);
    for (const changes of [
        { targetNet: '' }, { targetNet: -1 }, { targetNet: 'abc' }, { targetNet: 1.234 },
        { dateEmbauche: '2026-02-31' }, { nbPersonacharge: 7 }, { cimrRate: 0.3 },
        { indemnities: [{ bonusId: 999, amount: 500 }] },
        { indemnities: [{ bonusId: 2, amount: 500 }] },
        { indemnities: [{ name: 'Prime imposable', amount: 500 }] },
        { indemnities: [{ bonusId: 1, amount: 500 }, { name: 'transport', amount: 200 }] },
        { indemnities: [{ name: '<b>Panier</b>', amount: -1 }] },
        { targetNet: 100 },
    ]) assert.equal((await request(changes)).code, 400, JSON.stringify(changes));
    const taxable = (await request({ taxableBonuses: [{ bonusId: 2, amount: 1000 }] })).body;
    assert.equal(taxable.payroll.bonusesIMP, 1000);
    const normalized = (await request({ indemnities: [{ name: 'transport', amount: 500 }] })).body;
    assert.equal(normalized.indemnities[0].bonusId, 1);

    // The applied result uses the existing employee save service, including new definitions.
    let createdDefinitions = 0;
    mock(prisma.bonus, 'findUnique', async ({ where }) => catalog.find(b => b.id === where.id || (where.companyId_name?.companyId === b.companyId && where.companyId_name?.name === b.name)) || null);
    mock(prisma.bonus, 'create', async ({ data }) => { createdDefinitions++; assert.equal(data.taxable, false); const value = { id: 10, ...data }; catalog.push(value); return value; });
    const employeeData = { nom: 'Test', prenom: 'Employee', companyId: 3, dateNaissance: '1990-01-01', dateEmbauche: body.dateEmbauche,
        baseSalary: result.baseSalary, bonusList: result.indemnities, cimrReduitBaseImposable: true };
    let stored;
    mock(prisma.employee, 'create', async ({ data }) => { stored = data; return { id: 7, ...data }; });
    await createEmployee(employeeData);
    assert.equal(stored.baseSalary, result.baseSalary);
    assert.deepEqual(stored.bonuses.create, [{ bonusId: 1, amount: 500 }, { bonusId: 10, amount: 200 }]);
    assert.equal(createdDefinitions, 1);
    mock(prisma.employee, 'findUnique', async () => ({ companyId: 3 }));
    mock(prisma.employeeBonus, 'deleteMany', async () => ({ count: 2 }));
    mock(prisma.employee, 'update', async ({ data }) => { stored = data; return { id: 7, ...data }; });
    await updateEmployee(7, employeeData);
    assert.equal(createdDefinitions, 1);
    assert.equal(stored.cimrReduitBaseImposable, true);
    assert.equal(stored.bonuses.create.length, 2);
    console.log(`Net-to-base checks passed: ${checked} round trips, closest-cent search, thresholds, scope, invalid input, read-only calculation and existing employee save integration.`);
} finally {
    for (const undo of restore.reverse()) undo();
    await prisma.$disconnect();
}

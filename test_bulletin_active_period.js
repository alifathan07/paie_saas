lleimport assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import { prisma } from './src/lib/db.js';
import { getActiveBulletinPeriod, isAfterActivePeriod } from './src/lib/bulletinPeriod.js';
import { enforceBulletinPeriod } from './middlewares/bulletinPeriod.js';

const now = new Date(2026, 8, 15);
assert.deepEqual(getActiveBulletinPeriod([], now), { month: 9, year: 2026 });
for (const status of ['DRAFT', 'GENERATED', 'ERROR', 'VALIDATED']) {
    const active = getActiveBulletinPeriod([{ month: 8, year: 2026, status }], now);
    assert.deepEqual(active, { month: 8, year: 2026 });
    assert.equal(isAfterActivePeriod({ month: 9, year: 2026 }, active), true);
    assert.equal(isAfterActivePeriod({ month: 7, year: 2026 }, active), false);
}
for (const status of ['CLOSED']) {
    assert.deepEqual(getActiveBulletinPeriod([{ month: 8, year: 2026, status }], now), { month: 9, year: 2026 });
    assert.deepEqual(getActiveBulletinPeriod([{ month: 12, year: 2026, status }], now), { month: 1, year: 2027 });
}
assert.deepEqual(getActiveBulletinPeriod([
    { month: 8, year: 2026, status: 'DRAFT' },
    { month: 9, year: 2026, status: 'CLOSED' },
], now), { month: 8, year: 2026 });

const original = prisma.payslip.findMany;
let rows = [{ month: 8, year: 2026, status: 'DRAFT' }];
prisma.payslip.findMany = async args => {
    assert.deepEqual(args.where, { employee: { companyId: 7 } });
    return rows;
};
async function request({ month = '9', year = '2026', method = 'GET', path = '/', json = false, session = { companyId: 7 } } = {}) {
    let passed = false;
    const req = { method, path, query: method === 'GET' ? { month, year } : {}, body: method === 'POST' ? { month, year } : {}, session, get: () => json ? 'application/json' : 'text/html' };
    const res = { locals: {}, status(code) { this.code = code; return this; }, send(body) { this.body = body; }, json(body) { this.body = body; }, redirect(url) { this.url = url; } };
    await enforceBulletinPeriod(req, res, () => { passed = true; });
    return { res, req, passed };
}
try {
    let result = await request();
    assert.equal(result.res.url, '/bulletins?month=8&year=2026');
    assert.match(result.req.session.bulletinPeriodMessage, /8\/2026.*9\/2026/);
    result = await request({ month: '8', session: result.req.session });
    assert.equal(result.passed, true);
    assert.match(result.res.locals.bulletinPeriodMessage, /clôturer/);
    assert.equal(result.req.session.bulletinPeriodMessage, undefined);
    assert.equal((await request({ month: '7' })).passed, true);
    assert.equal((await request({ path: '/12' })).res.url, '/bulletins/12?month=8&year=2026');
    assert.equal((await request({ path: '/12/period' })).passed, false);
    assert.equal((await request({ method: 'POST', path: '/generate-bulk' })).passed, false);
    result = await request({ method: 'POST', path: '/12/primes', json: true });
    assert.equal(result.res.code, 409);
    assert.match(result.res.body.error, /8\/2026/);
    assert.equal((await request({ month: '13' })).res.code, 400);
    rows = [{ month: 8, year: 2026, status: 'VALIDATED' }];
    assert.equal((await request()).passed, false);
    assert.equal((await request({ month: '8' })).passed, true);
    for (const status of ['CLOSED']) {
        rows = [{ month: 8, year: 2026, status }];
        assert.equal((await request()).passed, true);
        assert.equal((await request({ month: '10' })).passed, false);
    }
    rows.push({ month: 8, year: 2026, status: 'VALIDATED' });
    assert.equal((await request()).passed, false);
    rows = [];
    const active = getActiveBulletinPeriod(rows);
    // Explicitly test the default path without period query parameters.
    const req = { method: 'GET', path: '/', query: {}, session: { companyId: 7 } };
    const res = { locals: {}, redirect(url) { this.url = url; } };
    await enforceBulletinPeriod(req, res, () => assert.fail('Expected default period redirect'));
    assert.equal(res.url, `/bulletins?month=${active.month}&year=${active.year}`);
    for (const name of ['show', 'index']) ejs.compile(fs.readFileSync(`src/views/bulletins/${name}.ejs`, 'utf8'));
    console.log('Active period checks passed: empty data, drafts, backwards navigation, filters, direct URLs, writes, popup, closure-only progression, company isolation and year rollover.');
} finally {
    prisma.payslip.findMany = original;
    await prisma.$disconnect();
}

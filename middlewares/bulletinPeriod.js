import { prisma } from '../src/lib/db.js';
import { resolveCompanyId } from '../src/lib/company.js';
import { getActiveBulletinPeriod, isAfterActivePeriod } from '../src/lib/bulletinPeriod.js';

export async function enforceBulletinPeriod(req, res, next) {
    try {
        const companyId = await resolveCompanyId(req);
        if (!companyId) return res.status(400).send('Aucune entreprise associée à cette session.');
        const rows = await prisma.payslip.findMany({
            where: { employee: { companyId } },
            select: { month: true, year: true, status: true },
            distinct: ['year', 'month', 'status'],
        });
        const active = getActiveBulletinPeriod(rows);
        res.locals.activeBulletinPeriod = active;
        const input = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
        const employeePath = /^\/(\d+)(?:\/|$)/.exec(req.path);
        const destination = employeePath ? `/bulletins/${employeePath[1]}` : '/bulletins';
        const activeUrl = `${destination}?month=${active.month}&year=${active.year}`;
        if (input.month === undefined && input.year === undefined && req.method === 'GET') {
            return res.redirect(activeUrl);
        }
        const month = Number(input.month);
        const year = Number(input.year);
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2040) {
            return res.status(400).send('Période invalide.');
        }
        if (isAfterActivePeriod({ month, year }, active)) {
            const message = `Veuillez clôturer le mois ${active.month}/${active.year} avant de passer au mois ${month}/${year}.`;
            if (req.get('Accept')?.includes('application/json')) {
                return res.status(409).json({ ok: false, error: message, activePeriod: active });
            }
            req.session.bulletinPeriodMessage = message;
            return res.redirect(activeUrl);
        }
        const isPage = req.method === 'GET' && /^\/(?:\d+)?\/?$/.test(req.path);
        if (isPage) {
            res.locals.bulletinPeriodMessage = req.session.bulletinPeriodMessage || null;
            delete req.session.bulletinPeriodMessage;
        }
        return next();
    } catch (error) {
        console.error('Bulletin period check failed:', error);
        return res.status(500).send('Impossible de vérifier la période de paie. Veuillez réessayer.');
    }
}

import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';

import { auth } from './src/routes/auth.js';
import { dashboard } from './src/routes/dashboard.js';
import { employee } from './src/routes/employee.js';
import { bulletins } from './src/routes/bulletins.js';
import { editions } from './src/routes/editions.js';
import { admin } from './src/routes/admin.js';
import { companies } from './src/routes/companies.js';
import { parametrage } from './src/routes/parametrage.js';
import { indemnites } from './src/routes/indemnites.js';
import { primes } from './src/routes/primes.js';
import { rubriques } from './src/routes/rubriques.js';
import { avances } from './src/routes/avances.js';
import { reports } from './src/routes/reports.js';
import { profile } from './src/routes/profile.js';
import { isAuth, requireActiveCompany } from './middlewares/auth.js';
import { isAdminUser } from './middlewares/admin.js';
import { securityHeaders, sameOriginProtection } from './middlewares/security.js';
import { prisma } from './src/lib/db.js';
import { getActiveBulletinPeriod, isAfterActivePeriod } from './src/lib/bulletinPeriod.js';

export const app = express();
export const PORT = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'development-only-change-me');
if (!sessionSecret) throw new Error('SESSION_SECRET must be configured in production');

const MySQLStore = expressMySQLSession(session);
const sessionStore = new MySQLStore({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'paie',
    createDatabaseTable: true,
    clearExpired: true,
});

app.use(express.static('public'));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', './src/views');
app.set('trust proxy', 1);

// app.use(securityHeaders);
// app.use(sameOriginProtection);

app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 2, // 2 hours
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: process.env.SESSION_SAME_SITE || 'lax',
    }
}));

app.use(async (req, res, next) => {
    res.locals.clientMode = req.session?.adminClientMode || null;
    res.locals.isAdmin = isAdminUser(req);
    next();
});

// Public routes (login/logout)
app.use('/auth', auth);

// Protected routes (require login)
app.use(isAuth);
app.use('/profile', profile);
app.use('/admin', admin);
app.use('/companies', companies);
app.use(requireActiveCompany);

const PERIOD_MONTH_NAMES = [
    "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function validPeriod(month, year) {
    const parsedMonth = Number(month);
    const parsedYear = Number(year);
    return Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12
        && Number.isInteger(parsedYear) && parsedYear >= 2020 && parsedYear <= 2040
        ? { month: parsedMonth, year: parsedYear }
        : null;
}

app.use(async (req, res, next) => {
    // The navbar's /period endpoint is the only place allowed to change the
    // active period. Every other page consumes the saved session period.
    const requestedPeriod = req.path === "/period"
        ? validPeriod(req.query?.month, req.query?.year)
        : null;
    const savedPeriod = validPeriod(req.session.selectedPeriod?.month, req.session.selectedPeriod?.year);
    const period = requestedPeriod || savedPeriod || { month: new Date().getMonth() + 1, year: new Date().getFullYear() };

    if (requestedPeriod) req.session.selectedPeriod = requestedPeriod;
    if (req.query.month !== String(period.month) || req.query.year !== String(period.year)) {
        req.query.month = String(period.month);
        req.query.year = String(period.year);
    }

    const returnParams = new URLSearchParams(req.query);
    returnParams.delete("month");
    returnParams.delete("year");
    const returnQuery = returnParams.toString();
    const returnPath = req.path.replace(/\/pdf$/, "") || "/dashboard";

    res.locals.periodMonth = period.month;
    res.locals.periodYear = period.year;
    res.locals.periodMonthNames = PERIOD_MONTH_NAMES;
    res.locals.periodReturnTo = `${returnPath}${returnQuery ? `?${returnQuery}` : ""}`;
    res.locals.periodChangeMessage = req.session.periodChangeMessage || null;
    delete req.session.periodChangeMessage;
    try {
        const activeCompany = await prisma.company.findUnique({ where: { id: Number(req.activeCompanyId) }, select: { name: true } });
        res.locals.activeCompanyName = activeCompany?.name || req.session.adminClientMode?.companyName || "Société active";
    } catch {
        res.locals.activeCompanyName = req.session.adminClientMode?.companyName || "Société active";
    }
    next();
});

app.get('/period', async (req, res) => {
    const returnTo = typeof req.query.returnTo === 'string' && req.query.returnTo.startsWith('/') && !req.query.returnTo.startsWith('//')
        ? req.query.returnTo
        : '/bulletins';
    const selectedPeriod = validPeriod(req.query.month, req.query.year);
    if (!selectedPeriod) return res.status(400).send('Période invalide.');

    const rows = await prisma.payslip.findMany({
        where: { employee: { companyId: Number(req.activeCompanyId) } },
        select: { month: true, year: true, status: true },
    });
    const activePeriod = getActiveBulletinPeriod(rows);
    const blocked = isAfterActivePeriod(selectedPeriod, activePeriod);
    const targetPeriod = blocked ? activePeriod : selectedPeriod;
    if (blocked) {
        req.session.periodChangeMessage = `Veuillez clôturer le mois ${activePeriod.month}/${activePeriod.year} avant de passer au mois ${selectedPeriod.month}/${selectedPeriod.year}.`;
    }
    req.session.selectedPeriod = targetPeriod;

    const destination = new URL(returnTo, 'http://paie.local');
    destination.searchParams.set('month', String(targetPeriod.month));
    destination.searchParams.set('year', String(targetPeriod.year));
    return req.session.save(error => {
        if (error) return res.status(500).send("Impossible d'enregistrer la période active.");
        return res.redirect(`${destination.pathname}${destination.search}`);
    });
});

app.use('/parametrage', parametrage);
app.use('/indemnites', indemnites);
app.use('/primes', primes);
app.use('/rubriques', rubriques);
app.use('/avances', avances);
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/dashboard', dashboard);
app.use('/employees', employee);
app.use('/bulletins', bulletins);
app.use('/editions', editions);
app.use('/reports', reports);

app.listen(PORT,  () => {
    console.log(`[Local Network] Server is running locally on http://192.168.100.4:${PORT}`);
});

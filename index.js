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
import { reports } from './src/routes/reports.js';
import { isAuth, requireActiveCompany } from './middlewares/auth.js';
import { isAdminUser } from './middlewares/admin.js';
import { securityHeaders, sameOriginProtection } from './middlewares/security.js';

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

app.use(securityHeaders);
app.use(sameOriginProtection);

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

app.use((req, res, next) => {
    res.locals.clientMode = req.session?.adminClientMode || null;
    res.locals.isAdmin = isAdminUser(req);
    next();
});

// Public routes (login/logout)
app.use('/auth', auth);

// Protected routes (require login)
app.use(isAuth);
app.use('/admin', admin);
app.use('/companies', companies);
app.use(requireActiveCompany);
app.use('/parametrage', parametrage);
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/dashboard', dashboard);
app.use('/employees', employee);
app.use('/bulletins', bulletins);
app.use('/editions', editions);
app.use('/reports', reports);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

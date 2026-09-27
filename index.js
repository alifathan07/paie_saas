import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';

import { auth } from './src/routes/auth.js';
import { dashboard } from './src/routes/dashboard.js';
import { employee } from './src/routes/employee.js';
import { bulletins } from './src/routes/bulletins.js';
import { isAuth } from './middlewares/auth.js';

export const app = express();
export const PORT = process.env.PORT || 3000;

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', './src/views');

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 2, // 2 hours
        secure: false, // set to true if using HTTPS
        httpOnly: true
    }
}));

// Public routes (login/logout)
app.use('/auth', auth);

// Protected routes (require login)
app.use(isAuth);
app.get('/', (req, res) => res.redirect('/dashboard'));
app.use('/dashboard', dashboard);
app.use('/employees', employee);
app.use('/bulletins', bulletins);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

import { prisma } from '../lib/db.js';
import { resolveCompanyId } from '../lib/company.js';
import { findBaseForNet, MAX_SALARY } from '../payroll-engine/netToBase.js';

function amount(value, label) {
    if (!['string', 'number'].includes(typeof value) || String(value).trim() === '') throw new Error(`${label} est requis.`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > MAX_SALARY
        || Math.abs(number * 100 - Math.round(number * 100)) > 0.0001) {
        throw new Error(`${label} doit être un montant positif ou nul à deux décimales maximum.`);
    }
    return number;
}

export async function calculateNetToBase(req, res) {
    try {
        const companyId = Number(await resolveCompanyId(req));
        if (!Number.isInteger(companyId) || companyId <= 0) return res.status(400).json({ ok: false, error: 'Aucune entreprise sélectionnée.' });
        const body = req.body || {};
        if (body.employeeId !== undefined && body.employeeId !== null) {
            if (!Number.isInteger(Number(body.employeeId)) || Number(body.employeeId) <= 0) throw new Error('Employé invalide.');
            const employee = await prisma.employee.findFirst({ where: { id: Number(body.employeeId), companyId }, select: { id: true } });
            if (!employee) return res.status(404).json({ ok: false, error: 'Employé introuvable.' });
        }
        if (typeof body.blocageSaisiePaie !== 'boolean' || typeof body.cimrReduitBaseImposable !== 'boolean') throw new Error('Paramètres de paie invalides.');
        if (body.blocageSaisiePaie) return res.status(403).json({ ok: false, error: 'La saisie de paie est bloquée pour cet employé.' });
        const targetNet = amount(body.targetNet, 'Le net souhaité');
        const date = new Date(`${body.dateEmbauche}T12:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dateEmbauche || '') || !Number.isFinite(date.getTime())
            || date.toISOString().slice(0, 10) !== body.dateEmbauche) throw new Error("Renseignez une date d'embauche valide dans la fiche.");
        const dependents = Number(body.nbPersonacharge);
        if (!Number.isInteger(dependents) || dependents < 0 || dependents > 6) throw new Error('Le nombre de personnes à charge doit être compris entre 0 et 6.');
        const cimrRate = body.cimrRate === '' || body.cimrRate === null ? 0 : Number(body.cimrRate);
        if (!Number.isFinite(cimrRate) || cimrRate < 0 || cimrRate > 0.2) throw new Error('Le taux CIMR doit être compris entre 0 et 0,2.');
        const indemnities = body.indemnities;
        const taxableBonuses = body.taxableBonuses || [];
        if (!Array.isArray(indemnities) || !Array.isArray(taxableBonuses) || indemnities.length + taxableBonuses.length > 100) throw new Error('Liste des indemnités invalide (100 lignes maximum).');
        const catalog = await prisma.bonus.findMany({ where: { companyId }, select: { id: true, name: true, taxable: true } });
        const names = new Set();
        const normalize = (item, taxable) => {
            if (!item || typeof item !== 'object') throw new Error('Indemnité invalide.');
            const value = amount(item.amount, "Le montant de l'indemnité");
            if (value <= 0) throw new Error('Le montant de chaque prime ou indemnité doit être supérieur à zéro.');
            let definition;
            if (item.bonusId !== undefined) {
                definition = catalog.find(bonus => bonus.id === Number(item.bonusId));
                if (!definition || definition.taxable !== taxable) throw new Error('Prime ou indemnité non autorisée pour cette entreprise.');
            } else {
                if (taxable || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 191) throw new Error("Renseignez un nom d'indemnité valide (191 caractères maximum).");
                definition = catalog.find(bonus => bonus.name.toLocaleLowerCase() === item.name.trim().toLocaleLowerCase());
                if (definition?.taxable) throw new Error('Ce nom existe déjà pour une prime imposable. Choisissez un autre nom.');
            }
            const name = definition?.name || item.name.trim();
            const key = name.toLocaleLowerCase();
            if (names.has(key)) throw new Error(`La prime ou indemnité « ${name} » est présente plusieurs fois.`);
            names.add(key);
            return { ...(definition ? { bonusId: definition.id } : {}), name, amount: value, taxable };
        };
        const lines = [...indemnities.map(item => normalize(item, false)), ...taxableBonuses.map(item => normalize(item, true))];
        if (lines.reduce((sum, line) => sum + line.amount, 0) > MAX_SALARY) throw new Error('Le total des primes et indemnités est trop élevé.');
        const now = new Date();
        const period = { month: now.getMonth() + 1, year: now.getFullYear() };
        const employee = {
            id: Number(body.employeeId) || 1, dateEmbauche: date, nbPersonacharge: dependents,
            cimrRate, cimrReduitBaseImposable: body.cimrReduitBaseImposable,
            blocageSaisiePaie: false, bonuses: lines,
        };
        const result = findBaseForNet(employee, targetNet, period);
        return res.json({ ok: true, ...result, indemnities: lines.filter(line => !line.taxable), period, workedDays: 26 });
    } catch (error) {
        // Validation and unreachable-target errors are returned without writing any data.
        if (error.code || error.name?.startsWith('Prisma')) {
            console.error('Net-to-base calculation failed:', error);
            return res.status(500).json({ ok: false, error: 'Impossible de calculer le salaire pour le moment.' });
        }
        return res.status(400).json({ ok: false, error: error.message });
    }
}

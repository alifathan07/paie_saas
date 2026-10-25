import {
    getEmployees,
    getEmployee,
    createEmployee as createEmp,
    updateEmployee as updateEmp,
    deleteEmployee as deleteEmp,
    getAllBonusTypes
    ,createTaxablePrime
    ,getEmployeeCategories
    ,getEmployeeFunctions
    ,setEmployeeTaxablePrime
} from "../services/employeeService.js";
import { calculatePayroll } from "../payroll-engine/PayrollEngine.js";
import { resolveCompanyId } from "../lib/company.js";
import {
    listIndemnites,
    getRepresentationRate,
    saveEmployeeIndemnites,
    createIndemnite,
    removeEmployeeIndemnite,
    setEmployeeIndemnite,
} from "../services/indemniteService.js";

const getSessionCompanyId = async (req) => resolveCompanyId(req);

// GET /employees — List all employees
export const listEmployees = async (req, res) => {
    try {
        const companyId = await getSessionCompanyId(req);
        const { search, categoryId } = req.query;
        const employees = await getEmployees({ search, categoryId, companyId });
        const categories = await getEmployeeCategories(companyId);
        const functions = await getEmployeeFunctions(companyId);

        res.render("employees/index", {
            title: "Liste des employés",
            currentPage: "employees",
            user: req.session.user,
            employees,
            search: search || '',
            categoryId: categoryId || '',
            categories,
            functions
        });
    } catch (error) {
        console.error("Error listing employees:", error);
        res.status(500).render("employees/index", {
            title: "Liste des employés",
            currentPage: "employees",
            user: req.session.user,
            employees: [],
            search: '',
            categoryId: '',
            categories: [],
            error: "Impossible de charger la liste des employés"
        });
    }
};

// GET /employees/create — Show create form
export const renderCreateForm = async (req, res) => {
    try {
        const companyId = await getSessionCompanyId(req);
        const bonusTypes = await getAllBonusTypes(companyId);
        const categories = await getEmployeeCategories(companyId);
        const functions = await getEmployeeFunctions(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);
        res.render("employees/create", {
            title: "Nouveau Salarié",
            currentPage: "employees",
            user: req.session.user,
            bonusTypes,
            categories,
            functions,
            indemnites,
            representationAvailable: indemnites.some(item => item.isRepresentation),
            defaultRepresentationRate: Number((representationRate * 100).toFixed(2)),
            error: null
        });
    } catch (error) {
        console.error("Error rendering create form:", error);
        res.redirect("/employees");
    }
};

// POST /employees/create — Create new employee
export const handleCreateEmployee = async (req, res) => {
    const companyId = await getSessionCompanyId(req);

    try {
        const {
            bonusIds, bonusAmounts,
            customBonusNames, customBonusAmounts,
            employeePrimeIds, employeePrimeAmounts,
            employeePrimeLeaveIds,
            employeePrimeHolidayIds,
            newPrimeNames, newPrimeAmounts, newPrimeCodes,
            employeeIndemniteIds, employeeIndemniteAmounts,
            newIndemniteNames, newIndemniteAmounts, newIndemniteCodes,
            ...employeeData
        } = req.body;
        const bonusList = [];

        const primeIds = employeePrimeIds ? (Array.isArray(employeePrimeIds) ? employeePrimeIds : [employeePrimeIds]) : [];
        const primeAmounts = employeePrimeAmounts ? (Array.isArray(employeePrimeAmounts) ? employeePrimeAmounts : [employeePrimeAmounts]) : [];
        const primeLeaveIds = new Set(employeePrimeLeaveIds ? (Array.isArray(employeePrimeLeaveIds) ? employeePrimeLeaveIds : [employeePrimeLeaveIds]) : []);
        const primeHolidayIds = new Set(employeePrimeHolidayIds ? (Array.isArray(employeePrimeHolidayIds) ? employeePrimeHolidayIds : [employeePrimeHolidayIds]) : []);
        primeIds.forEach((bonusId, index) => {
            if (bonusId && primeAmounts[index] && Number(primeAmounts[index]) > 0) {
                bonusList.push({ bonusId, amount: primeAmounts[index], implementerEnConge: primeLeaveIds.has(String(bonusId)), implementerEnJourFerie: primeHolidayIds.has(String(bonusId)) });
            }
        });
        const primeNames = newPrimeNames ? (Array.isArray(newPrimeNames) ? newPrimeNames : [newPrimeNames]) : [];
        const primeDefaults = newPrimeAmounts ? (Array.isArray(newPrimeAmounts) ? newPrimeAmounts : [newPrimeAmounts]) : [];
        const primeCodes = newPrimeCodes ? (Array.isArray(newPrimeCodes) ? newPrimeCodes : [newPrimeCodes]) : [];
        for (let i = 0; i < primeNames.length; i += 1) {
            if (!String(primeNames[i] || '').trim() || !primeDefaults[i] || Number(primeDefaults[i]) <= 0) continue;
            const definition = await createTaxablePrime(primeNames[i], primeDefaults[i], companyId, primeCodes[i]);
            bonusList.push({ bonusId: definition.id, amount: primeDefaults[i] });
        }

        // Indemnities selected from the employee picker.
        if (employeeIndemniteIds) {
            const ids = Array.isArray(employeeIndemniteIds) ? employeeIndemniteIds : [employeeIndemniteIds];
            const amounts = Array.isArray(employeeIndemniteAmounts)
                ? employeeIndemniteAmounts
                : [employeeIndemniteAmounts || []];
        ids.forEach((bonusId, index) => {
                if (bonusId && Number(amounts[index] || 0) >= 0) {
                    bonusList.push({ bonusId, amount: amounts[index] });
                }
            });
        }

        // New indemnities created from the employee picker are also added to the catalog.
        if (newIndemniteNames) {
            const names = Array.isArray(newIndemniteNames) ? newIndemniteNames : [newIndemniteNames];
            const amounts = Array.isArray(newIndemniteAmounts) ? newIndemniteAmounts : [newIndemniteAmounts || []];
            const codes = Array.isArray(newIndemniteCodes) ? newIndemniteCodes : [newIndemniteCodes || []];
            for (let i = 0; i < names.length; i += 1) {
                if (!String(names[i] || '').trim() || !String(codes[i] || '').trim() || Number(amounts[i] || 0) < 0) continue;
                const definition = await createIndemnite({ companyId, code: codes[i], name: names[i], defaultAmount: amounts[i] });
                bonusList.push({ bonusId: definition.id, amount: amounts[i] });
            }
        }

        // Existing catalog bonuses with employee-specific amounts
        if (bonusIds) {
            const ids = Array.isArray(bonusIds) ? bonusIds : [bonusIds];
            const amounts = Array.isArray(bonusAmounts) ? bonusAmounts : [bonusAmounts || []];
            ids.forEach((bId, i) => {
                if (bId && amounts[i] && Number(amounts[i]) > 0) {
                    bonusList.push({ bonusId: bId, amount: amounts[i] });
                }
            });
        }

        // New bonuses typed by the user (will be saved to the company catalog)
        if (customBonusNames) {
            const names = Array.isArray(customBonusNames) ? customBonusNames : [customBonusNames];
            const amounts = Array.isArray(customBonusAmounts) ? customBonusAmounts : [customBonusAmounts || []];
            names.forEach((name, i) => {
                if (name && name.trim() !== '' && amounts[i] && Number(amounts[i]) > 0) {
                    bonusList.push({ name: name.trim(), amount: amounts[i], companyId });
                }
            });
        }

        await createEmp({
            ...employeeData,
            companyId,
            bonusList,
            actif: req.body.actif === undefined
                ? true
                : (req.body.actif === '1' || req.body.actif === 'true'),
            cimrReduitBaseImposable: Boolean(req.body.cimrReduitBaseImposable),
            indemniteRepresentationName: req.body.representationEnabled === '1' ? 'Indemnité de représentation' : '',
            indemniteRepresentationRate: req.body.representationEnabled === '1'
                ? String(req.body.indemniteRepresentationRate || '').trim()
                : '',
            blocageSaisiePaie: req.body.blocageSaisiePaie === '1' || req.body.blocageSaisiePaie === 'true',
        });
        res.redirect("/employees");
    } catch (error) {
        console.error("Error creating employee:", error);
        const bonusTypes = await getAllBonusTypes(companyId);
        const categories = await getEmployeeCategories(companyId);
        const functions = await getEmployeeFunctions(companyId);
        res.status(400).render("employees/create", {
            title: "Nouveau Salarié",
            currentPage: "employees",
            user: req.session.user,
            bonusTypes,
            categories,
            functions,
            indemnites: await listIndemnites(companyId),
            defaultRepresentationRate: Number((await getRepresentationRate(companyId) * 100).toFixed(2)),
            error: "Erreur lors de la création. CIN ou Matricule déjà utilisés, ou champs invalides."
        });
    }
};

// GET /employees/:id — Employee detail & payroll projection
export const employeeshow = async (req, res) => {
    try {
        const { id } = req.params;
        const employee = await getEmployee(parseInt(id), await getSessionCompanyId(req));
        const payroll = calculatePayroll(employee);

        res.render("employees/show", {
            title: `Employé: ${employee.nomComplet}`,
            currentPage: "employees",
            user: req.session.user,
            employee,
            payroll
        });
    } catch (error) {
        console.error("Error fetching employee:", error);
        if (error.message === 'EMPLOYEE_NOT_FOUND') {
            return res.status(404).render("employees/index", {
                title: "Liste des employés",
                currentPage: "employees",
                user: req.session.user,
                employees: [],
                search: '',
                categoryId: '',
                categories: [],
                error: "Salarié introuvable"
            });
        }
        res.status(500).redirect("/employees");
    }
};

// GET /employees/:id/edit — Edit form
export const renderEditForm = async (req, res) => {
    try {
        const { id } = req.params;
        const employee = await getEmployee(parseInt(id), await getSessionCompanyId(req));
        const companyId = employee.companyId;
        const employees = await getEmployees({ companyId });
        const bonusTypes = await getAllBonusTypes(companyId);
        const categories = await getEmployeeCategories(companyId);
        const functions = await getEmployeeFunctions(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);
        employee.indemnitesNonImposables = employee.bonuses.filter(item => item.bonus && !item.bonus.taxable)
            .map(item => ({ ...item, indemniteId: item.bonusId, indemnite: item.bonus }));
        employee.primesImposables = employee.bonuses.filter(item => item.bonus && item.bonus.taxable);

        res.render("employees/edit", {
            title: `Éditer: ${employee.nomComplet}`,
            currentPage: "employees",
            user: req.session.user,
            employee,
            employees,
            bonusTypes,
            categories,
            functions,
            indemnites,
            representationAvailable: indemnites.some(item => item.isRepresentation),
            defaultRepresentationRate: Number((representationRate * 100).toFixed(2)),
            error: null
        });
    } catch (error) {
        console.error("Error rendering edit form:", error);
        res.redirect("/employees");
    }
};

// POST /employees/:id/indemnites — replace recurring non-taxable indemnities
export const handleEmployeeIndemnites = async (req, res) => {
    try {
        const activeCompanyId = await getSessionCompanyId(req);
        const employee = await getEmployee(req.params.id, activeCompanyId);
        const ids = req.body.employeeIndemniteIds ? (Array.isArray(req.body.employeeIndemniteIds) ? req.body.employeeIndemniteIds : [req.body.employeeIndemniteIds]) : [];
        const amounts = req.body.employeeIndemniteAmounts ? (Array.isArray(req.body.employeeIndemniteAmounts) ? req.body.employeeIndemniteAmounts : [req.body.employeeIndemniteAmounts]) : [];
        const existingRows = employee.bonuses
            .filter(row => row.bonus && !row.bonus.taxable)
            .map(row => ({ bonusId: row.bonusId, amount: row.amount }));
        const rows = [...existingRows, ...ids.map((bonusId, index) => ({
            bonusId,
            amount: amounts[index],
        }))];
        const names = req.body.newIndemniteNames ? (Array.isArray(req.body.newIndemniteNames) ? req.body.newIndemniteNames : [req.body.newIndemniteNames]) : [];
        const newAmounts = req.body.newIndemniteAmounts ? (Array.isArray(req.body.newIndemniteAmounts) ? req.body.newIndemniteAmounts : [req.body.newIndemniteAmounts]) : [];
        const newCodes = req.body.newIndemniteCodes ? (Array.isArray(req.body.newIndemniteCodes) ? req.body.newIndemniteCodes : [req.body.newIndemniteCodes]) : [];
        for (let i = 0; i < names.length; i += 1) {
            if (!String(names[i] || '').trim()) continue;
            const definition = await createIndemnite({ companyId: activeCompanyId, code: newCodes[i], name: names[i], defaultAmount: newAmounts[i] });
            rows.push({ bonusId: definition.id, amount: newAmounts[i] });
        }
        await saveEmployeeIndemnites(req.params.id, activeCompanyId, rows);
        return res.redirect(`/employees/${req.params.id}/edit?tab=indemnites`);
    } catch (error) {
        console.error("Error saving employee indemnités:", error);
        return res.redirect(`/employees/${req.params.id}/edit?tab=indemnites&error=indemnites`);
    }
};

export const handleRemoveEmployeeIndemnite = async (req, res) => {
    try {
        await removeEmployeeIndemnite(req.params.id, req.params.bonusId, await getSessionCompanyId(req));
    } catch (error) {
        console.error("Error removing employee indemnité:", error);
    }
    return res.redirect(`/employees/${req.params.id}/edit?tab=indemnites`);
};

export const handleEmployeeTaxablePrime = async (req, res) => {
    try {
        const enabled = req.body.enabled === 'true' || req.body.enabled === '1';
        const result = await setEmployeeTaxablePrime(
            req.params.id,
            req.body.bonusId,
            req.body.amount,
            await getSessionCompanyId(req),
            enabled,
            req.body.implementerEnConge === undefined ? undefined : (req.body.implementerEnConge === 'true' || req.body.implementerEnConge === '1'),
            req.body.implementerEnJourFerie === undefined ? undefined : (req.body.implementerEnJourFerie === 'true' || req.body.implementerEnJourFerie === '1'),
        );
        return res.json({ ok: true, ...result });
    } catch (error) {
        console.error("Error saving employee taxable prime:", error);
        return res.status(400).json({ ok: false, error: "Impossible d'enregistrer la prime imposable." });
    }
};

export const handleEmployeeIndemniteToggle = async (req, res) => {
    try {
        const enabled = req.body.enabled === 'true' || req.body.enabled === '1';
        await setEmployeeIndemnite(
            req.params.id,
            req.body.bonusId,
            await getSessionCompanyId(req),
            enabled,
            req.body.amount,
        );
        return res.json({ ok: true });
    } catch (error) {
        console.error("Error saving employee indemnité:", error);
        return res.status(400).json({ ok: false, error: "Impossible d'enregistrer l'indemnité." });
    }
};

// POST /employees/:id/edit — Update employee
export const handleUpdateEmployee = async (req, res) => {
    const { id } = req.params;
    let employee;

    try {
        const activeCompanyId = await getSessionCompanyId(req);
        employee = await getEmployee(parseInt(id), activeCompanyId);
        const companyId = employee.companyId;
        const representationEnabled = req.body.representationEnabled === '1' || req.body.representationEnabled === 'true';
        if (representationEnabled && !(await listIndemnites(companyId)).some(item => item.isRepresentation)) {
            throw new Error('REPRESENTATION_INDEMNITY_NOT_IN_CATALOG');
        }

        const {
            bonusIds, bonusAmounts,
            customBonusNames, customBonusAmounts,
            employeePrimeIds, employeePrimeAmounts,
            employeePrimeLeaveIds,
            employeePrimeHolidayIds,
            newPrimeNames, newPrimeAmounts, newPrimeCodes,
            ...employeeData
        } = req.body;
        const bonusList = [];
        const primeIds = employeePrimeIds ? (Array.isArray(employeePrimeIds) ? employeePrimeIds : [employeePrimeIds]) : [];
        const primeAmounts = employeePrimeAmounts ? (Array.isArray(employeePrimeAmounts) ? employeePrimeAmounts : [employeePrimeAmounts]) : [];
        const primeLeaveIds = new Set(employeePrimeLeaveIds ? (Array.isArray(employeePrimeLeaveIds) ? employeePrimeLeaveIds : [employeePrimeLeaveIds]) : []);
        const primeHolidayIds = new Set(employeePrimeHolidayIds ? (Array.isArray(employeePrimeHolidayIds) ? employeePrimeHolidayIds : [employeePrimeHolidayIds]) : []);
        primeIds.forEach((bonusId, index) => {
            if (bonusId && primeAmounts[index] && Number(primeAmounts[index]) > 0) bonusList.push({ bonusId, amount: primeAmounts[index], implementerEnConge: primeLeaveIds.has(String(bonusId)), implementerEnJourFerie: primeHolidayIds.has(String(bonusId)) });
        });
        const primeNames = newPrimeNames ? (Array.isArray(newPrimeNames) ? newPrimeNames : [newPrimeNames]) : [];
        const primeDefaults = newPrimeAmounts ? (Array.isArray(newPrimeAmounts) ? newPrimeAmounts : [newPrimeAmounts]) : [];
        const primeCodes = newPrimeCodes ? (Array.isArray(newPrimeCodes) ? newPrimeCodes : [newPrimeCodes]) : [];
        for (let i = 0; i < primeNames.length; i += 1) {
            if (!String(primeNames[i] || '').trim() || !primeDefaults[i] || Number(primeDefaults[i]) <= 0) continue;
            const definition = await createTaxablePrime(primeNames[i], primeDefaults[i], companyId, primeCodes[i]);
            bonusList.push({ bonusId: definition.id, amount: primeDefaults[i] });
        }
        const bonusFieldsProvided = bonusIds !== undefined || bonusAmounts !== undefined || customBonusNames !== undefined || customBonusAmounts !== undefined || employeePrimeIds !== undefined || employeePrimeAmounts !== undefined || newPrimeNames !== undefined || newPrimeAmounts !== undefined || newPrimeCodes !== undefined;

        if (bonusIds) {
            const ids = Array.isArray(bonusIds) ? bonusIds : [bonusIds];
            const amounts = Array.isArray(bonusAmounts) ? bonusAmounts : [bonusAmounts || []];
            ids.forEach((bId, i) => {
                if (bId && amounts[i] && Number(amounts[i]) > 0) {
                    bonusList.push({ bonusId: bId, amount: amounts[i] });
                }
            });
        }

        if (customBonusNames) {
            const names = Array.isArray(customBonusNames) ? customBonusNames : [customBonusNames];
            const amounts = Array.isArray(customBonusAmounts) ? customBonusAmounts : [customBonusAmounts || []];
            names.forEach((name, i) => {
                if (name && name.trim() !== '' && amounts[i] && Number(amounts[i]) > 0) {
                    bonusList.push({ name: name.trim(), amount: amounts[i], companyId });
                }
            });
        }

        await updateEmp(id, {
            ...employeeData,
            ...(bonusFieldsProvided ? { bonusList } : {}),
            replaceNonTaxableBonuses: bonusFieldsProvided && (bonusIds !== undefined || bonusAmounts !== undefined),
            actif: req.body.actif === '1' || req.body.actif === 'true',
            cimrReduitBaseImposable: Boolean(req.body.cimrReduitBaseImposable),
            indemniteRepresentationName: req.body.representationEnabled === '1' || req.body.representationEnabled === 'true'
                ? 'Indemnité de représentation'
                : '',
            indemniteRepresentationRate: req.body.representationEnabled === '1' || req.body.representationEnabled === 'true'
                ? String(req.body.indemniteRepresentationRate || '').trim()
                : '',
            blocageSaisiePaie: Boolean(req.body.blocageSaisiePaie),
        }, activeCompanyId);
        const returnTab = ['indemnites', 'primes'].includes(req.body.returnTab) ? '?tab=' + req.body.returnTab : '';
        res.redirect(`/employees/${id}/edit${returnTab}`);
    } catch (error) {
        console.error("Error updating employee:", error);
        const companyId = await getSessionCompanyId(req);
        const bonusTypes = await getAllBonusTypes(companyId);
        const categories = await getEmployeeCategories(companyId);
        const functions = await getEmployeeFunctions(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);

        res.status(400).render("employees/edit", {
            title: employee ? `Éditer: ${employee.nomComplet}` : "Éditer salarié",
            currentPage: "employees",
            user: req.session.user,
            employee: employee || {},
            bonusTypes,
            categories,
            functions,
            indemnites,
            defaultRepresentationRate: Number((representationRate * 100).toFixed(2)),
            error: "Erreur lors de la mise à jour. Vérifiez les informations saisies."
        });
    }
};

// POST /employees/:id/delete — Delete employee
export const handleDeleteEmployee = async (req, res) => {
    try {
        const { id } = req.params;
        await deleteEmp(id, await getSessionCompanyId(req));

        if (req.headers['hx-request']) {
            res.setHeader("HX-Redirect", "/employees");
            return res.status(200).send();
        }
        res.redirect("/employees");
    } catch (error) {
        console.error("Error deleting employee:", error);
        res.redirect("/employees");
    }
};

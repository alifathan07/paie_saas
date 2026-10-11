import {
    getEmployees,
    getEmployee,
    createEmployee as createEmp,
    updateEmployee as updateEmp,
    deleteEmployee as deleteEmp,
    getAllBonusTypes
} from "../services/employeeService.js";
import { calculatePayroll } from "../payroll-engine/PayrollEngine.js";
import { resolveCompanyId } from "../lib/company.js";
import {
    listIndemnites,
    getRepresentationRate,
    saveEmployeeIndemnites,
    createIndemnite,
    removeEmployeeIndemnite,
} from "../services/indemniteService.js";

const getSessionCompanyId = async (req) => resolveCompanyId(req);

// GET /employees — List all employees
export const listEmployees = async (req, res) => {
    try {
        const companyId = await getSessionCompanyId(req);
        const { search, statut } = req.query;
        const employees = await getEmployees({ search, statut, companyId });

        res.render("employees/index", {
            title: "Liste des employés",
            currentPage: "employees",
            user: req.session.user,
            employees,
            search: search || '',
            statut: statut || ''
        });
    } catch (error) {
        console.error("Error listing employees:", error);
        res.status(500).render("employees/index", {
            title: "Liste des employés",
            currentPage: "employees",
            user: req.session.user,
            employees: [],
            search: '',
            statut: '',
            error: "Impossible de charger la liste des employés"
        });
    }
};

// GET /employees/create — Show create form
export const renderCreateForm = async (req, res) => {
    try {
        const companyId = await getSessionCompanyId(req);
        const bonusTypes = await getAllBonusTypes(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);
        res.render("employees/create", {
            title: "Nouveau Salarié",
            currentPage: "employees",
            user: req.session.user,
            bonusTypes,
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
            ...employeeData
        } = req.body;
        const bonusList = [];

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
            indemniteRepresentationName: String(req.body.indemniteRepresentationName || '').trim(),
            indemniteRepresentationRate: String(req.body.indemniteRepresentationRate || '').trim(),
            blocageSaisiePaie: req.body.blocageSaisiePaie === '1' || req.body.blocageSaisiePaie === 'true',
        });
        res.redirect("/employees");
    } catch (error) {
        console.error("Error creating employee:", error);
        const bonusTypes = await getAllBonusTypes(companyId);
        res.status(400).render("employees/create", {
            title: "Nouveau Salarié",
            currentPage: "employees",
            user: req.session.user,
            bonusTypes,
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
                statut: '',
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
        const bonusTypes = await getAllBonusTypes(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);
        employee.indemnitesNonImposables = employee.bonuses.filter(item => item.bonus && !item.bonus.taxable)
            .map(item => ({ ...item, indemniteId: item.bonusId, indemnite: item.bonus }));

        res.render("employees/edit", {
            title: `Éditer: ${employee.nomComplet}`,
            currentPage: "employees",
            user: req.session.user,
            employee,
            bonusTypes,
            indemnites,
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
        const ids = req.body.employeeIndemniteIds ? (Array.isArray(req.body.employeeIndemniteIds) ? req.body.employeeIndemniteIds : [req.body.employeeIndemniteIds]) : [];
        const amounts = req.body.employeeIndemniteAmounts ? (Array.isArray(req.body.employeeIndemniteAmounts) ? req.body.employeeIndemniteAmounts : [req.body.employeeIndemniteAmounts]) : [];
        const rows = ids.map((bonusId, index) => ({ bonusId, amount: amounts[index] }));
        const names = req.body.newIndemniteNames ? (Array.isArray(req.body.newIndemniteNames) ? req.body.newIndemniteNames : [req.body.newIndemniteNames]) : [];
        const newAmounts = req.body.newIndemniteAmounts ? (Array.isArray(req.body.newIndemniteAmounts) ? req.body.newIndemniteAmounts : [req.body.newIndemniteAmounts]) : [];
        for (let i = 0; i < names.length; i += 1) {
            if (!String(names[i] || '').trim()) continue;
            const definition = await createIndemnite({ companyId: activeCompanyId, name: names[i], defaultAmount: newAmounts[i] });
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

// POST /employees/:id/edit — Update employee
export const handleUpdateEmployee = async (req, res) => {
    const { id } = req.params;
    let employee;

    try {
        const activeCompanyId = await getSessionCompanyId(req);
        employee = await getEmployee(parseInt(id), activeCompanyId);
        const companyId = employee.companyId;

        const {
            bonusIds, bonusAmounts,
            customBonusNames, customBonusAmounts,
            ...employeeData
        } = req.body;
        const bonusList = [];
        const bonusFieldsProvided = bonusIds !== undefined || bonusAmounts !== undefined || customBonusNames !== undefined || customBonusAmounts !== undefined;

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
        const returnTab = req.body.returnTab === 'indemnites' ? '?tab=indemnites' : '';
        res.redirect(`/employees/${id}/edit${returnTab}`);
    } catch (error) {
        console.error("Error updating employee:", error);
        const companyId = await getSessionCompanyId(req);
        const bonusTypes = await getAllBonusTypes(companyId);
        const indemnites = await listIndemnites(companyId);
        const representationRate = await getRepresentationRate(companyId);

        res.status(400).render("employees/edit", {
            title: employee ? `Éditer: ${employee.nomComplet}` : "Éditer salarié",
            currentPage: "employees",
            user: req.session.user,
            employee: employee || {},
            bonusTypes,
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

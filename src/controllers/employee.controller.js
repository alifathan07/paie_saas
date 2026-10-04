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
        res.render("employees/create", {
            title: "Nouveau Salarié",
            currentPage: "employees",
            user: req.session.user,
            bonusTypes,
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
            indemniteNonImposable: req.body.indemniteNonImposable === '1' || req.body.indemniteNonImposable === 'true',
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

        res.render("employees/edit", {
            title: `Éditer: ${employee.nomComplet}`,
            currentPage: "employees",
            user: req.session.user,
            employee,
            bonusTypes,
            error: null
        });
    } catch (error) {
        console.error("Error rendering edit form:", error);
        res.redirect("/employees");
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

        const {
            bonusIds, bonusAmounts,
            customBonusNames, customBonusAmounts,
            ...employeeData
        } = req.body;
        const bonusList = [];

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
            bonusList,
            actif: req.body.actif === '1' || req.body.actif === 'true',
            cimrReduitBaseImposable: Boolean(req.body.cimrReduitBaseImposable),
            indemniteNonImposable: req.body.indemniteNonImposable === '1' || req.body.indemniteNonImposable === 'true',
            blocageSaisiePaie: Boolean(req.body.blocageSaisiePaie),
        }, activeCompanyId);
        res.redirect(`/employees/${id}`);
    } catch (error) {
        console.error("Error updating employee:", error);
        const companyId = await getSessionCompanyId(req);
        const bonusTypes = await getAllBonusTypes(companyId);

        res.status(400).render("employees/edit", {
            title: employee ? `Éditer: ${employee.nomComplet}` : "Éditer salarié",
            currentPage: "employees",
            user: req.session.user,
            employee: employee || {},
            bonusTypes,
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

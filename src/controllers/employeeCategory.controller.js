import { resolveCompanyId } from "../lib/company.js";
import {
    getEmployeeCategories,
    createEmployeeCategory,
    updateEmployeeCategory,
    deleteEmployeeCategory,
} from "../services/employeeService.js";

const companyId = req => resolveCompanyId(req);

export async function index(req, res) {
    const categories = await getEmployeeCategories(companyId(req));
    return res.render("employees/categories", {
        title: "Catégories des employés",
        currentPage: "employees",
        user: req.session.user,
        categories,
        error: req.query.error || null,
    });
}

export async function create(req, res) {
    try {
        await createEmployeeCategory(companyId(req), req.body.name);
        return res.redirect("/employees/categories");
    } catch (error) {
        console.error("Error creating employee category:", error);
        return res.redirect("/employees/categories?error=Cette catégorie existe déjà ou son nom est invalide.");
    }
}

export async function createInline(req, res) {
    try {
        const category = await createEmployeeCategory(companyId(req), req.body.name);
        return res.status(201).json({ id: category.id, name: category.name });
    } catch (error) {
        console.error("Error creating employee category inline:", error);
        return res.status(error.code === 'P2002' ? 409 : 400).json({ error: error.code === 'P2002' ? 'Cette catégorie existe déjà.' : 'Le nom de la catégorie est obligatoire.' });
    }
}

export async function update(req, res) {
    try {
        await updateEmployeeCategory(req.params.id, companyId(req), req.body.name);
    } catch (error) {
        console.error("Error updating employee category:", error);
    }
    return res.redirect("/employees/categories");
}

export async function remove(req, res) {
    try {
        await deleteEmployeeCategory(req.params.id, companyId(req));
    } catch (error) {
        console.error("Error deleting employee category:", error);
        return res.redirect(`/employees/categories?error=${encodeURIComponent(error.message === 'EMPLOYEE_CATEGORY_IN_USE' ? 'Cette catégorie est encore utilisée par un ou plusieurs employés.' : 'Impossible de supprimer cette catégorie.')}`);
    }
    return res.redirect("/employees/categories");
}

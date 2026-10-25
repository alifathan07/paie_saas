import { resolveCompanyId } from "../lib/company.js";
import { createAvance, listAvances, listCompanyEmployees } from "../services/avance.service.js";

const companyId = req => resolveCompanyId(req);

export async function index(req, res) {
    try {
        return res.render("avances/index", {
            title: "Avances sur salaire",
            currentPage: "avances",
            user: req.session.user,
            avances: await listAvances(companyId(req)),
            employees: await listCompanyEmployees(companyId(req)),
            error: null,
            success: req.query.success === "created" ? "Avance enregistrée." : null,
        });
    } catch (error) {
        console.error("Error listing avances:", error);
        return res.status(500).send("Impossible de charger les avances.");
    }
}

export async function create(req, res) {
    try {
        await createAvance(companyId(req), req.body);
        return res.redirect("/avances?success=created");
    } catch (error) {
        console.error("Error creating avance:", error);
        const message = error.message === "EMPLOYEE_NOT_FOUND"
            ? "Aucun employé ne correspond à ce matricule."
            : error.message === "EMPLOYEE_MATRICULE_REQUIRED"
                ? "Sélectionnez un employé."
            : error.message === "INVALID_ADVANCE_AMOUNT"
                ? "Saisissez un montant valide."
                : "Saisissez une date valide.";
        return res.status(400).render("avances/index", {
            title: "Avances sur salaire",
            currentPage: "avances",
            user: req.session.user,
            avances: await listAvances(companyId(req)),
            employees: await listCompanyEmployees(companyId(req)),
            error: message,
            success: null,
        });
    }
}

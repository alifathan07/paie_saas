import { resolveCompanyId } from "../lib/company.js";
import { createPret, listCompanyEmployees, listPrets, updatePret } from "../services/pret.service.js";

const companyId = req => resolveCompanyId(req);

export async function index(req, res) {
    try {
        return res.render("prets/index", { title: "Prêts employés", currentPage: "prets", user: req.session.user, prets: await listPrets(companyId(req)), employees: await listCompanyEmployees(companyId(req)), error: null, success: req.query.success === "created" ? "Prêt enregistré." : req.query.success === "updated" ? "Prêt modifié." : null });
    } catch (error) {
        console.error("Error listing prets:", error);
        return res.status(500).send("Impossible de charger les prêts.");
    }
}

export async function create(req, res) {
    try {
        await createPret(companyId(req), req.body);
        return res.redirect("/prets?success=created");
    } catch (error) {
        const messages = { EMPLOYEE_NOT_FOUND: "Aucun employé ne correspond à ce matricule.", EMPLOYEE_MATRICULE_REQUIRED: "Sélectionnez un employé.", INVALID_PRET_AMOUNT: "Saisissez un montant de prêt valide.", INVALID_PRET_MONTHLY_AMOUNT: "La mensualité doit être comprise entre 0 et le montant du prêt.", INVALID_PRET_DATE: "Saisissez une date valide." };
        return res.status(400).render("prets/index", { title: "Prêts employés", currentPage: "prets", user: req.session.user, prets: await listPrets(companyId(req)), employees: await listCompanyEmployees(companyId(req)), error: messages[error.message] || "Impossible d'enregistrer le prêt.", success: null });
    }
}

export async function update(req, res) {
    try {
        await updatePret(companyId(req), req.params.id, req.body);
        return res.redirect("/prets?success=updated");
    } catch (error) {
        const messages = { PRET_NOT_FOUND: "Prêt introuvable.", PRET_AMOUNT_BELOW_REPAID: "Le montant total ne peut pas être inférieur aux montants déjà déduits.", INVALID_PRET_AMOUNT: "Saisissez un montant de prêt valide.", INVALID_PRET_MONTHLY_AMOUNT: "La mensualité doit être comprise entre 0 et le montant du prêt." };
        return res.status(400).render("prets/index", { title: "Prêts employés", currentPage: "prets", user: req.session.user, prets: await listPrets(companyId(req)), employees: await listCompanyEmployees(companyId(req)), error: messages[error.message] || "Impossible de modifier le prêt.", success: null });
    }
}

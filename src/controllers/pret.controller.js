import { randomUUID } from "node:crypto";
import { resolveCompanyId } from "../lib/company.js";
import { createPret, listCompanyEmployees, listPrets, updatePret } from "../services/pret.service.js";

const companyId = req => resolveCompanyId(req);
const logPret = (event, details) => console.info("[pret]", JSON.stringify({ timestamp: new Date().toISOString(), event, ...details }));
const errorDetails = error => ({
    name: error?.name,
    message: error?.message,
    code: error?.code,
    meta: error?.meta,
    stack: error?.stack,
});

export async function index(req, res) {
    try {
        return res.render("prets/index", { title: "Prêts employés", currentPage: "prets", user: req.session.user, prets: await listPrets(companyId(req)), employees: await listCompanyEmployees(companyId(req)), error: null, success: req.query.success === "created" ? "Prêt enregistré." : req.query.success === "updated" ? "Prêt modifié." : null });
    } catch (error) {
        console.error("Error listing prets:", error);
        return res.status(500).send("Impossible de charger les prêts.");
    }
}

export async function create(req, res) {
    const requestId = randomUUID();
    const activeCompanyId = companyId(req);
    const context = { requestId, userId: req.session?.user?.id ?? null, companyId: activeCompanyId, method: req.method, path: req.originalUrl };
    logPret("create.request", { ...context, bodyFields: Object.keys(req.body || {}) });
    try {
        const pret = await createPret(activeCompanyId, req.body, { requestId });
        logPret("create.response", { ...context, status: 302, pretId: pret.id, employeeId: pret.employeeId });
        return res.redirect("/prets?success=created");
    } catch (error) {
        logPret("create.error", { ...context, error: errorDetails(error) });
        const messages = { EMPLOYEE_NOT_FOUND: "Aucun employé ne correspond à ce matricule.", EMPLOYEE_MATRICULE_REQUIRED: "Sélectionnez un employé.", INVALID_PRET_AMOUNT: "Saisissez un montant de prêt valide.", INVALID_PRET_MONTHLY_AMOUNT: "La mensualité doit être comprise entre 0 et le montant du prêt.", INVALID_PRET_DATE: "Saisissez une date valide." };
        try {
            const [prets, employees] = await Promise.all([listPrets(activeCompanyId), listCompanyEmployees(activeCompanyId)]);
            logPret("create.response", { ...context, status: 400, errorCode: error?.code || error?.message || "UNKNOWN_ERROR" });
            return res.status(400).render("prets/index", { title: "Prêts employés", currentPage: "prets", user: req.session.user, prets, employees, error: messages[error.message] || "Impossible d'enregistrer le prêt.", success: null });
        } catch (renderError) {
            logPret("create.error_page_failed", { ...context, originalError: errorDetails(error), pageError: errorDetails(renderError) });
            return res.status(500).send("Impossible de charger les prêts.");
        }
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

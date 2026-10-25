import { resolveCompanyId } from "../lib/company.js";
import {
    listRubriques, updateFixedRubrique, createFixedRubrique, createImposableRubrique, updateImposableRubrique, deleteRubrique,
} from "../services/rubrique.service.js";

const companyId = req => resolveCompanyId(req);

async function renderPage(req, res, overrides = {}) {
    return res.render("rubriques/index", {
        title: "Rubriques de paie", currentPage: "rubriques", user: req.session.user,
        rubriques: await listRubriques(companyId(req)), error: null,
        success: req.query.success === "created" ? "Rubrique ajoutée." : req.query.success === "updated" ? "Rubrique enregistrée." : req.query.success === "deleted" ? "Rubrique supprimée." : null,
        ...overrides,
    });
}

export async function index(req, res) {
    try { return renderPage(req, res); }
    catch (error) { console.error("Error listing rubriques:", error); return res.status(500).send("Impossible de charger les rubriques."); }
}

export async function updateFixed(req, res) {
    try {
        await updateFixedRubrique(req.params.category, req.params.id, companyId(req), req.body);
        return res.redirect("/rubriques?success=updated");
    } catch (error) {
        console.error("Error updating fixed rubrique:", error);
        return renderPage(req, res, { error: error.code === "P2002" ? "Ce code existe déjà dans cette catégorie." : "Impossible de modifier la rubrique." });
    }
}

export async function createFixed(req, res) {
    try {
        await createFixedRubrique(req.params.category, companyId(req), req.body);
        return res.redirect("/rubriques?success=created");
    } catch (error) {
        console.error("Error creating fixed rubrique:", error);
        return renderPage(req, res, { error: error.code === "P2002" ? "Ce code, cette clé ou ce libellé existe déjà." : "Code ou libellé invalide." });
    }
}

export async function createImposable(req, res) {
    try {
        await createImposableRubrique(companyId(req), req.body);
        return res.redirect("/rubriques?success=created");
    } catch (error) {
        console.error("Error creating taxable rubrique:", error);
        return renderPage(req, res, { error: error.code === "P2002" ? "Ce code ou ce libellé existe déjà." : "Code ou libellé invalide." });
    }
}

export async function updateImposable(req, res) {
    try {
        await updateImposableRubrique(req.params.id, companyId(req), req.body);
        return res.redirect("/rubriques?success=updated");
    } catch (error) {
        console.error("Error updating taxable rubrique:", error);
        return renderPage(req, res, { error: error.code === "P2002" ? "Ce code ou ce libellé existe déjà." : "Impossible de modifier la rubrique." });
    }
}

export async function remove(req, res) {
    try {
        await deleteRubrique(req.params.category, req.params.id, companyId(req));
        return res.redirect("/rubriques?success=deleted");
    } catch (error) {
        console.error("Error deleting rubrique:", error);
        return renderPage(req, res, { error: error.code === "P2003" ? "Cette rubrique est utilisée par des bulletins et ne peut pas être supprimée." : "Impossible de supprimer la rubrique." });
    }
}

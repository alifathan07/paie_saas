import { resolveCompanyId } from "../lib/company.js";
import {
    listIndemnites,
    createIndemnite,
    updateIndemnite,
    deleteIndemnite,
    getRepresentationRate,
    updateRepresentationRate,
    REPRESENTATION_NAME,
} from "../services/indemniteService.js";

const companyId = req => resolveCompanyId(req);

export async function index(req, res) {
    try {
        const activeCompanyId = companyId(req);
        const indemnites = await listIndemnites(activeCompanyId);
        const representationRate = await getRepresentationRate(activeCompanyId);
        return res.render("indemnites/index", {
            title: "Indemnités non imposables",
            currentPage: "indemnites",
            user: req.session.user,
            indemnites,
            representationConfigured: indemnites.some(item => item.isRepresentation),
            representationName: REPRESENTATION_NAME,
            representationRate: Number((representationRate * 100).toFixed(2)),
            error: null,
        });
    } catch (error) {
        console.error("Error listing indemnités:", error);
        return res.status(500).render("indemnites/index", {
            title: "Indemnités non imposables", currentPage: "indemnites", user: req.session.user,
            indemnites: [], representationRate: 10, error: "Impossible de charger les indemnités.",
            representationConfigured: false,
            representationName: REPRESENTATION_NAME,
        });
    }
}

export async function updateRepresentation(req, res) {
    try {
        await updateRepresentationRate(companyId(req), req.body.rate);
        return res.redirect("/indemnites");
    } catch (error) {
        console.error("Error updating representation rate:", error);
        return res.redirect("/indemnites?error=representation");
    }
}

export async function create(req, res) {
    try {
        await createIndemnite({ companyId: companyId(req), name: req.body.name, defaultAmount: req.body.defaultAmount });
        return res.redirect("/indemnites");
    } catch (error) {
        console.error("Error creating indemnité:", error);
        const indemnites = await listIndemnites(companyId(req));
        const representationRate = await getRepresentationRate(companyId(req));
        return res.status(400).render("indemnites/index", {
            title: "Indemnités non imposables", currentPage: "indemnites", user: req.session.user,
            indemnites,
            representationConfigured: indemnites.some(item => item.isRepresentation),
            representationName: REPRESENTATION_NAME,
            representationRate: Number((representationRate * 100).toFixed(2)),
            error: error.code === "P2002" ? "Cette indemnité existe déjà." : "Le nom et le montant par défaut sont obligatoires.",
        });
    }
}

export async function update(req, res) {
    try {
        await updateIndemnite(req.params.id, { companyId: companyId(req), name: req.body.name, defaultAmount: req.body.defaultAmount });
        return res.redirect("/indemnites");
    } catch (error) {
        console.error("Error updating indemnité:", error);
        return res.redirect("/indemnites?error=update");
    }
}

export async function remove(req, res) {
    try {
        await deleteIndemnite(req.params.id, companyId(req));
    } catch (error) {
        console.error("Error deleting indemnité:", error);
    }
    return res.redirect("/indemnites");
}

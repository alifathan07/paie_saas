import { resolveCompanyId } from "../lib/company.js";
import {
    listIndemnites,
    createIndemnites,
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
            createRows: [],
        });
    } catch (error) {
        console.error("Error listing indemnités:", error);
        return res.status(500).render("indemnites/index", {
            title: "Indemnités non imposables", currentPage: "indemnites", user: req.session.user,
            indemnites: [], representationRate: 10, error: "Impossible de charger les indemnités.",
            representationConfigured: false,
            representationName: REPRESENTATION_NAME,
            createRows: [],
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
        const codes = Array.isArray(req.body.code) ? req.body.code : [req.body.code];
        const names = Array.isArray(req.body.name) ? req.body.name : [req.body.name];
        const amounts = Array.isArray(req.body.defaultAmount) ? req.body.defaultAmount : [req.body.defaultAmount];
        const representations = Array.isArray(req.body.representation) ? req.body.representation : [req.body.representation];
        const rows = names.map((name, index) => ({ code: codes[index], name, defaultAmount: amounts[index], isRepresentation: representations[index] === '1' }));
        await createIndemnites({ companyId: companyId(req), rows });
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
            createRows: namesAndRows(req.body),
        });
    }
}

function namesAndRows(body = {}) {
    const codes = Array.isArray(body.code) ? body.code : [body.code];
    const names = Array.isArray(body.name) ? body.name : [body.name];
    const amounts = Array.isArray(body.defaultAmount) ? body.defaultAmount : [body.defaultAmount];
    const representations = Array.isArray(body.representation) ? body.representation : [body.representation];
    return names.map((name, index) => ({ code: codes[index] || '', name: name || '', defaultAmount: amounts[index] || '', isRepresentation: representations[index] === '1' }));
}

export async function update(req, res) {
    try {
        await updateIndemnite(req.params.id, { companyId: companyId(req), code: req.body.code, name: req.body.name, defaultAmount: req.body.defaultAmount });
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

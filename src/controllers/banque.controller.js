import {
    getBanques,
    createBanque,
    updateBanque,
    deleteBanque,
} from "../services/employeeService.js";
import prisma from "../../db.ts";

export async function index(req, res) {
    try {
        const banques = await getBanques();
        const withUsage = await Promise.all(banques.map(async banque => ({
            ...banque,
            employeesCount: await prisma.employee.count({ where: { banque: banque.name } }),
        })));
        return res.render("employees/banques", {
            title: "Banques",
            currentPage: "banques",
            user: req.session.user,
            banques: withUsage,
            error: req.query.error || null,
        });
    } catch (error) {
        console.error("Error listing banques:", error);
        return res.status(500).render("employees/banques", {
            title: "Banques", currentPage: "banques", user: req.session.user,
            banques: [], error: "Impossible de charger les banques.",
        });
    }
}

export async function create(req, res) {
    try {
        await createBanque(req.body.name);
        return res.redirect("/employees/banques");
    } catch (error) {
        console.error("Error creating banque:", error);
        const message = error.code === "P2002"
            ? "Cette banque existe déjà."
            : "Le nom de la banque est obligatoire.";
        return res.redirect(`/employees/banques?error=${encodeURIComponent(message)}`);
    }
}

export async function update(req, res) {
    try {
        await updateBanque(req.params.id, req.body.name);
    } catch (error) {
        console.error("Error updating banque:", error);
        const message = error.code === "P2002"
            ? "Cette banque existe déjà."
            : "Impossible de modifier cette banque.";
        return res.redirect(`/employees/banques?error=${encodeURIComponent(message)}`);
    }
    return res.redirect("/employees/banques");
}

export async function remove(req, res) {
    try {
        await deleteBanque(req.params.id);
    } catch (error) {
        console.error("Error deleting banque:", error);
        const message = error.message === "BANQUE_IN_USE"
            ? "Cette banque est utilisée par un ou plusieurs employés."
            : "Impossible de supprimer cette banque.";
        return res.redirect(`/employees/banques?error=${encodeURIComponent(message)}`);
    }
    return res.redirect("/employees/banques");
}

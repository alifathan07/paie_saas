import prisma from "../../db.ts";
import { isAdminUser } from "../../middlewares/admin.js";

const clientInclude = {
    userCompanies: { include: { company: true }, orderBy: { companyId: "asc" } },
    _count: { select: { reports: true } },
};

function page(req, overrides = {}) {
    return {
        title: "Administration",
        currentPage: "admin",
        user: req.session.user,
        clientMode: req.session.adminClientMode || null,
        ...overrides,
    };
}

function redirectBack(req, res, fallback = "/admin/clients") {
    return res.redirect(req.get("referer") || fallback);
}

export const adminDashboard = async (req, res) => {
    const [clientCount, companyCount, openReports, blockedCount] = await Promise.all([
        prisma.users.count({ where: { isAdmin: false } }),
        prisma.company.count(),
        prisma.report.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        prisma.users.count({ where: { isBlocked: true, isAdmin: false } }),
    ]);
    return res.render("admin/index", page(req, { stats: { clientCount, companyCount, openReports, blockedCount } }));
};

export const adminClients = async (req, res) => {
    const clients = await prisma.users.findMany({ where: { isAdmin: false }, include: clientInclude, orderBy: { createdAt: "desc" } });
    return res.render("admin/clients", page(req, { clients, error: null }));
};

export const updateClientBilling = async (req, res) => {
    const clientId = Number(req.params.id);
    const maxCompanies = Number(req.body.maxCompanies);
    if (!Number.isInteger(clientId) || !Number.isInteger(maxCompanies) || maxCompanies < 0 || maxCompanies > 1000) {
        return res.status(400).send("Limite de sociétés invalide.");
    }
    await prisma.users.update({ where: { id: clientId }, data: { maxCompanies } });
    return redirectBack(req, res);
};

export const blockClient = async (req, res) => {
    const clientId = Number(req.params.id);
    const reason = String(req.body.reason || "Paiement en attente").trim().slice(0, 191);
    await prisma.users.update({ where: { id: clientId }, data: { isBlocked: true, blockReason: reason || "Paiement en attente" } });
    return redirectBack(req, res);
};

export const unblockClient = async (req, res) => {
    await prisma.users.update({ where: { id: Number(req.params.id) }, data: { isBlocked: false, blockReason: null } });
    return redirectBack(req, res);
};

export const createClientCompany = async (req, res) => {
    const clientId = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).send("Le nom de la société est obligatoire.");
    const client = await prisma.users.findUnique({ where: { id: clientId }, include: { userCompanies: true } });
    if (!client || client.isAdmin) return res.status(404).send("Client introuvable.");
    if (client.maxCompanies !== 0 && client.userCompanies.length >= client.maxCompanies) {
        return res.status(409).send("La limite de sociétés de ce client est atteinte.");
    }
    const company = await prisma.company.create({ data: { name } });
    await prisma.userCompany.create({ data: { companyId: company.id, userId: client.id } });
    return redirectBack(req, res);
};

export const enterClientMode = async (req, res) => {
    const clientId = Number(req.params.id);
    const companyId = Number(req.body.companyId);
    const membership = await prisma.userCompany.findUnique({
        where: { companyId_userId: { companyId, userId: clientId } },
        include: { company: true, user: true },
    });
    if (!membership || membership.user.isAdmin) return res.status(404).send("Client ou société introuvable.");
    req.session.adminClientMode = {
        userId: membership.userId,
        userName: membership.user.name,
        companyId: membership.companyId,
        companyName: membership.company.name,
    };
    req.session.user.activeCompanyId = membership.companyId;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    return res.redirect("/dashboard");
};

export const exitClientMode = async (req, res) => {
    delete req.session.adminClientMode;
    const firstMembership = await prisma.userCompany.findFirst({ where: { userId: req.session.user.id }, orderBy: { companyId: "asc" } });
    req.session.user.activeCompanyId = firstMembership?.companyId || null;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    return res.redirect("/admin/clients");
};

export const adminReports = async (req, res) => {
    const reports = await prisma.report.findMany({ include: { user: true, company: true }, orderBy: { updatedAt: "desc" } });
    return res.render("admin/reports", page(req, { reports }));
};

export const updateReport = async (req, res) => {
    const status = String(req.body.status || "OPEN").toUpperCase();
    if (!["OPEN", "IN_PROGRESS", "SOLVED", "CLOSED"].includes(status)) return res.status(400).send("Statut invalide.");
    await prisma.report.update({ where: { id: Number(req.params.id) }, data: {
        status,
        adminNote: String(req.body.adminNote || "").trim() || null,
        solvedAt: ["SOLVED", "CLOSED"].includes(status) ? new Date() : null,
    } });
    return redirectBack(req, res, "/admin/reports");
};

export const clientReports = async (req, res) => {
    const reports = await prisma.report.findMany({
        where: { userId: Number(req.session.user.id) },
        include: { company: true },
        orderBy: { createdAt: "desc" },
    });
    return res.render("reports/index", page(req, { reports, error: null }));
};

export const createReport = async (req, res) => {
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();
    if (!subject || !message) return res.status(400).render("reports/index", page(req, { reports: [], error: "Sujet et description obligatoires." }));
    await prisma.report.create({ data: {
        subject: subject.slice(0, 191),
        message,
        userId: Number(req.session.user.id),
        companyId: Number(req.session.user.activeCompanyId) || null,
    } });
    return res.redirect("/reports");
};

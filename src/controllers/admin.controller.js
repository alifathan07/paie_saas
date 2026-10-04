import prisma from "../../db.ts";
import { recordAudit } from "../services/audit.service.js";
import { createUserAccount, setUserPassword, updateUserProfile } from "../services/auth.service.js";
import { polishBlockReason } from "../services/blockReason.service.js";

const safeUserSelect = {
    id: true,
    name: true,
    email: true,
    createdAt: true,
    updatedAt: true,
    isAdmin: true,
    isBlocked: true,
    blockReason: true,
    maxCompanies: true,
    userCompanies: { select: { companyId: true, company: { select: { id: true, name: true, createdAt: true } } }, orderBy: { companyId: "asc" } },
    _count: { select: { userCompanies: true, reports: true } },
};

function page(req, overrides = {}) {
    const path = String(req.originalUrl || req.path || "").split("?")[0];
    const adminNav = path === "/admin"
        ? "overview"
        : path.startsWith("/admin/users") || path.startsWith("/admin/clients")
            ? "clients"
            : path.startsWith("/admin/companies")
                ? "companies"
                : path.startsWith("/admin/reports")
                    ? "reports"
                    : path.startsWith("/admin/audit-logs")
                        ? "audit"
                        : path.startsWith("/admin/system")
                            ? "system"
                            : path.startsWith("/admin/usage")
                                ? "usage"
                                : "overview";
    return {
        title: "Administration",
        currentPage: "admin",
        user: req.session.user,
        clientMode: req.session.adminClientMode || null,
        dashboardStylesheet: !req.session.adminClientMode,
        adminNav,
        ...overrides,
    };
}

function redirectBack(req, res, fallback = "/admin/clients") {
    return res.redirect(req.get("referer") || fallback);
}

export const adminDashboard = async (req, res) => {
    const [totalUsers, activeUsers, blockedCount, companyCount, employeeCount, openReports, recentActivity, companyOverview, recentUsers, solvedReports] = await Promise.all([
        prisma.users.count(),
        prisma.users.count({ where: { isBlocked: false } }),
        prisma.users.count({ where: { isBlocked: true } }),
        prisma.company.count(),
        prisma.employee.count(),
        prisma.report.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
        prisma.auditLog.findMany({ take: 8, orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true, email: true } }, company: { select: { name: true } } } }),
        prisma.company.findMany({ take: 6, orderBy: { createdAt: "desc" }, include: { _count: { select: { employees: true, reports: true, userCompanies: true } } } }),
        prisma.users.findMany({ take: 5, where: { isAdmin: false }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, email: true, isBlocked: true, createdAt: true, _count: { select: { userCompanies: true, reports: true } } } }),
        prisma.report.count({ where: { status: { in: ["SOLVED", "CLOSED"] } } }),
    ]);
    return res.render("admin/index", page(req, { stats: { totalUsers, activeUsers, companyCount, employeeCount, openReports, blockedCount, solvedReports }, recentActivity, companyOverview, recentUsers }));
};

export const adminClients = async (req, res) => {
    const q = String(req.query.q || "").trim();
    const users = await prisma.users.findMany({
        where: q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] } : undefined,
        select: safeUserSelect,
        orderBy: { createdAt: "desc" },
    });
    return res.render("admin/clients", page(req, { clients: users, q, error: null }));
};

export const adminCreateUserPage = (req, res) => res.render("admin/create-user", page(req, {
    error: null,
    form: { name: "", email: "", maxCompanies: 1 },
}));

export const adminCreateUser = async (req, res) => {
    const form = {
        name: String(req.body.name || "").trim(),
        email: String(req.body.email || "").trim().toLowerCase(),
        maxCompanies: req.body.maxCompanies,
    };
    try {
        const created = await createUserAccount({
            ...form,
            password: req.body.password,
            passwordConfirmation: req.body.passwordConfirmation,
        });
        await recordAudit(req, {
            action: "CREATE_USER",
            targetType: "USER",
            targetId: created.id,
            metadata: { name: created.name, email: created.email, maxCompanies: created.maxCompanies },
        });
        return res.redirect(`/admin/users/${created.id}`);
    } catch (error) {
        const messages = {
            INVALID_NAME: "Le nom est obligatoire et doit contenir au maximum 191 caractères.",
            INVALID_EMAIL: "Veuillez renseigner une adresse e-mail valide.",
            PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
            PASSWORD_MISMATCH: "Les mots de passe ne correspondent pas.",
            INVALID_COMPANY_LIMIT: "La limite de sociétés doit être un nombre entier entre 0 et 1000.",
            EMAIL_ALREADY_EXISTS: "Cette adresse e-mail est déjà utilisée.",
        };
        const message = messages[error.message];
        if (!message) throw error;
        return res.status(400).render("admin/create-user", page(req, { error: message, form }));
    }
};

export const adminUserDetails = async (req, res) => {
    const userId = Number(req.params.id);
    const user = await prisma.users.findUnique({ where: { id: userId }, select: safeUserSelect });
    if (!user) return res.status(404).send("Utilisateur introuvable.");
    const [activity, reports] = await Promise.all([
        prisma.auditLog.findMany({ where: { targetType: "USER", targetId: userId }, orderBy: { createdAt: "desc" }, take: 30, include: { actor: { select: { name: true } }, company: { select: { name: true } } } }),
        prisma.report.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 10, include: { company: { select: { name: true } } } }),
    ]);
    return res.render("admin/user-details", page(req, { account: user, activity, reports, error: null }));
};

const profileMessages = {
    INVALID_NAME: "Le nom est obligatoire et doit contenir au maximum 191 caractères.",
    INVALID_EMAIL: "Veuillez renseigner une adresse e-mail valide.",
    EMAIL_ALREADY_EXISTS: "Cette adresse e-mail est déjà utilisée.",
    PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
    PASSWORD_MISMATCH: "Les mots de passe ne correspondent pas.",
};

export const adminUpdateUserProfile = async (req, res) => {
    const userId = Number(req.params.id);
    try {
        const account = await updateUserProfile(userId, req.body);
        if (userId === Number(req.session.user.id)) {
            req.session.user.name = account.name;
            req.session.user.email = account.email;
        }
        await recordAudit(req, { action: "ADMIN_UPDATE_PROFILE", targetType: "USER", targetId: userId });
        return res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        return res.status(400).send(profileMessages[error.message] || "Impossible de mettre à jour le profil.");
    }
};

export const adminSetUserPassword = async (req, res) => {
    const userId = Number(req.params.id);
    try {
        await setUserPassword(userId, req.body.password, req.body.passwordConfirmation);
        await recordAudit(req, { action: "ADMIN_CHANGE_PASSWORD", targetType: "USER", targetId: userId });
        return res.redirect(`/admin/users/${userId}`);
    } catch (error) {
        return res.status(400).send(profileMessages[error.message] || "Impossible de modifier le mot de passe.");
    }
};

export const adminCompanies = async (req, res) => {
    const q = String(req.query.q || "").trim();
    const companies = await prisma.company.findMany({
        where: q ? { OR: [{ name: { contains: q } }, { id: Number.isInteger(Number(q)) ? Number(q) : -1 }] } : undefined,
        include: { userCompanies: { include: { user: { select: { id: true, name: true, email: true, isBlocked: true } } } }, _count: { select: { employees: true, reports: true } } },
        orderBy: { createdAt: "desc" },
    });
    return res.render("admin/companies", page(req, { companies, q }));
};

export const adminCompanyDetails = async (req, res) => {
    const companyId = Number(req.params.id);
    const company = await prisma.company.findUnique({ where: { id: companyId }, include: { userCompanies: { include: { user: { select: { id: true, name: true, email: true, isAdmin: true, isBlocked: true } } } }, employees: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, nomComplet: true, matricule: true, actif: true, createdAt: true } }, _count: { select: { employees: true } } } });
    if (!company) return res.status(404).send("Société introuvable.");
    const [payslipCount, recentPayslips] = await Promise.all([
        prisma.payslip.count({ where: { employee: { companyId } } }),
        prisma.payslip.findMany({ where: { employee: { companyId } }, orderBy: { id: "desc" }, take: 10, select: { id: true, month: true, year: true, status: true, employee: { select: { nomComplet: true } } } }),
    ]);
    return res.render("admin/company-details", page(req, { company, payslipCount, recentPayslips }));
};

export const adminAuditLogs = async (req, res) => {
    const action = String(req.query.action || "").trim();
    const logs = await prisma.auditLog.findMany({
        where: action ? { action } : undefined,
        take: 200,
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true, email: true } }, company: { select: { name: true } } },
    });
    const actions = await prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } });
    return res.render("admin/audit-logs", page(req, { logs, actions: actions.map(row => row.action), action }));
};

export const adminUsage = async (req, res) => {
    const users = await prisma.users.findMany({ where: { isAdmin: false }, select: safeUserSelect, orderBy: { name: "asc" } });
    return res.render("admin/usage", page(req, { users }));
};

export const adminSystem = async (req, res) => res.render("admin/system", page(req));

export const updateClientBilling = async (req, res) => {
    const clientId = Number(req.params.id);
    const maxCompanies = Number(req.body.maxCompanies);
    if (!Number.isInteger(clientId) || !Number.isInteger(maxCompanies) || maxCompanies < 0 || maxCompanies > 1000) {
        return res.status(400).send("Limite de sociétés invalide.");
    }
    if (maxCompanies < 0 || maxCompanies > 1000) return res.status(400).send("Limite de sociétés invalide.");
    const user = await prisma.users.findUnique({ where: { id: clientId }, select: { maxCompanies: true, isAdmin: true } });
    if (!user) return res.status(404).send("Utilisateur introuvable.");
    await prisma.users.update({ where: { id: clientId }, data: { maxCompanies } });
    await recordAudit(req, { action: "CHANGE_COMPANY_LIMIT", targetType: "USER", targetId: clientId, metadata: { from: user.maxCompanies, to: maxCompanies } });
    return redirectBack(req, res);
};

export const blockClient = async (req, res) => {
    const clientId = Number(req.params.id);
    const reason = await polishBlockReason(req.body.reason);
    const user = await prisma.users.findUnique({ where: { id: clientId }, select: { isAdmin: true } });
    if (!user || user.isAdmin || clientId === Number(req.session.user.id)) return res.status(400).send("Cet utilisateur ne peut pas être bloqué.");
    await prisma.users.update({ where: { id: clientId }, data: { isBlocked: true, blockReason: reason } });
    await recordAudit(req, { action: "BLOCK_USER", targetType: "USER", targetId: clientId, metadata: { reason } });
    return redirectBack(req, res);
};

export const unblockClient = async (req, res) => {
    await prisma.users.update({ where: { id: Number(req.params.id) }, data: { isBlocked: false, blockReason: null } });
    await recordAudit(req, { action: "UNBLOCK_USER", targetType: "USER", targetId: Number(req.params.id) });
    return redirectBack(req, res);
};

export const createClientCompany = async (req, res) => {
    const clientId = Number(req.params.id);
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).send("Le nom de la société est obligatoire.");
    const client = await prisma.users.findUnique({ where: { id: clientId }, select: { id: true, isAdmin: true, maxCompanies: true, userCompanies: { select: { companyId: true } } } });
    if (!client || client.isAdmin) return res.status(404).send("Client introuvable.");
    const company = await prisma.$transaction(async (tx) => {
        // Lock the owner row for the duration of the check/create operation so
        // concurrent admin requests cannot both pass the same limit check.
        await tx.users.update({ where: { id: client.id }, data: { updatedAt: new Date() } });
        const current = await tx.userCompany.count({ where: { userId: client.id } });
        if (client.maxCompanies !== 0 && current >= client.maxCompanies) {
            const error = new Error("COMPANY_LIMIT_REACHED");
            error.statusCode = 409;
            throw error;
        }
        const created = await tx.company.create({ data: { name } });
        await tx.userCompany.create({ data: { companyId: created.id, userId: client.id } });
        return created;
    }).catch(error => {
        if (error.message === "COMPANY_LIMIT_REACHED") return null;
        throw error;
    });
    if (!company) return res.status(409).send("La limite de sociétés de ce client est atteinte.");
    await recordAudit(req, { action: "CREATE_COMPANY", targetType: "COMPANY", targetId: company.id, companyId: company.id, metadata: { ownerUserId: client.id, name } });
    return redirectBack(req, res);
};

export const enterClientMode = async (req, res) => {
    const clientId = Number(req.params.id);
    const companyId = Number(req.body.companyId);
    const membership = await prisma.userCompany.findUnique({
        where: { companyId_userId: { companyId, userId: clientId } },
        include: { company: true, user: { select: { id: true, name: true, isAdmin: true } } },
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
    await recordAudit(req, { action: "ENTER_SUPPORT_MODE", targetType: "USER", targetId: membership.userId, companyId: membership.companyId, metadata: { companyName: membership.company.name } });
    return res.redirect("/dashboard");
};

export const exitClientMode = async (req, res) => {
    const previousMode = req.session.adminClientMode;
    delete req.session.adminClientMode;
    const firstMembership = await prisma.userCompany.findFirst({ where: { userId: req.session.user.id }, orderBy: { companyId: "asc" } });
    req.session.user.activeCompanyId = firstMembership?.companyId || null;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
    if (previousMode) await recordAudit(req, { action: "EXIT_SUPPORT_MODE", targetType: "USER", targetId: previousMode.userId, companyId: previousMode.companyId });
    return res.redirect("/admin/clients");
};

export const adminReports = async (req, res) => {
    const reports = await prisma.report.findMany({ include: { user: { select: { id: true, name: true, email: true } }, company: true }, orderBy: { updatedAt: "desc" } });
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
    await recordAudit(req, { action: "UPDATE_REPORT", targetType: "REPORT", targetId: Number(req.params.id), metadata: { status } });
    return redirectBack(req, res, "/admin/reports");
};

export const clientReports = async (req, res) => {
    const reports = await prisma.report.findMany({
        where: { userId: Number(req.session.user.id) },
        include: { company: true },
        orderBy: { createdAt: "desc" },
    });
    return res.render("reports/index", page(req, { title: "Mes rapports", currentPage: "reports", dashboardStylesheet: false, reports, error: null }));
};

export const createReport = async (req, res) => {
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();
    if (!subject || !message) return res.status(400).render("reports/index", page(req, { title: "Mes rapports", currentPage: "reports", dashboardStylesheet: false, reports: [], error: "Sujet et description obligatoires." }));
    await prisma.report.create({ data: {
        subject: subject.slice(0, 191),
        message,
        userId: Number(req.session.user.id),
        companyId: Number(req.session.user.activeCompanyId) || null,
    } });
    return res.redirect("/reports");
};

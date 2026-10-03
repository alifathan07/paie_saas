import { authenticateUser } from "../services/auth.service.js";
import prisma from "../../db.ts";
import { clearLoginAttempts } from "../../middlewares/security.js";

function loginLog(event, details = {}) {
    console.info(`[auth.login] ${event}`, details);
}

function safeEmail(email) {
    const value = String(email || "").trim().toLowerCase();
    const at = value.indexOf("@");
    return at > 1 ? `${value.slice(0, 2)}***${value.slice(at)}` : "<missing>";
}

export const loginPage = (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect(req.session.user.isAdmin ? "/admin" : "/");
    }
    res.render("auth/login", {
        title: "Connexion",
        error: null,
    });
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        loginLog("request", {
            email: safeEmail(email),
            hasPassword: Boolean(password),
            method: req.method,
            path: req.originalUrl,
            htmx: Boolean(req.headers["hx-request"]),
        });
        const user = await authenticateUser(email, password);
        const companies = user.userCompanies ?? [];
        const activeCompanyId = companies.length === 1 ? companies[0].companyId : null;

        if (user.isBlocked && !user.isAdmin) {
            const blockedReason = user.blockReason || "Votre compte est temporairement bloqué. Contactez l’administrateur pour obtenir de l’aide.";
            loginLog("blocked", { userId: user.id });
            if (req.headers["hx-request"]) {
                const safeReason = blockedReason.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
                return res.status(200).send(`<div class="blocked-login-modal" role="alertdialog" aria-modal="true"><div class="blocked-login-dialog"><button type="button" class="blocked-login-close" aria-label="Fermer" onclick="this.closest('.blocked-login-modal').remove()">×</button><div class="blocked-login-icon">!</div><p class="blocked-login-eyebrow">ACCÈS SUSPENDU</p><h2>Votre compte est bloqué</h2><p>${safeReason}</p><small>Si vous pensez qu’il s’agit d’une erreur, contactez votre administrateur.</small><button type="button" class="btn-primary blocked-login-dismiss" onclick="this.closest('.blocked-login-modal').remove()">J’ai compris</button></div></div>`);
            }
            return res.status(403).render("auth/login", { title: "Connexion", error: null, blockedReason });
        }

        loginLog("credentials.accepted", {
            userId: user.id,
            companyCount: companies.length,
            companyIds: companies.map((membership) => membership.companyId),
            initialActiveCompanyId: activeCompanyId,
        });

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            isAdmin: Boolean(user.isAdmin || (
                String(process.env.ADMIN_EMAIL || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase()
                && String(process.env.ADMIN_EMAIL || "").trim() !== ""
            )),
            isBlocked: Boolean(user.isBlocked),
            activeCompanyId,
        };
        clearLoginAttempts(req);

        // Administrators manage companies from the admin dashboard and do not
        // need an active company just to sign in.
        if (req.session.user.isAdmin) {
            loginLog("redirect.admin_dashboard", { userId: user.id });
            if (req.headers["hx-request"]) {
                res.setHeader("HX-Redirect", "/admin");
                return res.status(200).send();
            }
            return res.redirect("/admin");
        }

        if (companies.length === 0) {
            loginLog("success.no_company", { userId: user.id });
            if (req.headers["hx-request"]) {
                res.setHeader("HX-Redirect", "/auth/select-company");
                return res.status(200).send();
            }
            return res.redirect("/auth/select-company");
        }

        if (companies.length > 1) {
            loginLog("redirect.company_selection", { userId: user.id, companyCount: companies.length });
            if (req.headers["hx-request"]) {
                res.setHeader("HX-Redirect", "/auth/select-company");
                return res.status(200).send();
            }
            return res.redirect("/auth/select-company");
        }

        // If request is from HTMX, tell HTMX to redirect the whole page
        if (req.headers["hx-request"]) {
            loginLog("success.htmx_redirect", { userId: user.id, activeCompanyId });
            res.setHeader("HX-Redirect", "/");
            return res.status(200).send();
        }

        loginLog("success.redirect", { userId: user.id, activeCompanyId });
        return res.redirect("/");
    } catch (error) {
        loginLog("failed", {
            error: error.message,
            code: error.code,
            email: safeEmail(req.body?.email),
        });

        let errorMsg = "Adresse e-mail ou mot de passe incorrect.";
        if (error.message === "MISSING_CREDENTIALS") {
            errorMsg = "Veuillez renseigner votre e-mail et mot de passe.";
        }

        if (req.headers["hx-request"]) {
            return res.send(`<div class="alert alert-error">${errorMsg}</div>`);
        }
        return res.render("auth/login", { title: "Connexion", error: errorMsg });
    }
};

export const selectCompanyPage = async (req, res) => {
    if (!req.session?.user) return res.redirect("/auth");
    if (req.session.user.isAdmin) return res.redirect("/admin");
    const user = await prisma.users.findUnique({
        where: { id: Number(req.session.user.id) },
        select: { userCompanies: { include: { company: true } } },
    });
    return res.render("auth/select-company", {
        title: "Sélectionner une entreprise",
        companies: user?.userCompanies || [],
        user: req.session.user,
        error: user?.userCompanies?.length ? null : "Votre compte est actif, mais aucune société ne vous est encore associée. Contactez l'administrateur.",
    });
};

export const selectCompany = async (req, res) => {
    const userId = Number(req.session?.user?.id);
    const companyId = Number(req.body.companyId);
    loginLog("company_selection.request", { userId, requestedCompanyId: companyId });
    if (!Number.isInteger(userId) || !Number.isInteger(companyId) || companyId <= 0) {
        loginLog("company_selection.rejected.invalid", { userId, requestedCompanyId: companyId });
        return res.status(403).send("FORBIDDEN");
    }

    const membership = await prisma.userCompany.findUnique({
        where: { companyId_userId: { companyId, userId } },
        select: { companyId: true },
    });
    if (!membership) {
        loginLog("company_selection.rejected.not_member", { userId, requestedCompanyId: companyId });
        return res.status(403).send("FORBIDDEN");
    }

    req.session.user.activeCompanyId = companyId;
    loginLog("company_selection.success", { userId, activeCompanyId: companyId });
    return res.redirect("/");
};

export const logout = async (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error("Logout error:", err);
                return res.status(500).json({ error: "Unable to logout" });
            }
            res.redirect("/auth");
        });
    } else {
        res.redirect("/auth");
    }
};


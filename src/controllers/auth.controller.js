import crypto from "node:crypto";
import { authenticateUser, registerCompanyAccount } from "../services/auth.service.js";
import { sendTwoFactorCode } from "../services/email.service.js";
import prisma from "../../db.ts";
import { clearLoginAttempts } from "../../middlewares/security.js";

function loginLog(event, details = {}) {
    console.info(`[auth.login] ${event}`, details);
}

function safeIdentifier(identifier) {
    const value = String(identifier || "").trim();
    return value.length > 2 ? `${value.slice(0, 2)}***` : "<missing>";
}

function codeDigest(code) {
    return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function saveSession(req) {
    return new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
}

function escapeHtml(value) {
    return String(value).replace(/[&<>\"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[character]);
}

function loginError(req, res, message, status = 400) {
    if (req.headers["hx-request"]) {
        return res.status(status).send(`<div class="alert alert-error" role="alert">${escapeHtml(message)}</div>`);
    }
    return res.status(status).render("auth/login", { title: "Connexion", error: message });
}

function establishSession(req, user, companies) {
    const activeCompanyId = companies.length === 1 ? companies[0].companyId : null;
    req.session.user = {
        id: user.id,
        username: user.username || user.email,
        email: user.email,
        isAdmin: Boolean(user.isAdmin || (
            String(process.env.ADMIN_EMAIL || "").trim().toLowerCase() === String(user.email || "").trim().toLowerCase()
            && String(process.env.ADMIN_EMAIL || "").trim() !== ""
        )),
        isBlocked: Boolean(user.isBlocked),
        activeCompanyId,
    };
    return activeCompanyId;
}

function loginRedirect(req, res, user, companies, activeCompanyId) {
    if (req.session.user.isAdmin) {
        if (req.headers["hx-request"]) res.setHeader("HX-Redirect", "/admin");
        return req.headers["hx-request"] ? res.status(200).send() : res.redirect("/admin");
    }
    const destination = companies.length === 0 || companies.length > 1 ? "/auth/select-company" : "/";
    if (req.headers["hx-request"]) {
        res.setHeader("HX-Redirect", destination);
        return res.status(200).send();
    }
    return res.redirect(destination);
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

export const registerPage = (req, res) => {
    if (req.session?.user) return res.redirect("/");
    return res.render("auth/register", { title: "Créer un compte", error: null, form: { companyName: "", username: "", email: "" } });
};

export const register = async (req, res) => {
    const form = {
        companyName: String(req.body?.companyName || "").trim(),
        username: String(req.body?.username || "").trim().toLowerCase(),
        email: String(req.body?.email || "").trim().toLowerCase(),
    };
    try {
        const { user, company } = await registerCompanyAccount({
            ...form,
            password: req.body?.password,
            passwordConfirmation: req.body?.passwordConfirmation,
        });
        req.session.user = {
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: false,
            isBlocked: false,
            activeCompanyId: company.id,
            needsCompanySetup: true,
        };
        await saveSession(req);
        return res.redirect("/");
    } catch (error) {
        const messages = {
            INVALID_COMPANY_NAME: "Veuillez renseigner un nom d’entreprise valide.",
            INVALID_USERNAME: "Le nom d’utilisateur doit contenir 3 à 64 caractères : lettres minuscules, chiffres, point, tiret ou underscore.",
            INVALID_EMAIL: "Veuillez renseigner une adresse e-mail valide.",
            EMAIL_ALREADY_EXISTS: "Cette adresse e-mail est déjà utilisée.",
            USERNAME_ALREADY_EXISTS: "Ce nom d’utilisateur est déjà utilisé.",
            PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
            PASSWORD_MISMATCH: "Les mots de passe ne correspondent pas.",
        };
        return res.status(400).render("auth/register", {
            title: "Créer un compte",
            error: messages[error.message] || "Impossible de créer le compte.",
            form,
        });
    }
};

async function companySetupData(req, error = null, form = null) {
    const userId = Number(req.session?.user?.id);
    const companyId = Number(req.session?.user?.activeCompanyId);
    const membership = Number.isInteger(userId) && Number.isInteger(companyId)
        ? await prisma.userCompany.findUnique({ where: { companyId_userId: { companyId, userId } }, include: { company: true } })
        : null;
    const company = membership?.company;
    return {
        title: "Configuration de l’entreprise",
        error,
        form: form || {
            name: company?.name || "",
            adresse: company?.adresse || "",
            ville: company?.ville || "",
            ifNumber: company?.ifNumber || "",
            numeroAffiliationCnss: company?.numeroAffiliationCnss || "",
            smig: company?.smig ? String(company.smig) : "3422.72",
            ice: company?.ice || "",
            rc: company?.rc || "",
            numeroAssurance: company?.numeroAssurance || "",
        },
    };
}

export const companySetupPage = async (req, res) => {
    if (!req.session?.user) return res.redirect("/auth");
    if (!req.session.user.needsCompanySetup) return res.redirect("/");
    return res.render("auth/company-setup", await companySetupData(req));
};

export const completeCompanySetup = async (req, res) => {
    if (!req.session?.user?.needsCompanySetup) return res.redirect("/");
    if (req.body?.skip === "1") return res.redirect("/");
    const userId = Number(req.session.user.id);
    const companyId = Number(req.session.user.activeCompanyId);
    const form = {
        name: String(req.body?.name || "").trim().slice(0, 191),
        adresse: String(req.body?.adresse || "").trim().slice(0, 191),
        ville: String(req.body?.ville || "").trim().slice(0, 191),
        ifNumber: String(req.body?.ifNumber || "").trim().slice(0, 191),
        numeroAffiliationCnss: String(req.body?.numeroAffiliationCnss || "").trim().slice(0, 191),
        smig: String(req.body?.smig || "").trim(),
        ice: String(req.body?.ice || "").trim().slice(0, 191),
        rc: String(req.body?.rc || "").trim().slice(0, 191),
        numeroAssurance: String(req.body?.numeroAssurance || "").trim().slice(0, 191),
    };
    const smig = Number(form.smig);
    if (!Number.isInteger(userId) || !Number.isInteger(companyId) || companyId <= 0 || !form.name || !form.adresse || !form.ville || !form.ifNumber || !form.numeroAffiliationCnss || !Number.isFinite(smig) || smig <= 0) {
        return res.status(400).render("auth/company-setup", await companySetupData(req, "Veuillez renseigner tous les champs obligatoires et un SMIG valide.", form));
    }
    const membership = await prisma.userCompany.findUnique({ where: { companyId_userId: { companyId, userId } }, select: { companyId: true } });
    if (!membership) return res.status(403).send("Société active introuvable.");
    try {
        await prisma.company.update({ where: { id: companyId }, data: { ...form, smig } });
        delete req.session.user.needsCompanySetup;
        await saveSession(req);
        return res.redirect("/");
    } catch (error) {
        if (error?.code === "P2002") return res.status(409).render("auth/company-setup", await companySetupData(req, "Cet IF, ICE ou RC est déjà utilisé par une autre société.", form));
        throw error;
    }
};

export const login = async (req, res) => {
    try {
        const { identifier, username, email, password } = req.body;
        const loginIdentifier = identifier || username || email;
        loginLog("request", {
            identifier: safeIdentifier(loginIdentifier),
            hasPassword: Boolean(password),
            method: req.method,
            path: req.originalUrl,
            htmx: Boolean(req.headers["hx-request"]),
        });
        const user = await authenticateUser(loginIdentifier, password);
        const companies = user.userCompanies ?? [];

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
            initialActiveCompanyId: companies.length === 1 ? companies[0].companyId : null,
        });

        clearLoginAttempts(req);

        if (user.twoFactorEnabled) {
            delete req.session.user;
            const code = String(crypto.randomInt(100000, 1000000));
            req.session.pendingTwoFactor = {
                userId: user.id,
                codeDigest: codeDigest(code),
                expiresAt: Date.now() + 10 * 60 * 1000,
                attempts: 0,
            };
            await saveSession(req);
            try {
                await sendTwoFactorCode({ to: user.email, code });
            } catch (error) {
                delete req.session.pendingTwoFactor;
                await saveSession(req);
                if (error.message === "EMAIL_NOT_CONFIGURED") {
                    return loginError(req, res, "La vérification à deux facteurs est activée, mais l’envoi d’e-mails n’est pas configuré. Contactez l’administrateur.", 503);
                }
                if (error.message === "SMTP_CERTIFICATE_HOSTNAME_MISMATCH") {
                    return loginError(req, res, "La configuration SMTP utilise un nom d’hôte qui ne correspond pas au certificat TLS. Contactez l’administrateur.", 503);
                }
                console.error("Two-factor email delivery failed:", error);
                return loginError(req, res, "Impossible d’envoyer le code de vérification. Vérifiez votre adresse e-mail ou réessayez plus tard.", 503);
            }
            loginLog("two_factor.sent", { userId: user.id });
            if (req.headers["hx-request"]) {
                res.setHeader("HX-Redirect", "/auth/verify");
                return res.status(200).send();
            }
            return res.redirect("/auth/verify");
        }

        const activeCompanyId = establishSession(req, user, companies);
        loginLog("success.redirect", { userId: user.id, activeCompanyId });
        return loginRedirect(req, res, user, companies, activeCompanyId);
    } catch (error) {
        loginLog("failed", {
            error: error.message,
            code: error.code,
            identifier: safeIdentifier(req.body?.identifier || req.body?.username || req.body?.email),
        });

        let errorMsg = "Nom d’utilisateur ou mot de passe incorrect.";
        let errorStatus = 401;
        if (error.message === "MISSING_CREDENTIALS") {
            errorMsg = "Veuillez renseigner votre nom d’utilisateur et votre mot de passe.";
            errorStatus = 400;
        }
        return loginError(req, res, errorMsg, errorStatus);
    }
};

async function verificationPageData(req, error = null) {
    const pending = req.session?.pendingTwoFactor;
    const user = pending
        ? await prisma.users.findUnique({ where: { id: Number(pending.userId) }, select: { email: true } })
        : null;
    return { title: "Vérification", error, email: user?.email || "votre adresse e-mail" };
}

export const verifyTwoFactorPage = async (req, res) => {
    if (!req.session?.pendingTwoFactor) return res.redirect("/auth");
    return res.render("auth/verify", await verificationPageData(req));
};

export const verifyTwoFactor = async (req, res) => {
    const pending = req.session?.pendingTwoFactor;
    const code = String(req.body?.code || "").trim();
    if (!pending || Date.now() > Number(pending.expiresAt)) {
        delete req.session.pendingTwoFactor;
        await saveSession(req);
        return res.status(400).render("auth/verify", await verificationPageData(req, "Le code a expiré. Recommencez la connexion."));
    }
    pending.attempts = Number(pending.attempts || 0) + 1;
    if (pending.attempts > 5 || !/^\d{6}$/.test(code) || codeDigest(code) !== pending.codeDigest) {
        if (pending.attempts >= 5) delete req.session.pendingTwoFactor;
        await saveSession(req);
        return res.status(403).render("auth/verify", await verificationPageData(req, pending.attempts >= 5 ? "Trop de tentatives. Recommencez la connexion." : "Code incorrect."));
    }
    const user = await prisma.users.findUnique({ where: { id: Number(pending.userId) }, include: { userCompanies: true } });
    delete req.session.pendingTwoFactor;
    if (!user || user.isBlocked && !user.isAdmin) {
        await saveSession(req);
        return res.status(403).render("auth/verify", await verificationPageData(req, "Ce compte n’est plus autorisé à se connecter."));
    }
    const companies = user.userCompanies ?? [];
    establishSession(req, user, companies);
    await saveSession(req);
    return loginRedirect(req, res, user, companies, req.session.user.activeCompanyId);
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


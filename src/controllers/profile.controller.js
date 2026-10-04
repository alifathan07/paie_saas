import prisma from "../../db.ts";
import { changeUserPassword, updateUserProfile } from "../services/auth.service.js";
import { recordAudit } from "../services/audit.service.js";

const messages = {
    INVALID_NAME: "Le nom est obligatoire et doit contenir au maximum 191 caractères.",
    INVALID_EMAIL: "Veuillez renseigner une adresse e-mail valide.",
    EMAIL_ALREADY_EXISTS: "Cette adresse e-mail est déjà utilisée.",
    CURRENT_PASSWORD_INVALID: "Votre mot de passe actuel est incorrect.",
    PASSWORD_TOO_SHORT: "Le mot de passe doit contenir au moins 8 caractères.",
    PASSWORD_MISMATCH: "Les mots de passe ne correspondent pas.",
};

const pageData = (req, overrides = {}) => ({
    title: "Mon profil",
    currentPage: "profile",
    user: req.session.user,
    ...overrides,
});

export const profilePage = async (req, res) => {
    const account = await prisma.users.findUnique({ where: { id: Number(req.session.user.id) }, select: { id: true, name: true, email: true } });
    return res.render("profile/index", pageData(req, { account, profileError: null, profileSuccess: null, passwordError: null, passwordSuccess: null }));
};

export const updateProfile = async (req, res) => {
    try {
        const account = await updateUserProfile(req.session.user.id, req.body);
        req.session.user.name = account.name;
        req.session.user.email = account.email;
        await recordAudit(req, { action: "UPDATE_PROFILE", targetType: "USER", targetId: account.id });
        return res.render("profile/index", pageData(req, { account, profileError: null, profileSuccess: "Votre profil a été mis à jour.", passwordError: null, passwordSuccess: null }));
    } catch (error) {
        return res.status(400).render("profile/index", pageData(req, { account: { id: req.session.user.id, name: req.body.name, email: req.body.email }, profileError: messages[error.message] || "Impossible de mettre à jour le profil.", profileSuccess: null, passwordError: null, passwordSuccess: null }));
    }
};

export const changePassword = async (req, res) => {
    const account = await prisma.users.findUnique({ where: { id: Number(req.session.user.id) }, select: { id: true, name: true, email: true } });
    try {
        await changeUserPassword(req.session.user.id, req.body.currentPassword, req.body.password, req.body.passwordConfirmation);
        await recordAudit(req, { action: "CHANGE_PASSWORD", targetType: "USER", targetId: account.id });
        return res.render("profile/index", pageData(req, { account, profileError: null, profileSuccess: null, passwordError: null, passwordSuccess: "Votre mot de passe a été modifié." }));
    } catch (error) {
        return res.status(400).render("profile/index", pageData(req, { account, profileError: null, profileSuccess: null, passwordError: messages[error.message] || "Impossible de modifier le mot de passe.", passwordSuccess: null }));
    }
};

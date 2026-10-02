export function isAdmin(req, res, next) {
    const sessionUser = req.session?.user;
    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const isConfiguredAdmin = configuredEmail && String(sessionUser?.email || "").toLowerCase() === configuredEmail;
    if (sessionUser?.isAdmin || isConfiguredAdmin) {
        if (isConfiguredAdmin && !sessionUser.isAdmin) sessionUser.isAdmin = true;
        return next();
    }
    return res.status(403).send("ADMIN_ACCESS_REQUIRED");
}

export function isAdminUser(req) {
    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    return Boolean(req.session?.user?.isAdmin)
        || Boolean(configuredEmail && String(req.session?.user?.email || "").toLowerCase() === configuredEmail);
}

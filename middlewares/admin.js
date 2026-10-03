import prisma from "../db.ts";

export async function isAdmin(req, res, next) {
    const sessionUser = req.session?.user;
    if (!sessionUser) return res.status(403).send("ADMIN_ACCESS_REQUIRED");

    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const isConfiguredAdmin = configuredEmail && String(sessionUser?.email || "").toLowerCase() === configuredEmail;

    // Refresh the role from the database so sessions created before an admin
    // role was granted do not remain locked out until the user logs in again.
    let databaseAdmin = false;
    if (Number.isInteger(Number(sessionUser.id))) {
        const user = await prisma.users.findUnique({
            where: { id: Number(sessionUser.id) },
            select: { isAdmin: true },
        });
        databaseAdmin = Boolean(user?.isAdmin);
    }

    if (sessionUser.isAdmin || databaseAdmin || isConfiguredAdmin) {
        sessionUser.isAdmin = true;
        return next();
    }
    return res.status(403).send("ADMIN_ACCESS_REQUIRED");
}

export function isAdminUser(req) {
    const configuredEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    return Boolean(req.session?.user?.isAdmin)
        || Boolean(configuredEmail && String(req.session?.user?.email || "").toLowerCase() === configuredEmail);
}

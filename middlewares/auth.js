import prisma from "../db.ts";
import { getSessionUserId, resolveCompanyId } from "../src/lib/company.js";

export const isAuth = (req, res, next) => {
    if (req.session.user) {
        next();
    } else res.redirect("/auth");
}

export const requireActiveCompany = async (req, res, next) => {
    const sessionUser = req.session?.user;
    if (sessionUser?.isBlocked && !sessionUser?.isAdmin) {
        return res.status(403).send("ACCOUNT_BLOCKED");
    }
    const companyId = resolveCompanyId(req);
    if (!companyId) {
        console.warn("[auth.company] rejected.no_active_company", {
            userId: req.session?.user?.id,
            path: req.originalUrl,
        });
        return res.status(403).send("NO_ACTIVE_COMPANY");
    }

    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).send("UNAUTHENTICATED");

    const clientMode = req.session?.adminClientMode;
    if (sessionUser?.isAdmin && clientMode && Number(clientMode.companyId) === Number(companyId)) {
        const clientMembership = await prisma.userCompany.findUnique({
            where: { companyId_userId: { companyId, userId: Number(clientMode.userId) } },
            include: { user: { select: { isBlocked: true } } },
        });
        if (!clientMembership || clientMembership.user.isBlocked) {
            return res.status(403).send("CLIENT_MODE_FORBIDDEN");
        }
        req.activeCompanyId = companyId;
        console.info("[auth.company] authorized.client_mode", { userId, clientUserId: clientMode.userId, companyId, path: req.originalUrl });
        return next();
    }
    const membership = await prisma.userCompany.findUnique({
        where: { companyId_userId: { companyId, userId } },
        select: { companyId: true },
    });
    if (!membership) {
        console.warn("[auth.company] rejected.not_member", {
            userId,
            companyId,
            path: req.originalUrl,
        });
        return res.status(403).send("FORBIDDEN");
    }

    req.activeCompanyId = companyId;
    console.info("[auth.company] authorized", { userId, companyId, path: req.originalUrl });
    next();
};

import { prisma } from "./db.js";

export function getSessionCompanyId(req) {
    return req.session?.user?.companyId || req.session?.companyId || null;
}

export async function resolveCompanyId(req) {
    const fromSession = getSessionCompanyId(req);
    if (fromSession) return Number(fromSession);
    const first = await prisma.company.findFirst({ orderBy: { id: "asc" } });
    return first ? first.id : null;
}

export function pickLoginCompany(user) {
    const link = user?.userCompanies?.[0];
    if (!link) return { companyId: null, companyName: null };
    return {
        companyId: link.companyId,
        companyName: link.company?.name || null,
    };
}

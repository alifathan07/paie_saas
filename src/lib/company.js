export function getSessionCompanyId(req) {
    return req.session?.user?.activeCompanyId ?? null;
}

export function resolveCompanyId(req) {
    const companyId = getSessionCompanyId(req);
    if (!companyId) return null;

    const parsed = Number(companyId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getSessionUserId(req) {
    const id = Number(req.session?.user?.id);
    return Number.isInteger(id) && id > 0 ? id : null;
}

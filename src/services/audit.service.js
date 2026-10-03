import prisma from "../../db.ts";

export async function recordAudit(req, { action, targetType, targetId = null, companyId = null, metadata = null }) {
    const actorUserId = Number(req.session?.user?.id);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) return null;

    return prisma.auditLog.create({
        data: {
            actorUserId,
            action,
            targetType,
            targetId: targetId == null ? null : Number(targetId),
            companyId: companyId == null ? null : Number(companyId),
            metadata,
            ipAddress: req.ip || req.socket?.remoteAddress || null,
        },
    });
}

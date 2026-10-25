import prisma from "../../db.ts";

function companyKey(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("NO_ACTIVE_COMPANY");
    return id;
}

function cleanName(name) {
    const value = String(name || "").trim().slice(0, 191);
    if (!value) throw new Error("INVALID_TAXABLE_PRIME");
    return value;
}

function cleanCode(code) {
    const value = String(code || "").trim().slice(0, 64);
    if (!value) throw new Error("INVALID_TAXABLE_PRIME");
    return value;
}

function cleanAmount(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_TAXABLE_PRIME");
    return Number(value.toFixed(2));
}

export async function listPrimes(companyId) {
    return prisma.bonus.findMany({
        where: { companyId: companyKey(companyId), taxable: true },
        orderBy: { name: "asc" },
        include: { _count: { select: { employeeBonuses: true } } },
    });
}

export async function createPrimes({ companyId, rows = [] }) {
    const cId = companyKey(companyId);
    const data = rows.map(row => ({
        companyId: cId,
        code: cleanCode(row.code),
        name: cleanName(row.name),
        defaultAmount: cleanAmount(row.defaultAmount),
        taxable: true,
    }));
    if (!data.length) throw new Error("INVALID_TAXABLE_PRIME");
    return prisma.$transaction(data.map(item => prisma.bonus.create({ data: item })));
}

export async function updatePrime(id, { companyId, code, name, defaultAmount }) {
    const existing = await prisma.bonus.findFirst({
        where: { id: Number(id), companyId: companyKey(companyId), taxable: true },
    });
    if (!existing) throw new Error("TAXABLE_PRIME_NOT_FOUND");
    return prisma.bonus.update({
        where: { id: existing.id },
        data: { code: cleanCode(code), name: cleanName(name), defaultAmount: cleanAmount(defaultAmount) },
    });
}

export async function deletePrime(id, companyId) {
    const existing = await prisma.bonus.findFirst({
        where: { id: Number(id), companyId: companyKey(companyId), taxable: true },
        select: { id: true },
    });
    if (!existing) throw new Error("TAXABLE_PRIME_NOT_FOUND");
    return prisma.bonus.delete({ where: { id: existing.id } });
}

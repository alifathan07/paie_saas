import prisma from "../../db.ts";

const CATEGORY_CONFIG = Object.freeze({
    base: { model: "rubriqueBase", start: 1001, end: 1999 },
    retenu: { model: "rubriqueRetenu", start: 2001, end: 2999 },
    imposable: { model: "rubriqueImposable", start: 1001, end: 1999 },
});

function companyKey(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("NO_ACTIVE_COMPANY");
    return id;
}

function categoryKey(category) {
    if (!CATEGORY_CONFIG[category]) throw new Error("INVALID_RUBRIQUE_CATEGORY");
    return category;
}

function clean(value, max) {
    return String(value || "").trim().slice(0, max);
}

function cleanCode(value) {
    const code = clean(value, 64);
    if (!code) throw new Error("INVALID_RUBRIQUE_CODE");
    return code;
}

function cleanName(value) {
    const name = clean(value, 191);
    if (!name) throw new Error("INVALID_RUBRIQUE_NAME");
    return name;
}

function calculationKeyFromName(name) {
    return String(name)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 64) || null;
}

export async function listRubriques(companyId) {
    const id = companyKey(companyId);
    const [base, retenu, imposable] = await Promise.all([
        prisma.rubriqueBase.findMany({ where: { companyId: id }, orderBy: [{ key: "asc" }, { id: "asc" }] }),
        prisma.rubriqueRetenu.findMany({ where: { companyId: id }, orderBy: [{ key: "asc" }, { id: "asc" }] }),
        prisma.rubriqueImposable.findMany({ where: { companyId: id }, orderBy: [{ active: "desc" }, { name: "asc" }] }),
    ]);
    return { base, retenu, imposable };
}

export async function getRubriqueMaps(companyId) {
    const rows = await listRubriques(companyId);
    const base = Object.fromEntries(rows.base.filter(row => row.active).map(row => [row.key, row.code]));
    const retenu = Object.fromEntries(rows.retenu.filter(row => row.active).map(row => [row.key, row.code]));
    const imposable = Object.fromEntries(rows.imposable.filter(row => row.active).map(row => [row.calculationKey || row.code, row.code]));
    // Compatibility map for the current bulletin templates while they are migrated to keys.
    const codes = {
        "Salaire de base": base.base_salary,
        "Prime d'ancienneté": base.seniority_bonus,
        "Salaire brut imposable": base.taxable_gross_salary,
        "Salaire net imposable": base.taxable_net_salary,
        "Salaire net à payer": base.net_salary,
        "Nombre jours congé payé": base.paid_leave_days,
        "Nombre jours fériés": base.public_holiday_days,
        "CNSS": retenu.cnss,
        "AMO": retenu.amo,
        "CIMR": retenu.cimr,
        "Impôt sur le revenu": retenu.income_tax,
        "Frais professionnels": retenu.professional_expenses,
        "Arrondi": retenu.rounding,
    };
    return { ...rows, base, retenu, baseRows: rows.base, retenuRows: rows.retenu, imposable, imposableRows: rows.imposable, codes };
}

export async function updateFixedRubrique(category, id, companyId, data) {
    const categoryName = categoryKey(category);
    const idCompany = companyKey(companyId);
    const model = CATEGORY_CONFIG[categoryName].model;
    const existing = await prisma[model].findFirst({ where: { id: Number(id), companyId: idCompany } });
    if (!existing) throw new Error("RUBRIQUE_NOT_FOUND");
    return prisma[model].update({
        where: { id: existing.id },
        data: {
            code: cleanCode(data.code),
            name: data.name === undefined ? existing.name : cleanName(data.name),
            active: data.active !== false,
        },
    });
}

export async function createFixedRubrique(category, companyId, data) {
    const categoryName = categoryKey(category);
    const id = companyKey(companyId);
    const config = CATEGORY_CONFIG[categoryName];
    const name = cleanName(data.name);
    const key = clean(data.key, 64) || calculationKeyFromName(name);
    if (!key) throw new Error("INVALID_RUBRIQUE_KEY");
    const existingCodes = await prisma[config.model].findMany({ where: { companyId: id }, select: { code: true } });
    const code = clean(data.code, 64) || nextGeneratedCode(existingCodes.map(row => row.code), config.start, config.end);
    const createData = { companyId: id, key, name, code, active: true };
    if (categoryName === "retenu") createData.entryType = data.entryType === "SYSTEM" ? "SYSTEM" : "MANUAL";
    return prisma[config.model].create({ data: createData });
}

export async function createImposableRubrique(companyId, data) {
    const id = companyKey(companyId);
    const entryType = data.entryType === "CALCULATED" ? "CALCULATED" : "MANUAL_AMOUNT";
    const name = cleanName(data.name);
    const calculationKey = clean(data.calculationKey, 64) || calculationKeyFromName(name);
    if (entryType === "CALCULATED" && !calculationKey) throw new Error("INVALID_CALCULATION_KEY");
    const [baseRows, otherBaseRows] = await Promise.all([
        prisma.rubriqueBase.findMany({ where: { companyId: id }, select: { code: true } }),
        prisma.rubriqueImposable.findMany({ where: { companyId: id }, select: { code: true } }),
    ]);
    const code = clean(data.code, 64) || nextGeneratedCode(
        [...baseRows, ...otherBaseRows].map(row => row.code),
        CATEGORY_CONFIG.imposable.start,
        CATEGORY_CONFIG.imposable.end,
    );
    return prisma.rubriqueImposable.create({ data: { companyId: id, code, name, entryType, calculationKey: calculationKey || calculationKeyFromName(name), active: true } });
}

export async function updateImposableRubrique(id, companyId, data) {
    const existing = await prisma.rubriqueImposable.findFirst({ where: { id: Number(id), companyId: companyKey(companyId) } });
    if (!existing) throw new Error("RUBRIQUE_NOT_FOUND");
    const calculationKey = existing.calculationKey || calculationKeyFromName(cleanName(data.name));
    return prisma.rubriqueImposable.update({
        where: { id: existing.id },
        data: {
            code: cleanCode(data.code), name: cleanName(data.name),
            entryType: data.entryType === "CALCULATED" ? "CALCULATED" : "MANUAL_AMOUNT",
            calculationKey,
            active: data.active !== false,
        },
    });
}

export async function deleteRubrique(category, id, companyId) {
    const categoryName = categoryKey(category);
    const config = CATEGORY_CONFIG[categoryName];
    const existing = await prisma[config.model].findFirst({ where: { id: Number(id), companyId: companyKey(companyId) } });
    if (!existing) throw new Error("RUBRIQUE_NOT_FOUND");
    return prisma[config.model].delete({ where: { id: existing.id } });
}

export function nextGeneratedCode(existingCodes, start, end) {
    const used = new Set(existingCodes.map(value => Number(value)).filter(value => Number.isInteger(value) && value >= start && value <= end));
    let code = start;
    while (used.has(code) && code <= end) code += 1;
    if (code > end) throw new Error("RUBRIQUE_CODE_SPACE_EXHAUSTED");
    return String(code);
}

export const RUBRIQUE_CATEGORY_CONFIG = CATEGORY_CONFIG;

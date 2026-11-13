import prisma from "../../db.ts";

// These are definitions only. Amounts and future company-specific settings must
// stay company-owned and must never be copied from another company.
export const DEFAULT_BASE_RUBRIQUES = Object.freeze([
    { key: "base_salary", name: "Salaire de base", code: "1001" },
    { key: "seniority_bonus", name: "Prime d'ancienneté", code: "1002" },
    { key: "taxable_gross_salary", name: "Salaire brut imposable", code: "1003" },
    { key: "taxable_net_salary", name: "Salaire net imposable", code: "1004" },
    { key: "net_salary", name: "Salaire net à payer", code: "1005" },
    { key: "paid_leave_days", name: "Nombre jours congé payé", code: "1009" },
    { key: "public_holiday_days", name: "Nombre jours fériés", code: "1010" },
    { key: "birth_leave_days", name: "Nombre jours congé de naissance", code: "1011" },
]);

export const DEFAULT_RETENU_RUBRIQUES = Object.freeze([
    { key: "cnss", name: "CNSS", code: "2001", entryType: "SYSTEM" },
    { key: "amo", name: "AMO", code: "2002", entryType: "SYSTEM" },
    { key: "cimr", name: "CIMR", code: "2003", entryType: "SYSTEM" },
    { key: "income_tax", name: "Impôt sur le revenu", code: "2004", entryType: "SYSTEM" },
    { key: "professional_expenses", name: "Frais professionnels", code: "2006", entryType: "SYSTEM" },
    { key: "rounding", name: "Arrondi", code: "2007", entryType: "SYSTEM" },
    { key: "loan", name: "Retenue prêt", code: "2008", entryType: "MANUAL" },
]);

export const DEFAULT_IMPOSABLE_RUBRIQUES = Object.freeze([
    { code: "1006", name: "Heures supplémentaires 25%", calculationKey: "overtime_25" },
    { code: "1007", name: "Heures supplémentaires 50%", calculationKey: "overtime_50" },
    { code: "1008", name: "Heures supplémentaires 100%", calculationKey: "overtime_100" },
]);

function nextImposableCode(existingCodes) {
    const used = new Set(existingCodes.map(code => Number(code)).filter(code => Number.isInteger(code) && code >= 1001 && code <= 1999));
    for (let code = 1001; code <= 1999; code += 1) {
        if (!used.has(code)) return String(code);
    }
    throw new Error("Aucun code disponible pour une rubrique imposable.");
}

/**
 * Provision the standard catalogue for one company.
 * This function is deliberately idempotent and never updates existing rows,
 * so company-specific names, codes, visibility and settings are preserved.
 */
export async function initializeCompanyRubriques(companyId, client = prisma) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("INVALID_COMPANY_ID");

    for (const row of DEFAULT_BASE_RUBRIQUES) {
        await client.rubriqueBase.upsert({
            where: { companyId_key: { companyId: id, key: row.key } },
            update: {},
            create: { companyId: id, ...row },
        });
    }

    for (const row of DEFAULT_RETENU_RUBRIQUES) {
        await client.rubriqueRetenu.upsert({
            where: { companyId_key: { companyId: id, key: row.key } },
            update: {},
            create: { companyId: id, ...row },
        });
    }

    for (const row of DEFAULT_IMPOSABLE_RUBRIQUES) {
        await client.rubriqueImposable.upsert({
            where: { companyId_code: { companyId: id, code: row.code } },
            update: {},
            create: { companyId: id, ...row, entryType: "CALCULATED" },
        });
    }

    const existingManual = await client.rubriqueImposable.findFirst({
        where: { companyId: id, name: "Rappelle" },
        select: { id: true },
    });
    if (!existingManual) {
        const [baseRows, imposableRows] = await Promise.all([
            client.rubriqueBase.findMany({ where: { companyId: id }, select: { code: true } }),
            client.rubriqueImposable.findMany({ where: { companyId: id }, select: { code: true } }),
        ]);
        await client.rubriqueImposable.create({
            data: {
                companyId: id,
                code: nextImposableCode([...baseRows, ...imposableRows].map(item => item.code)),
                name: "Rappelle",
                entryType: "MANUAL_AMOUNT",
                calculationKey: "rappelle",
            },
        });
    }
}


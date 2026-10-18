import prisma from "../../db.ts";
import { getRubriqueMaps } from "./rubrique.service.js";

export const BULLETIN_RUBRIQUES = Object.freeze({
    baseSalary: 'Salaire de base',
    anciennete: "Prime d'ancienneté",
    sbi: 'Salaire brut imposable',
    netAPayer: 'Salaire net à payer',
});

export async function listBulletinRubriques() {
    return prisma.bulletinRubrique.findMany({ orderBy: { id: 'asc' } });
}

export async function getBulletinRubriqueCodes(companyId) {
    if (companyId) return (await getRubriqueMaps(companyId)).codes;
    const rows = await listBulletinRubriques();
    return Object.fromEntries(rows.map(row => [row.name, row.code]));
}

export async function updateBulletinRubriques(rows = []) {
    return prisma.$transaction(async tx => {
        for (const row of Array.isArray(rows) ? rows : []) {
            const id = Number(row.id);
            const code = String(row.code || '').trim();
            if (!Number.isInteger(id) || !code) continue;
            await tx.bulletinRubrique.update({ where: { id }, data: { code } });
        }
    });
}

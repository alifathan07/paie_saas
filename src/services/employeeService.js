import prisma from "../../db.ts";

// Get all reusable Non-Taxable Bonus definitions for a company
export const getAllBonusTypes = async (companyId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    return prisma.bonus.findMany({
        where: { companyId: cId },
        orderBy: { name: 'asc' }
    });
};

// Find or create a bonus definition scoped to a specific company
export const findOrCreateBonusDefinition = async (name, companyId) => {
    const cleanName = name.trim();
    const cId = Number(companyId);
    let bonus = await prisma.bonus.findUnique({
        where: {
            companyId_name: { companyId: cId, name: cleanName }
        }
    });

    if (!bonus) {
        bonus = await prisma.bonus.create({
            data: {
                companyId: cId,
                name: cleanName,
                taxable: false // Non-taxable fixed bonuses catalog
            }
        });
    }

    return bonus;
};

export const getEmployees = async (query = {}) => {
    const { search, statut, companyId } = query;
    const where = {};

    if (search) {
        where.OR = [
            { nomComplet: { contains: search } },
            { matricule: { contains: search } },
            { cin: { contains: search } }
        ];
    }
    if (statut) where.statut = statut;
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    where.companyId = cId;

    return prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            company: true,
            bonuses: {
                include: { bonus: true }
            }
        }
    });
};

export const getEmployee = async (id, companyId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    const employee = await prisma.employee.findFirst({
        where: { id: Number(id), companyId: cId },
        include: {
            company: true,
            bonuses: {
                include: { bonus: true }
            }
        }
    });

    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    return employee;
};

// Helper: resolve bonus definitions and amounts from a mixed list
// Each item can be: { bonusId, amount } (existing) or { name, amount, companyId } (new)
async function resolveBonusList(bonusList, fallbackCompanyId) {
    const result = [];
    for (const item of bonusList) {
        if (!item.amount || Number(item.amount) === 0) continue;

        let bonusDef;
        if (item.bonusId) {
            bonusDef = await prisma.bonus.findFirst({
                where: { id: Number(item.bonusId), companyId: Number(fallbackCompanyId) }
            });
        } else if (item.name && item.name.trim() !== '') {
            bonusDef = await findOrCreateBonusDefinition(item.name, fallbackCompanyId);
        }

        if (bonusDef) {
            result.push({ bonusId: bonusDef.id, amount: Number(item.amount) });
        }
    }
    return result;
}

export const createEmployee = async (data) => {
    const {
        matricule, nomComplet, cin, dateNaissance, sexe,
        dateEmbauche, dateAnciennete, dateSortie, fonction, codeService,
        contratDateDebut, contratDateFin,
        statut, natureEmploi, situationFam, nbPersonacharge, nbEnfantCharge,
        adresse, ville, numeroCNSS, dateAffiliationCnss, modePaiement,
        banque, agence, rib, actif, baseSalary, companyId, bonusList,
        cimrRate, cimrReduitBaseImposable, indemniteNonImposable, blocageSaisiePaie
    } = data;

    const targetCompanyId = Number(companyId);
    if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) throw new Error('NO_ACTIVE_COMPANY');

    const employeeBonusData = bonusList?.length > 0
        ? await resolveBonusList(bonusList, targetCompanyId)
        : [];

    return prisma.employee.create({
        data: {
            matricule: matricule || `EMP-${Date.now().toString().slice(-4)}`,
            nomComplet,
            cin,
            dateNaissance: new Date(dateNaissance),
            sexe: sexe || 'M',
            dateEmbauche: new Date(dateEmbauche),
            dateAnciennete: dateAnciennete ? new Date(dateAnciennete) : new Date(dateEmbauche),
            dateSortie: dateSortie ? new Date(dateSortie) : null,
            fonction,
            codeService,
            contratDateDebut: contratDateDebut ? new Date(contratDateDebut) : null,
            contratDateFin: contratDateFin ? new Date(contratDateFin) : null,
            statut: statut || 'TITULAIRE',
            natureEmploi: natureEmploi || 'PERMANENT',
            situationFam: situationFam || 'CELIBATAIRE',
            nbPersonacharge: Number(nbPersonacharge || 0),
            nbEnfantCharge: Number(nbEnfantCharge || 0),
            adresse,
            ville,
            numeroCNSS,
            dateAffiliationCnss: dateAffiliationCnss ? new Date(dateAffiliationCnss) : null,
            modePaiement: modePaiement || 'VIREMENT',
            banque,
            agence,
            rib,
            actif: actif === undefined ? true : Boolean(actif),
            baseSalary: Number(baseSalary || 0),
            cimrRate: cimrRate !== undefined && cimrRate !== null && cimrRate !== ''
                ? Number(cimrRate)
                : null,
            cimrReduitBaseImposable: Boolean(cimrReduitBaseImposable),
            indemniteNonImposable: Boolean(indemniteNonImposable),
            blocageSaisiePaie: Boolean(blocageSaisiePaie),
            companyId: targetCompanyId,
            bonuses: employeeBonusData.length > 0 ? { create: employeeBonusData } : undefined
        },
        include: {
            company: true,
            bonuses: { include: { bonus: true } }
        }
    });
};

export const updateEmployee = async (id, data, activeCompanyId) => {
    const {
        matricule, nomComplet, cin, dateNaissance, sexe,
        dateEmbauche, dateAnciennete, dateSortie, fonction, codeService,
        contratDateDebut, contratDateFin,
        statut, natureEmploi, situationFam, nbPersonacharge, nbEnfantCharge,
        adresse, ville, numeroCNSS, dateAffiliationCnss, modePaiement,
        banque, agence, rib, actif, baseSalary, companyId, bonusList,
        cimrRate, cimrReduitBaseImposable, indemniteNonImposable, blocageSaisiePaie
    } = data;

    const empId = Number(id);

    // Get employee's companyId as fallback for new bonus creation
    const targetCompanyId = Number(activeCompanyId);
    if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    const existing = await prisma.employee.findFirst({
        where: { id: empId, companyId: targetCompanyId },
        select: { companyId: true }
    });
    if (!existing) throw new Error('EMPLOYEE_NOT_FOUND');

    // Replace all bonus assignments
    await prisma.employeeBonus.deleteMany({ where: { employeeId: empId } });

    const employeeBonusData = bonusList?.length > 0
        ? await resolveBonusList(bonusList, targetCompanyId)
        : [];

    return prisma.employee.update({
        where: { id: empId },
        data: {
            matricule,
            nomComplet,
            cin,
            dateNaissance: dateNaissance ? new Date(dateNaissance) : undefined,
            sexe,
            dateEmbauche: dateEmbauche ? new Date(dateEmbauche) : undefined,
            dateAnciennete: dateAnciennete ? new Date(dateAnciennete) : undefined,
            dateSortie: dateSortie ? new Date(dateSortie) : null,
            fonction,
            codeService,
            contratDateDebut: contratDateDebut ? new Date(contratDateDebut) : null,
            contratDateFin: contratDateFin ? new Date(contratDateFin) : null,
            statut,
            natureEmploi,
            situationFam,
            nbPersonacharge: nbPersonacharge !== undefined ? Number(nbPersonacharge) : undefined,
            nbEnfantCharge: nbEnfantCharge !== undefined ? Number(nbEnfantCharge) : undefined,
            adresse,
            ville,
            numeroCNSS,
            dateAffiliationCnss: dateAffiliationCnss ? new Date(dateAffiliationCnss) : null,
            modePaiement,
            banque,
            agence,
            rib,
            actif: actif !== undefined ? Boolean(actif) : undefined,
            baseSalary: baseSalary !== undefined ? Number(baseSalary) : undefined,
            cimrRate: cimrRate !== undefined
                ? (cimrRate === '' || cimrRate === null ? null : Number(cimrRate))
                : undefined,
            cimrReduitBaseImposable: cimrReduitBaseImposable !== undefined
                ? Boolean(cimrReduitBaseImposable)
                : undefined,
            indemniteNonImposable: indemniteNonImposable !== undefined
                ? Boolean(indemniteNonImposable)
                : undefined,
            blocageSaisiePaie: blocageSaisiePaie !== undefined
                ? Boolean(blocageSaisiePaie)
                : undefined,
            companyId: undefined,
            bonuses: employeeBonusData.length > 0 ? { create: employeeBonusData } : undefined
        },
        include: {
            company: true,
            bonuses: { include: { bonus: true } }
        }
    });
};

export const deleteEmployee = async (id, companyId) => {
    const employee = await prisma.employee.findFirst({ where: { id: Number(id), companyId: Number(companyId) }, select: { id: true } });
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    return prisma.employee.delete({ where: { id: employee.id } });
};

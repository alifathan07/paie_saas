import prisma from "../../db.ts";
import { refreshDraftPayslips } from "./employeePayrollRefresh.service.js";

// Get all reusable Non-Taxable Bonus definitions for a company
export const getAllBonusTypes = async (companyId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    return prisma.bonus.findMany({
        where: { companyId: cId },
        orderBy: { name: 'asc' }
    });
};

const cleanCategoryName = name => String(name || '').trim().slice(0, 191);

export const getEmployeeCategories = async (companyId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    return prisma.employeeCategory.findMany({
        where: { companyId: cId }, orderBy: { name: 'asc' },
        include: { _count: { select: { employees: true } } },
    });
};

export const getOrCreateEmployeeCategory = async (companyId, categoryId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    if (categoryId !== undefined && categoryId !== null && String(categoryId).trim() !== '') {
        const category = await prisma.employeeCategory.findFirst({ where: { id: Number(categoryId), companyId: cId } });
        if (!category) throw new Error('EMPLOYEE_CATEGORY_NOT_FOUND');
        return category;
    }
    return prisma.employeeCategory.upsert({
        where: { companyId_name: { companyId: cId, name: 'Employé' } },
        create: { companyId: cId, name: 'Employé' }, update: {},
    });
};

export const getOrCreateEmployeeCategoryByName = async (companyId, name) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    const categoryName = cleanCategoryName(name) || 'Employé';
    return prisma.employeeCategory.upsert({
        where: { companyId_name: { companyId: cId, name: categoryName } },
        create: { companyId: cId, name: categoryName },
        update: {},
    });
};

export const createEmployeeCategory = async (companyId, name) => {
    const clean = cleanCategoryName(name);
    if (!clean) throw new Error('INVALID_EMPLOYEE_CATEGORY');
    return prisma.employeeCategory.create({ data: { companyId: Number(companyId), name: clean } });
};

export const updateEmployeeCategory = async (id, companyId, name) => {
    const clean = cleanCategoryName(name);
    if (!clean) throw new Error('INVALID_EMPLOYEE_CATEGORY');
    const category = await prisma.employeeCategory.findFirst({ where: { id: Number(id), companyId: Number(companyId) } });
    if (!category) throw new Error('EMPLOYEE_CATEGORY_NOT_FOUND');
    return prisma.employeeCategory.update({ where: { id: category.id }, data: { name: clean } });
};

export const deleteEmployeeCategory = async (id, companyId) => {
    const category = await prisma.employeeCategory.findFirst({
        where: { id: Number(id), companyId: Number(companyId) },
        include: { _count: { select: { employees: true } } },
    });
    if (!category) throw new Error('EMPLOYEE_CATEGORY_NOT_FOUND');
    if (category._count.employees > 0) throw new Error('EMPLOYEE_CATEGORY_IN_USE');
    return prisma.employeeCategory.delete({ where: { id: category.id } });
};

export const getEmployeeFunctions = async (companyId) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    return prisma.employeeFunction.findMany({
        where: { companyId: cId }, orderBy: { name: 'asc' },
        include: { _count: { select: { employees: true } } },
    });
};

export const getOrCreateEmployeeFunction = async (companyId, functionId, name, code) => {
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    if (functionId !== undefined && functionId !== null && String(functionId).trim() !== '') {
        const employeeFunction = await prisma.employeeFunction.findFirst({ where: { id: Number(functionId), companyId: cId } });
        if (!employeeFunction) throw new Error('EMPLOYEE_FUNCTION_NOT_FOUND');
        return employeeFunction;
    }
    const clean = String(name || '').trim().slice(0, 191);
    if (!clean) return null;
    const existing = await prisma.employeeFunction.findUnique({ where: { companyId_name: { companyId: cId, name: clean } } });
    if (existing) return existing;
    const generatedCode = String(code || `FONCTION-${Date.now()}`).trim().slice(0, 64);
    return prisma.employeeFunction.upsert({
        where: { companyId_name: { companyId: cId, name: clean } },
        create: { companyId: cId, name: clean, code: generatedCode }, update: {},
    });
};

export const createEmployeeFunction = async (companyId, name, code) => {
    const clean = String(name || '').trim().slice(0, 191);
    const cleanCode = String(code || '').trim().slice(0, 64);
    if (!clean || !cleanCode) throw new Error('INVALID_EMPLOYEE_FUNCTION');
    return prisma.employeeFunction.create({ data: { companyId: Number(companyId), name: clean, code: cleanCode } });
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
                code: `RUB-${Date.now()}`,
                name: cleanName,
                taxable: false // Non-taxable fixed bonuses catalog
            }
        });
    }

    return bonus;
};

// Create a reusable taxable fixed-prime definition for a company.
export const createTaxablePrime = async (name, defaultAmount, companyId, code) => {
    const cleanName = String(name || '').trim();
    const cleanCode = String(code || '').trim();
    const amount = Number(defaultAmount);
    const cId = Number(companyId);
    if (!cleanName || !cleanCode || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(cId) || cId <= 0) {
        throw new Error('INVALID_TAXABLE_PRIME');
    }
    return prisma.bonus.create({
        data: { companyId: cId, code: cleanCode, name: cleanName, defaultAmount: Number(amount.toFixed(2)), taxable: true },
    });
};

export const getEmployees = async (query = {}) => {
    const { search, categoryId, companyId } = query;
    const where = {};

    if (search) {
        where.OR = [
            { nomComplet: { contains: search } },
            { matricule: { contains: search } },
            { cin: { contains: search } }
        ];
    }
    if (categoryId) where.categoryId = Number(categoryId);
    const cId = Number(companyId);
    if (!Number.isInteger(cId) || cId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    where.companyId = cId;

    return prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            company: true,
            category: true,
            employeeFunction: true,
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
            category: true,
            employeeFunction: true,
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
        let bonusDef;
        if (item.bonusId) {
            bonusDef = await prisma.bonus.findFirst({
                where: { id: Number(item.bonusId), companyId: Number(fallbackCompanyId) }
            });
        } else if (item.name && item.name.trim() !== '') {
            bonusDef = await findOrCreateBonusDefinition(item.name, fallbackCompanyId);
        }

        const amount = Number(item.amount || 0);
        if (bonusDef && Number.isFinite(amount) && amount >= 0 && (!bonusDef.taxable || amount > 0)) {
            result.push({
                bonusId: bonusDef.id,
                amount,
                ...(bonusDef.taxable ? {
                    implementerEnConge: item.implementerEnConge === undefined
                        ? false
                        : Boolean(item.implementerEnConge),
                    implementerEnJourFerie: item.implementerEnJourFerie === undefined
                        ? false
                        : Boolean(item.implementerEnJourFerie),
                } : {}),
            });
        }
    }
    return result;
}

export const createEmployee = async (data) => {
    const {
        matricule, nomComplet, cin, dateNaissance, sexe,
        dateEmbauche, dateAnciennete, dateSortie, fonction, functionId, codeService,
        contratDateDebut, contratDateFin,
        categoryId, natureEmploi, situationFam, nbPersonacharge, nbEnfantCharge,
        adresse, ville, numeroCNSS, dateAffiliationCnss, modePaiement,
        banque, agence, rib, actif, baseSalary, companyId, bonusList,
        cimrRate, cimrReduitBaseImposable,
        indemniteRepresentationName, indemniteRepresentationRate, blocageSaisiePaie
    } = data;

    const targetCompanyId = Number(companyId);
    if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    const category = await getOrCreateEmployeeCategory(targetCompanyId, categoryId);
    const employeeFunction = await getOrCreateEmployeeFunction(targetCompanyId, functionId, fonction);

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
            functionId: employeeFunction?.id || null,
            codeService: employeeFunction?.code || null,
            contratDateDebut: contratDateDebut ? new Date(contratDateDebut) : null,
            contratDateFin: contratDateFin ? new Date(contratDateFin) : null,
            categoryId: category.id,
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
            rib: rib === undefined || rib === null ? null : String(rib).trim() || null,
            actif: actif === undefined ? true : Boolean(actif),
            baseSalary: Number(baseSalary || 0),
            cimrRate: cimrRate !== undefined && cimrRate !== null && cimrRate !== ''
                ? Number(cimrRate)
                : null,
            cimrReduitBaseImposable: Boolean(cimrReduitBaseImposable),
            indemniteRepresentationName: indemniteRepresentationRate !== undefined && indemniteRepresentationRate !== null && indemniteRepresentationRate !== ''
                ? 'Indemnité de représentation'
                : null,
            indemniteRepresentationRate: indemniteRepresentationRate !== undefined && indemniteRepresentationRate !== null && indemniteRepresentationRate !== ''
                ? Number(indemniteRepresentationRate) / 100
                : null,
            blocageSaisiePaie: Boolean(blocageSaisiePaie),
            companyId: targetCompanyId,
            bonuses: employeeBonusData.length > 0 ? { create: employeeBonusData } : undefined
        },
        include: {
            company: true,
            category: true,
            employeeFunction: true,
            bonuses: { include: { bonus: true } }
        }
    });
};

export const updateEmployee = async (id, data, activeCompanyId) => {
    const {
        matricule, nomComplet, cin, dateNaissance, sexe,
        dateEmbauche, dateAnciennete, dateSortie, fonction, functionId, codeService,
        contratDateDebut, contratDateFin,
        categoryId, natureEmploi, situationFam, nbPersonacharge, nbEnfantCharge,
        adresse, ville, numeroCNSS, dateAffiliationCnss, modePaiement,
        banque, agence, rib, actif, baseSalary, companyId, bonusList,
        cimrRate, cimrReduitBaseImposable,
        indemniteRepresentationName, indemniteRepresentationRate, blocageSaisiePaie,
        replaceNonTaxableBonuses
    } = data;

    const empId = Number(id);

    // Get employee's companyId as fallback for new bonus creation
    const targetCompanyId = Number(activeCompanyId);
    if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) throw new Error('NO_ACTIVE_COMPANY');
    const category = categoryId !== undefined && categoryId !== ''
        ? await getOrCreateEmployeeCategory(targetCompanyId, categoryId)
        : null;
    const employeeFunction = functionId !== undefined || fonction !== undefined
        ? await getOrCreateEmployeeFunction(targetCompanyId, functionId, fonction)
        : undefined;
    const existing = await prisma.employee.findFirst({
        where: { id: empId, companyId: targetCompanyId },
        select: { companyId: true }
    });
    if (!existing) throw new Error('EMPLOYEE_NOT_FOUND');

    // Only replace bonus assignments when the edit form explicitly submitted them.
    const shouldReplaceBonuses = bonusList !== undefined;
    const employeeBonusData = shouldReplaceBonuses && bonusList.length > 0
        ? await resolveBonusList(bonusList, targetCompanyId)
        : [];

    return prisma.$transaction(async tx => {
        const preservedBonuses = shouldReplaceBonuses && !replaceNonTaxableBonuses
            ? await tx.employeeBonus.findMany({
                where: { employeeId: empId, bonus: { taxable: false } },
                select: { bonusId: true, amount: true, implementerEnConge: true },
            })
            : [];
        if (shouldReplaceBonuses) {
            await tx.employeeBonus.deleteMany({ where: { employeeId: empId } });
        }
        const mergedBonusMap = new Map(preservedBonuses.map(row => [row.bonusId, { bonusId: row.bonusId, amount: row.amount, implementerEnConge: row.implementerEnConge }]));
        employeeBonusData.forEach(row => mergedBonusMap.set(row.bonusId, row));
        const bonusesToCreate = [...mergedBonusMap.values()];
        const updated = await tx.employee.update({
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
            functionId: employeeFunction === undefined ? undefined : (employeeFunction?.id || null),
            codeService: employeeFunction === undefined ? undefined : (employeeFunction?.code || null),
            contratDateDebut: contratDateDebut ? new Date(contratDateDebut) : null,
            contratDateFin: contratDateFin ? new Date(contratDateFin) : null,
            categoryId: category ? category.id : undefined,
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
            rib: rib === undefined ? undefined : (rib === null ? null : String(rib).trim() || null),
            actif: actif !== undefined ? Boolean(actif) : undefined,
            baseSalary: baseSalary !== undefined ? Number(baseSalary) : undefined,
            cimrRate: cimrRate !== undefined
                ? (cimrRate === '' || cimrRate === null ? null : Number(cimrRate))
                : undefined,
            cimrReduitBaseImposable: cimrReduitBaseImposable !== undefined
                ? Boolean(cimrReduitBaseImposable)
                : undefined,
            indemniteRepresentationName: indemniteRepresentationRate !== undefined
                ? (indemniteRepresentationRate === '' || indemniteRepresentationRate === null
                    ? null
                    : 'Indemnité de représentation')
                : undefined,
            indemniteRepresentationRate: indemniteRepresentationRate !== undefined
                ? (indemniteRepresentationRate === '' || indemniteRepresentationRate === null
                    ? null
                    : Number(indemniteRepresentationRate) / 100)
                : undefined,
            blocageSaisiePaie: blocageSaisiePaie !== undefined
                ? Boolean(blocageSaisiePaie)
                : undefined,
            companyId: undefined,
                bonuses: shouldReplaceBonuses ? { create: bonusesToCreate } : undefined
            },
            include: {
                company: true,
                category: true,
                employeeFunction: true,
                bonuses: { include: { bonus: true } }
            }
        });
        // Employee edits affect only open bulletins. The refresh service limits
        // itself to DRAFT/GENERATED records, so validated and closed bulletins
        // remain immutable snapshots while the next bulletin uses new data.
        await refreshDraftPayslips(tx, updated);
        return updated;
    });
};

export const setEmployeeTaxablePrime = async (employeeId, bonusId, amount, companyId, enabled, implementerEnConge, implementerEnJourFerie) => {
    const employee = await prisma.employee.findFirst({
        where: { id: Number(employeeId), companyId: Number(companyId) },
        select: { id: true },
    });
    const bonus = await prisma.bonus.findFirst({
        where: { id: Number(bonusId), companyId: Number(companyId), taxable: true },
        select: { id: true, defaultAmount: true },
    });
    if (!employee || !bonus) throw new Error('TAXABLE_PRIME_NOT_FOUND');

    if (!enabled) {
        await prisma.employeeBonus.deleteMany({ where: { employeeId: employee.id, bonusId: bonus.id } });
    } else {
        const value = Number(amount || bonus.defaultAmount);
        if (!Number.isFinite(value) || value <= 0) throw new Error('INVALID_TAXABLE_PRIME_AMOUNT');
        await prisma.employeeBonus.upsert({
            where: { employeeId_bonusId: { employeeId: employee.id, bonusId: bonus.id } },
            create: { employeeId: employee.id, bonusId: bonus.id, amount: Number(value.toFixed(2)), implementerEnConge: Boolean(implementerEnConge), implementerEnJourFerie: Boolean(implementerEnJourFerie) },
            update: {
                amount: Number(value.toFixed(2)),
                ...(implementerEnConge === undefined ? {} : { implementerEnConge: Boolean(implementerEnConge) }),
                ...(implementerEnJourFerie === undefined ? {} : { implementerEnJourFerie: Boolean(implementerEnJourFerie) }),
            },
        });
    }
    const updatedEmployee = await prisma.employee.findUnique({
        where: { id: employee.id },
        include: { company: true, bonuses: { include: { bonus: true } } },
    });
    await refreshDraftPayslips(prisma, updatedEmployee);
    return { enabled: Boolean(enabled) };
};

export const deleteEmployee = async (id, companyId) => {
    const employee = await prisma.employee.findFirst({ where: { id: Number(id), companyId: Number(companyId) }, select: { id: true } });
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    return prisma.employee.delete({ where: { id: employee.id } });
};

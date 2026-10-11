import prisma from "../../db.ts";
import { refreshDraftPayslips } from "./employeePayrollRefresh.service.js";

export const DEFAULT_REPRESENTATION_RATE = 0.10;
export const REPRESENTATION_NAME = 'Indemnité de représentation';

function companyKey(companyId) {
    const id = Number(companyId);
    if (!Number.isInteger(id) || id <= 0) throw new Error("NO_ACTIVE_COMPANY");
    return id;
}

function cleanName(name) { return String(name || "").trim().slice(0, 191); }
function isRepresentationName(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase() === 'indemnite de representation';
}
function cleanAmount(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new Error("INVALID_INDEMNITE_AMOUNT");
    return Number(value.toFixed(2));
}

function cleanRate(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("INVALID_REPRESENTATION_RATE");
    return Number((value / 100).toFixed(4));
}

export async function getRepresentationRate(companyId) {
    const company = await prisma.company.findUnique({
        where: { id: companyKey(companyId) },
        select: { indemniteRepresentationRate: true },
    });
    return company?.indemniteRepresentationRate === undefined || company?.indemniteRepresentationRate === null
        ? DEFAULT_REPRESENTATION_RATE
        : Number(company.indemniteRepresentationRate);
}

export async function updateRepresentationRate(companyId, rate) {
    const cId = companyKey(companyId);
    const normalizedRate = cleanRate(rate);
    const catalogueRate = Number((normalizedRate * 100).toFixed(2));
    return prisma.$transaction(async tx => {
        const company = await tx.company.update({
            where: { id: cId },
            data: { indemniteRepresentationRate: normalizedRate },
            select: { indemniteRepresentationRate: true },
        });
        const definitions = await tx.bonus.findMany({
            where: { companyId: cId, taxable: false },
            select: { id: true, name: true },
        });
        const existingDefinition = definitions.find(definition => isRepresentationName(definition.name));
        if (existingDefinition) {
            await tx.bonus.update({
                where: { id: existingDefinition.id },
                data: { name: REPRESENTATION_NAME, defaultAmount: catalogueRate, taxable: false },
            });
        } else {
            await tx.bonus.create({
                data: { companyId: cId, name: REPRESENTATION_NAME, defaultAmount: catalogueRate, taxable: false },
            });
        }
        return company;
    });
}

// Indemnities reuse the existing non-taxable Bonus catalog and EmployeeBonus amounts.
export async function listIndemnites(companyId) {
    const rows = await prisma.bonus.findMany({
        where: { companyId: companyKey(companyId), taxable: false },
        orderBy: { name: "asc" },
        include: { _count: { select: { employeeBonuses: true } } },
    });
    return rows.map(row => ({
        ...row,
        isRepresentation: isRepresentationName(row.name),
        _count: { employees: row._count.employeeBonuses },
    }));
}

export async function createIndemnite({ companyId, name, defaultAmount }) {
    const clean = cleanName(name);
    if (!clean) throw new Error("INVALID_INDEMNITE_NAME");
    return prisma.bonus.create({ data: { companyId: companyKey(companyId), name: clean, defaultAmount: cleanAmount(defaultAmount), taxable: false } });
}

export async function updateIndemnite(id, { companyId, name, defaultAmount }) {
    const existing = await prisma.bonus.findFirst({ where: { id: Number(id), companyId: companyKey(companyId), taxable: false } });
    if (!existing) throw new Error("INDEMNITE_NOT_FOUND");
    if (isRepresentationName(existing.name)) {
        return updateRepresentationRate(companyId, defaultAmount);
    }
    const clean = cleanName(name);
    if (!clean) throw new Error("INVALID_INDEMNITE_NAME");
    return prisma.bonus.update({ where: { id: existing.id }, data: { name: clean, defaultAmount: cleanAmount(defaultAmount) } });
}

export async function deleteIndemnite(id, companyId) {
    const existing = await prisma.bonus.findFirst({ where: { id: Number(id), companyId: companyKey(companyId), taxable: false }, select: { id: true } });
    if (!existing) throw new Error("INDEMNITE_NOT_FOUND");
    return prisma.bonus.delete({ where: { id: existing.id } });
}

export async function saveEmployeeIndemnites(employeeId, companyId, rows = []) {
    const empId = Number(employeeId);
    const cId = companyKey(companyId);
    const employee = await prisma.employee.findFirst({ where: { id: empId, companyId: cId }, select: { id: true } });
    if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
    const normalized = [];
    const seen = new Set();
    let representationSelected = false;
    let representationDefinition = null;
    for (const row of Array.isArray(rows) ? rows : []) {
        const bonusId = Number(row.bonusId);
        if (!Number.isInteger(bonusId) || seen.has(bonusId)) continue;
        const definition = await prisma.bonus.findFirst({ where: { id: bonusId, companyId: cId, taxable: false } });
        if (!definition) continue;
        if (isRepresentationName(definition.name)) {
            representationSelected = true;
            representationDefinition = definition;
        } else {
            normalized.push({ bonusId, amount: cleanAmount(row.amount) });
        }
        seen.add(bonusId);
    }
    return prisma.$transaction(async tx => {
        await tx.employeeBonus.deleteMany({ where: { employeeId: empId, bonus: { taxable: false } } });
        if (normalized.length) await tx.employeeBonus.createMany({ data: normalized.map(row => ({ employeeId: empId, ...row })) });
        if (representationDefinition) {
            const company = await tx.company.findUnique({
                where: { id: cId },
                select: { indemniteRepresentationRate: true },
            });
            await tx.employee.update({
                where: { id: empId },
                data: {
                    indemniteRepresentationName: representationSelected ? 'Indemnité de représentation' : null,
                    indemniteRepresentationRate: representationSelected
                        ? (company?.indemniteRepresentationRate ?? DEFAULT_REPRESENTATION_RATE)
                        : null,
                },
            });
        }
        const updatedEmployee = await tx.employee.findUnique({
            where: { id: empId },
            include: { company: true, bonuses: { include: { bonus: true } } },
        });
        await refreshDraftPayslips(tx, updatedEmployee);
        return tx.employeeBonus.findMany({ where: { employeeId: empId }, include: { bonus: true } });
    });
}

export async function removeEmployeeIndemnite(employeeId, bonusId, companyId) {
    const empId = Number(employeeId);
    const bId = Number(bonusId);
    const cId = companyKey(companyId);
    const employee = await prisma.employee.findFirst({ where: { id: empId, companyId: cId }, select: { id: true } });
    if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
    const definition = await prisma.bonus.findFirst({ where: { id: bId, companyId: cId, taxable: false }, select: { id: true } });
    if (!definition) throw new Error("INDEMNITE_NOT_FOUND");
    await prisma.$transaction(async tx => {
        await tx.employeeBonus.delete({ where: { employeeId_bonusId: { employeeId: empId, bonusId: bId } } });
        const updatedEmployee = await tx.employee.findUnique({
            where: { id: empId },
            include: { company: true, bonuses: { include: { bonus: true } } },
        });
        await refreshDraftPayslips(tx, updatedEmployee);
    });
}

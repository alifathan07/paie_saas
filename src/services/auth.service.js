import bcrypt from "bcryptjs";
import prisma from "../../db.ts";
import { initializeCompanyRubriques } from "./defaultRubrique.service.js";

const PASSWORD_MIN_LENGTH = 8;
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;

export const hashPassword = (password) => bcrypt.hash(password, 10);

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
    return String(username || "").trim().toLowerCase();
}

function usernameFromEmail(email, userId) {
    const localPart = normalizeUsername(String(email || "").split("@")[0])
        .replace(/[^a-z0-9._-]/g, "-")
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
        .slice(0, 64);
    return localPart || `user_${userId}`;
}

async function ensureUsername(user) {
    if (user.username) return user;
    const base = usernameFromEmail(user.email, user.id);
    const conflict = await prisma.users.findFirst({
        where: { username: base, id: { not: user.id } },
        select: { id: true },
    });
    const username = conflict ? `${base.slice(0, Math.max(1, 64 - String(user.id).length - 1))}_${user.id}` : base;
    const updated = await prisma.users.update({
        where: { id: user.id },
        data: { username },
        select: { username: true },
    });
    return { ...user, username: updated.username };
}

export const validateProfileFields = ({ username, email }) => {
    const cleanUsername = normalizeUsername(username);
    const cleanEmail = normalizeEmail(email);
    if (!USERNAME_PATTERN.test(cleanUsername)) throw new Error("INVALID_USERNAME");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 191) throw new Error("INVALID_EMAIL");
    return { username: cleanUsername, email: cleanEmail };
};

export const validateNewPassword = (password, passwordConfirmation) => {
    const cleanPassword = String(password || "");
    if (cleanPassword.length < PASSWORD_MIN_LENGTH) throw new Error("PASSWORD_TOO_SHORT");
    if (cleanPassword !== String(passwordConfirmation || "")) throw new Error("PASSWORD_MISMATCH");
    return cleanPassword;
};

export const updateUserProfile = async (userId, fields) => {
    const data = validateProfileFields(fields);
    try {
        return await prisma.users.update({ where: { id: Number(userId) }, data, select: { id: true, username: true, email: true } });
    } catch (error) {
        if (error?.code === "P2002") {
            if (String(error?.meta?.target || "").includes("username")) throw new Error("USERNAME_ALREADY_EXISTS");
            throw new Error("EMAIL_ALREADY_EXISTS");
        }
        throw error;
    }
};

export const changeUserPassword = async (userId, currentPassword, password, passwordConfirmation) => {
    const user = await prisma.users.findUnique({ where: { id: Number(userId) }, select: { password: true } });
    if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password))) throw new Error("CURRENT_PASSWORD_INVALID");
    const cleanPassword = validateNewPassword(password, passwordConfirmation);
    await prisma.users.update({ where: { id: Number(userId) }, data: { password: await hashPassword(cleanPassword) } });
};

export const setUserPassword = async (userId, password, passwordConfirmation) => {
    const cleanPassword = validateNewPassword(password, passwordConfirmation);
    await prisma.users.update({ where: { id: Number(userId) }, data: { password: await hashPassword(cleanPassword) } });
};

export const createUserAccount = async ({ username, email, password, passwordConfirmation, maxCompanies, twoFactorEnabled = true }) => {
    const { username: cleanUsername, email: cleanEmail } = validateProfileFields({ username, email });
    const cleanPassword = String(password || "");
    const companyLimit = Number(maxCompanies);

    validateNewPassword(cleanPassword, passwordConfirmation);
    if (!Number.isInteger(companyLimit) || companyLimit < 0 || companyLimit > 1000) throw new Error("INVALID_COMPANY_LIMIT");

    const passwordHash = await hashPassword(cleanPassword);
    try {
        return await prisma.users.create({
            data: {
                username: cleanUsername,
                email: cleanEmail,
                password: passwordHash,
                maxCompanies: companyLimit,
                isAdmin: false,
                isBlocked: false,
                twoFactorEnabled: Boolean(twoFactorEnabled),
            },
            select: {
                id: true,
                username: true,
                email: true,
                maxCompanies: true,
                isAdmin: true,
                isBlocked: true,
                createdAt: true,
            },
        });
    } catch (error) {
        if (error?.code === "P2002") {
            if (String(error?.meta?.target || "").includes("username")) throw new Error("USERNAME_ALREADY_EXISTS");
            throw new Error("EMAIL_ALREADY_EXISTS");
        }
        throw error;
    }
};

export const registerCompanyAccount = async ({ companyName, username, email, password, passwordConfirmation }) => {
    const cleanCompanyName = String(companyName || "").trim();
    if (!cleanCompanyName || cleanCompanyName.length > 191) throw new Error("INVALID_COMPANY_NAME");
    const { username: cleanUsername, email: cleanEmail } = validateProfileFields({ username, email });
    const cleanPassword = validateNewPassword(password, passwordConfirmation);
    const passwordHash = await hashPassword(cleanPassword);

    try {
        return await prisma.$transaction(async tx => {
            const user = await tx.users.create({
                data: {
                    username: cleanUsername,
                    email: cleanEmail,
                    password: passwordHash,
                    maxCompanies: 1,
                    isAdmin: false,
                    isBlocked: false,
                    twoFactorEnabled: true,
                },
                select: { id: true, username: true, email: true, isAdmin: true, isBlocked: true },
            });
            const company = await tx.company.create({ data: { name: cleanCompanyName } });
            await tx.userCompany.create({ data: { userId: user.id, companyId: company.id } });
            await initializeCompanyRubriques(company.id, tx);
            return { user, company };
        });
    } catch (error) {
        if (error?.code === "P2002") {
            if (String(error?.meta?.target || "").includes("username")) throw new Error("USERNAME_ALREADY_EXISTS");
            if (String(error?.meta?.target || "").includes("email")) throw new Error("EMAIL_ALREADY_EXISTS");
        }
        throw error;
    }
};

/**
 * Authenticate user credentials and return user details without sensitive data
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<Object>} Safe user object
 */
export const authenticateUser = async (identifier, password) => {
    if (!identifier || !password) {
        throw new Error("MISSING_CREDENTIALS");
    }

    const cleanIdentifier = normalizeUsername(identifier);
    const user = await prisma.users.findFirst({
        where: { OR: [{ username: cleanIdentifier }, { email: normalizeEmail(identifier) }] },
        include: {
            userCompanies: {
                include: {
                    company: true,
                },
            },
        },
    });

    if (!user) {
        throw new Error("INVALID_CREDENTIALS");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error("INVALID_CREDENTIALS");
    }

    // Return safe user object (omit password)
    const { password: _, ...safeUser } = user;
    return ensureUsername(safeUser);
};

/**
 * Get a user by ID
 * @param {number} id 
 * @returns {Promise<Object|null>}
 */
export const getUserById = async (id) => {
    return prisma.users.findUnique({
        where: { id: Number(id) },
        select: {
            id: true,
            email: true,
            username: true,
            twoFactorEnabled: true,
            createdAt: true,
            updatedAt: true,
            userCompanies: {
                include: {
                    company: true,
                },
            },
        },
    });
};

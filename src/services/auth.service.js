import bcrypt from "bcryptjs";
import prisma from "../../db.ts";

const PASSWORD_MIN_LENGTH = 8;

export const hashPassword = (password) => bcrypt.hash(password, 10);

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

export const validateProfileFields = ({ name, email }) => {
    const cleanName = String(name || "").trim();
    const cleanEmail = normalizeEmail(email);
    if (!cleanName || cleanName.length > 191) throw new Error("INVALID_NAME");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 191) throw new Error("INVALID_EMAIL");
    return { name: cleanName, email: cleanEmail };
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
        return await prisma.users.update({ where: { id: Number(userId) }, data, select: { id: true, name: true, email: true } });
    } catch (error) {
        if (error?.code === "P2002") throw new Error("EMAIL_ALREADY_EXISTS");
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

export const createUserAccount = async ({ name, email, password, passwordConfirmation, maxCompanies }) => {
    const { name: cleanName, email: cleanEmail } = validateProfileFields({ name, email });
    const cleanPassword = String(password || "");
    const companyLimit = Number(maxCompanies);

    validateNewPassword(cleanPassword, passwordConfirmation);
    if (!Number.isInteger(companyLimit) || companyLimit < 0 || companyLimit > 1000) throw new Error("INVALID_COMPANY_LIMIT");

    const passwordHash = await hashPassword(cleanPassword);
    try {
        return await prisma.users.create({
            data: {
                name: cleanName,
                email: cleanEmail,
                password: passwordHash,
                maxCompanies: companyLimit,
                isAdmin: false,
                isBlocked: false,
            },
            select: {
                id: true,
                name: true,
                email: true,
                maxCompanies: true,
                isAdmin: true,
                isBlocked: true,
                createdAt: true,
            },
        });
    } catch (error) {
        if (error?.code === "P2002") throw new Error("EMAIL_ALREADY_EXISTS");
        throw error;
    }
};

/**
 * Authenticate user credentials and return user details without sensitive data
 * @param {string} email 
 * @param {string} password 
 * @returns {Promise<Object>} Safe user object
 */
export const authenticateUser = async (email, password) => {
    if (!email || !password) {
        throw new Error("MISSING_CREDENTIALS");
    }

    const cleanEmail = normalizeEmail(email);
    const user = await prisma.users.findUnique({
        where: { email: cleanEmail },
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
    return safeUser;
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
            name: true,
            email: true,
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

import bcrypt from "bcryptjs";
import prisma from "../../db.ts";

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

    const cleanEmail = email.trim().toLowerCase();
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

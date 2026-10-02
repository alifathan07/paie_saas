import prisma from "../../db.ts";

export const getDashboardStats = async (companyId) => {
    try {
        const normalizedCompanyId = Number(companyId);
        if (!Number.isInteger(normalizedCompanyId) || normalizedCompanyId <= 0) throw new Error("NO_ACTIVE_COMPANY");
        const where = { companyId: normalizedCompanyId };
        const activeWhere = { ...where, actif: true };

        const totalEmployees = await prisma.employee.count({ where });
        const activeEmployees = await prisma.employee.count({
            where: activeWhere
        });
        const totalCompanies = 1;

        // Calculate total base salary & average
        const aggregate = await prisma.employee.aggregate({
            _sum: {
                baseSalary: true
            },
            _avg: {
                baseSalary: true
            },
            where: activeWhere
        });

        const totalSalaryMass = aggregate._sum.baseSalary ? Number(aggregate._sum.baseSalary) : 0;
        const avgSalary = aggregate._avg.baseSalary ? Number(aggregate._avg.baseSalary) : 0;

        // Recent 5 employees
        const recentEmployees = await prisma.employee.findMany({
            take: 5,
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                company: true
            }
        });

        return {
            totalEmployees,
            activeEmployees,
            totalCompanies,
            totalSalaryMass,
            avgSalary,
            recentEmployees
        };
    } catch (error) {
        console.error("Dashboard stats error:", error);
        return {
            totalEmployees: 0,
            activeEmployees: 0,
            totalCompanies: 0,
            totalSalaryMass: 0,
            avgSalary: 0,
            recentEmployees: []
        };
    }
};

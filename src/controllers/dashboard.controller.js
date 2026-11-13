import { getDashboardStats } from "../services/dashboard.service.js";
import { resolveCompanyId } from "../lib/company.js";
import prisma from "../../db.ts";

export const renderDashboard = async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const stats = await getDashboardStats(companyId);
        const company = await prisma.company.findUnique({
            where: { id: Number(companyId) },
            select: { name: true, adresse: true, ville: true, ifNumber: true, numeroAffiliationCnss: true, smig: true },
        });
        const companySetupRequired = Boolean(
            req.session.user?.needsCompanySetup
            || !company?.name
            || !company?.adresse
            || !company?.ville
            || !company?.ifNumber
            || !company?.numeroAffiliationCnss
            || !company?.smig
            || Number(company.smig) <= 0
        );
        res.render("dashboard/index", {
            title: "Tableau de bord",
            currentPage: "dashboard",
            user: req.session.user,
            stats,
            companySetupRequired,
        });
    } catch (error) {
        console.error("Error rendering dashboard:", error);
        res.status(500).render("dashboard/index", {
            title: "Tableau de bord",
            currentPage: "dashboard",
            user: req.session.user,
            stats: {
                totalEmployees: 0,
                activeEmployees: 0,
                totalCompanies: 0,
                totalSalaryMass: 0,
                avgSalary: 0,
                recentEmployees: []
            },
            companySetupRequired: true,
        });
    }
};

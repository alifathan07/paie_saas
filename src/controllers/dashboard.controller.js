import { getDashboardStats } from "../services/dashboard.service.js";
import { resolveCompanyId } from "../lib/company.js";

export const renderDashboard = async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const stats = await getDashboardStats(companyId);
        res.render("dashboard/index", {
            title: "Tableau de bord",
            currentPage: "dashboard",
            user: req.session.user,
            stats
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
            }
        });
    }
};

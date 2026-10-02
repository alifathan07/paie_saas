import express from "express";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/db.js";
import { resolveCompanyId } from "../lib/company.js";
import { generateBulletinPdf } from "../pdf/bulletinPdf.js";
import { mapPayslipToViewModel, getBulletinPdfCumulative } from "../controllers/bulletins.controller.js";

export const editions = express.Router();

const MONTH_NAMES_FR = [
    "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

const reports = {
    cnss: "État CNSS",
    amo: "État AMO",
    journal: "Journal de paie",
    livre: "Livre de paie",
    ir: "État IR",
};

editions.get("/", (req, res) => {
    const selectedReport = reports[req.query.report] || null;
    res.render("editions/index", {
        title: "Éditions",
        currentPage: "editions",
        user: req.session.user,
        selectedReport,
    });
});

async function getMatricules(companyId) {
    const employees = await prisma.employee.findMany({
        where: { companyId },
        select: { matricule: true },
        orderBy: { matricule: "asc" },
    });
    return employees.map(employee => employee.matricule);
}

async function renderBulletinExportPage(req, res, options = {}) {
    const companyId = await resolveCompanyId(req);
    const matricules = await getMatricules(companyId);
    const requestedFrom = req.body?.from ?? req.query.from;
    const requestedTo = req.body?.to ?? req.query.to;
    return res.render("editions/bulletins", {
        title: "Édition des bulletins",
        currentPage: "editions",
        user: req.session.user,
        month: Number(req.body?.month || req.query.month) || new Date().getMonth() + 1,
        year: Number(req.body?.year || req.query.year) || new Date().getFullYear(),
        from: requestedFrom ?? matricules[0] ?? "",
        to: requestedTo ?? matricules[matricules.length - 1] ?? "",
        matricules,
        error: options.error || null,
    });
}

editions.get("/bulletins", async (req, res) => {
    try {
        await renderBulletinExportPage(req, res);
    } catch (error) {
        console.error("Bulletin export page error:", error);
        res.status(500).send("Impossible de charger l'édition des bulletins.");
    }
});

/*
 * The PDF form is intentionally separate from the edition landing page so
 * the user can choose a matricule range before downloading.
 */
editions.get("/bulletins/export", async (req, res) => {
    try {
        await renderBulletinExportPage(req, res);
    } catch (error) {
        console.error("Bulletin export page error:", error);
        res.status(500).send("Impossible de charger l'édition des bulletins.");
    }
});

function matriculeNumber(value) {
    const match = String(value || "").match(/\d+/g);
    return match ? Number(match.join("")) : NaN;
}

async function pdfDataFromPayslip(payslip) {
    const emp = payslip.employee;
    const company = emp.company || {};
    const hireDate = new Date(emp.dateEmbauche);
    const seniorityYears = Math.max(0, Math.floor((new Date() - hireDate) / (1000 * 60 * 60 * 24 * 365.25)));

    return {
        ...mapPayslipToViewModel(payslip),
        employeeName: emp.nomComplet,
        employeeMatricule: emp.matricule,
        employeeCNSS: emp.numeroCNSS || "—",
        employeeFonction: emp.fonction || "—",
        employeeAddress: emp.adresse || "—",
        codeService: emp.codeService || "—",
        birthDate: emp.dateNaissance ? new Date(emp.dateNaissance).toLocaleDateString("fr-MA") : "—",
        hireDate: emp.dateEmbauche ? new Date(emp.dateEmbauche).toLocaleDateString("fr-MA") : "—",
        sexe: emp.sexe || "—",
        children: emp.nbEnfantCharge,
        dependents: emp.nbPersonacharge,
        cin: emp.cin || "—",
        seniorityYears,
        companyName: company.name || "CONFONDA",
        companyAddress: company.adresse || "hay sikaktyne",
        companyCNSS: company.numeroCNSS || "5646554654",
        companyIF: company.ifNumber || "565653486",
        companyICE: company.ice || "120521852812821",
        month: payslip.month,
        year: payslip.year,
        monthName: MONTH_NAMES_FR[payslip.month] || "Mois",
        paymentDate: `${payslip.year}-${String(payslip.month).padStart(2, "0")}-25`,
        paymentMethod: emp.modePaiement || "Virement",
        cumulative: await getBulletinPdfCumulative(payslip.employeeId, payslip.year, payslip.month, payslip),
    };
}

editions.post("/bulletins/pdf", async (req, res) => {
    try {
        const companyId = await resolveCompanyId(req);
        const from = matriculeNumber(req.body.from);
        const to = matriculeNumber(req.body.to);
        const month = Number(req.body.month);
        const year = Number(req.body.year);

        if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
            return renderBulletinExportPage(req, res, { error: "Saisissez une plage de matricules valide : le matricule de début doit être inférieur ou égal au matricule de fin." });
        }
        if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2020 || year > 2040) {
            return renderBulletinExportPage(req, res, { error: "Sélectionnez un mois et une année valides." });
        }

        const payslips = await prisma.payslip.findMany({
            where: {
                month,
                year,
                employee: { companyId },
            },
            include: { bonuses: true, employee: { include: { company: true } } },
            orderBy: { employee: { matricule: "asc" } },
        });
        const selected = payslips.filter(payslip => {
            const number = matriculeNumber(payslip.employee.matricule);
            return Number.isFinite(number) && number >= from && number <= to;
        });

        if (selected.length === 0) {
            return renderBulletinExportPage(req, res, { error: "Aucun bulletin trouvé dans cette plage de matricules pour la période sélectionnée." });
        }

        const doc = new PDFDocument({
            size: "A4",
            margin: 40,
            info: {
                Title: `Bulletins de paie ${MONTH_NAMES_FR[month]} ${year}`,
                Author: "Paie Software",
            },
        });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="bulletins-${month}-${year}-${from}-${to}.pdf"`);
        doc.pipe(res);

        for (const [index, payslip] of selected.entries()) {
            if (index > 0) doc.addPage();
            generateBulletinPdf(await pdfDataFromPayslip(payslip), null, { doc });
        }
        doc.end();
    } catch (error) {
        console.error("Bulk bulletin PDF error:", error);
        if (!res.headersSent) res.status(500).send("Impossible de générer les bulletins PDF.");
    }
});

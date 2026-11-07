import express from "express";
import multer from "multer";
import { TextDecoder } from "node:util";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/db.js";
import { resolveCompanyId } from "../lib/company.js";
import { hideOvertimeFromView, isOvertimeEnabled } from "../lib/overtimeFeature.js";
import { isImposableRubriqueVisible, isRubriqueVisible } from "../lib/rubriqueVisibility.js";
import { generateBulletinPdf } from "../pdf/bulletinPdf.js";
import { mapPayslipToViewModel, getBulletinPdfCumulative } from "../controllers/bulletins.controller.js";
import { getRubriqueMaps } from "../services/rubrique.service.js";
import { getMonthlyContributionReports } from "../services/monthlyContributionReports.service.js";
import { getMonthlyPayrollJournal } from "../services/monthlyPayrollJournal.service.js";
import { getMonthlyIrReport } from "../services/monthlyIrReport.service.js";
import { generateAmoReportPdf, generateContributionReportsPdf, generatePayrollJournalPdf } from "../pdf/contributionReportsPdf.js";
import { generateIrReportPdf } from "../pdf/irReportPdf.js";
import { generateMonthlyCnssBdsFile } from "../services/cnssBds.service.js";

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

const bdsTemplateUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const isTextFile = String(file.originalname || "").toLowerCase().endsWith(".txt");
        if (!isTextFile) return callback(new Error("INVALID_BDS_TEMPLATE_FILE"));
        callback(null, true);
    },
}).single("template");

function parseBdsDeclarationDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    const year = Number(value.slice(0, 4));
    if (year < 2020 || year > 2040) return null;
    return { date: value, month: Number(value.slice(5, 7)), year };
}

function renderBdsPage(req, res, options = {}) {
    const savedPeriod = req.session.selectedPeriod || {};
    const defaultDate = `${savedPeriod.year || new Date().getFullYear()}-${String(savedPeriod.month || new Date().getMonth() + 1).padStart(2, "0")}-01`;
    return res.status(options.status || 200).render("editions/bds", {
        title: "Fichier BDS CNSS",
        currentPage: "editions",
        user: req.session.user,
        declarationDate: parseBdsDeclarationDate(req.body?.declarationDate)?.date || defaultDate,
        error: options.error || null,
    });
}

function hasFixedWidthBdsRecords(template) {
    const lines = template.split(/\r\n|\n|\r/);
    const records = lines.filter(line => ["A00", "A01", "A02"].includes(line.slice(0, 3)));
    return records.length > 0 && records.every(line => line.length === 260);
}

function decodeBdsTemplate(buffer) {
    try {
        const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        if (hasFixedWidthBdsRecords(utf8)) return { template: utf8, encoding: "utf8" };
    } catch {
        // Legacy CNSS exports may use a single-byte Windows encoding.
    }
    return { template: buffer.toString("latin1"), encoding: "latin1" };
}

const BDS_ERROR_MESSAGES = {
    INVALID_BDS_TEMPLATE_FILE: "Sélectionnez un fichier .txt préétabli téléchargé depuis Damancom.",
    INVALID_BDS_TEMPLATE: "Le fichier préétabli est vide ou invalide.",
    INVALID_BDS_FOOTER: "Le fichier préétabli doit contenir une ligne A03 valide.",
    INVALID_BDS_HEADERS: "Le fichier préétabli doit contenir une ligne A00 et une ligne A01.",
    INVALID_BDS_RECORD_LENGTH: "Chaque ligne A00, A01 et A02 doit contenir exactement 260 caractères.",
    INVALID_BDS_TEMPLATE_CNSS_NUMBER: "Un numéro CNSS de la ligne A02 n'est pas valide.",
    DUPLICATE_BDS_TEMPLATE_CNSS_NUMBER: "Le fichier préétabli contient un numéro CNSS en double.",
    INVALID_BDS_TEMPLATE_AMOUNT: "Un montant déjà présent dans le fichier préétabli n'est pas numérique.",
    INVALID_BDS_PAYROLL_DATA: "Les données de paie du mois sont invalides.",
    INVALID_BDS_PAYROLL_RECORD: "Une donnée de paie est invalide.",
    INVALID_BDS_CNSS_NUMBER: "Un numéro d'immatriculation CNSS n'est pas valide.",
    DUPLICATE_BDS_PAYROLL_CNSS_NUMBER: "Plusieurs bulletins utilisent le même numéro CNSS.",
    INVALID_BDS_DAYS: "Les jours travaillés doivent être un nombre entier positif.",
    INVALID_BDS_AMOUNT: "Un salaire contient un montant invalide.",
    BDS_AMOUNT_OVERFLOW: "Un salaire dépasse la capacité du format CNSS.",
    BDS_FIELD_OVERFLOW: "Un total dépasse la capacité du format CNSS.",
    BDS_EMPLOYEE_COUNT_OVERFLOW: "L'effectif dépasse la capacité du format CNSS.",
    INVALID_BDS_SITUATION_CODE: "Un code de situation doit être N, E, S ou M.",
    INVALID_BDS_SITUATION_DATE: "La date de situation doit être une date valide au format AAAAMMJJ.",
    BDS_PAYROLL_EMPLOYEE_NOT_IN_TEMPLATE: "Un salarié du mois est absent du fichier préétabli. Téléchargez le fichier Damancom actualisé.",
    COMPANY_NOT_FOUND: "La société active est introuvable.",
    COMPANY_CNSS_NUMBER_MISSING: "Le numéro d'affiliation CNSS de la société n'est pas renseigné.",
    BDS_COMPANY_AFFILIATION_MISMATCH: "Le numéro d'affiliation du fichier préétabli ne correspond pas à la société active.",
    NO_MONTHLY_PAYROLL: "Aucun bulletin généré, validé ou clôturé pour ce mois.",
};

function bdsErrorMessage(error) {
    const message = String(error?.message || "");
    if (error?.code === "LIMIT_FILE_SIZE") return "Le fichier .txt ne doit pas dépasser 5 Mo.";
    return BDS_ERROR_MESSAGES[message] || (message.startsWith("EMPLOYEE_CNSS_MISSING:")
        ? `Le numéro CNSS est absent ou invalide pour le matricule ${message.split(":").slice(1).join(":")}.`
        : "Impossible de générer le fichier BDS.");
}

editions.get("/bds", (req, res) => renderBdsPage(req, res));

editions.post("/bds", (req, res, next) => {
    bdsTemplateUpload(req, res, error => {
        req.bdsUploadError = error || null;
        next();
    });
}, async (req, res) => {
    if (req.bdsUploadError) {
        return renderBdsPage(req, res, { status: 400, error: bdsErrorMessage(req.bdsUploadError) });
    }
    const period = parseBdsDeclarationDate(req.body?.declarationDate);
    if (!period) {
        return renderBdsPage(req, res, { status: 400, error: "Sélectionnez une date de déclaration valide." });
    }
    if (!req.file) {
        return renderBdsPage(req, res, { status: 400, error: "Sélectionnez le fichier .txt préétabli de Damancom." });
    }

    const { template, encoding } = decodeBdsTemplate(req.file.buffer);
    try {
        const output = await generateMonthlyCnssBdsFile(
            await resolveCompanyId(req),
            period.month,
            period.year,
            template,
        );
        res.setHeader("Content-Type", `text/plain; charset=${encoding === "utf8" ? "utf-8" : "windows-1252"}`);
        res.setHeader("Content-Disposition", `attachment; filename="BDS_CNSS_${period.year}${String(period.month).padStart(2, "0")}.txt"`);
        return res.send(encoding === "utf8" ? output : Buffer.from(output, "latin1"));
    } catch (error) {
        const message = String(error?.message || "");
        if (!BDS_ERROR_MESSAGES[message] && !message.startsWith("EMPLOYEE_CNSS_MISSING:")) {
            console.error("CNSS BDS export error:", error);
        }
        return renderBdsPage(req, res, {
            status: message === "NO_MONTHLY_PAYROLL" ? 404 : 400,
            error: bdsErrorMessage(error),
        });
    }
});

editions.get("/", (req, res) => {
    const requestedMonth = Number(req.query.month);
    const requestedYear = Number(req.query.year);
    const hasPeriod = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
        && Number.isInteger(requestedYear) && requestedYear >= 2020 && requestedYear <= 2040;
    if (req.query.report === "ir") {
        const query = hasPeriod ? `?month=${requestedMonth}&year=${requestedYear}` : "";
        return res.redirect(`/editions/ir${query}`);
    }
    const selectedReport = reports[req.query.report] || null;
    res.render("editions/index", {
        title: "Éditions",
        currentPage: "editions",
        user: req.session.user,
        selectedReport,
        month: hasPeriod ? requestedMonth : undefined,
        year: hasPeriod ? requestedYear : undefined,
    });
});

const irError = error => ({
    NO_MONTHLY_PAYROLL: "Aucun bulletin généré, validé ou clôturé pour cette période.",
}[error.message] || "Impossible de générer l'état IR.");

async function renderIrReportPage(req, res) {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();
    const fmt = value => Number(value || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    try {
        const report = await getMonthlyIrReport(await resolveCompanyId(req), month, year);
        return res.render("editions/ir", { title: "État IR", currentPage: "editions", user: req.session.user, report, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: null });
    } catch (error) {
        const company = await prisma.company.findUnique({ where: { id: await resolveCompanyId(req) } });
        return res.render("editions/ir", { title: "État IR", currentPage: "editions", user: req.session.user, report: { company: company || { name: "Entreprise" }, rows: [], totals: {} }, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: irError(error) });
    }
}

editions.get("/ir", renderIrReportPage);

editions.get("/ir/pdf", async (req, res) => {
    try {
        const report = await getMonthlyIrReport(await resolveCompanyId(req), Number(req.query.month), Number(req.query.year));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="ETAT_IR_${report.month}-${report.year}.pdf"`);
        return generateIrReportPdf(report, res);
    } catch (error) {
        res.status(error.message === "NO_MONTHLY_PAYROLL" ? 404 : 400).send(irError(error));
    }
});

const contributionError = error => ({
    COMPANY_CNSS_NUMBER_MISSING: "Le numéro d'affiliation CNSS de l'entreprise n'est pas renseigné.",
    NO_MONTHLY_PAYROLL: "Aucun bulletin généré, validé ou clôturé pour cette période.",
}[error.message] || "Impossible de générer les états CNSS/AMO.");

const journalError = error => ({
    NO_MONTHLY_PAYROLL: "Aucun bulletin généré, validé ou clôturé pour cette période.",
}[error.message] || "Impossible de générer le journal de paie.");

async function renderPayrollJournalPage(req, res) {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();
    const fmt = value => Number(value || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    try {
        const journal = await getMonthlyPayrollJournal(await resolveCompanyId(req), month, year);
        return res.render("editions/journal", { title: "Journal de paie", currentPage: "editions", user: req.session.user, journal, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: null });
    } catch (error) {
        const company = await prisma.company.findUnique({ where: { id: await resolveCompanyId(req) } });
        return res.render("editions/journal", { title: "Journal de paie", currentPage: "editions", user: req.session.user, journal: { company: company || { name: "Entreprise" }, rows: [], totals: {} }, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: journalError(error) });
    }
}

editions.get("/journal", renderPayrollJournalPage);

editions.get("/journal/pdf", async (req, res) => {
    try {
        const journal = await getMonthlyPayrollJournal(await resolveCompanyId(req), Number(req.query.month), Number(req.query.year));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="JOURNAL_DE_PAIE_${journal.month}-${journal.year}.pdf"`);
        return generatePayrollJournalPdf(journal, res);
    } catch (error) {
        res.status(error.message === "NO_MONTHLY_PAYROLL" ? 404 : 400).send(journalError(error));
    }
});

async function renderContributionPage(req, res, reportType = "all") {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();
    const fmt = value => Number(value || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    try {
        const companyId = await resolveCompanyId(req);
        const report = await getMonthlyContributionReports(companyId, month, year);
        return res.render("editions/contributions", { title: reportType === "cnss" ? "État CNSS" : reportType === "amo" ? "État AMO" : "États CNSS / AMO", currentPage: "editions", user: req.session.user, report, reportType, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: null });
    } catch (error) {
        const company = await prisma.company.findUnique({ where: { id: await resolveCompanyId(req) } });
        return res.render("editions/contributions", { title: reportType === "cnss" ? "État CNSS" : reportType === "amo" ? "État AMO" : "États CNSS / AMO", currentPage: "editions", user: req.session.user, report: { company: company || { name: "Entreprise", numeroAffiliationCnss: "—" }, rows: [], cnssTotals: {}, amoTotals: {}, transfer: {} }, reportType, month, year, monthName: MONTH_NAMES_FR[month], monthNames: MONTH_NAMES_FR, fmt, error: contributionError(error) });
    }
}

editions.get("/contributions", (req, res) => renderContributionPage(req, res));
editions.get("/cnss", (req, res) => renderContributionPage(req, res, "cnss"));
editions.get("/amo", (req, res) => renderContributionPage(req, res, "amo"));

editions.get("/contributions/pdf", async (req, res) => {
    try {
        const report = await getMonthlyContributionReports(await resolveCompanyId(req), Number(req.query.month), Number(req.query.year));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=\"ETAT_CNSS_" + report.month + "-" + report.year + ".pdf\"");
        return generateContributionReportsPdf(report, res);
    } catch (error) {
        res.status(error.message === "NO_MONTHLY_PAYROLL" ? 404 : 400).send(contributionError(error));
    }
});

editions.get("/contributions/amo/pdf", async (req, res) => {
    try {
        const report = await getMonthlyContributionReports(await resolveCompanyId(req), Number(req.query.month), Number(req.query.year));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=\"ETAT_AMO_" + report.month + "-" + report.year + ".pdf\"");
        return generateAmoReportPdf(report, res);
    } catch (error) {
        res.status(error.message === "NO_MONTHLY_PAYROLL" ? 404 : 400).send(contributionError(error));
    }
});

editions.get("/cnss/pdf", (req, res) => res.redirect(`/editions/contributions/pdf?month=${encodeURIComponent(req.query.month || "")}&year=${encodeURIComponent(req.query.year || "")}`));
editions.get("/amo/pdf", (req, res) => res.redirect(`/editions/contributions/amo/pdf?month=${encodeURIComponent(req.query.month || "")}&year=${encodeURIComponent(req.query.year || "")}`));

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

async function pdfDataFromPayslip(payslip, rubriqueMaps = {}) {
    const emp = payslip.employee;
    const company = emp.company || {};
    const overtimeEnabled = isOvertimeEnabled(company);
    const bulletin = hideOvertimeFromView(mapPayslipToViewModel(payslip), overtimeEnabled);
    const rubriqueVisibility = rubriqueMaps.rubriqueVisibility || {};
    const hireDate = new Date(emp.dateEmbauche);
    const seniorityYears = Math.max(0, Math.floor((new Date() - hireDate) / (1000 * 60 * 60 * 24 * 365.25)));

    return {
        ...bulletin,
        variablePrimes: bulletin.variablePrimes.filter(line => isImposableRubriqueVisible(rubriqueVisibility, line)),
        retenus: bulletin.retenus.filter(line => line.rubriqueRetenuId === null || line.rubriqueRetenuId === undefined
            || isRubriqueVisible(rubriqueVisibility, "retenu", `id:${line.rubriqueRetenuId}`)),
        employeeName: emp.nomComplet,
        employeeMatricule: emp.matricule,
        employeeCNSS: emp.numeroCNSS || "—",
        employeeFonction: emp.employeeFunction ? emp.employeeFunction.name : "—",
        employeeAddress: emp.adresse || "—",
        birthDate: emp.dateNaissance ? new Date(emp.dateNaissance).toLocaleDateString("fr-MA") : "—",
        hireDate: emp.dateEmbauche ? new Date(emp.dateEmbauche).toLocaleDateString("fr-MA") : "—",
        sexe: emp.sexe || "—",
        children: emp.nbEnfantCharge,
        dependents: emp.nbPersonacharge,
        cin: emp.cin || "—",
        seniorityYears,
        companyName: company.name || "CONFONDA",
        companyLogo: company.logoData || null,
        companyAddress: company.adresse || "hay sikaktyne",
        companyCNSS: company.numeroCNSS || "5646554654",
        companyIF: company.ifNumber || "565653486",
        companyICE: company.ice || "120521852812821",
        month: payslip.month,
        year: payslip.year,
        monthName: MONTH_NAMES_FR[payslip.month] || "Mois",
        paymentDate: `${payslip.year}-${String(payslip.month).padStart(2, "0")}-25`,
        paymentMethod: emp.modePaiement || "Virement",
        overtimeEnabled,
        rubriqueCodes: rubriqueMaps.codes || {},
        rubriqueVisibility,
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
            include: { bonuses: true, employee: { include: { company: true, employeeFunction: true } } },
            orderBy: { employee: { matricule: "asc" } },
        });
        const selected = payslips.filter(payslip => {
            const number = matriculeNumber(payslip.employee.matricule);
            return Number.isFinite(number) && number >= from && number <= to;
        });

        if (selected.length === 0) {
            return renderBulletinExportPage(req, res, { error: "Aucun bulletin trouvé dans cette plage de matricules pour la période sélectionnée." });
        }
        const rubriqueMaps = await getRubriqueMaps(companyId);

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
            generateBulletinPdf(await pdfDataFromPayslip(payslip, rubriqueMaps), null, { doc });
        }
        doc.end();
    } catch (error) {
        console.error("Bulk bulletin PDF error:", error);
        if (!res.headersSent) res.status(500).send("Impossible de générer les bulletins PDF.");
    }
});

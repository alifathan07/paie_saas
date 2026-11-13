import express from "express";
import multer from "multer";
import { TextDecoder } from "node:util";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/db.js";
import { resolveCompanyId } from "../lib/company.js";
import { getActiveBulletinPeriod, isAfterActivePeriod } from "../lib/bulletinPeriod.js";
import { hideOvertimeFromView, isOvertimeEnabled } from "../lib/overtimeFeature.js";
import { isImposableRubriqueVisible, isRubriqueVisible } from "../lib/rubriqueVisibility.js";
import { generateBulletinPdf } from "../pdf/bulletinPdf.js";
import { mapPayslipToViewModel, getBulletinPdfCumulative } from "../controllers/bulletins.controller.js";
import { getRubriqueMaps } from "../services/rubrique.service.js";
import { getMonthlyContributionReports } from "../services/monthlyContributionReports.service.js";
import { getMonthlyPayrollJournal } from "../services/monthlyPayrollJournal.service.js";
import { getMonthlyPayrollBook } from "../services/monthlyPayrollBook.service.js";
import { extractPayrollBook, matchPayrollBookEmployees } from "../services/payrollBookImport.service.js";
import { getMonthlyIrReport } from "../services/monthlyIrReport.service.js";
import { generateAmoReportPdf, generateContributionReportsPdf, generatePayrollJournalPdf } from "../pdf/contributionReportsPdf.js";
import { generatePayrollBookPdf } from "../pdf/payrollBookPdf.js";
import { generateIrReportPdf } from "../pdf/irReportPdf.js";
import { generateBulletinsFromPayrollBook } from "../controllers/bulletins.controller.js";
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

const payrollBookUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const name = String(file.originalname || "").toLowerCase();
        const accepted = file.mimetype === "application/pdf" || file.mimetype === "image/jpeg" || file.mimetype === "image/png" || /\.(pdf|jpe?g|png)$/.test(name);
        if (!accepted) return callback(new Error("PAYROLL_BOOK_INVALID_FILE"));
        callback(null, true);
    },
}).single("payrollBook");

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
    const records = lines.filter(line => ["A00", "A01", "A02", "B00", "B01", "B02"].includes(line.slice(0, 3)));
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
    INVALID_BDS_FOOTER: "Le fichier préétabli doit contenir une structure CNSS valide.",
    INVALID_BDS_HEADERS: "Le fichier préétabli doit contenir les en-têtes B00/A00 et B01/A01.",
    INVALID_BDS_RECORD_LENGTH: "Chaque ligne B00 à B06 doit contenir exactement 260 caractères.",
    INVALID_BDS_TEMPLATE_CNSS_NUMBER: "Un numéro CNSS d'une ligne B02/A02 n'est pas valide.",
    DUPLICATE_BDS_TEMPLATE_CNSS_NUMBER: "Le fichier préétabli contient un numéro CNSS en double.",
    INVALID_BDS_TEMPLATE_AMOUNT: "Un montant déjà présent dans le fichier préétabli n'est pas numérique.",
    INVALID_BDS_PAYROLL_DATA: "Les données de paie du mois sont invalides.",
    INVALID_BDS_PAYROLL_RECORD: "Une donnée de paie est invalide.",
    INVALID_BDS_CNSS_NUMBER: "Un numéro d'immatriculation CNSS n'est pas valide.",
    INVALID_BDS_AFFILIATION: "Le numéro d'affiliation CNSS doit contenir 7 chiffres.",
    INVALID_BDS_PERIOD: "La période BDS doit être au format AAAAMM.",
    INVALID_BDS_NUMERIC_FIELD: "Un champ numérique BDS est invalide.",
    BDS_CAPPED_SALARY_EXCEEDS_REAL: "Le salaire plafonné ne peut pas dépasser le salaire réel.",
    INVALID_BDS_SITUATION_VALUES: "Pour CS/MS, les jours et salaires doivent être nuls.",
    BDS_TEMPLATE_PERIOD_MISMATCH: "La période du fichier préétabli ne correspond pas à la période sélectionnée.",
    BDS_PREESTABLISHED_EMPLOYEE_MISSING: "Un salarié du préétabli est absent des bulletins de la période.",
    DUPLICATE_BDS_PAYROLL_CNSS_NUMBER: "Plusieurs bulletins utilisent le même numéro CNSS.",
    INVALID_BDS_DAYS: "Les jours travaillés doivent être un nombre entier positif.",
    INVALID_BDS_AMOUNT: "Un salaire contient un montant invalide.",
    BDS_AMOUNT_OVERFLOW: "Un salaire dépasse la capacité du format CNSS.",
    BDS_FIELD_OVERFLOW: "Un total dépasse la capacité du format CNSS.",
    BDS_EMPLOYEE_COUNT_OVERFLOW: "L'effectif dépasse la capacité du format CNSS.",
    INVALID_BDS_SITUATION_CODE: "Le code situation doit être vide, SO, DE, IT, IL, AT, CS, MS ou MP.",
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
        const companyId = await resolveCompanyId(req);
        const output = await generateMonthlyCnssBdsFile(
            companyId,
            period.month,
            period.year,
            template,
        );
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { numeroAffiliationCnss: true } });
        res.setHeader("Content-Type", `text/plain; charset=${encoding === "utf8" ? "utf-8" : "windows-1252"}`);
        res.setHeader("Content-Disposition", `attachment; filename="DS_${company.numeroAffiliationCnss}_${period.year}${String(period.month).padStart(2, "0")}.txt"`);
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

const payrollBookError = error => ({
    NO_MONTHLY_PAYROLL: "Aucun bulletin généré, validé ou clôturé pour cette période.",
}[error.message] || "Impossible de générer le livre de paie.");

const payrollBookImportError = error => ({
    PAYROLL_BOOK_EMPTY_FILE: "Sélectionnez un fichier Livre de paie.",
    PAYROLL_BOOK_INVALID_FILE: "Le fichier doit être un PDF, JPG, JPEG ou PNG.",
    PAYROLL_BOOK_PDF_READ_FAILED: "Le PDF ne peut pas être lu. Vérifiez qu’il n’est pas corrompu.",
    PAYROLL_BOOK_NO_READABLE_CONTENT: "Aucune donnée lisible n’a été trouvée dans ce fichier.",
    PAYROLL_BOOK_PERIOD_NOT_FOUND: "La période du Livre de paie n’a pas été trouvée. Elle doit être visible dans le document.",
    PAYROLL_BOOK_NO_EMPLOYEES: "Aucun salarié n’a été trouvé dans le Livre de paie.",
    PAYROLL_BOOK_INVALID_RESPONSE: "Le document n’a pas pu être interprété correctement. Réessayez avec une image plus nette.",
    DEEPSEEK_NOT_CONFIGURED: "Le service DeepSeek n’est pas configuré.",
    DEEPSEEK_EMPTY_RESPONSE: "DeepSeek n’a pas retourné de résultat exploitable.",
    DEEPSEEK_INVALID_JSON: "DeepSeek a retourné un résultat invalide. Réessayez.",
    PAYROLL_BOOK_AI_EXTRACTION_FAILED: "DeepSeek n’a pas pu extraire les données du document. Consultez les détails techniques du serveur ou importez une image plus nette.",
    DEEPSEEK_JSON_REPAIR_HTTP_401: "La clé DeepSeek est refusée pendant la réparation de la réponse.",
    DEEPSEEK_JSON_REPAIR_HTTP_429: "DeepSeek est temporairement limité pendant la réparation. Réessayez plus tard.",
    DEEPSEEK_JSON_REPAIR_EMPTY: "DeepSeek n’a pas retourné de réponse pendant la réparation.",
    DEEPSEEK_HTTP_401: "La clé DeepSeek est refusée. Vérifiez la configuration du serveur.",
    DEEPSEEK_HTTP_429: "DeepSeek est temporairement limité. Réessayez dans quelques instants.",
    PAYROLL_BOOK_NIMP_TOTAL_INVALID: "Le total des primes non imposables doit être un montant compris entre 0,00 et 999 999,99.",
    PAYROLL_BOOK_NIMP_TOTAL_COUNT_INVALID: "Les montants saisis ne correspondent pas aux lignes du Livre importé. Réessayez.",
    PAYROLL_BOOK_PERIOD_AFTER_ACTIVE: "La période du Livre de paie est postérieure à la période active. Clôturez d’abord la période active.",
}[error.message] || "Impossible d’analyser le Livre de paie. Vérifiez le document et réessayez.");

function parseImportedNimpTotal(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return null;
    const normalized = raw.replace(/[\s\u00a0]/g, "").replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("PAYROLL_BOOK_NIMP_TOTAL_INVALID");
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount > 999999.99) throw new Error("PAYROLL_BOOK_NIMP_TOTAL_INVALID");
    return Number(amount.toFixed(2));
}

async function assertPayrollBookPeriodAllowed(companyId, period) {
    const payslips = await prisma.payslip.findMany({
        where: { employee: { companyId: Number(companyId) } },
        select: { month: true, year: true, status: true },
    });
    const activePeriod = getActiveBulletinPeriod(payslips);
    if (isAfterActivePeriod(period, activePeriod)) throw new Error("PAYROLL_BOOK_PERIOD_AFTER_ACTIVE");
}

function renderPayrollBookImport(req, res, options = {}) {
    return res.status(options.status || 200).render("editions/payroll-book-import", {
        title: "Importer un Livre de paie",
        currentPage: "editions",
        user: req.session.user,
        error: options.error || null,
        success: options.success || null,
        preview: options.preview || null,
    });
}

editions.get("/livre/import", (req, res) => renderPayrollBookImport(req, res));

editions.post("/livre/import", (req, res, next) => {
    payrollBookUpload(req, res, error => { req.payrollBookUploadError = error || null; next(); });
}, async (req, res) => {
    try {
        if (req.payrollBookUploadError) throw req.payrollBookUploadError;
        if (!req.file) throw new Error("PAYROLL_BOOK_EMPTY_FILE");
        const companyId = await resolveCompanyId(req);
        const extracted = await extractPayrollBook({ buffer: req.file.buffer, mimeType: req.file.mimetype, originalName: req.file.originalname });
        const rows = await matchPayrollBookEmployees(companyId, extracted.rows);
        const unmatched = rows.filter(row => !row.employeeId);
        const missingInputs = rows.filter(row => !row.baseSalary);
        const preview = { ...extracted, companyId, rows, unmatchedCount: unmatched.length, missingInputCount: missingInputs.length };
        if (unmatched.length || missingInputs.length) {
            return renderPayrollBookImport(req, res, { status: 422, preview, error: `${unmatched.length} salarié(s) non identifié(s), ${missingInputs.length} salaire(s) de base manquant(s). Aucun bulletin n’a été généré.` });
        }

        try {
            await assertPayrollBookPeriodAllowed(companyId, extracted.period);
        } catch (error) {
            if (error.message !== "PAYROLL_BOOK_PERIOD_AFTER_ACTIVE") throw error;
            return renderPayrollBookImport(req, res, {
                status: 400,
                preview,
                error: payrollBookImportError(error),
            });
        }

        const generationRows = rows.map(row => ({
            ...row,
            totalPrimeNonImposable: parseImportedNimpTotal(row.totalPrimeNonImposable),
        }));
        const result = await generateBulletinsFromPayrollBook({
            companyId,
            month: extracted.period.month,
            year: extracted.period.year,
            rows: generationRows,
        });
        req.session.payrollBookImportResult = {
            companyId: Number(companyId),
            month: extracted.period.month,
            year: extracted.period.year,
            ...result,
        };
        return res.redirect(`/editions/livre?month=${extracted.period.month}&year=${extracted.period.year}&imported=1`);
    } catch (error) {
        console.error("Payroll book import error:", error);
        return renderPayrollBookImport(req, res, { status: 400, error: payrollBookImportError(error) });
    }
});

editions.post("/livre/import/generate", async (req, res) => {
    const imported = req.session.payrollBookImport;
    let preview = imported || null;
    try {
        const companyId = await resolveCompanyId(req);
        if (!imported || Number(imported.companyId) !== Number(companyId)) throw new Error("PAYROLL_BOOK_IMPORT_EXPIRED");
        await assertPayrollBookPeriodAllowed(companyId, imported.period);
        const submittedTotals = req.body?.totalPrimeNonImposable;
        const hasSubmittedTotals = submittedTotals !== undefined;
        const values = Array.isArray(submittedTotals) ? submittedTotals : hasSubmittedTotals ? [submittedTotals] : [];
        if (hasSubmittedTotals && values.length !== imported.rows.length) throw new Error("PAYROLL_BOOK_NIMP_TOTAL_COUNT_INVALID");
        preview = {
            ...imported,
            rows: imported.rows.map((row, index) => ({
                ...row,
                totalPrimeNonImposable: hasSubmittedTotals ? values[index] : row.totalPrimeNonImposable,
            })),
        };
        const rows = preview.rows.map(row => ({ ...row, totalPrimeNonImposable: parseImportedNimpTotal(row.totalPrimeNonImposable) }));
        preview = { ...preview, rows };
        const result = await generateBulletinsFromPayrollBook({ companyId, month: imported.period.month, year: imported.period.year, rows });
        delete req.session.payrollBookImport;
        const summary = `created=${result.created}&updated=${result.updated}&skipped=${result.skipped}`;
        return res.redirect(`/editions/livre?month=${imported.period.month}&year=${imported.period.year}&imported=1&${summary}`);
    } catch (error) {
        console.error("Payroll book bulletin generation error:", error);
        const message = error.message === "PAYROLL_BOOK_IMPORT_EXPIRED"
            ? "L’import a expiré. Analysez de nouveau le document."
            : error.message === "PAYROLL_BOOK_PERIOD_AFTER_ACTIVE"
                ? payrollBookImportError(error)
            : error.message.startsWith("PAYROLL_BOOK_NIMP_TOTAL_")
                ? payrollBookImportError(error)
                : "Les bulletins n’ont pas pu être générés. Aucun montant technique n’a été affiché.";
        return renderPayrollBookImport(req, res, { status: 400, preview, error: message });
    }
});

async function renderPayrollBookPage(req, res) {
    const month = Number(req.query.month) || new Date().getMonth() + 1;
    const year = Number(req.query.year) || new Date().getFullYear();
    const fmt = value => Number(value || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const date = value => value ? new Date(value).toLocaleDateString("fr-MA") : "—";
    const companyId = await resolveCompanyId(req);
    let importResult = req.session.payrollBookImportResult || null;
    if (importResult) {
        if (Number(importResult.companyId) !== Number(companyId)
            || Number(importResult.month) !== month
            || Number(importResult.year) !== year) {
            importResult = null;
        }
        delete req.session.payrollBookImportResult;
    }
    const querySuccess = importResult
        ? `Import terminé : ${Number(importResult.created || 0)} créé(s), ${Number(importResult.updated || 0)} mis à jour, ${Number(importResult.skipped || 0)} ignoré(s), ${Number(importResult.errors?.length || 0)} erreur(s).`
        : req.query.imported === "1"
            ? `Import terminé : ${Number(req.query.created || 0)} créé(s), ${Number(req.query.updated || 0)} mis à jour, ${Number(req.query.skipped || 0)} ignoré(s).`
            : null;
    const importErrors = importResult?.errors || [];
    try {
        const book = await getMonthlyPayrollBook(companyId, month, year);
        return res.render("editions/payroll-book", { title: "Livre de paie", currentPage: "editions", user: req.session.user, book, month, year, monthName: MONTH_NAMES_FR[month], fmt, date, error: null, querySuccess, importErrors });
    } catch (error) {
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        return res.render("editions/payroll-book", { title: "Livre de paie", currentPage: "editions", user: req.session.user, book: { company: company || { name: "Entreprise" }, rows: [], totals: {} }, month, year, monthName: MONTH_NAMES_FR[month], fmt, date, error: payrollBookError(error), querySuccess, importErrors });
    }
}

editions.get("/livre", renderPayrollBookPage);

editions.get("/livre/pdf", async (req, res) => {
    try {
        const book = await getMonthlyPayrollBook(await resolveCompanyId(req), Number(req.query.month), Number(req.query.year));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="LIVRE_DE_PAIE_${book.month}-${book.year}.pdf"`);
        return generatePayrollBookPdf(book, res);
    } catch (error) {
        return res.status(error.message === "NO_MONTHLY_PAYROLL" ? 404 : 400).send(payrollBookError(error));
    }
});

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

import { getSessionCompanyId } from "../lib/company.js";
import { importEmployeesFromSpreadsheet } from "../services/employeeImport.service.js";

export const importPage = (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return res.render("employees/import", {
        title: "Importer les employés",
        currentPage: "employees",
        user: req.session.user,
        error: null,
        details: []
    });
};

function prismaTarget(error) {
    const target = error?.meta?.target;
    return Array.isArray(target) ? target.join(" ").toLowerCase() : String(target || "").toLowerCase();
}

function friendlyImportError(error) {
    const target = prismaTarget(error);

    if (error?.code === "P2002" && (target.includes("cin") || target.includes("employee_cin"))) {
        return "Import failed: one or more CIN numbers are already registered. Check the CIN column in your file and remove or correct the duplicates.";
    }
    if (error?.code === "P2002" && (target.includes("matricule") || target.includes("employee_matricule"))) {
        return "Import failed: one or more employee numbers are already registered. Check the Matricule column in your file and remove or correct the duplicates.";
    }
    if (error?.code === "P2002") {
        return "Import failed: some information in the file already exists. Check the employee identifiers and try again.";
    }
    if (error?.code === "P2003") {
        return "Import failed: one of the referenced categories or functions is not available for this company.";
    }
    if (error?.code === "P2025") {
        return "Import failed: a required record could not be found. Refresh the page and try again.";
    }

    const messages = {
        NO_ACTIVE_COMPANY: "Import failed: no active company was selected. Select a company and try again.",
        EMPTY_FILE: "Import failed: the uploaded file is empty.",
        NO_WORKSHEET: "Import failed: the workbook does not contain a worksheet.",
        NO_EMPLOYEE_ROWS: "Import failed: no employee rows were found in the file.",
        IMPORT_VALIDATION_FAILED: "Import failed: some rows contain missing or invalid employee information. Review the details below.",
        IMPORT_DUPLICATES: "Import failed: the file contains duplicate employee identifiers. Review the details below.",
        DEEPSEEK_HTTP_401: "Import failed: the document analysis service rejected its credentials. Contact an administrator.",
        DEEPSEEK_HTTP_429: "Import failed: the document analysis service is temporarily busy. Please try again later.",
        DEEPSEEK_EMPTY_RESPONSE: "Import failed: the document could not be analyzed. Check the file and try again.",
        DEEPSEEK_INVALID_JSON: "Import failed: the document analysis returned an invalid result. Please try again.",
    };
    return messages[error?.message] || "Import failed: the file could not be imported. Check the file format and employee information, then try again.";
}

export const importEmployees = async (req, res) => {
    const requestId = req.importRequestId || "missing-request-id";
    const log = (level, event, details = {}) => console[level](`[employee-import] ${event}`, {
        timestamp: new Date().toISOString(),
        requestId,
        ...details
    });
    log("info", "controller.started", {
        filePresent: Boolean(req.file),
        filesCount: Array.isArray(req.files) ? req.files.length : 0,
        bodyKeys: Object.keys(req.body || {}),
        userId: req.session?.user?.id || null,
        companyId: req.session?.user?.activeCompanyId || null
    });
    try {
        if (req.importUploadError) throw req.importUploadError;
        const uploadedFile = req.file || req.files?.[0];
        let buffer = uploadedFile?.buffer;
        let originalName = uploadedFile?.originalname;
        if (!buffer && req.body?.fileBase64) {
            originalName = String(req.body.fileName || "employees.xlsx");
            buffer = Buffer.from(String(req.body.fileBase64), "base64");
            log("info", "json-file.received", {
                originalName,
                encodedLength: String(req.body.fileBase64).length,
                decodedSize: buffer.length
            });
        }
        if (!buffer?.length) {
            log("error", "file.missing", {
                contentType: req.get("content-type") || null,
                contentLength: req.get("content-length") || null,
                filesValueType: typeof req.files
            });
            throw new Error("NO_FILE");
        }
        log("info", "file.ready", {
            fieldName: uploadedFile?.fieldname || "json-file",
            originalName,
            mimeType: uploadedFile?.mimetype || req.body?.fileType || "application/octet-stream",
            size: uploadedFile?.size || buffer.length,
            bufferSize: buffer.length
        });
        log("info", "service.started");
        const result = await importEmployeesFromSpreadsheet({
            buffer,
            companyId: await getSessionCompanyId(req)
        });
        log("info", "service.completed", { importedCount: result.count, sheetName: result.sheetName });
        return res.render("employees/import-result", {
            title: "Import terminé",
            currentPage: "employees",
            user: req.session.user,
            result
        });
    } catch (error) {
        log("error", "controller.failed", {
            error: error.message,
            code: error.code || null,
            detailsCount: error.details?.length || 0,
            stack: error.stack
        });
        const messages = error.details || [];
        const errorMessages = error.message === "NO_FILE" ? ["No file reached the server. Select an Excel file and try again."]
            : error.message === "INVALID_EXCEL_FILE" ? ["Le fichier reçu n’est pas un Excel .xlsx ou .xls."]
            : error.message === "LIMIT_FILE_SIZE" ? ["Le fichier dépasse la limite de 5 Mo."]
            : error.message === "DEEPSEEK_NOT_CONFIGURED" ? ["Ajoutez votre clé DeepSeek dans DEEPSEEK_API_KEY et le modèle dans DEEPSEEK_MODEL dans .env."]
            : error.message === "TOO_MANY_ROWS" ? ["Le fichier ne peut pas dépasser 500 lignes."]
            : [friendlyImportError(error), ...messages];
        return res.status(400).render("employees/import", {
            title: "Importer les employés",
            currentPage: "employees",
            user: req.session.user,
            error: errorMessages[0],
            details: errorMessages.slice(1)
        });
    }
};

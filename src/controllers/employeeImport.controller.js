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
        const errorMessages = error.message === "NO_FILE" ? ["Aucun fichier n’a atteint le serveur. Consultez les logs [employee-import] pour voir le Content-Type et le nombre de fichiers reçus."]
            : error.message === "INVALID_EXCEL_FILE" ? ["Le fichier reçu n’est pas un Excel .xlsx ou .xls."]
            : error.message === "LIMIT_FILE_SIZE" ? ["Le fichier dépasse la limite de 5 Mo."]
            : error.message === "DEEPSEEK_NOT_CONFIGURED" ? ["Ajoutez votre clé DeepSeek dans DEEPSEEK_API_KEY et le modèle dans DEEPSEEK_MODEL dans .env."]
            : error.message === "TOO_MANY_ROWS" ? ["Le fichier ne peut pas dépasser 500 lignes."]
            : [`Import impossible (${error.message}).`, ...messages];
        return res.status(400).render("employees/import", {
            title: "Importer les employés",
            currentPage: "employees",
            user: req.session.user,
            error: errorMessages[0],
            details: errorMessages.slice(1)
        });
    }
};

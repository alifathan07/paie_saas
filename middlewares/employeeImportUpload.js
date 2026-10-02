import multer from "multer";
import crypto from "node:crypto";

const log = (level, event, details = {}) => console[level](`[employee-import] ${event}`, {
    timestamp: new Date().toISOString(),
    ...details
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const extension = String(file.originalname || "").toLowerCase().split(".").pop();
        const accepted = extension === "xlsx" || extension === "xls";
        log(accepted ? "info" : "warn", accepted ? "file.accepted" : "file.rejected", {
            requestId: req.importRequestId,
            fieldName: file.fieldname,
            originalName: file.originalname,
            mimeType: file.mimetype,
            extension
        });
        callback(accepted ? null : new Error("INVALID_EXCEL_FILE"));
    }
});

// Accept the first uploaded file even if a browser/client sends a slightly
// different multipart field name. The route still limits the request to one file.
export const employeeImportUpload = (req, res, next) => {
    req.importRequestId = crypto.randomUUID();
    log("info", "request.received", {
        requestId: req.importRequestId,
        method: req.method,
        url: req.originalUrl,
        contentType: req.get("content-type") || null,
        contentLength: req.get("content-length") || null,
        userId: req.session?.user?.id || null,
        companyId: req.session?.user?.activeCompanyId || null
    });
    upload.any()(req, res, (error) => {
        if (error) {
            log("error", "multipart.failed", {
                requestId: req.importRequestId,
                error: error.message,
                code: error.code || null,
                contentType: req.get("content-type") || null
            });
            req.importUploadError = error;
            return next();
        }
        req.file = req.files?.[0];
        log("info", "multipart.completed", {
            requestId: req.importRequestId,
            fileCount: req.files?.length || 0,
            bodyKeys: Object.keys(req.body || {}),
            files: (req.files || []).map((file) => ({
                fieldName: file.fieldname,
                originalName: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                hasBuffer: Boolean(file.buffer?.length)
            }))
        });
        next();
    });
};

import multer from "multer";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        const accepted = ['image/png', 'image/jpeg'].includes(String(file.mimetype || '').toLowerCase());
        callback(accepted ? null : new Error('INVALID_COMPANY_LOGO'));
    },
});

export const companyLogoUpload = (req, res, next) => {
    upload.any()(req, res, error => {
        if (error) {
            req.logoUploadError = error;
            return next();
        }
        req.file = (req.files || []).find(file => file.fieldname === 'logo') || req.files?.[0];
        console.info('[company-logo] upload.received', {
            fieldName: req.file?.fieldname || null,
            originalName: req.file?.originalname || null,
            mimeType: req.file?.mimetype || null,
            size: req.file?.size || 0,
        });
        next();
    });
};

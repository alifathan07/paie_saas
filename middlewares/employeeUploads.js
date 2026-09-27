import fs from "fs";
import path from "path";
import multer from "multer";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(currentDir, "../public/uploads/employees");

const storage = multer.diskStorage({
    destination: (_req, _file, callback) => {
        fs.mkdirSync(uploadDir, { recursive: true });
        callback(null, uploadDir);
    },
    filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
    }
});


const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const attachmentTypes = new Set([
    "application/pdf", "image/jpeg", "image/png", "image/webp",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    
]);

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        const valid = file.fieldname === "image"
            ? imageTypes.has(file.mimetype)
            : attachmentTypes.has(file.mimetype);
        callback(valid ? null : new Error("TYPE_FICHIER_INVALIDE"), valid);
    }
});

export const employeeUploads = upload.fields([
    { name: "image", maxCount: 1 },
    { name: "pieceJointe", maxCount: 1 }
]);
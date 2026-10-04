import express from "express";
import { enforceBulletinPeriod } from "../../middlewares/bulletinPeriod.js";
import {
    listBulletins,
    showBulletin,
    changeBulletinPeriod,
    generateBulletin,
    generateBulkBulletins,
    validateBulletin,
    validateBulkBulletins,
    returnBulletinToDraft,
    returnBulkBulletinsToDraft,
    closeBulletin,
    closeBulkBulletins,
    calculateLive,
    updateBulletinWorkedDays,
    addMonthlyPrime,
    deleteMonthlyPrime,
    addMonthlyIndemnity,
    stickMonthlyIndemnity,
    deleteMonthlyIndemnity,
    updateMonthlyIndemnity,
    downloadPdfBulletin,
    maskBulletin,
} from "../controllers/bulletins.controller.js";

export const bulletins = express.Router();
bulletins.use(enforceBulletinPeriod);

// Page 1 — employee payroll list
bulletins.get("/", listBulletins);

// Bulk generate for all active employees
bulletins.post("/generate-bulk", generateBulkBulletins);
bulletins.post("/close-bulk", closeBulkBulletins);
bulletins.post("/validate-bulk", validateBulkBulletins);
bulletins.post("/draft-bulk", returnBulkBulletinsToDraft);
bulletins.post("/:id/mask", maskBulletin);

// Live recalculation (AJAX — returns JSON)
bulletins.get("/:id/calculate", calculateLive);
bulletins.get("/:id/worked-days", updateBulletinWorkedDays);
bulletins.post("/:id/worked-days", updateBulletinWorkedDays);

// Add a taxable prime directly to the selected month's payslip
bulletins.post("/:id/primes", addMonthlyPrime);
bulletins.post("/:id/primes/delete", deleteMonthlyPrime);
bulletins.post("/:id/indemnities", addMonthlyIndemnity);
bulletins.post("/:id/indemnities/stick", stickMonthlyIndemnity);
bulletins.post("/:id/indemnities/delete", deleteMonthlyIndemnity);
bulletins.post("/:id/indemnities/update", updateMonthlyIndemnity);

// PDF Download route
bulletins.get("/:id/pdf", downloadPdfBulletin);

// Generate a single bulletin then redirect to show
bulletins.post("/:id/generate", generateBulletin);

// Validate a bulletin
bulletins.post("/:id/validate", validateBulletin);
bulletins.post("/:id/draft", returnBulletinToDraft);
bulletins.post("/:id/close", closeBulletin);

bulletins.get("/:id/period", changeBulletinPeriod);

// Page 2 — employee bulletin space
bulletins.get("/:id", showBulletin);

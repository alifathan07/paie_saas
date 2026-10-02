import express from "express";
import { isAdmin } from "../../middlewares/admin.js";
import {
    adminDashboard, adminClients, updateClientBilling, blockClient, unblockClient,
    createClientCompany, enterClientMode, exitClientMode, adminReports, updateReport,
} from "../controllers/admin.controller.js";

export const admin = express.Router();
admin.use(isAdmin);
admin.get("/", adminDashboard);
admin.get("/clients", adminClients);
admin.post("/clients/:id/billing", updateClientBilling);
admin.post("/clients/:id/block", blockClient);
admin.post("/clients/:id/unblock", unblockClient);
admin.post("/clients/:id/companies", createClientCompany);
admin.post("/clients/:id/mode", enterClientMode);
admin.post("/exit-mode", exitClientMode);
admin.get("/reports", adminReports);
admin.post("/reports/:id", updateReport);

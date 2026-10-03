import express from "express";
import { isAdmin } from "../../middlewares/admin.js";
import {
    adminDashboard, adminClients, adminCreateUserPage, adminCreateUser, adminUserDetails, adminCompanies, adminCompanyDetails,
    adminAuditLogs, adminUsage, adminSystem, updateClientBilling, blockClient, unblockClient,
    createClientCompany, enterClientMode, exitClientMode, adminReports, updateReport,
} from "../controllers/admin.controller.js";

export const admin = express.Router();
admin.use(isAdmin);
admin.get("/", adminDashboard);
admin.get("/users", adminClients);
admin.get("/users/new", adminCreateUserPage);
admin.post("/users", adminCreateUser);
admin.get("/users/:id", adminUserDetails);
admin.get("/clients", adminClients);
admin.get("/companies", adminCompanies);
admin.get("/companies/:id", adminCompanyDetails);
admin.get("/audit-logs", adminAuditLogs);
admin.get("/usage", adminUsage);
admin.get("/system", adminSystem);
admin.post("/clients/:id/billing", updateClientBilling);
admin.post("/clients/:id/block", blockClient);
admin.post("/clients/:id/unblock", unblockClient);
admin.post("/clients/:id/companies", createClientCompany);
admin.post("/clients/:id/mode", enterClientMode);
admin.post("/exit-mode", exitClientMode);
admin.get("/reports", adminReports);
admin.post("/reports/:id", updateReport);

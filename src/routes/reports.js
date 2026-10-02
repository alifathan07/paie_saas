import express from "express";
import { clientReports, createReport } from "../controllers/admin.controller.js";

export const reports = express.Router();
reports.get("/", clientReports);
reports.post("/", createReport);

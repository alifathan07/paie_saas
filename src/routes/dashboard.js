import express from "express";
import { renderDashboard } from "../controllers/dashboard.controller.js";

export const dashboard = express.Router();

dashboard.get("/", renderDashboard);

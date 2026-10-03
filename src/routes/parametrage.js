import express from "express";
import { settingsPage, updateSettings } from "../controllers/company.controller.js";

export const parametrage = express.Router();
parametrage.get("/", settingsPage);
parametrage.post("/", updateSettings);


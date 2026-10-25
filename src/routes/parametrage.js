import express from "express";
import { settingsPage, updateSettings, uploadCompanyLogo, deleteCompanyLogo, updateBulletinRubriqueSettings } from "../controllers/company.controller.js";
import { companyLogoUpload } from "../../middlewares/companyLogoUpload.js";

export const parametrage = express.Router();
parametrage.get("/", settingsPage);
parametrage.post("/", companyLogoUpload, updateSettings);
parametrage.post("/logo", companyLogoUpload, uploadCompanyLogo);
parametrage.post("/logo/delete", deleteCompanyLogo);
parametrage.post("/rubriques", updateBulletinRubriqueSettings);

import express from "express";
import { companyPage, createCompany } from "../controllers/company.controller.js";

export const companies = express.Router();
companies.get("/", companyPage);
companies.post("/", createCompany);


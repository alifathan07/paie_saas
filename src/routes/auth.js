import express from "express";
import { login, logout, loginPage, selectCompanyPage, selectCompany } from "../controllers/auth.controller.js";

export const auth = express.Router();

auth.get("/", loginPage);
auth.post("/login", login);
auth.get("/select-company", selectCompanyPage);
auth.post("/select-company", selectCompany);
auth.post("/logout", logout);


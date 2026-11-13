import express from "express";
import { login, logout, loginPage, registerPage, register, companySetupPage, completeCompanySetup, selectCompanyPage, selectCompany, verifyTwoFactorPage, verifyTwoFactor } from "../controllers/auth.controller.js";
import { loginRateLimit } from "../../middlewares/security.js";

export const auth = express.Router();

auth.get("/", loginPage);
auth.get("/register", registerPage);
auth.post("/register", loginRateLimit, register);
auth.get("/company-setup", companySetupPage);
auth.post("/company-setup", completeCompanySetup);
auth.post("/login", loginRateLimit, login);
auth.get("/verify", verifyTwoFactorPage);
auth.post("/verify", verifyTwoFactor);
auth.get("/select-company", selectCompanyPage);
auth.post("/select-company", selectCompany);
auth.post("/logout", logout);


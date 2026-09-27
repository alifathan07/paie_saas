import express from "express";
import { login, logout, loginPage } from "../controllers/auth.controller.js";

export const auth = express.Router();

auth.get("/", loginPage);
auth.post("/login", login);
auth.post("/logout", logout);


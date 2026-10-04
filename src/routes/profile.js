import express from "express";
import { profilePage, updateProfile, changePassword } from "../controllers/profile.controller.js";

export const profile = express.Router();
profile.get("/", profilePage);
profile.post("/", updateProfile);
profile.post("/password", changePassword);

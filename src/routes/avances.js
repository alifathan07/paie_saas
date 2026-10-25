import express from "express";
import { index, create } from "../controllers/avance.controller.js";

export const avances = express.Router();
avances.get("/", index);
avances.post("/", create);

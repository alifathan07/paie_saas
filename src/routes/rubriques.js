import express from "express";
import { index, updateFixed, createImposable, updateImposable } from "../controllers/rubrique.controller.js";

export const rubriques = express.Router();
rubriques.get("/", index);
rubriques.post("/fixed/:category/:id", updateFixed);
rubriques.post("/imposable", createImposable);
rubriques.post("/imposable/:id", updateImposable);

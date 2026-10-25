import express from "express";
import { index, updateFixed, createFixed, createImposable, updateImposable, remove } from "../controllers/rubrique.controller.js";

export const rubriques = express.Router();
rubriques.get("/", index);
rubriques.post("/fixed/:category/:id", updateFixed);
rubriques.post("/fixed/:category", createFixed);
rubriques.post("/imposable", createImposable);
rubriques.post("/imposable/:id", updateImposable);
rubriques.post("/:category/:id/delete", remove);

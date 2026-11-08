import express from "express";
import { create, index, update } from "../controllers/pret.controller.js";

export const prets = express.Router();
prets.get("/", index);
prets.post("/", create);
prets.post("/:id/edit", update);

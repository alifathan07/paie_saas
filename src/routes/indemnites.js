import express from "express";
import { index, create, update, remove, updateRepresentation } from "../controllers/indemnite.controller.js";
import { isAuth } from "../../middlewares/auth.js";

export const indemnites = express.Router();
indemnites.get("/", isAuth, index);
indemnites.post("/representation-rate", isAuth, updateRepresentation);
indemnites.post("/", isAuth, create);
indemnites.post("/:id/edit", isAuth, update);
indemnites.post("/:id/delete", isAuth, remove);

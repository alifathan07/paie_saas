import express from "express";
import { index, create, update, remove } from "../controllers/prime.controller.js";
import { isAuth } from "../../middlewares/auth.js";

export const primes = express.Router();
primes.get("/", isAuth, index);
primes.post("/", isAuth, create);
primes.post("/:id/edit", isAuth, update);
primes.post("/:id/delete", isAuth, remove);

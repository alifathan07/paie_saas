import express from "express";
import {
    listEmployees,
    renderCreateForm,
    handleCreateEmployee,
    employeeshow,
    renderEditForm,
    handleUpdateEmployee,
    handleDeleteEmployee,

} from "../controllers/employee.controller.js";
import { employeeUploads } from "../../middlewares/employeeUploads.js";
import { isAuth } from "../../middlewares/auth.js";

import { calculateNetToBase } from "../controllers/netToBase.controller.js";

export const employee = express.Router();
employee.post("/net-to-base", isAuth, calculateNetToBase);

// CRUD Routes
employee.get("/", listEmployees);
employee.get("/create", renderCreateForm);
employee.post("/create", employeeUploads, handleCreateEmployee);
employee.get("/:id", employeeshow);
employee.get("/:id/edit", renderEditForm);
employee.post("/:id/edit", employeeUploads, handleUpdateEmployee);
employee.post("/:id/delete", handleDeleteEmployee);
employee.delete("/:id", handleDeleteEmployee);

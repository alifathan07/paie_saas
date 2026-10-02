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
import { isAuth } from "../../middlewares/auth.js";

import { calculateNetToBase } from "../controllers/netToBase.controller.js";
import { employeeImportUpload } from "../../middlewares/employeeImportUpload.js";
import { importPage, importEmployees } from "../controllers/employeeImport.controller.js";

export const employee = express.Router();
employee.post("/net-to-base", isAuth, calculateNetToBase);

// CRUD Routes
employee.get("/", listEmployees);
employee.get("/create", renderCreateForm);
employee.post("/create", handleCreateEmployee);
employee.get("/import", importPage);
employee.post("/import", employeeImportUpload, express.json({ limit: "8mb" }), importEmployees);
employee.get("/:id", employeeshow);
employee.get("/:id/edit", renderEditForm);
employee.post("/:id/edit", handleUpdateEmployee);
employee.post("/:id/delete", handleDeleteEmployee);
employee.delete("/:id", handleDeleteEmployee);

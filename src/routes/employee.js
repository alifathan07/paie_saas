import express from "express";
import {
    listEmployees,
    renderCreateForm,
    handleCreateEmployee,
    employeeshow,
    renderEditForm,
    handleUpdateEmployee,
    handleDeleteEmployee,
    handleEmployeeIndemnites,
    handleRemoveEmployeeIndemnite,
    handleEmployeeTaxablePrime,
    handleEmployeeIndemniteToggle,
    syncEmployeeChantiers,

} from "../controllers/employee.controller.js";
import { isAuth } from "../../middlewares/auth.js";

import { calculateNetToBase } from "../controllers/netToBase.controller.js";
import { employeeImportUpload } from "../../middlewares/employeeImportUpload.js";
import { importPage, importEmployees } from "../controllers/employeeImport.controller.js";
import { index as categoryIndex, create as createCategory, createInline as createCategoryInline, update as updateCategory, remove as removeCategory } from "../controllers/employeeCategory.controller.js";
import { createInline as createFunctionInline } from "../controllers/employeeFunction.controller.js";
import { index as banqueIndex, create as createBanque, update as updateBanque, remove as removeBanque } from "../controllers/banque.controller.js";

export const employee = express.Router();
employee.post("/net-to-base", isAuth, calculateNetToBase);

// CRUD Routes
employee.get("/", listEmployees);
employee.post("/chantiers/sync", syncEmployeeChantiers);
employee.get("/categories", categoryIndex);
employee.get("/banques", banqueIndex);
employee.post("/categories", createCategory);
employee.post("/banques", createBanque);
employee.post("/categories/inline", createCategoryInline);
employee.post("/functions/inline", createFunctionInline);
employee.post("/categories/:id/edit", updateCategory);
employee.post("/banques/:id/edit", updateBanque);
employee.post("/categories/:id/delete", removeCategory);
employee.post("/banques/:id/delete", removeBanque);
employee.get("/create", renderCreateForm);
employee.post("/create", handleCreateEmployee);
employee.get("/import", importPage);
employee.post("/import", employeeImportUpload, express.json({ limit: "8mb" }), importEmployees);
employee.get("/:id", employeeshow);
employee.get("/:id/edit", renderEditForm);
employee.post("/:id/edit", handleUpdateEmployee);
employee.post("/:id/indemnites", handleEmployeeIndemnites);
employee.post("/:id/indemnites/:bonusId/delete", handleRemoveEmployeeIndemnite);
employee.post("/:id/primes/taxable", handleEmployeeTaxablePrime);
employee.post("/:id/indemnites/toggle", handleEmployeeIndemniteToggle);
employee.post("/:id/delete", handleDeleteEmployee);
employee.delete("/:id", handleDeleteEmployee);

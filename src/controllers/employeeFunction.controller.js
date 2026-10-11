import { resolveCompanyId } from "../lib/company.js";
import { createEmployeeFunction } from "../services/employeeService.js";

export async function createInline(req, res) {
    try {
        const employeeFunction = await createEmployeeFunction(resolveCompanyId(req), req.body.name, req.body.code);
        return res.status(201).json({ id: employeeFunction.id, name: employeeFunction.name, code: employeeFunction.code });
    } catch (error) {
        console.error("Error creating employee function inline:", error);
        return res.status(error.code === 'P2002' ? 409 : 400).json({ error: error.code === 'P2002' ? 'Cette fonction ou ce code existe déjà.' : 'Le nom et le code de la fonction sont obligatoires.' });
    }
}

import { resolveCompanyId } from "../lib/company.js";
import { createEmployeeFunction } from "../services/employeeService.js";

export async function createInline(req, res) {
    try {
        const employeeFunction = await createEmployeeFunction(resolveCompanyId(req), req.body.name);
        return res.status(201).json({ id: employeeFunction.id, name: employeeFunction.name });
    } catch (error) {
        console.error("Error creating employee function inline:", error);
        return res.status(error.code === 'P2002' ? 409 : 400).json({ error: error.code === 'P2002' ? 'Cette fonction existe déjà.' : 'Le nom de la fonction est obligatoire.' });
    }
}

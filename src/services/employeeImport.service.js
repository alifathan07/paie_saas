import XLSX from "xlsx";
import prisma from "../../db.ts";

export async function importEmployeesFromSpreadsheet({ buffer, companyId }) {
    const log = (level, event, details = {}) => console[level](`[employee-import] ${event}`, {
        timestamp: new Date().toISOString(),
        ...details
    });
    const targetCompanyId = Number(companyId);
    log("info", "service.input", { companyId: targetCompanyId, bufferSize: buffer?.length || 0 });
    if (!Number.isInteger(targetCompanyId) || targetCompanyId <= 0) throw new Error("NO_ACTIVE_COMPANY");
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("EMPTY_FILE");

    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, cellFormula: false, bookVBA: false, WTF: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("NO_WORKSHEET");
    const sheet = workbook.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    log("info", "spreadsheet.parsed", { sheetName, rowCountIncludingHeader: table.length });
    if (table.length < 2) throw new Error("NO_EMPLOYEE_ROWS");

    const headers = table[0].map((header, index) => String(header || `Colonne ${index + 1}`).trim());
    const rows = table.slice(1).map((values, index) => ({
        sourceRow: index + 2,
        values: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]))
    })).filter((row) => Object.values(row.values).some((value) => String(value).trim() !== ""));
    if (!rows.length) throw new Error("NO_EMPLOYEE_ROWS");
    if (rows.length > 500) throw new Error("TOO_MANY_ROWS");
    log("info", "rows.prepared", { headerCount: headers.length, employeeRowCount: rows.length, headers });

    const fields = {
        matricule: "string or null; generate one only when absent",
        nomComplet: "string, required",
        cin: "string, required",
        dateNaissance: "YYYY-MM-DD, required",
        sexe: "M or F, default M",
        dateEmbauche: "YYYY-MM-DD, required",
        dateAnciennete: "YYYY-MM-DD or null",
        dateSortie: "YYYY-MM-DD or null",
        fonction: "string or null",
        codeService: "string or null",
        statut: "TITULAIRE, NON_TITULAIRE, or VACATAIRE",
        natureEmploi: "PERMANENT, OCCASIONNEL, STAGIAIRE, EXONERE, or DOCTORANT",
        contratDateDebut: "YYYY-MM-DD or null",
        contratDateFin: "YYYY-MM-DD or null",
        situationFam: "CELIBATAIRE, MARIE, DIVORCE, or VEUF",
        nbPersonacharge: "integer 0 to 6 or null; null when the spreadsheet has no value",
        nbEnfantCharge: "integer 0 to 6",
        adresse: "string or null",
        ville: "string or null",
        numeroCNSS: "string or null",
        dateAffiliationCnss: "YYYY-MM-DD or null",
        modePaiement: "VIREMENT, CHEQUE, or ESPECE",
        banque: "string or null",
        agence: "string or null",
        rib: "string or null",
        baseSalary: "number, required",
        cimrRate: "number between 0 and 1 or null"
    };
    const apiKey = String(process.env.DEEPSEEK_API_KEY || process.env.GROQ_API_KEY || "").trim();
    const model = String(process.env.DEEPSEEK_MODEL || process.env.GROQ_MODEL || "deepseek-chat").trim();
    if (!apiKey) throw new Error("DEEPSEEK_NOT_CONFIGURED");

    const baseUrl = String(process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    const endpoint = `${baseUrl}/chat/completions`;
    log("info", "ai.request.started", { provider: "deepseek", endpoint, model, keySource: process.env.DEEPSEEK_API_KEY ? "DEEPSEEK_API_KEY" : "GROQ_API_KEY", rowCount: rows.length, columnCount: headers.length });
    const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: 12000,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You normalize employee spreadsheet rows into JSON. Return JSON only in the exact shape {"employees":[...]}. Map any language, spelling, abbreviations, column order, and French date/number formats to the allowed fields. Never invent a value that is not present except defaults explicitly requested. Preserve CIN, matricule, bank numbers, and names as strings. Use null for missing optional fields. Required fields must be null when absent so the application can report them. If the spreadsheet does not contain a value for nbPersonacharge, return null; the application will calculate it as nbEnfantCharge + 1. Every output object must include sourceRow from the input. Allowed fields and formats: ${JSON.stringify(fields)}. Defaults: sexe=M, statut=TITULAIRE, natureEmploi=PERMANENT, situationFam=CELIBATAIRE, nbEnfantCharge=0, modePaiement=VIREMENT. For date-only values return YYYY-MM-DD. Convert decimal commas to numbers.`
                },
                { role: "user", content: JSON.stringify({ sheet: sheetName, headers, rows }) }
            ]
        })
    });
    log("info", "ai.response.received", { provider: "deepseek", status: response.status, ok: response.ok });
    if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (!content) throw new Error("DEEPSEEK_EMPTY_RESPONSE");
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error("DEEPSEEK_INVALID_JSON"); }
    if (!Array.isArray(parsed.employees) || parsed.employees.length !== rows.length) throw new Error("DEEPSEEK_ROW_COUNT_MISMATCH");
    log("info", "ai.mapping.completed", { mappedRowCount: parsed.employees.length });

    const allowedSexes = new Set(["M", "F"]);
    const allowedStatuses = new Set(["TITULAIRE", "NON_TITULAIRE", "VACATAIRE"]);
    const allowedNature = new Set(["PERMANENT", "OCCASIONNEL", "STAGIAIRE", "EXONERE", "DOCTORANT"]);
    const allowedFamily = new Set(["CELIBATAIRE", "MARIE", "DIVORCE", "VEUF"]);
    const allowedPayment = new Set(["VIREMENT", "CHEQUE", "ESPECE"]);
    const dateFields = ["dateNaissance", "dateEmbauche", "dateAnciennete", "dateSortie", "contratDateDebut", "contratDateFin", "dateAffiliationCnss"];
    const errors = [];
    const clean = parsed.employees.map((raw, index) => {
        const sourceRow = Number(raw?.sourceRow) || rows[index].sourceRow;
        const employee = { ...raw, sourceRow };
        for (const field of dateFields) {
            if (employee[field] === "" || employee[field] === undefined) employee[field] = null;
            if (employee[field] !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(employee[field]))) errors.push(`Ligne ${sourceRow}: ${field} doit être une date YYYY-MM-DD.`);
        }
        employee.nomComplet = String(employee.nomComplet || "").trim();
        employee.cin = String(employee.cin || "").trim();
        employee.matricule = String(employee.matricule || `EMP-${Date.now()}-${index + 1}`).trim();
        employee.sexe = String(employee.sexe || "M").toUpperCase();
        employee.statut = String(employee.statut || "TITULAIRE").toUpperCase();
        employee.natureEmploi = String(employee.natureEmploi || "PERMANENT").toUpperCase();
        employee.situationFam = String(employee.situationFam || "CELIBATAIRE").toUpperCase();
        employee.modePaiement = String(employee.modePaiement || "VIREMENT").toUpperCase();
        employee.nbEnfantCharge = Number(employee.nbEnfantCharge ?? 0);
        const hasPersonnesAChargeValue = employee.nbPersonacharge !== null
            && employee.nbPersonacharge !== undefined
            && String(employee.nbPersonacharge).trim() !== "";
        employee.nbPersonacharge = hasPersonnesAChargeValue
            ? Number(employee.nbPersonacharge)
            : employee.nbEnfantCharge + 1;
        employee.baseSalary = Number(employee.baseSalary);
        if (!employee.dateAnciennete) employee.dateAnciennete = employee.dateEmbauche;
        if (!employee.nomComplet) errors.push(`Ligne ${sourceRow}: nomComplet est obligatoire.`);
        if (!employee.cin) errors.push(`Ligne ${sourceRow}: cin est obligatoire.`);
        if (!employee.dateNaissance) errors.push(`Ligne ${sourceRow}: dateNaissance est obligatoire.`);
        if (!employee.dateEmbauche) errors.push(`Ligne ${sourceRow}: dateEmbauche est obligatoire.`);
        if (!Number.isFinite(employee.baseSalary) || employee.baseSalary < 0) errors.push(`Ligne ${sourceRow}: baseSalary est invalide.`);
        if (!allowedSexes.has(employee.sexe)) errors.push(`Ligne ${sourceRow}: sexe est invalide.`);
        if (!allowedStatuses.has(employee.statut)) errors.push(`Ligne ${sourceRow}: statut est invalide.`);
        if (!allowedNature.has(employee.natureEmploi)) errors.push(`Ligne ${sourceRow}: natureEmploi est invalide.`);
        if (!allowedFamily.has(employee.situationFam)) errors.push(`Ligne ${sourceRow}: situationFam est invalide.`);
        if (!allowedPayment.has(employee.modePaiement)) errors.push(`Ligne ${sourceRow}: modePaiement est invalide.`);
        if (!Number.isInteger(employee.nbPersonacharge) || employee.nbPersonacharge < 0 || employee.nbPersonacharge > 6) errors.push(`Ligne ${sourceRow}: nbPersonacharge est invalide.`);
        if (!Number.isInteger(employee.nbEnfantCharge) || employee.nbEnfantCharge < 0 || employee.nbEnfantCharge > 6) errors.push(`Ligne ${sourceRow}: nbEnfantCharge est invalide.`);
        return employee;
    });
    if (errors.length) { log("warn", "validation.failed", { errorCount: errors.length }); const error = new Error("IMPORT_VALIDATION_FAILED"); error.details = errors; throw error; }
    log("info", "validation.completed", { validRowCount: clean.length });

    const existing = await prisma.employee.findMany({ where: { companyId: targetCompanyId }, select: { cin: true, matricule: true } });
    const existingCins = new Set(existing.map((employee) => employee.cin));
    const existingMatricules = new Set(existing.map((employee) => employee.matricule));
    const seenCins = new Set();
    const seenMatricules = new Set();
    for (const employee of clean) {
        if (existingCins.has(employee.cin) || seenCins.has(employee.cin)) errors.push(`Ligne ${employee.sourceRow}: CIN déjà utilisée ou en doublon.`);
        if (existingMatricules.has(employee.matricule) || seenMatricules.has(employee.matricule)) errors.push(`Ligne ${employee.sourceRow}: matricule déjà utilisé ou en doublon.`);
        seenCins.add(employee.cin); seenMatricules.add(employee.matricule);
    }
    if (errors.length) { log("warn", "duplicates.found", { errorCount: errors.length }); const error = new Error("IMPORT_DUPLICATES"); error.details = errors; throw error; }

    log("info", "database.transaction.started", { employeeCount: clean.length, companyId: targetCompanyId });
    const created = await prisma.$transaction(clean.map((employee) => prisma.employee.create({ data: {
        matricule: employee.matricule,
        nomComplet: employee.nomComplet,
        cin: employee.cin,
        dateNaissance: new Date(employee.dateNaissance),
        sexe: employee.sexe,
        dateEmbauche: new Date(employee.dateEmbauche),
        dateAnciennete: new Date(employee.dateAnciennete),
        dateSortie: employee.dateSortie ? new Date(employee.dateSortie) : null,
        fonction: employee.fonction || null,
        codeService: employee.codeService || null,
        statut: employee.statut,
        natureEmploi: employee.natureEmploi,
        contratDateDebut: employee.contratDateDebut ? new Date(employee.contratDateDebut) : null,
        contratDateFin: employee.contratDateFin ? new Date(employee.contratDateFin) : null,
        situationFam: employee.situationFam,
        nbPersonacharge: employee.nbPersonacharge,
        nbEnfantCharge: employee.nbEnfantCharge,
        adresse: employee.adresse || null,
        ville: employee.ville || null,
        numeroCNSS: employee.numeroCNSS || null,
        dateAffiliationCnss: employee.dateAffiliationCnss ? new Date(employee.dateAffiliationCnss) : null,
        modePaiement: employee.modePaiement,
        banque: employee.banque || null,
        agence: employee.agence || null,
        rib: employee.rib || null,
        baseSalary: employee.baseSalary,
        cimrRate: employee.cimrRate === null || employee.cimrRate === undefined || employee.cimrRate === "" ? null : Number(employee.cimrRate),
        companyId: targetCompanyId
    } })));
    log("info", "database.transaction.completed", { createdCount: created.length, companyId: targetCompanyId });
    return { count: created.length, sheetName, rows: clean.map(({ sourceRow, ...employee }) => ({ sourceRow, employee })) };
}

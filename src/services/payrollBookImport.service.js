import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prisma from "../../db.ts";
import { normalizeAIJsonContent, resolveAIProvider } from "./employeeImport.service.js";

function fail(message, details = []) {
    const error = new Error(message);
    error.details = details;
    throw error;
}

function parseNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const number = Number(normalized);
    return Number.isFinite(number) ? Number(number.toFixed(2)) : null;
}

function parsePeriod(value) {
    const match = String(value || "").match(/(?:^|\D)(0?[1-9]|1[0-2])\D?(20\d{2}|\d{2})(?:$|\D)/);
    if (!match) return null;
    const month = Number(match[1]);
    const yearValue = Number(match[2]);
    return { month, year: yearValue < 100 ? 2000 + yearValue : yearValue };
}

function jsonCandidate(value) {
    const text = String(value || "").trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced) return fenced[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

async function extractPdfText(buffer) {
    const directory = await mkdtemp(join(tmpdir(), "paie-payroll-book-"));
    const filePath = join(directory, "source.pdf");
    try {
        await writeFile(filePath, buffer, { mode: 0o600 });
        const { stdout } = await new Promise((resolve, reject) => {
            execFile("pdftotext", ["-layout", filePath, "-"], { maxBuffer: 8 * 1024 * 1024 }, (error, output, stderr) => {
                if (error) return reject(new Error(stderr || error.message));
                return resolve({ stdout: output });
            });
        });
        return stdout;
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
}

function contentForFile(buffer, mimeType, text) {
    if (text.trim()) return `Here is the extracted PDF text:\n\n${text}`;
    if (mimeType.startsWith("image/")) {
        return [
            { type: "text", text: "Read this payroll book image exactly. Do not guess unreadable values." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
        ];
    }
    return null;
}

function cleanRows(payload) {
    if (!Array.isArray(payload?.employees)) fail("PAYROLL_BOOK_INVALID_RESPONSE");
    return payload.employees.map((row, index) => ({
        sourceRow: Number(row?.sourceRow) || index + 1,
        matricule: String(row?.matricule || "").trim() || null,
        numeroCNSS: String(row?.numeroCNSS || row?.cnssNumber || "").trim() || null,
        nomPrenom: String(row?.nomPrenom || row?.name || "").trim() || null,
        baseSalary: parseNumber(row?.baseSalary),
        workedDays: parseNumber(row?.workedDays ?? row?.jours),
        workedHours: parseNumber(row?.workedHours ?? row?.heuresNormales),
        heuresSup25: parseNumber(row?.heuresSup25 ?? row?.hs25) ?? 0,
        heuresSup50: parseNumber(row?.heuresSup50 ?? row?.hs50) ?? 0,
        heuresSup100: parseNumber(row?.heuresSup100 ?? row?.hs100) ?? 0,
        paidLeaveDays: parseNumber(row?.paidLeaveDays ?? row?.joursConge) ?? 0,
        congeNaissanceDays: parseNumber(row?.congeNaissanceDays) ?? 0,
        joursFeries: parseNumber(row?.joursFeries) ?? 0,
        avances: parseNumber(row?.avances) ?? 0,
        pretDeduction: parseNumber(row?.pretDeduction) ?? 0,
        totalPrimeNonImposable: parseNumber(row?.totalPrimeNonImposable ?? row?.primesNonImposables ?? row?.totalNimp),
        variablePrimes: Array.isArray(row?.variablePrimes) ? row.variablePrimes.map(item => ({ label: String(item?.label || item?.name || "").trim(), amount: parseNumber(item?.amount) })).filter(item => item.label && item.amount !== null) : [],
        nimpLines: Array.isArray(row?.nimpLines) ? row.nimpLines.map(item => ({ label: String(item?.label || item?.name || "").trim(), amount: parseNumber(item?.amount) })).filter(item => item.label && item.amount !== null) : [],
    }));
}

export async function extractPayrollBook({ buffer, mimeType, originalName }) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) fail("PAYROLL_BOOK_EMPTY_FILE");
    const normalizedType = String(mimeType || "").toLowerCase();
    const isPdf = normalizedType === "application/pdf" || String(originalName).toLowerCase().endsWith(".pdf");
    const isImage = /^image\/(jpeg|jpg|png)$/.test(normalizedType) || /\.(jpe?g|png)$/i.test(String(originalName));
    if (!isPdf && !isImage) fail("PAYROLL_BOOK_INVALID_FILE");

    let extractedText = "";
    if (isPdf) {
        try { extractedText = await extractPdfText(buffer); } catch (error) {
            if (!error.message?.startsWith("PDF_TEXT_EXTRACTION")) fail("PAYROLL_BOOK_PDF_READ_FAILED");
        }
    }
    const content = contentForFile(buffer, isPdf ? "application/pdf" : normalizedType, extractedText);
    if (!content) fail("PAYROLL_BOOK_NO_READABLE_CONTENT");
    const ai = resolveAIProvider();
    if (!ai) fail("DEEPSEEK_NOT_CONFIGURED");

    const response = await fetch(`${ai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: String(process.env.DEEPSEEK_PAYROLL_MODEL || ai.model),
            temperature: 0,
            max_tokens: 16000,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `Extract a Moroccan payroll book into JSON only. Return exactly {"period":{"month":number,"year":number},"employees":[...]}. Ignore TOTAL rows and headers; return only employees. Never invent unreadable values: use null. Match each employee row. Employees fields: sourceRow, matricule, numeroCNSS, nomPrenom, baseSalary, workedDays, workedHours, heuresSup25, heuresSup50, heuresSup100, paidLeaveDays, congeNaissanceDays, joursFeries, avances, pretDeduction, totalPrimeNonImposable, variablePrimes:[{label,amount}], nimpLines:[{label,amount}]. Extract totalPrimeNonImposable only when the document shows a per-employee total for non-taxable primes/indemnities; keep detailed nimpLines too only when the source lists their separate amounts. Use numbers without currency symbols. The month/year must come from the document title or period. Extract input values only; do not calculate taxes, CNSS, IR, gross salary or net salary. If a value is not clearly readable, return null. If extraction is impossible, still return valid JSON in this exact shape: {"period":null,"employees":[],"error":{"code":"EXTRACTION_FAILED","message":"short explanation","details":["specific reason 1","specific reason 2"]}}. Do not return Markdown, comments, or text outside JSON.`,
                },
                { role: "user", content },
            ],
        }),
    });
    if (!response.ok) fail(`DEEPSEEK_HTTP_${response.status}`);
    let body;
    try { body = await response.json(); } catch { fail("DEEPSEEK_EMPTY_RESPONSE"); }
    const message = body?.choices?.[0]?.message || {};
    const contentValue = message.content;
    const messageContent = Array.isArray(contentValue)
        ? contentValue.map(part => typeof part === "string" ? part : part?.text || "").join("\n")
        : typeof contentValue === "object" && contentValue !== null
            ? JSON.stringify(contentValue)
            : String(contentValue || "");
    const raw = messageContent.trim()
        ? messageContent
        : String(body?.output_text || body?.choices?.[0]?.text || "").trim();
    if (!raw.trim()) {
        console.error("[payroll-book-import] DeepSeek returned no message content", {
            model: String(process.env.DEEPSEEK_PAYROLL_MODEL || ai.model),
            finishReason: body?.choices?.[0]?.finish_reason || null,
            messageKeys: Object.keys(message),
        });
        fail("DEEPSEEK_EMPTY_RESPONSE");
    }
    console.error("[payroll-book-import] DeepSeek raw response:", raw);
    let parsed;
    try {
        parsed = JSON.parse(jsonCandidate(normalizeAIJsonContent(raw)));
    } catch (error) {
        console.error("[payroll-book-import] DeepSeek response JSON parse failed:", {
            error: error.message,
            response: raw,
        });
        console.info("[payroll-book-import] Requesting one JSON repair attempt from DeepSeek.");
        const repairResponse = await fetch(`${ai.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: String(process.env.DEEPSEEK_PAYROLL_MODEL || ai.model),
                temperature: 0,
                max_tokens: 16000,
                response_format: { type: "json_object" },
                messages: [
                    {
                        role: "system",
                        content: "Repair the assistant response into valid JSON only. Return exactly {\"period\":{\"month\":number,\"year\":number},\"employees\":[...]}. Preserve every value exactly; do not calculate, invent, remove, or explain anything. If the source cannot be repaired, return {\"period\":null,\"employees\":[],\"error\":{\"code\":\"INVALID_SOURCE\",\"message\":\"why it cannot be repaired\",\"details\":[]}}.",
                    },
                    { role: "user", content: `Assistant response to repair:\n\n${raw}` },
                ],
            }),
        });
        if (!repairResponse.ok) fail(`DEEPSEEK_JSON_REPAIR_HTTP_${repairResponse.status}`);
        let repairBody;
        try { repairBody = await repairResponse.json(); } catch { fail("DEEPSEEK_JSON_REPAIR_EMPTY"); }
        const repairMessage = repairBody?.choices?.[0]?.message || {};
        const repairValue = repairMessage.content;
        const repairedRaw = Array.isArray(repairValue)
            ? repairValue.map(part => typeof part === "string" ? part : part?.text || "").join("\n")
            : typeof repairValue === "object" && repairValue !== null
                ? JSON.stringify(repairValue)
                : String(repairValue || repairBody?.output_text || "");
        console.error("[payroll-book-import] DeepSeek repaired response:", repairedRaw);
        try {
            parsed = JSON.parse(jsonCandidate(normalizeAIJsonContent(repairedRaw)));
        } catch (repairError) {
            console.error("[payroll-book-import] DeepSeek JSON repair failed:", { error: repairError.message, response: repairedRaw });
            fail("DEEPSEEK_INVALID_JSON", ["DeepSeek returned invalid JSON and the automatic repair attempt also failed."]);
        }
    }
    if (parsed?.error) {
        console.error("[payroll-book-import] DeepSeek explained extraction failure:", parsed.error);
        fail("PAYROLL_BOOK_AI_EXTRACTION_FAILED", Array.isArray(parsed.error.details) ? parsed.error.details : [String(parsed.error.message || "DeepSeek could not extract the document.")]);
    }
    const period = parsed.period?.month && parsed.period?.year
        ? { month: Number(parsed.period.month), year: Number(parsed.period.year) }
        : parsePeriod(extractedText || originalName);
    if (!period || period.month < 1 || period.month > 12 || period.year < 2020 || period.year > 2040) fail("PAYROLL_BOOK_PERIOD_NOT_FOUND");
    const rows = cleanRows(parsed);
    if (!rows.length) fail("PAYROLL_BOOK_NO_EMPLOYEES");
    return { period, rows, sourceName: originalName };
}

export async function matchPayrollBookEmployees(companyId, rows) {
    const employees = await prisma.employee.findMany({ where: { companyId: Number(companyId) }, select: { id: true, matricule: true, numeroCNSS: true, nomComplet: true, blocageSaisiePaie: true } });
    const byMatricule = new Map(employees.map(employee => [String(employee.matricule).trim().toLowerCase(), employee]));
    const byCNSS = new Map(employees.filter(employee => employee.numeroCNSS).map(employee => [String(employee.numeroCNSS).trim(), employee]));
    return rows.map(row => {
        const employee = (row.matricule && byMatricule.get(row.matricule.toLowerCase())) || (row.numeroCNSS && byCNSS.get(row.numeroCNSS));
        return { ...row, employeeId: employee?.id || null, employeeName: employee?.nomComplet || null, locked: Boolean(employee?.blocageSaisiePaie) };
    });
}


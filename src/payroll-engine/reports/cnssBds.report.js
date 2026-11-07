const A02_RECORD_LENGTH = 260;
// CNSS fixed-width A02 layout: A02 (3) + affiliation (7) + period (6),
// followed by the employee registration number (9).
const A02_CNSS_START = 16;
const A02_CNSS_END = 25;
const A02_FIELD_START = 77;
const A02_FIELD_END = 112;
const MAX_SALARY_CENTS = 999_999_999_999n;

function splitTemplateLines(templateFile) {
    if (typeof templateFile !== "string" || !templateFile.length) {
        throw new Error("INVALID_BDS_TEMPLATE");
    }
    const hasTrailingLineBreak = /(?:\r\n|\n|\r)$/.test(templateFile);
    const lines = templateFile.split(/\r\n|\n|\r/);
    if (hasTrailingLineBreak) lines.pop();
    return { lines, hasTrailingLineBreak };
}

function footerLine(lines) {
    const footers = lines.filter(line => line.slice(0, 3) === "A03");
    if (footers.length !== 1 || footers[0].length < 18) {
        throw new Error("INVALID_BDS_FOOTER");
    }
    return footers[0];
}

export function getCnssBdsTemplateAffiliation(templateFile) {
    const { lines } = splitTemplateLines(templateFile);
    return footerLine(lines).slice(3, 12);
}

function normalizePayrollRecords(payrollData) {
    if (Array.isArray(payrollData)) return payrollData;
    if (payrollData instanceof Map) {
        return [...payrollData.entries()].map(([key, value]) => ({
            ...value,
            cnss_immatriculation: value?.cnss_immatriculation ?? key,
        }));
    }
    if (payrollData && typeof payrollData === "object") {
        if ("cnss_immatriculation" in payrollData) return [payrollData];
        return Object.entries(payrollData).map(([key, value]) => ({
            ...value,
            cnss_immatriculation: value?.cnss_immatriculation ?? key,
        }));
    }
    throw new Error("INVALID_BDS_PAYROLL_DATA");
}

function normalizeCnssNumber(value) {
    const number = String(value ?? "").trim();
    if (!/^\d{9}$/.test(number)) throw new Error("INVALID_BDS_CNSS_NUMBER");
    return number;
}

function toCents(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
        throw new Error("INVALID_BDS_AMOUNT");
    }
    if (typeof value === "boolean") throw new Error("INVALID_BDS_AMOUNT");
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_BDS_AMOUNT");
    const cents = Math.round((amount + Number.EPSILON) * 100);
    if (!Number.isSafeInteger(cents) || BigInt(cents) > MAX_SALARY_CENTS) {
        throw new Error("BDS_AMOUNT_OVERFLOW");
    }
    return BigInt(cents);
}

function formatDigits(value, width, errorCode = "BDS_FIELD_OVERFLOW") {
    const digits = BigInt(value).toString();
    if (digits.length > width) throw new Error(errorCode);
    return digits.padStart(width, "0");
}

function normalizeDays(value) {
    if (value === null || value === undefined || typeof value === "boolean"
        || (typeof value === "string" && !/^\d+$/.test(value.trim()))) {
        throw new Error("INVALID_BDS_DAYS");
    }
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0) throw new Error("INVALID_BDS_DAYS");
    return Math.min(days, 26);
}

function normalizeSituation(record) {
    const code = String(record.situation_code ?? "N").toUpperCase();
    if (!/^[NESM]$/.test(code)) throw new Error("INVALID_BDS_SITUATION_CODE");
    if (code === "N") return { code, date: "        " };
    const date = String(record.situation_date || "");
    if (!/^\d{8}$/.test(date)) throw new Error("INVALID_BDS_SITUATION_DATE");
    const parsedDate = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10).replaceAll("-", "") !== date) {
        throw new Error("INVALID_BDS_SITUATION_DATE");
    }
    return { code, date };
}

function parseTemplateAmount(field) {
    if (!/^\d+$/.test(field)) throw new Error("INVALID_BDS_TEMPLATE_AMOUNT");
    return BigInt(field);
}

export function generateCnssBdsFile(templateFile, payrollData) {
    const { lines, hasTrailingLineBreak } = splitTemplateLines(templateFile);
    const a00Lines = lines.filter(line => line.slice(0, 3) === "A00");
    const a01Lines = lines.filter(line => line.slice(0, 3) === "A01");
    const a02Lines = lines.filter(line => line.slice(0, 3) === "A02");
    if (a00Lines.length !== 1 || a01Lines.length !== 1) throw new Error("INVALID_BDS_HEADERS");
    for (const line of [...a00Lines, ...a01Lines, ...a02Lines]) {
        if (line.length !== A02_RECORD_LENGTH) throw new Error("INVALID_BDS_RECORD_LENGTH");
    }

    const originalFooter = footerLine(lines);
    const payrollByCnss = new Map();
    for (const record of normalizePayrollRecords(payrollData)) {
        if (!record || typeof record !== "object") throw new Error("INVALID_BDS_PAYROLL_RECORD");
        const cnss = normalizeCnssNumber(record.cnss_immatriculation);
        if (payrollByCnss.has(cnss)) throw new Error("DUPLICATE_BDS_PAYROLL_CNSS_NUMBER");
        payrollByCnss.set(cnss, {
            days: normalizeDays(record.days_worked),
            grossCents: toCents(record.gross_salary),
            amoCents: toCents(record.amo_salary_base),
            ...normalizeSituation(record),
        });
    }

    const templateCnssNumbers = new Set();
    const matchedCnssNumbers = new Set();
    const updatedLines = lines.map(line => {
        if (line.slice(0, 3) !== "A02") return line;
        const cnss = line.slice(A02_CNSS_START, A02_CNSS_END);
        if (!/^\d{9}$/.test(cnss)) throw new Error("INVALID_BDS_TEMPLATE_CNSS_NUMBER");
        if (templateCnssNumbers.has(cnss)) throw new Error("DUPLICATE_BDS_TEMPLATE_CNSS_NUMBER");
        templateCnssNumbers.add(cnss);

        const record = payrollByCnss.get(cnss);
        if (!record) return line;
        matchedCnssNumbers.add(cnss);
        return line.slice(0, A02_FIELD_START)
            + formatDigits(record.days, 2)
            + formatDigits(record.grossCents, 12, "BDS_AMOUNT_OVERFLOW")
            + formatDigits(record.amoCents, 12, "BDS_AMOUNT_OVERFLOW")
            + record.code
            + record.date
            + line.slice(A02_FIELD_END);
    });

    if (matchedCnssNumbers.size !== payrollByCnss.size) {
        throw new Error("BDS_PAYROLL_EMPLOYEE_NOT_IN_TEMPLATE");
    }

    let grossTotal = 0n;
    let amoTotal = 0n;
    for (const line of updatedLines) {
        if (line.slice(0, 3) !== "A02") continue;
        grossTotal += parseTemplateAmount(line.slice(79, 91));
        amoTotal += parseTemplateAmount(line.slice(91, 103));
    }

    const footerIndex = updatedLines.findIndex(line => line.slice(0, 3) === "A03");
    const footer = originalFooter.slice(0, 18)
        + formatDigits(a02Lines.length, 6, "BDS_EMPLOYEE_COUNT_OVERFLOW")
        + formatDigits(grossTotal, 14)
        + formatDigits(amoTotal, 14);
    updatedLines[footerIndex] = footer;

    return updatedLines.join("\r\n") + (hasTrailingLineBreak ? "\r\n" : "");
}

const RECORD_LENGTH = 260;
const SITUATION_RANK = { "": 0, SO: 1, DE: 2, IT: 3, IL: 4, AT: 5, CS: 6, MS: 7, MP: 8 };
const B02 = { cnss: 16, name: 25, children: 85, afPay: 87, afDeduct: 93, afNet: 99, afReverse: 105 };

function splitTemplateLines(templateFile) {
    if (typeof templateFile !== "string" || !templateFile.length) throw new Error("INVALID_BDS_TEMPLATE");
    const trailing = /(?:\r\n|\n|\r)$/.test(templateFile);
    const lines = templateFile.split(/\r\n|\n|\r/);
    if (trailing) lines.pop();
    return lines;
}

function ascii(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, " ");
}

function text(value, width) { return ascii(value).slice(0, width).padEnd(width, " "); }

function digits(value, width, errorCode = "BDS_FIELD_OVERFLOW") {
    const normalized = String(value ?? "").trim();
    if (!/^\d+$/.test(normalized)) throw new Error("INVALID_BDS_NUMERIC_FIELD");
    if (normalized.length > width) throw new Error(errorCode);
    return normalized.padStart(width, "0");
}

function numberValue(value, width, errorCode = "BDS_FIELD_OVERFLOW") {
    let result;
    try { result = BigInt(value ?? 0); } catch { throw new Error("INVALID_BDS_NUMERIC_FIELD"); }
    if (result < 0n) throw new Error("INVALID_BDS_NUMERIC_FIELD");
    return digits(result.toString(), width, errorCode);
}

function centsFromAmount(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("INVALID_BDS_AMOUNT");
    return BigInt(Math.round((amount + Number.EPSILON) * 100));
}

function normalizeDays(value) {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 0 || days > 26) throw new Error("INVALID_BDS_DAYS");
    return days;
}

function normalizeSituation(value) {
    const situation = String(value ?? "").trim().toUpperCase();
    if (!Object.hasOwn(SITUATION_RANK, situation)) throw new Error("INVALID_BDS_SITUATION_CODE");
    return situation;
}

function sourceNumber(source, start, width) {
    const value = source?.slice(start, start + width).trim();
    return value && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function amountCents(record, field, source, start, width) {
    if (record[field] !== undefined && record[field] !== null) return BigInt(record[field]);
    return sourceNumber(source, start, width) ?? 0n;
}

function parseTemplate(templateFile) {
    const lines = splitTemplateLines(templateFile);
    const structural = lines.filter(line => ["A00", "A01", "A02", "B00", "B01", "B02"].includes(line.slice(0, 3)));
    if (!structural.length || structural.some(line => line.length !== RECORD_LENGTH)) throw new Error("INVALID_BDS_RECORD_LENGTH");
    const b00 = lines.find(line => ["A00", "B00"].includes(line.slice(0, 3)));
    const b01 = lines.find(line => ["A01", "B01"].includes(line.slice(0, 3)));
    const b02 = lines.filter(line => ["A02", "B02"].includes(line.slice(0, 3)));
    if (!b00 || !b01) throw new Error("INVALID_BDS_HEADERS");
    const byCnss = new Map();
    for (const line of b02) {
        const cnss = line.slice(B02.cnss, B02.cnss + 9);
        if (!/^\d{9}$/.test(cnss)) throw new Error("INVALID_BDS_TEMPLATE_CNSS_NUMBER");
        if (byCnss.has(cnss)) throw new Error("DUPLICATE_BDS_TEMPLATE_CNSS_NUMBER");
        byCnss.set(cnss, line);
    }
    return { b00, b01, byCnss };
}

function buildB00(source) { return "B00" + source.slice(3, 17) + "B0" + " ".repeat(241); }

function buildB01(source) {
    // CNSS requires B01 to equal A01 except for the record identifier. The
    // application does not store every B01 field, so preserve the official
    // pre-established header instead of reconstructing it from partial data.
    return "B01" + source.slice(3);
}

function calculateSummary(record, source, context, type) {
    const hasCnss = /^\d{9}$/.test(String(record.cnss_immatriculation || ""));
    const cnss = hasCnss ? String(record.cnss_immatriculation) : "000000000";
    const situation = type === "B02" ? normalizeSituation(record.bds_situation) : "";
    const days = normalizeDays(record.days_worked);
    const real = record.salary_real_cents !== undefined ? BigInt(record.salary_real_cents) : centsFromAmount(record.gross_salary);
    const capped = record.salary_plaf_cents !== undefined ? BigInt(record.salary_plaf_cents) : (real < context.salaryCeilingCents ? real : context.salaryCeilingCents);
    if (capped > real) throw new Error("BDS_CAPPED_SALARY_EXCEEDS_REAL");
    // Identity and family-allowance fields in B02 must match the official
    // pre-established A02 record exactly.
    const children = type === "B02" ? (sourceNumber(source, B02.children, 2) ?? 0n) : 0n;
    const afPay = type === "B02" ? (sourceNumber(source, B02.afPay, 6) ?? 0n) : 0n;
    const afDeduct = type === "B02" ? (sourceNumber(source, B02.afDeduct, 6) ?? 0n) : 0n;
    const afNet = type === "B02" ? (sourceNumber(source, B02.afNet, 6) ?? 0n) : 0n;
    const afReverse = type === "B02"
        ? (record.af_a_reverser_cents !== undefined ? BigInt(record.af_a_reverser_cents) : ((situation === "SO" || situation === "DE") ? afNet : (sourceNumber(source, B02.afReverse, 6) ?? 0n)))
        : 0n;
    const control = type === "B02"
        ? BigInt(cnss) + afReverse + BigInt(days) + real + capped + BigInt(SITUATION_RANK[situation])
        : BigInt(cnss) + BigInt(days) + real + capped;
    if (type === "B02" && (situation === "CS" || situation === "MS") && (days !== 0 || real !== 0n || capped !== 0n)) {
        throw new Error("INVALID_BDS_SITUATION_VALUES");
    }
    if (type === "B02" && situation === "" && days === 0 && (real !== 0n || capped !== 0n)) {
        throw new Error("INVALID_BDS_DAYS");
    }
    return { ...record, cnss_immatriculation: cnss, children, af_a_payer_cents: afPay, af_a_deduire_cents: afDeduct, af_net_a_payer_cents: afNet, af_a_reverser_cents: afReverse, days_worked: BigInt(days), salary_real_cents: real, salary_plaf_cents: capped, cnss_number_value: BigInt(cnss), control };
}

function buildB02(record, source, context) {
    const situation = normalizeSituation(record.bds_situation);
    const reverse = BigInt(record.af_a_reverser_cents);
    return "B02" + source.slice(3, 105)
        + numberValue(reverse, 6)
        + numberValue(record.days_worked, 2)
        + numberValue(record.salary_real_cents, 13)
        + numberValue(record.salary_plaf_cents, 9)
        + text(situation, 2)
        + numberValue(record.control, 19)
        + " ".repeat(104);
}

function buildB04(record, context) {
    const cnss = record.cnss_immatriculation || "000000000";
    return "B04" + digits(context.affiliation, 7) + digits(context.period, 6)
        + digits(cnss, 9) + text(record.employeeName, 60) + text(record.cin, 8)
        + numberValue(record.days_worked, 2) + numberValue(record.salary_real_cents, 13)
        + numberValue(record.salary_plaf_cents, 9) + numberValue(record.control, 19) + " ".repeat(124);
}

function emptyB04(context) {
    return "B04" + digits(context.affiliation, 7) + digits(context.period, 6)
        + " ".repeat(9 + 60 + 8) + "00" + "0".repeat(13 + 9 + 19) + " ".repeat(124);
}

function sum(records, field) { return records.reduce((total, record) => total + BigInt(record[field] || 0), 0n); }

function buildB03(records, context) {
    return "B03" + digits(context.affiliation, 7) + digits(context.period, 6)
        + numberValue(records.length, 6) + numberValue(sum(records, "children"), 6)
        + numberValue(sum(records, "af_a_payer_cents"), 12) + numberValue(sum(records, "af_a_deduire_cents"), 12)
        + numberValue(sum(records, "af_net_a_payer_cents"), 12) + numberValue(sum(records, "cnss_number_value"), 15)
        + numberValue(sum(records, "af_a_reverser_cents"), 12) + numberValue(sum(records, "days_worked"), 6)
        + numberValue(sum(records, "salary_real_cents"), 15) + numberValue(sum(records, "salary_plaf_cents"), 13)
        + numberValue(sum(records, "control"), 19) + " ".repeat(116);
}

function buildB05(records, context) {
    return "B05" + digits(context.affiliation, 7) + digits(context.period, 6)
        + numberValue(records.length, 6) + numberValue(sum(records, "cnss_number_value"), 15)
        + numberValue(sum(records, "days_worked"), 6) + numberValue(sum(records, "salary_real_cents"), 15)
        + numberValue(sum(records, "salary_plaf_cents"), 13) + numberValue(sum(records, "control"), 19) + " ".repeat(170);
}

function buildB06(preEstablished, entrants, context) {
    return buildB05([...preEstablished, ...entrants], context).replace(/^B05/, "B06");
}

export function generateCnssBdsFile(templateFile, payrollData, options = {}) {
    const template = parseTemplate(templateFile);
    const affiliation = template.b01.slice(3, 10);
    const period = template.b01.slice(10, 16);
    if (!/^\d{7}$/.test(affiliation)) throw new Error("INVALID_BDS_AFFILIATION");
    if (!/^\d{6}$/.test(period)) throw new Error("INVALID_BDS_PERIOD");
    if (options.affiliation !== undefined && String(options.affiliation).trim() !== affiliation) {
        throw new Error("BDS_COMPANY_AFFILIATION_MISMATCH");
    }
    if (options.period !== undefined && String(options.period).trim() !== period) {
        throw new Error("BDS_TEMPLATE_PERIOD_MISMATCH");
    }
    const context = { affiliation, period, salaryCeilingCents: BigInt(options.salaryCeilingCents ?? 600000) };
    const excludedPreEstablishedCnss = new Set((options.excludedPreEstablishedCnss || []).map(value => String(value).trim()));
    const records = Array.isArray(payrollData) ? payrollData : [];
    const payrollByCnss = new Map();
    for (const record of records) {
        if (!record || typeof record !== "object") throw new Error("INVALID_BDS_PAYROLL_RECORD");
        const cnss = String(record.cnss_immatriculation || "").trim();
        if (!/^\d{9}$/.test(cnss)) throw new Error("INVALID_BDS_CNSS_NUMBER");
        if (payrollByCnss.has(cnss)) throw new Error("DUPLICATE_BDS_PAYROLL_CNSS_NUMBER");
        payrollByCnss.set(cnss, record);
    }
    const preEstablished = [];
    const knownCnss = new Set(template.byCnss.keys());
    for (const [cnss, source] of template.byCnss) {
        const record = payrollByCnss.get(cnss);
        if (!record) {
            if (excludedPreEstablishedCnss.has(cnss)) continue;
            throw new Error(`BDS_PREESTABLISHED_EMPLOYEE_MISSING:${cnss}`);
        }
        preEstablished.push(calculateSummary(record, source, context, "B02"));
    }
    preEstablished.sort((a, b) => a.cnss_immatriculation.localeCompare(b.cnss_immatriculation));
    const entrants = [...payrollByCnss.values()]
        .filter(record => !knownCnss.has(String(record.cnss_immatriculation)))
        .map(record => calculateSummary(record, null, context, "B04"))
        .sort((a, b) => a.cnss_immatriculation.localeCompare(b.cnss_immatriculation));
    const lines = [
        buildB00(template.b00),
        buildB01(template.b01),
        ...preEstablished.map(record => buildB02(record, template.byCnss.get(record.cnss_immatriculation), context)),
        buildB03(preEstablished, context),
        ...(entrants.length ? entrants.map(record => buildB04(record, context)) : [emptyB04(context)]),
        buildB05(entrants, context),
        buildB06(preEstablished, entrants, context),
    ];
    if (lines.some(line => line.length !== RECORD_LENGTH)) throw new Error("INVALID_BDS_RECORD_LENGTH");
    return lines.join("\r\n") + "\r\n";
}

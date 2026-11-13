import PDFDocument from "pdfkit";

const COLORS = { navy: "#173B57", teal: "#0F766E", ink: "#243746", muted: "#617486", pale: "#F4F8FA", mint: "#EAF5F3", border: "#C9D7DE", white: "#FFFFFF" };
const money = value => value === null || value === undefined || value === "" ? "" : Number(value || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const period = book => `${String(book.month).padStart(2, "0")}/${book.year}`;
const date = value => value ? new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }) : "";

const columns = [
    { top: "N°", bottom: "", width: 25, key: "numero" },
    { top: "NOM & PRÉNOM", bottom: "N° CNSS", width: 76, keys: ["nomPrenom", "numeroCNSS"], left: true },
    { top: "EMPLOI", bottom: "TX HR", width: 48, keys: ["emploi", "tauxHoraire"], left: true, rates: [false, true] },
    { top: "DT. NAIS.", bottom: "EMBAUCH.", width: 43, keys: ["dateNaissance", "dateEmbauche"], dates: true },
    { top: "S", bottom: "F", width: 26, keys: ["situationFamiliale", "enfants"] },
    { top: "H.N", bottom: "NBR. JR. CHOM.", width: 42, keys: ["heuresNormales", "joursChomage"] },
    { top: "HS 25%", bottom: "REMB. MUT.", width: 39, keys: ["hs25", "remboursementMutuelle"] },
    { top: "HS 50%", bottom: "AVANCE AC.", width: 39, keys: ["hs50", "avanceAc"] },
    { top: "HS 100%", bottom: "IND. DIVERS", width: 41, keys: ["hs100", "indemniteDivers"] },
    { top: "JR", bottom: "PLF CNS", width: 32, keys: ["jours", "plfCns"] },
    { top: "JR CONG.", bottom: "MONTANT", width: 39, keys: ["joursConge", "montantConge"] },
    { top: "SAL. BASE", bottom: "MT. ANC.", width: 43, keys: ["salaireBase", "anciennete"] },
    { top: "ANC %", bottom: "IPE", width: 33, keys: ["ancienneteRate", "ipe"], rates: [true, false] },
    { top: "PRIMES", bottom: "I.R.", width: 38, keys: ["primesImposables", "ir"] },
    { top: "TAHFIZ", bottom: "CNSS", width: 37, keys: ["tahfiz", "cnss"] },
    { top: "SAL. BRUT", bottom: "IND. N. IMP", width: 43, keys: ["salaireBrut", "primesNonImposables"], emphasis: true },
    { top: "RETRAITE", bottom: "AVANCES", width: 42, keys: ["retraite", "avances"] },
    { top: "MUTUELLE", bottom: "AMO (CSS)", width: 42, keys: ["mutuelle", "amo"] },
    { top: "SL IMP", bottom: "PAYE NET", width: 43, keys: ["salaireNetImposable", "net"], emphasis: true },
];

function rawValue(row, column, index) {
    if (column.key) return row[column.key];
    if (!column.keys) return "";
    const key = column.keys[index];
    if (!key || row[key] === null || row[key] === undefined) return "";
    if (column.dates) return date(row[key]);
    if (column.rates?.[index]) return `${Number(row[key] || 0).toLocaleString("fr-MA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    if (typeof row[key] === "string") return row[key];
    return money(row[key]);
}

function renderValue(doc, value, x, y, width, height, options = {}) {
    const align = options.left ? "left" : "right";
    doc.font(options.total || options.emphasis ? "Helvetica-Bold" : "Helvetica").fontSize(4.8).fillColor(options.topColor || COLORS.ink)
        .text(String(value.top ?? ""), x + 2, y + 3, { width: width - 4, height: 8, align, ellipsis: true, lineBreak: false });
    doc.moveTo(x + 1, y + 13).lineTo(x + width - 1, y + 13).lineWidth(0.25).strokeColor(COLORS.border).stroke();
    doc.font(options.total ? "Helvetica-Bold" : "Helvetica").fontSize(4.3).fillColor(options.topColor === COLORS.white ? "#CFE2E8" : COLORS.muted)
        .text(String(value.bottom ?? ""), x + 2, y + 15, { width: width - 4, height: 7, align, ellipsis: true, lineBreak: false });
}

export function generatePayrollBookPdf(book, response) {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 28, info: { Title: `Livre de paie ${period(book)}`, Author: book.company.name || "Enmae Paie" } });
    doc.pipe(response);
    const left = 28;
    const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const pageSize = 12;
    const pageCount = Math.max(1, Math.ceil(book.rows.length / pageSize));
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        if (pageIndex) doc.addPage({ size: "A4", layout: "landscape", margin: 28 });
        const rows = book.rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
        const companyName = String(book.company.name || "Entreprise").toUpperCase();
        doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.navy).text(companyName, left, 24, { width: 260, ellipsis: true });
        doc.font("Helvetica").fontSize(6).fillColor(COLORS.muted).text([book.company.adresse, book.company.ville].filter(Boolean).join(" · ") || "", left, 39, { width: 260, ellipsis: true });
        doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.navy).text("LIVRE DE PAIE", left + 260, 24, { width: tableWidth - 260, align: "center" });
        doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.teal).text(`PÉRIODE · ${period(book)}`, left + 260, 43, { width: tableWidth - 260, align: "center" });
        doc.font("Helvetica").fontSize(6).fillColor(COLORS.muted).text(`Page ${pageIndex + 1}/${pageCount}`, left + tableWidth - 60, 25, { width: 60, align: "right" });

        const headerY = 65, headerHeight = 28, rowHeight = 29;
        let x = left;
        for (const column of columns) {
            doc.rect(x, headerY, column.width, headerHeight).fillAndStroke(COLORS.navy, COLORS.navy);
            renderValue(doc, { top: column.top, bottom: column.bottom }, x, headerY, column.width, headerHeight, { total: true, topColor: COLORS.white });
            x += column.width;
        }
        rows.forEach((row, rowIndex) => {
            const y = headerY + headerHeight + rowIndex * rowHeight;
            x = left;
            columns.forEach(column => {
                doc.rect(x, y, column.width, rowHeight).fillAndStroke(rowIndex % 2 ? COLORS.pale : COLORS.white, COLORS.border);
                renderValue(doc, { top: rawValue(row, column, 0), bottom: rawValue(row, column, 1) }, x, y, column.width, rowHeight, { left: column.left, emphasis: column.emphasis });
                x += column.width;
            });
        });
        if (pageIndex === pageCount - 1) {
        const total = book.totals;
        const totalRow = { numero: "TOTAL", nomPrenom: `${book.rows.length} salarié(s)`, heuresNormales: total.heuresNormales,
            hs25: total.hs25, hs50: total.hs50, hs100: total.hs100, jours: total.jours, joursConge: total.joursConge,
            montantConge: total.montantConge, plfCns: total.plfCns, salaireBase: total.salaireBase, anciennete: total.anciennete,
            primesImposables: total.primesImposables, ir: total.ir, cnss: total.cnss, salaireBrut: total.salaireBrut,
            primesNonImposables: total.primesNonImposables, retraite: total.retraite, avances: total.avances,
            mutuelle: total.mutuelle, amo: total.amo, salaireNetImposable: total.salaireNetImposable, net: total.net };
        const totalY = headerY + headerHeight + rows.length * rowHeight;
        x = left;
        columns.forEach(column => {
            doc.rect(x, totalY, column.width, rowHeight).fillAndStroke(COLORS.mint, COLORS.border);
            renderValue(doc, { top: rawValue(totalRow, column, 0), bottom: rawValue(totalRow, column, 1) }, x, totalY, column.width, rowHeight, { total: true, left: column.left, emphasis: column.emphasis });
            x += column.width;
        });
        }
        doc.font("Helvetica").fontSize(6).fillColor(COLORS.muted).text("Valeurs reprises des bulletins enregistrés. Les champs sans donnée source restent vides.", left, 565, { width: tableWidth });
    }
    doc.end();
    return doc;
}

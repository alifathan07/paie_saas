import PDFDocument from "pdfkit";

const COLORS = {
    navy: "#173B57",
    teal: "#0F766E",
    ink: "#243746",
    muted: "#617486",
    pale: "#F4F8FA",
    mint: "#EAF5F3",
    border: "#C9D7DE",
    white: "#FFFFFF",
};

const money = value => Number(value || 0).toLocaleString("fr-MA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const period = report => `${String(report.month).padStart(2, "0")}/${String(report.year).slice(-2)}`;

function drawFooter(doc, report, pageNumber, pageCount) {
    // Stay inside PDFKit's bottom margin. Writing at the physical page edge
    // makes PDFKit create an unexpected extra page when auto page breaks are on.
    const y = doc.page.height - 55;
    doc.moveTo(34, y - 7).lineTo(doc.page.width - 34, y - 7)
        .lineWidth(0.6).strokeColor(COLORS.border).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(COLORS.muted)
        .text(`États mensuels CNSS / AMO · ${report.company.name}`, 34, y, { width: 330 });
    doc.text(`Page ${pageNumber} / ${pageCount}`, doc.page.width - 150, y, { width: 116, align: "right" });
}

function drawHeader(doc, report, title) {
    const left = 34;
    const width = doc.page.width - 68;
    doc.roundedRect(left, 24, width, 55, 7)
        .fill(COLORS.mint).strokeColor(COLORS.border).lineWidth(0.7).stroke();
    doc.font("Helvetica-Bold").fontSize(13).fillColor(COLORS.navy)
        .text(report.company.name || "Entreprise", left + 15, 39, { width: width * 0.55, ellipsis: true });
    doc.font("Helvetica").fontSize(8).fillColor(COLORS.muted)
        .text(`N° CNSS : ${report.company.numeroAffiliationCnss || "—"}`, left + width - 190, 38, { width: 175, align: "right" })
        .text(`Généré le : ${new Date(report.generatedAt || Date.now()).toLocaleDateString("fr-FR")}`, left + width - 190, 52, { width: 175, align: "right" });
    doc.font("Helvetica-Bold").fontSize(16).fillColor(COLORS.navy)
        .text(title, left, 98, { width, align: "center" });
}

function drawTable(doc, { x, y, widths, headers, rows, headerHeight = 30, rowHeight = 22, totalRow = false }) {
    let cx = x;
    headers.forEach((header, index) => {
        doc.rect(cx, y, widths[index], headerHeight).fillAndStroke(COLORS.navy, COLORS.navy);
        doc.font("Helvetica-Bold").fontSize(6.2).fillColor(COLORS.white)
            .text(header, cx + 4, y + 5, {
                width: widths[index] - 8,
                height: headerHeight - 8,
                align: index > 3 ? "right" : "left",
                lineBreak: true,
                ellipsis: true,
            });
        cx += widths[index];
    });
    rows.forEach((row, rowIndex) => {
        let rx = x;
        const isTotal = totalRow && rowIndex === rows.length - 1;
        const fill = isTotal ? COLORS.mint : (rowIndex % 2 ? COLORS.pale : COLORS.white);
        row.forEach((value, index) => {
            doc.rect(rx, y + headerHeight + rowIndex * rowHeight, widths[index], rowHeight)
                .fill(fill).strokeColor(COLORS.border).lineWidth(0.55).stroke();
            doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(7.1).fillColor(COLORS.ink)
                .text(String(value ?? ""), rx + 4, y + headerHeight + rowIndex * rowHeight + 7, {
                    width: widths[index] - 8,
                    height: rowHeight - 7,
                    align: index > 3 ? "right" : "left",
                    lineBreak: false,
                    ellipsis: true,
                });
            rx += widths[index];
        });
    });
    return y + headerHeight + rows.length * rowHeight;
}

function detailRow(row) {
    return [row.matricule, row.nomPrenom, row.cin, row.numeroCNSS, money(row.jours),
        row.jrCg ? money(row.jrCg) : "", money(row.totalJours), money(row.sansLimitePlafonne),
        money(row.dansLimitePlafonne), money(row.retenuSal), money(row.allocFam),
        money(row.prestations), money(row.formation), money(row.cotisTot)];
}

export function generateContributionReportsPdf(report, response) {
    const detailWidths = [42, 132, 50, 60, 34, 34, 36, 58, 58, 52, 54, 54, 54, 55];
    const detailHeaders = ["MLE", "NOM & PRENOM", "CIN", "N° CNSS", "JOURS", "JR CG", "T. JRS",
        "SANS LIMITE\nPLAFONNE", "DANS LIMITE\nPLAFONNE", "RETENU SAL.\n4.48 %", "ALLOC. FAM.\n6.40 %",
        "PREST. PAT.\n8.98 %", "FORMAT. PROF.\n1.60 %", "COTIS.TOT."];
    const detailRows = report.rows.map(detailRow);
    const total = ["", "TOTAL", "", "", money(report.cnssTotals.jours), money(report.cnssTotals.jrCg),
        money(report.cnssTotals.totalJours), money(report.cnssTotals.sansLimitePlafonne),
        money(report.cnssTotals.dansLimitePlafonne), money(report.cnssTotals.retenuSal),
        money(report.cnssTotals.allocFam), money(report.cnssTotals.prestations), money(report.cnssTotals.formation),
        money(report.cnssTotals.cotisTot)];
    // Keep the last data row clear of the footer on landscape A4.
    const detailPageSize = 16;
    const detailPageCount = Math.max(1, Math.ceil(detailRows.length / detailPageSize));
    const pageCount = detailPageCount + 1;
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34, info: { Title: "États CNSS / AMO" } });
    doc.pipe(response);

    for (let pageIndex = 0; pageIndex < detailPageCount; pageIndex += 1) {
        if (pageIndex) doc.addPage({ size: "A4", layout: "landscape", margin: 34 });
        drawHeader(doc, report, `ÉTAT CNSS ${period(report)}`);
        const chunk = detailRows.slice(pageIndex * detailPageSize, (pageIndex + 1) * detailPageSize);
        if (pageIndex === detailPageCount - 1) chunk.push(total);
        drawTable(doc, { x: 34, y: 128, widths: detailWidths, headers: detailHeaders, rows: chunk, totalRow: pageIndex === detailPageCount - 1 });
        drawFooter(doc, report, pageIndex + 1, pageCount);
    }

    doc.addPage({ size: "A4", layout: "portrait", margin: 40 });
    drawHeader(doc, report, `ÉTAT DES VIREMENTS CNSS ${period(report)}`);
    drawTable(doc, {
        x: 40, y: 132, widths: [250, 125, 65, 95],
        headers: ["NATURE DES PRESTATIONS", "MASSE SALARIALE", "TAUX", "MONTANT"],
        rows: [
            ["ALLOCATION FAMILIALE", money(report.cnssTotals.sansLimitePlafonne), "6.40 %", money(report.transfer.allocation)],
            ["PRESTATIONS SOCIALES", money(report.cnssTotals.dansLimitePlafonne), "13.46 %", money(report.transfer.prestations)],
            ["TAXE FORMATION PROF.", money(report.cnssTotals.sansLimitePlafonne), "1.60 %", money(report.transfer.formation)],
            ["TOTAL", "", "", money(report.transfer.total)],
        ], totalRow: true,
    });
    const boxY = 280;
    doc.roundedRect(40, boxY, 495, 112, 6).fill(COLORS.pale).strokeColor(COLORS.border).lineWidth(0.7).stroke();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.navy).text("RÉCAPITULATION DES COTISATIONS", 57, boxY + 18);
    const recap = [["COTISATIONS SALARIALES", report.transfer.salariales], ["COTISATIONS PATRONALES", report.transfer.patronales], ["TOTAL", report.transfer.total]];
    recap.forEach(([label, value], index) => {
        const y = boxY + 48 + index * 21;
        if (index === 2) doc.moveTo(57, y - 6).lineTo(518, y - 6).lineWidth(0.6).strokeColor(COLORS.border).stroke();
        doc.font(index === 2 ? "Helvetica-Bold" : "Helvetica").fontSize(index === 2 ? 9.5 : 9).fillColor(index === 2 ? COLORS.teal : COLORS.ink)
            .text(label, 57, y, { width: 260 });
        doc.text(money(value), 390, y, { width: 125, align: "right" });
    });
    drawFooter(doc, report, pageCount, pageCount);
    doc.end();
}

export function generateAmoReportPdf(report, response) {
    const amoDetailWidths = [38, 103, 45, 54, 30, 30, 35, 56, 76, 76, 76, 55];
    const amoDetailHeaders = ["MLE", "NOM & PRENOM", "CIN", "N° CNSS", "JOURS", "JR CG", "T. JRS",
        "SANS LIMITE\nPLAFONNE", "PARTICIPATION AMO\nPAR PERSONNE",
        "COTISATIONS\nSALARIALES", "COTISATIONS\nPATRONALES", "COTIS.TOT."];
    const amoDetailRows = report.rows.map(row => [row.matricule, row.nomPrenom, row.cin, row.numeroCNSS,
        money(row.jours), row.jrCg ? money(row.jrCg) : "", money(row.totalJours), money(row.sansLimitePlafonne),
        money(row.amoParticipation), money(row.amoSalariale),
        money(row.amoPatronale), money(row.amoCotisTot)]);
    const amoTotal = ["", "TOTAL", "", "", money(report.cnssTotals.jours), money(report.cnssTotals.jrCg),
        money(report.cnssTotals.totalJours), money(report.amoTotals.masse),
        money(report.amoTotals.participation), money(report.amoTotals.salariales), money(report.amoTotals.patronales),
        money(report.amoTotals.cotisTot)];
    const detailPageSize = 16;
    const detailPageCount = Math.max(1, Math.ceil(amoDetailRows.length / detailPageSize));
    const pageCount = detailPageCount + 1;
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34, info: { Title: "État Mutuelle AMO" } });
    doc.pipe(response);
    for (let pageIndex = 0; pageIndex < detailPageCount; pageIndex += 1) {
        if (pageIndex) doc.addPage({ size: "A4", layout: "landscape", margin: 34 });
        drawHeader(doc, report, `ÉTAT AMO ${period(report)}`);
        const chunk = amoDetailRows.slice(pageIndex * detailPageSize, (pageIndex + 1) * detailPageSize);
        if (pageIndex === detailPageCount - 1) chunk.push(amoTotal);
        drawTable(doc, { x: 34, y: 128, widths: amoDetailWidths, headers: amoDetailHeaders, rows: chunk, totalRow: pageIndex === detailPageCount - 1 });
        drawFooter(doc, report, pageIndex + 1, pageCount);
    }
    doc.addPage({ size: "A4", layout: "portrait", margin: 40 });
    drawHeader(doc, report, `RÉCAPITULATIF AMO ${period(report)}`);
    drawTable(doc, { x: 40, y: 132, widths: [250, 125, 65, 95], headers: ["NATURE", "MASSE SALARIALE", "TAUX", "MONTANT"], rows: [
        ["PARTICIPATION AMO", money(report.amoTotals.masse), "1.85 %", money(report.amoTotals.participation)],
        ["COTISATIONS SALARIALES", money(report.amoTotals.masse), "2.2600 %", money(report.amoTotals.salariales)],
        ["COTISATIONS PATRONALES", money(report.amoTotals.masse), "4.1100 %", money(report.amoTotals.patronales)],
        ["TOTAL COTISATIONS", "", "", money(report.amoTotals.cotisTot)],
    ], totalRow: true });
    drawFooter(doc, report, pageCount, pageCount);
    doc.end();
}

export function generatePayrollJournalPdf(report, response) {
    const widths = [38, 130, 42, 40, 62, 55, 65, 55, 55, 55, 65];
    const headers = ["MLE", "NOM & PRENOM", "NB HR", "JRS", "BRUT", "RETRAITE", "BASE IR", "IR", "CNSS", "MUTUEL.", "NET"];
    const moneyOrBlank = value => value === "" ? "" : money(value);
    const rows = report.rows.map(row => [row.matricule, row.nomPrenom, moneyOrBlank(row.nbHr), money(row.jours),
        money(row.brut), money(row.retraite), money(row.baseIr), money(row.ir), money(row.cnss), money(row.mutuel), money(row.net)]);
    const total = ["", "TOTAL", money(report.totals.nbHr), money(report.totals.jours), money(report.totals.brut),
        money(report.totals.retraite), money(report.totals.baseIr), money(report.totals.ir), money(report.totals.cnss),
        money(report.totals.mutuel), money(report.totals.net)];
    const pageSize = 17;
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34, info: { Title: "Journal de paie" } });
    doc.pipe(response);
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        if (pageIndex) doc.addPage({ size: "A4", layout: "landscape", margin: 34 });
        drawHeader(doc, report, `JOURNAL DE PAIE ${period(report)}`);
        const chunk = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
        if (pageIndex === pageCount - 1) chunk.push(total);
        drawTable(doc, { x: 34, y: 128, widths, headers, rows: chunk, totalRow: pageIndex === pageCount - 1 });
        drawFooter(doc, report, pageIndex + 1, pageCount);
    }
    doc.end();
}

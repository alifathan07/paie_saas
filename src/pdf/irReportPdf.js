import PDFDocument from "pdfkit";

function formatMoney(value) {
    const num = Number(value || 0);
    const parts = num.toFixed(2).split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return parts.join(".");
}

function formatDate(date) {
    const d = date ? new Date(date) : new Date();
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

export function generateIrReportPdf(report, response) {
    const doc = new PDFDocument({
        size: "A4",
        layout: "portrait",
        margins: { top: 25, bottom: 25, left: 28, right: 28 },
        info: {
            Title: `État I.R. Mensuel ${String(report.month).padStart(2, "0")}/${report.year}`,
            Author: "Paie Software",
        },
    });

    if (response) {
        doc.pipe(response);
    }

    const tableX = 28;
    const tableTop = 88;
    const headerHeight = 20;
    const rowStartY = tableTop + headerHeight;
    const totalRowY = 765;
    const tableBottom = 785;
    const tableWidth = 539;
    const rowHeight = 15.5;

    // Columns:
    // MLE: 42, NOM & PRÉNOM: 135, E: 18, NB JR: 38, BRUT+IND.: 60, INDEMNITES: 60, SAL. BRUT: 60, BASE I.R.: 63, I.R.: 63
    const widths = [42, 135, 18, 38, 60, 60, 60, 63, 63];
    const colX = [];
    let currentX = tableX;
    for (let i = 0; i < widths.length; i++) {
        colX.push(currentX);
        currentX += widths[i];
    }
    colX.push(currentX); // right edge (tableX + tableWidth = 567)

    const headers = [
        { text: "MLE", align: "center" },
        { text: "NOM & PRÉNOM", align: "center" },
        { text: "E", align: "center" },
        { text: "NB JR", align: "center" },
        { text: "BRUT+IND.", align: "center" },
        { text: "INDEMNITES", align: "center" },
        { text: "SAL. BRUT", align: "center" },
        { text: "BASE I.R.", align: "center" },
        { text: "I.R.", align: "center" },
    ];

    const pageSize = 40;
    const rows = report.rows || [];
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        if (pageIndex > 0) {
            doc.addPage({
                size: "A4",
                layout: "portrait",
                margins: { top: 25, bottom: 25, left: 28, right: 28 },
            });
        }

        const isLastPage = pageIndex === pageCount - 1;
        const pageRows = rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);

        // --- Top Header ---
        const companyName = (report.company?.name || "ENTREPRISE").toUpperCase();
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#000000")
            .text(companyName, tableX, 28, { width: 300, align: "left" });

        const dateStr = `Date : ${formatDate(report.generatedAt)}`;
        doc.font("Helvetica").fontSize(9).fillColor("#000000")
            .text(dateStr, tableX + tableWidth - 150, 28, { width: 150, align: "right" });

        // Title centered and underlined
        const monthStr = String(report.month).padStart(2, "0");
        const yearShort = String(report.year).slice(-2);
        const titleText = `E T A T   I . R .   M E N S U E L   ${monthStr}/${yearShort}`;
        doc.font("Helvetica-Bold").fontSize(10.5).fillColor("#000000")
            .text(titleText, tableX, 52, { width: tableWidth, align: "center", underline: true });

        // Meta info line: Total effectif and Page N°
        doc.font("Helvetica").fontSize(8.5).fillColor("#000000")
            .text(`Total effectif :     ${report.totals?.effectif || rows.length}`, tableX + 5, 72, { width: 200, align: "left" });
        doc.font("Helvetica").fontSize(8.5).fillColor("#000000")
            .text(`Page N° :           ${pageIndex + 1}`, tableX + tableWidth - 120, 72, { width: 120, align: "right" });

        // --- Table Outer Border ---
        doc.lineWidth(0.7).strokeColor("#000000")
            .rect(tableX, tableTop, tableWidth, tableBottom - tableTop).stroke();

        // --- Table Header ---
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i];
            doc.font("Helvetica").fontSize(7.5).fillColor("#000000")
                .text(h.text, colX[i], tableTop + 6, {
                    width: widths[i],
                    align: h.align,
                    ellipsis: true,
                });
        }
        // Solid line below header
        doc.lineWidth(0.7).strokeColor("#000000")
            .moveTo(tableX, rowStartY).lineTo(tableX + tableWidth, rowStartY).stroke();

        // --- Data Rows ---
        for (let r = 0; r < pageRows.length; r++) {
            const row = pageRows[r];
            const currentY = rowStartY + r * rowHeight;
            const textY = currentY + 3.5;

            doc.font("Helvetica").fontSize(7.2).fillColor("#000000");

            // MLE
            doc.text(String(row.matricule || ""), colX[0] + 3, textY, { width: widths[0] - 6, align: "left" });
            // NOM & PRÉNOM
            doc.text(String(row.nomPrenom || ""), colX[1] + 4, textY, { width: widths[1] - 8, align: "left", ellipsis: true });
            // E
            if (row.enfants !== undefined && row.enfants !== null && row.enfants !== "") {
                doc.text(String(row.enfants), colX[2], textY, { width: widths[2], align: "center" });
            }
            // NB JR
            doc.text(Number(row.jours || 0).toFixed(1), colX[3], textY, { width: widths[3] - 4, align: "right" });
            // BRUT+IND.
            doc.text(formatMoney(row.brutInd), colX[4], textY, { width: widths[4] - 4, align: "right" });
            // INDEMNITES
            if (Number(row.indemnites || 0) > 0) {
                doc.text(formatMoney(row.indemnites), colX[5], textY, { width: widths[5] - 4, align: "right" });
            }
            // SAL. BRUT
            doc.text(formatMoney(row.salBrut), colX[6], textY, { width: widths[6] - 4, align: "right" });
            // BASE I.R.
            doc.text(formatMoney(row.baseIr), colX[7], textY, { width: widths[7] - 4, align: "right" });
            // I.R.
            if (Number(row.ir || 0) > 0) {
                doc.text(formatMoney(row.ir), colX[8], textY, { width: widths[8] - 4, align: "right" });
            }

            // Dashed horizontal line below row
            doc.save()
                .dash(2, { space: 2 })
                .lineWidth(0.4)
                .strokeColor("#444444")
                .moveTo(tableX, currentY + rowHeight)
                .lineTo(tableX + tableWidth, currentY + rowHeight)
                .stroke()
                .restore();
        }

        // --- Vertical Separators (run from header to totalRowY) ---
        doc.lineWidth(0.6).strokeColor("#000000");
        for (let i = 1; i < colX.length - 1; i++) {
            doc.moveTo(colX[i], tableTop).lineTo(colX[i], totalRowY).stroke();
        }

        // --- Bottom TOTAL Row ---
        // Solid horizontal line above TOTAL row
        doc.lineWidth(0.7).strokeColor("#000000")
            .moveTo(tableX, totalRowY).lineTo(tableX + tableWidth, totalRowY).stroke();

        // Vertical lines within the TOTAL row
        for (let i = 3; i < colX.length - 1; i++) {
            doc.moveTo(colX[i], totalRowY).lineTo(colX[i], tableBottom).stroke();
        }

        if (isLastPage) {
            const totalTextY = totalRowY + 5;
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");

            // T O T A L spanning columns 0, 1, 2 (width = widths[0] + widths[1] + widths[2])
            const labelWidth = widths[0] + widths[1] + widths[2];
            doc.text("T O T A L", tableX, totalTextY, { width: labelWidth, align: "center" });

            // NB JR
            doc.text(Number(report.totals?.jours || 0).toFixed(1), colX[3], totalTextY, { width: widths[3] - 4, align: "right" });
            // BRUT+IND.
            doc.text(formatMoney(report.totals?.brutInd), colX[4], totalTextY, { width: widths[4] - 4, align: "right" });
            // INDEMNITES
            doc.text(formatMoney(report.totals?.indemnites), colX[5], totalTextY, { width: widths[5] - 4, align: "right" });
            // SAL. BRUT
            doc.text(formatMoney(report.totals?.salBrut), colX[6], totalTextY, { width: widths[6] - 4, align: "right" });
            // BASE I.R.
            doc.text(formatMoney(report.totals?.baseIr), colX[7], totalTextY, { width: widths[7] - 4, align: "right" });
            // I.R.
            doc.text(formatMoney(report.totals?.ir), colX[8], totalTextY, { width: widths[8] - 4, align: "right" });
        } else {
            const reportTextY = totalRowY + 5;
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#000000");
            const labelWidth = widths[0] + widths[1] + widths[2];
            doc.text("A   R E P O R T E R", tableX, reportTextY, { width: labelWidth, align: "center" });
        }
    }

    doc.end();
    return doc;
}

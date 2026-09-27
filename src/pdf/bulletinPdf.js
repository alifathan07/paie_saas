import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------------------
// Named Layout Constants (A4 page size: 595.28 x 841.89 points)
// ---------------------------------------------------------------------------
const MARGIN_LEFT = 40;
const MARGIN_RIGHT = 40;
const PAGE_WIDTH = 595.28;
const PRINTABLE_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 515.28 pt

// Table Column Boundaries & Widths
const COL_DESIGNATION_X = 45;
const COL_DESIGNATION_W = 210;

const COL_BASE_X = 260;
const COL_BASE_W = 80;

const COL_TAUX_X = 345;
const COL_TAUX_W = 55;

const COL_GAINS_X = 405;
const COL_GAINS_W = 75;

const COL_RETENUES_X = 485;
const COL_RETENUES_W = 65;

const ROW_HEIGHT = 19;
const TABLE_HEADER_HEIGHT = 22;

// Brand & Theme Colors (Matching Reference Image EXACTLY)
const TEAL_PRIMARY = '#169a72';
const MINT_BG = '#e8f4f1';
const MINT_BORDER = '#b2dfdb';
const GRAY_LIGHT = '#f4f6f8';
const GRAY_BORDER = '#d0d7de';
const TEXT_DARK = '#1a202c';
const TEXT_MUTED = '#4a5568';

function fmt(n) {
    return Number(n || 0).toLocaleString('fr-MA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }) + ' DH';
}

function fmtNum(n) {
    return Number(n || 0).toLocaleString('fr-MA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

/**
 * Generates a PDF stream using PDFKit for a saved bulletin.
 * Uses running Y-cursor pattern for all table rows and sections.
 *
 * @param {Object} data Bulletin calculation data + employee details
 * @param {WritableStream} outputStream Express response or file writable stream
 */
export function generateBulletinPdf(data, outputStream) {
    const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
            Title: `Bulletin de Paie - ${data.employeeName} - ${data.monthName} ${data.year}`,
            Author: 'Paie Software',
        },
    });

    doc.pipe(outputStream);

    // -----------------------------------------------------------------------
    // 1. HEADER BLOCK (Top of Page)
    // -----------------------------------------------------------------------
    let y = 40;

    // Left Side: Company Branding
    doc.fontSize(16).font('Helvetica-Bold').fillColor(TEXT_DARK)
        .text(data.companyName || 'CONFONDA', MARGIN_LEFT, y);
    
    y += 18;
    doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_MUTED)
        .text(data.companyAddress || 'hay sikaktyne', MARGIN_LEFT, y);
    
    y += 12;
    doc.text(`N° CNSS : ${data.companyCNSS || '5646554654'}`, MARGIN_LEFT, y);
    
    y += 12;
    doc.text(`IF : ${data.companyIF || '565653486+531564515645241563165116231311'} | ICE : ${data.companyICE || '120521852812821'}`, MARGIN_LEFT, y);

    // Right Side: Document Title & Metadata
    const rightX = 350;
    const rightW = PAGE_WIDTH - MARGIN_RIGHT - rightX;

    doc.fontSize(16).font('Helvetica-Bold').fillColor(TEAL_PRIMARY)
        .text('BULLETIN DE PAIE', rightX, 40, { width: rightW, align: 'right' });

    doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_MUTED);
    doc.text(`Période : ${data.monthName} ${data.year}`, rightX, 60, { width: rightW, align: 'right' });
    doc.text(`Date de paiement : ${data.paymentDate || `${data.year}-${String(data.month).padStart(2, '0')}-25`}`, rightX, 72, { width: rightW, align: 'right' });
    doc.text(`Méthode : ${data.paymentMethod || 'Virement'}`, rightX, 84, { width: rightW, align: 'right' });

    y = 110;

    // -----------------------------------------------------------------------
    // 2. EMPLOYEE BLOCK (Mint Box)
    // -----------------------------------------------------------------------
    const empBoxHeight = 52;
    doc.roundedRect(MARGIN_LEFT, y, PRINTABLE_WIDTH, empBoxHeight, 4)
        .fillAndStroke(MINT_BG, MINT_BORDER);

    const empY = y + 10;
    // Left column
    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(TEXT_DARK)
        .text(`Salarié : ${data.employeeName}`, MARGIN_LEFT + 15, empY);
    
    doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_MUTED);
    doc.text(`Emploi : ${data.employeeFonction || '—'}`, MARGIN_LEFT + 15, empY + 14);
    doc.text(`Matricule : ${data.employeeMatricule || '—'}`, MARGIN_LEFT + 15, empY + 26);

    // Right column
    const empRightX = MARGIN_LEFT + 270;
    doc.text(`N° CNSS : ${data.employeeCNSS || '—'}`, empRightX, empY + 14);
    doc.text(`Ancienneté : ${data.seniorityYears || 0} an(s)`, empRightX, empY + 26);

    y += empBoxHeight + 20;

    // -----------------------------------------------------------------------
    // 3. MAIN TABLE HEADER
    // -----------------------------------------------------------------------
    doc.rect(MARGIN_LEFT, y, PRINTABLE_WIDTH, TABLE_HEADER_HEIGHT)
        .fill(TEAL_PRIMARY);

    const thY = y + 6;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
    doc.text('Désignation', COL_DESIGNATION_X, thY, { width: COL_DESIGNATION_W, align: 'left' });
    doc.text('Base', COL_BASE_X, thY, { width: COL_BASE_W, align: 'right' });
    doc.text('Taux', COL_TAUX_X, thY, { width: COL_TAUX_W, align: 'right' });
    doc.text('Gains', COL_GAINS_X, thY, { width: COL_GAINS_W, align: 'right' });
    doc.text('Retenues', COL_RETENUES_X, thY, { width: COL_RETENUES_W, align: 'right' });

    y += TABLE_HEADER_HEIGHT;
    const tableBodyStartY = y;

    // Helper for adding a dynamic table row
    let totalGains = 0;
    let totalRetenues = 0;
    let rowCount = 0;

    function addTableRow(designation, baseStr, tauxStr, gainsNum, retenuesNum, options = {}) {
        const rowY = y;
        
        // Alternate subtle row background or line
        if (rowCount % 2 === 1) {
            doc.rect(MARGIN_LEFT, rowY, PRINTABLE_WIDTH, ROW_HEIGHT).fill('#fafcfc');
        }

        doc.fontSize(8.5).font(options.font || 'Helvetica').fillColor(options.color || TEXT_DARK);
        
        doc.text(designation, COL_DESIGNATION_X, rowY + 5, { width: COL_DESIGNATION_W, align: 'left' });
        doc.text(baseStr || '', COL_BASE_X, rowY + 5, { width: COL_BASE_W, align: 'right' });
        doc.text(tauxStr || '', COL_TAUX_X, rowY + 5, { width: COL_TAUX_W, align: 'right' });
        
        if (gainsNum !== null && gainsNum !== undefined && gainsNum > 0) {
            doc.text(fmt(gainsNum), COL_GAINS_X, rowY + 5, { width: COL_GAINS_W, align: 'right' });
            if (!options.excludeFromTotal) totalGains += Number(gainsNum);
        }

        if (retenuesNum !== null && retenuesNum !== undefined && retenuesNum > 0) {
            const retStr = options.isParens ? `(${fmt(retenuesNum)})` : fmt(retenuesNum);
            doc.text(retStr, COL_RETENUES_X, rowY + 5, { width: COL_RETENUES_W, align: 'right' });
            if (!options.excludeFromTotal) totalRetenues += Number(retenuesNum);
        }

        // Bottom border for each row
        doc.moveTo(MARGIN_LEFT, rowY + ROW_HEIGHT)
           .lineTo(MARGIN_LEFT + PRINTABLE_WIDTH, rowY + ROW_HEIGHT)
           .strokeColor('#e5eceb')
           .lineWidth(0.5)
           .stroke();

        y += ROW_HEIGHT;
        rowCount++;
    }

    // -----------------------------------------------------------------------
    // 4. ITEMIZED TABLE ROWS (Exact Order Required)
    // -----------------------------------------------------------------------

    // 1. Salaire de Base (Always)
    const baseSal = Number(data.baseSalary || 0);
    addTableRow('Salaire de Base', fmt(baseSal), '', baseSal, null);

    // 2. Primes imposables (One row per named prime)
    if (data.variablePrimes && data.variablePrimes.length > 0) {
        data.variablePrimes.forEach(p => {
            if (p.amount > 0) {
                addTableRow(p.label || 'Prime imposable', '', '', p.amount, null);
            }
        });
    }

    // 3. Heures supplémentaires (One row per rate used)
    if (data.hs25Amount > 0) {
        addTableRow(`Heures sup. 25% (${data.heuresSup25} h)`, '', '25,00%', data.hs25Amount, null);
    }
    if (data.hs50Amount > 0) {
        addTableRow(`Heures sup. 50% (${data.heuresSup50} h)`, '', '50,00%', data.hs50Amount, null);
    }
    if (data.hs100Amount > 0) {
        addTableRow(`Heures sup. 100% (${data.heuresSup100} h)`, '', '100,00%', data.hs100Amount, null);
    }

    // 4. Prime d'ancienneté (Always if > 0)
    if (data.primeAnciennete > 0) {
        addTableRow("Prime d'ancienneté", '', '', data.primeAnciennete, null);
    }

    // 5. Retenue CNSS (Base = capped SBI, max 6000)
    const cnssBase = Math.min(data.sbi, 6000);
    addTableRow('Retenue CNSS', fmt(cnssBase), '4,48%', null, data.cnss);

    // 7. Retenue AMO (Base = SBI, uncapped)
    addTableRow('Retenue AMO', fmt(data.sbi), '2,26%', null, data.amo);

    // 7b. Retenue CIMR (If cimr > 0)
    if (data.cimr > 0) {
        const cimrRateStr = (Number(data.cimrRate || 0) * 100).toFixed(2).replace('.', ',') + '%';
        addTableRow('Retenue CIMR', fmt(data.sbi), cimrRateStr, null, data.cimr);
    }



    // 9. Retenue I.R. (Base = SNI)
    addTableRow('Retenue I.R.', fmt(data.sni), 'Barème', null, data.irNet);

    // Pad remaining height with blank grid lines for formal pre-printed layout
    const minRows = 12;
    while (rowCount < minRows) {
        doc.rect(MARGIN_LEFT, y, PRINTABLE_WIDTH, ROW_HEIGHT).fill(rowCount % 2 === 1 ? '#fafcfc' : '#ffffff');
        doc.moveTo(MARGIN_LEFT, y + ROW_HEIGHT)
           .lineTo(MARGIN_LEFT + PRINTABLE_WIDTH, y + ROW_HEIGHT)
           .strokeColor('#e5eceb')
           .lineWidth(0.5)
           .stroke();
        y += ROW_HEIGHT;
        rowCount++;
    }

    // -----------------------------------------------------------------------
    // 5. TOTALS ROW ("TOTAUX")
    // -----------------------------------------------------------------------
    doc.rect(MARGIN_LEFT, y, PRINTABLE_WIDTH, ROW_HEIGHT + 3).fill('#ede8e8');
    
    const totY = y + 6;
    doc.fontSize(9).font('Helvetica-Bold').fillColor(TEXT_DARK);
    doc.text('TOTAUX', COL_DESIGNATION_X, totY);
    doc.text(fmt(totalGains), COL_GAINS_X, totY, { width: COL_GAINS_W, align: 'right' });
    doc.text(fmt(totalRetenues), COL_RETENUES_X, totY, { width: COL_RETENUES_W, align: 'right' });

    // Table outer border
    doc.rect(MARGIN_LEFT, tableBodyStartY - TABLE_HEADER_HEIGHT, PRINTABLE_WIDTH, y - tableBodyStartY + TABLE_HEADER_HEIGHT + ROW_HEIGHT + 3)
       .strokeColor(GRAY_BORDER)
       .lineWidth(1)
       .stroke();

    y += ROW_HEIGHT + 25;

    // -----------------------------------------------------------------------
    // 6. NET A PAYER BOX (Highlighted Right-Aligned Box)
    // -----------------------------------------------------------------------
    const netBoxWidth = 200;
    const netBoxHeight = 48;
    const netBoxX = MARGIN_LEFT + PRINTABLE_WIDTH - netBoxWidth;

    doc.rect(netBoxX, y, netBoxWidth, netBoxHeight)
       .lineWidth(2)
       .strokeColor(TEAL_PRIMARY)
       .fill('#ffffff');

    doc.fontSize(9.5).font('Helvetica-Bold').fillColor(TEXT_DARK)
       .text('NET A PAYER', netBoxX, y + 8, { width: netBoxWidth, align: 'center' });

    doc.fontSize(16).font('Helvetica-Bold').fillColor(TEAL_PRIMARY)
       .text(fmt(data.netAPayer), netBoxX, y + 23, { width: netBoxWidth, align: 'center' });

    y += netBoxHeight + 45;

    // -----------------------------------------------------------------------
    // 7. BOTTOM SIGNATURES
    // -----------------------------------------------------------------------
    doc.moveTo(MARGIN_LEFT, y)
       .lineTo(MARGIN_LEFT + PRINTABLE_WIDTH, y)
       .strokeColor(GRAY_BORDER)
       .lineWidth(0.5)
       .stroke();

    y += 12;
    doc.fontSize(8.5).font('Helvetica').fillColor(TEXT_MUTED);
    doc.text("Signature de l'Employeur", MARGIN_LEFT, y);
    doc.text("Signature de l'Employé", MARGIN_LEFT, y, { width: PRINTABLE_WIDTH, align: 'right' });

    doc.end();
}

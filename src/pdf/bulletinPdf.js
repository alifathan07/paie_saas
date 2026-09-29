import PDFDocument from 'pdfkit';

const PAGE_WIDTH = 595.28;
const LEFT = 30;
const RIGHT = 30;
const WIDTH = PAGE_WIDTH - LEFT - RIGHT;
const BLACK = '#183044';
const NAVY = '#123b57';
const TEAL = '#0f766e';
const GRAY = '#607486';
const LIGHT = '#f5f9fb';
const MINT = '#eaf7f5';
const BORDER = '#d7e3e8';
const LINE = '#cbd9df';

const money = value => Number(value || 0).toLocaleString('fr-MA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
const amount = value => Number(value || 0);
const percent = value => `${(amount(value) * 100).toFixed(2).replace('.', ',')} %`;

function text(doc, value, x, y, width, options = {}) {
    doc.text(String(value ?? ''), x, y, { width, lineBreak: false, ellipsis: true, ...options });
}

function cell(doc, x, y, width, height, value = '', options = {}) {
    if (options.fill) doc.rect(x, y, width, height).fill(options.fill);
    doc.rect(x, y, width, height).strokeColor(options.border || LINE).lineWidth(options.lineWidth || 0.6).stroke();
    if (value !== '') {
        doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(options.size || 7.5).fillColor(options.color || BLACK);
        text(doc, value, x + (options.padding ?? 4), y + (options.top ?? 4), width - ((options.padding ?? 4) * 2), {
            align: options.align || 'left',
        });
    }
}

function row(doc, y, height, columns, values, options = {}) {
    let x = LEFT;
    columns.forEach((width, index) => {
        cell(doc, x, y, width, height, values[index], {
            align: options.align?.[index] || 'left',
            bold: options.bold?.includes(index),
            size: options.size || 7.5,
            padding: options.padding ?? 4,
            top: options.top ?? 4,
            fill: options.fill,
            border: options.border,
            lineWidth: options.lineWidth,
            color: options.color || (options.fill === NAVY ? '#ffffff' : undefined),
        });
        x += width;
    });
}

function numericText(value) {
    return value ? Number(value.replace?.(/[^0-9,-]/g, '').replace(',', '.') || 0) : 0;
}

function drawPayrollTable(doc, data, startY) {
    const columns = [35, 190, 70, 80, 50, 60, 50];
    let y = startY;
    row(doc, y, 22, columns, ['RUB', 'LIBELLÉS', 'COTIS. PATR.', 'NBR / BASE', 'TAUX', 'GAINS', 'RETENUES'], {
        bold: [0, 1, 2, 3, 4, 5, 6], fill: NAVY, border: NAVY,
        align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'], size: 7.2, top: 7,
    });
    y += 22;

    const lines = [];
    const push = (code, label, employer, base, rate, gains, deductions) => lines.push([
        code, label, employer ? money(employer) : '', base || '', rate || '', gains ? money(gains) : '', deductions ? money(deductions) : '',
    ]);
    const workedDays = amount(data.workedDays);
    const baseSalary = amount(data.rawBaseSalary ?? data.baseSalary);
    const seniority = amount(data.primeAnciennete);

    push('010', 'SALAIRE EN NOMBRE DE JOURS TRAVAILLÉS', '', `${workedDays.toFixed(2)} J`, '', data.effectiveBaseSalary ?? data.baseSalary, 0);
    if (seniority > 0) push('075', 'ANCIENNETÉ LÉGALE', '', money(baseSalary), percent(data.ancienneteRate), seniority, 0);
    push('019', 'SALAIRE BRUT IMPOSABLE', '', money(data.sbi), '', 0, 0);
    (data.variablePrimes || []).forEach(prime => push('', prime.label, '', '', '', prime.amount, 0));
    (data.nimpLines || []).forEach(line => push('', line.label, '', '', '', line.amount, 0));
    if (amount(data.amo) > 0) push('196', 'RETENUE AMO', amount(data.amoPatronale), money(data.sbi), percent(data.amoRate), 0, data.amo);
    if (amount(data.cnss) > 0) push('197', 'RETENUE CNSS', amount(data.cnssPatronale), money(Math.min(amount(data.sbi), 6000)), percent(data.cnssRate), 0, data.cnss);
    if (amount(data.cimr) > 0) push('199', 'RETENUE CIMR', '', money(data.sbi), percent(data.cimrRate), 0, data.cimr);
    if (amount(data.irNet) > 0) push('198', 'RETENUE IR', '', money(data.sni), '', 0, data.irNet);
    if (amount(data.avances) > 0) push('400', 'AVANCE SUR SALAIRE', '', '', '', 0, data.avances);
    if (amount(data.arrondi) > 0) push('410', 'ARRONDI', '', '', '', data.arrondi, 0);
    if (amount(data.arrondi) < 0) push('410', 'ARRONDI', '', '', '', 0, Math.abs(data.arrondi));

    let totalGains = 0;
    let totalDeductions = 0;
    const maxRows = 12;
    for (let index = 0; index < Math.max(lines.length, maxRows); index += 1) {
        const line = lines[index] || ['', '', '', '', '', '', ''];
        if (index < lines.length) {
            totalGains += numericText(line[5]);
            totalDeductions += numericText(line[6]);
        }
        if (index % 2 === 1) doc.rect(LEFT, y, WIDTH, 19).fill(LIGHT);
        row(doc, y, 19, columns, line, {
            align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'], size: 7.2, top: 5,
            border: BORDER, fill: index % 2 === 1 ? LIGHT : '#ffffff',
        });
        y += 19;
    }

    row(doc, y, 23, columns, ['', 'Total :', money(amount(data.cnssPatronale) + amount(data.amoPatronale)), '', '', money(totalGains), money(totalDeductions)], {
        bold: [1, 2, 5, 6], align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'], size: 7.5, top: 7,
        fill: MINT, border: BORDER,
    });
    return y + 23;
}

function drawCumulative(doc, data, startY) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BLACK).text('Cumul / An:', LEFT, startY - 13);
    const columns = [45, 85, 75, 75, 75, 75, 105];
    row(doc, startY, 20, columns, ['JOURS', 'BRUT', 'CNSS', 'RETRAITE', 'IMPOS.', 'IR', 'RETENUES'], {
        bold: [0, 1, 2, 3, 4, 5, 6], align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'], size: 7.2, top: 6, fill: NAVY, border: NAVY,
    });
    const cumulative = data.cumulative || {};
    row(doc, startY + 20, 20, columns, [
        amount(cumulative.workedDays || data.workedDays).toFixed(2), money(cumulative.sbg || data.sbg),
        money(cumulative.cnss || data.cnss), money(cumulative.cimr || data.cimr),
        money(cumulative.sni || data.sni), money(cumulative.irNet || data.irNet),
        money(cumulative.deductions || amount(data.cnss) + amount(data.amo) + amount(data.cimr) + amount(data.irNet)),
    ], { align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'], size: 7.2, top: 6, fill: '#ffffff', border: BORDER });
    return startY + 40;
}

/** Render one bulletin page into a PDFKit document. */
export function generateBulletinPdf(data, outputStream, options = {}) {
    const ownDocument = !options.doc;
    const doc = options.doc || new PDFDocument({
        size: 'A4', margin: 30,
        info: { Title: `Bulletin de Paie - ${data.employeeName}`, Author: 'Paie Software' },
    });
    if (ownDocument) doc.pipe(outputStream);

    doc.fillColor(BLACK);
    doc.roundedRect(LEFT, 25, WIDTH, 55, 8).fill(MINT);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(NAVY).text(data.companyName || 'GENIE STRUCTURE', LEFT + 15, 35);
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(data.companyAddress || '', LEFT + 15, 56);
    doc.fillColor(GRAY);
    doc.text(`CNSS : ${data.companyCNSS || '—'}`, LEFT, 63);
    doc.font('Helvetica-Bold').fontSize(19).fillColor(NAVY).text('BULLETIN DE PAIE', LEFT, 103, { width: WIDTH, align: 'center' });
    doc.font('Helvetica').fontSize(8.5).fillColor(GRAY).text(
        `Période du : 01/${String(data.month).padStart(2, '0')}/${data.year} au : ${new Date(data.year, data.month, 0).getDate()}/${String(data.month).padStart(2, '0')}/${data.year}    Mois : ${String(data.month).padStart(2, '0')}/${String(data.year).slice(-2)}`,
        LEFT, 127, { width: WIDTH, align: 'center' }
    );
    doc.text(`Service : ${data.codeService || '—'}`, LEFT, 151, { width: WIDTH, align: 'right' });

    const identityColumns = [55, 155, 75, 65, 65, 45, 75];
    row(doc, 166, 22, identityColumns, ['Mle', 'Nom & Prénom', 'N° CNSS', 'Retraite', 'Mutuelle', 'Sce', 'CAT.'], {
        bold: [0, 1, 2, 3, 4, 5, 6], align: ['center', 'center', 'center', 'center', 'center', 'center', 'center'], size: 7.2, top: 7, fill: NAVY, border: NAVY,
    });
    row(doc, 188, 22, identityColumns, [data.employeeMatricule, data.employeeName, data.employeeCNSS, '', '', data.codeService || '', ''], {
        bold: [0, 1], align: ['center', 'left', 'center', 'center', 'center', 'center', 'center'], size: 7.2, top: 7, fill: '#ffffff', border: BORDER,
    });
    doc.font('Helvetica').fontSize(7.5).text(`Adresse : ${data.employeeAddress || '—'}`, LEFT, 214);

    const detailsColumns = [50, 50, 145, 28, 30, 30, 65, 70, 67];
    row(doc, 229, 20, detailsColumns, ['Dte Nais.', 'Dte Emb.', 'Fonction', 'S.F', 'Enf', 'Dd.', 'CIN', 'Sal. Base', 'Jours'], {
        bold: [0, 1, 2, 3, 4, 5, 6, 7, 8], align: ['center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center'], size: 6.8, top: 6, fill: '#eef5f7', border: BORDER,
    });
    row(doc, 249, 22, detailsColumns, [data.birthDate || '—', data.hireDate || '—', data.employeeFonction || '—', data.sexe || '—', data.children ?? '—', data.dependents ?? '—', data.cin || '—', money(data.rawBaseSalary ?? data.baseSalary), amount(data.workedDays).toFixed(2)], {
        align: ['center', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'right'], size: 6.8, top: 7, fill: '#ffffff', border: BORDER,
    });

    const endTable = drawPayrollTable(doc, data, 282);
    const endCumulative = drawCumulative(doc, data, endTable + 20);
    doc.roundedRect(LEFT, endCumulative + 17, 160, 48, 7).fill('#f4f8fa').strokeColor(BORDER).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Mode de paiement', LEFT + 12, endCumulative + 27);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(NAVY).text(data.paymentMethod || 'Virement', LEFT + 12, endCumulative + 42);
    doc.roundedRect(PAGE_WIDTH - RIGHT - 205, endCumulative + 17, 205, 48, 7).fill(TEAL);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#d8f5ef').text('NET À PAYER', PAGE_WIDTH - RIGHT - 190, endCumulative + 27, { width: 175, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#ffffff').text(money(data.netAPayer), PAGE_WIDTH - RIGHT - 190, endCumulative + 40, { width: 175, align: 'right' });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY).text('Signature', PAGE_WIDTH / 2 - 30, endCumulative + 82);

    if (ownDocument) doc.end();
}

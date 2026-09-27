// Earlier eligible bulletins in the selected year, plus the current bulletin.
// Callers supply the same validated/closed history used for annual cumulatives.
export const periodCalculator = ({ employeeId, year, month, previousPayslips = [] }) => {
    const previousMonths = new Set(previousPayslips
        .filter(payslip => payslip.employeeId === employeeId && payslip.year === year &&
            Number.isInteger(payslip.month) && payslip.month >= 1 && payslip.month < month)
        .map(payslip => payslip.month));
    return previousMonths.size + 1;
};

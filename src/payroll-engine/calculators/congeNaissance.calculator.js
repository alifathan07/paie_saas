const REFERENCE_MONTH_LIMIT = 12;
const ELIGIBLE_STATUSES = new Set(["VALIDATED", "CLOSED"]);
const WORKED_DAYS_REFERENCE = 26;

function periodIndex({ year, month }) {
    return Number(year) * 12 + Number(month) - 1;
}

function hasWorkedTime(payslip) {
    const workedDays = Number(payslip.workedDays || 0);
    const workedHours = Number(payslip.workedHours || 0);
    if (payslip.workingTimeMode === "HOURS") return workedHours > 0;
    if (payslip.workingTimeMode === "DAYS") return workedDays > 0;
    return workedDays > 0 || workedHours > 0;
}

export function selectBirthLeaveReferencePayslips(payslips = [], period) {
    const targetYear = Number(period?.year);
    const targetMonth = Number(period?.month);
    if (!Number.isInteger(targetYear) || targetYear < 1
        || !Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
        throw new Error("BIRTH_LEAVE_PERIOD_INVALID");
    }

    const targetIndex = periodIndex({ year: targetYear, month: targetMonth });
    return payslips
        .filter(payslip => {
            const year = Number(payslip.year);
            const month = Number(payslip.month);
            return Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12
                && periodIndex({ year, month }) < targetIndex
                && ELIGIBLE_STATUSES.has(String(payslip.status || "").toUpperCase())
                && hasWorkedTime(payslip)
                && Number.isFinite(Number(payslip.sbi));
        })
        .sort((left, right) => periodIndex(right) - periodIndex(left))
        .slice(0, REFERENCE_MONTH_LIMIT);
}

export function calculateBirthLeaveCompensation({ leaveDays, historicalPayslips = [], year, month }) {
    const days = Math.max(0, Math.min(WORKED_DAYS_REFERENCE, Number(leaveDays) || 0));
    const referencePayslips = selectBirthLeaveReferencePayslips(historicalPayslips, { year, month });
    const referenceMonths = referencePayslips.length;
    const cumulativeSBI = Number(referencePayslips
        .reduce((sum, payslip) => sum + Number(payslip.sbi || 0), 0)
        .toFixed(2));
    const baseCongeNaissance = days > 0 && referenceMonths > 0
        ? Number((cumulativeSBI / referenceMonths).toFixed(2))
        : 0;
    const congeNaissanceAmount = Number((baseCongeNaissance * days / WORKED_DAYS_REFERENCE).toFixed(2));

    return { cumulativeSBI, referenceMonths, baseCongeNaissance, congeNaissanceAmount };
}

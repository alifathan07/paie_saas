export const DEFAULT_STANDARD_MONTHLY_DAYS = 26;
export const DEFAULT_STANDARD_MONTHLY_HOURS = 191;

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

export function validateWorkingTimeBasis({ standardMonthlyDays, standardMonthlyHours }) {
    const days = Number(standardMonthlyDays);
    const hours = Number(standardMonthlyHours);
    if (!Number.isFinite(days) || days <= 0 || days > 31) throw new Error("STANDARD_MONTHLY_DAYS_INVALID");
    if (!Number.isFinite(hours) || hours <= 0 || hours > 744) throw new Error("STANDARD_MONTHLY_HOURS_INVALID");
    return { standardMonthlyDays: days, standardMonthlyHours: hours };
}

export function calculateWorkedHoursFromDays(workedDays, standardMonthlyDays = DEFAULT_STANDARD_MONTHLY_DAYS, standardMonthlyHours = DEFAULT_STANDARD_MONTHLY_HOURS) {
    const basis = validateWorkingTimeBasis({ standardMonthlyDays, standardMonthlyHours });
    const days = Number(workedDays);
    if (!Number.isFinite(days) || days < 0 || days > basis.standardMonthlyDays) throw new Error("WORKED_DAYS_INVALID");
    return round(days * basis.standardMonthlyHours / basis.standardMonthlyDays);
}

export function calculateWorkedDaysFromHours(workedHours, standardMonthlyDays = DEFAULT_STANDARD_MONTHLY_DAYS, standardMonthlyHours = DEFAULT_STANDARD_MONTHLY_HOURS) {
    const basis = validateWorkingTimeBasis({ standardMonthlyDays, standardMonthlyHours });
    const hours = Number(workedHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > basis.standardMonthlyHours) throw new Error("WORKED_HOURS_INVALID");
    return round(hours * basis.standardMonthlyDays / basis.standardMonthlyHours);
}

export function normalizeWorkingTime(input = {}) {
    const mode = String(input.workingTimeMode || input.mode || "DAYS").toUpperCase();
    if (mode !== "DAYS" && mode !== "HOURS") throw new Error("WORKING_TIME_MODE_INVALID");
    const basis = validateWorkingTimeBasis({
        standardMonthlyDays: input.standardMonthlyDays ?? DEFAULT_STANDARD_MONTHLY_DAYS,
        standardMonthlyHours: input.standardMonthlyHours ?? DEFAULT_STANDARD_MONTHLY_HOURS,
    });

    if (mode === "DAYS") {
        const workedDays = input.workedDays === undefined || input.workedDays === null || input.workedDays === ""
            ? basis.standardMonthlyDays
            : Number(input.workedDays);
        const workedHours = calculateWorkedHoursFromDays(workedDays, basis.standardMonthlyDays, basis.standardMonthlyHours);
        return { mode, ...basis, workedDays: round(workedDays), workedHours, ratio: round(workedDays / basis.standardMonthlyDays, 8) };
    }

    const workedHours = input.workedHours === undefined || input.workedHours === null || input.workedHours === ""
        ? basis.standardMonthlyHours
        : Number(input.workedHours);
    const workedDays = calculateWorkedDaysFromHours(workedHours, basis.standardMonthlyDays, basis.standardMonthlyHours);
    // Use the rounded day-equivalent for the payroll ratio. This keeps
    // 24 days and its displayed 176.31-hour equivalent financially identical.
    return { mode, ...basis, workedDays, workedHours: round(workedHours), ratio: round(workedDays / basis.standardMonthlyDays, 8) };
}

export function workingTimeConfigFromCompany(company = {}) {
    return {
        workingTimeMode: company.workingTimeMode || "DAYS",
        standardMonthlyDays: company.standardMonthlyDays ?? DEFAULT_STANDARD_MONTHLY_DAYS,
        standardMonthlyHours: company.standardMonthlyHours ?? DEFAULT_STANDARD_MONTHLY_HOURS,
    };
}

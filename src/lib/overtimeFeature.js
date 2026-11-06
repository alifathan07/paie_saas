const OVERTIME_FIELDS = ["heuresSup25", "heuresSup50", "heuresSup100"];

export function isOvertimeEnabled(company) {
    return company?.overtimeEnabled !== false;
}

export function applyCompanyOvertimeSetting(company, values = {}) {
    if (isOvertimeEnabled(company)) return values;
    return {
        ...values,
        heuresSup25: 0,
        heuresSup50: 0,
        heuresSup100: 0,
    };
}

export function hideOvertimeFromView(values, overtimeEnabled) {
    if (!values || overtimeEnabled !== false) return values;
    return {
        ...values,
        ...Object.fromEntries(OVERTIME_FIELDS.map(field => [field, 0])),
        hs25Amount: 0,
        hs50Amount: 0,
        hs100Amount: 0,
        heuresSupAmount: 0,
    };
}

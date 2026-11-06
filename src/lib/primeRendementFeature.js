const PRIME_RENDEMENT_FIELDS = ["primeRendementInput", "primeRendementAmount"];

export function isPrimeRendementEnabled(company) {
    return company?.primeRendementEnabled !== false;
}

export function applyCompanyPrimeRendementSetting(company, values = {}) {
    if (isPrimeRendementEnabled(company)) return values;
    return {
        ...values,
        primeRendementInput: 0,
        primeRendementAmount: 0,
    };
}

export function hidePrimeRendementFromView(values, enabled) {
    if (!values || enabled !== false) return values;
    return {
        ...values,
        ...Object.fromEntries(PRIME_RENDEMENT_FIELDS.map(field => [field, 0])),
        taxableAdditions: (values.taxableAdditions || [])
            .filter(line => line.calculationKey !== "prime_rendement"),
    };
}

const MONTHLY_HOURS = 191;

export function calculatePrimeRendement(netAPayerBeforePrime, input) {
    const net = Number(netAPayerBeforePrime);
    const units = Number(input);
    if (!Number.isFinite(net) || net < 0 || !Number.isFinite(units) || units < 0) {
        throw new Error("PRIME_RENDEMENT_INPUT_INVALID");
    }
    return Number((net / MONTHLY_HOURS * units).toFixed(2));
}

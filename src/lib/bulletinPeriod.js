const periodIndex = ({ year, month }) => year * 12 + month - 1;

export function getActiveBulletinPeriod(rows, now = new Date()) {
    const unfinished = rows.filter(row => row.status !== 'CLOSED');
    const index = unfinished.length
        ? Math.min(...unfinished.map(periodIndex))
        : rows.length
            ? Math.max(...rows.map(periodIndex)) + 1
            : now.getFullYear() * 12 + now.getMonth();
    return { year: Math.floor(index / 12), month: index % 12 + 1 };
}

export function isAfterActivePeriod(period, active) {
    return periodIndex(period) > periodIndex(active);
}

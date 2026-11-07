export function employeeBulletinVisibilityWhere(month, year) {
    return {
        OR: [
            { bulletinMasque: false },
            { bulletinMasqueDepuis: { gt: year * 100 + month } },
        ],
    };
}

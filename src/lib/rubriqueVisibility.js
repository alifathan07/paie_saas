function visibilityBy(rows) {
    const visibility = {};
    for (const row of rows) {
        const visible = row.visible !== false;
        if (row.key) visibility[row.key] = visible;
        if (row.id !== null && row.id !== undefined) visibility[`id:${row.id}`] = visible;
        if (row.code) visibility[`code:${row.code}`] = visible;
    }
    return visibility;
}

export function buildRubriqueVisibility({ base = [], retenu = [], imposable = [] } = {}) {
    const imposableVisibility = {};
    for (const row of imposable) {
        const visible = row.visible !== false;
        imposableVisibility[String(row.id)] = visible;
        imposableVisibility[`id:${row.id}`] = visible;
        if (row.calculationKey) imposableVisibility[`key:${row.calculationKey}`] = visible;
        if (row.code) imposableVisibility[`code:${row.code}`] = visible;
    }

    return {
        base: visibilityBy(base),
        retenu: visibilityBy(retenu),
        imposable: imposableVisibility,
    };
}

export function isRubriqueVisible(visibility, category, key) {
    return visibility?.[category]?.[String(key)] !== false;
}

export function isImposableRubriqueVisible(visibility, line) {
    if (line?.rubriqueImposableId !== null && line?.rubriqueImposableId !== undefined
        && !isRubriqueVisible(visibility, "imposable", `id:${line.rubriqueImposableId}`)) return false;
    if (line?.calculationKey
        && !isRubriqueVisible(visibility, "imposable", `key:${line.calculationKey}`)) return false;
    if (line?.code && !isRubriqueVisible(visibility, "imposable", `code:${line.code}`)) return false;
    return true;
}

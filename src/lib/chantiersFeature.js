export function isChantiersEnabled(company) {
    return company?.chantiersEnabled !== false;
}

export function resolveChantierFilter(value, enabled) {
    if (!enabled || value === undefined || value === null || value === '') return null;
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}

export function filterEmployeesByChantier(employees, chantierId, enabled) {
    if (!enabled || chantierId === null) return employees;
    return employees.filter(employee => Number(employee.chantierId) === chantierId);
}

export function employeeChantierWriteFields(enabled, { chantierId, chantierNom }, creating = false) {
    if (!enabled) return creating ? { chantierId: null, chantierNom: null } : {};
    return {
        chantierId: creating
            ? (chantierId ? Number(chantierId) : null)
            : chantierId === undefined
                ? undefined
                : (chantierId === '' || chantierId === null ? null : Number(chantierId)),
        chantierNom: creating
            ? (String(chantierNom || '').trim() || null)
            : chantierNom === undefined
                ? undefined
                : (String(chantierNom || '').trim() || null),
    };
}

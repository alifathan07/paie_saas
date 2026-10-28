import prisma from '../../db.ts';

const CHANTIERS_API_URL = 'https://confonda.enmae.com/api/chantiers';
const isExcludedChantier = name => String(name || '').trim().toLocaleLowerCase('fr-FR') === 'aucun';

async function fetchChantiersFromApi() {
    const response = await fetch(CHANTIERS_API_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`CHANTIERS_API_${response.status}`);
    const payload = await response.json();
    return (Array.isArray(payload) ? payload : payload.data || [])
        .map(item => ({ id: Number(item?.id), nom: String(item?.nom || '').trim() }))
        .filter(item => Number.isInteger(item.id) && item.nom && !isExcludedChantier(item.nom));
}

export async function syncChantiers() {
    const apiChantiers = await fetchChantiersFromApi();
    const synced = await prisma.$transaction(async tx => {
        const existing = await tx.chantier.findMany({ select: { id: true, code: true } });
        const knownIds = new Set(existing.map(item => item.id));
        let nextCode = existing.reduce((max, item) => Math.max(max, item.code), 0) + 1;

        for (const chantier of apiChantiers) {
            if (knownIds.has(chantier.id)) {
                await tx.chantier.update({ where: { id: chantier.id }, data: { nom: chantier.nom } });
            } else {
                await tx.chantier.create({ data: { id: chantier.id, code: nextCode, nom: chantier.nom } });
                nextCode += 1;
            }
        }

        const rows = await tx.chantier.findMany({ orderBy: { nom: 'asc' } });
        return rows.filter(item => !isExcludedChantier(item.nom));
    });

    return synced;
}

export async function listChantiers() {
    try {
        return await syncChantiers();
    } catch (error) {
        console.error('Unable to sync chantiers:', error.message);
        const rows = await prisma.chantier.findMany({ orderBy: { nom: 'asc' } });
        return rows.filter(item => !isExcludedChantier(item.nom));
    }
}

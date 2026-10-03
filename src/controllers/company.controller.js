import prisma from "../../db.ts";

const DEFAULT_SMIG = 3422.72;
const DEFAULT_STANDARD_DAYS = 26;
const DEFAULT_STANDARD_HOURS = 191;

function page(req, overrides = {}) {
    return {
        title: "Mes sociétés",
        currentPage: "companies",
        user: req.session.user,
        clientMode: req.session.adminClientMode || null,
        error: null,
        success: null,
        ...overrides,
    };
}

export async function companyPage(req, res) {
    const user = await prisma.users.findUnique({
        where: { id: Number(req.session.user.id) },
        select: {
            maxCompanies: true,
            userCompanies: {
                orderBy: { companyId: "asc" },
                include: { company: true },
            },
        },
    });
    return res.render("companies/index", page(req, {
        companies: user?.userCompanies || [],
        maxCompanies: user?.maxCompanies ?? 0,
    }));
}

export async function createCompany(req, res) {
    const userId = Number(req.session.user.id);
    const name = String(req.body.name || "").trim().slice(0, 191);
    const adresse = String(req.body.adresse || "").trim().slice(0, 191) || null;
    const ville = String(req.body.ville || "").trim().slice(0, 191) || null;
    const ice = String(req.body.ice || "").trim().slice(0, 191) || null;
    const ifNumber = String(req.body.ifNumber || "").trim().slice(0, 191) || null;
    const rc = String(req.body.rc || "").trim().slice(0, 191) || null;
    const numeroAffiliationCnss = String(req.body.numeroAffiliationCnss || "").trim().slice(0, 191) || null;
    const numeroAssurance = String(req.body.numeroAssurance || "").trim().slice(0, 191) || null;
    const smig = Number(req.body.smig || DEFAULT_SMIG);

    if (!name || !adresse || !ville || !ifNumber || !numeroAffiliationCnss || !Number.isFinite(smig) || smig <= 0) {
        const owner = await prisma.users.findUnique({ where: { id: userId }, select: { maxCompanies: true, userCompanies: { include: { company: true } } } });
        return res.status(400).render("companies/index", page(req, { companies: owner?.userCompanies || [], maxCompanies: owner?.maxCompanies ?? 0, error: "Veuillez renseigner la raison sociale, l’adresse, la ville, l’IF, le numéro CNSS et le SMIG." }));
    }

    try {
        const company = await prisma.$transaction(async (tx) => {
            const owner = await tx.users.findUnique({ where: { id: userId }, select: { maxCompanies: true, isAdmin: true, isBlocked: true } });
            if (!owner || owner.isAdmin || owner.isBlocked) throw new Error("COMPANY_CREATION_FORBIDDEN");

            await tx.users.update({ where: { id: userId }, data: { updatedAt: new Date() } });
            const current = await tx.userCompany.count({ where: { userId } });
            if (owner.maxCompanies !== 0 && current >= owner.maxCompanies) throw new Error("COMPANY_LIMIT_REACHED");

            const created = await tx.company.create({ data: { name, adresse, ville, ice, ifNumber, rc, numeroAffiliationCnss, smig, numeroAssurance } });
            await tx.userCompany.create({ data: { userId, companyId: created.id } });
            return created;
        });

        req.session.user.activeCompanyId = company.id;
        await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));
        return res.redirect("/dashboard");
    } catch (error) {
        if (error.message === "COMPANY_LIMIT_REACHED") {
            const owner = await prisma.users.findUnique({ where: { id: userId }, select: { maxCompanies: true, userCompanies: { include: { company: true } } } });
            return res.status(409).render("companies/index", page(req, { companies: owner?.userCompanies || [], maxCompanies: owner?.maxCompanies ?? 0, error: "La limite de sociétés définie par votre administrateur est atteinte." }));
        }
        if (error.message === "COMPANY_CREATION_FORBIDDEN") return res.status(403).send("Création de société non autorisée.");
        if (error.code === "P2002") {
            const owner = await prisma.users.findUnique({ where: { id: userId }, select: { maxCompanies: true, userCompanies: { include: { company: true } } } });
            return res.status(409).render("companies/index", page(req, { companies: owner?.userCompanies || [], maxCompanies: owner?.maxCompanies ?? 0, error: "Une société avec ces informations existe déjà." }));
        }
        throw error;
    }
}

async function getActiveCompanyForUser(userId, companyId) {
    const membership = await prisma.userCompany.findUnique({
        where: { companyId_userId: { companyId, userId } },
        include: { company: true },
    });
    return membership?.company || null;
}

function companyForm(company) {
    return {
        name: company?.name || "",
        adresse: company?.adresse || "",
        ville: company?.ville || "",
        ifNumber: company?.ifNumber || "",
        numeroAffiliationCnss: company?.numeroAffiliationCnss || "",
        smig: company?.smig ? String(company.smig) : String(DEFAULT_SMIG),
        numeroAssurance: company?.numeroAssurance || "",
        ice: company?.ice || "",
        rc: company?.rc || "",
        workingTimeMode: company?.workingTimeMode || "DAYS",
        standardMonthlyDays: company?.standardMonthlyDays ? String(company.standardMonthlyDays) : String(DEFAULT_STANDARD_DAYS),
        standardMonthlyHours: company?.standardMonthlyHours ? String(company.standardMonthlyHours) : String(DEFAULT_STANDARD_HOURS),
    };
}

export async function settingsPage(req, res) {
    if (req.session.adminClientMode) return res.status(403).send("Paramétrage indisponible en mode support.");
    const company = await getActiveCompanyForUser(Number(req.session.user.id), Number(req.session.user.activeCompanyId));
    if (!company) return res.status(403).send("Société active introuvable.");
    return res.render("parametrage/index", page(req, { title: "Paramétrage", currentPage: "parametrage", company, form: companyForm(company) }));
}

export async function updateSettings(req, res) {
    if (req.session.adminClientMode) return res.status(403).send("Paramétrage indisponible en mode support.");
    const userId = Number(req.session.user.id);
    const companyId = Number(req.session.user.activeCompanyId);
    const current = await getActiveCompanyForUser(userId, companyId);
    if (!current) return res.status(403).send("Société active introuvable.");

    const form = {
        name: String(req.body.name || "").trim().slice(0, 191),
        adresse: String(req.body.adresse || "").trim().slice(0, 191),
        ville: String(req.body.ville || "").trim().slice(0, 191),
        ifNumber: String(req.body.ifNumber || "").trim().slice(0, 191),
        numeroAffiliationCnss: String(req.body.numeroAffiliationCnss || "").trim().slice(0, 191),
        smig: String(req.body.smig || "").trim(),
        numeroAssurance: String(req.body.numeroAssurance || "").trim().slice(0, 191),
        ice: String(req.body.ice || "").trim().slice(0, 191),
        rc: String(req.body.rc || "").trim().slice(0, 191),
        workingTimeMode: String(req.body.workingTimeMode || "DAYS").toUpperCase(),
        standardMonthlyDays: String(req.body.standardMonthlyDays || "").trim(),
        standardMonthlyHours: String(req.body.standardMonthlyHours || "").trim(),
    };
    const smig = Number(form.smig);
    const standardMonthlyDays = Number(form.standardMonthlyDays);
    const standardMonthlyHours = Number(form.standardMonthlyHours);
    if (!form.name || !form.adresse || !form.ville || !form.ifNumber || !form.numeroAffiliationCnss || !Number.isFinite(smig) || smig <= 0
        || !["DAYS", "HOURS"].includes(form.workingTimeMode)
        || !Number.isFinite(standardMonthlyDays) || standardMonthlyDays <= 0 || standardMonthlyDays > 31
        || !Number.isFinite(standardMonthlyHours) || standardMonthlyHours <= 0 || standardMonthlyHours > 744) {
        return res.status(400).render("parametrage/index", page(req, { title: "Paramétrage", currentPage: "parametrage", company: current, form, error: "Veuillez renseigner tous les champs obligatoires et un SMIG valide." }));
    }

    try {
        const company = await prisma.company.update({
            where: { id: companyId },
            data: {
                name: form.name,
                adresse: form.adresse,
                ville: form.ville,
                ifNumber: form.ifNumber,
                numeroAffiliationCnss: form.numeroAffiliationCnss,
                smig,
                numeroAssurance: form.numeroAssurance || null,
                ice: form.ice || null,
                rc: form.rc || null,
                workingTimeMode: form.workingTimeMode,
                standardMonthlyDays,
                standardMonthlyHours,
            },
        });
        return res.render("parametrage/index", page(req, { title: "Paramétrage", currentPage: "parametrage", company, form: companyForm(company), success: "Les informations de la société ont été enregistrées." }));
    } catch (error) {
        if (error.code === "P2002") return res.status(409).render("parametrage/index", page(req, { title: "Paramétrage", currentPage: "parametrage", company: current, form, error: "Cet IF, ICE ou RC est déjà utilisé par une autre société." }));
        throw error;
    }
}

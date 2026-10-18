import { resolveCompanyId } from "../lib/company.js";
import { listPrimes, createPrimes, updatePrime, deletePrime } from "../services/primeService.js";

const companyId = req => resolveCompanyId(req);

function rowsFromBody(body = {}) {
    const codes = Array.isArray(body.code) ? body.code : [body.code];
    const names = Array.isArray(body.name) ? body.name : [body.name];
    const amounts = Array.isArray(body.defaultAmount) ? body.defaultAmount : [body.defaultAmount];
    return names.map((name, index) => ({ code: codes[index] || "", name: name || "", defaultAmount: amounts[index] || "" }));
}

export async function index(req, res) {
    try {
        return res.render("primes/index", {
            title: "Primes imposables",
            currentPage: "primes",
            user: req.session.user,
            primes: await listPrimes(companyId(req)),
            createRows: [],
            error: null,
        });
    } catch (error) {
        console.error("Error listing primes:", error);
        return res.status(500).render("primes/index", {
            title: "Primes imposables", currentPage: "primes", user: req.session.user,
            primes: [], createRows: [], error: "Impossible de charger les primes imposables.",
        });
    }
}

export async function create(req, res) {
    try {
        await createPrimes({ companyId: companyId(req), rows: rowsFromBody(req.body) });
        return res.redirect("/primes");
    } catch (error) {
        console.error("Error creating primes:", error);
        return res.status(400).render("primes/index", {
            title: "Primes imposables", currentPage: "primes", user: req.session.user,
            primes: await listPrimes(companyId(req)), createRows: rowsFromBody(req.body),
            error: error.code === "P2002" ? "Cette prime existe déjà." : "Le code, le libellé et le montant sont obligatoires.",
        });
    }
}

export async function update(req, res) {
    try {
        await updatePrime(req.params.id, { companyId: companyId(req), code: req.body.code, name: req.body.name, defaultAmount: req.body.defaultAmount });
    } catch (error) {
        console.error("Error updating prime:", error);
    }
    return res.redirect("/primes");
}

export async function remove(req, res) {
    try {
        await deletePrime(req.params.id, companyId(req));
    } catch (error) {
        console.error("Error deleting prime:", error);
    }
    return res.redirect("/primes");
}

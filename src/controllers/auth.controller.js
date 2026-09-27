import { authenticateUser } from "../services/auth.service.js";
import { pickLoginCompany } from "../lib/company.js";

export const loginPage = (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect("/");
    }
    res.render("auth/login", {
        title: "Connexion",
        error: null,
    });
};

export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await authenticateUser(email, password);
        const { companyId, companyName } = pickLoginCompany(user);

        req.session.user = {
            id: user.id,
            name: user.name,
            email: user.email,
            companyId,
            companyName,
        };

        // If request is from HTMX, tell HTMX to redirect the whole page
        if (req.headers["hx-request"]) {
            res.setHeader("HX-Redirect", "/");
            return res.status(200).send();
        }

        return res.redirect("/");
    } catch (error) {
        console.error("Login error:", error.message);

        let errorMsg = "Adresse e-mail ou mot de passe incorrect.";
        if (error.message === "MISSING_CREDENTIALS") {
            errorMsg = "Veuillez renseigner votre e-mail et mot de passe.";
        }

        if (req.headers["hx-request"]) {
            return res.send(`<div class="alert alert-error">${errorMsg}</div>`);
        }
        return res.render("auth/login", { title: "Connexion", error: errorMsg });
    }
};

export const logout = async (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error("Logout error:", err);
                return res.status(500).json({ error: "Unable to logout" });
            }
            res.redirect("/auth");
        });
    } else {
        res.redirect("/auth");
    }
};


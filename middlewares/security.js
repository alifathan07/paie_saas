import crypto from "node:crypto";

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_SESSION_KEY = "csrfSecret";
const CSRF_HEADER = "x-csrf-token";
const MULTIPART_ROUTES = new Set(["/employees/import", "/parametrage/", "/parametrage/logo"]);

function configuredOrigin() {
    if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN) {
        throw new Error("APP_ORIGIN must be configured in production");
    }
    const value = process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`;
    try {
        const origin = new URL(value);
        return origin.origin;
    } catch {
        throw new Error("APP_ORIGIN must be a valid origin, for example https://payroll.example.com");
    }
}

function tokenForSecret(secret) {
    return crypto.createHmac("sha256", secret).update("paie-csrf-token").digest("base64url");
}

function ensureCsrfSecret(req) {
    if (!req.session) return null;
    if (!req.session[CSRF_SESSION_KEY]) {
        req.session[CSRF_SESSION_KEY] = crypto.randomBytes(32).toString("hex");
    }
    return req.session[CSRF_SESSION_KEY];
}

export function csrfToken(req) {
    const secret = ensureCsrfSecret(req);
    return secret ? tokenForSecret(secret) : null;
}

export function csrfProtection(req, res, next) {
    const token = csrfToken(req);
    res.locals.csrfToken = token;

    if (!MUTATION_METHODS.has(req.method)) return next();
    // Multer parses the hidden field on these two known upload routes later
    // in the route chain. Every other multipart mutation must provide a header.
    if (req.is?.("multipart/form-data") && MULTIPART_ROUTES.has(req.path)) return next();

    const submitted = req.get(CSRF_HEADER) || req.body?._csrf;
    if (!submitted || typeof submitted !== "string" || submitted.length > 200 || !token) {
        return res.status(403).send("INVAL+++++ID_CSRF_TOKEN");
    }

    const expected = Buffer.from(token);
    const actual = Buffer.from(submitted);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
        return res.status(403).send("INVALID_CSRF_TOKEN");
    }
    return next();
}

function clientKey(req) {
    return String(req.ip || req.socket?.remoteAddress || "unknown");
}

export function securityHeaders(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
}

export function sameOriginProtection(req, res, next) {
    if (!MUTATION_METHODS.has(req.method)) return next();
    const source = req.get("origin") || req.get("referer");
    if (!source) return next();
    try {
        if (new URL(source).origin !== configuredOrigin()) {
            return res.status(403).send("INVALID_ORIGIN");
        }
    } catch {
        return res.status(403).send("INVALID_ORIGIN");
    }
    return next();
}

export function loginRateLimit(req, res, next) {
    const now = Date.now();
    const key = clientKey(req);
    const entry = loginAttempts.get(key);
    if (!entry || now - entry.startedAt >= LOGIN_WINDOW_MS) {
        loginAttempts.set(key, { startedAt: now, count: 1 });
        return next();
    }
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        const retryAfter = Math.max(1, Math.ceil((entry.startedAt + LOGIN_WINDOW_MS - now) / 1000));
        res.setHeader("Retry-After", String(retryAfter));
        if (req.path === "/login") {
            return res.status(429).render("auth/login", {
                title: "Connexion",
                error: "Trop de tentatives de connexion. Réessayez dans quelques minutes.",
            });
        }
        return res.status(429).send("Trop de tentatives. Réessayez plus tard.");
    }
    entry.count += 1;
    return next();
}

export function clearLoginAttempts(req) {
    loginAttempts.delete(clientKey(req));
}

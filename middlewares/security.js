const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

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

// Same-origin validation is used as a CSRF defence for browser state changes.
// Requests without Origin/Referer are left compatible with non-browser clients;
// production browser requests send one of these headers automatically.
export function sameOriginProtection(req, res, next) {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
    const source = req.get("origin") || req.get("referer");
    if (!source) return next();
    try {
        const sourceUrl = new URL(source);
        const host = req.get("host");
        if (sourceUrl.host !== host || sourceUrl.protocol !== `${req.protocol}:`) {
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
    if (entry.count >= LOGIN_MAX_ATTEMPTS) return res.status(429).send("Trop de tentatives. Réessayez plus tard.");
    entry.count += 1;
    return next();
}

export function clearLoginAttempts(req) {
    loginAttempts.delete(clientKey(req));
}

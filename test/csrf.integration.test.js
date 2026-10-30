import assert from "node:assert/strict";
import { test } from "node:test";
import { csrfProtection, csrfToken, sameOriginProtection } from "../middlewares/security.js";

process.env.APP_ORIGIN = "https://app.test";

function makeRequest(method, session, { body = {}, origin } = {}) {
    return { method, body, session, get(name) {
        const key = name.toLowerCase();
        return key === "origin" ? origin : undefined;
    } };
}

function makeResponse() {
    return { locals: {}, statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        send(value) { this.body = value; return this; } };
}

function runMutation(session, { token, origin, body } = {}) {
    const req = makeRequest("POST", session, { body: body || (token ? { _csrf: token } : {}), origin });
    req.get = (name) => name.toLowerCase() === "x-csrf-token" ? token : name.toLowerCase() === "origin" ? origin : undefined;
    const res = makeResponse();
    let executed = false;
    csrfProtection(req, res, () => sameOriginProtection(req, res, () => { executed = true; }));
    return { status: res.statusCode, executed };
}

const session = () => ({});

test("valid token permits an authorized admin mutation", () => {
    const victim = session();
    const token = csrfToken({ session: victim });
    const result = runMutation(victim, { token, origin: "https://app.test" });
    assert.equal(result.status, 200);
    assert.equal(result.executed, true);
});

test("missing and invalid tokens are rejected before route execution", () => {
    const victim = session();
    assert.equal(runMutation(victim).status, 403);
    assert.equal(runMutation(victim, { token: "wrong" }).status, 403);
    assert.equal(runMutation(victim, { body: { _csrf: "wrong" } }).status, 403);
});

test("tokens are bound to a session and old tokens fail after regeneration", () => {
    const first = session();
    const second = session();
    const firstToken = csrfToken({ session: first });
    assert.notEqual(firstToken, csrfToken({ session: second }));
    assert.equal(runMutation(second, { token: firstToken }).status, 403);
    assert.equal(runMutation(session(), { token: firstToken }).status, 403);
});

test("cross-origin requests are rejected and absent origin cannot bypass token validation", () => {
    const victim = session();
    const token = csrfToken({ session: victim });
    assert.equal(runMutation(victim, { token, origin: "https://attacker.example" }).status, 403);
    assert.equal(runMutation(victim, { token }).status, 200);
    assert.equal(runMutation(victim).status, 403);
});

test("all mutation methods are protected while GET and HEAD remain non-mutating", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
        const req = makeRequest(method, session());
        const res = makeResponse();
        csrfProtection(req, res, () => {});
        assert.equal(res.statusCode, 403);
    }
    for (const method of ["GET", "HEAD"]) {
        const req = makeRequest(method, session());
        const res = makeResponse();
        let continued = false;
        csrfProtection(req, res, () => { continued = true; });
        assert.equal(continued, true);
    }
});

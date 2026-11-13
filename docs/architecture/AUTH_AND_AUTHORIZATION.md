# Authentication and authorization

## Authentication and sessions

Authentication is implemented by `src/routes/auth.js`,
`src/controllers/auth.controller.js` and `src/services/auth.service.js`.
Public registration creates a username-based account and its first company in
one transaction; the submitted company email is used as the account email for
login and verification messages.
Passwords are hashed with `bcryptjs` using cost 10; the login path accepts the
normalized username (and retains normalized email as a compatibility identifier),
checks blocked-account state and stores the signed-in user in an
`express-session` session. Session data includes user identity/admin flags and
the active company context.

Users have a unique username and an email-code challenge enabled by default for
client accounts. An administrator can disable it per account from the admin user
page. When `twoFactorEnabled` is enabled, password validation
creates a six-digit code valid for ten minutes and sends it to the user's stored
email address. The authenticated session is created only after the code succeeds.
SMTP is configured with `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD` and `EMAIL_FROM`. If the provider's SMTP endpoint uses a
certificate for a different official hostname, `SMTP_TLS_SERVERNAME` may be
set to that certificate hostname; certificate verification remains enabled.

`index.js` configures the MySQL session store with a two-hour lifetime,
`httpOnly`, configurable `sameSite` and a production-only secure cookie.
Important configuration caveat: the session store connection is configured
with localhost/root/blank-password/database values in `index.js`, rather than
being derived from `DATABASE_URL`.

Login throttling is an in-memory per-IP counter (10 attempts per 15-minute
window). It is local to the running process and is reset on process restart;
it is not a shared/distributed rate limiter.

## Authorization and administrator capabilities

`middlewares/auth.js` provides the general authentication guard and the
active-company guard used by `index.js`.
`middlewares/admin.js` enforces admin access. Admin status can come from the
session/database flag or the configured `ADMIN_EMAIL`. Admin routes support
account and company administration, global payroll configuration, reports,
audit activity, billing-related limits and client/support mode; see
`src/controllers/admin.controller.js` and `src/routes/admin.js`.

Client-mode access is checked against the selected client's company
membership and blocked status. Admin access does not make an arbitrary
company ID supplied by a browser a trusted company context.

## Company isolation

After authentication, users with one eligible company membership can have it
selected automatically; users with multiple memberships select an active
company. `middlewares/auth.js` validates that session context
against `UserCompany`. `src/lib/company.js` resolves the active company for
controllers. Business routers are mounted after this guard in `index.js`;
company-owned queries generally scope through the resolved company ID or
employee relation.

Profile, admin and company-selection routes are mounted before the active
company guard because they must remain accessible while selecting or
administering a company. Payroll routes also apply period enforcement.

## Security implementation caveats

- `middlewares/security.js` defines security-header, same-origin and CSRF
  behavior, but the relevant security middleware registrations in `index.js`
  are commented out. The CSRF integration test exercises middleware behavior;
  it does not establish that global CSRF protection is mounted in production.
- `middlewares/security.js` contains a malformed `INVAL+++++ID_CSRF_TOKEN`
  error string. This is recorded as a source issue, not corrected here.
- `ADMIN_EMAIL` and `SESSION_SECRET` are listed in `.env.example`; use of an
  unset or weak production session secret is not validated by these documents.

Sources: `index.js`, `middlewares/auth.js`, `middlewares/admin.js`,
`middlewares/security.js`,
`src/lib/company.js`, `src/services/auth.service.js`.

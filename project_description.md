# Authentication and Authorization

This document describes the authentication and authorization currently implemented in Paie Software. It reflects the code in `index.js`, `middlewares/auth.js`, `middlewares/admin.js`, `src/controllers/auth.controller.js`, `src/services/auth.service.js`, and the route/controller files.

## 1. Main concepts

The application has three security concepts:

1. **Authentication**: proving who the user is with an email address and password.
2. **Role authorization**: determining whether the authenticated user is an administrator or a normal client.
3. **Company authorization**: determining which company the authenticated user may access for the current request.

These checks are separate. Being logged in does not automatically grant access to `/admin`, and having a company selected does not grant administrative access.

## 2. User data and roles

Users are stored in the `users` table through the Prisma `Users` model. Important fields are:

| Field | Purpose |
|---|---|
| `id` | Stable user identifier stored in the session. |
| `email` | Login identifier and optional configured-admin identifier. |
| `password` | Bcrypt hash; the plaintext password is never stored or put in the session. |
| `isAdmin` | Database role flag. `true` means the user is an administrator. |
| `isBlocked` | Prevents normal users from using company-protected routes. |
| `maxCompanies` | Billing/account limit managed from the admin panel. |

### Administrator

An administrator can:

- Open `/admin`.
- View the administration dashboard.
- View clients and their company memberships.
- Change a client's company limit.
- Block or unblock a client.
- Create a company for a client, subject to that client's company limit.
- Enter client mode for one of a client's companies.
- Exit client mode.
- View and update client reports.
- Continue using the application even when the normal blocked-user restriction would apply.

Administrator status is normally read from `users.isAdmin`. A configured `ADMIN_EMAIL` is also accepted as an administrative identity. The configured email is trimmed and compared case-insensitively.

### Normal client

A normal client can:

- Log in.
- Select one of the companies to which the user is linked.
- Use the dashboard, employees, payroll bulletins, editions, and reports for the active company.
- Create reports associated with the current user and active company.

A normal client cannot access `/admin`. A blocked normal client cannot access routes protected by `requireActiveCompany`.

There is no separate role value such as `manager` or `viewer` in the current schema. The effective roles are the administrator role and the normal client role, with company membership providing the tenant boundary.

There is deliberately no company-level blocked status. Blocking `Users.isBlocked` blocks the user's access to all of that user's companies through `requireActiveCompany`.

## 3. Login flow

The login page is `GET /auth` and the form submits to `POST /auth/login`.

1. The controller reads the submitted email and password.
2. The email is trimmed and lowercased by `authenticateUser`.
3. Prisma loads the user and their `userCompanies` memberships.
4. `bcrypt.compare()` compares the submitted password with the stored password hash.
5. If the credentials are invalid, the request returns the generic login error. This avoids revealing whether the email exists.
6. On success, the application creates `req.session.user` containing only non-sensitive identity data:

   ```text
   id
   name
   email
   isAdmin
   isBlocked
   activeCompanyId
   ```

   The password is deliberately excluded.

7. If the account has no company membership, the authenticated session is preserved and the user is sent to `/auth/select-company` with a waiting-for-company message. Company-protected routes still reject the request because there is no active company.
8. If the account has one company, that company becomes the active company automatically.
9. If the account has multiple companies, the user is redirected to `/auth/select-company`.
10. For HTMX requests, the server sends an `HX-Redirect` header so the browser performs a full-page redirect.

The company-selection endpoint validates that the submitted company is actually linked to the logged-in user before writing `activeCompanyId` into the session.

## 4. Session management

Sessions are managed with `express-session` and persisted in MySQL using `express-mysql-session`. The browser receives an HTTP-only session cookie with a two-hour lifetime.

The session contains the authenticated user identity and the active company selection. It may also contain `adminClientMode` while an administrator is impersonating a client context.

Logout destroys the server-side session and redirects to `/auth`.

The current session configuration is:

- `httpOnly: true`: client-side JavaScript cannot read the session cookie.
- `secure: false`: the cookie is currently sent over HTTP, which is suitable for local development but should be changed to `true` behind HTTPS in production.
- `maxAge: 2 hours`.
- MySQL-backed storage: sessions are not held only in the application process memory.

## 5. Request authorization pipeline

The relevant application order in `index.js` is:

```text
Request
  -> session middleware
  -> public values in res.locals
  -> /auth routes
  -> isAuth
  -> /admin routes with isAdmin
  -> requireActiveCompany
  -> dashboard/employees/bulletins/editions/reports routes
```

### `isAuth`

`isAuth` checks whether `req.session.user` exists.

- If it exists, the request continues.
- If it does not exist, the user is redirected to `/auth`.

This is the basic authentication gate for protected application routes.

### `isAdmin`

The admin router applies `isAdmin` to every `/admin` route.

The middleware:

1. Reads the authenticated user from the session.
2. Checks the session's `isAdmin` flag.
3. Re-reads the user's `isAdmin` value from the database using the session user ID. This refresh prevents an old session from remaining unauthorized after the user's role is changed in the database.
4. Checks the normalized `ADMIN_EMAIL` fallback.
5. Updates the session's `isAdmin` flag when administrative access is confirmed.
6. Returns `403 ADMIN_ACCESS_REQUIRED` when none of the checks succeeds.

This check protects both `GET` and `POST` admin endpoints because it is installed with `admin.use(isAdmin)` at the router level.

### `requireActiveCompany`

Most non-admin application routes are protected by `requireActiveCompany` after the admin router is mounted.

The middleware:

1. Rejects a blocked non-admin user with `403 ACCOUNT_BLOCKED`.
2. Reads and validates `activeCompanyId` from the session.
3. Rejects missing or invalid active companies with `403 NO_ACTIVE_COMPANY`.
4. Confirms that the authenticated user has a `userCompanies` membership for that company.
5. Stores the validated company ID in `req.activeCompanyId`.

This membership check is important because a company ID supplied by the browser is not trusted by itself.

## 6. Company and tenant isolation

Company membership is represented by the `userCompanies` join table. Its composite key is `(companyId, userId)`.

After the active company is validated, controllers and services use the active company ID when reading or changing business records. For example:

- Employees are queried with both the employee ID and company ID.
- Employee creation and updates use the active company ID.
- Payroll and bulletin operations filter employees and payslips by company.
- Reports created by clients use the session user ID and active company ID.
- Company selection checks the membership join table before changing the session.

This prevents a normal user from switching to an unrelated company merely by changing an ID in a URL or form.

## 7. Administrator client mode

Client mode is an administrative context switch, not a new login.

When an administrator chooses a client company from `/admin/clients`:

1. The server validates that the selected company belongs to the selected client.
2. The server rejects attempts to enter the mode for another administrator.
3. The server stores the target client user ID and company ID in `req.session.adminClientMode`.
4. The active company in the admin session is changed to that company.
5. The session is explicitly saved before redirecting to the dashboard.

While in client mode, `requireActiveCompany` allows the administrator to operate against the selected company only when the stored mode company matches the active company. It then validates the target client's membership and blocked status.

Exiting client mode deletes `adminClientMode` and restores the administrator's first available company membership as the active company.

## 8. Security measures currently implemented

- Passwords are hashed with `bcryptjs`; plaintext passwords are not stored.
- Password hashes are excluded from the safe user object returned by authentication.
- Invalid login responses are generic.
- Sessions are stored server-side in MySQL.
- The session cookie is HTTP-only.
- Every protected request requires a valid session.
- Admin routes have a dedicated authorization middleware.
- Admin role checks are refreshed from the database, reducing stale-session authorization problems.
- Company selection is checked against the user's membership.
- Active company IDs are parsed and validated as positive integers.
- Employee and payroll queries scope records to the active company.
- Blocked normal users are denied access to company-protected routes.
- Admin client mode validates both the target client and target company membership.
- EJS escapes interpolated values by default, reducing ordinary template XSS risks.
- Login and company-selection events are logged with user IDs and masked email addresses rather than passwords.
- Administrative actions are persisted in `audit_logs` with actor, action, target, optional company, metadata, IP, and timestamp.
- State-changing browser requests use same-origin `Origin`/`Referer` validation; the session cookie also uses `SameSite=Lax` by default.
- Login attempts are rate-limited per client IP for a short rolling window.
- Security response headers include content-type sniffing, framing, referrer, permissions, and production HSTS protections.

## 9. Administrative control panel

The admin area extends the original client-management page without replacing the authorization model. It currently provides:

- Dashboard statistics for users, active/blocked users, companies, employees, open reports, and recent admin activity.
- Users list with search, status, company count, limits, details, blocking/unblocking, limit changes, company creation, and support mode.
- Admin user creation with server-side validation, bcrypt hashing, configurable company limits, no initial company memberships, and forced `isAdmin = false`.
- User details with companies and targeted activity history.
- Companies list and company details with owner navigation, employee visibility, payroll/bulletin activity, and validated support-mode entry.
- Audit Logs with action filtering.
- Usage/Limits showing current company count versus `maxCompanies`.
- A System page that intentionally remains informational until real application settings exist.

Company creation is enforced server-side inside a transaction. The existing convention remains that `maxCompanies = 0` means unlimited; positive values are maximum company counts.

The audit actions currently include `BLOCK_USER`, `UNBLOCK_USER`, `CHANGE_COMPANY_LIMIT`, `CREATE_COMPANY`, `ENTER_SUPPORT_MODE`, `EXIT_SUPPORT_MODE`, and `UPDATE_REPORT`.
They also include `CREATE_USER`; its metadata contains account details only and never password material.

## 10. Current limitations and production hardening

The following protections are not currently complete and should be addressed before exposing the application publicly:

- The session secret is currently hardcoded as `secret`; it should be a long random environment variable.
- `secure` cookies are disabled; production should use HTTPS and `secure: true`.
- CSRF protection currently uses same-origin headers rather than a synchronizer token. A token can still be added later if compatibility with clients that omit `Origin` and `Referer` is required.
- Login rate limiting is process-local. A shared store should be used when running multiple application instances.
- Security headers are implemented directly, without Helmet; Helmet can be added if the dependency policy changes.
- The login form contains placeholder “remember me” and password-reset links, but those features are not implemented by the backend.
- Admin access based only on `ADMIN_EMAIL` is convenient for deployment but should be controlled carefully and preferably backed by the database role.
- Authorization errors are returned as plain text rather than a dedicated error page.
- Production must set a strong `SESSION_SECRET`, use HTTPS, and run with `NODE_ENV=production` so secure cookies and HSTS are enabled.

## 11. Summary

The security model is layered:

```text
Password + bcrypt
        -> authenticated server session
        -> isAuth
        -> admin role check for /admin
        -> active company membership check
        -> company-scoped database queries
```

Authentication establishes the user's identity. Role authorization controls administrator-only functions. Company membership controls the tenant boundary for normal payroll operations. Administrative actions are auditable, while support mode keeps the administrator's identity separate from the target client's identity.

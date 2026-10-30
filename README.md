# E-Choir

E-Choir is a multi-choir management application for organizing members, repertoire, and rehearsals. The current milestone includes a React web client, an Express API, PostgreSQL/Prisma persistence, cookie-based authentication, choir-scoped authorization, and core choir workflows.

## Current feature set

- Create a choir workspace with the first administrator account.
- Sign in and out using a hashed, revocable server-side session stored in an HTTP-only cookie.
- Add member accounts directly as a choir administrator, assigning a full name, initial password, choir role, and vocal section.
- Sign in with the choir name, full name, and password; member names must be unique within their choir, and choir names must be unique.
- Save a preferred dashboard language (English, Kinyarwanda, or French). Members can change their own password after signing in.
- Switch between choir memberships.
- View choir dashboard counts, vocal-section distribution, recent songs, and upcoming rehearsals from the database.
- Search members; assign roles/sections and activate or deactivate memberships according to the caller's choir role.
- Restrict member directory visibility by choir role, and retain administrator-visible audit entries for membership changes.
- Create, search, edit, and archive songs.
- Schedule and cancel rehearsals, with input validation and display in the choir's configured timezone.
- Use the Director workspace for attendance, ordered rehearsal agendas, concert and worship event setlists, assigned participants and deadlines, song practice readiness, choir/section announcements, follow-up tasks, rehearsal notes, and CSV reports.
- Attach PDF scores and supported audio/SATB tracks to songs. Uploaded files are limited to 25 MB, stored outside the web root, and served only through authenticated choir-scoped API routes; secure HTTPS resource links are also supported.
- Assign and update vocal sections as a Director without granting role, membership-status, platform-administration, or financial permissions.
- Protect platform-wide administration behind an explicit `SUPER_ADMIN` role, with choir lifecycle controls, global account access management, password reset assistance, announcements, ticket handling, settings, security events, and platform audit history.
- Optionally require Super Admin approval for new choir registrations; pending choir workspaces remain inaccessible to choir members until approved.
- Use the Treasurer dashboard to record externally completed income and expenses, track member dues and authorized exemptions, set contribution policies, manage activity/event budgets, review receipts, approve expenses separately from their recorder, and inspect financial correction/audit histories.
- View per-currency recorded balances, pending approvals, missing-receipt and overdue-contribution alerts, and 12-month income-versus-approved-expense charts. Generate filtered transaction CSVs and annual member contribution registers with each month’s paid/outstanding amount and signature column; the register is print-ready for browser PDF export.
- Upload PDF/JPEG/PNG/WebP receipts (maximum 10 MB) to generated choir-scoped filenames outside the web root. Files are available only through authenticated, Treasurer/Admin-scoped downloads.
- View published system announcements in a choir dashboard and submit support tickets with a private ticket history.
- Export registration analytics and view platform-wide financial records read-only; cross-currency figures are never added together.
- Apply API validation, authentication rate limits, security headers, CORS origin checks, and tenant scoping.

Online payments, transfers, gateways, MFA, backup automation, and storage monitoring are not implemented. The system never processes or verifies funds automatically. Financial totals represent entered records and are not proof of money received or independently verified bank/cash balances. Treasurer CSV files are Excel-compatible; PDF output uses the browser print dialog rather than a server-side PDF generator.

## Requirements

- Node.js 20.19+ (or a compatible newer LTS release)
- npm
- PostgreSQL 15+; alternatively Docker Desktop to run the included Compose service

## Setup on Windows

From the project root in PowerShell:

```powershell
npm install
Copy-Item .env.example server\.env
docker compose up -d postgres
npm run db:generate -w @echoir/server
npm run db:migrate -w @echoir/server
npm run db:seed -w @echoir/server
npm run dev
```

If you created the `echoir_app` database and role in pgAdmin, make sure the `DATABASE_URL` in `server\.env` points to that database and uses the new role password. Apply the checked-in migration to that existing database using:

```powershell
npm run db:deploy -w @echoir/server
```

`prisma migrate dev` is for developing schema changes and may require permission to create a temporary shadow database. For the initial setup, `prisma migrate deploy` applies the existing migration without requiring database-creation privileges. If Docker is unavailable, start your local PostgreSQL server yourself. The API reads `server\.env` when started as an npm workspace; Prisma CLI reads it for schema commands.

The name-login migration removes the old email field and invitation records. It preserves existing account passwords and derives each member's login name from their full name. Before upgrading an existing database, resolve any choir names that differ only by case/spacing and any duplicate member full names within the same choir; the migration stops with an explanation rather than creating ambiguous login names.

The platform-admin and choir-approval migrations add administrative and initial finance tables, columns, and the optional pending-approval status. The Treasurer workspace migration adds contribution policies and exemptions, member-linked finance records, expense approvals, budgets, and protected receipt metadata. Back up the database before deploying pending migrations, especially if it contains data you need to retain. The checked-in migrations have been applied to the configured local database; deploy any newer pending migrations with `npm run db:deploy -w @echoir/server`.

Open the Vite URL printed by the client, normally `http://localhost:5173`. The API is available at `http://localhost:4000/api/v1`; `GET /api/v1/health` checks both the API and database.

Registration creates a new choir and its initial administrator. New registrations are immediately active by default. A Super Admin can turn on approval in Platform > Settings; new registrations will then remain pending until approved from the Choirs panel. New accounts are provisioned by a choir administrator, who shares the member's choir name, full name, and initial password with them privately. The development seed creates sample sections, a sample song, and a sample rehearsal. To also seed a local administrator membership, add `DEMO_NAME` and `DEMO_PASSWORD` (at least 10 characters) to `server\.env` before running the seed command. There are no built-in default credentials.

### Enable the first platform super administrator

Register and sign in with the account that should administer the platform, then obtain that account's UUID from `GET /api/v1/auth/me` while signed in. Put that UUID in `PLATFORM_SUPER_ADMIN_USER_ID` in `server\.env` and run `npm run db:seed -w @echoir/server` after applying migrations. The seed command promotes only that exact existing UUID; the value must be protected like an administrative credential and removed from the environment after bootstrap. Additional platform staff can be granted the role by an active super administrator in the Users panel. Do not grant this role to public/self-service registrations.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` | API port; defaults to `4000` |
| `CLIENT_ORIGIN` | Allowed browser origin; defaults to `http://localhost:5173` |
| `NODE_ENV` | `development`, `test`, or `production` |
| `SESSION_TTL_DAYS` | Session lifetime from 1 to 30 days; defaults to `7` |
| `DEMO_NAME` | Optional development-only seed account full name |
| `DEMO_PASSWORD` | Optional development-only seed password; never use a production credential |
| `PLATFORM_SUPER_ADMIN_USER_ID` | Optional exact account UUID to promote during a controlled seed/bootstrap |

Set a strong, unique PostgreSQL password outside local development. Production deployments must use HTTPS so session cookies are marked `Secure`, configure the correct `CLIENT_ORIGIN`, and protect the database and backups.
The client uses same-origin `/api/v1` requests; serve the built client and reverse-proxy `/api/v1` to Express under the same public origin, or add an explicit API-origin configuration before deploying them on separate domains.

## Useful commands

```powershell
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
npm run db:generate -w @echoir/server
npm run db:migrate -w @echoir/server
npm run db:deploy -w @echoir/server
npm run db:seed -w @echoir/server
```

The unit suites cover core input constraints, role visibility, choir-timezone conversions, finance validation/tenant scoping, contribution requirements, and spreadsheet-safe CSV serialization. Database integration tests still need a dedicated test database and are not included in this milestone.

## Project layout

- `client/` — React, TypeScript, Vite, Tailwind CSS, React Router, TanStack Query, and responsive UI.
- `server/src/` — Express API, authentication/session logic, tenant authorization, validation, and routes.
- `server/prisma/` — PostgreSQL schema, migrations, and development seed.
- `docs/openapi.yaml` — API contract for the implemented endpoints.
- `docker-compose.yml` — local PostgreSQL service.

## API and authorization

All endpoints are versioned under `/api/v1`. Authenticated choir routes are nested under `/api/v1/choirs/:choirId`. Each route verifies an active membership in that active choir server-side and scopes database queries to that choir. Finance records require the choir administrator or treasurer role. Platform APIs require an active account with the separate `SUPER_ADMIN` platform role; choir administrator status alone grants no platform-wide access. Sensitive administrative actions and financial edits carry audit records and reasons.

The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. Only a SHA-256 digest of the high-entropy session token is stored in PostgreSQL. Passwords are hashed with bcrypt. The configured CORS origin is enforced for browser requests.

## Deployment limitations

- The admin health panel reports the live API/database check and process uptime. Backups and file storage are explicitly marked not configured; there is no backup or disk monitor.
- Receipt references are stored as text only; secure attachment storage is not configured.
- Authentication events are logged without submitted credentials or client IP addresses. MFA is not configured.
- Platform registration approvals are not enabled; new workspaces are active on registration. Choir lifecycle status changes are available to platform admins.
- Financial CSV exports are limited to 5,000 rows per request. Choir financial history displays up to 500 records at a time.

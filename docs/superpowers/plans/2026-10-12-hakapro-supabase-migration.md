# Hakapro Supabase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Hakapro's production authentication and data from Supabase to a dedicated private Coolify PostgreSQL database without losing users, ownership, or stored data.

**Architecture:** Provision a separate persistent PostgreSQL service in Coolify, then use Drizzle for the app schema and Better Auth for sessions and Google plus email/password authentication. Move every user data operation behind authenticated server-side modules, rehearse a full data and identity import, then cut production over with Supabase retained as a rollback source until stabilization is complete.

**Tech Stack:** Next.js 16, TypeScript, Better Auth, Drizzle ORM, PostgreSQL, Coolify, Supabase CLI/API for source export, Plane.

**Spec:** `docs/superpowers/specs/2026-10-12-hakapro-supabase-to-coolify-postgres-design.md`

## Global Constraints

- Hakapro uses a PostgreSQL resource separate from `heulaulab-dashboard-db`.
- PostgreSQL is private to the Coolify network, persistent, health-checked, and covered by scheduled backups with retention.
- Existing user UUIDs and Google provider subject IDs remain unchanged; Supabase sessions are not migrated.
- Google and email/password sign-in remain supported; SMTP and Google OAuth configuration are production prerequisites.
- No browser code connects to PostgreSQL or uses Supabase for product data after cutover.
- All private user data reads and writes are authorized on the server and scoped by the authenticated user ID.
- Do not dual-write Supabase and PostgreSQL. Retain Supabase as the rollback source through stabilization.
- Preserve all table data and any objects found in the `user-exports` bucket.
- Never put database, OAuth, SMTP, Better Auth, or job secrets in source control or browser-visible variables.
- Do not add or run automated tests as part of this work; use migration reconciliation and the deployment smoke checks listed below.

## Review Focus

- Existing Google provider IDs must resolve to the original UUIDs; verify the two imported Better Auth account mappings before cutover.
- Private records belonging to one user must never be returned or changed by another user; check this through authenticated product flows during rehearsal.
- Email/password password-reset delivery depends on SMTP; complete a production reset flow before enabling the flow for users.
- Export objects may exist even though application code does not use Storage; inspect bucket inventory and reconcile object count/ownership.
- Writes accepted by the new database make a simple rollback unsafe; document the write boundary and require reconciliation before any post-write rollback.

---

### Task 1: Provision Hakapro PostgreSQL and backup policy in Coolify

**Files:**
- Modify: Coolify resources in project `Heulau Lab`, production environment
- Reference: `docs/superpowers/specs/2026-10-12-hakapro-supabase-to-coolify-postgres-design.md`

**Interfaces:**
- Consumes: Existing Coolify project, environment, app, and server resources.
- Produces: A dedicated private production PostgreSQL resource for Hakapro, an isolated non-production rehearsal target, their internal database URLs, and a documented recurring backup policy. Neither target may reuse `heulaulab-dashboard-db`.

- [ ] Record the current production app configuration and take a recoverable Supabase/source snapshot before any migration changes.
- [ ] Create a dedicated PostgreSQL 17 resource named for Hakapro in the existing Coolify project/environment, with persistent storage, private network access, health checks, and generated credentials.
- [ ] Create an isolated non-production database/resource for migration rehearsal; ensure rehearsal imports cannot reach or overwrite production data.
- [ ] Configure recurring database backups with a retention period and confirm the Coolify resource reports healthy.
- [ ] Store the internal URL and credentials in Coolify only; record non-secret resource identifiers and backup settings in the deployment notes.

### Task 2: Add Drizzle schema, database module, and migration workflow

**Files:**
- Modify: `package.json`, `bun.lock`, `.gitignore`, deployment configuration as needed
- Create: `drizzle.config.ts`, `src/db/schema/*.ts`, `src/server/db/index.ts`, `src/server/db/migrations/*`
- Reference: `../heulaulab-dashboard/src/db/schema/auth.ts` and its Drizzle/PostgreSQL setup

**Interfaces:**
- Consumes: Coolify PostgreSQL internal URL from Task 1.
- Produces: Server-only `db` client and versioned schema/migrations for Better Auth tables and every application table listed in the spec.

- [ ] Add PostgreSQL, Drizzle, and Better Auth dependencies and a Drizzle migration command compatible with Bun.
- [ ] Define auth and application schemas with UUID user IDs, preserved timestamps, ownership keys, and constraints that match existing Supabase data semantics.
- [ ] Create a server-only database module that reads `DATABASE_URL` and cannot enter client bundles.
- [ ] Generate and apply the initial migration against the new non-production database; inspect the resulting tables and constraints.
- [ ] Apply the same migration to the production Coolify database before data import; confirm schema versions match.

### Task 3: Move authentication to Better Auth and retain Google identities

**Files:**
- Modify: `src/server/auth.ts`, `src/server/config/auth.ts`, `src/server/actions/auth.ts`, `src/server/viewer.ts`, `src/components/auth/auth-form.tsx`, `src/proxy.ts`, `src/app/auth/callback/route.ts`, locale auth pages under `src/app/[locale]/(auth)/`
- Create: `src/lib/auth-client.ts`, Better Auth route handler under `src/app/api/auth/[...all]/route.ts`, as required by the installed Better Auth integration
- Reference: `src/lib/auth/auth.test.ts`, `src/server/config/auth.test.ts`, `../heulaulab-dashboard/src/lib/auth.ts`

**Interfaces:**
- Consumes: Drizzle schema and server database client from Task 2.
- Produces: Better Auth server/client configuration, authenticated server session lookup, Google OAuth, email/password auth, and password reset delivery.

- [ ] Replace Supabase session lookup and callback logic with Better Auth server/client handlers while preserving current login, signup, forgot-password, reset-password, and redirect behavior.
- [ ] Configure UUID generation and Drizzle adapter options to match the schema and preserve imported user IDs.
- [ ] Configure Google provider callback for `https://hakapro.heulaulab.xyz/api/auth/callback/google`; keep credentials in Coolify.
- [ ] Configure SMTP-backed password reset and auth email delivery; verify production settings are available before email/password is exposed.
- [ ] Update proxy and server authorization to rely on the Better Auth session and remove Supabase auth cookie handling.

### Task 4: Move user-owned reads and writes to server-side PostgreSQL

**Files:**
- Modify: `src/lib/watchlist.ts`, `src/lib/saved-screens.ts`, `src/lib/alerts-client.ts`, `src/components/layout/command-palette.tsx`, `src/components/market/watch-button.tsx`, `src/app/[locale]/(app)/watchlist/*`, `src/app/[locale]/(app)/alerts/*`
- Create: focused repositories/actions under `src/server/` for watchlists, saved screeners, alerts, and alert events

**Interfaces:**
- Consumes: Better Auth session and Drizzle database from Tasks 2–3.
- Produces: Server-side operations that derive the user ID from the session, and client hooks/components that call server actions or route handlers without database credentials.

- [ ] Implement server-side watchlist list/add/remove operations scoped by the authenticated user ID.
- [ ] Implement saved screener list/create/update/delete operations with user ownership checks.
- [ ] Implement alert list/create/update/delete and alert-event reads with user ownership checks.
- [ ] Replace command palette's Supabase screener query with the new server operation.
- [ ] Remove direct Supabase client imports and product table access from client components; preserve loading, empty, and error behavior.
- [ ] Keep public/reference data reads server-side and restrict shared-table writes to trusted server jobs or administrative paths.

### Task 5: Port scheduled alert evaluation to PostgreSQL

**Files:**
- Modify: `src/app/api/jobs/evaluate-alerts/route.ts`, `src/server/services/alert-job.ts`, `src/server/services/alerts.ts`

**Interfaces:**
- Consumes: PostgreSQL alert repositories and existing `ALERT_JOB_SECRET` validation.
- Produces: The existing scheduled endpoint contract using PostgreSQL only, with the same job authorization and alert evaluation semantics.

- [ ] Replace Supabase service-role access with server-side PostgreSQL queries and writes.
- [ ] Preserve secret validation before database writes and ensure the route does not require a browser session.
- [ ] Run one controlled non-production evaluation and reconcile generated alert events against the source behavior.

### Task 6: Build and rehearse complete source-data import

**Files:**
- Create: versioned migration/export tooling under `scripts/migrations/` and migration notes under `docs/migrations/`
- Reference: `supabase/migrations/20260921002404_initial_schema.sql`, `supabase/migrations/20261004054238_tighten_table_grants.sql`, `supabase/README.md`

**Interfaces:**
- Consumes: Source Supabase credentials supplied through a secure local/Coolify execution context, and the non-production Coolify PostgreSQL database.
- Produces: Repeatable export/import procedure, preserved UUIDs and relationships, Google user/account mappings, and a reconciliation report without secrets or personal data.

- [ ] Inventory every public table and the `user-exports` bucket, record counts only, and take recoverable source and target backups.
- [ ] Export and import every application table, preserving IDs, timestamps, ownership, and foreign-key relationships.
- [ ] Convert the two Google identities into Better Auth user/account records while retaining each original UUID and provider subject ID; do not migrate sessions or fabricate passwords.
- [ ] Copy bucket objects and ownership metadata if present; record the bucket as empty if it has no objects.
- [ ] Reconcile all table counts, auth user/account mappings, representative ownership references, and Storage object counts; fix discrepancies before production use.
- [ ] Document the exact commands and the repeatable final-delta procedure without storing credentials in the repository.

### Task 7: Remove Supabase runtime usage and deployment configuration

**Files:**
- Modify: `src/lib/supabase/*`, `src/proxy.ts`, `src/server/readiness.ts`, `src/server/config/security-headers.ts`, `src/app/api/health/route.ts`, `src/app/api/ready/route.ts`, `Dockerfile`, `README.md`, `docs/MIGRATION.md`, `docs/PROGRESS.md`, `package.json`, `bun.lock`
- Delete: Supabase client/config/types once no production code imports them

**Interfaces:**
- Consumes: All product/auth flows on PostgreSQL and Better Auth from Tasks 3–6.
- Produces: A production build and runtime with no Supabase SDK, URL, publishable key, service-role key, or Supabase auth dependency.

- [ ] Remove Supabase environment requirements from build, health/readiness checks, proxy, security headers, and deployment configuration.
- [ ] Remove `@supabase/ssr`, `@supabase/supabase-js`, Supabase client/types, and dead Supabase auth callback code after all imports are gone.
- [ ] Update deployment and operational documentation with Coolify database setup, migrations, OAuth/SMTP prerequisites, backups, and rollback boundary.
- [ ] Confirm server/client boundaries and production configuration do not expose database or auth secrets.

### Task 8: Production rehearsal, cutover, and stabilization

**Files:**
- Modify: Coolify Hakapro app environment, database resource, deployment settings, and HAKAPRO Plane project
- Reference: `docs/migrations/` procedure created in Task 6

**Interfaces:**
- Consumes: Reconciled production-sized rehearsal, working auth/data flows, backup policy, and final migration procedure.
- Produces: Hakapro serving production traffic from Coolify PostgreSQL with rollback instructions and Plane status updated.

- [ ] Confirm OAuth and SMTP credentials/callbacks, app/database connectivity, backups, and a known-good previous app deployment before scheduling cutover.
- [ ] Take fresh source and target backups, pause Supabase writes, run the final data delta, reconcile, then point the production app at Coolify PostgreSQL and deploy.
- [ ] Before reopening normal traffic, smoke-check Google sign-in for both existing account mappings, email/password signup/sign-in/password reset, watchlist and screener persistence, alert CRUD, and the protected scheduled alert job.
- [ ] Record the timestamp when the new database first accepts production writes; after that point, require write reconciliation before rollback to Supabase.
- [ ] Monitor health, backup completion, and user-data paths through the stabilization window; remove Supabase runtime credentials/dependencies only after stability is confirmed.
- [ ] Update the HAKAPRO Plane project with completion state, final operational endpoints, and no secrets. Keep Supabase retirement as a separate reviewed cleanup action.

## Plan self-review

- Spec coverage: separate private database and backups (Tasks 1–2); Better Auth and identity continuity (Task 3 and Task 6); server-only user data access (Task 4); scheduled jobs (Task 5); complete table and Storage import (Task 6); removal of Supabase runtime config (Task 7); cutover, rollback, stabilization, and Plane tracking (Task 8).
- Step clarity: each task produces a concrete service, interface, migration, or deployable change. OAuth and SMTP credentials are deployment prerequisites and must be configured securely, not committed.
- Type and interface consistency: Tasks 2–3 establish the database and session interfaces consumed by Tasks 4–5; Task 6 imports into the same schema; Tasks 7–8 remove old runtime wiring and deploy that result.
- Review focus: all five high-risk conditions above are explicitly checked during rehearsal or production smoke checks.
- Scope: one integrated plan is appropriate because auth identity, owned records, job execution, and production cutover share the same schema and cannot be delivered independently without temporary broken states.

# Hakapro Supabase to Coolify PostgreSQL Migration Design

## Goal

Move Hakapro's production data and authentication off Supabase onto a dedicated, privately networked PostgreSQL service in Coolify, while keeping the existing Google users and supporting Google plus email/password sign-in after cutover.

## Agreed constraints

- Hakapro's PostgreSQL resource is separate from the Heulaulab Dashboard database.
- The database is reachable by the Hakapro application over Coolify's private network, uses persistent storage, and has scheduled backups.
- Better Auth and Drizzle provide authentication and database access, following the established Heulaulab Dashboard pattern where it fits Hakapro.
- Browser code must not connect directly to PostgreSQL or retain Supabase client access for product data.
- Preserve existing user UUIDs and Google identities. Existing sessions will be invalidated; users will sign in again after cutover.
- Keep Supabase available as a rollback source through the stabilization period. Do not dual-write between Supabase and PostgreSQL.
- The HAKAPRO Plane project tracks this migration as the active phase.

## Current state

Hakapro is deployed at `https://hakapro.heulaulab.xyz` from the `heulaulab-dev/hakapro` repository. Its production runtime currently uses a dedicated Supabase project for authentication and product data. Supabase calls from browser code include watchlists, saved screeners, and alerts; alert evaluation also uses Supabase service access. The app has no current code path for Supabase Storage or Realtime.

The inventory found two Google-authenticated users, one watchlist with five items, and zero rows in the other inspected product tables. The Supabase Auth Admin API does not expose password hashes, and these two users have Google identities. The public schema includes profiles, workspaces, workspace panels, portfolios, portfolio transactions, alerts, alert events, notifications, saved screeners, notes, user preferences, securities, companies, company fundamentals, corporate actions, ownership snapshots, market indices, and market snapshots, in addition to watchlists and watchlist items. The `user-exports` Storage bucket exists; its object count must be checked during migration rehearsal and any existing objects preserved. No Realtime subscriptions were found in the app.

## Architecture

Create a dedicated PostgreSQL resource for Hakapro in Coolify, separate from `heulaulab-dashboard-db`. Give it a persistent volume, private-network-only access, health checks, and scheduled backups with retention. Configure the Hakapro app to use its internal database URL. Keep database credentials and Better Auth secrets in Coolify environment variables; never place them in browser-visible configuration or source control.

Use Drizzle for the application schema and migrations, and Better Auth with its Drizzle adapter for sessions, users, accounts, and email/password credentials. Configure UUID generation to match the existing Supabase user IDs. Import the existing Google users and their provider account identifiers so they continue to resolve to the same application user. New email/password users are supported after cutover; existing users will sign in through Google because no reusable password hashes are available. Configure the Google OAuth client and production callback at `https://hakapro.heulaulab.xyz/api/auth/callback/google`. Configure an SMTP provider for password reset and auth email delivery before enabling email/password flows in production.

Move all user-scoped product reads and writes behind server actions or route handlers. Every operation must obtain the authenticated user from the server-side session and scope reads, writes, updates, and deletes by that user's ID. Public market/reference data can use server-side queries without user ownership checks, while writes to shared/reference tables must be restricted to the appropriate trusted job or administrative path. Replace the Supabase-backed scheduled alert evaluator with a server-side PostgreSQL implementation. Keep externally sourced market data ingestion and unrelated application behavior unchanged.

## Data and identity migration

Define the complete PostgreSQL schema, including Better Auth tables and all application tables currently in Supabase. Preserve UUIDs, timestamps, ownership references, and relevant uniqueness/foreign-key constraints. Rehearse the migration against a non-production Hakapro database before production cutover.

The rehearsal and production migration must:

1. Take a recoverable source backup and a pre-migration Coolify database backup.
2. Export and import every application table, preserving IDs and relationships; compare row counts and verify representative ownership relationships.
3. Import the two users with their existing UUIDs and Google provider account IDs, mapping provider subject IDs to Better Auth accounts without changing user identity.
4. Inspect the `user-exports` bucket. Preserve existing objects and ownership metadata if any exist; otherwise record that it is empty. The app does not gain Storage functionality as part of this migration.
5. Confirm all application tables, auth users, accounts, and migration metadata agree before switching production traffic.

Do not migrate Supabase sessions. Require users to authenticate again. Preserve current Google sign-in. Email/password sign-up, sign-in, and password reset must work for new or subsequently configured credentials after SMTP and OAuth settings are installed.

## Application access and security

Remove Supabase browser clients and direct table access from product flows. The application should use server-side database modules that cannot be imported into client components. Keep privileged job access isolated to the scheduled alert route and validate its existing job secret before running writes. Never expose the PostgreSQL URL, Better Auth secret, OAuth client secret, SMTP credentials, or job secret to the browser.

Replace Supabase-specific row-level security assumptions with explicit server-side authorization checks. The authenticated user ID is the source of ownership for private records. Alert evaluation and other scheduled jobs run with narrowly scoped server credentials and must not rely on a browser session.

## Production cutover and rollback

First deploy the application and schema against the new database in a rehearsal/staging configuration and complete the migration checks. For production, take fresh backups, pause writes or put the old app into a short maintenance/read-only window, copy the final data delta, and switch the production app configuration to the Coolify database. Verify Google sign-in, email/password flows, key user data paths, and scheduled alert evaluation before reopening normal use.

Keep the old Supabase project and a known-good application deployment available through the agreed stabilization period. Before the new database accepts production writes, rollback can switch the app back to the old deployment and Supabase. After PostgreSQL has accepted writes, rollback requires reconciling those writes back to Supabase first; do not silently switch back and lose user changes. Once stability and backups are confirmed, remove Supabase credentials and runtime dependencies from Coolify and retire the old project only as a separately reviewed cleanup step.

## Plane tracking

The HAKAPRO project in the HEULAULAB Plane workspace records this phase as migration from Supabase to dedicated private Coolify PostgreSQL and Better Auth, including identity preservation, server-side data access, and temporary rollback support.

## Acceptance criteria

- Hakapro runs against a dedicated, private Coolify PostgreSQL resource with persistent storage and scheduled backups.
- Existing Google users retain their UUIDs and can sign in with Google after the required OAuth callback configuration is active.
- Email/password sign-up, sign-in, and password reset work after mail delivery is configured.
- Existing application data, relationships, and any stored export objects are preserved and reconciled against the source inventory.
- User-owned reads and writes are authorized server-side and scoped to the authenticated user.
- Scheduled alert evaluation reads and writes PostgreSQL and remains protected by its job secret.
- Production runtime has no Supabase database or auth dependency after cutover and stabilization.
- Supabase remains available as the rollback source until the new deployment is stable and the rollback window is explicitly closed.
- The HAKAPRO Plane project reflects completion status and the final operational endpoints without secrets.

## Out of scope

- Replacing market-data providers or changing market data behavior.
- Adding Realtime or Storage product features.
- Migrating old Supabase sessions or inventing passwords for existing Google-only accounts.
- Decommissioning Supabase before the new system has passed its stabilization period.

# PostgreSQL schema migration

The source of truth is `src/db/schema/index.ts`. The initial versioned SQL migration is in `src/server/db/migrations/`; it creates 20 application tables and five Better Auth tables. Application owner IDs reference `users.id` as UUIDs, so a data import can retain existing user and row identities.

## Generate and apply

- After changing the Drizzle schema, run `bun run db:generate` and commit the generated SQL and metadata. Review the SQL, especially hand maintained functions and triggers.
- Run `bun run db:migrate` in a controlled execution environment with `DATABASE_URL` supplied from that environment's private Coolify PostgreSQL service. The command reads `.env.local` for local development, while an existing environment variable takes precedence. Keep URLs and credentials out of shell history and repository files.
- Apply to the isolated rehearsal database first. Inspect `drizzle.__drizzle_migrations`, `information_schema.tables`, `pg_constraint`, `pg_indexes`, and `information_schema.triggers`. Apply the identical committed migration to production only after the rehearsal result is accepted and before importing production data.

The initial migration should yield 25 public tables, 84 public constraints, 11 public triggers, and one Drizzle migration version on PostgreSQL 17. Both targets must show the same migration version before import. These counts are inspection aids for the initial schema; later migrations will change them.

The former Supabase `auth.uid()` column defaults, row policies, storage policies, and `save_workspace` RPC do not run in standalone PostgreSQL with Better Auth. Authenticated server data modules must supply and enforce the user UUID on every user-owned operation. Do not grant untrusted callers direct database access. The alert-event trigger produces a notification on insert; the import procedure must account for this when loading historical alert events and notifications.

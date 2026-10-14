# Private snapshot import and reconciliation

The importer is `scripts/migrations/supabase-import.ts`. Run it from the repository root with the locked dependencies installed. It reads PostgreSQL COPY text as data; it never executes the Supabase dump SQL. It preserves every column of all 20 application tables, including numeric precision, JSON, timestamps, UUIDs, and ownership references. Google users retain their original UUID and identity UUID; the original Google subject becomes Better Auth `account_id`. No sessions, OAuth tokens, password hashes, or fabricated passwords are imported. Every source user must have exactly one Google identity. Unsupported providers, password-bearing users, noncanonical emails, banned/deleted/anonymous users, or missing mappings block the operation.

The current private snapshot contains two users, two Google identities, one watchlist, five watchlist items, and zero rows in the other 18 application tables. `user-exports` is the sole Storage bucket and contains zero objects. This is the snapshot inventory, not a fresh live source inventory. Bucket metadata remains in the recoverable source backup; standalone PostgreSQL has no Supabase Storage service to restore it into. If a fresh snapshot contains any objects or a different bucket inventory, the tool stops before target writes. Object bytes and their ownership metadata then need a separately reviewed private storage destination and transfer procedure before cutover.

## Execution prerequisites

Run on a trusted Coolify server/container attached to the private `coolify` network. Install Bun from the project's pinned toolchain, locked dependencies, and `pg_dump` compatible with both database server versions (PostgreSQL 17 for the target). Use the committed migration branch. Transfer the private snapshot over an authenticated encrypted connection to a directory outside the repository; do not add it to a build context, Git, logs, a public volume, or an image layer. Use mode 700 for its directory and mode 600 for files. Only the execution user may own/read them. Preserve a secure recovery copy before removing the worktree or temporary runner.

The runtime environment supplies these variables privately; never paste connection strings into commands or chat:

| Variable | Required by | Value or purpose |
| --- | --- | --- |
| `MIGRATION_SNAPSHOT_DIR` | All modes | Absolute private snapshot directory containing `data.sql` and `manifest.json` |
| `REHEARSAL_DATABASE_URL` | import/reconcile | Secret connection URL to resource `4djsh2ikffzhfbjlt0xzu0oq`, database `hakapro_rehearsal` |
| `REHEARSAL_WRITES_PAUSED` | import | `yes`, after stopping rehearsal app/job writes |
| `MIGRATION_BACKUP_DIR` | import | Existing private directory outside the repo for pre-import custom-format target backups |
| `SOURCE_DATABASE_URL` | export | Secret direct/session source database connection, supplied only to the export runner |
| `SOURCE_WRITES_PAUSED` | export | `yes`, after freezing all source writers |

The script pins the target hostname and actual database name to the rehearsal resource. It rejects production and Dashboard database URLs. It also checks every committed Drizzle migration hash and the exact target table inventory before loading data. The tool deliberately has no production override. Production import needs a separately reviewed target-control change during task 8 after rehearsal is accepted.

## Snapshot and source recovery backup

An existing task 1 snapshot is usable for rehearsal; its manifest is checked before reading data. For a fresh snapshot, choose a new directory that does not already exist, stop all source writes, and inject the export variables through the execution environment. Do not release the source freeze between the export passes. Run:

```sh
bun scripts/migrations/supabase-import.ts export
```

This creates a custom-format recoverable `source.dump`, a schema-only `schema.sql`, a COPY-format `data.sql`, and SHA-256 manifest entries, all private. It exports the complete `public`, `auth`, and `storage` schemas, including source auth sessions in the recovery backup only. The backup preserves source ownership relationships but omits platform role/grant definitions; use the retained task 1 `roles.sql` and original Supabase platform when restoring those. Failed/unsupported exports retain their files for investigation and are never imported without a complete valid manifest. Use a new directory on retry.

The custom backup and data snapshot are separate pg_dump transactions. They describe the same data only when source writes remain frozen. This is required for the final snapshot and recovery backup. A logical backup is not evidence of a successful restore: perform a controlled recovery drill and record its result before claiming recoverability.

The procedure follows [Supabase's backup guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) and uses [PostgreSQL COPY text escaping](https://www.postgresql.org/docs/17/sql-copy.html). Auth/Storage SQL, RLS, roles, RPCs, and Supabase migration history are not applied to standalone PostgreSQL.

## Rehearsal commands

With private environment variables already injected, run these exact commands from the repository root:

```sh
bun scripts/migrations/supabase-import.ts inventory
```

Apply the committed Drizzle migrations to the rehearsal database using its separately injected `DATABASE_URL` (same rehearsal resource) in the controlled runner:

```sh
bun run db:migrate
bun scripts/migrations/supabase-import.ts import
bun scripts/migrations/supabase-import.ts reconcile
```

`import` creates a custom-format target backup before target writes. Keep the target write freeze active for both backup and import. Inside one transaction it locks all 25 tables, loads temporary staging tables, and imports only when all application and auth tables are empty. A target already identical to the snapshot is accepted without changing it. A partial or divergent target is rejected; it is never truncated, overwritten, or merged automatically. For another snapshot, retain the previous target backup and provision a fresh isolated rehearsal database/schema through a reviewed operation.

Only the named `alert_event_notification` trigger is disabled during historical insertion and restored before commit. Foreign keys and checks remain enabled throughout. A rollback restores the trigger state and removes staged data. This prevents duplicate historical notifications and retains source timestamps. The tool compares every source/target row in both directions, including all fields, and requires zero differences. It checks validated foreign keys/check constraints, Google mappings, and empty Better Auth runtime tables. Its stdout contains only table names, counts, snapshot hash, and pass/status flags. Its stderr never serializes database errors or offending rows. Keep these count reports as operational evidence.

## Final snapshot and delta procedure

A full frozen snapshot replaces an incremental delta for this migration. Before production cutover, stop every writer: web mutations, auth signups/profile writes, market imports, and scheduled alert evaluation. Create a new source backup/snapshot with `export`, then inventory it again. Rehearse this final snapshot on an empty isolated target and require full reconciliation with zero differences. Check the final counts against the frozen source and verify Google login, ownership boundaries, and email delivery with the application's operational smoke checks.

After accepted rehearsal, task 8 must add/review production target pinning, verify a fresh production recovery backup and the identical Drizzle migration hashes, then import the same frozen snapshot into the empty production database and reconcile it before enabling app writes. Keep source writes frozen until the routing/app switch is confirmed. Existing sessions are intentionally invalidated, so users sign in again. If writes have already reached the new target, rollback requires an explicitly reviewed data reconciliation; simply switching back would lose those writes.

## Current operational status

The inventory mode has successfully processed the private task 1 snapshot without displaying row contents. No Coolify database schema or data has been modified by this tooling task. Live rehearsal is outstanding: a trusted in-network runner, secure snapshot transfer, rehearsal-only secret injection, migration application, target backup, import/reconciliation, and a restore drill are still needed. Typecheck/lint are static checks; they do not demonstrate a completed import.

## Transient Coolify runner and secret transfer

A source-only image is defined in `scripts/migrations/Dockerfile`, built with the repository root as context. It copies an explicit allowlist of source/dependencies; no snapshot, dotenv file, or worktree metadata is copied. Bun is pinned to 1.3.14 and the PostgreSQL client uses the PostgreSQL 17 image. The default command inventories the transfer snapshot and exits. Run it as a one-shot job on the private `coolify` network; disable automatic restarts and domain exposure. Mount a dedicated private persistent backup directory at `/backups` with owner matching the image's `postgres` user, mode 700, and no public access. Retain that backup independently before deleting the runner.

On the trusted workstation, create a private output file using environment paths already supplied:

```sh
bun scripts/migrations/snapshot-transfer.ts pack
```

This requires `MIGRATION_SNAPSHOT_DIR` and `SNAPSHOT_TRANSFER_FILE`. It validates the snapshot, gzips only `data.sql` and its manifest, and writes base64 to the new private transfer file. It prints only the byte count. Load that file directly into a transient hidden Coolify runtime secret named `MIGRATION_SNAPSHOT_GZIP_BASE64` through an authenticated management client; never use a CLI argument containing its value, print it, or configure it as a build variable. The wrapper limits the encoded secret to 100,000 bytes; larger snapshots require authenticated encrypted file transfer and the direct importer instead.

Inject `REHEARSAL_DATABASE_URL` using the internal URL for resource `4djsh2ikffzhfbjlt0xzu0oq`, database `hakapro_rehearsal`, as a hidden runtime secret. Coolify uses the database resource UUID as its internal hostname. If its generated internal URL differs, inspect the nonsecret hostname and resolve the alias on the private network; do not relax the guard to arbitrary URLs. The wrapper materializes fixed filenames in a new mode-700 temporary directory, mode-600 files, removes the transfer variable from the process environment before launching any subprocess, and cleans the files after successful or failed execution. It never logs source values.

Use these container commands (same source-only image) in sequence:

```sh
bun scripts/migrations/snapshot-transfer.ts inventory
bun run db:migrate
bun scripts/migrations/snapshot-transfer.ts import
bun scripts/migrations/snapshot-transfer.ts reconcile
```

For `db:migrate`, supply `DATABASE_URL` privately with the same rehearsal URL and override the image entrypoint to `bun`; its command becomes `run db:migrate`. For the other commands, the default image entrypoint already invokes the wrapper, so set the one-shot job argument to `inventory`, `import`, or `reconcile`. Keep the write freeze active and maintain the mounted backup directory across invocations. `pg_dump` is invoked only by `export` and `import`; inventory and reconcile do not need a working client binary.

After the runner completes, the controlling Coolify management client must delete the persisted `MIGRATION_SNAPSHOT_GZIP_BASE64` environment entry, verify that its key is absent, remove the private transfer file on the workstation, and remove the temporary runner resource/container. Repeat this cleanup after failures; never leave a runner scheduled to restart with the snapshot secret. Process cleanup cannot remove Coolify's stored secret, so this is an explicit management step. The runner does not receive a Coolify API token. Preserve the recovery backups and counts-only reconciliation reports in secure storage before removing temporary volumes.

# Private snapshot import and reconciliation

The importer is `scripts/migrations/supabase-import.ts`. Run it from the repository root with the locked dependencies installed. It reads PostgreSQL COPY text as data; it never executes the Supabase dump SQL. It preserves every column of all 20 application tables, including numeric precision, JSON, timestamps, UUIDs, and ownership references. Google users retain their original UUID and identity UUID; the original Google subject becomes Better Auth `account_id`. No sessions, OAuth tokens, password hashes, or fabricated passwords are imported. Every source user must have exactly one Google identity. Unsupported providers, password-bearing users, noncanonical emails, banned/deleted/anonymous users, or missing mappings block the operation.

The current private snapshot contains two users, two Google identities, one watchlist, five watchlist items, and zero rows in the other 18 application tables. `user-exports` is the sole Storage bucket and contains zero objects. This is the snapshot inventory, not a fresh live source inventory. Bucket metadata remains in the recoverable source backup; standalone PostgreSQL has no Supabase Storage service to restore it into. If a fresh snapshot contains any objects or a different bucket inventory, the tool stops before target writes. Object bytes and their ownership metadata then need a separately reviewed private storage destination and transfer procedure before cutover.

## Execution prerequisites

Run on a trusted Coolify server/container attached to the private `coolify` network. Install Bun from the project's pinned toolchain, locked dependencies, and `pg_dump` compatible with both database server versions (PostgreSQL 17 for the target). Use the committed migration branch. Transfer the private snapshot over an authenticated encrypted connection to a directory outside the repository; do not add it to a build context, Git, logs, a public volume, or an image layer. Use mode 700 for its directory and mode 600 for files. Only the execution user may own/read them. Preserve a secure recovery copy before removing the worktree or temporary runner.

The runtime environment supplies these variables privately; never paste connection strings into commands or chat:

| Variable | Required by | Value or purpose |
| --- | --- | --- |
| `MIGRATION_SNAPSHOT_DIR` | All modes | Absolute private snapshot directory containing `data.sql` and `manifest.json` |
| `REHEARSAL_DATABASE_URL` | rehearsal import/reconcile | Secret connection URL to resource `4djsh2ikffzhfbjlt0xzu0oq`, database `hakapro_rehearsal` |
| `REHEARSAL_WRITES_PAUSED` | import | `yes`, after stopping rehearsal app/job writes |
| `MIGRATION_BACKUP_DIR` | import | Existing private directory outside the repo for pre-import custom-format target backups |
| `PRODUCTION_DATABASE_URL` | production-import/production-reconcile | Secret connection URL pinned to Coolify DB resource `luspjrb3ibvzma6yc1ilicum`, database `hakapro` |
| `PRODUCTION_IMPORT_ENABLED` | production-import | Must be exactly `yes` to opt into the production data write path |
| `PRODUCTION_WRITES_PAUSED` | production-import | Must be exactly `yes` after target writes are confirmed paused |
| `SOURCE_DATABASE_URL` | export | Secret direct/session source database connection, supplied only to the export runner |
| `SOURCE_WRITES_PAUSED` | export | `yes`, after freezing all source writers |

The script pins rehearsal modes to the rehearsal hostname and database, and production modes to Coolify resource `luspjrb3ibvzma6yc1ilicum` and database `hakapro`. The paths do not share an override flag. Both compare every installed migration hash with the committed Drizzle files and compare the exact public table and ordered column/type inventory with those migration files before loading data. Production writes additionally require both explicit `yes` gates. `production-reconcile` is read-only and prints counts/status only.

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

Every successful import or reconciliation requires the named `alert_event_notification` trigger to exist and be enabled before and after the operation. Only that trigger is disabled during historical insertion and restored before commit. Foreign keys and checks remain enabled throughout. A rollback restores the trigger state and removes staged data. This prevents duplicate historical notifications and retains source timestamps. The tool compares every source/target row in both directions, including all fields, and requires zero differences. Staging casts each raw COPY value through PostgreSQL text directly into its target column type. Public JSONB never passes through JavaScript numeric parsing, so large integers/decimals remain exact and JSON literal null remains distinct from SQL NULL. Reconciliation compares native typed columns in both directions using EXCEPT ALL, preserving the difference between SQL NULL and JSONB literal null throughout the comparison. It checks validated foreign keys/check constraints, Google mappings, and empty Better Auth runtime tables. Its stdout contains only table names, counts, snapshot hash, and pass/status flags. Its stderr never serializes database errors or offending rows. Keep these count reports as operational evidence.

## Final snapshot and delta procedure

A full frozen snapshot replaces an incremental delta for this migration. Before production cutover, stop every writer: web mutations, auth signups/profile writes, market imports, and scheduled alert evaluation. Create a new source backup/snapshot with `export`, then inventory it again. Rehearse this final snapshot on an empty isolated target and require full reconciliation with zero differences. Check the final counts against the frozen source and verify Google login, ownership boundaries, and email delivery with the application's operational smoke checks.

After accepted rehearsal, production data import is a separate database-only operation. It applies the committed Drizzle migration to the pinned production database, creates a fresh frozen Supabase snapshot, imports that snapshot into the production database, and reconciles it while the production application remains configured for Supabase. The importer never deploys or reconfigures the app. Before scheduling it, require a successful restore drill of the production target backup into an isolated database and retain evidence of that restore, then confirm backup retention and the reviewed exact migrations/schema inventory. A fresh source snapshot and its recovery backup must be made while every Supabase writer is paused; this is a future operational prerequisite, not part of this code change. The production write gates and Coolify access are injected only for the controlled import window. The importer also creates and retains a new custom-format backup of the production target immediately before beginning.

For this phase the target must be newly migrated and empty. If it contains data, only a target already identical to the frozen snapshot is accepted without writes; partial or divergent state fails reconciliation and rolls the transaction back. The importer never truncates, overwrites, or merges. Keep source/target writer pauses in force during snapshot, backup, import and reconciliation. Once counts-only reconciliation succeeds, the app can remain on Supabase pending the separately scheduled auth/SMTP and app cutover. Do not treat this data-only import as cutover readiness by itself. At the later cutover, existing sessions are intentionally invalidated, so users sign in again. If writes have reached the new target, rollback requires an explicitly reviewed data reconciliation; simply switching back would lose those writes.

In the private migration runner, inject `PRODUCTION_DATABASE_URL` only as a hidden runtime secret for the pinned resource/database, `PRODUCTION_IMPORT_ENABLED=yes`, `PRODUCTION_WRITES_PAUSED=yes`, and the existing private `MIGRATION_BACKUP_DIR`. Transfer a fresh snapshot by the already documented encrypted file/secret mechanism. Then run these commands separately, in order:

```sh
bun scripts/migrations/snapshot-transfer.ts inventory
env -u MIGRATION_SNAPSHOT_GZIP_BASE64 bun run db:migrate
bun scripts/migrations/snapshot-transfer.ts production-import
bun scripts/migrations/snapshot-transfer.ts production-reconcile
```

Retain the target custom-format backup and counts-only reconciliation output in secure storage. Remove temporary runner tasks and snapshot transfer secret after success or failure. This procedure does not change the production app's Supabase configuration; the source may only resume writes after the frozen-import window is explicitly closed by the operator.

## Current operational status

On 2026-10-14, the controlled private Coolify rehearsal applied the committed schema, created a private target backup, and imported/reconciled the retained task 1 snapshot. All 22 imported tables had zero mismatches; 2 users and 2 Google accounts mapped, all foreign keys validated, and Storage had one bucket with zero objects. A reconciliation rerun succeeded. The backup is retained mode 0600 in the dedicated rehearsal volume. Temporary runner secrets/tasks and local transfer file were removed; the runner is stopped. A restore drill, app/job smoke checks and the final frozen-source snapshot remain outstanding before production cutover. Typecheck/lint are static checks and do not replace these operational results.

## Transient Coolify runner and secret transfer

A source-only image is defined in `scripts/migrations/Dockerfile`, built with the repository root as context. It copies an explicit allowlist of source/dependencies; no snapshot, dotenv file, or worktree metadata is copied. Bun is pinned to 1.3.14 and the PostgreSQL client uses the PostgreSQL 17 image. The default command is `sleep infinity`; the private application container remains running so Coolify can execute tasks inside it. It has no HTTP server or exposed domain. Use a dedicated named Volume Mount at `/backups`, not a Directory Mount or bind mount. The image creates `/backups` with the image's `postgres` UID/GID and mode 700; Docker's first-use volume copy-up carries those permissions to a fresh named volume. Do not use `volume-nocopy`. The importer checks directory owner, exact mode 700 and read/write/traverse access before creating a backup. A mismatched/reused volume fails closed; provision a new dedicated volume rather than modifying an unrelated volume's permissions. Retain that backup independently before deleting the runner.

On the trusted workstation, create a private output file using environment paths already supplied:

```sh
bun scripts/migrations/snapshot-transfer.ts pack
```

This requires `MIGRATION_SNAPSHOT_DIR` and `SNAPSHOT_TRANSFER_FILE`. It validates the snapshot, gzips only `data.sql` and its manifest, and writes base64 to the new private transfer file. It prints only the byte count. Load that file directly into a transient hidden Coolify runtime secret named `MIGRATION_SNAPSHOT_GZIP_BASE64` through an authenticated management client; never use a CLI argument containing its value, print it, or configure it as a build variable. The wrapper limits the encoded secret to 100,000 bytes; larger snapshots require authenticated encrypted file transfer and the direct importer instead.

Inject `REHEARSAL_DATABASE_URL` using the internal URL for resource `4djsh2ikffzhfbjlt0xzu0oq`, database `hakapro_rehearsal`, as a hidden runtime secret. Coolify uses the database resource UUID as its internal hostname. If its generated internal URL differs, inspect the nonsecret hostname and resolve the alias on the private network; do not relax the guard to arbitrary URLs. The wrapper materializes fixed filenames in a new mode-700 temporary directory, mode-600 files, removes the transfer variable from the process environment before launching any subprocess, and cleans the files after successful or failed execution. It never logs source values.

Create the runner resource as follows, after pushing the reviewed commit:

1. In Heulau Lab, environment `hakapro-rehearsal`, select + New and the existing GitHub App/private repository `heulaulab-dev/hakapro`; select branch `codex/hakapro-supabase-migration` and the same server/private destination as rehearsal PostgreSQL.
2. Name it `hakapro-migration-runner`; choose Dockerfile build strategy, Base Directory `/`, Dockerfile Location `/scripts/migrations/Dockerfile`. Keep the default command `sleep infinity`. Disable automatic deploys, preview deploys, HTTP health checks and domain generation; leave Domains empty and host port mappings empty. This runner listens on no port.
3. Under Persistent Storage, Add > Volume Mount, name it `hakapro-rehearsal-import-backups` and set Destination Path `/backups`. Use a fresh dedicated volume, retain copy-up, and keep it across runner redeploys. Do not select Directory Mount.
4. Add only runtime secrets: the transfer variable, rehearsal URL, `DATABASE_URL` with the identical rehearsal URL, and `REHEARSAL_WRITES_PAUSED=yes` after stopping rehearsal writers. None are build variables. `MIGRATION_BACKUP_DIR=/backups` comes from the image.
5. Deploy, verify the container is running privately, then open its Terminal or use Scheduled Tasks immediate execution. Before import, verify backup directory mode/owner/access with the following command; it prints only status booleans:

```sh
bun -e 'const fs=require("node:fs"); const s=fs.statSync("/backups"); const ok=s.isDirectory() && s.uid===process.getuid() && (s.mode & 511)===448; if(!ok) process.exit(1); fs.accessSync("/backups",fs.constants.R_OK|fs.constants.W_OK|fs.constants.X_OK); console.log(JSON.stringify({backupDirectoryPrivate:true,backupDirectoryOwned:true,backupDirectoryWritable:true}));'
```

Run these commands inside that running container in sequence:

```sh
bun scripts/migrations/snapshot-transfer.ts inventory
env -u MIGRATION_SNAPSHOT_GZIP_BASE64 bun run db:migrate
bun scripts/migrations/snapshot-transfer.ts import
bun scripts/migrations/snapshot-transfer.ts reconcile
```

For immediate execution, open Scheduled Tasks > + Add on the runner and create one task per command, with the command entered exactly as above (no `docker exec`), timeout 600 seconds, and a valid annual frequency `0 0 1 1 *`. Add task creates it enabled; immediately select Disable to prevent recurring execution, then use Execute now for the manual run. Select Execute now on the inventory task and inspect its counts-only recent execution output before continuing. Execute the migration, import, and reconciliation tasks separately in order, confirming success and zero mismatches before the next step. The application's Terminal can execute the same commands directly when available.

Keep the target write freeze active and maintain the mounted backup directory across commands. `env -u` prevents the database migration subprocess from inheriting the transfer secret. `pg_dump` is invoked only by `export` and `import`; inventory and reconcile do not need a working client binary. Never override the Dockerfile command with an inventory command: that would stop the container needed by Coolify task execution.

These settings follow Coolify's [Dockerfile resource configuration](https://coolify.io/docs/applications/builds/dockerfile), [scheduled-task immediate execution](https://coolify.io/docs/applications/operations/scheduled-tasks), and [named volume mount workflow](https://coolify.io/docs/core/persistent-storage/storage-mounts/overview). Docker documents [first-use volume copy-up](https://docs.docker.com/engine/storage/volumes/#mounting-a-volume-over-existing-data).

After reconciliation completes, the controlling Coolify management client must delete the persisted `MIGRATION_SNAPSHOT_GZIP_BASE64` environment entry, verify that its key is absent, remove the private transfer file on the workstation, and delete the temporary scheduled tasks and remove the runner resource/container. The long-lived sleeping container retains its original environment until it is removed; deleting the persisted secret alone is insufficient cleanup. Repeat this cleanup after failures; never leave a runner scheduled to restart with the snapshot secret. Process cleanup cannot remove Coolify's stored secret, so this is an explicit management step. The runner does not receive a Coolify API token. Preserve the recovery backups and counts-only reconciliation reports in secure storage before removing temporary volumes.

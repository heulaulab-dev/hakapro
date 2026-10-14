/** Private COPY snapshot importer. Never execute source SQL or print source rows. */
import { createHash } from "node:crypto";
import { readFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import postgres from "postgres";

const tables = ["profiles", "watchlists", "watchlist_items", "workspaces", "workspace_panels", "portfolios", "portfolio_transactions", "alerts", "alert_events", "notifications", "saved_screeners", "notes", "user_preferences", "securities", "companies", "company_fundamentals", "corporate_actions", "ownership_snapshots", "market_indices", "market_snapshots"] as const;
const authTables = ["users", "accounts", "sessions", "verifications", "rate_limits"];
const importOrder = ["users", "accounts", ...tables];
type Row = Record<string, unknown>;
type Section = { columns: string[]; rows: Row[] };
class MigrationError extends Error {}
function requireCondition(value: unknown, code: string): asserts value { if (!value) throw new MigrationError(code); }
function required(name: string) { const value = process.env[name]; requireCondition(value, `MISSING_${name}`); return value; }
const identifier = /^[a-z_][a-z0-9_]*$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
async function privateDirectory(path: string) {
  const stat = await lstat(path);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), "UNSAFE_PRIVATE_DIRECTORY");
}
async function privateRead(path: string) {
  const stat = await lstat(path);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.(), "UNSAFE_PRIVATE_FILE");
  return readFile(path, "utf8");
}
// Decode PostgreSQL COPY text without confusing a literal \\N with SQL NULL.
function decode(value: string): string | null {
  if (value === "\\N") return null;
  const chunks: Buffer[] = [];
  let cursor = 0;
  const escapes = /\\([0-7]{1,3}|x[0-9a-fA-F]{1,2}|[\s\S])/g;
  for (const match of value.matchAll(escapes)) {
    chunks.push(Buffer.from(value.slice(cursor, match.index), "utf8"));
    const escape = match[1];
    if (/^[0-7]+$/.test(escape)) chunks.push(Buffer.from([parseInt(escape, 8)]));
    else if (/^x[0-9a-fA-F]+$/.test(escape)) chunks.push(Buffer.from([parseInt(escape.slice(1), 16)]));
    else chunks.push(Buffer.from(({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" } as Record<string, string>)[escape] ?? escape, "utf8"));
    cursor = match.index! + match[0].length;
  }
  chunks.push(Buffer.from(value.slice(cursor), "utf8"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}
function parseDump(data: string) {
  const sections = new Map<string, Section>();
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("COPY ")) continue;
    const match = /^COPY "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"? \(([^)]+)\) FROM stdin;$/.exec(lines[i]);
    requireCondition(match, "UNSUPPORTED_COPY_HEADER");
    const key = `${match[1]}.${match[2]}`;
    const columns = match[3].split(", ").map((s) => s.replace(/^"|"$/g, ""));
    requireCondition(columns.every((column) => identifier.test(column)) && new Set(columns).size === columns.length && !sections.has(key), "INVALID_COPY_COLUMNS");
    const rows: Row[] = [];
    while (++i < lines.length && lines[i] !== "\\.") {
      const values = lines[i].split("\t");
      requireCondition(values.length === columns.length, "INVALID_COPY_ROW");
      rows.push(Object.fromEntries(columns.map((column, index) => [column, decode(values[index])])));
    }
    requireCondition(lines[i] === "\\.", "TRUNCATED_COPY_SECTION");
    sections.set(key, { columns, rows });
  }
  requireCondition(sections.size > 0 && !/^INSERT INTO /m.test(data), "COPY_SNAPSHOT_REQUIRED");
  return sections;
}
function section(sections: Map<string, Section>, name: string) { const found = sections.get(name); requireCondition(found, "MISSING_SOURCE_TABLE"); return found; }
function jsonObject(value: unknown): Row { requireCondition(typeof value === "string", "INVALID_AUTH_METADATA"); const result = JSON.parse(value); requireCondition(result && typeof result === "object" && !Array.isArray(result), "INVALID_AUTH_METADATA"); return result; }
function text(value: unknown, code: string): string { requireCondition(typeof value === "string" && value.length > 0, code); return value; }
function transformAuth(sections: Map<string, Section>) {
  const sourceUsers = section(sections, "auth.users").rows;
  const identities = section(sections, "auth.identities").rows;
  requireCondition(new Set(sourceUsers.map((r) => r.id)).size === sourceUsers.length, "DUPLICATE_SOURCE_USERS");
  const users = sourceUsers.map((row): Row => {
    requireCondition(uuid.test(text(row.id, "INVALID_USER_ID")) && !row.deleted_at && !row.banned_until && row.is_anonymous !== "t" && !row.encrypted_password && !row.phone, "UNSUPPORTED_SOURCE_USER");
    const email = text(row.email, "USER_EMAIL_REQUIRED");
    requireCondition(email === email.trim().toLowerCase(), "NONCANONICAL_USER_EMAIL");
    const meta = jsonObject(row.raw_user_meta_data);
    return { id: row.id, name: typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : email, email, email_verified: Boolean(row.email_confirmed_at), image: typeof meta.avatar_url === "string" ? meta.avatar_url : null, created_at: text(row.created_at, "USER_TIMESTAMP_REQUIRED"), updated_at: text(row.updated_at ?? row.created_at, "USER_TIMESTAMP_REQUIRED") };
  });
  requireCondition(new Set(users.map((r) => r.email)).size === users.length, "DUPLICATE_USER_EMAIL");
  const userIds = new Set(users.map((r) => r.id));
  const accounts = identities.map((row): Row => {
    requireCondition(row.provider === "google" && userIds.has(row.user_id) && uuid.test(text(row.id, "INVALID_IDENTITY_ID")), "UNSUPPORTED_SOURCE_IDENTITY");
    const meta = jsonObject(row.identity_data);
    const subject = text(meta.sub, "GOOGLE_SUBJECT_REQUIRED");
    requireCondition(row.provider_id === subject, "GOOGLE_SUBJECT_MISMATCH");
    return { id: row.id, user_id: row.user_id, provider_id: "google", account_id: subject, access_token: null, refresh_token: null, id_token: null, access_token_expires_at: null, refresh_token_expires_at: null, scope: null, password: null, created_at: text(row.created_at, "IDENTITY_TIMESTAMP_REQUIRED"), updated_at: text(row.updated_at ?? row.created_at, "IDENTITY_TIMESTAMP_REQUIRED") };
  });
  requireCondition(new Set(accounts.map((r) => r.account_id)).size === accounts.length && accounts.length === users.length && users.every((user) => accounts.filter((account) => account.user_id === user.id).length === 1), "INCOMPLETE_GOOGLE_USER_MAPPING");
  return { users, accounts };
}
export async function loadSnapshot(directory: string) {
  await privateDirectory(directory);
  const data = await privateRead(join(directory, "data.sql"));
  const manifest: Record<string, unknown> = JSON.parse(await privateRead(join(directory, "manifest.json")));
  const entry = manifest["data.sql"];
  const expected = typeof entry === "string" ? entry : entry && typeof entry === "object" && "sha256" in entry ? entry.sha256 : null;
  requireCondition(expected === digest(data), "SNAPSHOT_HASH_MISMATCH");
  const sections = parseDump(data);
  const publicNames = [...sections.keys()].filter((s) => s.startsWith("public.")).map((s) => s.slice(7));
  requireCondition(publicNames.length === tables.length && publicNames.every((s) => (tables as readonly string[]).includes(s)), "SOURCE_PUBLIC_TABLE_DRIFT");
  const buckets = section(sections, "storage.buckets").rows;
  requireCondition(buckets.length === 1 && buckets[0].id === "user-exports", "STORAGE_BUCKET_DRIFT");
  const objects = section(sections, "storage.objects").rows;
  requireCondition(objects.length === 0, "STORAGE_OBJECT_TRANSFER_REQUIRED");
  const auth = transformAuth(sections);
  const rows = new Map<string, Row[]>([["users", auth.users], ["accounts", auth.accounts], ...tables.map((table): [string, Row[]] => [table, section(sections, `public.${table}`).rows])]);
  return { sections, rows, snapshotSha256: digest(data), counts: Object.fromEntries([...rows].map(([table, values]) => [table, values.length])), storage: { buckets: buckets.length, objects: objects.length } };
}
function pgEnvironment(url: string) {
  const parsed = new URL(url);
  requireCondition(["postgres:", "postgresql:"].includes(parsed.protocol) && !parsed.search, "UNSUPPORTED_DATABASE_URL");
  return { ...process.env, PGCLIENTENCODING: "UTF8", PGHOST: parsed.hostname, PGPORT: parsed.port || "5432", PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password), PGDATABASE: decodeURIComponent(parsed.pathname.slice(1)) };
}
async function pgDump(url: string, args: string[], output: string) {
  await new Promise<void>((success, failure) => {
    const child = spawn("pg_dump", [...args, "--file", output], { env: pgEnvironment(url), stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", () => failure(new MigrationError("PG_DUMP_UNAVAILABLE")));
    child.once("exit", (code) => code === 0 ? success() : failure(new MigrationError("PG_DUMP_FAILED")));
  });
}
async function exportSnapshot(directory: string) {
  requireCondition(required("SOURCE_WRITES_PAUSED") === "yes", "SOURCE_WRITE_FREEZE_REQUIRED");
  await mkdir(directory, { mode: 0o700 }); // Refuse overwriting an earlier recovery snapshot.
  const url = required("SOURCE_DATABASE_URL");
  const scope = ["--schema=public", "--schema=auth", "--schema=storage", "--no-owner", "--no-privileges"];
  await pgDump(url, [...scope, "--format=custom"], join(directory, "source.dump"));
  await pgDump(url, [...scope, "--schema-only"], join(directory, "schema.sql"));
  await pgDump(url, [...scope, "--data-only"], join(directory, "data.sql"));
  const { chmod } = await import("node:fs/promises");
  for (const name of ["source.dump", "schema.sql", "data.sql"]) await chmod(join(directory, name), 0o600);
  const manifest = Object.fromEntries(await Promise.all(["source.dump", "schema.sql", "data.sql"].map(async (name) => [name, { sha256: digest(await readFile(join(directory, name))) }])));
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  return loadSnapshot(directory);
}
export async function runMigration() {
  process.umask(0o077);
  const mode = process.argv[2];
  requireCondition(["export", "inventory", "import", "reconcile"].includes(mode), "USAGE_export_inventory_import_reconcile");
  const directory = resolve(required("MIGRATION_SNAPSHOT_DIR"));
  const snapshot = mode === "export" ? await exportSnapshot(directory) : await loadSnapshot(directory);
  if (mode === "export" || mode === "inventory") { console.log(JSON.stringify({ mode, snapshotSha256: snapshot.snapshotSha256, counts: snapshot.counts, storage: snapshot.storage })); return; }
  const url = required("REHEARSAL_DATABASE_URL");
  const parsed = new URL(url);
  requireCondition(parsed.hostname === "4djsh2ikffzhfbjlt0xzu0oq" && parsed.pathname === "/hakapro_rehearsal", "REHEARSAL_TARGET_REQUIRED");
  const client = postgres(url, { max: 1, onnotice: () => {}, debug: false, connect_timeout: 10 });
  try {
    const [identity] = await client`select current_database() as name`;
    requireCondition(identity.name === "hakapro_rehearsal", "REHEARSAL_TARGET_REQUIRED");
    if (mode === "import") {
      requireCondition(required("REHEARSAL_WRITES_PAUSED") === "yes", "TARGET_WRITE_FREEZE_REQUIRED");
      const backups = resolve(required("MIGRATION_BACKUP_DIR"));
      await privateDirectory(backups);
      const backupPath = join(backups, `rehearsal-before-import-${Date.now()}.dump`);
      await pgDump(url, ["--format=custom"], backupPath);
    }
    const result = await client.begin(async (sql) => {
      await sql`set local lock_timeout = '10s'`;
      await sql`set local statement_timeout = '120s'`;
      await sql`select pg_advisory_xact_lock(1749286)`;
      for (const table of [...authTables, ...tables]) await sql`lock table ${sql(`public.${table}`)} in access exclusive mode`;
      const installed = await sql`select hash from drizzle.__drizzle_migrations order by id`;
      const journal = JSON.parse(await readFile(resolve("src/server/db/migrations/meta/_journal.json"), "utf8"));
      const hashes = await Promise.all(journal.entries.map(async (entry: { tag: string }) => digest(await readFile(resolve("src/server/db/migrations", `${entry.tag}.sql`)))));
      requireCondition(installed.length === hashes.length && installed.every((r, index) => r.hash === hashes[index]), "TARGET_MIGRATION_VERSION_MISMATCH");
      const targetTables = await sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`;
      requireCondition(targetTables.length === 25 && targetTables.every((r) => [...authTables, ...tables].includes(r.table_name)), "TARGET_TABLE_DRIFT");
      for (const table of importOrder) {
        const stage = `migration_${table}`;
        await sql`create temporary table ${sql(stage)} (like ${sql(`public.${table}`)} including defaults) on commit drop`;
        const columns = await sql`select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = ${table} order by ordinal_position`;
        const source = snapshot.rows.get(table)!;
        if ((tables as readonly string[]).includes(table)) {
          const sourceColumns = section(snapshot.sections, `public.${table}`).columns;
          requireCondition(columns.length === sourceColumns.length && columns.every((c) => sourceColumns.includes(c.column_name)), "APPLICATION_COLUMN_DRIFT");
        }
        const converted = source.map((row) => Object.fromEntries(columns.map((column) => {
          const value = row[column.column_name];
          return [column.column_name, column.data_type === "jsonb" && value !== null && value !== undefined ? JSON.parse(text(value, "INVALID_APPLICATION_JSON")) : value];
        })));
        for (let offset = 0; offset < converted.length; offset += 500) {
          await sql`insert into ${sql(stage)} select * from jsonb_populate_recordset(null::${sql(stage)}, ${sql.json(converted.slice(offset, offset + 500))})`;
        }
      }
      const targetCounts: Record<string, number> = {};
      for (const table of [...authTables, ...tables]) { const [count] = await sql`select count(*)::int as count from ${sql(`public.${table}`)}`; targetCounts[table] = count.count; }
      const empty = Object.values(targetCounts).every((count) => count === 0);
      if (mode === "import" && empty) {
        const trigger = await sql`select tgenabled from pg_trigger where tgrelid = 'public.alert_events'::regclass and tgname = 'alert_event_notification'`;
        requireCondition(trigger.length === 1 && trigger[0].tgenabled === "O", "ALERT_TRIGGER_STATE_UNEXPECTED");
        await sql`alter table public.alert_events disable trigger alert_event_notification`;
        for (const table of importOrder) await sql`insert into ${sql(`public.${table}`)} select * from ${sql(`migration_${table}`)}`;
        await sql`alter table public.alert_events enable trigger alert_event_notification`;
      }
      // Bidirectional EXCEPT ALL catches missing IDs, duplicates, timestamps and all field changes.
      const reconciliation: Record<string, { source: number; target: number; mismatches: number }> = {};
      for (const table of importOrder) {
        const [count] = await sql`select count(*)::int as count from ${sql(`public.${table}`)}`;
        const [difference] = await sql`select count(*)::int as count from ((select to_jsonb(t) from ${sql(`public.${table}`)} t except all select to_jsonb(s) from ${sql(`migration_${table}`)} s) union all (select to_jsonb(s) from ${sql(`migration_${table}`)} s except all select to_jsonb(t) from ${sql(`public.${table}`)} t)) differences`;
        reconciliation[table] = { source: snapshot.rows.get(table)!.length, target: count.count, mismatches: difference.count };
        requireCondition(difference.count === 0, "TARGET_DATA_MISMATCH_TRANSACTION_ROLLED_BACK");
      }
      for (const table of ["sessions", "verifications", "rate_limits"]) {
        const [count] = await sql`select count(*)::int as count from ${sql(`public.${table}`)}`;
        requireCondition(count.count === 0, "TARGET_AUTH_RUNTIME_ROWS_PRESENT");
      }
      const disabledConstraints = await sql`select count(*)::int as count from pg_trigger where tgisinternal and tgenabled <> 'O' and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`;
      requireCondition(disabledConstraints[0].count === 0, "DISABLED_TARGET_CONSTRAINT_TRIGGER");
      const violations = await sql`select count(*)::int as count from pg_constraint where connamespace = 'public'::regnamespace and contype in ('f', 'c') and not convalidated`;
      requireCondition(violations[0].count === 0, "UNVALIDATED_TARGET_CONSTRAINTS");
      const [orphans] = await sql`select count(*)::int as count from public.accounts a left join public.users u on u.id = a.user_id where u.id is null or a.provider_id <> 'google' or a.password is not null or a.access_token is not null or a.refresh_token is not null or a.id_token is not null`;
      requireCondition(orphans.count === 0, "AUTH_MAPPING_RECONCILIATION_FAILED");
      return { mode, imported: mode === "import" && empty, snapshotSha256: snapshot.snapshotSha256, reconciliation, ownership: { allForeignKeysValidated: true, authMappingViolations: orphans.count }, storage: snapshot.storage };
    });
    console.log(JSON.stringify(result));
  } finally { await client.end({ timeout: 5 }); }
}
export function reportFailure(error: unknown) {
  // PostgreSQL errors can include offending values, SQL and credentials. Never serialize them.
  console.error(error instanceof MigrationError ? error.message : "MIGRATION_FAILED_DETAILS_REDACTED");
  process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runMigration().catch(reportFailure);

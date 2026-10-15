# Hakapro Coolify database resources

Recorded on 2026-10-12 for the Supabase to Coolify migration. The production app has not been switched to these databases.

## Placement

| Resource | Name | UUID |
| --- | --- | --- |
| Project | Heulau Lab | `ow7q0ip8wuzak4ixos88pa1c` |
| Production environment | production | `fdhiawtrnj9euahebzjll7im` |
| Rehearsal environment | hakapro-rehearsal | `z2o1qgqxtvwa2tjm9fcjuies` |
| Server | heulaulab | `zbankmvocgu8czyf8e1eyrg3` |
| Private destination | coolify | `bpyqek79hnen3sdfuxk8jen8` |

Both database resources use the `postgres:17-alpine` image. Coolify reports health checks enabled and `running:healthy` after restart. Each resource has its own generated password and persistent volume. Neither exposes a public port (`is_public: false`). The existing Dashboard database, `heulaulab-dashboard-db` (`ydu1gfua6upswalzdg3wq3pu`), is a separate resource and is not a migration target.

| Setting | Production | Rehearsal |
| --- | --- | --- |
| Resource | `hakapro-postgres` (`luspjrb3ibvzma6yc1ilicum`) | `hakapro-rehearsal-postgres` (`4djsh2ikffzhfbjlt0xzu0oq`) |
| Environment | production | hakapro-rehearsal |
| Database name | `hakapro` | `hakapro_rehearsal` |
| Persistent volume | `ut5wgeycz63vygkseowbwqqo` | `rvhccpluwkajguj32jubkiz0` |
| Volume mount | `/var/lib/postgresql/data` | `/var/lib/postgresql/data` |
| Health | `running:healthy` | `running:healthy` |

Rehearsal has a separate environment, database, volume, and password. Both resources share the same Coolify server and network. Import tooling must receive only the rehearsal connection details during rehearsal; the current placement does not provide a network barrier between them.

## Backup policy

| Setting | Production | Rehearsal |
| --- | --- | --- |
| Schedule UUID | `dwoefmefujn3jc52qnywkmfd` | `drvvrqetmp3reszjsjnzick7` |
| Frequency | `0 2 * * *` daily | `0 5 * * *` daily |
| Scope | `hakapro` database | `hakapro_rehearsal` database |
| Local retention | 7 days and 7 copies | 7 days and 7 copies |
| Enabled | Yes | Yes |
| Last observed execution | `mkokpj7wk3tqsl3smwssegsw`: success, 2026-10-12 15:43 UTC | `cp2ytd4u6wcq0fpox1jykrxr`: success, 2026-10-12 15:43 UTC |

Backups are local to the Coolify server; no offsite copy is configured. No restore drill has been performed. These two successful executions confirm backup creation, not recoverability after a server loss.

## Source snapshot

The private Supabase source snapshot is located at `.superpowers/sdd/2026-10-12-hakapro-supabase-migration/private-source-snapshot/` in the migration worktree. The directory is ignored by git and must be retained securely before the worktree is removed. Refresh the snapshot at cutover after writes are paused.

## Branch environments (to provision)

Added 2026-10-15. Branches `develop` and `staging` deploy alongside production (`main`); see the README's environment table. These resources do not exist yet and are tracked in Plane HAKAPRO:

| Setting | develop | staging |
| --- | --- | --- |
| Coolify environment | `develop` (new) | `staging` (new) |
| App branch | `develop` | `staging` |
| Domain | `https://dev.hakapro.heulaulab.xyz` | `https://staging.hakapro.heulaulab.xyz` |
| PostgreSQL | new private PostgreSQL 17 resource, database `hakapro_develop` | new private PostgreSQL 17 resource, database `hakapro_staging` |
| `BETTER_AUTH_ENVIRONMENT` | `develop` | `staging` |

Use the same private destination and backup policy shape as production. Apply schema with `bun run db:migrate` against each environment's own `DATABASE_URL`. Never load the production snapshot into develop or staging. The rehearsal environment above stays dedicated to the migration until cutover.

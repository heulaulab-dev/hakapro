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

Since 2026-10-16 every schedule also uploads to Cloudflare R2 (Coolify S3 storage `cloudflare-r2-db-backups`, bucket `heulaulab-db-backups`, account endpoint `https://6b331bf8590ae2dd7de440acdb2deeb5.r2.cloudflarestorage.com`) and keeps 30 copies there. The first uploads were confirmed as objects in the bucket.

Restore drill (2026-10-16, Plane HAKA-53): the latest rehearsal dump (61,613 bytes) and production dump (837 bytes, empty database) were restored with `pg_restore --no-owner --no-acl --exit-on-error` into a temporary isolated PostgreSQL 17. The rehearsal counts matched the import (2 users, 2 accounts, 1 watchlist, 5 items, one Drizzle migration). The drill environment was deleted afterwards. Repeat the drill after the production import, the first production backup with real data.

## Source snapshot

The private Supabase source snapshot is located at `.superpowers/sdd/2026-10-12-hakapro-supabase-migration/private-source-snapshot/` in the migration worktree. The directory is ignored by git and must be retained securely before the worktree is removed. Refresh the snapshot at cutover after writes are paused.

## Branch environments

Provisioned 2026-10-15. Branches `develop` and `staging` deploy alongside production (`main`); see the README's environment table.

| Setting | develop | staging |
| --- | --- | --- |
| Coolify environment | `develop` (`8wfwdiulgdynlnmeksrrleng`) | `staging` (`drvcln8r8yseswghxpp6c0lf`) |
| App | `hakapro-develop` (`si198xogibhv4pin2hsv59vj`), branch `develop` | `hakapro-staging` (`dbs771eid30ht07n1edldah9`), branch `staging` |
| Domain | `https://dev-hakapro.heulaulab.xyz` (Cloudflare proxied, SSL Full) | `https://staging-hakapro.heulaulab.xyz` (Cloudflare proxied, SSL Full) |
| PostgreSQL 17 | `hakapro-develop-postgres` (`pseomnymryzbjkjdru4g3ub9`), database `hakapro_develop` | `hakapro-staging-postgres` (`1knkmfusmp9kxc5bepo4tqiw`), database `hakapro_staging` |
| Backups | `30 2 * * *`, 7 local + 30 in R2 | `30 2 * * *`, 7 local + 30 in R2 |
| Schema runner | `hakapro-develop-db-runner` (`xsmdw09p3gyb4rv5hhxduzjs`) | `hakapro-staging-db-runner` (`xc4jp2idmzahr0iw7n92b31l`) |
| `BETTER_AUTH_ENVIRONMENT` | `develop` | `staging` |

- **Schema:** each runner is built from `/scripts/migrations/Dockerfile` on the same branch and runs `bun run db:migrate` as its post-deployment command. Redeploy the runner whenever a branch adds a Drizzle migration, before or with the app.
- **Settings:** every app setting must be runtime-only (Coolify's "build variable" off). Coolify passes build variables to `docker build`, where `BETTER_AUTH_ENVIRONMENT` next to the Dockerfile's production placeholder fails the auth guard, and secrets must never reach the build. Updating a setting through the API without a value blanks it.
- **Data:** never load the production snapshot into develop or staging. Both use the shared Google OAuth client and Resend SMTP, and the arjum key (shared daily quota). The rehearsal environment above stays dedicated to the migration until cutover.

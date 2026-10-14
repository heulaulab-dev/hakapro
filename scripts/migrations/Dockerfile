# Build context: repository root. Source only; no source snapshot or dotenv files.
FROM oven/bun:1.3.14-debian AS dependencies
WORKDIR /runner
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM postgres:17-bookworm AS runner
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /runner
COPY --from=dependencies /runner/node_modules ./node_modules
COPY package.json bun.lock drizzle.config.ts ./
COPY scripts/migrations ./scripts/migrations
COPY src/db ./src/db
COPY src/server/db/migrations ./src/server/db/migrations
RUN mkdir /backups && chown -R postgres:postgres /runner /backups && chmod 700 /backups
USER postgres
ENV MIGRATION_BACKUP_DIR=/backups
ENTRYPOINT ["bun", "scripts/migrations/snapshot-transfer.ts"]
CMD ["inventory"]

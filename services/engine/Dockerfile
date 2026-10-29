# HAKAPRO Data Engine. Build context: repository root (Coolify: Dockerfile location /services/engine/Dockerfile).
# No build args or secrets: every credential is a runtime env var. The runtime image holds two bundled files
# and the SQL migrations, so builds stay light on the shared server (no Next.js deps are installed).
FROM oven/bun:1.3.14 AS build
WORKDIR /build
COPY services/engine/package.json services/engine/bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts
# Shared contracts from the app (resolved through the `@/*` tsconfig paths).
COPY tsconfig.json ./tsconfig.json
COPY src/server/schemas ./src/server/schemas
COPY src/server/services/strip-identifiers.ts ./src/server/services/strip-identifiers.ts
COPY src/server/config/idx-calendar.ts ./src/server/config/idx-calendar.ts
COPY src/lib/freshness ./src/lib/freshness
COPY src/lib/movers.ts ./src/lib/movers.ts
COPY src/lib/sector-rotation.ts ./src/lib/sector-rotation.ts
COPY src/lib/strategies/contract.ts ./src/lib/strategies/contract.ts
COPY src/lib/format/index.ts ./src/lib/format/index.ts
COPY src/lib/api/provider-limits.ts ./src/lib/api/provider-limits.ts
COPY src/lib/ownership ./src/lib/ownership
COPY src/lib/insider-holders.ts ./src/lib/insider-holders.ts
# Radar rules (thresholds and signal keys) shared with the app's methodology page.
COPY src/lib/radar ./src/lib/radar
COPY src/server/providers/arjum/queries.ts ./src/server/providers/arjum/queries.ts
# The app's arjum insider normalizer (insider feed) and what it imports.
COPY src/server/services/arjum-normalize.ts ./src/server/services/arjum-normalize.ts
COPY src/server/services/parse-number.ts ./src/server/services/parse-number.ts
COPY src/server/config/reporting.ts ./src/server/config/reporting.ts
COPY services/engine/tsconfig.json ./services/engine/tsconfig.json
COPY services/engine/db ./services/engine/db
COPY services/engine/src ./services/engine/src
RUN bun build services/engine/src/main.ts --target=bun --outfile=dist/main.js \
    && bun build services/engine/src/db/migrate.ts --target=bun --outfile=dist/migrate.js \
    && bun build services/engine/src/verify-issuers.ts --target=bun --outfile=dist/verify-issuers.js

FROM oven/bun:1.3.14-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    ENGINE_DATA_DIR=/data \
    ENGINE_MIGRATIONS_DIR=/app/migrations \
    ENGINE_IDX_PRIMARY_PYTHON=/opt/idx-venv/bin/python \
    ENGINE_IDX_PRIMARY_WORKER_SCRIPT=/app/services/engine/python/idx_curl_worker.py
COPY --from=build /build/dist/main.js /build/dist/migrate.js ./
COPY --from=build /build/dist/verify-issuers.js ./
COPY --from=build /build/services/engine/db/migrations ./migrations
COPY services/engine/python/idx_curl_worker.py services/engine/python/idx_transport.py ./services/engine/python/
# /data holds the PAUSE flag and the raw-store fallback; mount a persistent volume there in Coolify.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && python3 -m venv /opt/idx-venv \
    && /opt/idx-venv/bin/pip install --no-cache-dir curl_cffi==0.16.3 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data \
    && chown bun:bun /data
USER bun
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["bun", "main.js"]

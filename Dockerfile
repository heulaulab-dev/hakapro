FROM oven/bun:1.3.14 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .

# Public Supabase values are embedded into browser bundles by Next.js at build time.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY}

# The app validates production configuration during the build. Real provider
# credentials stay runtime-only in Coolify; these values are build placeholders.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" \
    && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
    && MARKET_DATA_SOURCE=arjum \
      HEULATRADE_MARKET_API_BASE_URL=https://build.invalid \
      HEULATRADE_MARKET_API_KEY=build-check \
      DEV_AUTH_BYPASS= \
      node ./node_modules/next/dist/bin/next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]

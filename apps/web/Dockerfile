# Multi-stage build for the 0run web app (npm workspaces monorepo, Next standalone).
# Build context is the MONOREPO ROOT, not apps/web.

FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

FROM base AS deps
COPY .npmrc package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN npm ci --workspace web --include-workspace-root

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY .npmrc package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web
# NEXT_PUBLIC_* are inlined at build time; the Privy app id is public by design.
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace web

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# Separate target used by the one-shot migrate container: needs devDeps (drizzle-kit) + sources.
FROM builder AS migrator
WORKDIR /app/apps/web
CMD ["npx", "drizzle-kit", "push", "--config", "drizzle.config.ts", "--force"]

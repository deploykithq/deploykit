FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/templates/package.json ./packages/templates/
RUN pnpm install --no-frozen-lockfile

# Production
FROM base AS runner
# docker-cli-compose provides `docker compose`, which every stack deploy shells
# out to. Without it Compose services fail at deploy time, not at build time.
RUN apk add --no-cache docker-cli docker-cli-compose curl git openssh-client
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/templates/node_modules ./packages/templates/node_modules
COPY . .

RUN pnpm --filter @deploykit/shared build 2>/dev/null || true
RUN npm install -g tsx
RUN mkdir -p /var/backups/deploykit
# Stack directories. This path must be bind-mounted from the host at the SAME
# absolute path (see docker-compose.prod.yml): Compose resolves relative binds
# against it and hands the result to the host's daemon.
RUN mkdir -p /var/lib/deploykit/compose

COPY apps/api/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4000
CMD ["/app/entrypoint.sh"]

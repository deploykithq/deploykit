# Build stage
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/templates/package.json packages/templates/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/

# Build web app
RUN pnpm --filter @deploykit/web build

# Build API
RUN pnpm --filter @deploykit/api build

# Production stage
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@9 --activate

# Install Docker CLI (needed for builds and backups) plus the Compose plugin,
# which every stack deploy shells out to.
RUN apk add --no-cache docker-cli docker-cli-compose git curl

# Install Nixpacks
RUN wget -qO- https://nixpacks.com/install.sh | bash || true

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/templates/package.json packages/templates/
COPY apps/api/package.json apps/api/

# Install production dependencies only
RUN pnpm install --prod --no-frozen-lockfile

# Copy built API
COPY --from=builder /app/apps/api/dist apps/api/dist
COPY --from=builder /app/apps/api/src/db apps/api/src/db
COPY --from=builder /app/apps/api/drizzle.config.ts apps/api/
COPY --from=builder /app/packages/shared/src packages/shared/src
COPY --from=builder /app/packages/templates/src packages/templates/src

# Copy built web app (served by Fastify)
COPY --from=builder /app/apps/web/dist apps/web/dist

# Create backup directory
RUN mkdir -p /var/backups/deploykit
# Stack directories — must be bind-mounted from the host at this same absolute
# path so Compose's relative binds resolve on the daemon's filesystem.
RUN mkdir -p /var/lib/deploykit/compose

EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]

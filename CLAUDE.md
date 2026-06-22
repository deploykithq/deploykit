# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is DeployKit

A self-hosted PaaS (open-source Vercel/Heroku alternative) for deploying applications and databases on your own infrastructure. MIT licensed.

## Commands

```bash
# Install dependencies
pnpm install

# Start dev services (PostgreSQL, Redis, Traefik)
docker compose up -d

# Run database migrations
pnpm db:migrate

# Generate new migration after schema changes
pnpm db:generate

# Open Drizzle Studio (DB GUI)
pnpm db:studio

# Development (API + Web concurrently)
pnpm dev

# Dev individual apps
pnpm dev:api    # API on :3001
pnpm dev:web    # Web on :5173

# Type-check all packages (no ESLint/Prettier configured)
pnpm lint

# Production build
pnpm build

# Clean dist/ directories
pnpm clean
```

No test framework is configured.

## Architecture

**Monorepo** (pnpm workspaces) with three packages:

- **`apps/api`** — Fastify 5 backend with tRPC 11 RPC layer, Drizzle ORM (PostgreSQL), BullMQ workers (Redis), Socket.IO for real-time logs, Dockerode for container management
- **`apps/web`** — React 19 SPA with TanStack Router (file-based), TanStack React Query, Zustand auth store, Tailwind CSS 4, Vite 6
- **`packages/shared`** — Zod validation schemas and TypeScript types shared between API and web

### Backend structure (`apps/api/src/`)

- **`index.ts`** — Server entry: Fastify setup, CORS, security headers, rate limiting, tRPC adapter, Socket.IO, webhook routes, worker startup
- **`trpc.ts`** — tRPC context (db, user, ip) and middleware: `publicProcedure`, `protectedProcedure`, `adminProcedure`, `operatorProcedure`
- **`routers/`** — 11 tRPC routers (auth, project, application, database, server, user, audit, metrics, notification, dashboard, projectMember)
- **`db/schema/`** — 13 Drizzle table definitions with relations
- **`services/`** — Business logic: build orchestration (Nixpacks/Dockerfile/Buildpacks), Docker operations, SSH, git, webhook processing, log streaming, metrics collection, notifications
- **`workers/`** — BullMQ workers: deploy, backup, and scheduled jobs (metrics, image cleanup, audit cleanup)
- **`lib/`** — Utilities: AES-256-GCM encryption, audit logging, permissions, Redis client, Socket.IO init

### Frontend structure (`apps/web/src/`)

- **`router.tsx`** — Route definitions with lazy loading and auth guards via `beforeLoad`
- **`features/`** — 12 feature modules (auth, dashboard, project, application, database, server, users, settings, audit, metrics, layout, shared)
- **`lib/trpc.ts`** — tRPC client with React Query integration
- **`lib/auth.ts`** — Zustand store for JWT auth state

### Key data flow

1. Web calls API via tRPC (proxied through Vite in dev: `/trpc` → `:3001`)
2. Deploy/backup operations are queued via BullMQ (Redis) and processed by workers
3. Real-time container logs stream via Socket.IO
4. GitHub/GitLab webhooks hit `POST /api/webhooks/{github,gitlab,generic}` and trigger deploy jobs

### Environment

Requires: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`. See `.env` for dev defaults, `.env.production` for production template.

### Database migrations

Schema lives in `apps/api/src/db/schema/`. After changing schema files, run `pnpm db:generate` to create a migration, then `pnpm db:migrate` to apply it. Drizzle config is at `apps/api/drizzle.config.ts`.

### Production

Multi-stage Dockerfile builds both apps into a single container (Node 20 Alpine + Docker CLI + Nixpacks). Traefik v3 handles reverse proxy and automatic Let's Encrypt SSL. See `docker-compose.prod.yml`.

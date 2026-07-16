<p align="center">
  <a href="https://dokploy.com">
    <img src=".github/images/banner.png" alt="Dokploy - Open Source Alternative to Vercel, Heroku and Netlify." width="100%"  />
  </a>
  <p align="center">Self-hosted PaaS for deploying apps and databases on your own infrastructure.<br>Open-source alternative to Vercel, Netlify and Heroku.</p>
</p>

<p align="center">
  <a href="#installation">Installation</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#tech-stack">Tech Stack</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#license">License</a>
</p>

---

## Installation

DeployKit is installed and managed with the [`@deploykit/cli`](https://github.com/deploykithq/deploykit-cli) command-line tool. Install it on your VPS (Ubuntu/Debian/RHEL/Alpine) with Node.js >= 20:

```bash
npm install -g @deploykit/cli
sudo deploykit install --domain deploy.example.com --email you@example.com
```

Or run it one-shot via `npx`, no global install:

```bash
sudo npx @deploykit/cli install --domain deploy.example.com --email you@example.com
```

With all options:

```bash
sudo deploykit install \
  --domain deploy.example.com \
  --email you@example.com \
  --admin-email admin@example.com \
  --admin-password yourpassword
```

Run `deploykit install` with no `--domain`/`--email` in a terminal to drop into interactive prompts.

The CLI will:
1. Install Docker and Docker Compose (if not present)
2. Clone DeployKit to `/opt/deploykit`
3. Generate all secrets (JWT, encryption keys)
4. Start all services behind Traefik with auto-SSL
5. Create your admin account

**Requirements:** Linux VPS with 1 vCPU, 1 GB RAM, 10 GB disk, Node.js >= 20, and ports 80/443 open.

### Update

```bash
sudo deploykit update
```

### Other commands

```bash
deploykit status      # list running containers
deploykit logs        # stream live logs
sudo deploykit restart # restart all services
```

### Uninstall

```bash
sudo deploykit uninstall --yes                # keep data volumes
sudo deploykit uninstall --yes --delete-data  # also wipe Postgres/Redis volumes and backups
```

User-deployed containers are not affected by uninstall.

---

## Features

| Feature | Description |
|---------|-------------|
| **App Deployments** | Deploy from GitHub, GitLab, any Git repo, or Docker images |
| **Auto-Build** | Nixpacks (auto-detect), Dockerfile, or Cloud Native Buildpacks |
| **Databases** | One-click PostgreSQL, MongoDB, Redis, MySQL, MariaDB |
| **Auto-Deploy** | GitHub/GitLab webhooks trigger deploys on push |
| **Preview Deployments** | Automatic PR/MR preview environments with subdomain routing |
| **Environment Variables** | Managed in the UI, encrypted at rest with AES-256-GCM |
| **Custom Domains** | Automatic SSL certificates via Let's Encrypt + Traefik |
| **Real-Time Logs** | Build, deploy, and container logs streamed via Socket.IO |
| **Monitoring** | CPU, memory, and network stats per container |
| **Automated Backups** | Database backups with configurable retention and restore |
| **Multi-Project** | Organize services into logical projects |
| **Role-Based Access** | Admin, Operator, and Viewer roles with project-level overrides |
| **Remote Servers** | Deploy to remote servers via SSH |
| **Rollbacks** | One-click rollback to any previous deployment |
| **Audit Logs** | Full action history with automatic retention cleanup |
| **Notifications** | Discord, Slack, Telegram, Email, and Webhook channels |
| **Templates** | Select from a variety of ready-to-deploy templates from different services |
| **Autoscaling** | Automatically scale replicas by average CPU/memory load |
| **Status Page** | Publish a public, no-login status page showing the live state and uptime of selected applications in this project. |

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://www.docker.com/)

### Setup

```bash
git clone https://github.com/shakarr/deploykit.git
cd deploykit
pnpm install
```

```bash
cp .env.example .env
# Edit .env — generate secrets with: openssl rand -hex 32
```

```bash
docker compose up -d          # Start PostgreSQL, Redis, Traefik
pnpm db:generate              # Generate migration files
pnpm db:migrate               # Run migrations
pnpm dev                      # Start API + Web dev servers
```

| Service   | URL                     |
|-----------|-------------------------|
| Dashboard | http://localhost:5173   |
| API       | http://localhost:3001   |
| Traefik   | http://localhost:8080   |

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services in development mode |
| `pnpm dev:api` | Start only the API server |
| `pnpm dev:web` | Start only the web dashboard |
| `pnpm build` | Build all packages for production |
| `pnpm db:generate` | Generate Drizzle ORM migration files |
| `pnpm db:migrate` | Run pending database migrations |
| `pnpm db:studio` | Open Drizzle Studio (database GUI) |
| `pnpm lint` | Run type checking across all packages |

### Manual Production Deploy

```bash
cp .env.production .env
# Edit .env with your domain and secrets
docker compose -f docker-compose.prod.yml up -d --build
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS v4, TanStack Router, Zustand |
| API | Fastify, tRPC, Socket.IO |
| Database | PostgreSQL 16, Drizzle ORM |
| Queue | BullMQ, Redis 7 |
| Containers | Docker (Dockerode), Traefik v3 |
| Build | Nixpacks, Dockerfile, Cloud Native Buildpacks |
| Auth | JWT with refresh token rotation, bcrypt |
| Encryption | AES-256-GCM for secrets at rest |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `REDIS_URL` | Redis connection string | — |
| `JWT_SECRET` | Secret for signing access tokens | — |
| `JWT_REFRESH_SECRET` | Secret for signing refresh tokens | — |
| `ENCRYPTION_KEY` | 64-char hex key for AES-256-GCM (`openssl rand -hex 32`) | — |
| `API_PORT` | API server port | `3001` |
| `WEB_PORT` | Dashboard port | `5173` |
| `WEBHOOK_SECRET` | HMAC secret for GitHub/GitLab webhooks | — |
| `AUDIT_RETENTION_DAYS` | Days to keep audit logs before cleanup | `90` |
| `GITHUB_CLIENT_ID` | GitHub OAuth app ID (optional) | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret (optional) | — |

---

## How It Works

```
Push to GitHub/GitLab
        │
        ▼
  Webhook received ──▶ Verify signature ──▶ Match app by repo + branch
        │
        ▼
  Queue deploy job (BullMQ/Redis)
        │
        ▼
  Deploy Worker
   ├── git clone --depth 1
   ├── Detect build strategy (Nixpacks / Dockerfile / Buildpacks)
   ├── docker build ──▶ tag as deploykit/{name}:{commit}
   ├── Stop previous container
   ├── Start new container with env vars + Traefik labels
   ├── Run health check (HTTP/TCP)
   └── Update status ──▶ Socket.IO ──▶ Dashboard refreshes
        │
        ▼
  App live at https://your-domain.com (auto-SSL)
```

---

## License

[MIT](LICENSE)

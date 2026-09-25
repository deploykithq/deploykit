<h1 align="center">Your own cloud, one <code>git push</code> away.</h1>

<p align="center">
  Deploy apps, databases and Docker Compose stacks on your own servers —<br>
  auto-builds, SSL, real-time logs, backups and previews. MIT licensed, zero vendor lock-in.
</p>

<p align="center">
  <a href="https://github.com/deploykithq/deploykit/releases"><img src="https://img.shields.io/github/v/release/deploykithq/deploykit?style=flat-square&color=6366f1" alt="Latest release" /></a>
  <a href="https://github.com/deploykithq/deploykit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/deploykithq/deploykit/ci.yml?branch=master&style=flat-square&label=CI" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/deploykithq/deploykit?style=flat-square" alt="MIT license" /></a>
  <a href="https://github.com/deploykithq/deploykit/stargazers"><img src="https://img.shields.io/github/stars/deploykithq/deploykit?style=flat-square&color=f5c518" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="#installation">Installation</a> &middot;
  <a href="#why-deploykit">Why DeployKit</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#development">Development</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="#license">License</a>
</p>

---

https://github.com/user-attachments/assets/5570d7f3-c9fd-4012-a8d1-f227df413fdd

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

Database migrations run at startup. If the API container fails to start with
`relation "users" already exists`, the database was created by an old fallback
that left no migration bookkeeping; repair it once with

```bash
sudo scripts/repair-migration-state.sh
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

## Why DeployKit

- **Runs on a $5 VPS.** 1 vCPU and 1 GB of RAM are enough to host the panel and your apps on the same box — or add more servers over SSH later.
- **Access control built for teams.** Global Admin / Operator / Viewer roles plus per-project roles, secrets hidden from anyone who shouldn't see them, and every action in the audit log.
- **Your whole instance as a YAML file.** Export projects, apps, databases and stacks, keep the file in Git, and import it on a fresh server.
- **First-class GitHub App.** Register one for your instance in a couple of clicks: private repos without personal tokens, commit statuses on every deploy, and preview environments for pull requests.
- **More than containers.** Compose stacks, one-click templates, cron jobs and one-off commands, autoscaling, vulnerability scanning and a public status page ship in the box.
- **No lock-in.** It's plain Docker, Compose and Traefik underneath. Uninstall DeployKit and your containers keep running.

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
| **Docker Compose Stacks** | Deploy a whole `docker-compose.yml` as a unit, with routing, logs and metrics per service |
| **One-Click Templates** | Ready-to-deploy stacks from the [community catalogue](https://github.com/deploykithq/deploykit-templates), with secrets generated per install |
| **GitHub App** | Private repos without personal tokens, commit statuses and PR previews |
| **Scheduled Tasks** | Cron jobs and one-off commands (migrations, scripts) in isolated containers |
| **Vulnerability Scanning** | Optional Trivy scan of every built image, without ever blocking a deploy |
| **Config Export/Import** | Move an entire instance between servers as a single YAML file |
| **Autoscaling** | Automatically scale replicas by average CPU/memory load |
| **Status Page** | Publish a public, no-login status page showing the live state and uptime of selected applications |

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://www.docker.com/)

### Setup

```bash
git clone https://github.com/deploykithq/deploykit.git
cd deploykit
pnpm install
```

```bash
cp .env.example .env
# Edit .env — generate secrets with: openssl rand -hex 32
```

```bash
docker compose up -d          # Start PostgreSQL, Redis, Traefik
pnpm db:migrate               # Run migrations
pnpm dev                      # Start API + Web dev servers
```

| Service   | URL                     |
|-----------|-------------------------|
| Dashboard | http://localhost:5173   |
| API       | http://localhost:3001   |
| Traefik   | http://localhost:8080   |

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
| `WEBHOOK_SECRET` | HMAC secret for GitHub/GitLab webhooks. Optional once a GitHub App is registered | — |
| `WEB_URL` | Public URL of the dashboard. Required to register a GitHub App | `http://localhost:5173` |
| `AUDIT_RETENTION_DAYS` | Days to keep audit logs before cleanup | `90` |

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

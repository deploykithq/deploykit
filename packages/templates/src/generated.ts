// GENERATED FILE — do not edit.
// Run `pnpm --filter @deploykit/templates generate` after changing blueprints/.
import type { TemplateT } from "@deploykit/shared";

const BUNDLED_TEMPLATES: TemplateT[] = [
  {
    "spec": {
      "id": "code-server",
      "name": "code-server",
      "version": "latest",
      "description": "VS Code in the browser. Sign in with the generated access password.",
      "links": {
        "github": "https://github.com/coder/code-server",
        "docs": "https://coder.com/docs/code-server/latest"
      },
      "tags": [
        "ide",
        "dev"
      ],
      "variables": {
        "main_domain": "${domain}",
        "access_password": "${password:20}",
        "sudo_password": "${password:20}"
      },
      "domains": [
        {
          "service": "code-server",
          "port": 8443,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "ACCESS_PASSWORD": "${access_password}",
        "SUDO_PASSWORD": "${sudo_password}"
      },
      "mounts": []
    },
    "compose": "services:\n  code-server:\n    image: linuxserver/code-server:latest\n    restart: unless-stopped\n    expose:\n      - \"8443\"\n    environment:\n      PUID: \"1000\"\n      PGID: \"1000\"\n      TZ: Etc/UTC\n      PASSWORD: ${ACCESS_PASSWORD}\n      SUDO_PASSWORD: ${SUDO_PASSWORD}\n    volumes:\n      - code-config:/config\n\nvolumes:\n  code-config:\n"
  },
  {
    "spec": {
      "id": "gitea",
      "name": "Gitea",
      "version": "1",
      "description": "Self-hosted Git service with issues and pull requests. Complete the setup wizard on first visit.",
      "links": {
        "github": "https://github.com/go-gitea/gitea",
        "website": "https://about.gitea.com",
        "docs": "https://docs.gitea.com"
      },
      "tags": [
        "git",
        "vcs"
      ],
      "variables": {
        "main_domain": "${domain}",
        "ssh_port": "${randomPort}"
      },
      "domains": [
        {
          "service": "gitea",
          "port": 3000,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "SSH_PORT": "${ssh_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  gitea:\n    image: gitea/gitea:1\n    restart: unless-stopped\n    expose:\n      - \"3000\"\n    ports:\n      - \"${SSH_PORT}:22\"\n    environment:\n      USER_UID: \"1000\"\n      USER_GID: \"1000\"\n      GITEA__server__ROOT_URL: https://${MAIN_DOMAIN}/\n      GITEA__server__SSH_PORT: ${SSH_PORT}\n    volumes:\n      - gitea-data:/data\n\nvolumes:\n  gitea-data:\n"
  },
  {
    "spec": {
      "id": "gotify",
      "name": "Gotify",
      "version": "latest",
      "description": "Simple server for sending and receiving push notifications. Log in as admin with the generated password.",
      "links": {
        "github": "https://github.com/gotify/server",
        "website": "https://gotify.net",
        "docs": "https://gotify.net/docs/"
      },
      "tags": [
        "notifications"
      ],
      "variables": {
        "main_domain": "${domain}",
        "admin_password": "${password:20}"
      },
      "domains": [
        {
          "service": "gotify",
          "port": 80,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "GOTIFY_ADMIN_PASSWORD": "${admin_password}"
      },
      "mounts": []
    },
    "compose": "services:\n  gotify:\n    image: gotify/server:latest\n    restart: unless-stopped\n    expose:\n      - \"80\"\n    environment:\n      GOTIFY_DEFAULTUSER_NAME: admin\n      GOTIFY_DEFAULTUSER_PASS: ${GOTIFY_ADMIN_PASSWORD}\n    volumes:\n      - gotify-data:/app/data\n\nvolumes:\n  gotify-data:\n"
  },
  {
    "spec": {
      "id": "grafana",
      "name": "Grafana",
      "version": "latest",
      "description": "Observability dashboards and data visualization. Log in as admin with the generated password.",
      "links": {
        "github": "https://github.com/grafana/grafana",
        "website": "https://grafana.com",
        "docs": "https://grafana.com/docs/grafana/latest/"
      },
      "tags": [
        "monitoring",
        "dashboards"
      ],
      "variables": {
        "main_domain": "${domain}",
        "admin_password": "${password:20}"
      },
      "domains": [
        {
          "service": "grafana",
          "port": 3000,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "GF_ADMIN_PASSWORD": "${admin_password}"
      },
      "mounts": []
    },
    "compose": "services:\n  grafana:\n    image: grafana/grafana:latest\n    restart: unless-stopped\n    expose:\n      - \"3000\"\n    environment:\n      GF_SECURITY_ADMIN_PASSWORD: ${GF_ADMIN_PASSWORD}\n      GF_SERVER_ROOT_URL: https://${MAIN_DOMAIN}\n    volumes:\n      - grafana-data:/var/lib/grafana\n\nvolumes:\n  grafana-data:\n"
  },
  {
    "spec": {
      "id": "mailpit",
      "name": "Mailpit",
      "version": "latest",
      "description": "Email and SMTP testing tool. The web UI is on your domain; other services send mail to it on the published SMTP port.",
      "links": {
        "github": "https://github.com/axllent/mailpit",
        "docs": "https://mailpit.axllent.org/docs/"
      },
      "tags": [
        "email",
        "smtp",
        "dev"
      ],
      "variables": {
        "main_domain": "${domain}",
        "smtp_port": "${randomPort}"
      },
      "domains": [
        {
          "service": "mailpit",
          "port": 8025,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "SMTP_PORT": "${smtp_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  mailpit:\n    image: axllent/mailpit:latest\n    restart: unless-stopped\n    expose:\n      - \"8025\"\n    ports:\n      - \"${SMTP_PORT}:1025\"\n    volumes:\n      - mailpit-data:/data\n    environment:\n      MP_DATABASE: /data/mailpit.db\n\nvolumes:\n  mailpit-data:\n"
  },
  {
    "spec": {
      "id": "mariadb-11",
      "name": "MariaDB 11",
      "version": "11",
      "description": "MariaDB 11, MySQL-compatible, with generated passwords. Reachable on the server's public IP at the published port. For a database wired into DeployKit's backups and connection strings, use “Add Database” instead.",
      "links": {
        "website": "https://mariadb.org",
        "docs": "https://mariadb.com/kb/en/documentation/"
      },
      "tags": [
        "sql",
        "relational",
        "database"
      ],
      "variables": {
        "root_password": "${password:24}",
        "db_password": "${password:24}",
        "db_port": "${randomPort}"
      },
      "domains": [],
      "env": {
        "MARIADB_ROOT_PASSWORD": "${root_password}",
        "MARIADB_DATABASE": "app",
        "MARIADB_USER": "deploykit",
        "MARIADB_PASSWORD": "${db_password}",
        "DB_PORT": "${db_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  mariadb:\n    image: mariadb:11\n    restart: unless-stopped\n    environment:\n      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD}\n      MARIADB_DATABASE: ${MARIADB_DATABASE}\n      MARIADB_USER: ${MARIADB_USER}\n      MARIADB_PASSWORD: ${MARIADB_PASSWORD}\n    ports:\n      - \"${DB_PORT}:3306\"\n    volumes:\n      - mariadbdata:/var/lib/mysql\n\nvolumes:\n  mariadbdata:\n"
  },
  {
    "spec": {
      "id": "memos",
      "name": "Memos",
      "version": "stable",
      "description": "Lightweight, privacy-first note-taking and memo hub. SQLite-backed, no setup.",
      "links": {
        "github": "https://github.com/usememos/memos",
        "website": "https://www.usememos.com",
        "docs": "https://www.usememos.com/docs"
      },
      "tags": [
        "notes",
        "markdown"
      ],
      "variables": {
        "main_domain": "${domain}"
      },
      "domains": [
        {
          "service": "memos",
          "port": 5230,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}"
      },
      "mounts": []
    },
    "compose": "services:\n  memos:\n    image: neosmemo/memos:stable\n    restart: unless-stopped\n    expose:\n      - \"5230\"\n    volumes:\n      - memos-data:/var/opt/memos\n\nvolumes:\n  memos-data:\n"
  },
  {
    "spec": {
      "id": "metabase",
      "name": "Metabase",
      "version": "latest",
      "description": "Open-source business intelligence and dashboards. Uses its embedded H2 database — fine to evaluate with, not for production data.",
      "links": {
        "github": "https://github.com/metabase/metabase",
        "website": "https://www.metabase.com",
        "docs": "https://www.metabase.com/docs/latest/"
      },
      "tags": [
        "analytics",
        "bi"
      ],
      "variables": {
        "main_domain": "${domain}"
      },
      "domains": [
        {
          "service": "metabase",
          "port": 3000,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}"
      },
      "mounts": []
    },
    "compose": "services:\n  metabase:\n    image: metabase/metabase:latest\n    restart: unless-stopped\n    expose:\n      - \"3000\"\n    environment:\n      MB_DB_FILE: /metabase-data/metabase.db\n    volumes:\n      - metabase-data:/metabase-data\n\nvolumes:\n  metabase-data:\n"
  },
  {
    "spec": {
      "id": "miniflux-postgres",
      "name": "Miniflux",
      "version": "latest",
      "description": "Minimalist, fast RSS reader wired to its own PostgreSQL 16. Log in as admin with the generated password.",
      "links": {
        "github": "https://github.com/miniflux/v2",
        "website": "https://miniflux.app",
        "docs": "https://miniflux.app/docs/"
      },
      "tags": [
        "rss",
        "postgres"
      ],
      "variables": {
        "main_domain": "${domain}",
        "db_password": "${password:24}",
        "admin_password": "${password:20}"
      },
      "domains": [
        {
          "service": "miniflux",
          "port": 8080,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "DB_PASSWORD": "${db_password}",
        "ADMIN_PASSWORD": "${admin_password}"
      },
      "mounts": []
    },
    "compose": "services:\n  miniflux:\n    image: miniflux/miniflux:latest\n    restart: unless-stopped\n    depends_on:\n      postgres:\n        condition: service_healthy\n    expose:\n      - \"8080\"\n    environment:\n      DATABASE_URL: postgres://miniflux:${DB_PASSWORD}@postgres:5432/miniflux?sslmode=disable\n      RUN_MIGRATIONS: \"1\"\n      CREATE_ADMIN: \"1\"\n      ADMIN_USERNAME: admin\n      ADMIN_PASSWORD: ${ADMIN_PASSWORD}\n      BASE_URL: https://${MAIN_DOMAIN}/\n\n  postgres:\n    image: postgres:16-alpine\n    restart: unless-stopped\n    environment:\n      POSTGRES_USER: miniflux\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n      POSTGRES_DB: miniflux\n    volumes:\n      - miniflux-db:/var/lib/postgresql/data\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U miniflux\"]\n      interval: 10s\n      timeout: 5s\n      retries: 10\n\nvolumes:\n  miniflux-db:\n"
  },
  {
    "spec": {
      "id": "mongodb-7",
      "name": "MongoDB 7",
      "version": "7",
      "description": "MongoDB 7 document database with a generated root password. Reachable on the server's public IP at the published port. For a database wired into DeployKit's backups and connection strings, use “Add Database” instead.",
      "links": {
        "website": "https://www.mongodb.com",
        "docs": "https://www.mongodb.com/docs/"
      },
      "tags": [
        "nosql",
        "document",
        "database"
      ],
      "variables": {
        "root_password": "${password:24}",
        "db_port": "${randomPort}"
      },
      "domains": [],
      "env": {
        "MONGO_USER": "deploykit",
        "MONGO_PASSWORD": "${root_password}",
        "DB_PORT": "${db_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  mongo:\n    image: mongo:7\n    restart: unless-stopped\n    environment:\n      MONGO_INITDB_ROOT_USERNAME: ${MONGO_USER}\n      MONGO_INITDB_ROOT_PASSWORD: ${MONGO_PASSWORD}\n    ports:\n      - \"${DB_PORT}:27017\"\n    volumes:\n      - mongodata:/data/db\n\nvolumes:\n  mongodata:\n"
  },
  {
    "spec": {
      "id": "mysql-8",
      "name": "MySQL 8",
      "version": "8",
      "description": "MySQL 8 relational database with generated passwords. Reachable on the server's public IP at the published port. For a database wired into DeployKit's backups and connection strings, use “Add Database” instead.",
      "links": {
        "website": "https://www.mysql.com",
        "docs": "https://dev.mysql.com/doc/"
      },
      "tags": [
        "sql",
        "relational",
        "database"
      ],
      "variables": {
        "root_password": "${password:24}",
        "db_password": "${password:24}",
        "db_port": "${randomPort}"
      },
      "domains": [],
      "env": {
        "MYSQL_ROOT_PASSWORD": "${root_password}",
        "MYSQL_DATABASE": "app",
        "MYSQL_USER": "deploykit",
        "MYSQL_PASSWORD": "${db_password}",
        "DB_PORT": "${db_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  mysql:\n    image: mysql:8\n    restart: unless-stopped\n    environment:\n      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}\n      MYSQL_DATABASE: ${MYSQL_DATABASE}\n      MYSQL_USER: ${MYSQL_USER}\n      MYSQL_PASSWORD: ${MYSQL_PASSWORD}\n    ports:\n      - \"${DB_PORT}:3306\"\n    volumes:\n      - mysqldata:/var/lib/mysql\n\nvolumes:\n  mysqldata:\n"
  },
  {
    "spec": {
      "id": "n8n",
      "name": "n8n",
      "version": "1.70.0",
      "description": "Workflow automation with a visual editor and 400+ integrations. Create the owner account on first visit.",
      "links": {
        "github": "https://github.com/n8n-io/n8n",
        "website": "https://n8n.io",
        "docs": "https://docs.n8n.io"
      },
      "tags": [
        "automation",
        "no-code"
      ],
      "variables": {
        "main_domain": "${domain}",
        "encryption_key": "${base64:32}"
      },
      "domains": [
        {
          "service": "n8n",
          "port": 5678,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "N8N_HOST": "${main_domain}",
        "N8N_ENCRYPTION_KEY": "${encryption_key}",
        "GENERIC_TIMEZONE": "UTC"
      },
      "mounts": []
    },
    "compose": "# Plain Compose. Placeholders here are Compose's own interpolation, fed by the\r\n# .env file DeployKit writes next to this one from the blueprint's resolved\r\n# `env`. DeployKit's generator syntax lives only in template.json.\r\nservices:\r\n  n8n:\r\n    image: n8nio/n8n:1.70.0\r\n    restart: unless-stopped\r\n    # `expose`, not `ports`: the stack is reached through Traefik on the shared\r\n    # network, so publishing a host port would only invite collisions.\r\n    expose:\r\n      - \"5678\"\r\n    environment:\r\n      N8N_PORT: 5678\r\n      N8N_PROTOCOL: https\r\n      N8N_HOST: ${N8N_HOST}\r\n      WEBHOOK_URL: https://${N8N_HOST}/\r\n      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}\r\n      GENERIC_TIMEZONE: ${GENERIC_TIMEZONE}\r\n    volumes:\r\n      - n8n-data:/home/node/.n8n\r\n\r\nvolumes:\r\n  n8n-data:\r\n"
  },
  {
    "spec": {
      "id": "pgadmin",
      "name": "pgAdmin 4",
      "version": "latest",
      "description": "Web UI to manage PostgreSQL databases. Log in with the generated email and password.",
      "links": {
        "website": "https://www.pgadmin.org",
        "docs": "https://www.pgadmin.org/docs/"
      },
      "tags": [
        "postgres",
        "admin",
        "database"
      ],
      "variables": {
        "main_domain": "${domain}",
        "admin_email": "${email}",
        "admin_password": "${password:20}"
      },
      "domains": [
        {
          "service": "pgadmin",
          "port": 80,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "PGADMIN_EMAIL": "${admin_email}",
        "PGADMIN_PASSWORD": "${admin_password}"
      },
      "mounts": []
    },
    "compose": "services:\n  pgadmin:\n    image: dpage/pgadmin4:latest\n    restart: unless-stopped\n    expose:\n      - \"80\"\n    environment:\n      PGADMIN_DEFAULT_EMAIL: ${PGADMIN_EMAIL}\n      PGADMIN_DEFAULT_PASSWORD: ${PGADMIN_PASSWORD}\n      PGADMIN_CONFIG_SERVER_MODE: \"True\"\n    volumes:\n      - pgadmin-data:/var/lib/pgadmin\n\nvolumes:\n  pgadmin-data:\n"
  },
  {
    "spec": {
      "id": "postgres-16",
      "name": "PostgreSQL 16",
      "version": "16-alpine",
      "description": "PostgreSQL 16 with a generated password. Reachable on the server's public IP at the published port. For a database wired into DeployKit's backups and connection strings, use “Add Database” instead.",
      "links": {
        "website": "https://www.postgresql.org",
        "docs": "https://www.postgresql.org/docs/16/"
      },
      "tags": [
        "sql",
        "relational",
        "database"
      ],
      "variables": {
        "db_password": "${password:24}",
        "db_port": "${randomPort}"
      },
      "domains": [],
      "env": {
        "POSTGRES_USER": "deploykit",
        "POSTGRES_DB": "app",
        "POSTGRES_PASSWORD": "${db_password}",
        "DB_PORT": "${db_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  postgres:\n    image: postgres:16-alpine\n    restart: unless-stopped\n    environment:\n      POSTGRES_USER: ${POSTGRES_USER}\n      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}\n      POSTGRES_DB: ${POSTGRES_DB}\n    ports:\n      - \"${DB_PORT}:5432\"\n    volumes:\n      - pgdata:/var/lib/postgresql/data\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U $$POSTGRES_USER\"]\n      interval: 10s\n      timeout: 5s\n      retries: 5\n\nvolumes:\n  pgdata:\n"
  },
  {
    "spec": {
      "id": "redis-7",
      "name": "Redis 7",
      "version": "7-alpine",
      "description": "Redis 7 in-memory store for caching and queues, password-protected. Reachable on the server's public IP at the published port. For a database wired into DeployKit's backups and connection strings, use “Add Database” instead.",
      "links": {
        "website": "https://redis.io",
        "docs": "https://redis.io/docs/"
      },
      "tags": [
        "cache",
        "kv",
        "database"
      ],
      "variables": {
        "redis_password": "${password:24}",
        "db_port": "${randomPort}"
      },
      "domains": [],
      "env": {
        "REDIS_PASSWORD": "${redis_password}",
        "DB_PORT": "${db_port}"
      },
      "mounts": []
    },
    "compose": "services:\n  redis:\n    image: redis:7-alpine\n    restart: unless-stopped\n    command: [\"redis-server\", \"--requirepass\", \"${REDIS_PASSWORD}\", \"--appendonly\", \"yes\"]\n    ports:\n      - \"${DB_PORT}:6379\"\n    volumes:\n      - redisdata:/data\n\nvolumes:\n  redisdata:\n"
  },
  {
    "spec": {
      "id": "umami-postgres",
      "name": "Umami",
      "version": "postgresql-latest",
      "description": "Privacy-friendly web analytics, wired to its own PostgreSQL 16. Default login: admin / umami — change it after first login.",
      "links": {
        "github": "https://github.com/umami-software/umami",
        "website": "https://umami.is",
        "docs": "https://umami.is/docs"
      },
      "tags": [
        "analytics",
        "postgres"
      ],
      "variables": {
        "main_domain": "${domain}",
        "db_password": "${password:24}",
        "app_secret": "${base64:32}"
      },
      "domains": [
        {
          "service": "umami",
          "port": 3000,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "DB_PASSWORD": "${db_password}",
        "APP_SECRET": "${app_secret}"
      },
      "mounts": []
    },
    "compose": "services:\n  umami:\n    image: ghcr.io/umami-software/umami:postgresql-latest\n    restart: unless-stopped\n    depends_on:\n      postgres:\n        condition: service_healthy\n    expose:\n      - \"3000\"\n    environment:\n      DATABASE_TYPE: postgresql\n      DATABASE_URL: postgresql://umami:${DB_PASSWORD}@postgres:5432/umami\n      APP_SECRET: ${APP_SECRET}\n\n  postgres:\n    image: postgres:16-alpine\n    restart: unless-stopped\n    environment:\n      POSTGRES_USER: umami\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n      POSTGRES_DB: umami\n    volumes:\n      - umami-db:/var/lib/postgresql/data\n    healthcheck:\n      test: [\"CMD-SHELL\", \"pg_isready -U umami\"]\n      interval: 10s\n      timeout: 5s\n      retries: 10\n\nvolumes:\n  umami-db:\n"
  },
  {
    "spec": {
      "id": "uptime-kuma",
      "name": "Uptime Kuma",
      "version": "1",
      "description": "Self-hosted uptime monitoring with status pages and alerts. Create the admin account on first visit.",
      "links": {
        "github": "https://github.com/louislam/uptime-kuma",
        "docs": "https://github.com/louislam/uptime-kuma/wiki"
      },
      "tags": [
        "monitoring",
        "status"
      ],
      "variables": {
        "main_domain": "${domain}"
      },
      "domains": [
        {
          "service": "uptime-kuma",
          "port": 3001,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}"
      },
      "mounts": []
    },
    "compose": "services:\n  uptime-kuma:\n    image: louislam/uptime-kuma:1\n    restart: unless-stopped\n    expose:\n      - \"3001\"\n    volumes:\n      - kuma-data:/app/data\n\nvolumes:\n  kuma-data:\n"
  },
  {
    "spec": {
      "id": "vaultwarden",
      "name": "Vaultwarden",
      "version": "latest",
      "description": "Lightweight self-hosted password manager, Bitwarden-compatible. The generated admin token unlocks /admin.",
      "links": {
        "github": "https://github.com/dani-garcia/vaultwarden",
        "docs": "https://github.com/dani-garcia/vaultwarden/wiki"
      },
      "tags": [
        "passwords",
        "security"
      ],
      "variables": {
        "main_domain": "${domain}",
        "admin_token": "${base64:48}"
      },
      "domains": [
        {
          "service": "vaultwarden",
          "port": 80,
          "host": "${main_domain}"
        }
      ],
      "env": {
        "MAIN_DOMAIN": "${main_domain}",
        "ADMIN_TOKEN": "${admin_token}"
      },
      "mounts": []
    },
    "compose": "services:\n  vaultwarden:\n    image: vaultwarden/server:latest\n    restart: unless-stopped\n    expose:\n      - \"80\"\n    environment:\n      DOMAIN: https://${MAIN_DOMAIN}\n      ADMIN_TOKEN: ${ADMIN_TOKEN}\n      SIGNUPS_ALLOWED: \"true\"\n    volumes:\n      - vw-data:/data\n\nvolumes:\n  vw-data:\n"
  }
];

/** Blueprint logos, keyed by template id, as raw SVG markup. */
const BUNDLED_LOGOS: Record<string, string> = {};

export { BUNDLED_TEMPLATES, BUNDLED_LOGOS };

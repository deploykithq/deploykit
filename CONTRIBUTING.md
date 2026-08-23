# Contributing to DeployKit

Thanks for your interest in contributing to DeployKit! This guide will help you get started.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://www.docker.com/)

### Development Setup

```bash
git clone https://github.com/shakarr/deploykit.git
cd deploykit
pnpm install
cp .env.example .env
# Generate secrets: openssl rand -hex 32
docker compose up -d
pnpm db:migrate
pnpm dev
```

The dashboard runs at `http://localhost:5173` and the API at `http://localhost:3001`.

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feat/add-bitbucket-webhooks`
- `fix/deployment-status-not-updating`
- `docs/improve-setup-guide`

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add Bitbucket webhook support
fix: resolve race condition in deploy worker
docs: update environment variable reference
refactor: simplify Docker service factory
```

This is not a style preference. Pull requests are squash-merged, so **your PR title
becomes the commit message** on `master`, and that commit is what generates the
changelog. A title that isn't a Conventional Commit doesn't fail loudly — it quietly
leaves your change out of the release notes. A CI check validates the title; if it
fails, edit the title and the check re-runs on its own, no need to push again.

### Code Style

- Run `pnpm lint` before submitting (TypeScript type checking across all packages)
- Use the existing patterns in the codebase — if you're adding a new tRPC router, follow the structure of existing routers
- Keep API changes backwards-compatible when possible

### Project Structure

| Path | Description |
|------|-------------|
| `apps/api/src/routers/` | tRPC API endpoints |
| `apps/api/src/services/` | Business logic |
| `apps/api/src/workers/` | BullMQ background jobs |
| `apps/api/src/db/schema/` | Drizzle ORM table definitions |
| `apps/web/src/features/` | React feature modules |
| `packages/shared/src/` | Shared Zod schemas and types |

### Database Changes

If you modify files in `apps/api/src/db/schema/`:

```bash
pnpm db:generate   # Creates a new migration file
pnpm db:migrate    # Applies the migration
```

Always include generated migration files in your PR.

## Submitting a Pull Request

1. Fork the repo and create your branch from `master`
2. Make your changes
3. Run `pnpm lint` and ensure it passes
4. Run `pnpm build` to verify the production build works
5. Open a PR against `master` with a clear description of what and why
6. Fill out the PR template

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Link related issues using `Closes #123`
- Add screenshots for UI changes
- Update the README if you're adding user-facing configuration

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please).

1. Merging a `feat:` or `fix:` PR into `master` makes the bot open — or update — a pull
   request titled `chore(master): release X.Y.Z`, containing the generated
   `CHANGELOG.md` and the version bump applied across the workspace.
2. That PR stays open and keeps absorbing new commits until a maintainer merges it.
   Nothing is published before that.
3. Merging it tags `vX.Y.Z` and publishes the GitHub Release.

While the version is below `1.0.0`, `feat:` bumps the minor and `fix:` bumps the patch;
breaking changes bump the minor rather than jumping to `1.0.0`. To cut `1.0.0`
deliberately, add `Release-As: 1.0.0` to a commit body.

Don't edit `CHANGELOG.md` or any `version` field by hand — both are generated.

**Maintainer setup (one time):** in *Settings → Actions → General → Workflow
permissions*, enable *"Allow GitHub Actions to create and approve pull requests"*.
Without it the bot cannot open the release PR and the workflow fails.

## Reporting Bugs

Use the [bug report template](https://github.com/shakarr/deploykit/issues/new?template=bug_report.yml) to file issues. Include:

- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node version, Docker version)

## Requesting Features

Use the [feature request template](https://github.com/shakarr/deploykit/issues/new?template=feature_request.yml). Describe the problem you're trying to solve, not just the solution you want.

## Security

If you discover a security vulnerability, **do not open a public issue**. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

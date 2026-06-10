import { spawn } from "child_process";
import {
  existsSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import path from "path";

import { docker } from "../lib/docker";

import type { BuildType } from "@deploykit/shared";

export class BuildService {
  /**
   * Build a Docker image from source code.
   * Returns the image tag.
   */
  async build(opts: {
    contextPath: string;
    imageName: string;
    tag: string;
    buildType: BuildType;
    dockerfilePath?: string;
    buildArgs?: Record<string, string>;
    port?: number;
    startCommand?: string;
    onLog?: (log: string) => void;
  }): Promise<string> {
    const imageTag = `${opts.imageName}:${opts.tag}`;
    const log = opts.onLog || console.log;

    log(`\n── Build started ──────────────────────────\n`);
    log(`Image: ${imageTag}\n`);
    log(`Strategy: ${opts.buildType}\n\n`);

    switch (opts.buildType) {
      case "dockerfile":
        await this.buildDockerfile(
          opts.contextPath,
          imageTag,
          opts.dockerfilePath,
          opts.buildArgs,
          log,
          opts.port,
        );
        break;
      case "nixpacks":
        await this.buildNixpacks(
          opts.contextPath,
          imageTag,
          log,
          opts.port,
          opts.startCommand,
        );
        break;
      case "buildpacks":
        await this.buildBuildpacks(opts.contextPath, imageTag, log);
        break;
      default:
        throw new Error(`Unknown build type: ${opts.buildType}`);
    }

    log(`\n── Build complete ─────────────────────────\n`);
    return imageTag;
  }

  /**
   * Walk up from startDir looking for a monorepo root (pnpm-workspace.yaml,
   * lerna.json, or a package.json with a "workspaces" field).
   * Returns the root path, or null if none found.
   */
  private findMonorepoRoot(startDir: string): string | null {
    let dir = path.dirname(startDir); // start one level above contextPath
    const fsRoot = path.parse(dir).root;

    while (dir !== fsRoot) {
      if (
        existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
        existsSync(path.join(dir, "lerna.json"))
      ) {
        return dir;
      }
      const pkgPath = path.join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          if (pkg.workspaces) return dir;
        } catch {
          // ignore parse errors
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  private async buildDockerfile(
    contextPath: string,
    imageTag: string,
    dockerfilePath = "./Dockerfile",
    buildArgs?: Record<string, string>,
    onLog?: (log: string) => void,
    port?: number,
  ): Promise<void> {
    let buildContext = contextPath;
    let resolvedDockerfilePath = dockerfilePath;

    // Prevent path traversal: the Dockerfile must resolve to a path inside
    // the build context. An absolute path or "../" escapes would otherwise
    // let a deploy read/write arbitrary files on the build host.
    if (path.isAbsolute(dockerfilePath)) {
      throw new Error("Dockerfile path must be relative to the build context");
    }
    const fullDockerfilePath = path.resolve(contextPath, dockerfilePath);
    const normalizedContext = path.resolve(contextPath);
    if (
      fullDockerfilePath !== normalizedContext &&
      !fullDockerfilePath.startsWith(normalizedContext + path.sep)
    ) {
      throw new Error("Dockerfile path escapes the build context");
    }

    // Auto-generate Dockerfile if missing
    if (!existsSync(fullDockerfilePath)) {
      onLog?.(`No Dockerfile found. Auto-detecting project type...\n`);

      // Check if we're inside a monorepo workspace member
      const monorepoRoot = this.findMonorepoRoot(contextPath);

      if (monorepoRoot) {
        const subDir = path
          .relative(monorepoRoot, contextPath)
          .replace(/\\/g, "/");
        onLog?.(
          `Detected monorepo root: ${path.basename(monorepoRoot)} → building from root, workspace: ${subDir}\n`,
        );
        buildContext = monorepoRoot;
        resolvedDockerfilePath = "./Dockerfile.deploykit";

        const generated = this.generateDockerfileMonorepo(
          monorepoRoot,
          subDir,
          onLog,
          port,
        );
        if (generated) {
          writeFileSync(
            path.join(monorepoRoot, "Dockerfile.deploykit"),
            generated,
          );
          onLog?.(`✓ Monorepo Dockerfile auto-generated\n\n`);
        } else {
          throw new Error(
            `Could not auto-detect project type in monorepo workspace: ${subDir}`,
          );
        }
      } else {
        const generated = this.generateDockerfile(contextPath, onLog, port);
        if (generated) {
          writeFileSync(fullDockerfilePath, generated);
          onLog?.(`✓ Dockerfile auto-generated\n\n`);
        } else {
          throw new Error(
            `Dockerfile not found at ${dockerfilePath} and could not auto-detect project type`,
          );
        }
      }
    }

    onLog?.(`Using Dockerfile: ${resolvedDockerfilePath}\n`);
    onLog?.(`Building image: ${imageTag}\n`);

    // Use Dockerode's built-in tar packing (works cross-platform)
    const stream = await docker.buildImage(
      {
        context: buildContext,
        src: this.listFilesRecursive(buildContext),
      },
      {
        t: imageTag,
        dockerfile: resolvedDockerfilePath.replace(/\\/g, "/"), // normalize Windows paths
        forcerm: true,
        buildargs: buildArgs || {},
      },
    );

    return new Promise((resolve, reject) => {
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) return reject(err);
          resolve();
        },
        (event: any) => {
          if (event.stream) onLog?.(event.stream);
          if (event.error) {
            onLog?.(`ERROR: ${event.error}\n`);
            reject(new Error(event.error));
          }
        },
      );
    });
  }

  private generateDockerfile(
    contextPath: string,
    onLog?: (log: string) => void,
    port?: number,
  ): string | null {
    const pkgPath = path.join(contextPath, "package.json");

    if (!existsSync(pkgPath)) {
      // Check for Go
      if (existsSync(path.join(contextPath, "go.mod"))) {
        onLog?.(`Detected: Go project\n`);
        return this.dockerfileGo(port);
      }
      // Check for Python
      if (
        existsSync(path.join(contextPath, "requirements.txt")) ||
        existsSync(path.join(contextPath, "pyproject.toml"))
      ) {
        onLog?.(`Detected: Python project\n`);
        return this.dockerfilePython(contextPath, port);
      }
      return null;
    }

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};

    // Detect package manager
    let pm = "npm";
    let pmInstall = "npm install";
    let pmBuild = "npm run build";

    if (existsSync(path.join(contextPath, "pnpm-lock.yaml"))) {
      pm = "pnpm";
      pmInstall =
        "corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile";
      pmBuild = "pnpm run build";
    } else if (existsSync(path.join(contextPath, "yarn.lock"))) {
      pm = "yarn";
      pmInstall = "yarn install --frozen-lockfile";
      pmBuild = "yarn build";
    } else if (existsSync(path.join(contextPath, "bun.lockb"))) {
      pm = "bun";
      pmInstall = "bun install";
      pmBuild = "bun run build";
    } else if (existsSync(path.join(contextPath, "package-lock.json"))) {
      pmInstall = "npm ci";
    }

    if (deps["next"]) {
      onLog?.(`Detected: Next.js (${pm})\n`);
      return this.dockerfileNextjs(pmInstall, pmBuild, port);
    }

    // Static SPA (Vite, CRA, Vue, Angular, Svelte)
    if (
      deps["vite"] ||
      deps["react-scripts"] ||
      deps["@angular/cli"] ||
      deps["@sveltejs/kit"] ||
      deps["vue"]
    ) {
      const framework = deps["vite"]
        ? "Vite"
        : deps["react-scripts"]
          ? "Create React App"
          : deps["@angular/cli"]
            ? "Angular"
            : deps["@sveltejs/kit"]
              ? "SvelteKit"
              : "Vue";
      onLog?.(`Detected: ${framework} (${pm})\n`);

      // Detect output directory
      let outDir = "dist";
      if (deps["react-scripts"]) outDir = "build";
      if (deps["@angular/cli"]) outDir = `dist/${pkg.name || "app"}`;

      return this.dockerfileStaticSPA(pmInstall, pmBuild, outDir);
    }

    //Node.js server (Express, Fastify, etc.)
    if (
      deps["express"] ||
      deps["fastify"] ||
      deps["koa"] ||
      deps["hono"] ||
      scripts["start"]
    ) {
      onLog?.(`Detected: Node.js server (${pm})\n`);

      // Extract entry point from start script, dev script, or main field
      const entryPoint = this.detectEntryPoint(
        scripts["start"] || scripts["dev"],
        pkg.main,
      );

      return this.dockerfileNodeServer(
        pmInstall,
        pm,
        entryPoint,
        port,
        scripts["start"],
      );
    }

    // Fallback: if has build script, treat as static SPA
    if (scripts["build"]) {
      onLog?.(`Detected: Node.js project with build script (${pm})\n`);
      return this.dockerfileStaticSPA(pmInstall, pmBuild, "dist");
    }

    return null;
  }

  /**
   * Generate a Dockerfile for a monorepo workspace member.
   * Uses the monorepo root as the build context so workspace: deps resolve.
   */
  private generateDockerfileMonorepo(
    monorepoRoot: string,
    subDir: string,
    onLog?: (log: string) => void,
    port?: number,
  ): string | null {
    const pkgPath = path.join(monorepoRoot, subDir, "package.json");
    if (!existsSync(pkgPath)) return null;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};
    const pkgName: string | undefined = pkg.name;

    // Detect package manager from monorepo root.
    // Check lock files first; fall back to pnpm-workspace.yaml / packageManager field.
    let pmInstall = "npm install";
    let buildFilter = pkgName
      ? `npm --prefix ${subDir} run build`
      : `npm run build`;

    const rootPkg = (() => {
      try {
        return JSON.parse(
          readFileSync(path.join(monorepoRoot, "package.json"), "utf-8"),
        );
      } catch {
        return {};
      }
    })();
    const declaredPm: string = rootPkg.packageManager ?? "";

    const isPnpm =
      existsSync(path.join(monorepoRoot, "pnpm-lock.yaml")) ||
      existsSync(path.join(monorepoRoot, "pnpm-workspace.yaml")) ||
      declaredPm.startsWith("pnpm");
    const isYarn =
      !isPnpm &&
      (existsSync(path.join(monorepoRoot, "yarn.lock")) ||
        declaredPm.startsWith("yarn"));
    const isBun =
      !isPnpm &&
      !isYarn &&
      (existsSync(path.join(monorepoRoot, "bun.lockb")) ||
        declaredPm.startsWith("bun"));

    if (isPnpm) {
      const hasLock = existsSync(path.join(monorepoRoot, "pnpm-lock.yaml"));
      pmInstall = `corepack enable && corepack prepare pnpm@latest --activate && pnpm install${hasLock ? " --frozen-lockfile" : ""}`;
      // "pkgName..." tells pnpm to also build all workspace dependencies first
      buildFilter = pkgName
        ? `pnpm --filter="${pkgName}..." build`
        : `pnpm -C ${subDir} run build`;
    } else if (isYarn) {
      pmInstall = "yarn install --frozen-lockfile";
      buildFilter = pkgName
        ? `yarn workspace ${pkgName} build`
        : `yarn --cwd ${subDir} build`;
    } else if (isBun) {
      pmInstall = "bun install";
      buildFilter = pkgName
        ? `bun --filter=${pkgName} run build`
        : `bun run --cwd ${subDir} build`;
    }

    if (deps["next"]) {
      onLog?.(`Detected: Next.js monorepo workspace\n`);
      return this.dockerfileMonorepoNextjs(
        pmInstall,
        buildFilter,
        subDir,
        port,
      );
    }

    if (
      deps["vite"] ||
      deps["react-scripts"] ||
      deps["@angular/cli"] ||
      deps["@sveltejs/kit"] ||
      deps["vue"]
    ) {
      let outDir = "dist";
      if (deps["react-scripts"]) outDir = "build";
      if (deps["@angular/cli"]) outDir = `dist/${pkg.name || "app"}`;
      onLog?.(`Detected: SPA monorepo workspace\n`);
      return this.dockerfileMonorepoSPA(pmInstall, buildFilter, subDir, outDir);
    }

    if (
      deps["express"] ||
      deps["fastify"] ||
      deps["koa"] ||
      deps["hono"] ||
      scripts["start"]
    ) {
      onLog?.(`Detected: Node.js server monorepo workspace\n`);
      const entryPoint = this.detectEntryPoint(
        scripts["start"] || scripts["dev"],
        pkg.main,
      );
      return this.dockerfileMonorepoNodeServer(
        pmInstall,
        buildFilter,
        subDir,
        entryPoint,
        port,
        scripts["start"],
      );
    }

    if (scripts["build"]) {
      onLog?.(`Detected: Node.js monorepo workspace with build script\n`);
      return this.dockerfileMonorepoSPA(pmInstall, buildFilter, subDir, "dist");
    }

    return null;
  }

  private dockerfileMonorepoNextjs(
    installCmd: string,
    buildCmd: string,
    subDir: string,
    port?: number,
  ): string {
    const p = port || 3000;
    return `FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN ${installCmd}
RUN ${buildCmd}

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/${subDir}/.next/standalone ./
COPY --from=build /app/${subDir}/.next/static ./.next/static
COPY --from=build /app/${subDir}/public ./public
EXPOSE ${p}
CMD ["node", "server.js"]
`;
  }

  private dockerfileMonorepoSPA(
    installCmd: string,
    buildCmd: string,
    subDir: string,
    outDir: string,
  ): string {
    return `FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN ${installCmd}
RUN ${buildCmd}

FROM nginx:alpine
COPY --from=build /app/${subDir}/${outDir} /usr/share/nginx/html
RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`;
  }

  private dockerfileMonorepoNodeServer(
    installCmd: string,
    buildCmd: string,
    subDir: string,
    entryPoint = "dist/index.js",
    port?: number,
    startScript?: string,
  ): string {
    const p = port || 3000;
    const cmd = startScript
      ? `CMD ["npm", "start"]`
      : `CMD ["node", "${entryPoint}"]`;
    return `FROM node:20-alpine AS build
WORKDIR /app
COPY . .
RUN ${installCmd}
RUN ${buildCmd} 2>/dev/null || true

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
WORKDIR /app/${subDir}
EXPOSE ${p}
${cmd}
`;
  }

  private dockerfileStaticSPA(
    installCmd: string,
    buildCmd: string,
    outDir: string,
  ): string {
    return `FROM node:20-alpine AS build
    WORKDIR /app
    COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* ./
    RUN ${installCmd}
    COPY . .
    RUN ${buildCmd}

    FROM nginx:alpine
    COPY --from=build /app/${outDir} /usr/share/nginx/html
    RUN echo 'server { listen 80; root /usr/share/nginx/html; location / { try_files $uri $uri/ /index.html; } }' > /etc/nginx/conf.d/default.conf
    EXPOSE 80
    CMD ["nginx", "-g", "daemon off;"]
    `;
  }

  private dockerfileNextjs(
    installCmd: string,
    buildCmd: string,
    port?: number,
  ): string {
    const p = port || 3000;
    return `FROM node:20-alpine AS build
    WORKDIR /app
    COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* ./
    RUN ${installCmd}
    COPY . .
    RUN ${buildCmd}

    FROM node:20-alpine AS runner
    WORKDIR /app
    ENV NODE_ENV=production
    COPY --from=build /app/.next/standalone ./
    COPY --from=build /app/.next/static ./.next/static
    COPY --from=build /app/public ./public
    EXPOSE ${p}
    CMD ["node", "server.js"]
    `;
  }

  private dockerfileNodeServer(
    installCmd: string,
    pm: string,
    entryPoint = "dist/index.js",
    port?: number,
    startScript?: string,
  ): string {
    const p = port || 3000;
    // Prefer running the user's `start` script via `npm start` so multi-step
    // commands (e.g. "prisma migrate deploy && node dist/index.js") run intact.
    // Falls back to the detected entry point only when no start script exists.
    const cmd = startScript
      ? `CMD ["npm", "start"]`
      : `CMD ["node", "${entryPoint}"]`;
    return `FROM node:20-alpine
    WORKDIR /app
    COPY package*.json pnpm-lock.yaml* yarn.lock* bun.lockb* ./
    RUN ${installCmd}
    COPY . .
    RUN ${pm} run build 2>/dev/null || true
    EXPOSE ${p}
    ${cmd}
    `;
  }

  private dockerfileGo(port?: number): string {
    const p = port || 8080;
    return `FROM golang:1.22-alpine AS build
    WORKDIR /app
    COPY go.mod go.sum* ./
    RUN go mod download
    COPY . .
    RUN CGO_ENABLED=0 go build -o /app/server .

    FROM alpine:3.19
    WORKDIR /app
    COPY --from=build /app/server .
    EXPOSE ${p}
    CMD ["./server"]
    `;
  }

  private dockerfilePython(contextPath: string, port?: number): string {
    const p = port || 8000;
    const hasRequirements = existsSync(
      path.join(contextPath, "requirements.txt"),
    );
    const installCmd = hasRequirements
      ? "pip install --no-cache-dir -r requirements.txt"
      : "pip install --no-cache-dir .";

    return `FROM python:3.12-slim
    WORKDIR /app
    COPY requirements.txt* pyproject.toml* ./
    RUN ${installCmd}
    COPY . .
    EXPOSE ${p}
    CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${p}"]
    `;
  }

  private async buildNixpacks(
    contextPath: string,
    imageTag: string,
    onLog?: (log: string) => void,
    port?: number,
    startCommand?: string,
  ): Promise<void> {
    onLog?.(`Detecting project with Nixpacks...\n`);

    return new Promise((resolve, reject) => {
      const args = ["build", contextPath, "--name", imageTag];
      if (startCommand) {
        args.push("--start-cmd", startCommand);
        onLog?.(`Using custom start command: ${startCommand}\n`);
      }

      const proc = spawn("nixpacks", args, { timeout: 600_000 });

      proc.stdout.on("data", (data) => onLog?.(data.toString()));
      proc.stderr.on("data", (data) => onLog?.(data.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          // Nixpacks failed — fallback to Dockerfile
          onLog?.(
            `Nixpacks failed (exit code ${code}). Falling back to Dockerfile...\n`,
          );
          this.buildDockerfile(
            contextPath,
            imageTag,
            "./Dockerfile",
            undefined,
            onLog,
            port,
          )
            .then(resolve)
            .catch(reject);
          return;
        }
        resolve();
      });

      proc.on("error", () => {
        // Nixpacks not installed — fallback to Dockerfile
        onLog?.("Nixpacks not found. Falling back to Dockerfile...\n");
        this.buildDockerfile(
          contextPath,
          imageTag,
          "./Dockerfile",
          undefined,
          onLog,
          port,
        )
          .then(resolve)
          .catch(reject);
      });
    });
  }

  private async buildBuildpacks(
    contextPath: string,
    imageTag: string,
    onLog?: (log: string) => void,
  ): Promise<void> {
    onLog?.(`Building with Cloud Native Buildpacks...\n`);

    return new Promise((resolve, reject) => {
      const args = [
        "build",
        imageTag,
        "--path",
        contextPath,
        "--builder",
        "heroku/builder:24",
      ];

      const proc = spawn("pack", args, { timeout: 600_000 });

      proc.stdout.on("data", (data) => onLog?.(data.toString()));
      proc.stderr.on("data", (data) => onLog?.(data.toString()));

      proc.on("close", (code) => {
        if (code !== 0) {
          return reject(
            new Error(`Buildpack build failed with exit code ${code}`),
          );
        }
        resolve();
      });

      proc.on("error", reject);
    });
  }

  /**
   * Extract the Node.js entry point from the start script or main field.
   *
   * Examples:
   *   "node dist/server.js"          → "dist/server.js"
   *   "node build/index.mjs"         → "build/index.mjs"
   *   "node ."                       → "index.js"
   *   "tsx src/server.ts"            → "src/server.ts" (but we'll use dist equivalent)
   *   undefined + main: "server.js"  → "server.js"
   */
  private detectEntryPoint(startScript?: string, mainField?: string): string {
    const fallback = "dist/index.js";

    if (startScript) {
      // Match: node <path>, node --something <path> (but not ts-node/tsx)
      const nodeMatch = startScript.match(
        /(?:^|\s)node\s+(?:--[^\s]+\s+)*([^\s]+)/,
      );
      if (nodeMatch) {
        const entry = nodeMatch[1]!;
        return entry === "." ? "index.js" : entry;
      }

      // Match: tsx/ts-node <path>.ts → convert to dist/*.js
      // Skip subcommands like "watch"
      const tsMatch = startScript.match(
        /\b(?:tsx|ts-node)\s+(?:watch\s+)?(?:--[^\s]+\s+)*([^\s]+\.ts)/,
      );
      if (tsMatch) {
        return tsMatch[1]!.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
      }
    }

    // Fallback to "main" field in package.json
    if (mainField && mainField !== "index.js") {
      return mainField;
    }

    return fallback;
  }

  /**
   * Recursively list all files in a directory (relative paths).
   * Respects .dockerignore if present.
   */
  private listFilesRecursive(dir: string, base = ""): string[] {
    const files: string[] = [];

    // Load .dockerignore patterns on first call
    let ignorePatterns: string[] = ["node_modules", ".git"];
    if (!base) {
      const dockerignorePath = path.join(dir, ".dockerignore");
      if (existsSync(dockerignorePath)) {
        const content = readFileSync(dockerignorePath, "utf-8");
        ignorePatterns = content
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
      }
    }

    const entries = readdirSync(path.join(dir, base));
    for (const entry of entries) {
      const relativePath = base ? `${base}/${entry}` : entry;

      if (
        ignorePatterns.some((p) => entry === p || relativePath.startsWith(p))
      ) {
        continue;
      }

      const fullPath = path.join(dir, relativePath);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        files.push(...this.listFilesRecursive(dir, relativePath));
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }
}

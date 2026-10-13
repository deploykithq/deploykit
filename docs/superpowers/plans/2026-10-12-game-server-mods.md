# Game server mods & modpacks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install mods and modpacks on DeployKit game servers from Modrinth, CurseForge and the Steam Workshop: search, one-click install, enable/disable, update, start from a modpack.

**Architecture:** DeployKit stores the wanted mods (pinned versions) per server in `game_server_mods`; at provisioning it renders them into the env vars the game image already understands (`MODRINTH_PROJECTS`, `CURSEFORGE_FILES`, `TMOD_AUTODOWNLOAD`/`TMOD_ENABLEDMODS`, `TYPE=MODRINTH`…) and recreates the container. A per-source adapter layer proxies catalogue search; API keys live encrypted in a new `instance_settings` table edited from Settings.

**Tech Stack:** Fastify 5 + tRPC 11, Drizzle/PostgreSQL, BullMQ/Redis, dockerode, Zod in `packages/shared`, React 19 + TanStack Query, vitest.

**Spec:** `docs/superpowers/specs/2026-10-12-game-server-mods-design.md`

## Global Constraints

- **Never run `git commit`** (user rule). Every task ends with a *checkpoint* (typecheck + tests), not a commit. Work stays uncommitted on `feat/game-servers`.
- **Never run `pnpm db:generate`.** Migration `0027_add_game_server_mods.sql` is hand-written, every statement idempotent; journal entry idx 27, `when` **1789934427000** (> 0026's 1789934426000).
- RBAC: resolve the project role **before** any effect; non-member → `NOT_FOUND`, member lacking level → `FORBIDDEN`. Mutating mods = `operatorProcedure` **and** project `canOperate`. API keys = `adminProcedure`, values never returned.
- Secrets (API keys) are encrypted with `lib/encryption` (`encrypt`/`decrypt`) and only reach a container through dockerode `Env`. `applied_mod_env` never stores a key.
- Outbound HTTP only to the fixed hosts `api.modrinth.com`, `api.curseforge.com`, `api.steampowered.com`; user input is parsed for IDs, never fetched. 10 s timeout. Modrinth `User-Agent: deploykit/<version> (github.com/deploykithq/deploykit)`.
- Mod search rate limit: 30 requests / 60 s per user (`isRateLimited`).
- Web follows the existing `@game-server` feature layout (`infrastructure/ui/{components,hooks,constants,interfaces,utils}`), types suffixed `I`/`T`, no hexagonal HTTP layers (tRPC replaces them).
- Templates repo (`D:\Apps\projects\deploykit-templates`) also stays uncommitted.

## Review Focus

1. **Removing the last mod** — the list env var becomes empty; itzg must delete what it installed, not keep it (Task 0 verifies the semantics, Task 4 pins that the var is always emitted, even empty).
2. **Server whose loader setting has no mods (Vanilla)** — search/add must explain "switch Server type to Fabric/Forge/Paper", not 500 (Task 4 `compatFilter` test, Task 8 `addMod` test).
3. **`LATEST` / `SNAPSHOT` Minecraft version** — must resolve to a concrete version for filtering, not filter by the literal "LATEST" (Task 5 test).
4. **Pasted URL from another site or another Steam app** — must be refused with a clear message (Tasks 5–7 `parseRef` tests, Task 7 wrong-app test).
5. **Apply that removes mods / changes the modpack** — must force a safety backup even if the client asks not to (Task 4 `isDestructiveChange` test, Task 10 router uses it).

---

## File map

**Shared**
- Modify `packages/shared/src/games/game.schema.ts` — `mods` block, `exec` console, mod input schemas.
- Create `packages/shared/src/games/mods.schema.ts` — mod-specific Zod (sources, inputs, setting keys); re-exported by `games/index.ts`.

**API**
- Create `apps/api/src/db/migrations/0027_add_game_server_mods.sql`; modify `meta/_journal.json`.
- Create `apps/api/src/db/schema/instance-settings.ts`; modify `db/schema/game-servers.ts`, `db/schema/index.ts`.
- Create `apps/api/src/services/instance-settings.ts` (+ test).
- Create `apps/api/src/services/mod-sources/{types,http,modrinth,curseforge,steam,index}.ts` (+ tests per adapter).
- Create `apps/api/src/services/game-mods-env.ts` (pure, + test).
- Create `apps/api/src/services/game-mods.ts` (DB + adapters, + test for pure helpers).
- Modify `apps/api/src/services/game-server.ts` (mod env in provisioning, `recreateGameServer`, create with modpack).
- Modify `apps/api/src/services/game-console.ts` (`exec`), `workers/game-backup.worker.ts` (`apply-mods` job).
- Create `apps/api/src/routers/game-server-access.ts` (moved `resolveServer`/`rethrow`/`guarded`), `routers/game-server-mods.ts`, `routers/settings.ts`; modify `routers/game-server.ts`, `routers/index.ts`, `lib/audit/audit.types.ts`.

**Web**
- Modify `features/game-server/.../interfaces/game-server.interfaces.ts`, `constants/game-server.constants.ts`, `hooks/useGameServerDetail.ts`, `pages/GameServerDetailPage.tsx`, `components/index.ts`, `components/NewGameServerModal.tsx`, `hooks/useNewGameServer.ts`.
- Create `hooks/useGameMods.ts`, `hooks/useModSearch.ts`, `components/ModsTab.tsx`, `components/AddModsModal.tsx`, `components/ModpackCard.tsx`, `components/ModpackPicker.tsx`, `components/ModRow.tsx`.
- Create `features/settings/.../components/GameModsSection.tsx`, `hooks/useGameModKeys.ts`; modify `Settings.tsx`, `components/index.ts`.
- Modify audit labels (`audit.constants.ts`, `FilterBar.tsx`, `dashboard.constants.ts`).

**Templates repo**
- Modify `games/minecraft-java/game.json`; create `games/terraria-tmodloader/{game.json,logo.svg}`; regenerate `schema/game.schema.json`, `games/index.json`.

**Docs**: `CLAUDE.md` game servers section.

---

### Task 0: Verify image behaviour (spike, no product code)

**Files:** scratch only (`<scratchpad>/mods-spike/`).

The design depends on four behaviours of third-party images. Confirm them with real containers before writing code; record findings at the bottom of this plan under "Spike results" and adjust Tasks 1/4 if any differs.

- [ ] **Step 1: itzg — Modrinth project add/remove**

```bash
docker volume create spike-mc
docker run -d --name spike-mc -e EULA=TRUE -e TYPE=FABRIC -e VERSION=1.21.4 \
  -e MODRINTH_PROJECTS=lithium -e MEMORY=1G -v spike-mc:/data itzg/minecraft-server:java21
docker logs -f spike-mc   # wait for "Done ("
docker exec spike-mc ls /data/mods          # expect lithium-*.jar
docker rm -f spike-mc
docker run -d --name spike-mc -e EULA=TRUE -e TYPE=FABRIC -e VERSION=1.21.4 \
  -e MODRINTH_PROJECTS= -e MEMORY=1G -v spike-mc:/data itzg/minecraft-server:java21
# wait for Done, then:
docker exec spike-mc ls /data/mods          # expect: lithium removed
```
Record: does an **empty but set** `MODRINTH_PROJECTS` remove previously installed projects? Also test pinned form `MODRINTH_PROJECTS=<projectId>:<versionId>` (take ids from `curl https://api.modrinth.com/v2/project/lithium/version?game_versions=["1.21.4"]&loaders=["fabric"]`).

- [ ] **Step 2: itzg — modpack + extra projects + VERSION**

```bash
docker rm -f spike-mc; docker volume rm spike-mc; docker volume create spike-mc
# A small Fabric pack, e.g. "fabulously-optimized" is client-side; use "adrenaserver" (server pack)
curl -s 'https://api.modrinth.com/v2/project/adrenaserver/version' | head -c 600
docker run -d --name spike-mc -e EULA=TRUE -e TYPE=MODRINTH -e MODRINTH_MODPACK=adrenaserver \
  -e MODRINTH_VERSION=<versionId> -e VERSION=<its game version> \
  -e MODRINTH_PROJECTS=<a fabric mod not in the pack, e.g. chunky> -e MEMORY=2G \
  -v spike-mc:/data itzg/minecraft-server:java21
```
Record: (a) pack installs with `VERSION` set to the pack's game version; (b) whether the extra `MODRINTH_PROJECTS` mod is installed alongside; (c) whether an empty `MODRINTH_VERSION=` is treated as "latest".

- [ ] **Step 3: itzg — CurseForge**

Without a CurseForge key in hand, run `-e TYPE=FABRIC -e VERSION=1.21.4 -e CURSEFORGE_FILES=jei` on `java21` (image ships a key) and record whether it installs. If the user supplied a key, also run `TYPE=AUTO_CURSEFORGE -e CF_SLUG=<small pack> -e CF_API_KEY=...`.

- [ ] **Step 4: tModLoader image**

```bash
docker run -d --name spike-tml -e TMOD_AUTODOWNLOAD=2824688072 -e TMOD_ENABLEDMODS=2824688072 \
  -e TMOD_WORLDNAME=Spike -e TMOD_WORLDSIZE=1 -e TMOD_PASS=N/A -v spike-tml:/data \
  jacobsmile/tmodloader1.4:latest
docker logs -f spike-tml   # wait for "Server started"
docker exec spike-tml inject "say hello"     # appears in logs?
docker exec spike-tml sh -c 'ls /data/tModLoader/Mods; cat /data/tModLoader/Mods/enabled.json'
docker inspect -f '{{.Config.StopSignal}} {{json .Config.Env}}' spike-tml
time docker stop -t 60 spike-tml; docker logs --tail 20 spike-tml   # saved on stop?
```
Record: latest tag name to pin, `inject` works without a TTY, whether `docker stop` saves the world (decides `stop.command`), the Worlds path, the user/uid owning `/data`. (2824688072 = "Calamity Mod Music"? — any small Workshop mod ID works; check the title with GetPublishedFileDetails.)

- [ ] **Step 5: Clean up**

```bash
docker rm -f spike-mc spike-tml; docker volume rm spike-mc spike-tml
```

---

### Task 1: Shared contract — `mods` block, `exec` console, input schemas

**Files:**
- Create: `packages/shared/src/games/mods.schema.ts`
- Modify: `packages/shared/src/games/game.schema.ts`
- Modify: `packages/shared/src/games/index.ts`
- Modify: `packages/shared/scripts/emit-template-schema.ts` (no code change expected; verify `--schema game` still emits)
- Test: `apps/api/src/lib/game-schema.test.ts`

**Interfaces:**
- Produces (from `@deploykit/shared`):
  - `MOD_SOURCES = ["modrinth","curseforge","steam-workshop"] as const`, `type ModSourceIdT`
  - `MODPACK_VARIABLES` (`dk_modpack_project`, `dk_modpack_slug`, `dk_modpack_version`, `dk_modpack_game_version`, `dk_modpack_loader`)
  - `gameModsSchema`, `type GameModsSpecT`, `type GameModSourceT`
  - `GAME_MOD_KEYS = ["curseforge_api_key","steam_web_api_key"] as const`, `type GameModKeyT`
  - `gameModSearchSchema`, `gameModSearchForGameSchema`, `addGameModSchema`, `updateGameModSchema`, `removeGameModSchema`, `gameModpackRefSchema`, `setGameModpackSchema`, `applyGameModsSchema`, `gameModVersionsSchema`, `setGameModKeySchema`
  - `GameSpecT["mods"]` optional; `GameConsoleT` gains `{ method: "exec"; command: string[] }`
  - `createGameServerSchema` gains `modpack?: GameModpackRefT`

- [ ] **Step 1: Write the failing tests** (append to `apps/api/src/lib/game-schema.test.ts`; reuse that file's existing `baseSpec` helper — if it is named differently, use the existing minimal valid spec object the file already builds)

```ts
import { gameSpecSchema, MODPACK_VARIABLES, addGameModSchema } from "@deploykit/shared";

const mcLike = (mods: unknown, extra: Record<string, unknown> = {}) => ({
  id: "mc",
  name: "MC",
  version: "1",
  description: "x",
  image: "img:1",
  ports: [{ name: "game", protocol: "tcp", container: 25565 }],
  volumes: [{ name: "data", path: "/data", primary: true }],
  variables: [
    {
      key: "server_type", label: "Type", type: "select", default: "FABRIC",
      options: [{ label: "Vanilla", value: "VANILLA" }, { label: "Fabric", value: "FABRIC" }],
    },
    { key: "mc_version", label: "Version", type: "string", default: "LATEST" },
  ],
  env: { TYPE: "${server_type}", VERSION: "${mc_version}" },
  mods,
  ...extra,
});

const MODS = {
  sources: [
    { source: "modrinth", env: "MODRINTH_PROJECTS" },
    { source: "curseforge", env: "CURSEFORGE_FILES", apiKeyEnv: "CF_API_KEY" },
  ],
  loader: { from: "server_type", map: { FABRIC: { loaders: ["fabric"], kind: "mod" } } },
  gameVersion: { from: "mc_version", aliases: { LATEST: "release" } },
  modpacks: [
    {
      source: "modrinth",
      env: {
        TYPE: "MODRINTH",
        MODRINTH_MODPACK: "${dk_modpack_project}",
        VERSION: "${dk_modpack_game_version}",
      },
    },
  ],
  directories: [{ volume: "data", path: "mods" }],
};

describe("gameSpecSchema mods", () => {
  it("accepts a valid mods block", () => {
    expect(gameSpecSchema.safeParse(mcLike(MODS)).success).toBe(true);
  });

  it("refuses a duplicate source", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ ...MODS, sources: [MODS.sources[0], MODS.sources[0]] }),
    );
    expect(r.success).toBe(false);
  });

  it("requires appId for steam-workshop and refuses it elsewhere", () => {
    expect(
      gameSpecSchema.safeParse(
        mcLike({ sources: [{ source: "steam-workshop", env: "TMOD_AUTODOWNLOAD" }] }),
      ).success,
    ).toBe(false);
    expect(
      gameSpecSchema.safeParse(
        mcLike({ sources: [{ source: "modrinth", env: "MODRINTH_PROJECTS", appId: 5 }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a source env that collides with the game's env", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ sources: [{ source: "modrinth", env: "TYPE" }] }),
    );
    expect(r.success).toBe(false);
  });

  it("refuses a loader map key that is not an option of the select", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({
        ...MODS,
        loader: { from: "server_type", map: { FORGE: { loaders: ["forge"], kind: "mod" } } },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("refuses a modpack from an undeclared source", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ ...MODS, sources: [MODS.sources[0]], modpacks: [{ source: "curseforge", env: { TYPE: "AUTO_CURSEFORGE" } }] }),
    );
    expect(r.success).toBe(false);
  });

  it("allows dk_modpack_* only inside modpacks[].env", () => {
    const r = gameSpecSchema.safeParse(
      mcLike(MODS, { env: { TYPE: "${server_type}", X: "${dk_modpack_project}" } }),
    );
    expect(r.success).toBe(false);
    expect(MODPACK_VARIABLES).toContain("dk_modpack_game_version");
  });

  it("refuses a directory on an unknown volume", () => {
    const r = gameSpecSchema.safeParse(
      mcLike({ ...MODS, directories: [{ volume: "nope", path: "mods" }] }),
    );
    expect(r.success).toBe(false);
  });

  it("accepts the exec console and lets it satisfy backup commands", () => {
    const r = gameSpecSchema.safeParse(
      mcLike(undefined, {
        console: { method: "exec", command: ["inject"] },
        backup: { preCommands: ["save"] },
      }),
    );
    expect(r.success).toBe(true);
  });
});

describe("mod inputs", () => {
  it("bounds the pasted reference", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(addGameModSchema.safeParse({ id, source: "modrinth", ref: "lithium" }).success).toBe(true);
    expect(addGameModSchema.safeParse({ id, source: "modrinth", ref: "" }).success).toBe(false);
    expect(addGameModSchema.safeParse({ id, source: "nope", ref: "x" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter api exec vitest run src/lib/game-schema.test.ts`
Expected: FAIL (`MODPACK_VARIABLES` / `addGameModSchema` not exported; mods block ignored).

- [ ] **Step 3: Create `packages/shared/src/games/mods.schema.ts`**

```ts
import { z } from "zod";

import { RELATIVE_PATH_REGEX } from "../types";
import { VARIABLE_NAME_REGEX } from "../templates/template.schema";

/**
 * Mods for game servers.
 *
 * A game declares where its mods come from and which env vars its image reads
 * them from; DeployKit keeps the list and renders it into those vars at
 * provisioning. The image (itzg, tModLoader…) does the downloading.
 */

const MOD_SOURCES = ["modrinth", "curseforge", "steam-workshop"] as const;
const modSourceIdSchema = z.enum(MOD_SOURCES);

/** Built-ins available only inside `mods.modpacks[].env`. */
const MODPACK_VARIABLES = [
  "dk_modpack_project",
  "dk_modpack_slug",
  "dk_modpack_version",
  "dk_modpack_game_version",
  "dk_modpack_loader",
] as const;

const ENV_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SLUG_REGEX = /^[a-z][a-z0-9_]{0,31}$/;
const envKey = z.string().min(1).max(256).regex(ENV_KEY_REGEX, "Invalid env var name");

const gameModSourceSchema = z.object({
  source: modSourceIdSchema,
  /** Env var that receives the comma-separated list. */
  env: envKey,
  /** Steam only: env var that receives the *enabled* subset. */
  enabledEnv: envKey.optional(),
  /** CurseForge only: env var that receives the instance API key. */
  apiKeyEnv: envKey.optional(),
  /** Steam only: the Workshop app id (tModLoader = 1281930). */
  appId: z.number().int().positive().optional(),
});

const gameModsSchema = z.object({
  sources: z.array(gameModSourceSchema).min(1).max(3),
  /** Which loader (and so which kind of content) a server runs, from a select. */
  loader: z
    .object({
      from: z.string().regex(VARIABLE_NAME_REGEX),
      map: z.record(
        z.string().max(200),
        z.object({
          loaders: z.array(z.string().regex(/^[a-z0-9-]{1,30}$/)).min(1).max(5),
          kind: z.enum(["mod", "plugin"]),
        }),
      ),
    })
    .optional(),
  /** Which game version to filter by; aliases resolve to the newest release/any. */
  gameVersion: z
    .object({
      from: z.string().regex(VARIABLE_NAME_REGEX),
      aliases: z.record(z.string().max(32), z.enum(["release", "any"])).default({}),
    })
    .optional(),
  modpacks: z
    .array(
      z.object({
        source: modSourceIdSchema,
        env: z.record(envKey, z.string().max(1_000)),
      }),
    )
    .max(3)
    .default([]),
  /** Folders whose files the Mods tab lists as "on disk". */
  directories: z
    .array(
      z.object({
        volume: z.string().regex(SLUG_REGEX),
        path: z.string().min(1).max(255).regex(RELATIVE_PATH_REGEX),
      }),
    )
    .max(5)
    .default([]),
});

// ─── API inputs ──────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
/** A project id, slug or pasted URL; parsed by the source adapter. */
const modRef = z.string().trim().min(1).max(500);
const versionId = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/);
const modKind = z.enum(["mod", "plugin", "modpack"]);

const gameModSearchSchema = z.object({
  id: uuid,
  source: modSourceIdSchema,
  query: z.string().max(100).default(""),
  kind: modKind.optional(),
  offset: z.number().int().min(0).max(9_980).default(0),
});

/** Modpack search before a server exists (the create modal). */
const gameModSearchForGameSchema = z.object({
  gameId: z.string().min(1).max(64),
  source: modSourceIdSchema,
  query: z.string().max(100).default(""),
  offset: z.number().int().min(0).max(9_980).default(0),
});

const gameModVersionsSchema = z.object({
  /** Either a server (filtered for it) or a game (unfiltered, for modpacks). */
  id: uuid.optional(),
  gameId: z.string().min(1).max(64).optional(),
  source: modSourceIdSchema,
  projectId: z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
  kind: modKind.default("mod"),
});

const addGameModSchema = z.object({
  id: uuid,
  source: modSourceIdSchema,
  ref: modRef,
  versionId: versionId.optional(),
});

const updateGameModSchema = z.object({
  id: uuid,
  modId: uuid,
  enabled: z.boolean().optional(),
  versionId: versionId.optional(),
});

const removeGameModSchema = z.object({ id: uuid, modId: uuid });

const gameModpackRefSchema = z.object({
  source: modSourceIdSchema,
  ref: modRef,
  versionId: versionId.optional(),
});

const setGameModpackSchema = z.object({
  id: uuid,
  modpack: gameModpackRefSchema.nullable(),
});

const applyGameModsSchema = z.object({
  id: uuid,
  /** Ignored (forced on) when the change removes mods or swaps the modpack. */
  safetyBackup: z.boolean().default(false),
});

const GAME_MOD_KEYS = ["curseforge_api_key", "steam_web_api_key"] as const;

const setGameModKeySchema = z.object({
  key: z.enum(GAME_MOD_KEYS),
  value: z.string().trim().min(8).max(200).nullable(),
});

type ModSourceIdT = z.infer<typeof modSourceIdSchema>;
type ModKindT = z.infer<typeof modKind>;
type GameModsSpecT = z.infer<typeof gameModsSchema>;
type GameModSourceT = z.infer<typeof gameModSourceSchema>;
type GameModpackRefT = z.infer<typeof gameModpackRefSchema>;
type GameModKeyT = (typeof GAME_MOD_KEYS)[number];

export {
  MOD_SOURCES,
  MODPACK_VARIABLES,
  GAME_MOD_KEYS,
  modSourceIdSchema,
  gameModSourceSchema,
  gameModsSchema,
  gameModSearchSchema,
  gameModSearchForGameSchema,
  gameModVersionsSchema,
  addGameModSchema,
  updateGameModSchema,
  removeGameModSchema,
  gameModpackRefSchema,
  setGameModpackSchema,
  applyGameModsSchema,
  setGameModKeySchema,
  type ModSourceIdT,
  type ModKindT,
  type GameModsSpecT,
  type GameModSourceT,
  type GameModpackRefT,
  type GameModKeyT,
};
```

- [ ] **Step 4: Wire it into `game.schema.ts`**

Add import at the top:

```ts
import { MODPACK_VARIABLES, gameModsSchema, gameModpackRefSchema } from "./mods.schema";
```

Replace `gameConsoleSchema` with:

```ts
const gameConsoleSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("rcon"),
    protocol: z.enum(["source", "minecraft"]),
    /** Container port RCON listens on. It does not need to be published. */
    port: z.number().int().min(1).max(65535),
    /** Key of the secret variable holding the RCON password. */
    passwordVar: z.string().regex(VARIABLE_NAME_REGEX),
  }),
  /** Commands are written to the server process' stdin. */
  z.object({ method: z.literal("stdin") }),
  /**
   * Each command runs as `docker exec <container> ...command "<cmd>"` — for
   * images that ship their own injector (tModLoader's `inject`).
   */
  z.object({
    method: z.literal("exec"),
    command: z.array(z.string().min(1).max(100)).min(1).max(5),
  }),
  z.object({ method: z.literal("none") }),
]);
```

In `gameSpecSchema`'s `.extend({...})`, after `notes`, add:

```ts
    /** Where mods come from and how the image receives them. */
    mods: gameModsSchema.optional(),
```

At the end of the `superRefine` callback (after the `readyPattern` check) add:

```ts
    if (spec.mods) {
      const mods = spec.mods;
      const seen = new Set<string>();
      const modEnvNames = new Set<string>();
      mods.sources.forEach((s, i) => {
        if (seen.has(s.source)) issue(["mods", "sources", i], `Duplicate source "${s.source}"`);
        seen.add(s.source);
        const isSteam = s.source === "steam-workshop";
        if (isSteam && s.appId === undefined) issue(["mods", "sources", i, "appId"], "steam-workshop needs appId");
        if (!isSteam && (s.appId !== undefined || s.enabledEnv !== undefined)) {
          issue(["mods", "sources", i], "appId and enabledEnv are for steam-workshop only");
        }
        if (s.apiKeyEnv !== undefined && s.source !== "curseforge") {
          issue(["mods", "sources", i, "apiKeyEnv"], "apiKeyEnv is for curseforge only");
        }
        for (const name of [s.env, s.enabledEnv, s.apiKeyEnv]) {
          if (name === undefined) continue;
          if (name in spec.env) issue(["mods", "sources", i], `${name} is already set in env`);
          if (modEnvNames.has(name)) issue(["mods", "sources", i], `${name} is used twice`);
          modEnvNames.add(name);
        }
      });

      if (mods.loader) {
        const select = spec.variables.find((v) => v.key === mods.loader!.from);
        if (!select || select.type !== "select") {
          issue(["mods", "loader", "from"], "loader.from must be a select variable");
        } else {
          for (const value of Object.keys(mods.loader.map)) {
            if (!select.options!.some((o) => o.value === value)) {
              issue(["mods", "loader", "map", value], `"${value}" is not an option of ${select.key}`);
            }
          }
        }
      }
      if (mods.gameVersion && !varKeys.has(mods.gameVersion.from)) {
        issue(["mods", "gameVersion", "from"], "gameVersion.from is not a declared variable");
      }

      const packKnown = new Set<string>([...known, ...MODPACK_VARIABLES]);
      const packSources = new Set<string>();
      mods.modpacks.forEach((p, i) => {
        if (!seen.has(p.source)) issue(["mods", "modpacks", i, "source"], `"${p.source}" is not in sources`);
        if (p.source === "steam-workshop") issue(["mods", "modpacks", i, "source"], "The Workshop has no modpacks");
        if (packSources.has(p.source)) issue(["mods", "modpacks", i], `Duplicate modpack source "${p.source}"`);
        packSources.add(p.source);
        for (const [key, value] of Object.entries(p.env)) {
          for (const ref of referencesIn(value)) {
            if (ref.arg !== undefined || !packKnown.has(ref.name)) {
              issue(["mods", "modpacks", i, "env", key], `\${${ref.name}} is not available here`);
            }
          }
        }
      });

      mods.directories.forEach((d, i) => {
        if (!volumeNames.has(d.volume)) issue(["mods", "directories", i, "volume"], `Unknown volume "${d.volume}"`);
      });
    }
```

(`varKeys`, `known`, `volumeNames`, `issue`, `referencesIn` already exist in that callback/file; `known` must be declared before this block — it is.)

Add `modpack` to `createGameServerSchema`:

```ts
  serverId: z.string().uuid().nullable().optional(),
  /** Start from a modpack instead of the plain game (games with mods.modpacks). */
  modpack: gameModpackRefSchema.optional(),
```

- [ ] **Step 5: Export from `packages/shared/src/games/index.ts`**

```ts
export * from "./game.schema";
export * from "./mods.schema";
```
(If `index.ts` already uses `export *` for `game.schema`, only add the second line.)

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter api exec vitest run src/lib/game-schema.test.ts` → PASS
Run: `pnpm --filter @deploykit/shared exec tsc --noEmit` → no errors
Run: `pnpm --filter @deploykit/shared schema:emit -- --schema game --out ../../../deploykit-templates/schema/game.schema.json` → file updated, then `cd ../deploykit-templates && npm test` → still valid.

- [ ] **Step 7: Checkpoint** — no commit (repo rule). `git status` shows the two shared files and the test modified.

---

### Task 2: Migration 0027 and Drizzle schema

**Files:**
- Create: `apps/api/src/db/migrations/0027_add_game_server_mods.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`
- Create: `apps/api/src/db/schema/instance-settings.ts`
- Modify: `apps/api/src/db/schema/game-servers.ts`, `apps/api/src/db/schema/index.ts`

**Interfaces:**
- Produces: tables `instanceSettings`, `gameServerMods` (Drizzle), types `InstanceSettingT`, `GameServerModT`, `NewGameServerModT`; `gameServers.modpack` (`GameModpackI | null`), `gameServers.appliedModEnv` (`Record<string,string> | null`); relation `gameServers.mods`.
- `GameModpackI` (exported from `db/schema/game-servers.ts`):
  `{ source: ModSourceIdT; projectId: string; slug: string | null; name: string; iconUrl: string | null; versionId: string; versionLabel: string; gameVersion: string | null; loader: string | null }`

- [ ] **Step 1: Write the migration**

```sql
-- Mods & modpacks for game servers, and instance-wide settings (API keys).

CREATE TABLE IF NOT EXISTS "instance_settings" (
  "key"        varchar(100) PRIMARY KEY,
  "value"      text NOT NULL,
  "updated_by" uuid,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "instance_settings"
    ADD CONSTRAINT "instance_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "game_server_mods" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "game_server_id" uuid NOT NULL,
  "source"         varchar(20) NOT NULL,
  "project_id"     varchar(100) NOT NULL,
  "slug"           varchar(200),
  "name"           varchar(200) NOT NULL,
  "icon_url"       varchar(1000),
  "kind"           varchar(10) DEFAULT 'mod' NOT NULL,
  "version_id"     varchar(100),
  "version_label"  varchar(200),
  "enabled"        boolean DEFAULT true NOT NULL,
  "added_by"       uuid,
  "created_at"     timestamp DEFAULT now() NOT NULL,
  "updated_at"     timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_game_server_id_fk"
    FOREIGN KEY ("game_server_id") REFERENCES "game_servers"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_added_by_users_id_fk"
    FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "game_server_mods"
    ADD CONSTRAINT "game_server_mods_source_check"
    CHECK ("source" IN ('modrinth', 'curseforge', 'steam-workshop'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "game_server_mods_project_unique"
  ON "game_server_mods" ("game_server_id", "source", "project_id");

ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "modpack" jsonb;
ALTER TABLE "game_servers" ADD COLUMN IF NOT EXISTS "applied_mod_env" jsonb;
```

- [ ] **Step 2: Journal entry** — append after the 0026 entry:

```json
    {
      "idx": 27,
      "version": "7",
      "when": 1789934427000,
      "tag": "0027_add_game_server_mods",
      "breakpoints": true
    }
```

- [ ] **Step 3: `db/schema/instance-settings.ts`**

```ts
import { pgTable, varchar, text, uuid, timestamp } from "drizzle-orm/pg-core";

import { users } from "./users";

/**
 * Instance-wide settings an admin edits at runtime (third-party API keys).
 * `value` is always `encrypt(...)` output; read it through
 * `services/instance-settings.ts`, never directly.
 */
const instanceSettings = pgTable("instance_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

type InstanceSettingT = typeof instanceSettings.$inferSelect;

export { instanceSettings, type InstanceSettingT };
```

- [ ] **Step 4: `db/schema/game-servers.ts`** — add to imports `uniqueIndex` from `drizzle-orm/pg-core` and `type ModSourceIdT` from `@deploykit/shared`; add the interface and columns:

```ts
/** The modpack a server was built from (snapshotted when it was chosen). */
interface GameModpackI {
  source: ModSourceIdT;
  projectId: string;
  slug: string | null;
  name: string;
  iconUrl: string | null;
  versionId: string;
  versionLabel: string;
  gameVersion: string | null;
  loader: string | null;
}
```

Inside `gameServers` (before `createdAt`):

```ts
  // The modpack the server runs, or null for the plain game.
  modpack: jsonb("modpack").$type<GameModpackI>(),
  // Mod env rendered at the last provisioning, without API keys. A mismatch
  // with what the current list renders is "changes pending".
  appliedModEnv: jsonb("applied_mod_env").$type<Record<string, string>>(),
```

New table (after `gameServerBackups`):

```ts
/** Mods a server wants, pinned to a version. The image installs them. */
const gameServerMods = pgTable(
  "game_server_mods",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameServerId: uuid("game_server_id")
      .references(() => gameServers.id, { onDelete: "cascade" })
      .notNull(),
    source: varchar("source", { length: 20 }).$type<ModSourceIdT>().notNull(),
    projectId: varchar("project_id", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 200 }),
    name: varchar("name", { length: 200 }).notNull(),
    iconUrl: varchar("icon_url", { length: 1000 }),
    kind: varchar("kind", { length: 10 }).$type<"mod" | "plugin">().default("mod").notNull(),
    // Null for Workshop items, which cannot be pinned.
    versionId: varchar("version_id", { length: 100 }),
    versionLabel: varchar("version_label", { length: 200 }),
    enabled: boolean("enabled").default(true).notNull(),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("game_server_mods_project_unique").on(t.gameServerId, t.source, t.projectId)],
);
```

Add `mods: many(gameServerMods)` to the `gameServers` relations, a `gameServerModsRelations` (`gameServer: one(gameServers, …)`), and types:

```ts
type GameServerModT = typeof gameServerMods.$inferSelect;
type NewGameServerModT = typeof gameServerMods.$inferInsert;
```

Export `gameServerMods`, `gameServerModsRelations`, `GameServerModT`, `NewGameServerModT`, `GameModpackI`. (Match how the file already declares its `uniqueIndex` for `game_server_ports` — if it uses the object form `(t) => ({...})`, use that form.)

- [ ] **Step 5: `db/schema/index.ts`** — add `export * from "./instance-settings";` next to the other exports.

- [ ] **Step 6: Apply and replay against a throwaway Postgres**

```bash
docker run -d --name dk-mig-27 -e POSTGRES_PASSWORD=x -p 55433:5432 postgres:16-alpine
# wait ~3 s
cd apps/api
DATABASE_URL=postgres://postgres:x@127.0.0.1:55433/postgres pnpm db:migrate     # all 28 applied
DATABASE_URL=postgres://postgres:x@127.0.0.1:55433/postgres pnpm db:migrate     # nothing to do, no error
docker exec dk-mig-27 psql -U postgres -c 'DELETE FROM drizzle.__drizzle_migrations;'
DATABASE_URL=postgres://postgres:x@127.0.0.1:55433/postgres pnpm db:migrate     # full replay succeeds
docker exec dk-mig-27 psql -U postgres -c '\d game_server_mods'
docker rm -f dk-mig-27
```
Expected: three runs succeed; the table shows the unique index and the check.

- [ ] **Step 7: Typecheck** — `pnpm --filter api exec tsc --noEmit` → clean. Checkpoint, no commit.

---

### Task 3: Instance settings service + `settings` router

**Files:**
- Create: `apps/api/src/services/instance-settings.ts`
- Create: `apps/api/src/services/instance-settings.test.ts`
- Create: `apps/api/src/routers/settings.ts`
- Modify: `apps/api/src/routers/index.ts`, `apps/api/src/lib/audit/audit.types.ts`

**Interfaces:**
- Consumes: `instanceSettings` (Task 2), `encrypt`/`decrypt`, `GAME_MOD_KEYS`, `setGameModKeySchema` (Task 1).
- Produces:
  - `getSetting(key: string): Promise<string | null>`
  - `setSetting(key: string, value: string | null, userId: string | null): Promise<void>`
  - `settingStatus(key: string): Promise<{ configured: boolean; last4: string | null }>`
  - `clearSettingsCache(): void` (tests)
  - The router is written here **without** key validation; Task 7 Step 5 adds the `validateModKey` call once the adapters exist.
  - tRPC `settings.modKeys.status` → `{ curseforge_api_key: {configured,last4}, steam_web_api_key: {configured,last4} }`, `settings.modKeys.set({key,value})`.
  - Audit action `"settings.update"`, resource type `"settings"`.

- [ ] **Step 1: Failing test** `services/instance-settings.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, { key: string; value: string }>();

vi.mock("../db/index", () => ({
  db: {
    query: {
      instanceSettings: {
        findFirst: vi.fn(async ({ where }: any) => store.get(where.__key) ?? undefined),
      },
    },
    insert: () => ({
      values: (row: any) => ({
        onConflictDoUpdate: async () => {
          store.set(row.key, row);
        },
      }),
    }),
    delete: () => ({
      where: async (w: any) => {
        store.delete(w.__key);
      },
    }),
  },
}));
vi.mock("drizzle-orm", async (orig) => ({
  ...(await orig<typeof import("drizzle-orm")>()),
  eq: (_col: unknown, key: string) => ({ __key: key }),
}));
vi.mock("../lib/encryption", () => ({
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, "$1"),
}));

const { getSetting, setSetting, settingStatus, clearSettingsCache } = await import(
  "./instance-settings"
);

beforeEach(() => {
  store.clear();
  clearSettingsCache();
});

describe("instance settings", () => {
  it("stores encrypted and reads back decrypted", async () => {
    await setSetting("curseforge_api_key", "secret-abcd", null);
    expect(store.get("curseforge_api_key")!.value).toBe("enc(secret-abcd)");
    expect(await getSetting("curseforge_api_key")).toBe("secret-abcd");
  });

  it("reports status without the value", async () => {
    expect(await settingStatus("steam_web_api_key")).toEqual({ configured: false, last4: null });
    await setSetting("steam_web_api_key", "0123456789ABCDEF", null);
    expect(await settingStatus("steam_web_api_key")).toEqual({ configured: true, last4: "CDEF" });
  });

  it("clears with null and invalidates the cache", async () => {
    await setSetting("curseforge_api_key", "secret-abcd", null);
    expect(await getSetting("curseforge_api_key")).toBe("secret-abcd");
    await setSetting("curseforge_api_key", null, null);
    expect(await getSetting("curseforge_api_key")).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/services/instance-settings.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `services/instance-settings.ts`**

```ts
import { eq } from "drizzle-orm";

import { db } from "../db/index";
import { instanceSettings } from "../db/schema/index";
import { encrypt, decrypt } from "../lib/encryption";

/**
 * Instance-wide settings an admin edits at runtime — today, the CurseForge
 * and Steam API keys. Values are encrypted at rest; reads are cached briefly
 * in-process because every mod search asks for a key.
 */

const CACHE_MS = 60_000;
const cache = new Map<string, { value: string | null; at: number }>();

const clearSettingsCache = () => cache.clear();

const getSetting = async (key: string): Promise<string | null> => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const row = await db.query.instanceSettings.findFirst({ where: eq(instanceSettings.key, key) });
  const value = row ? decrypt(row.value) : null;
  cache.set(key, { value, at: Date.now() });
  return value;
};

const setSetting = async (
  key: string,
  value: string | null,
  userId: string | null,
): Promise<void> => {
  if (value === null) {
    await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
  } else {
    const row = { key, value: encrypt(value), updatedBy: userId, updatedAt: new Date() };
    await db
      .insert(instanceSettings)
      .values(row)
      .onConflictDoUpdate({
        target: instanceSettings.key,
        set: { value: row.value, updatedBy: userId, updatedAt: row.updatedAt },
      });
  }
  cache.delete(key);
};

/** Whether a setting is set, and its last four characters to recognise it. */
const settingStatus = async (
  key: string,
): Promise<{ configured: boolean; last4: string | null }> => {
  const value = await getSetting(key);
  return value ? { configured: true, last4: value.slice(-4) } : { configured: false, last4: null };
};

export { getSetting, setSetting, settingStatus, clearSettingsCache };
```

- [ ] **Step 4: Run test** → PASS.

- [ ] **Step 5: Audit types** — in `lib/audit/audit.types.ts` add to `AuditActionT`:

```ts
  | "settings.update"
  | "game_server.mod_add"
  | "game_server.mod_update"
  | "game_server.mod_remove"
  | "game_server.modpack_set"
  | "game_server.mods_apply"
```
and `| "settings"` to `ResourceTypeT`.

- [ ] **Step 6: `routers/settings.ts`**

```ts
import { GAME_MOD_KEYS, setGameModKeySchema } from "@deploykit/shared";

import { router, adminProcedure } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { setSetting, settingStatus } from "../services/instance-settings";

/**
 * Instance settings. Admin only; a stored value is never returned — only
 * whether it is set and its last four characters.
 */
export const settingsRouter = router({
  modKeys: router({
    status: adminProcedure.query(async () =>
      Object.fromEntries(
        await Promise.all(GAME_MOD_KEYS.map(async (k) => [k, await settingStatus(k)] as const)),
      ),
    ),

    set: adminProcedure.input(setGameModKeySchema).mutation(async ({ ctx, input }) => {
      await setSetting(input.key, input.value, ctx.user.id);
      await logAction(ctx, {
        action: "settings.update",
        resourceType: "settings",
        resourceId: input.key,
        resourceName: input.key,
        metadata: { cleared: input.value === null },
      });
      return settingStatus(input.key);
    }),
  }),
});
```

Register in `routers/index.ts`: `import { settingsRouter } from "./settings";` and `settings: settingsRouter,` in `appRouter`.

- [ ] **Step 7: Checkpoint** — `pnpm --filter api exec tsc --noEmit` clean; the new test passes. No commit.

---

### Task 4: Pure mod-env rendering and compatibility (`game-mods-env.ts`)

**Files:**
- Create: `apps/api/src/services/game-mods-env.ts`
- Test: `apps/api/src/services/game-mods-env.test.ts`

**Interfaces:**
- Consumes: `GameModsSpecT`, `GameSpecT` (Task 1), `GameModpackI` (Task 2), `substitute` from `./template-variables`.
- Produces:
  - `interface ModEntryI { source: ModSourceIdT; projectId: string; versionId: string | null; enabled: boolean }`
  - `interface RenderedModEnvI { env: Record<string,string>; secretKeys: string[] }`
  - `renderModEnv(mods: GameModsSpecT | undefined, entries: ModEntryI[], modpack: GameModpackI | null, keys: { curseforge: string | null }): RenderedModEnvI`
  - `snapshotModEnv(r: RenderedModEnvI): Record<string,string>` — env minus `secretKeys`
  - `modEnvPending(r: RenderedModEnvI, applied: Record<string,string> | null): boolean`
  - `isDestructiveChange(applied: Record<string,string> | null, next: Record<string,string>, mods: GameModsSpecT | undefined): boolean`
  - `interface CompatI { loaders: string[] | null; kind: "mod" | "plugin" | null; gameVersion: string | null; versionAlias: "release" | "any" | null; unsupported: string | null }`
  - `compatFilter(spec: Pick<GameSpecT,"mods"|"variables">, values: Record<string,string>, modpack: GameModpackI | null): CompatI`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";

import {
  compatFilter,
  isDestructiveChange,
  modEnvPending,
  renderModEnv,
  snapshotModEnv,
} from "./game-mods-env";

const MODS = {
  sources: [
    { source: "modrinth" as const, env: "MODRINTH_PROJECTS" },
    { source: "curseforge" as const, env: "CURSEFORGE_FILES", apiKeyEnv: "CF_API_KEY" },
  ],
  loader: {
    from: "server_type",
    map: {
      FABRIC: { loaders: ["fabric"], kind: "mod" as const },
      PAPER: { loaders: ["paper", "bukkit", "spigot"], kind: "plugin" as const },
    },
  },
  gameVersion: { from: "mc_version", aliases: { LATEST: "release" as const, SNAPSHOT: "any" as const } },
  modpacks: [
    {
      source: "modrinth" as const,
      env: {
        TYPE: "MODRINTH",
        MODRINTH_MODPACK: "${dk_modpack_project}",
        MODRINTH_VERSION: "${dk_modpack_version}",
        VERSION: "${dk_modpack_game_version}",
      },
    },
  ],
  directories: [],
};
const STEAM = {
  sources: [
    { source: "steam-workshop" as const, env: "TMOD_AUTODOWNLOAD", enabledEnv: "TMOD_ENABLEDMODS", appId: 1281930 },
  ],
  modpacks: [],
  directories: [],
};
const PACK = {
  source: "modrinth" as const, projectId: "P1", slug: "pack", name: "Pack", iconUrl: null,
  versionId: "V9", versionLabel: "1.0", gameVersion: "1.20.1", loader: "fabric",
};

describe("renderModEnv", () => {
  it("pins enabled entries and leaves disabled ones out", () => {
    const r = renderModEnv(
      MODS,
      [
        { source: "modrinth", projectId: "AA", versionId: "v1", enabled: true },
        { source: "modrinth", projectId: "BB", versionId: "v2", enabled: false },
        { source: "curseforge", projectId: "123", versionId: "456", enabled: true },
      ],
      null,
      { curseforge: null },
    );
    expect(r.env).toEqual({ MODRINTH_PROJECTS: "AA:v1", CURSEFORGE_FILES: "123:456" });
    expect(r.secretKeys).toEqual([]);
  });

  it("always emits every source var, even empty, so the image removes old mods", () => {
    const r = renderModEnv(MODS, [], null, { curseforge: null });
    expect(r.env).toEqual({ MODRINTH_PROJECTS: "", CURSEFORGE_FILES: "" });
  });

  it("downloads every Workshop item but enables only the enabled ones", () => {
    const r = renderModEnv(
      STEAM,
      [
        { source: "steam-workshop", projectId: "11", versionId: null, enabled: true },
        { source: "steam-workshop", projectId: "22", versionId: null, enabled: false },
      ],
      null,
      { curseforge: null },
    );
    expect(r.env).toEqual({ TMOD_AUTODOWNLOAD: "11,22", TMOD_ENABLEDMODS: "11" });
  });

  it("adds the modpack env and marks the CurseForge key secret", () => {
    const r = renderModEnv(MODS, [], PACK, { curseforge: "KEY" });
    expect(r.env).toMatchObject({
      TYPE: "MODRINTH",
      MODRINTH_MODPACK: "P1",
      MODRINTH_VERSION: "V9",
      VERSION: "1.20.1",
      CF_API_KEY: "KEY",
    });
    expect(r.secretKeys).toEqual(["CF_API_KEY"]);
    expect(snapshotModEnv(r)).not.toHaveProperty("CF_API_KEY");
  });

  it("renders nothing for a game without mods", () => {
    expect(renderModEnv(undefined, [], null, { curseforge: "K" })).toEqual({ env: {}, secretKeys: [] });
  });
});

describe("pending and destructive changes", () => {
  it("treats empty values like absent ones", () => {
    const r = renderModEnv(MODS, [], null, { curseforge: null });
    expect(modEnvPending(r, null)).toBe(false);
    expect(modEnvPending(r, {})).toBe(false);
  });

  it("is pending when the list changed", () => {
    const r = renderModEnv(
      MODS,
      [{ source: "modrinth", projectId: "AA", versionId: "v1", enabled: true }],
      null,
      { curseforge: null },
    );
    expect(modEnvPending(r, { MODRINTH_PROJECTS: "" })).toBe(true);
    expect(modEnvPending(r, { MODRINTH_PROJECTS: "AA:v1", CURSEFORGE_FILES: "" })).toBe(false);
  });

  it("is destructive when a project disappears or the modpack changes", () => {
    expect(isDestructiveChange({ MODRINTH_PROJECTS: "AA:v1,BB:v2" }, { MODRINTH_PROJECTS: "AA:v1" }, MODS)).toBe(true);
    expect(isDestructiveChange({ MODRINTH_PROJECTS: "AA:v1" }, { MODRINTH_PROJECTS: "AA:v2,BB:v1" }, MODS)).toBe(false);
    expect(isDestructiveChange({ MODRINTH_MODPACK: "P1" }, { MODRINTH_MODPACK: "P2" }, MODS)).toBe(true);
    expect(isDestructiveChange(null, { MODRINTH_PROJECTS: "AA:v1" }, MODS)).toBe(false);
    expect(isDestructiveChange({ TMOD_ENABLEDMODS: "11,22" }, { TMOD_ENABLEDMODS: "11" }, STEAM)).toBe(true);
  });
});

describe("compatFilter", () => {
  const spec = { mods: MODS, variables: [] as any[] };

  it("maps the loader select and resolves aliases later", () => {
    expect(compatFilter(spec, { server_type: "FABRIC", mc_version: "LATEST" }, null)).toEqual({
      loaders: ["fabric"], kind: "mod", gameVersion: null, versionAlias: "release", unsupported: null,
    });
    expect(compatFilter(spec, { server_type: "PAPER", mc_version: "1.21.4" }, null)).toMatchObject({
      loaders: ["paper", "bukkit", "spigot"], kind: "plugin", gameVersion: "1.21.4", versionAlias: null,
    });
  });

  it("explains when the current loader has no mods", () => {
    const c = compatFilter(spec, { server_type: "VANILLA", mc_version: "1.21.4" }, null);
    expect(c.unsupported).toMatch(/FABRIC, PAPER/);
  });

  it("takes loader and version from the modpack when one is set", () => {
    expect(compatFilter(spec, { server_type: "VANILLA", mc_version: "LATEST" }, PACK)).toEqual({
      loaders: ["fabric"], kind: "mod", gameVersion: "1.20.1", versionAlias: null, unsupported: null,
    });
  });

  it("has no filter for a game without loader/version (Workshop)", () => {
    expect(compatFilter({ mods: STEAM, variables: [] }, {}, null)).toEqual({
      loaders: null, kind: null, gameVersion: null, versionAlias: null, unsupported: null,
    });
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/services/game-mods-env.test.ts` → FAIL.

- [ ] **Step 3: Implement `services/game-mods-env.ts`**

```ts
import { substitute } from "./template-variables";

import type { GameModsSpecT, GameSpecT, ModSourceIdT } from "@deploykit/shared";
import type { GameModpackI } from "../db/schema/index";

/**
 * Turning a server's mod list into the env vars its image reads. Pure: no
 * database, no network — `services/game-mods.ts` gathers the inputs.
 */

interface ModEntryI {
  source: ModSourceIdT;
  projectId: string;
  versionId: string | null;
  enabled: boolean;
}

interface RenderedModEnvI {
  env: Record<string, string>;
  /** Keys of `env` holding a secret (an API key): never persisted. */
  secretKeys: string[];
}

interface CompatI {
  loaders: string[] | null;
  kind: "mod" | "plugin" | null;
  gameVersion: string | null;
  /** The version setting is an alias (LATEST) to resolve against the catalogue. */
  versionAlias: "release" | "any" | null;
  /** Why mods cannot be added with the current settings, or null. */
  unsupported: string | null;
}

const entryValue = (e: ModEntryI): string =>
  e.source === "steam-workshop" || !e.versionId ? e.projectId : `${e.projectId}:${e.versionId}`;

const renderModEnv = (
  mods: GameModsSpecT | undefined,
  entries: ModEntryI[],
  modpack: GameModpackI | null,
  keys: { curseforge: string | null },
): RenderedModEnvI => {
  const env: Record<string, string> = {};
  const secretKeys: string[] = [];
  if (!mods) return { env, secretKeys };

  for (const source of mods.sources) {
    const mine = entries.filter((e) => e.source === source.source);
    if (source.enabledEnv) {
      // Workshop: keep disabled items downloaded so re-enabling is instant.
      env[source.env] = mine.map(entryValue).join(",");
      env[source.enabledEnv] = mine.filter((e) => e.enabled).map(entryValue).join(",");
    } else {
      env[source.env] = mine.filter((e) => e.enabled).map(entryValue).join(",");
    }
    if (source.apiKeyEnv && keys.curseforge) {
      env[source.apiKeyEnv] = keys.curseforge;
      secretKeys.push(source.apiKeyEnv);
    }
  }

  const pack = modpack && mods.modpacks.find((p) => p.source === modpack.source);
  if (pack && modpack) {
    const values = {
      dk_modpack_project: modpack.projectId,
      dk_modpack_slug: modpack.slug ?? modpack.projectId,
      dk_modpack_version: modpack.versionId,
      dk_modpack_game_version: modpack.gameVersion ?? "",
      dk_modpack_loader: modpack.loader ?? "",
    };
    for (const [key, value] of Object.entries(pack.env)) env[key] = substitute(value, values);
  }

  return { env, secretKeys };
};

const snapshotModEnv = (r: RenderedModEnvI): Record<string, string> =>
  Object.fromEntries(Object.entries(r.env).filter(([k]) => !r.secretKeys.includes(k)));

const nonEmpty = (env: Record<string, string>) =>
  JSON.stringify(
    Object.entries(env)
      .filter(([, v]) => v !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const modEnvPending = (r: RenderedModEnvI, applied: Record<string, string> | null): boolean =>
  nonEmpty(snapshotModEnv(r)) !== nonEmpty(applied ?? {});

const projectsOf = (value: string | undefined) =>
  new Set((value ?? "").split(",").filter(Boolean).map((v) => v.split(":")[0]!));

/**
 * Whether applying `next` over `applied` takes something away — a mod
 * removed or disabled, or a different modpack. Worlds can depend on mod
 * content, so such a change always gets a safety backup first.
 */
const isDestructiveChange = (
  applied: Record<string, string> | null,
  next: Record<string, string>,
  mods: GameModsSpecT | undefined,
): boolean => {
  if (!applied || !mods) return false;
  const listVars = mods.sources.flatMap((s) => [s.env, ...(s.enabledEnv ? [s.enabledEnv] : [])]);
  for (const name of listVars) {
    const after = projectsOf(next[name]);
    for (const project of projectsOf(applied[name])) if (!after.has(project)) return true;
  }
  const packVars = new Set(mods.modpacks.flatMap((p) => Object.keys(p.env)));
  for (const name of packVars) {
    if ((applied[name] ?? "") !== (next[name] ?? "") && (applied[name] ?? "") !== "") return true;
  }
  return false;
};

const compatFilter = (
  spec: Pick<GameSpecT, "mods" | "variables">,
  values: Record<string, string>,
  modpack: GameModpackI | null,
): CompatI => {
  const mods = spec.mods;
  const none: CompatI = { loaders: null, kind: null, gameVersion: null, versionAlias: null, unsupported: null };
  if (!mods) return { ...none, unsupported: "This game does not support mods" };

  if (modpack) {
    return {
      loaders: modpack.loader ? [modpack.loader] : null,
      kind: "mod",
      gameVersion: modpack.gameVersion,
      versionAlias: null,
      unsupported: null,
    };
  }

  const result = { ...none };
  if (mods.loader) {
    const current = values[mods.loader.from] ?? "";
    const mapped = mods.loader.map[current];
    if (!mapped) {
      const label = spec.variables.find((v) => v.key === mods.loader!.from)?.label ?? mods.loader.from;
      return {
        ...none,
        unsupported: `Mods need a different ${label}: switch it to one of ${Object.keys(mods.loader.map).join(", ")} in Settings`,
      };
    }
    result.loaders = mapped.loaders;
    result.kind = mapped.kind;
  }
  if (mods.gameVersion) {
    const raw = values[mods.gameVersion.from] ?? "";
    const alias = mods.gameVersion.aliases[raw];
    if (alias) result.versionAlias = alias;
    else if (raw) result.gameVersion = raw;
  }
  return result;
};

export {
  renderModEnv,
  snapshotModEnv,
  modEnvPending,
  isDestructiveChange,
  compatFilter,
  type ModEntryI,
  type RenderedModEnvI,
  type CompatI,
};
```

Check that `substitute` from `./template-variables` replaces `${name}` with values and does not throw on unknown names that are all present; if it throws for missing keys, every key used is present here so it is fine.

- [ ] **Step 4: Run** → PASS. **Step 5: Checkpoint** (tsc clean). No commit.

---

### Task 5: HTTP helper + Modrinth adapter

**Files:**
- Create: `apps/api/src/services/mod-sources/types.ts`, `http.ts`, `modrinth.ts`
- Test: `apps/api/src/services/mod-sources/modrinth.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
import type { ModKindT, ModSourceIdT } from "@deploykit/shared";

interface ModFilterI {
  loaders: string[] | null;
  kind: ModKindT;
  /** Concrete version only; aliases are resolved before reaching an adapter. */
  gameVersion: string | null;
}

interface ModSummaryI {
  source: ModSourceIdT;
  projectId: string;
  slug: string | null;
  name: string;
  summary: string;
  iconUrl: string | null;
  author: string | null;
  downloads: number;
  url: string;
  kind: ModKindT;
  /** False when DeployKit cannot install it (client-only, no distribution, wrong app). */
  installable: boolean;
  reason?: string;
}

interface ModSearchResultI {
  hits: ModSummaryI[];
  total: number;
  offset: number;
  limit: number;
}

interface ModVersionI {
  id: string;
  label: string;
  gameVersions: string[];
  loaders: string[];
  publishedAt: string;
  type: "release" | "beta" | "alpha";
}

interface ModSourceContextI {
  apiKey: string | null;
  appId?: number;
}

interface ModSourceAdapterI {
  id: ModSourceIdT;
  /** Whether search / install work with this context, and why not. */
  capabilities(ctx: ModSourceContextI): { search: boolean; install: boolean; reason?: string };
  search(query: string, filter: ModFilterI, offset: number, ctx: ModSourceContextI): Promise<ModSearchResultI>;
  project(ref: string, ctx: ModSourceContextI): Promise<ModSummaryI>;
  versions(projectId: string, filter: ModFilterI | null, ctx: ModSourceContextI): Promise<ModVersionI[]>;
  /** Pull a project id/slug out of a URL or bare id; null when it is not this source's. */
  parseRef(input: string): string | null;
  /** Throws ModSourceError("UNAUTHORIZED") when the provider rejects the key. */
  validateKey?(key: string): Promise<void>;
}
```

- `ModSourceError` (in `http.ts`): `class ModSourceError extends Error { code: "NOT_FOUND" | "UNAUTHORIZED" | "UNAVAILABLE" | "BAD_REQUEST" }`
- `fetchJson<T>(url: string, init: { method?: "GET"|"POST"; headers?: Record<string,string>; body?: string; cacheSec?: number; what: string }): Promise<T>`
- `MODRINTH_USER_AGENT`
- `modrinth: ModSourceAdapterI`, `resolveVersionAlias(alias: "release" | "any"): Promise<string | null>` (from `modrinth.ts`)

- [ ] **Step 1: Failing test** `mod-sources/modrinth.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const redisMock = { get: vi.fn(async () => null), set: vi.fn(async () => "OK") };
vi.mock("../../lib/redis", () => ({ redis: redisMock }));

const { modrinth, resolveVersionAlias } = await import("./modrinth");
const { ModSourceError } = await import("./http");

const ctx = { apiKey: null };
let calls: string[] = [];

const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push(url);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("modrinth.parseRef", () => {
  it("accepts slugs, ids and modrinth URLs only", () => {
    expect(modrinth.parseRef("lithium")).toBe("lithium");
    expect(modrinth.parseRef("https://modrinth.com/mod/lithium")).toBe("lithium");
    expect(modrinth.parseRef("https://modrinth.com/modpack/adrenaserver/version/1.2")).toBe("adrenaserver");
    expect(modrinth.parseRef("https://evil.example/mod/lithium")).toBeNull();
    expect(modrinth.parseRef("https://www.curseforge.com/minecraft/mc-mods/jei")).toBeNull();
    expect(modrinth.parseRef("../etc")).toBeNull();
  });
});

describe("modrinth.search", () => {
  it("filters by loader, version, kind and server side", async () => {
    mockFetch({
      "/v2/search": {
        hits: [
          {
            project_id: "gvQqBUqZ", slug: "lithium", title: "Lithium", description: "Fast",
            icon_url: "https://cdn/x.png", author: "jelly", downloads: 10, project_type: "mod",
            server_side: "optional",
          },
        ],
        offset: 0, limit: 20, total_hits: 1,
      },
    });
    const r = await modrinth.search("lith", { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" }, 0, ctx);
    const url = new URL(calls[0]!);
    const facets = JSON.parse(url.searchParams.get("facets")!);
    expect(facets).toContainEqual(["categories:fabric"]);
    expect(facets).toContainEqual(["versions:1.21.4"]);
    expect(facets).toContainEqual(["project_type:mod"]);
    expect(facets).toContainEqual(["server_side:required", "server_side:optional"]);
    expect(r.hits[0]).toMatchObject({ projectId: "gvQqBUqZ", name: "Lithium", installable: true });
    expect(r.total).toBe(1);
  });

  it("searches plugins as mod-or-plugin project types", async () => {
    mockFetch({ "/v2/search": { hits: [], offset: 0, limit: 20, total_hits: 0 } });
    await modrinth.search("", { loaders: ["paper", "bukkit"], kind: "plugin", gameVersion: null }, 0, ctx);
    const facets = JSON.parse(new URL(calls[0]!).searchParams.get("facets")!);
    expect(facets).toContainEqual(["categories:paper", "categories:bukkit"]);
    expect(facets).toContainEqual(["project_type:mod", "project_type:plugin"]);
  });
});

describe("modrinth.project / versions", () => {
  it("marks client-only projects not installable", async () => {
    mockFetch({
      "/v2/project/sodium": {
        id: "AANobbMI", slug: "sodium", title: "Sodium", description: "x", icon_url: null,
        downloads: 1, project_type: "mod", server_side: "unsupported",
      },
    });
    const p = await modrinth.project("sodium", ctx);
    expect(p.installable).toBe(false);
    expect(p.reason).toMatch(/client/i);
  });

  it("maps versions newest first", async () => {
    mockFetch({
      "/version": [
        { id: "v2", version_number: "2.0", game_versions: ["1.21.4"], loaders: ["fabric"], date_published: "2026-02-01", version_type: "release" },
      ],
    });
    const v = await modrinth.versions("AA", { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" }, ctx);
    expect(v[0]).toEqual({ id: "v2", label: "2.0", gameVersions: ["1.21.4"], loaders: ["fabric"], publishedAt: "2026-02-01", type: "release" });
    const url = new URL(calls[0]!);
    expect(JSON.parse(url.searchParams.get("loaders")!)).toEqual(["fabric"]);
    expect(JSON.parse(url.searchParams.get("game_versions")!)).toEqual(["1.21.4"]);
  });

  it("turns a 404 into NOT_FOUND", async () => {
    mockFetch({});
    await expect(modrinth.project("missing", ctx)).rejects.toBeInstanceOf(ModSourceError);
  });
});

describe("resolveVersionAlias", () => {
  it("picks the newest release, or the newest of any type", async () => {
    mockFetch({
      "/v2/tag/game_version": [
        { version: "26w10a", version_type: "snapshot" },
        { version: "1.21.4", version_type: "release" },
      ],
    });
    expect(await resolveVersionAlias("release")).toBe("1.21.4");
    expect(await resolveVersionAlias("any")).toBe("26w10a");
  });
});
```

- [ ] **Step 2: Run** `pnpm --filter api exec vitest run src/services/mod-sources/modrinth.test.ts` → FAIL.

- [ ] **Step 3: `mod-sources/http.ts`**

```ts
import { createHash } from "crypto";

import { redis } from "../../lib/redis";

/**
 * HTTP for mod catalogues. Only fixed provider hosts are ever requested —
 * callers build URLs from constants and parsed ids, never from user input.
 */

type ModSourceErrorCodeT = "NOT_FOUND" | "UNAUTHORIZED" | "UNAVAILABLE" | "BAD_REQUEST";

class ModSourceError extends Error {
  constructor(
    public code: ModSourceErrorCodeT,
    message: string,
  ) {
    super(message);
    this.name = "ModSourceError";
  }
}

const TIMEOUT_MS = 10_000;

const fetchJson = async <T>(
  url: string,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    /** Cache the parsed response in Redis for this long. */
    cacheSec?: number;
    /** "Modrinth" — used in error messages. */
    what: string;
  },
): Promise<T> => {
  const cacheKey = init.cacheSec
    ? `modsrc:${createHash("sha1").update(`${init.method ?? "GET"} ${url} ${init.body ?? ""}`).digest("hex")}`
    : null;
  if (cacheKey) {
    const hit = await redis.get(cacheKey).catch(() => null);
    if (hit) return JSON.parse(hit) as T;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { accept: "application/json", ...init.headers },
      body: init.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ModSourceError("UNAVAILABLE", `${init.what} did not answer. Try again later.`);
  }
  if (res.status === 404) throw new ModSourceError("NOT_FOUND", `Not found on ${init.what}`);
  if (res.status === 401 || res.status === 403) {
    throw new ModSourceError("UNAUTHORIZED", `${init.what} rejected the API key`);
  }
  if (!res.ok) throw new ModSourceError("UNAVAILABLE", `${init.what} answered ${res.status}`);

  const data = (await res.json()) as T;
  if (cacheKey) await redis.set(cacheKey, JSON.stringify(data), "EX", init.cacheSec!).catch(() => {});
  return data;
};

export { fetchJson, ModSourceError, type ModSourceErrorCodeT };
```

(Check `lib/redis.ts`'s `redis` is ioredis: `set(key, value, "EX", sec)` is the ioredis form. The test mocks it.)

- [ ] **Step 4: `mod-sources/types.ts`** — the interfaces block above, exported with `export type { ... }`.

- [ ] **Step 5: `mod-sources/modrinth.ts`**

```ts
import { fetchJson, ModSourceError } from "./http";

import type { ModFilterI, ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";
import type { ModKindT } from "@deploykit/shared";

const API = "https://api.modrinth.com/v2";
const MODRINTH_USER_AGENT = `deploykit/${process.env.npm_package_version ?? "dev"} (github.com/deploykithq/deploykit)`;
const headers = { "user-agent": MODRINTH_USER_AGENT };
const PAGE = 20;
const ID_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const URL_REGEX = /^https:\/\/(?:www\.)?modrinth\.com\/(?:mod|plugin|modpack|datapack)\/([A-Za-z0-9_.-]{1,64})(?:\/.*)?$/;

const toKind = (projectType: string): ModKindT =>
  projectType === "modpack" ? "modpack" : projectType === "plugin" ? "plugin" : "mod";

const summary = (p: any, kindHint?: ModKindT): ModSummaryI => {
  const kind = kindHint ?? toKind(p.project_type);
  const clientOnly = p.server_side === "unsupported";
  return {
    source: "modrinth",
    projectId: p.project_id ?? p.id,
    slug: p.slug ?? null,
    name: p.title,
    summary: p.description ?? "",
    iconUrl: p.icon_url || null,
    author: p.author ?? null,
    downloads: p.downloads ?? 0,
    url: `https://modrinth.com/${p.project_type === "modpack" ? "modpack" : "mod"}/${p.slug ?? p.id}`,
    kind,
    installable: kind === "modpack" || !clientOnly,
    ...(clientOnly && kind !== "modpack" ? { reason: "Client-side only: it does nothing on a server" } : {}),
  };
};

const facetsFor = (filter: ModFilterI): string[][] => {
  const facets: string[][] = [];
  if (filter.kind === "modpack") facets.push(["project_type:modpack"]);
  else if (filter.kind === "plugin") facets.push(["project_type:mod", "project_type:plugin"]);
  else facets.push(["project_type:mod"]);
  if (filter.loaders?.length) facets.push(filter.loaders.map((l) => `categories:${l}`));
  if (filter.gameVersion) facets.push([`versions:${filter.gameVersion}`]);
  if (filter.kind !== "modpack") facets.push(["server_side:required", "server_side:optional"]);
  return facets;
};

const modrinth: ModSourceAdapterI = {
  id: "modrinth",

  capabilities: () => ({ search: true, install: true }),

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    if (fromUrl) return fromUrl[1]!;
    if (/^https?:/i.test(trimmed)) return null;
    return ID_REGEX.test(trimmed) && !trimmed.startsWith(".") ? trimmed : null;
  },

  async search(query, filter, offset) {
    const params = new URLSearchParams({
      query,
      limit: String(PAGE),
      offset: String(offset),
      index: query ? "relevance" : "downloads",
      facets: JSON.stringify(facetsFor(filter)),
    });
    const data = await fetchJson<any>(`${API}/search?${params}`, { headers, cacheSec: 300, what: "Modrinth" });
    return {
      hits: (data.hits ?? []).map((h: any) => summary(h, filter.kind === "plugin" ? "plugin" : undefined)),
      total: data.total_hits ?? 0,
      offset: data.offset ?? offset,
      limit: data.limit ?? PAGE,
    };
  },

  async project(ref) {
    if (!ID_REGEX.test(ref)) throw new ModSourceError("BAD_REQUEST", "Not a Modrinth project");
    const p = await fetchJson<any>(`${API}/project/${encodeURIComponent(ref)}`, { headers, cacheSec: 300, what: "Modrinth" });
    return summary(p);
  },

  async versions(projectId, filter) {
    if (!ID_REGEX.test(projectId)) throw new ModSourceError("BAD_REQUEST", "Not a Modrinth project");
    const params = new URLSearchParams();
    if (filter?.loaders?.length) params.set("loaders", JSON.stringify(filter.loaders));
    if (filter?.gameVersion) params.set("game_versions", JSON.stringify([filter.gameVersion]));
    const list = await fetchJson<any[]>(
      `${API}/project/${encodeURIComponent(projectId)}/version${params.size ? `?${params}` : ""}`,
      { headers, cacheSec: 300, what: "Modrinth" },
    );
    return list.map(
      (v): ModVersionI => ({
        id: v.id,
        label: v.version_number,
        gameVersions: v.game_versions ?? [],
        loaders: v.loaders ?? [],
        publishedAt: v.date_published,
        type: v.version_type ?? "release",
      }),
    );
  },
};

/** "LATEST" → the newest release Minecraft version Modrinth knows. */
const resolveVersionAlias = async (alias: "release" | "any"): Promise<string | null> => {
  const tags = await fetchJson<Array<{ version: string; version_type: string }>>(
    `${API}/tag/game_version`,
    { headers, cacheSec: 3600, what: "Modrinth" },
  );
  const hit = alias === "release" ? tags.find((t) => t.version_type === "release") : tags[0];
  return hit?.version ?? null;
};

export { modrinth, resolveVersionAlias, MODRINTH_USER_AGENT };
```

- [ ] **Step 6: Run** → PASS. **Step 7: Checkpoint** (tsc clean). No commit.

---

### Task 6: CurseForge adapter

**Files:**
- Create: `apps/api/src/services/mod-sources/curseforge.ts`
- Test: `apps/api/src/services/mod-sources/curseforge.test.ts`

**Interfaces:**
- Consumes: `fetchJson`, `ModSourceError`, types (Task 5).
- Produces: `curseforge: ModSourceAdapterI` with `validateKey`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => "OK") } }));

const { curseforge } = await import("./curseforge");

const ctx = { apiKey: "KEY" };
let calls: Array<{ url: string; headers: Record<string, string> }> = [];

const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, headers: init?.headers ?? {} });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

const MOD = {
  id: 238222, slug: "jei", name: "JEI", summary: "Items", logo: { thumbnailUrl: "https://t/x.png" },
  authors: [{ name: "mezz" }], downloadCount: 5, links: { websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/jei" },
  allowModDistribution: true, classId: 6,
};

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("curseforge", () => {
  it("needs a key for everything", () => {
    expect(curseforge.capabilities({ apiKey: null })).toMatchObject({ search: false, install: false });
    expect(curseforge.capabilities(ctx)).toMatchObject({ search: true, install: true });
  });

  it("parses CurseForge URLs and ids only", () => {
    expect(curseforge.parseRef("https://www.curseforge.com/minecraft/mc-mods/jei")).toBe("jei");
    expect(curseforge.parseRef("https://www.curseforge.com/minecraft/modpacks/all-the-mods-10")).toBe("all-the-mods-10");
    expect(curseforge.parseRef("238222")).toBe("238222");
    expect(curseforge.parseRef("https://modrinth.com/mod/jei")).toBeNull();
  });

  it("searches with class, loader type and version, sending the key", async () => {
    mockFetch({ "/v1/mods/search": { data: [MOD], pagination: { index: 0, pageSize: 20, resultCount: 1, totalCount: 1 } } });
    const r = await curseforge.search("jei", { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" }, 0, ctx);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("gameId")).toBe("432");
    expect(url.searchParams.get("classId")).toBe("6");
    expect(url.searchParams.get("modLoaderType")).toBe("4");
    expect(url.searchParams.get("gameVersion")).toBe("1.21.4");
    expect(calls[0]!.headers["x-api-key"]).toBe("KEY");
    expect(r.hits[0]).toMatchObject({ projectId: "238222", slug: "jei", installable: true });
  });

  it("uses the plugin and modpack classes", async () => {
    mockFetch({ "/v1/mods/search": { data: [], pagination: { index: 0, pageSize: 20, totalCount: 0 } } });
    await curseforge.search("", { loaders: ["paper"], kind: "plugin", gameVersion: null }, 0, ctx);
    await curseforge.search("", { loaders: null, kind: "modpack", gameVersion: null }, 0, ctx);
    expect(new URL(calls[0]!.url).searchParams.get("classId")).toBe("5");
    expect(new URL(calls[0]!.url).searchParams.get("modLoaderType")).toBeNull();
    expect(new URL(calls[1]!.url).searchParams.get("classId")).toBe("4471");
  });

  it("refuses projects that forbid third-party distribution", async () => {
    mockFetch({ "/v1/mods/238222": { data: { ...MOD, allowModDistribution: false } } });
    const p = await curseforge.project("238222", ctx);
    expect(p.installable).toBe(false);
    expect(p.reason).toMatch(/distribution/i);
  });

  it("resolves a slug through search", async () => {
    mockFetch({ "/v1/mods/search": { data: [MOD], pagination: { index: 0, pageSize: 1, totalCount: 1 } } });
    const p = await curseforge.project("jei", ctx);
    expect(new URL(calls[0]!.url).searchParams.get("slug")).toBe("jei");
    expect(p.projectId).toBe("238222");
  });

  it("maps files to versions with loaders and game versions split", async () => {
    mockFetch({
      "/v1/mods/238222/files": {
        data: [{ id: 456, displayName: "jei-1.21.4-fabric-19.0", gameVersions: ["1.21.4", "Fabric"], fileDate: "2026-01-01", releaseType: 2 }],
      },
    });
    const v = await curseforge.versions("238222", { loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4" }, ctx);
    expect(v[0]).toEqual({ id: "456", label: "jei-1.21.4-fabric-19.0", gameVersions: ["1.21.4"], loaders: ["fabric"], publishedAt: "2026-01-01", type: "beta" });
  });

  it("validates a key against the API", async () => {
    mockFetch({ "/v1/games/432": { data: { id: 432 } } });
    await expect(curseforge.validateKey!("KEY")).resolves.toBeUndefined();
    mockFetch({ "/v1/games/432": {} }, 403);
    await expect(curseforge.validateKey!("BAD")).rejects.toThrow(/rejected/);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `mod-sources/curseforge.ts`**

```ts
import { fetchJson, ModSourceError } from "./http";

import type { ModFilterI, ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";
import type { ModKindT } from "@deploykit/shared";

const API = "https://api.curseforge.com/v1";
const MINECRAFT = 432;
const CLASS: Record<ModKindT, number> = { mod: 6, plugin: 5, modpack: 4471 };
const LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const KNOWN_LOADERS = new Set(["forge", "fabric", "quilt", "neoforge"]);
const PAGE = 20;
const URL_REGEX = /^https:\/\/(?:www\.)?curseforge\.com\/minecraft\/(?:mc-mods|modpacks|bukkit-plugins)\/([a-z0-9-]{1,100})(?:\/.*)?$/;
const SLUG_REGEX = /^[a-z0-9-]{1,100}$/;

const keyHeaders = (apiKey: string | null) => {
  if (!apiKey) throw new ModSourceError("BAD_REQUEST", "CurseForge needs an API key: an admin can add one in Settings");
  return { "x-api-key": apiKey };
};

const kindOf = (classId: number): ModKindT =>
  classId === CLASS.modpack ? "modpack" : classId === CLASS.plugin ? "plugin" : "mod";

const summary = (m: any): ModSummaryI => {
  const blocked = m.allowModDistribution === false;
  return {
    source: "curseforge",
    projectId: String(m.id),
    slug: m.slug ?? null,
    name: m.name,
    summary: m.summary ?? "",
    iconUrl: m.logo?.thumbnailUrl ?? null,
    author: m.authors?.[0]?.name ?? null,
    downloads: m.downloadCount ?? 0,
    url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
    kind: kindOf(m.classId),
    installable: !blocked,
    ...(blocked ? { reason: "Its author forbids third-party distribution, so the server cannot download it" } : {}),
  };
};

const RELEASE_TYPE: Record<number, ModVersionI["type"]> = { 1: "release", 2: "beta", 3: "alpha" };

const curseforge: ModSourceAdapterI = {
  id: "curseforge",

  capabilities: (ctx) =>
    ctx.apiKey
      ? { search: true, install: true }
      : { search: false, install: false, reason: "An admin must add a CurseForge API key in Settings" },

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    if (fromUrl) return fromUrl[1]!;
    if (/^https?:/i.test(trimmed)) return null;
    return /^\d{1,10}$/.test(trimmed) || SLUG_REGEX.test(trimmed) ? trimmed : null;
  },

  async search(query, filter, offset, ctx) {
    const params = new URLSearchParams({
      gameId: String(MINECRAFT),
      classId: String(CLASS[filter.kind]),
      searchFilter: query,
      sortField: "2",
      sortOrder: "desc",
      index: String(offset),
      pageSize: String(PAGE),
    });
    if (filter.gameVersion) params.set("gameVersion", filter.gameVersion);
    const loaderType = filter.kind === "mod" ? filter.loaders?.map((l) => LOADER_TYPE[l]).find(Boolean) : undefined;
    if (loaderType) params.set("modLoaderType", String(loaderType));
    const data = await fetchJson<any>(`${API}/mods/search?${params}`, {
      headers: keyHeaders(ctx.apiKey),
      cacheSec: 300,
      what: "CurseForge",
    });
    return {
      hits: (data.data ?? []).map(summary),
      total: Math.min(data.pagination?.totalCount ?? 0, 10_000),
      offset,
      limit: PAGE,
    };
  },

  async project(ref, ctx) {
    const headers = keyHeaders(ctx.apiKey);
    if (/^\d{1,10}$/.test(ref)) {
      const data = await fetchJson<any>(`${API}/mods/${ref}`, { headers, cacheSec: 300, what: "CurseForge" });
      return summary(data.data);
    }
    if (!SLUG_REGEX.test(ref)) throw new ModSourceError("BAD_REQUEST", "Not a CurseForge project");
    const params = new URLSearchParams({ gameId: String(MINECRAFT), slug: ref, pageSize: "1" });
    const data = await fetchJson<any>(`${API}/mods/search?${params}`, { headers, cacheSec: 300, what: "CurseForge" });
    const hit = data.data?.[0];
    if (!hit) throw new ModSourceError("NOT_FOUND", "Not found on CurseForge");
    return summary(hit);
  },

  async versions(projectId, filter, ctx) {
    if (!/^\d{1,10}$/.test(projectId)) throw new ModSourceError("BAD_REQUEST", "Not a CurseForge project");
    const params = new URLSearchParams({ pageSize: "50" });
    if (filter?.gameVersion) params.set("gameVersion", filter.gameVersion);
    const loaderType = filter?.kind === "mod" ? filter.loaders?.map((l) => LOADER_TYPE[l]).find(Boolean) : undefined;
    if (loaderType) params.set("modLoaderType", String(loaderType));
    const data = await fetchJson<any>(`${API}/mods/${projectId}/files?${params}`, {
      headers: keyHeaders(ctx.apiKey),
      cacheSec: 300,
      what: "CurseForge",
    });
    return (data.data ?? [])
      .map(
        (f: any): ModVersionI => ({
          id: String(f.id),
          label: f.displayName ?? f.fileName,
          gameVersions: (f.gameVersions ?? []).filter((g: string) => /^\d+\.\d+/.test(g)),
          loaders: (f.gameVersions ?? []).map((g: string) => g.toLowerCase()).filter((g: string) => KNOWN_LOADERS.has(g)),
          publishedAt: f.fileDate,
          type: RELEASE_TYPE[f.releaseType] ?? "release",
        }),
      )
      .sort((a: ModVersionI, b: ModVersionI) => b.publishedAt.localeCompare(a.publishedAt));
  },

  async validateKey(key) {
    await fetchJson(`${API}/games/${MINECRAFT}`, { headers: { "x-api-key": key }, what: "CurseForge" });
  },
};

export { curseforge };
```

- [ ] **Step 4: Run** → PASS. **Step 5: Checkpoint.** No commit.

---

### Task 7: Steam Workshop adapter + adapter registry + key validation

**Files:**
- Create: `apps/api/src/services/mod-sources/steam.ts`, `apps/api/src/services/mod-sources/index.ts`
- Test: `apps/api/src/services/mod-sources/steam.test.ts`
- Modify: `apps/api/src/routers/settings.ts` (call `validateModKey`)

**Interfaces:**
- Produces:
  - `steamWorkshop: ModSourceAdapterI` (`capabilities` → search needs key, install never does)
  - `adapterFor(id: ModSourceIdT): ModSourceAdapterI`
  - `contextFor(source: GameModSourceT): Promise<ModSourceContextI>` (reads keys via `getSetting`)
  - `validateModKey(key: GameModKeyT, value: string): Promise<void>`
  - re-exports `ModSourceError`, `resolveVersionAlias`, types.

- [ ] **Step 1: Failing test** `mod-sources/steam.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn(async () => "OK") } }));

const { steamWorkshop } = await import("./steam");

let calls: Array<{ url: string; body?: string }> = [];
const mockFetch = (routes: Record<string, unknown>, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: any) => {
      calls.push({ url, body: init?.body });
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("", { status: 404 });
      return new Response(JSON.stringify(routes[key]), { status });
    }),
  );

const DETAILS = (overrides: Record<string, unknown> = {}) => ({
  response: {
    publishedfiledetails: [
      {
        result: 1, publishedfileid: "2824688072", title: "Boss Checklist", description: "x",
        preview_url: "https://img/p.png", consumer_app_id: 1281930, time_updated: 1767225600,
        subscriptions: 900, ...overrides,
      },
    ],
  },
});

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
});

describe("steamWorkshop", () => {
  it("installs without a key but only searches with one", () => {
    expect(steamWorkshop.capabilities({ apiKey: null, appId: 1281930 })).toMatchObject({ search: false, install: true });
    expect(steamWorkshop.capabilities({ apiKey: "K", appId: 1281930 })).toMatchObject({ search: true, install: true });
  });

  it("parses Workshop URLs and numeric ids only", () => {
    expect(steamWorkshop.parseRef("https://steamcommunity.com/sharedfiles/filedetails/?id=2824688072")).toBe("2824688072");
    expect(steamWorkshop.parseRef("https://steamcommunity.com/workshop/filedetails/?id=2824688072&searchtext=")).toBe("2824688072");
    expect(steamWorkshop.parseRef("2824688072")).toBe("2824688072");
    expect(steamWorkshop.parseRef("boss-checklist")).toBeNull();
    expect(steamWorkshop.parseRef("https://evil.example/?id=1")).toBeNull();
  });

  it("looks a project up without a key and checks the app", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS() });
    const p = await steamWorkshop.project("2824688072", { apiKey: null, appId: 1281930 });
    expect(calls[0]!.body).toContain("publishedfileids%5B0%5D=2824688072");
    expect(p).toMatchObject({ projectId: "2824688072", name: "Boss Checklist", installable: true });
  });

  it("refuses an item from another game", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS({ consumer_app_id: 105600 }) });
    await expect(steamWorkshop.project("2824688072", { apiKey: null, appId: 1281930 })).rejects.toThrow(/not a .*1281930|another game/i);
  });

  it("returns one unpinnable version labelled with the update date", async () => {
    mockFetch({ GetPublishedFileDetails: DETAILS() });
    const v = await steamWorkshop.versions("2824688072", null, { apiKey: null, appId: 1281930 });
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ id: "1767225600", type: "release" });
    expect(v[0]!.label).toMatch(/2026/);
  });

  it("searches through QueryFiles with the key", async () => {
    mockFetch({
      QueryFiles: {
        response: {
          total: 1,
          publishedfiledetails: [DETAILS().response.publishedfiledetails[0]],
        },
      },
    });
    const r = await steamWorkshop.search("boss", { loaders: null, kind: "mod", gameVersion: null }, 20, { apiKey: "K", appId: 1281930 });
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("appid")).toBe("1281930");
    expect(url.searchParams.get("search_text")).toBe("boss");
    expect(url.searchParams.get("page")).toBe("2");
    expect(r.hits[0]!.name).toBe("Boss Checklist");
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `mod-sources/steam.ts`**

```ts
import { fetchJson, ModSourceError } from "./http";

import type { ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";

const API = "https://api.steampowered.com";
const PAGE = 20;
const URL_REGEX = /^https:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?(?:.*&)?id=(\d{1,20})(?:&.*)?$/;

const summary = (d: any): ModSummaryI => ({
  source: "steam-workshop",
  projectId: String(d.publishedfileid),
  slug: null,
  name: d.title,
  summary: (d.description ?? d.file_description ?? "").slice(0, 300),
  iconUrl: d.preview_url || null,
  author: null,
  downloads: d.subscriptions ?? 0,
  url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
  kind: "mod",
  installable: true,
});

const details = async (id: string, appId: number | undefined) => {
  if (!/^\d{1,20}$/.test(id)) throw new ModSourceError("BAD_REQUEST", "Not a Workshop item id");
  const body = new URLSearchParams({ itemcount: "1", "publishedfileids[0]": id }).toString();
  const data = await fetchJson<any>(`${API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cacheSec: 300,
    what: "the Steam Workshop",
  });
  const item = data.response?.publishedfiledetails?.[0];
  if (!item || item.result !== 1) throw new ModSourceError("NOT_FOUND", "Workshop item not found (or not public)");
  const app = item.consumer_app_id ?? item.creator_app_id;
  if (appId !== undefined && app !== appId) {
    throw new ModSourceError("BAD_REQUEST", `That Workshop item belongs to another game, not app ${appId}`);
  }
  return item;
};

const steamWorkshop: ModSourceAdapterI = {
  id: "steam-workshop",

  capabilities: (ctx) =>
    ctx.apiKey
      ? { search: true, install: true }
      : { search: false, install: true, reason: "Searching needs a Steam Web API key (Settings). You can still paste a Workshop link." },

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    if (fromUrl) return fromUrl[1]!;
    return /^\d{1,20}$/.test(trimmed) ? trimmed : null;
  },

  async search(query, _filter, offset, ctx) {
    if (!ctx.apiKey) throw new ModSourceError("BAD_REQUEST", "Searching the Workshop needs a Steam Web API key");
    const params = new URLSearchParams({
      key: ctx.apiKey,
      appid: String(ctx.appId),
      search_text: query,
      query_type: query ? "12" : "3",
      numperpage: String(PAGE),
      page: String(Math.floor(offset / PAGE) + 1),
      return_metadata: "true",
      return_previews: "true",
    });
    const data = await fetchJson<any>(`${API}/IPublishedFileService/QueryFiles/v1/?${params}`, {
      cacheSec: 300,
      what: "the Steam Workshop",
    });
    return {
      hits: (data.response?.publishedfiledetails ?? []).map(summary),
      total: data.response?.total ?? 0,
      offset,
      limit: PAGE,
    };
  },

  async project(ref, ctx) {
    return summary(await details(ref, ctx.appId));
  },

  async versions(projectId, _filter, ctx) {
    const item = await details(projectId, ctx.appId);
    const updated = new Date((item.time_updated ?? 0) * 1000);
    return [
      {
        id: String(item.time_updated ?? 0),
        label: `Updated ${updated.toISOString().slice(0, 10)}`,
        gameVersions: [],
        loaders: [],
        publishedAt: updated.toISOString(),
        type: "release",
      } satisfies ModVersionI,
    ];
  },

  async validateKey(key) {
    const params = new URLSearchParams({ key, appid: "1281930", numperpage: "1", query_type: "3" });
    await fetchJson(`${API}/IPublishedFileService/QueryFiles/v1/?${params}`, { what: "Steam" });
  },
};

export { steamWorkshop };
```

Note: the Steam key travels in the query string; `fetchJson` only hashes the URL into the cache key and never logs it — keep it that way.

- [ ] **Step 4: `mod-sources/index.ts`**

```ts
import { getSetting } from "../instance-settings";

import { curseforge } from "./curseforge";
import { modrinth } from "./modrinth";
import { steamWorkshop } from "./steam";
import { ModSourceError } from "./http";

import type { GameModKeyT, GameModSourceT, ModSourceIdT } from "@deploykit/shared";
import type { ModSourceAdapterI, ModSourceContextI } from "./types";

const ADAPTERS: Record<ModSourceIdT, ModSourceAdapterI> = {
  modrinth,
  curseforge,
  "steam-workshop": steamWorkshop,
};

const KEY_FOR: Partial<Record<ModSourceIdT, GameModKeyT>> = {
  curseforge: "curseforge_api_key",
  "steam-workshop": "steam_web_api_key",
};

const adapterFor = (id: ModSourceIdT): ModSourceAdapterI => ADAPTERS[id];

const contextFor = async (source: GameModSourceT): Promise<ModSourceContextI> => {
  const keyName = KEY_FOR[source.source];
  return {
    apiKey: keyName ? await getSetting(keyName) : null,
    ...(source.appId !== undefined ? { appId: source.appId } : {}),
  };
};

/** Ask the provider whether a key works before storing it. */
const validateModKey = async (key: GameModKeyT, value: string): Promise<void> => {
  const adapter = key === "curseforge_api_key" ? curseforge : steamWorkshop;
  await adapter.validateKey!(value);
};

export { adapterFor, contextFor, validateModKey, ModSourceError };
export { resolveVersionAlias } from "./modrinth";
export type * from "./types";
```

- [ ] **Step 5: Validate keys on save** — in `routers/settings.ts`, before `setSetting`:

```ts
import { TRPCError } from "@trpc/server";
import { validateModKey, ModSourceError } from "../services/mod-sources/index";
...
      if (input.value !== null) {
        try {
          await validateModKey(input.key, input.value);
        } catch (err) {
          if (err instanceof ModSourceError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: err.code === "UNAUTHORIZED" ? `The provider rejected this key` : err.message,
            });
          }
          throw err;
        }
      }
```

- [ ] **Step 6: Run** `pnpm --filter api exec vitest run src/services/mod-sources` → all PASS; tsc clean. **Checkpoint.** No commit.

---

### Task 8: `game-mods` service and provisioning integration

**Files:**
- Create: `apps/api/src/services/game-mods.ts`
- Test: `apps/api/src/services/game-mods.test.ts`
- Modify: `apps/api/src/services/game-server.ts`
- Modify: `apps/api/src/services/game-server.test.ts` (buildContainerSpec with mod env)

**Interfaces:**
- Consumes: Tasks 2, 4, 7.
- Produces (`game-mods.ts`):
  - `class GameModError extends Error { code: "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "SERVICE_UNAVAILABLE" }`
  - `type ModRowT = Pick<GameServerT, "id" | "spec" | "modpack" | "appliedModEnv">`
  - `resolveFilter(row: ModRowT, values: Record<string,string>, kind?: ModKindT): Promise<ModFilterI>` (throws `PRECONDITION_FAILED` with `compat.unsupported`)
  - `sourcesFor(spec: GameSpecT): Promise<Array<{ id: ModSourceIdT; search: boolean; install: boolean; reason?: string; modpacks: boolean }>>`
  - `searchMods(row, values, input: { source; query; kind?; offset }): Promise<ModSearchResultI>`
  - `searchModpacks(spec, input: { source; query; offset }): Promise<ModSearchResultI>`
  - `listVersions(spec, source, projectId, filter: ModFilterI | null): Promise<ModVersionI[]>`
  - `addMod(row, values, input: { source; ref; versionId? }, userId): Promise<GameServerModT>`
  - `updateMod(row, values, modId, patch: { enabled?; versionId? }): Promise<GameServerModT>`
  - `removeMod(row, modId): Promise<GameServerModT>`
  - `checkUpdates(row, values): Promise<Array<{ modId: string; versionId: string; label: string }>>`
  - `resolveModpack(spec, ref: GameModpackRefT): Promise<GameModpackI>`
  - `setModpack(row, pack: GameModpackI | null): Promise<void>`
  - `loadModEnv(row: ModRowT): Promise<RenderedModEnvI>`
  - `modsPending(row: ModRowT): Promise<{ pending: boolean; destructive: boolean }>`
  - `listOnDisk(row): Promise<Array<{ directory: string; files: string[] }>>`
- Produces (`game-server.ts`):
  - `buildContainerSpec(row, values, ports, modEnv: Record<string,string> = {})`
  - `recreateGameServer(row: GameServerT): Promise<{ restarted: boolean }>`
  - `createGameServer(input)` stores `modpack` when given
  - `allValues` exported (already a const; add to export list if missing)

- [ ] **Step 1: Failing tests**

`game-server.test.ts` — add (reuse the file's existing row/ports fixtures; names below assume `row` and `ports`, adapt to the file's names):

```ts
it("merges mod env after the game's env so a modpack TYPE wins", () => {
  const spec = buildContainerSpec(
    { ...row, spec: { ...row.spec, env: { ...row.spec.env, TYPE: "${server_type}" } } },
    { ...values, server_type: "FABRIC" },
    ports,
    { TYPE: "MODRINTH", MODRINTH_PROJECTS: "AA:v1" },
  );
  expect(spec.env).toContain("TYPE=MODRINTH");
  expect(spec.env).toContain("MODRINTH_PROJECTS=AA:v1");
  expect(spec.env.filter((e: string) => e.startsWith("TYPE="))).toHaveLength(1);
});
```

`game-mods.test.ts` — the DB-free parts (filter resolution and modpack metadata extraction):

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../db/index", () => ({ db: {} }));
vi.mock("../lib/redis", () => ({ redis: { get: vi.fn(async () => null), set: vi.fn() } }));
vi.mock("./instance-settings", () => ({ getSetting: vi.fn(async () => null) }));
vi.mock("./mod-sources/index", async (orig) => ({
  ...(await orig<any>()),
  resolveVersionAlias: vi.fn(async () => "1.21.4"),
}));

const { resolveFilter, modpackFromVersion, GameModError } = await import("./game-mods");

const SPEC: any = {
  variables: [
    { key: "server_type", label: "Server type", type: "select", options: [{ label: "V", value: "VANILLA" }, { label: "F", value: "FABRIC" }] },
    { key: "mc_version", label: "Version", type: "string" },
  ],
  mods: {
    sources: [{ source: "modrinth", env: "MODRINTH_PROJECTS" }],
    loader: { from: "server_type", map: { FABRIC: { loaders: ["fabric"], kind: "mod" } } },
    gameVersion: { from: "mc_version", aliases: { LATEST: "release" } },
    modpacks: [],
    directories: [],
  },
};
const row: any = { id: "s1", spec: SPEC, modpack: null, appliedModEnv: null };

describe("resolveFilter", () => {
  it("resolves LATEST to a concrete version", async () => {
    expect(await resolveFilter(row, { server_type: "FABRIC", mc_version: "LATEST" })).toEqual({
      loaders: ["fabric"], kind: "mod", gameVersion: "1.21.4",
    });
  });

  it("explains a loader without mods as PRECONDITION_FAILED", async () => {
    await expect(resolveFilter(row, { server_type: "VANILLA", mc_version: "1.21.4" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(resolveFilter(row, { server_type: "VANILLA" })).rejects.toBeInstanceOf(GameModError);
  });
});

describe("modpackFromVersion", () => {
  it("takes the first game version and the first real loader", () => {
    const pack = modpackFromVersion(
      { source: "modrinth", projectId: "P1", slug: "pack", name: "Pack", iconUrl: null } as any,
      { id: "V1", label: "1.0", gameVersions: ["1.20.1"], loaders: ["minecraft", "fabric"], publishedAt: "", type: "release" },
    );
    expect(pack).toEqual({
      source: "modrinth", projectId: "P1", slug: "pack", name: "Pack", iconUrl: null,
      versionId: "V1", versionLabel: "1.0", gameVersion: "1.20.1", loader: "fabric",
    });
  });
});
```

- [ ] **Step 2: Run both** → FAIL.

- [ ] **Step 3: Implement `services/game-mods.ts`**

```ts
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db/index";
import { gameServers, gameServerMods } from "../db/schema/index";

import { getSetting } from "./instance-settings";
import { listFiles } from "./game-files";
import {
  adapterFor,
  contextFor,
  resolveVersionAlias,
  ModSourceError,
} from "./mod-sources/index";
import {
  compatFilter,
  isDestructiveChange,
  modEnvPending,
  renderModEnv,
  snapshotModEnv,
  type RenderedModEnvI,
} from "./game-mods-env";

import type { GameModpackRefT, GameSpecT, ModKindT, ModSourceIdT } from "@deploykit/shared";
import type { GameModpackI, GameServerModT, GameServerT } from "../db/schema/index";
import type { ModFilterI, ModSearchResultI, ModSummaryI, ModVersionI } from "./mod-sources/index";

/**
 * A game server's mods: the list DeployKit keeps, and the catalogue lookups
 * that fill it. Nothing here downloads a mod — the image does that when the
 * container is recreated with the rendered env (see game-mods-env.ts).
 */

type GameModErrorCodeT = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "PRECONDITION_FAILED" | "SERVICE_UNAVAILABLE";

class GameModError extends Error {
  constructor(
    public code: GameModErrorCodeT,
    message: string,
  ) {
    super(message);
    this.name = "GameModError";
  }
}

type ModRowT = Pick<GameServerT, "id" | "spec" | "modpack" | "appliedModEnv">;

/** Adapter errors become the codes the router maps to tRPC. */
const wrap = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ModSourceError) {
      const code: GameModErrorCodeT =
        err.code === "NOT_FOUND" ? "NOT_FOUND"
        : err.code === "BAD_REQUEST" ? "BAD_REQUEST"
        : err.code === "UNAUTHORIZED" ? "PRECONDITION_FAILED"
        : "SERVICE_UNAVAILABLE";
      throw new GameModError(code, err.message);
    }
    throw err;
  }
};

const declaredSource = (spec: Pick<GameSpecT, "mods">, source: ModSourceIdT) => {
  const declared = spec.mods?.sources.find((s) => s.source === source);
  if (!declared) throw new GameModError("BAD_REQUEST", `This game does not take mods from ${source}`);
  return declared;
};

const resolveFilter = async (
  row: ModRowT,
  values: Record<string, string>,
  kind?: ModKindT,
): Promise<ModFilterI> => {
  const compat = compatFilter(row.spec, values, row.modpack);
  if (compat.unsupported) throw new GameModError("PRECONDITION_FAILED", compat.unsupported);
  const gameVersion = compat.versionAlias
    ? await wrap(() => resolveVersionAlias(compat.versionAlias!))
    : compat.gameVersion;
  return { loaders: compat.loaders, kind: kind ?? compat.kind ?? "mod", gameVersion };
};

const sourcesFor = async (spec: Pick<GameSpecT, "mods">) =>
  Promise.all(
    (spec.mods?.sources ?? []).map(async (s) => ({
      id: s.source,
      ...adapterFor(s.source).capabilities(await contextFor(s)),
      modpacks: Boolean(spec.mods?.modpacks.some((p) => p.source === s.source)),
    })),
  );

const searchMods = async (
  row: ModRowT,
  values: Record<string, string>,
  input: { source: ModSourceIdT; query: string; kind?: ModKindT; offset: number },
): Promise<ModSearchResultI> => {
  const source = declaredSource(row.spec, input.source);
  const filter = await resolveFilter(row, values, input.kind);
  const ctx = await contextFor(source);
  return wrap(() => adapterFor(input.source).search(input.query, filter, input.offset, ctx));
};

const searchModpacks = async (
  spec: Pick<GameSpecT, "mods">,
  input: { source: ModSourceIdT; query: string; offset: number },
): Promise<ModSearchResultI> => {
  const source = declaredSource(spec, input.source);
  if (!spec.mods?.modpacks.some((p) => p.source === input.source)) {
    throw new GameModError("BAD_REQUEST", `This game has no ${input.source} modpacks`);
  }
  const ctx = await contextFor(source);
  return wrap(() =>
    adapterFor(input.source).search(input.query, { loaders: null, kind: "modpack", gameVersion: null }, input.offset, ctx),
  );
};

const listVersions = async (
  spec: Pick<GameSpecT, "mods">,
  sourceId: ModSourceIdT,
  projectId: string,
  filter: ModFilterI | null,
): Promise<ModVersionI[]> => {
  const source = declaredSource(spec, sourceId);
  const ctx = await contextFor(source);
  return wrap(() => adapterFor(sourceId).versions(projectId, filter, ctx));
};

/** Resolve a pasted URL / slug / id and check DeployKit can install it. */
const lookupProject = async (spec: Pick<GameSpecT, "mods">, sourceId: ModSourceIdT, ref: string): Promise<ModSummaryI> => {
  const source = declaredSource(spec, sourceId);
  const adapter = adapterFor(sourceId);
  const parsed = adapter.parseRef(ref);
  if (!parsed) throw new GameModError("BAD_REQUEST", `That is not a ${sourceId} link or id`);
  const ctx = await contextFor(source);
  const caps = adapter.capabilities(ctx);
  if (!caps.install) throw new GameModError("PRECONDITION_FAILED", caps.reason ?? `${sourceId} is not available`);
  const project = await wrap(() => adapter.project(parsed, ctx));
  if (!project.installable) throw new GameModError("BAD_REQUEST", `${project.name}: ${project.reason}`);
  return project;
};

const pickVersion = (versions: ModVersionI[], wanted: string | undefined, name: string, filter: ModFilterI) => {
  if (wanted) {
    const hit = versions.find((v) => v.id === wanted);
    if (!hit) throw new GameModError("BAD_REQUEST", `That version of ${name} does not fit this server`);
    return hit;
  }
  const hit = versions.find((v) => v.type === "release") ?? versions[0];
  if (!hit) {
    const what = [filter.loaders?.[0], filter.gameVersion].filter(Boolean).join(" ");
    throw new GameModError("BAD_REQUEST", `No version of ${name} works with ${what || "this server"}`);
  }
  return hit;
};

const isUniqueViolation = (err: any) => err?.code === "23505" || err?.cause?.code === "23505";

const addMod = async (
  row: ModRowT,
  values: Record<string, string>,
  input: { source: ModSourceIdT; ref: string; versionId?: string },
  userId: string,
): Promise<GameServerModT> => {
  const project = await lookupProject(row.spec, input.source, input.ref);
  if (project.kind === "modpack") {
    throw new GameModError("BAD_REQUEST", `${project.name} is a modpack: choose it as the server's modpack instead`);
  }
  const filter = await resolveFilter(row, values);
  const versions = await listVersions(row.spec, input.source, project.projectId, filter);
  const version = pickVersion(versions, input.versionId, project.name, filter);
  const pinned = input.source === "steam-workshop" ? null : version.id;

  try {
    const [created] = await db
      .insert(gameServerMods)
      .values({
        gameServerId: row.id,
        source: input.source,
        projectId: project.projectId,
        slug: project.slug,
        name: project.name.slice(0, 200),
        iconUrl: project.iconUrl?.slice(0, 1000) ?? null,
        kind: filter.kind === "plugin" ? "plugin" : "mod",
        versionId: pinned,
        versionLabel: version.label.slice(0, 200),
        addedBy: userId,
      })
      .returning();
    return created!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new GameModError("CONFLICT", `${project.name} is already on this server`);
    throw err;
  }
};

const findMod = async (row: ModRowT, modId: string): Promise<GameServerModT> => {
  const mod = await db.query.gameServerMods.findFirst({
    where: and(eq(gameServerMods.id, modId), eq(gameServerMods.gameServerId, row.id)),
  });
  if (!mod) throw new GameModError("NOT_FOUND", "Mod not found");
  return mod;
};

const updateMod = async (
  row: ModRowT,
  values: Record<string, string>,
  modId: string,
  patch: { enabled?: boolean; versionId?: string },
): Promise<GameServerModT> => {
  const mod = await findMod(row, modId);
  const set: Partial<GameServerModT> = { updatedAt: new Date() };
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.versionId !== undefined && mod.source !== "steam-workshop") {
    const filter = await resolveFilter(row, values);
    const versions = await listVersions(row.spec, mod.source, mod.projectId, filter);
    const version = pickVersion(versions, patch.versionId, mod.name, filter);
    set.versionId = version.id;
    set.versionLabel = version.label.slice(0, 200);
  }
  const [updated] = await db.update(gameServerMods).set(set).where(eq(gameServerMods.id, mod.id)).returning();
  return updated!;
};

const removeMod = async (row: ModRowT, modId: string): Promise<GameServerModT> => {
  const mod = await findMod(row, modId);
  await db.delete(gameServerMods).where(eq(gameServerMods.id, mod.id));
  return mod;
};

const listMods = (row: Pick<GameServerT, "id">) =>
  db.query.gameServerMods.findMany({
    where: eq(gameServerMods.gameServerId, row.id),
    orderBy: [asc(gameServerMods.name)],
  });

/** Newest compatible version per pinned mod, where it differs. */
const checkUpdates = async (row: ModRowT, values: Record<string, string>) => {
  const filter = await resolveFilter(row, values);
  const mods = await listMods(row);
  const updates: Array<{ modId: string; versionId: string; label: string }> = [];
  for (const mod of mods) {
    if (mod.source === "steam-workshop") continue;
    const versions = await listVersions(row.spec, mod.source, mod.projectId, filter).catch(() => []);
    const newest = versions.find((v) => v.type === "release") ?? versions[0];
    if (newest && newest.id !== mod.versionId) {
      updates.push({ modId: mod.id, versionId: newest.id, label: newest.label });
    }
  }
  return updates;
};

const modpackFromVersion = (
  project: Pick<ModSummaryI, "source" | "projectId" | "slug" | "name" | "iconUrl">,
  version: ModVersionI,
): GameModpackI => ({
  source: project.source,
  projectId: project.projectId,
  slug: project.slug,
  name: project.name.slice(0, 200),
  iconUrl: project.iconUrl,
  versionId: version.id,
  versionLabel: version.label.slice(0, 200),
  gameVersion: version.gameVersions[0] ?? null,
  loader: version.loaders.find((l) => l !== "minecraft") ?? null,
});

const resolveModpack = async (spec: Pick<GameSpecT, "mods">, ref: GameModpackRefT): Promise<GameModpackI> => {
  if (!spec.mods?.modpacks.some((p) => p.source === ref.source)) {
    throw new GameModError("BAD_REQUEST", `This game has no ${ref.source} modpacks`);
  }
  const project = await lookupProject(spec, ref.source, ref.ref);
  if (project.kind !== "modpack") throw new GameModError("BAD_REQUEST", `${project.name} is not a modpack`);
  const versions = await listVersions(spec, ref.source, project.projectId, null);
  const version = pickVersion(versions, ref.versionId, project.name, { loaders: null, kind: "modpack", gameVersion: null });
  return modpackFromVersion(project, version);
};

const setModpack = async (row: ModRowT, pack: GameModpackI | null): Promise<void> => {
  await db.update(gameServers).set({ modpack: pack, updatedAt: new Date() }).where(eq(gameServers.id, row.id));
};

const loadModEnv = async (row: ModRowT): Promise<RenderedModEnvI> => {
  if (!row.spec.mods) return { env: {}, secretKeys: [] };
  const mods = await listMods(row);
  const curseforge = row.spec.mods.sources.some((s) => s.apiKeyEnv)
    ? await getSetting("curseforge_api_key")
    : null;
  return renderModEnv(row.spec.mods, mods, row.modpack, { curseforge });
};

const modsPending = async (row: ModRowT) => {
  const rendered = await loadModEnv(row);
  return {
    pending: modEnvPending(rendered, row.appliedModEnv),
    destructive: isDestructiveChange(row.appliedModEnv, snapshotModEnv(rendered), row.spec.mods),
  };
};

/** Files in the game's mod folders (uploaded by hand or installed by the image). */
const listOnDisk = async (row: GameServerT) => {
  const out: Array<{ directory: string; files: string[] }> = [];
  for (const dir of row.spec.mods?.directories ?? []) {
    const listing = await listFiles(row, dir.volume, dir.path).catch(() => null);
    out.push({
      directory: dir.path,
      files: (listing?.entries ?? []).filter((e) => e.type === "file").map((e) => e.name),
    });
  }
  return out;
};

export {
  GameModError,
  resolveFilter,
  sourcesFor,
  searchMods,
  searchModpacks,
  listVersions,
  addMod,
  updateMod,
  removeMod,
  listMods,
  checkUpdates,
  modpackFromVersion,
  resolveModpack,
  setModpack,
  loadModEnv,
  modsPending,
  listOnDisk,
  type ModRowT,
};
```

Check `listFiles`'s entry shape in `services/game-files.ts` (`FileEntryI`): if the type field is named differently (e.g. `isDirectory: boolean`), filter with that instead of `e.type === "file"`. Check that `game-files.ts` does not import `game-mods.ts` (no cycle).

Also add to `mod-sources/index.ts` a type re-export of `ModFilterI`, `ModSearchResultI`, `ModSummaryI`, `ModVersionI` (already covered by `export type * from "./types"`).

- [ ] **Step 4: Wire into `services/game-server.ts`**

Add import:

```ts
import { loadModEnv, resolveModpack } from "./game-mods";
import { snapshotModEnv } from "./game-mods-env";
```

Change `buildContainerSpec` signature and env merge:

```ts
const buildContainerSpec = (
  row: Pick<
    GameServerT,
    "id" | "name" | "projectId" | "gameId" | "spec" | "memoryMb" | "cpuMillicores"
  >,
  values: Record<string, string>,
  ports: PortRowI[],
  /** Rendered by game-mods: mod lists, the modpack's env, a CurseForge key. */
  modEnv: Record<string, string> = {},
) => {
  ...
  for (const port of spec.ports) { ... }
  // After the game's own env: a modpack's TYPE replaces the server type.
  Object.assign(env, modEnv);
```

In `provisionGameContainer`:

```ts
const provisionGameContainer = async (row: GameServerT): Promise<string> => {
  const ports = await loadPorts(row.id);
  const mods = await loadModEnv(row);
  const opts = buildContainerSpec(row, allValues(row), ports, mods.env);
  ...
    const containerId = await local.createAndStart(opts);
    await setStatus(row.id, "running", {
      containerId,
      image: opts.image,
      appliedModEnv: snapshotModEnv(mods),
    });
```

Extract the tail of `updateGameServer` into:

```ts
/**
 * Rebuild the container from the row as it is now (settings, mods), keeping
 * it stopped if it was stopped. A server never provisioned is left alone: its
 * first start picks everything up.
 */
const recreateGameServer = async (
  row: GameServerT,
  next: GameServerT = row,
): Promise<{ restarted: boolean }> => {
  if (!row.containerId) return { restarted: false };
  const wasRunning = await isRunning(row.containerId);
  await stopContainerGracefully(row);
  const containerId = await provisionGameContainer(next);
  if (!wasRunning) {
    await docker.getContainer(containerId).stop({ t: next.spec.stop.timeoutSec }).catch(() => {});
    await setStatus(row.id, "stopped");
  }
  return { restarted: wasRunning };
};
```

and make `updateGameServer` end with `return recreateGameServer(row, next);` (keeping its `if (!row.containerId) return { restarted: false };` behaviour, which `recreateGameServer` now owns).

In `createGameServer`, after validating values and before the name check:

```ts
  const modpack = input.modpack ? await resolveModpack(spec, input.modpack) : null;
```

and in the insert `.values({...})` add `modpack,`. `resolveModpack` throws `GameModError`; `createGameServer`'s callers (router `guarded`) must map it — handled in Task 10.

Add `recreateGameServer` and `allValues` to the export list.

- [ ] **Step 5: Run** `pnpm --filter api exec vitest run src/services/game-mods.test.ts src/services/game-server.test.ts` → PASS; tsc clean. **Checkpoint.** No commit.

---

### Task 9: Console `exec` method

**Files:**
- Modify: `apps/api/src/services/game-console.ts`
- Test: `apps/api/src/services/game-console.test.ts` (new)

**Interfaces:**
- Produces: `sendConsoleCommand` handles `method: "exec"`; returns the command's output (string), echoed to the log room.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { PassThrough } from "stream";

const execCalls: any[] = [];
const emitted: string[] = [];

vi.mock("../lib/docker", () => ({
  docker: {
    getContainer: () => ({
      inspect: async () => ({ State: { Running: true } }),
      exec: async (opts: any) => {
        execCalls.push(opts);
        return {
          start: async () => {
            const s = new PassThrough();
            // docker multiplexed frame: stdout, length 3, "ok\n"
            const header = Buffer.from([1, 0, 0, 0, 0, 0, 0, 3]);
            setImmediate(() => s.end(Buffer.concat([header, Buffer.from("ok\n")])));
            return s;
          },
          inspect: async () => ({ ExitCode: 0 }),
        };
      },
    }),
    modem: {
      demuxStream: (stream: any, out: any) => {
        stream.on("data", (c: Buffer) => out.write(c.subarray(8)));
      },
    },
  },
}));
vi.mock("../lib/socket", () => ({ emitContainerLog: (_id: string, line: string) => emitted.push(line) }));
vi.mock("../lib/encryption", () => ({ decryptEnvVars: () => ({}) }));

const { sendConsoleCommand } = await import("./game-console");

describe("exec console", () => {
  it("runs the injector with the command as one argv element", async () => {
    const reply = await sendConsoleCommand(
      { spec: { console: { method: "exec", command: ["inject"] } } as any, containerId: "c1", secretConfig: null },
      'say "hi there"',
    );
    expect(execCalls[0].Cmd).toEqual(["inject", 'say "hi there"']);
    expect(reply).toBe("ok\n");
    expect(emitted[0]).toContain('> say "hi there"');
  });
});
```

- [ ] **Step 2: Run** → FAIL (`exec` falls to the RCON branch).

- [ ] **Step 3: Implement** — in `game-console.ts` add `import { PassThrough } from "stream";` and, before the RCON branch in `sendConsoleCommand`:

```ts
  if (consoleSpec.method === "exec") {
    const reply = await execCommand(row.containerId, [...consoleSpec.command, command]);
    emitContainerLog(
      row.containerId,
      `> ${command}\n${reply ? `${reply.replace(/\n$/, "")}\n` : ""}`,
    );
    return reply;
  }
```

and the helper (above `sendConsoleCommand`):

```ts
const EXEC_TIMEOUT_MS = 10_000;

/** Run an image's own command injector; argv only, never a shell. */
const execCommand = async (containerId: string, argv: string[]): Promise<string> => {
  const exec = await docker.getContainer(containerId).exec({
    Cmd: argv,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: false });
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  docker.modem.demuxStream(stream, out, out);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      (stream as any).destroy?.();
      reject(new GameConsoleError("The console command did not finish in time"));
    }, EXEC_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    stream.on("end", done);
    stream.on("close", done);
    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(new GameConsoleError(`Could not run the command: ${err.message}`));
    });
  });
  return Buffer.concat(chunks).toString("utf8").slice(0, 64 * 1024);
};
```

Update the module doc comment's method list with "- `exec`: `docker exec` of the image's own injector (tModLoader's `inject`)."

- [ ] **Step 4: Run** → PASS; also re-run `src/services/game-server.test.ts` (stop/backup paths use `sendConsoleCommand`). **Checkpoint.** No commit.

---

### Task 10: Routers — access helpers, `gameServer.mods.*`, apply job

**Files:**
- Create: `apps/api/src/routers/game-server-access.ts`
- Create: `apps/api/src/routers/game-server-mods.ts`
- Modify: `apps/api/src/routers/game-server.ts`
- Modify: `apps/api/src/workers/game-backup.worker.ts`
- Test: extend `<scratchpad>/e2e.mjs` (Step 6)

**Interfaces:**
- Consumes: everything above.
- Produces tRPC:
  - `gameServer.mods.sources({id})`, `gameServer.mods.sourcesForGame({gameId})`
  - `gameServer.mods.search(gameModSearchSchema)`, `gameServer.mods.searchModpacks(gameModSearchForGameSchema)`
  - `gameServer.mods.versions(gameModVersionsSchema)`
  - `gameServer.mods.list({id})` → `{ mods: GameServerModT[]; modpack: GameModpackI | null; onDisk; pending: boolean; destructive: boolean; filter: ModFilterI | null; unsupported: string | null; canEdit: boolean }`
  - `gameServer.mods.checkUpdates({id})`
  - `gameServer.mods.add`, `update`, `remove`, `setModpack`, `apply`
  - BullMQ job `"apply-mods"` on `game-backup` with `{ gameServerId }`; backup trigger `"pre-mods"`.

- [ ] **Step 1: Move access helpers** — create `routers/game-server-access.ts` containing, **moved verbatim** from `routers/game-server.ts`: `LevelT`, `ALLOWED`, `MESSAGES`, `resolveServer`, `rethrow`, `guarded` (and their imports). Extend `rethrow` with:

```ts
  if (err instanceof GameModError) {
    throw new TRPCError({ code: err.code, message: err.message });
  }
```
(import `GameModError` from `../services/game-mods`). Export `{ resolveServer, rethrow, guarded, MESSAGES, type LevelT }`. In `routers/game-server.ts` delete the moved code and import it from `./game-server-access`.

Run `pnpm --filter api exec tsc --noEmit` → clean before continuing (pure move).

- [ ] **Step 2: Worker job** — in `workers/game-backup.worker.ts`:

```ts
import { recreateGameServer } from "../services/game-server";
...
interface ApplyModsJobI {
  gameServerId: string;
}

/** Recreate the container with the current mod list; the image installs it. */
const runApplyMods = async (data: ApplyModsJobI): Promise<void> => {
  const row = await db.query.gameServers.findFirst({ where: eq(gameServers.id, data.gameServerId) });
  if (!row) return;
  try {
    await recreateGameServer(row);
  } catch (err: any) {
    await setGameServerStatus(row.id, "error", {
      statusMessage: `Applying mods failed: ${err?.message ?? err}`,
    });
    throw err;
  }
};
```

and in the worker callback: `if (job.name === "apply-mods") return runApplyMods(job.data as ApplyModsJobI);`. Update the file's doc comment: "Applying mods goes through the same queue so a safety backup always finishes first."

- [ ] **Step 3: `routers/game-server-mods.ts`**

```ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  addGameModSchema,
  applyGameModsSchema,
  gameModSearchForGameSchema,
  gameModSearchSchema,
  gameModVersionsSchema,
  removeGameModSchema,
  setGameModpackSchema,
  updateGameModSchema,
} from "@deploykit/shared";

import { gameServerBackups } from "../db/schema/index";
import { router, protectedProcedure, operatorProcedure } from "../trpc";
import { logAction } from "../lib/audit/audit";
import { gameBackupQueue, isRateLimited } from "../lib/redis";
import { canOperate } from "../lib/permissions";
import { getGame } from "../services/game-catalog";
import { allValues } from "../services/game-server";
import {
  addMod,
  checkUpdates,
  listMods,
  listOnDisk,
  listVersions,
  loadModEnv,
  modsPending,
  removeMod,
  resolveFilter,
  resolveModpack,
  searchModpacks,
  searchMods,
  setModpack,
  sourcesFor,
  updateMod,
  GameModError,
} from "../services/game-mods";
import { snapshotModEnv, isDestructiveChange } from "../services/game-mods-env";

import { guarded, resolveServer } from "./game-server-access";

import type { Context } from "../trpc";

/**
 * Mods and modpacks. Reading the list and browsing catalogues is `canView`;
 * anything that changes what code the server runs is global operator AND
 * project `canOperate`, like a file upload or a console command.
 */

const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;

const limitSearch = async (userId: string) => {
  if (await isRateLimited(`mod-search:${userId}`, SEARCH_LIMIT, SEARCH_WINDOW_MS)) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many searches, wait a minute" });
  }
};

const requireMods = (row: { spec: { mods?: unknown } }) => {
  if (!row.spec.mods) throw new TRPCError({ code: "BAD_REQUEST", message: "This game does not support mods" });
};

const gameOrThrow = async (gameId: string) => {
  const game = await getGame(gameId);
  if (!game) throw new TRPCError({ code: "NOT_FOUND", message: "Game not found" });
  return game;
};

type AuthedCtxT = Pick<Context, "db"> & { user: NonNullable<Context["user"]> };

/** Queue the (optional) safety backup and the recreate, in that order. */
const queueApply = async (ctx: AuthedCtxT, serverId: string, safetyBackup: boolean) => {
  if (safetyBackup) {
    const [safety] = await ctx.db
      .insert(gameServerBackups)
      .values({ gameServerId: serverId, filename: "", status: "queued", trigger: "pre-mods", triggeredBy: ctx.user.id })
      .returning();
    await gameBackupQueue.add("backup", {
      gameServerId: serverId,
      backupId: safety!.id,
      trigger: "pre-mods",
      userId: ctx.user.id,
    });
  }
  await gameBackupQueue.add("apply-mods", { gameServerId: serverId });
};

export const gameServerModsRouter = router({
  sources: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "view");
    return sourcesFor(row.spec);
  }),

  /** For the create modal: no server yet, the catalogue is public. */
  sourcesForGame: protectedProcedure
    .input(z.object({ gameId: z.string().min(1).max(64) }))
    .query(async ({ input }) => sourcesFor(await gameOrThrow(input.gameId))),

  search: protectedProcedure.input(gameModSearchSchema).query(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "view");
    requireMods(row);
    await limitSearch(ctx.user.id);
    return guarded(() => searchMods(row, allValues(row), input));
  }),

  searchModpacks: protectedProcedure.input(gameModSearchForGameSchema).query(async ({ ctx, input }) => {
    await limitSearch(ctx.user.id);
    const game = await gameOrThrow(input.gameId);
    return guarded(() => searchModpacks(game, input));
  }),

  versions: protectedProcedure.input(gameModVersionsSchema).query(async ({ ctx, input }) => {
    if (input.id) {
      const { row } = await resolveServer(ctx, input.id, "view");
      requireMods(row);
      return guarded(async () =>
        listVersions(row.spec, input.source, input.projectId, input.kind === "modpack" ? null : await resolveFilter(row, allValues(row), input.kind)),
      );
    }
    if (!input.gameId) throw new TRPCError({ code: "BAD_REQUEST", message: "id or gameId is required" });
    const game = await gameOrThrow(input.gameId);
    return guarded(() => listVersions(game, input.source, input.projectId, null));
  }),

  list: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { row, role } = await resolveServer(ctx, input.id, "view");
    requireMods(row);
    const [mods, onDisk, pending] = await Promise.all([
      listMods(row),
      listOnDisk(row).catch(() => []),
      modsPending(row),
    ]);
    let filter = null;
    let unsupported: string | null = null;
    try {
      filter = await resolveFilter(row, allValues(row));
    } catch (err) {
      if (err instanceof GameModError) unsupported = err.message;
      else throw err;
    }
    return {
      mods,
      modpack: row.modpack,
      onDisk,
      ...pending,
      filter,
      unsupported,
      canEdit: canOperate(role) && ctx.user.role !== "viewer",
    };
  }),

  checkUpdates: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "view");
    requireMods(row);
    return guarded(() => checkUpdates(row, allValues(row)));
  }),

  add: operatorProcedure.input(addGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => addMod(row, allValues(row), input, ctx.user.id));
    await logAction(ctx, {
      action: "game_server.mod_add",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { source: mod.source, projectId: mod.projectId, name: mod.name, version: mod.versionLabel },
    });
    return mod;
  }),

  update: operatorProcedure.input(updateGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => updateMod(row, allValues(row), input.modId, input));
    await logAction(ctx, {
      action: "game_server.mod_update",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { name: mod.name, enabled: mod.enabled, version: mod.versionLabel },
    });
    return mod;
  }),

  remove: operatorProcedure.input(removeGameModSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const mod = await guarded(() => removeMod(row, input.modId));
    await logAction(ctx, {
      action: "game_server.mod_remove",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { name: mod.name, source: mod.source },
    });
    return { ok: true };
  }),

  setModpack: operatorProcedure.input(setGameModpackSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    const pack = input.modpack ? await guarded(() => resolveModpack(row.spec, input.modpack!)) : null;
    await setModpack(row, pack);
    await logAction(ctx, {
      action: "game_server.modpack_set",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { modpack: pack ? `${pack.name} ${pack.versionLabel}` : null },
    });
    return pack;
  }),

  apply: operatorProcedure.input(applyGameModsSchema).mutation(async ({ ctx, input }) => {
    const { row } = await resolveServer(ctx, input.id, "operate");
    requireMods(row);
    if (row.status === "restoring" || row.status === "provisioning") {
      throw new TRPCError({ code: "CONFLICT", message: `The server is ${row.status}; try again when it is done` });
    }
    const rendered = await loadModEnv(row);
    // Taking mods away can break a world: always back it up first then.
    const forced = isDestructiveChange(row.appliedModEnv, snapshotModEnv(rendered), row.spec.mods);
    const safetyBackup = input.safetyBackup || forced;
    await queueApply(ctx, row.id, safetyBackup);
    await logAction(ctx, {
      action: "game_server.mods_apply",
      resourceType: "game_server",
      resourceId: row.id,
      resourceName: row.name,
      metadata: { safetyBackup, forced },
    });
    return { queued: true, safetyBackup };
  }),
});
```

(`ctx.user.role` — confirm the context exposes the global role under that name; `operatorProcedure`'s own check in `trpc.ts` shows it.)

- [ ] **Step 4: Mount and harden `game-server.ts`**

- `import { gameServerModsRouter } from "./game-server-mods";` and add `mods: gameServerModsRouter,` to `gameServerRouter`.
- `create`: when `input.modpack` is present, require the global operator role (a modpack is code):

```ts
    if (input.modpack && ctx.user.role === "viewer") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Starting from a modpack needs the operator role" });
    }
```
- `presentServer`: also strip `appliedModEnv`: `const { secretConfig: _secret, appliedModEnv: _applied, ...rest } = row;`
- `listByProject` / `project.byId` select lists: if they enumerate columns, nothing to do; if they spread rows, strip `appliedModEnv` the same way.

- [ ] **Step 5: Typecheck and unit tests** — `pnpm --filter api exec tsc --noEmit`; `pnpm --filter api test` → only the 4 known `webhook.test.ts` failures (need Postgres on 5432).

- [ ] **Step 6: e2e** — extend `<scratchpad>/e2e.mjs` (the game-server e2e from the previous feature) with a seeded fake game that declares `mods.sources: [{source:"steam-workshop", env:"WS_IDS", enabledEnv:"WS_ON", appId:1281930}]` (Steam lookups need no key; the e2e makes real calls to `api.steampowered.com`) and the echo image. Add a section:

```js
console.log("mods");
const sources = await q("gameServer.mods.sources", { id });
ok(sources[0].id === "steam-workshop" && sources[0].install && !sources[0].search, "workshop: install without key, no search");
const added = await call("gameServer.mods.add", { id, source: "steam-workshop", ref: "https://steamcommunity.com/sharedfiles/filedetails/?id=2824688072" });
ok(added.projectId === "2824688072", "added by URL");
await expectCode(call("gameServer.mods.add", { id, source: "steam-workshop", ref: "2824688072" }), "CONFLICT", "duplicate refused");
await expectCode(call("gameServer.mods.add", { id, source: "steam-workshop", ref: "https://evil.example/?id=1" }), "BAD_REQUEST", "foreign URL refused");
let listed = await q("gameServer.mods.list", { id });
ok(listed.pending === true, "pending after add");
await call("gameServer.mods.apply", { id });
await waitFor(async () => !(await q("gameServer.mods.list", { id })).pending, "applied");
const env = JSON.parse(execSync(`docker inspect -f "{{json .Config.Env}}" dk-gs-echo1`).toString());
ok(env.includes("WS_IDS=2824688072") && env.includes("WS_ON=2824688072"), "env rendered into the container");
await call("gameServer.mods.update", { id, modId: added.id, enabled: false });
const r = await call("gameServer.mods.apply", { id, safetyBackup: false });
ok(r.safetyBackup === true, "disabling a mod forces a safety backup");
// rbac
await expectCode(call("gameServer.mods.add", { id, source: "steam-workshop", ref: "1" }, "POST", projOp), "FORBIDDEN", "global viewer cannot add mods");
await expectCode(q("gameServer.mods.list", { id }, stranger), "NOT_FOUND", "non-member gets NOT_FOUND on mods.list");
const keys = await q("settings.modKeys.status");
ok(!JSON.stringify(keys).includes("secret"), "key status never contains a value");
await expectCode(q("settings.modKeys.status", undefined, projOp), "FORBIDDEN", "non-admin cannot read key status");
```
(Place the RBAC lines after the users are created in the existing RBAC section; add `import { execSync } from "child_process";` at the top. Run exactly as before: throwaway Postgres on 55432 and Redis on 56379, API on 3091.)

Expected: `ALL E2E CHECKS PASSED`.

- [ ] **Step 7: Checkpoint.** No commit.

---

### Task 11: Web — Mods tab

**Files:**
- Modify: `apps/web/src/features/game-server/infrastructure/ui/interfaces/game-server.interfaces.ts`
- Modify: `.../constants/game-server.constants.ts`
- Modify: `.../hooks/useGameServerDetail.ts`, `.../pages/GameServerDetailPage.tsx`, `.../components/index.ts`
- Create: `.../hooks/useGameMods.ts`, `.../hooks/useModSearch.ts`
- Create: `.../components/ModsTab.tsx`, `.../components/ModRow.tsx`, `.../components/AddModsModal.tsx`, `.../components/ModpackCard.tsx`

**Interfaces:**
- Consumes: tRPC `gameServer.mods.*` (Task 10).
- Produces: `ModsTab` (props `GameServerTabPropsI`), `AddModsModal` (`{ open; onClose; server: GameServerDetailT; sources: ModSourceInfoT[]; mode: "mods" | "modpack"; onPickModpack? }`) reused by Task 12's picker; `useModSearch({ serverId?: string; gameId?: string; source; kind })`.

- [ ] **Step 1: Types** — append to `game-server.interfaces.ts`:

```ts
type GameModsListT = Awaited<ReturnType<GameServerClientT["mods"]["list"]["query"]>>;
type GameModT = GameModsListT["mods"][number];
type ModSourceInfoT = Awaited<ReturnType<GameServerClientT["mods"]["sources"]["query"]>>[number];
type ModSearchHitT = Awaited<ReturnType<GameServerClientT["mods"]["search"]["query"]>>["hits"][number];
type ModVersionT = Awaited<ReturnType<GameServerClientT["mods"]["versions"]["query"]>>[number];
type ModSourceIdT = ModSourceInfoT["id"];

interface AddModsModalPropsI {
  open: boolean;
  onClose: () => void;
  sources: ModSourceInfoT[];
  /** "mods": add to `serverId`. "modpack": pick one for `gameId` (or `serverId`). */
  mode: "mods" | "modpack";
  serverId?: string;
  gameId?: string;
  onPickModpack?: (pick: { source: ModSourceIdT; ref: string; versionId?: string; name: string }) => void;
}

interface ModRowPropsI {
  mod: GameModT;
  update: { versionId: string; label: string } | undefined;
  canEdit: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onUpdate: () => void;
}

interface ModpackCardPropsI {
  modpack: GameModsListT["modpack"];
  canEdit: boolean;
  hasModpackSources: boolean;
  busy: boolean;
  onChange: () => void;
  onRemove: () => void;
}
```
and export them; add `"mods"` to `GameServerTabT`.

- [ ] **Step 2: Constants** — in `game-server.constants.ts` add `Puzzle` to the lucide import and the tab after `files`:

```ts
  { id: "mods", label: "Mods", icon: Puzzle },
```
plus:

```ts
const MOD_SOURCE_LABELS: Record<string, string> = {
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  "steam-workshop": "Steam Workshop",
};
const MOD_SEARCH_DEBOUNCE_MS = 350;
const MODS_POLL_MS = 3_000;
```
Add `"pre-mods": "Before mod change"` to `BACKUP_TRIGGER_LABELS`. Export the new constants.

- [ ] **Step 3: Show the tab only for games with mods** — `useGameServerDetail.ts`:

```ts
  const tabs = useMemo(
    () =>
      TABS.filter(
        (t) =>
          (t.id !== "console" || server?.spec.console.method !== "none") &&
          (t.id !== "mods" || Boolean(server?.spec.mods)),
      ),
    [server?.spec.console.method, server?.spec.mods],
  );
```
and in `GameServerDetailPage.tsx`: `{activeTab === "mods" && <ModsTab {...tabProps} />}` with `ModsTab` imported from the components index.

- [ ] **Step 4: `hooks/useModSearch.ts`**

```ts
import { useEffect, useState } from "react";

import { trpc } from "@lib/trpc";

import { MOD_SEARCH_DEBOUNCE_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  ModSearchHitT,
  ModSourceIdT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/**
 * Debounced, paged catalogue search: a server's compatible mods, or a game's
 * modpacks before the server exists.
 */
export const useModSearch = (opts: {
  serverId?: string;
  gameId?: string;
  source: ModSourceIdT | null;
  kind: "mod" | "plugin" | "modpack";
  enabled: boolean;
}) => {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [hits, setHits] = useState<ModSearchHitT[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), MOD_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setOffset(0);
    setHits([]);
  }, [debounced, opts.source, opts.kind]);

  const forServer = Boolean(opts.serverId) && opts.kind !== "modpack";
  const serverQuery = trpc.gameServer.mods.search.useQuery(
    { id: opts.serverId!, source: opts.source!, query: debounced, kind: opts.kind, offset },
    { enabled: opts.enabled && forServer && Boolean(opts.source), staleTime: 60_000 },
  );
  const packQuery = trpc.gameServer.mods.searchModpacks.useQuery(
    { gameId: opts.gameId!, source: opts.source!, query: debounced, offset },
    { enabled: opts.enabled && !forServer && Boolean(opts.gameId) && Boolean(opts.source), staleTime: 60_000 },
  );
  const active = forServer ? serverQuery : packQuery;

  useEffect(() => {
    if (!active.data) return;
    setHits((prev) => (offset === 0 ? active.data!.hits : [...prev, ...active.data!.hits]));
  }, [active.data, offset]);

  const total = active.data?.total ?? 0;

  return {
    query,
    setQuery,
    hits,
    total,
    loading: active.isFetching,
    error: active.error?.message ?? null,
    hasMore: hits.length < total,
    loadMore: () => setOffset(hits.length),
  };
};
```

- [ ] **Step 5: `hooks/useGameMods.ts`**

```ts
import { useMemo, useState } from "react";

import { trpc } from "@lib/trpc";

import { MODS_POLL_MS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { GameServerDetailT } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** The Mods tab: list, updates, toggles, modpack and apply. */
export const useGameMods = (server: GameServerDetailT) => {
  const utils = trpc.useUtils();
  const id = server.id;
  const [addOpen, setAddOpen] = useState(false);
  const [modpackOpen, setModpackOpen] = useState(false);
  const [safetyBackup, setSafetyBackup] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const listQuery = trpc.gameServer.mods.list.useQuery(
    { id },
    { refetchInterval: server.status === "provisioning" ? MODS_POLL_MS : false },
  );
  const sourcesQuery = trpc.gameServer.mods.sources.useQuery({ id });
  const updatesQuery = trpc.gameServer.mods.checkUpdates.useQuery(
    { id },
    { enabled: false, retry: false },
  );

  const invalidate = () => {
    utils.gameServer.mods.list.invalidate({ id });
    utils.gameServer.byId.invalidate({ id });
  };

  const updateMutation = trpc.gameServer.mods.update.useMutation({
    onSettled: () => {
      setBusyId(null);
      invalidate();
      if (updatesQuery.data) updatesQuery.refetch();
    },
  });
  const removeMutation = trpc.gameServer.mods.remove.useMutation({
    onSettled: () => {
      setBusyId(null);
      invalidate();
    },
  });
  const modpackMutation = trpc.gameServer.mods.setModpack.useMutation({
    onSuccess: () => setModpackOpen(false),
    onSettled: invalidate,
  });
  const applyMutation = trpc.gameServer.mods.apply.useMutation({
    onSettled: () => {
      invalidate();
      utils.gameServer.backups.list.invalidate({ id });
    },
  });

  const data = listQuery.data;
  const updates = useMemo(
    () => new Map((updatesQuery.data ?? []).map((u) => [u.modId, u])),
    [updatesQuery.data],
  );
  const sources = sourcesQuery.data ?? [];

  return {
    data,
    loading: listQuery.isLoading,
    error: listQuery.error?.message ?? null,
    sources,
    hasModpackSources: sources.some((s) => s.modpacks),
    canEdit: data?.canEdit ?? false,
    updates,
    checkingUpdates: updatesQuery.isFetching,
    updatesError: updatesQuery.error?.message ?? null,
    checkUpdates: () => updatesQuery.refetch(),
    busyId,
    toggle: (modId: string, enabled: boolean) => {
      setBusyId(modId);
      updateMutation.mutate({ id, modId, enabled });
    },
    updateTo: (modId: string, versionId: string) => {
      setBusyId(modId);
      updateMutation.mutate({ id, modId, versionId });
    },
    remove: (modId: string) => {
      setBusyId(modId);
      removeMutation.mutate({ id, modId });
    },
    mutationError:
      updateMutation.error?.message ?? removeMutation.error?.message ?? modpackMutation.error?.message ?? null,
    addOpen,
    setAddOpen,
    modpackOpen,
    setModpackOpen,
    setModpack: (pick: { source: "modrinth" | "curseforge" | "steam-workshop"; ref: string; versionId?: string } | null) =>
      modpackMutation.mutate({ id, modpack: pick }),
    settingModpack: modpackMutation.isPending,
    safetyBackup,
    setSafetyBackup,
    apply: () => applyMutation.mutate({ id, safetyBackup }),
    applying: applyMutation.isPending,
    applyError: applyMutation.error?.message ?? null,
    applied: applyMutation.data ?? null,
    onAdded: invalidate,
  };
};
```

- [ ] **Step 6: `components/ModRow.tsx`**

```tsx
import { memo } from "react";
import { ArrowUpCircle, Package, Trash2 } from "lucide-react";

import { Button } from "@shared/components/button";

import { cn } from "@lib/utils";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { ModRowPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const ModRow: React.FC<ModRowPropsI> = memo(function ModRow({
  mod,
  update,
  canEdit,
  busy,
  onToggle,
  onRemove,
  onUpdate,
}) {
  return (
    <li className={cn("flex items-center gap-3 py-2.5", !mod.enabled && "opacity-60")}>
      {mod.iconUrl ? (
        <img src={mod.iconUrl} alt="" className="w-8 h-8 rounded object-cover bg-surface-2" loading="lazy" />
      ) : (
        <div className="w-8 h-8 rounded bg-surface-2 flex items-center justify-center">
          <Package className="w-4 h-4 text-text-muted" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{mod.name}</p>
        <p className="text-xs text-text-muted truncate">
          {MOD_SOURCE_LABELS[mod.source]} · {mod.versionLabel ?? "latest"}
          {mod.source === "steam-workshop" && " · always latest"}
        </p>
      </div>
      {update && canEdit && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={onUpdate} title={`Update to ${update.label}`}>
          <ArrowUpCircle className="w-3.5 h-3.5" />
          Update
        </Button>
      )}
      <label className="flex items-center gap-1.5 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={mod.enabled}
          disabled={!canEdit || busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Enabled
      </label>
      {canEdit && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove} aria-label={`Remove ${mod.name}`}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      )}
    </li>
  );
});
```

- [ ] **Step 7: `components/ModpackCard.tsx`**

```tsx
import { memo } from "react";
import { Boxes } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type { ModpackCardPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const ModpackCard: React.FC<ModpackCardPropsI> = memo(function ModpackCard({
  modpack,
  canEdit,
  hasModpackSources,
  busy,
  onChange,
  onRemove,
}) {
  if (!hasModpackSources) return null;
  return (
    <Card>
      <div className="flex items-center gap-3">
        {modpack?.iconUrl ? (
          <img src={modpack.iconUrl} alt="" className="w-10 h-10 rounded object-cover" />
        ) : (
          <div className="w-10 h-10 rounded bg-surface-2 flex items-center justify-center">
            <Boxes className="w-5 h-5 text-text-muted" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-muted uppercase tracking-wider">Modpack</p>
          {modpack ? (
            <p className="text-sm font-medium truncate">
              {modpack.name} <span className="text-text-muted">· {modpack.versionLabel}</span>
              <span className="text-text-muted">
                {" "}· {MOD_SOURCE_LABELS[modpack.source]}
                {modpack.gameVersion ? ` · ${modpack.loader ?? ""} ${modpack.gameVersion}` : ""}
              </span>
            </p>
          ) : (
            <p className="text-sm text-text-secondary">None — the server runs the settings' server type and version.</p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={onChange}>
              {modpack ? "Change" : "Choose a modpack"}
            </Button>
            {modpack && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
});
```

- [ ] **Step 8: `components/AddModsModal.tsx`**

```tsx
import { memo, useEffect, useState } from "react";
import { Download, ExternalLink, Link2, Loader2, Package } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";
import { Modal } from "@shared/components/modal";

import { useModSearch } from "@game-server/infrastructure/ui/hooks/useModSearch";

import { trpc } from "@lib/trpc";
import { cn } from "@lib/utils";

import { MOD_SOURCE_LABELS } from "@game-server/infrastructure/ui/constants/game-server.constants";

import type {
  AddModsModalPropsI,
  ModSearchHitT,
  ModSourceIdT,
} from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

const formatCount = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n);

/**
 * Search a catalogue and install (mode "mods"), or pick a modpack (mode
 * "modpack"). Results are already filtered to what fits the server.
 */
export const AddModsModal: React.FC<AddModsModalPropsI> = memo(function AddModsModal({
  open,
  onClose,
  sources,
  mode,
  serverId,
  gameId,
  onPickModpack,
}) {
  const usable = sources.filter((s) => (mode === "modpack" ? s.modpacks : true));
  const [source, setSource] = useState<ModSourceIdT | null>(usable[0]?.id ?? null);
  const [pasted, setPasted] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const current = usable.find((s) => s.id === source) ?? null;
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open && !source && usable[0]) setSource(usable[0].id);
  }, [open, source, usable]);

  const search = useModSearch({
    serverId,
    gameId,
    source,
    kind: mode === "modpack" ? "modpack" : "mod",
    enabled: open && Boolean(current?.search),
  });

  const addMutation = trpc.gameServer.mods.add.useMutation({
    onSuccess: (mod) => {
      setAdded((prev) => new Set(prev).add(mod.projectId));
      setPasted("");
      utils.gameServer.mods.list.invalidate({ id: serverId! });
    },
  });

  const pick = (hit: Pick<ModSearchHitT, "projectId" | "name"> & { ref?: string }) => {
    if (!source) return;
    const ref = hit.ref ?? hit.projectId;
    if (mode === "modpack") onPickModpack?.({ source, ref, name: hit.name });
    else addMutation.mutate({ id: serverId!, source, ref });
  };

  return (
    <Modal open={open} onClose={onClose} title={mode === "modpack" ? "Choose a modpack" : "Add mods"}>
      <div className="space-y-4">
        {usable.length > 1 && (
          <div className="flex gap-1 border-b border-border">
            {usable.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s.id)}
                className={cn(
                  "px-3 py-1.5 text-sm -mb-px border-b-2",
                  source === s.id ? "border-accent text-text-primary" : "border-transparent text-text-muted",
                )}
              >
                {MOD_SOURCE_LABELS[s.id]}
              </button>
            ))}
          </div>
        )}

        {current && !current.install && (
          <p className="text-sm text-warning">{current.reason}</p>
        )}

        {current?.install && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (pasted.trim()) pick({ projectId: pasted.trim(), name: pasted.trim(), ref: pasted.trim() });
            }}
          >
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={`Paste a ${MOD_SOURCE_LABELS[current.id]} link or id`}
              aria-label="Link or id"
            />
            <Button type="submit" variant="secondary" disabled={!pasted.trim() || addMutation.isPending}>
              <Link2 className="w-3.5 h-3.5" />
              {mode === "modpack" ? "Use" : "Add"}
            </Button>
          </form>
        )}

        {current?.install && !current.search && current.reason && (
          <p className="text-xs text-text-muted">{current.reason}</p>
        )}

        {addMutation.error && <p className="text-sm text-danger">{addMutation.error.message}</p>}

        {current?.search && (
          <>
            <Input
              value={search.query}
              onChange={(e) => search.setQuery(e.target.value)}
              placeholder={mode === "modpack" ? "Search modpacks" : "Search mods"}
              aria-label="Search"
              autoFocus
            />
            {search.error && <p className="text-sm text-danger">{search.error}</p>}
            <ul className="max-h-[50vh] overflow-y-auto divide-y divide-border">
              {search.hits.map((hit) => {
                const done = added.has(hit.projectId);
                return (
                  <li key={hit.projectId} className="flex items-start gap-3 py-2.5">
                    {hit.iconUrl ? (
                      <img src={hit.iconUrl} alt="" className="w-9 h-9 rounded object-cover" loading="lazy" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-surface-2 flex items-center justify-center">
                        <Package className="w-4 h-4 text-text-muted" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {hit.name}
                        <a href={hit.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-text-muted">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </p>
                      <p className="text-xs text-text-muted line-clamp-2">{hit.summary}</p>
                      <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
                        <Download className="w-3 h-3" /> {formatCount(hit.downloads)}
                        {hit.author && ` · ${hit.author}`}
                        {!hit.installable && hit.reason && <span className="text-warning"> · {hit.reason}</span>}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={done ? "ghost" : "secondary"}
                      disabled={!hit.installable || done || addMutation.isPending}
                      onClick={() => pick(hit)}
                    >
                      {done ? "Added" : mode === "modpack" ? "Use" : "Add"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {search.loading && <Loader2 className="w-4 h-4 animate-spin text-text-muted mx-auto" />}
            {!search.loading && search.hits.length === 0 && (
              <p className="text-sm text-text-muted text-center py-4">No results that fit this server.</p>
            )}
            {search.hasMore && !search.loading && (
              <Button variant="ghost" size="sm" className="w-full" onClick={search.loadMore}>
                Load more
              </Button>
            )}
          </>
        )}

        {mode === "mods" && (
          <p className="text-xs text-text-muted">
            Mods are installed by the server when you apply the changes, which restarts it.
          </p>
        )}
      </div>
    </Modal>
  );
});
```

(If `text-text-primary` / `border-border` are not the design tokens in use, take the ones `GameServerDetailPage.tsx` uses for its own tab bar.)

- [ ] **Step 9: `components/ModsTab.tsx`**

```tsx
import { memo } from "react";
import { AlertTriangle, FolderOpen, Loader2, Plus, RefreshCw, Puzzle } from "lucide-react";

import { Button } from "@shared/components/button";
import { Card } from "@shared/components/card";
import { EmptyState } from "@shared/components/empty-state";

import { useGameMods } from "@game-server/infrastructure/ui/hooks/useGameMods";
import { AddModsModal } from "@game-server/infrastructure/ui/components/AddModsModal";
import { ModRow } from "@game-server/infrastructure/ui/components/ModRow";
import { ModpackCard } from "@game-server/infrastructure/ui/components/ModpackCard";

import type { GameServerTabPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

export const ModsTab: React.FC<GameServerTabPropsI> = memo(function ModsTab({ server }) {
  const m = useGameMods(server);
  const data = m.data;

  if (m.loading) return <Loader2 className="w-5 h-5 animate-spin text-text-muted" />;
  if (m.error || !data) return <p className="text-sm text-danger">{m.error ?? "Could not load mods"}</p>;

  return (
    <div className="space-y-4">
      {data.pending && (
        <Card className="border-warning/40">
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <p className="text-sm flex-1">
              Changes pending — they take effect when the server is rebuilt.
              {data.destructive && " Mods are being removed or the modpack changes: a safety backup runs first."}
            </p>
            {m.canEdit && (
              <>
                {!data.destructive && (
                  <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <input type="checkbox" checked={m.safetyBackup} onChange={(e) => m.setSafetyBackup(e.target.checked)} />
                    Back up first
                  </label>
                )}
                <Button size="sm" onClick={m.apply} disabled={m.applying}>
                  {m.applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Apply & restart
                </Button>
              </>
            )}
          </div>
          {m.applyError && <p className="text-sm text-danger mt-2">{m.applyError}</p>}
        </Card>
      )}
      {m.applied && !data.pending && (
        <p className="text-xs text-text-muted">
          Applied{m.applied.safetyBackup ? " after a safety backup" : ""}. Download progress and errors show in the Console and Logs tabs.
        </p>
      )}

      <ModpackCard
        modpack={data.modpack}
        canEdit={m.canEdit}
        hasModpackSources={m.hasModpackSources}
        busy={m.settingModpack}
        onChange={() => m.setModpackOpen(true)}
        onRemove={() => m.setModpack(null)}
      />

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Puzzle className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium flex-1">Installed</h3>
          <Button size="sm" variant="ghost" onClick={m.checkUpdates} disabled={m.checkingUpdates || data.mods.length === 0}>
            {m.checkingUpdates ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Check for updates
          </Button>
          {m.canEdit && (
            <Button size="sm" onClick={() => m.setAddOpen(true)} disabled={Boolean(data.unsupported)}>
              <Plus className="w-3.5 h-3.5" />
              Add mods
            </Button>
          )}
        </div>
        {data.unsupported && <p className="text-sm text-warning mb-2">{data.unsupported}</p>}
        {data.filter && (
          <p className="text-xs text-text-muted mb-2">
            Showing what fits {[data.filter.loaders?.[0], data.filter.gameVersion].filter(Boolean).join(" ") || "this server"}.
          </p>
        )}
        {m.updatesError && <p className="text-sm text-danger mb-2">{m.updatesError}</p>}
        {m.mutationError && <p className="text-sm text-danger mb-2">{m.mutationError}</p>}
        {data.mods.length === 0 ? (
          <EmptyState
            icon={<Puzzle className="w-6 h-6" />}
            title="No mods yet"
            description="Search Modrinth, CurseForge or the Workshop and add them here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.mods.map((mod) => {
              const update = m.updates.get(mod.id);
              return (
                <ModRow
                  key={mod.id}
                  mod={mod}
                  update={update}
                  canEdit={m.canEdit}
                  busy={m.busyId === mod.id}
                  onToggle={(enabled) => m.toggle(mod.id, enabled)}
                  onRemove={() => m.remove(mod.id)}
                  onUpdate={() => update && m.updateTo(mod.id, update.versionId)}
                />
              );
            })}
          </ul>
        )}
      </Card>

      {data.onDisk.some((d) => d.files.length > 0) && (
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-medium">On disk</h3>
          </div>
          <p className="text-xs text-text-muted mb-2">
            Files in the mod folders, including ones uploaded by hand from the Files tab.
          </p>
          {data.onDisk.map((d) => (
            <div key={d.directory} className="text-xs mb-2">
              <p className="font-mono text-text-secondary">{d.directory}/</p>
              <p className="text-text-muted break-words">{d.files.join(", ") || "empty"}</p>
            </div>
          ))}
        </Card>
      )}

      <AddModsModal
        open={m.addOpen}
        onClose={() => m.setAddOpen(false)}
        sources={m.sources}
        mode="mods"
        serverId={server.id}
      />
      <AddModsModal
        open={m.modpackOpen}
        onClose={() => m.setModpackOpen(false)}
        sources={m.sources}
        mode="modpack"
        serverId={server.id}
        gameId={server.gameId}
        onPickModpack={(pick) => m.setModpack({ source: pick.source, ref: pick.ref, versionId: pick.versionId })}
      />
    </div>
  );
});
```

(Check `Card` accepts `className`; if not, wrap in a `div` with the border class. Check `EmptyState`'s props in `EmptyStateI.ts`.)

- [ ] **Step 10: Export** `ModsTab`, `AddModsModal`, `ModRow`, `ModpackCard` from `components/index.ts`.

- [ ] **Step 11: Verify** — `pnpm --filter web lint` and `pnpm --filter web build` → clean. **Checkpoint.** No commit.

---

### Task 12: Web — modpack choice in the create modal

**Files:**
- Create: `.../components/ModpackPicker.tsx`
- Modify: `.../hooks/useNewGameServer.ts`, `.../components/NewGameServerModal.tsx`, `.../components/index.ts`

**Interfaces:**
- Consumes: `AddModsModal` (Task 11), `gameServer.mods.sourcesForGame`, `createGameServerSchema.modpack`.
- Produces: `ModpackPicker` (`{ gameId: string; value: ModpackChoiceI | null; onChange: (v: ModpackChoiceI | null) => void }`) where `ModpackChoiceI = { source: ModSourceIdT; ref: string; versionId?: string; name: string }` (add to interfaces).

- [ ] **Step 1: `components/ModpackPicker.tsx`**

```tsx
import { memo, useState } from "react";
import { Boxes, X } from "lucide-react";

import { Button } from "@shared/components/button";

import { AddModsModal } from "@game-server/infrastructure/ui/components/AddModsModal";

import { trpc } from "@lib/trpc";
import { cn } from "@lib/utils";

import type { ModpackPickerPropsI } from "@game-server/infrastructure/ui/interfaces/game-server.interfaces";

/** "Vanilla / Modpack" for games that declare modpacks. */
export const ModpackPicker: React.FC<ModpackPickerPropsI> = memo(function ModpackPicker({
  gameId,
  value,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const sourcesQuery = trpc.gameServer.mods.sourcesForGame.useQuery({ gameId });
  const sources = (sourcesQuery.data ?? []).filter((s) => s.modpacks);
  if (sources.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-text-secondary">Start from</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn("rounded border px-3 py-2 text-left text-sm", !value ? "border-accent" : "border-border")}
        >
          The plain game
          <span className="block text-xs text-text-muted">Pick the server type and version below.</span>
        </button>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn("rounded border px-3 py-2 text-left text-sm", value ? "border-accent" : "border-border")}
        >
          <span className="flex items-center gap-1.5">
            <Boxes className="w-3.5 h-3.5" /> {value ? value.name : "A modpack"}
          </span>
          <span className="block text-xs text-text-muted">
            {value ? "The pack decides the loader and version." : "Search Modrinth or CurseForge."}
          </span>
        </button>
      </div>
      {value && (
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          <X className="w-3.5 h-3.5" /> Clear modpack
        </Button>
      )}
      <AddModsModal
        open={open}
        onClose={() => setOpen(false)}
        sources={sources}
        mode="modpack"
        gameId={gameId}
        onPickModpack={(pick) => {
          onChange(pick);
          setOpen(false);
        }}
      />
    </div>
  );
});
```

Add to interfaces:

```ts
interface ModpackChoiceI {
  source: ModSourceIdT;
  ref: string;
  versionId?: string;
  name: string;
}
interface ModpackPickerPropsI {
  gameId: string;
  value: ModpackChoiceI | null;
  onChange: (value: ModpackChoiceI | null) => void;
}
```

`ModSourceInfoT` comes from `mods.sources`; `sourcesForGame` returns the same shape — if TypeScript complains, type `sources` in `AddModsModalPropsI` as `Array<{ id: ModSourceIdT; search: boolean; install: boolean; reason?: string; modpacks: boolean }>`.

- [ ] **Step 2: Hook state** — in `useNewGameServer.ts` add `const [modpack, setModpack] = useState<ModpackChoiceI | null>(null);`, reset it with the rest of the form when the game changes, and include it in the create payload:

```ts
      ...(modpack ? { modpack: { source: modpack.source, ref: modpack.ref, versionId: modpack.versionId } } : {}),
```
Return `modpack`, `setModpack`, and `modpackHides: modpack ? [spec.mods?.loader?.from, spec.mods?.gameVersion?.from].filter(Boolean) as string[] : []`.

- [ ] **Step 3: Modal** — in `NewGameServerModal.tsx`, in the form step above `GameServerForm`, render `<ModpackPicker gameId={spec.id} value={s.modpack} onChange={s.setModpack} />` when `spec.mods?.modpacks.length`, and pass `hiddenKeys={s.modpackHides}` to `GameServerForm` so the loader/version fields disappear while a pack is chosen. In `GameServerForm` (and its props interface) add `hiddenKeys?: string[]` and skip those variables when rendering.

- [ ] **Step 4: Verify** — `pnpm --filter web lint && pnpm --filter web build`. **Checkpoint.** No commit.

---

### Task 13: Web — Settings → Game mods; audit labels

**Files:**
- Create: `apps/web/src/features/settings/infrastructure/ui/hooks/useGameModKeys.ts`
- Create: `apps/web/src/features/settings/infrastructure/ui/components/GameModsSection.tsx`
- Modify: `.../settings/infrastructure/ui/components/index.ts`, `.../pages/Settings.tsx`
- Modify: `apps/web/src/features/audit/infrastructure/ui/constants/audit.constants.ts`, `.../components/FilterBar.tsx`, `apps/web/src/features/dashboard/infrastructure/ui/constants/dashboard.constants.ts`

- [ ] **Step 1: `hooks/useGameModKeys.ts`**

```ts
import { useState } from "react";

import { trpc } from "@lib/trpc";

type KeyNameT = "curseforge_api_key" | "steam_web_api_key";

/** Admin: the CurseForge / Steam keys mod search and installs use. */
export const useGameModKeys = () => {
  const utils = trpc.useUtils();
  const statusQuery = trpc.settings.modKeys.status.useQuery();
  const [drafts, setDrafts] = useState<Record<KeyNameT, string>>({
    curseforge_api_key: "",
    steam_web_api_key: "",
  });
  const [savedKey, setSavedKey] = useState<KeyNameT | null>(null);

  const setMutation = trpc.settings.modKeys.set.useMutation({
    onSuccess: (_data, vars) => {
      setDrafts((d) => ({ ...d, [vars.key]: "" }));
      setSavedKey(vars.key);
      utils.settings.modKeys.status.invalidate();
      utils.gameServer.mods.invalidate();
    },
  });

  return {
    status: statusQuery.data,
    loading: statusQuery.isLoading,
    drafts,
    setDraft: (key: KeyNameT, value: string) => setDrafts((d) => ({ ...d, [key]: value })),
    save: (key: KeyNameT) => setMutation.mutate({ key, value: drafts[key].trim() }),
    clear: (key: KeyNameT) => setMutation.mutate({ key, value: null }),
    pendingKey: setMutation.isPending ? setMutation.variables?.key ?? null : null,
    errorKey: setMutation.error ? setMutation.variables?.key ?? null : null,
    error: setMutation.error?.message ?? null,
    savedKey,
  };
};
```

- [ ] **Step 2: `components/GameModsSection.tsx`**

```tsx
import { memo } from "react";
import { Puzzle } from "lucide-react";

import { Button } from "@shared/components/button";
import { Input } from "@shared/components/input";

import { SectionCard } from "@settings/infrastructure/ui/components/SectionCard";
import { useGameModKeys } from "@settings/infrastructure/ui/hooks/useGameModKeys";

const KEYS = [
  {
    key: "curseforge_api_key" as const,
    label: "CurseForge API key",
    help: "Needed to search and install CurseForge mods and modpacks. Get one at console.curseforge.com.",
  },
  {
    key: "steam_web_api_key" as const,
    label: "Steam Web API key",
    help: "Only needed to search the Workshop; pasting a Workshop link works without it. steamcommunity.com/dev/apikey.",
  },
];

export const GameModsSection: React.FC = memo(function GameModsSection() {
  const k = useGameModKeys();

  return (
    <SectionCard icon={Puzzle} title="Game mods">
      <div className="space-y-5">
        {KEYS.map(({ key, label, help }) => {
          const status = k.status?.[key];
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{label}</p>
                <span className="text-xs text-text-muted">
                  {status?.configured ? `Configured · ••••${status.last4}` : "Not set"}
                </span>
              </div>
              <p className="text-xs text-text-muted">{help}</p>
              <div className="flex gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  value={k.drafts[key]}
                  onChange={(e) => k.setDraft(key, e.target.value)}
                  placeholder={status?.configured ? "Replace the key" : "Paste the key"}
                  aria-label={label}
                />
                <Button
                  size="sm"
                  onClick={() => k.save(key)}
                  disabled={k.drafts[key].trim().length < 8 || k.pendingKey === key}
                >
                  Save
                </Button>
                {status?.configured && (
                  <Button size="sm" variant="ghost" onClick={() => k.clear(key)} disabled={k.pendingKey === key}>
                    Clear
                  </Button>
                )}
              </div>
              {k.errorKey === key && <p className="text-xs text-danger">{k.error}</p>}
              {k.savedKey === key && !k.error && <p className="text-xs text-green-400">Saved</p>}
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
});
```

Export from `components/index.ts`; in `Settings.tsx` add, after the GitHub App block:

```tsx
        {isAdmin && (
          <div className="col-span-1 md:col-span-2">
            <GameModsSection />
          </div>
        )}
```

- [ ] **Step 3: Audit labels** — add entries for `settings.update`, `game_server.mod_add`, `game_server.mod_update`, `game_server.mod_remove`, `game_server.modpack_set`, `game_server.mods_apply` in `audit.constants.ts` (follow the existing `game_server.*` entries' shape) and the `settings` resource type in `FilterBar.tsx`; in `dashboard.constants.ts` add:

```ts
  "game_server.mods_apply": {
    label: "applied mods on",
    icon: Gamepad2,
    color: "text-accent",
  },
  "game_server.mod_add": {
    label: "added a mod to",
    icon: Gamepad2,
    color: "text-green-400",
  },
```

- [ ] **Step 4: Verify** — `pnpm --filter web lint && pnpm --filter web build`. **Checkpoint.** No commit.

---

### Task 14: Templates repo — Minecraft mods block, tModLoader game

**Files (in `D:\Apps\projects\deploykit-templates`):**
- Modify: `games/minecraft-java/game.json`
- Create: `games/terraria-tmodloader/game.json`, `games/terraria-tmodloader/logo.svg`
- Regenerate: `schema/game.schema.json` (Task 1 step 6 already did; re-run), `games/index.json` (`npm run build:index` or the repo's script name)

- [ ] **Step 1: Minecraft** — bump `"version": "2"`; add a `NEOFORGE`-free mods block (adjust after Task 0 findings):

```json
  "mods": {
    "sources": [
      { "source": "modrinth", "env": "MODRINTH_PROJECTS" },
      { "source": "curseforge", "env": "CURSEFORGE_FILES", "apiKeyEnv": "CF_API_KEY" }
    ],
    "loader": {
      "from": "server_type",
      "map": {
        "FABRIC": { "loaders": ["fabric"], "kind": "mod" },
        "FORGE": { "loaders": ["forge"], "kind": "mod" },
        "PAPER": { "loaders": ["paper", "bukkit", "spigot"], "kind": "plugin" }
      }
    },
    "gameVersion": { "from": "mc_version", "aliases": { "LATEST": "release", "SNAPSHOT": "any" } },
    "modpacks": [
      {
        "source": "modrinth",
        "env": {
          "TYPE": "MODRINTH",
          "MODRINTH_MODPACK": "${dk_modpack_project}",
          "MODRINTH_VERSION": "${dk_modpack_version}",
          "VERSION": "${dk_modpack_game_version}"
        }
      },
      {
        "source": "curseforge",
        "env": {
          "TYPE": "AUTO_CURSEFORGE",
          "CF_SLUG": "${dk_modpack_slug}",
          "CF_FILE_ID": "${dk_modpack_version}",
          "VERSION": "${dk_modpack_game_version}"
        }
      }
    ],
    "directories": [
      { "volume": "data", "path": "mods" },
      { "volume": "data", "path": "plugins" }
    ]
  }
```

Update `notes`: replace the "Plugins … upload them from the Files tab" bullet with "Install mods (Fabric/Forge) and plugins (Paper) from the **Mods** tab, or start the server from a Modrinth/CurseForge modpack. Files you upload to `mods/` or `plugins/` by hand still work." Update `description` to mention mods and modpacks.

- [ ] **Step 2: tModLoader** — `games/terraria-tmodloader/game.json` (pin the tag found in Task 0; paths/ownership per Task 0):

```json
{
  "$schema": "../../schema/game.schema.json",
  "id": "terraria-tmodloader",
  "name": "Terraria (tModLoader)",
  "version": "1",
  "description": "Modded Terraria with tModLoader. Install mods from the Steam Workshop in one click.",
  "logo": "logo.svg",
  "links": {
    "github": "https://github.com/JACOBSMILE/tmodloader1.4",
    "docs": "https://github.com/tModLoader/tModLoader/wiki"
  },
  "tags": ["terraria", "tmodloader", "mods", "sandbox", "co-op"],
  "category": "sandbox",
  "players": { "min": 1, "max": 255 },
  "image": "jacobsmile/tmodloader1.4:<TAG FROM TASK 0>",
  "ports": [
    { "name": "game", "protocol": "tcp", "container": 7777, "defaultHost": 7777, "description": "Players connect here" }
  ],
  "variables": [
    { "key": "world_name", "label": "World name", "description": "Letters, digits, - and _.", "type": "string", "default": "World", "editable": false, "pattern": "^[A-Za-z0-9_-]{1,40}$", "maxLength": 40, "group": "World" },
    { "key": "world_size", "label": "World size", "type": "select", "default": "2", "editable": false, "options": [ { "label": "Small", "value": "1" }, { "label": "Medium", "value": "2" }, { "label": "Large", "value": "3" } ], "group": "World" },
    { "key": "difficulty", "label": "Difficulty", "description": "Only used when the world is first created.", "type": "select", "default": "0", "editable": false, "options": [ { "label": "Classic", "value": "0" }, { "label": "Expert", "value": "1" }, { "label": "Master", "value": "2" }, { "label": "Journey", "value": "3" } ], "group": "World" },
    { "key": "seed", "label": "World seed", "type": "string", "editable": false, "maxLength": 64, "group": "World" },
    { "key": "max_players", "label": "Max players", "type": "number", "default": 8, "min": 1, "max": 255, "group": "Gameplay" },
    { "key": "motd", "label": "Message of the day", "type": "string", "default": "A tModLoader server on DeployKit", "maxLength": 100, "group": "Gameplay" },
    { "key": "password", "label": "Server password", "description": "Leave blank for no password.", "type": "string", "secret": true, "maxLength": 64, "group": "Network" }
  ],
  "env": {
    "TMOD_WORLDNAME": "${world_name}",
    "TMOD_WORLDSIZE": "${world_size}",
    "TMOD_DIFFICULTY": "${difficulty}",
    "TMOD_WORLDSEED": "${seed}",
    "TMOD_MAXPLAYERS": "${max_players}",
    "TMOD_MOTD": "${motd}",
    "TMOD_PASS": "${password}",
    "TMOD_PORT": "7777",
    "TMOD_AUTOSAVE_INTERVAL": "10"
  },
  "volumes": [
    { "name": "data", "path": "/data", "primary": true, "backup": { "include": ["tModLoader/Worlds", "tModLoader/ModConfigs"] } }
  ],
  "console": { "method": "exec", "command": ["inject"] },
  "stop": { "timeoutSec": 60, "command": "exit" },
  "readyPattern": "Server started",
  "backup": { "preCommands": ["save"], "settleSeconds": 5 },
  "configFiles": [
    { "volume": "data", "path": "tModLoader/Mods/enabled.json", "label": "Enabled mods", "language": "json" }
  ],
  "resources": { "memoryMb": { "min": 2048, "recommended": 4096 } },
  "mods": {
    "sources": [
      { "source": "steam-workshop", "appId": 1281930, "env": "TMOD_AUTODOWNLOAD", "enabledEnv": "TMOD_ENABLEDMODS" }
    ],
    "directories": [ { "volume": "data", "path": "tModLoader/Mods" } ]
  },
  "notes": "Runs [tModLoader](https://github.com/tModLoader/tModLoader) via [JACOBSMILE/tmodloader1.4](https://github.com/JACOBSMILE/tmodloader1.4).\n\n- Add mods from the **Mods** tab: paste a Steam Workshop link, or search once an admin adds a Steam Web API key in Settings. Workshop items always download their latest upload on restart.\n- Players need the same mods: tModLoader offers to download them on join.\n- Disabling a mod a world depends on can break that world — a safety backup is taken first.\n- World name, size, difficulty and seed only apply when the world is created."
}
```

If Task 0 shows an empty `TMOD_PASS` means "docker" (the image default) rather than no password, change the password variable to `"default": "N/A"`-handling: set env `"TMOD_PASS": "${password}"` only when non-empty is not expressible — instead document "Leave as N/A for no password" with `"default": "N/A"`.

Logo: a simple 64×64 SVG in the style of the other games' logos (copy `games/terraria/logo.svg` and change the accent colour).

- [ ] **Step 3: Regenerate and validate**

```bash
cd D:/Apps/projects/deploykit
pnpm --filter @deploykit/shared schema:emit -- --schema game --out ../../../deploykit-templates/schema/game.schema.json
cd ../deploykit-templates && npm run build:index && npm test
```
Expected: "… and 5 game(s) valid." Inspect `git diff games/index.json`.

- [ ] **Step 4: Checkpoint.** No commit in either repo.

---

### Task 15: End-to-end verification, docs, cleanup

**Files:** `CLAUDE.md`; scratch scripts.

- [ ] **Step 1: Full checks**

```bash
pnpm --filter @deploykit/shared exec tsc --noEmit
pnpm --filter api exec tsc --noEmit
pnpm --filter api test            # expect only the 4 webhook.test.ts DB failures
pnpm --filter web lint && pnpm --filter web build
```

- [ ] **Step 2: Real Minecraft** — local API + web against throwaway Postgres/Redis (same setup as the game-server e2e), registry seeded in Redis with the new `minecraft-java` v2 spec (the SSRF guard blocks a local registry; seed `games:index` / `games:def:minecraft-java` as before):
  1. Create a Fabric 1.21.4 server (Java 21 tag). Add Lithium from the Mods tab search → pending → Apply → logs show the Modrinth download → `docker exec dk-gs-<name> ls /data/mods` has it.
  2. Remove it → Apply → safety backup appears in Backups (`pre-mods`) → jar gone.
  3. Set server type to Vanilla in Settings → Mods tab shows the "switch server type" message, Add disabled.
  4. Create a second server from a small Modrinth server modpack → it boots with the pack's loader/version.
  5. If a CurseForge key is available: save it in Settings (validation passes), add JEI; otherwise confirm the tab says the key is needed and record "CurseForge verified with mocks only".

- [ ] **Step 3: Real tModLoader** — create from the new definition, add a Workshop mod by URL, Apply, confirm `enabled.json` lists it, console `say hi` via `exec` appears in the log, backup works (pre-command `save`), stop is clean.

- [ ] **Step 4: Playwright pass** — Mods tab (search, add, toggle, update check, apply banner), modpack picker in the create modal, Settings → Game mods (save/clear, last4 display), no console errors.

- [ ] **Step 5: Docs** — append to the "### Game servers" section of `CLAUDE.md`:

```markdown
- **Mods.** A game's optional `mods` block names its sources (Modrinth,
  CurseForge, Steam Workshop) and the env vars its image reads them from.
  DeployKit keeps the list (`game_server_mods`, pinned versions) and the
  modpack (`game_servers.modpack`); `services/game-mods-env.ts` renders them,
  and provisioning merges that env **after** the game's own, so a modpack's
  `TYPE` wins. The image does the downloading — never fetch a mod into a
  volume from the API. `applied_mod_env` (no API keys in it) is what was last
  provisioned; a difference is "changes pending". Applying runs on the
  `game-backup` queue as `apply-mods`, after a forced safety backup when it
  removes mods or swaps the modpack (`isDestructiveChange`).
- **Catalogue calls** go through `services/mod-sources/` to fixed hosts only;
  pasted links are parsed for ids, never fetched. The CurseForge and Steam
  keys live encrypted in `instance_settings` (Settings → Game mods, admin
  only) and are never returned. Mutating mods is `operatorProcedure` **and**
  project `canOperate` — a mod is code.
```

- [ ] **Step 6: Cleanup** — remove `dk-gs-*` test containers/volumes, throwaway Postgres/Redis, `.playwright-mcp`, test backups under `D:\var\backups\deploykit\@games`. `git status` in both repos shows only intended files.

- [ ] **Step 7: Report** to the user (Spanish): what was built, evidence, what was verified only with mocks (CurseForge if no key), caveats. No commit.

---

## Spike results

(Filled in during Task 0.)

1. itzg `MODRINTH_PROJECTS=<projectId>:<versionId>` installs the pinned jar (Lithium on Fabric 1.21.4). Re-creating with `MODRINTH_PROJECTS=` (set, empty) logs "Removing old file" and deletes it. ✅ always emitting the var is correct.
2. `TYPE=MODRINTH` + `MODRINTH_MODPACK=<id>` + `MODRINTH_VERSION=<versionId>` + `VERSION=<pack mc version>` installs the pack, **and** `MODRINTH_PROJECTS` extras are installed alongside (Chunky). The server then crashed because the Java tag (25) does not fit a 1.21.1 pack: the Java variable must match the pack's Minecraft version → UI hint needed.
3. `CURSEFORGE_FILES=jei` with the image's built-in key reaches CurseForge but "Unable to find match in latest files" unpinned; DeployKit always pins `<projectId>:<fileId>`. No own key available → CurseForge verified with mocks only.
4. `jacobsmile/tmodloader1.4` (every tag checked back to v2026.05.3.0, Ubuntu 26.04) **crashes at start: libicu missing** ("Couldn't find a valid ICU package"); `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` does not help (tML needs en-US). With ICU installed by hand: Workshop download by id works without a key, `TMOD_ENABLEDMODS` writes `enabled.json` with internal names, `docker exec <c> inject "<cmd>"` works without a TTY (tmux send-keys, one argv), SIGTERM (`docker stop`) says the shutdown message and "Saving before exit" in 4 s, data under `/data/tModLoader/{Worlds,Mods}` owned by root.

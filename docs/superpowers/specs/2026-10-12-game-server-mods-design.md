# Game server mods & modpacks — design

Date: 2026-10-12 · Branch: `feat/game-servers` (builds on the uncommitted game server work)

## Goal

Let a community install mods and modpacks on its game servers from inside
DeployKit — search a catalogue, click install, see what is installed, turn
mods off, update them, start a server from a modpack — instead of uploading
jars through the Files tab by hand.

v1 sources (all three chosen by the user):

| Source | Game | Search | Install |
|---|---|---|---|
| Modrinth | Minecraft Java | public API, no key | `MODRINTH_PROJECTS`, modpacks `TYPE=MODRINTH` |
| CurseForge | Minecraft Java | needs instance API key | `CURSEFORGE_FILES`, modpacks `TYPE=AUTO_CURSEFORGE` |
| Steam Workshop | Terraria (tModLoader) | needs Steam Web API key; add-by-URL/ID works without | `TMOD_AUTODOWNLOAD` + `TMOD_ENABLEDMODS` |

API keys are configured by an admin in **Settings → Game mods**, stored
encrypted in the database, changeable without a restart.

## Approach: DeployKit owns the list, the image installs

DeployKit stores *which* mods a server wants and the exact version of each.
On "Apply" it renders that list into the env vars the game image already
understands and recreates the container. The image downloads, checks
loader/version compatibility, resolves Modrinth dependencies and deletes
mods that left the list.

Rejected: DeployKit downloading files into the volume itself. Workshop
content is only obtainable through steamcmd, some CurseForge projects forbid
third-party distribution, and dependency resolution would have to be
re-implemented. The image-side tools already do all of it.

Consequence: mod changes take effect on a restart (they always need one), and
download failures surface in the server's logs/console, not as an API error.
The UI says so.

## 1. Contract — `game.json`

`gameSpecSchema` gains an optional `mods` block and a new console method.

```jsonc
"mods": {
  "sources": [
    { "source": "modrinth",   "env": "MODRINTH_PROJECTS" },
    { "source": "curseforge", "env": "CURSEFORGE_FILES", "apiKeyEnv": "CF_API_KEY" }
    // tModLoader: { "source": "steam-workshop", "appId": 1281930,
    //               "env": "TMOD_AUTODOWNLOAD", "enabledEnv": "TMOD_ENABLEDMODS" }
  ],
  // Compatibility filter for search and version resolution
  "loader": {
    "from": "server_type",                       // a select variable
    "map": { "FABRIC": "fabric", "FORGE": "forge", "PAPER": "paper" },
    "kinds": { "fabric": "mod", "forge": "mod", "paper": "plugin" }
  },
  "gameVersion": { "from": "mc_version", "latest": ["LATEST", "SNAPSHOT"] },
  "modpacks": [
    { "source": "modrinth",
      "env": { "TYPE": "MODRINTH", "MODRINTH_MODPACK": "${dk_modpack_project}",
               "MODRINTH_VERSION": "${dk_modpack_version}" } },
    { "source": "curseforge",
      "env": { "TYPE": "AUTO_CURSEFORGE", "CF_SLUG": "${dk_modpack_slug}",
               "CF_FILE_ID": "${dk_modpack_version}" } }
  ],
  // Folders listed as "manual" mods (files uploaded through the Files tab)
  "directories": [ { "volume": "data", "path": "mods" }, { "volume": "data", "path": "plugins" } ]
}
```

Rules enforced by `superRefine`:
- `sources[].source` unique; `steam-workshop` requires `appId`; `apiKeyEnv` only for `curseforge`.
- `loader.from` / `gameVersion.from` must be declared variables (`loader.from` a select whose map keys are option values).
- A source/modpack whose game has a loader filter but a selected loader not in `map` (e.g. `VANILLA`) → mods unavailable with that setting (UI explains, no error).
- `modpacks[].source` must also be in `sources`.
- `modpacks[].env` may reference the new built-ins `${dk_modpack_project}`, `${dk_modpack_slug}`, `${dk_modpack_version}` — valid **only** inside `modpacks[].env`.
- `directories[].volume` must be a declared volume.
- `env` names in `sources` must not collide with keys in the top-level `env`.

New console method: `{ "method": "exec", "command": ["inject"] }` — each
console command runs as `docker exec <container> inject "<command>"` (argv,
no shell). Satisfies `needsConsole` like `stdin`/`rcon`.

Entry rendering (fixed per source, not declared):
- modrinth: `<projectId>:<versionId>` (version ID pins and skips itzg's compat check, which we already did)
- curseforge: `<projectId>:<fileId>`
- steam-workshop: `<workshopId>` (Workshop has no version pinning; see §3)

## 2. Data — migration `0027_add_game_server_mods.sql`

Journal: idx 27, `when` 1789934427000. All statements idempotent.

- **`instance_settings`** — `key varchar(100) PK`, `value text` (AES-GCM via
  `lib/encryption`), `updated_by uuid → users SET NULL`, `updated_at`.
  Keys used: `curseforge_api_key`, `steam_web_api_key`.
- **`game_server_mods`** — `id`, `game_server_id → game_servers CASCADE`,
  `source` (CHECK modrinth|curseforge|steam-workshop), `project_id varchar(100)`,
  `slug`, `name`, `icon_url`, `kind` (mod|plugin), `version_id varchar(100) NULL`,
  `version_label`, `enabled bool default true`, `added_by → users SET NULL`,
  `created_at`, `updated_at`. Unique `(game_server_id, source, project_id)`.
- **`game_servers.modpack jsonb NULL`** — `{ source, projectId, slug, name,
  iconUrl, versionId, versionLabel, gameVersion, loader }`.
- **`game_servers.applied_mod_env jsonb NULL`** — the mod-related env rendered
  at the last provision. "Pending changes" = render(now) ≠ applied snapshot;
  no dirty flag to keep in sync.

## 3. Backend

**`services/instance-settings.ts`** — `getSetting(key)` (decrypted, cached
in-process 60 s, invalidated on write), `setSetting(key, value|null, userId)`,
`settingStatus(key)` → `{ configured, last4 }`.

**`services/mod-sources/`** — one adapter per source behind a common interface:

```ts
interface ModSourceI {
  id: "modrinth" | "curseforge" | "steam-workshop";
  available(): Promise<{ search: boolean; install: boolean; reason?: string }>;
  search(q: ModSearchQueryI): Promise<ModSearchResultI>;     // paged
  project(projectId: string): Promise<ModProjectI>;
  versions(projectId: string, f: CompatFilterI): Promise<ModVersionI[]>;
  parseUrl(input: string): { projectRef: string } | null;     // never fetches the URL
}
```

- **modrinth**: `api.modrinth.com/v2`, `User-Agent: deploykit/<version> (github.com/deploykithq/deploykit)`.
  Facets: `categories:<loader>`, `versions:<mcVersion>`, `project_type:mod|plugin|modpack`,
  `server_side:required|optional`. `LATEST`/`SNAPSHOT` resolved through
  `/v2/tag/game_version` (cached 1 h).
- **curseforge**: `api.curseforge.com/v1`, `x-api-key` from settings, game 432,
  classes mods 6 / modpacks 4471 / Bukkit plugins 5. Projects with
  `allowModDistribution === false` are shown but not installable (itzg cannot
  download them).
- **steam-workshop**: details through `ISteamRemoteStorage/GetPublishedFileDetails`
  (no key); search through `IPublishedFileService/QueryFiles` only when a key
  is set. Verifies `consumer_app_id === appId`. "Version" = `time_updated`
  (label = date); the Workshop always serves the latest file, so the UI marks
  Steam mods as "always latest" and "update available" only means "a newer
  upload exists — restart to get it".
- All calls: fixed hosts only (user input is parsed for IDs, never fetched),
  10 s timeout, responses cached in Redis 5 min (`modsrc:<source>:<hash>`),
  search rate-limited 30/min per user via `isRateLimited`.

**`services/game-mods.ts`**
- `compatFilter(row)` — loader + game version from the server's values (or from
  its modpack when one is set).
- `addMod(row, {source, projectRef, versionId?})` — resolves the project,
  picks the newest compatible version unless one is given, inserts. Refuses
  incompatible/undistributable/wrong-app projects with a clear message.
- `updateMod` (version change / enable toggle), `removeMod`, `checkUpdates(row)`
  (newest compatible version per mod vs pinned).
- `renderModEnv(spec, row, mods, keys)` → `Record<string,string>` — pure. The
  source env vars (comma-joined entries, enabled only; for Steam all IDs in
  `env`, enabled in `enabledEnv`), the modpack env with `dk_modpack_*`
  substituted, `apiKeyEnv` from settings when configured. Always emits every
  declared source env var (an empty string tells itzg to remove what it
  installed).
- `listManualMods(row)` — file names in `mods.directories` via the existing
  files helper, minus files itzg tracks in its manifests.
- `setModpack(row, pack|null)` — validates, stores; the router queues a
  safety backup first (same `game-backup` queue, concurrency 1, so it runs
  before the apply).
- `pendingModChanges(row)` — `render(now) !== applied_mod_env`.

**`services/game-server.ts`**
- `buildContainerSpec` takes the rendered mod env and merges it **after**
  `spec.env` (modpack env wins over `TYPE`/`VERSION`). Secrets from it
  (`CF_API_KEY`) go through dockerode `Env` like other secrets.
- `provisionGameContainer` stores `applied_mod_env` after a successful create.
- `createGameServer` accepts an optional `modpack` and validates it before insert.
- `applyMods(row, { safetyBackup })` = optional safety backup → recreate.

**`services/game-console.ts`** — `exec` method: `container.exec({ Cmd: [...command, cmd] })`, demuxed output echoed to the log room like RCON replies.

**Router `gameServer.mods.*`** (inside `routers/game-server.ts`, resolve role first):

| Procedure | Builder | Project check |
|---|---|---|
| `sources` (which sources are usable for this server + why not) | protected | `canView` |
| `search`, `project`, `versions` | protected | `canView` |
| `list` (managed + manual + modpack + pending flag) | protected | `canView` |
| `checkUpdates` | protected | `canView` |
| `add`, `update`, `remove`, `setModpack`, `apply` | **operatorProcedure** | `canOperate` |

A mod is code running on the host — same level as a file upload or a console
command. `create` with a `modpack` additionally requires the global operator
role.

**Router `settings.*`** (new, `routers/settings.ts`): `modKeys.status`
(admin → `{curseforge:{configured,last4}, steam:{…}}`), `modKeys.set`
(admin; validates the key against the provider before saving; `null` clears).
Values are never returned.

**Audit**: `game_server.mod_add`, `mod_remove`, `mod_update`, `modpack_set`,
`mods_apply`, `settings.update` (the setting key, never its value).

## 4. Web

All inside `@game-server` except the settings section.

- **Mods tab** (shown when `spec.mods` exists):
  - Modpack card (icon, name, version, "Change", "Update to …", "Remove").
  - Installed list: icon, name, version, source badge, enabled switch, remove,
    "update available" chip; manual files listed below as read-only "Manual".
  - Banner when pending: "Changes pending — Apply & restart" with a "take a
    safety backup first" checkbox (default on when any mod was removed or the
    modpack changed).
  - "Add mods" drawer: tabs per available source (disabled tab with reason
    when a key is missing), search pre-filtered by loader/version, infinite
    paging, "Paste a link or ID" field, version picker per result.
  - Read-only for members without `canOperate` / global operator.
- **New server modal**: for games with `mods.modpacks`, a "Vanilla / Modpack"
  choice; Modpack opens the same search restricted to modpacks; version/loader
  fields are then hidden (the pack decides).
- **Settings → Game mods** (admin only): two key fields with status
  ("configured · ••••a1b2"), save validates, clear.

## 5. Templates repo

- `minecraft-java`: add the `mods` block above (Modrinth + CurseForge, mods +
  plugins, both modpack kinds), bump `version` to `2`, notes updated.
- New `terraria-tmodloader`: `jacobsmile/tmodloader1.4` pinned tag, port
  7777/tcp, single `data` volume at `/data` (backup include
  `tModLoader/Worlds`, `tModLoader/ModConfigs`), `TMOD_*` variables (world
  name/size/seed/difficulty, max players, password, MOTD), console `exec`
  `["inject"]`, `stop.command` `exit`, `mods.sources` Steam Workshop app 1281930.
- Re-emit `schema/game.schema.json`; `npm test` green.

## 6. Verification

- Unit: schema refinements; each adapter with mocked `fetch` (search facets,
  LATEST resolution, undistributable CF project, wrong Steam app,
  `parseUrl`); `renderModEnv` (enabled/disabled, empty lists, modpack
  precedence, key injection); pending detection; console `exec`.
- Migration replay from 0000 and re-run idempotent.
- e2e script against throwaway Postgres/Redis: RBAC (viewer-global project
  operator gets FORBIDDEN on add/apply; non-member NOT_FOUND), settings keys
  never returned.
- Real containers:
  1. itzg Fabric + a Modrinth mod (e.g. Lithium): appears in `mods/`; remove → apply → gone.
  2. Small Modrinth modpack from creation.
  3. tModLoader + one Workshop mod by URL; console `exec` works.
  4. CurseForge with a real key if provided, else mocked only (stated in the report).
- Playwright pass over the Mods tab, modpack creation and the settings section.

**Early risks to check first**
- Does itzg honour `MODRINTH_PROJECTS` / `CURSEFORGE_FILES` alongside a
  modpack? If not, extra mods are disabled while a pack is active.
- Exact `inject` behaviour and stop/save semantics of the tModLoader image.

## Refinements made while planning

- `loader.map` values are `{ loaders: string[], kind: "mod" | "plugin" }`
  (Paper plugins match `paper`, `bukkit`, `spigot`); `gameVersion` uses
  `aliases: { LATEST: "release", SNAPSHOT: "any" }`.
- Modpack env may also use `${dk_modpack_game_version}` and
  `${dk_modpack_loader}`, so `VERSION` follows the pack.
- No `mods_dirty` column: "pending" is `render(now) ≠ applied_mod_env`.
- Mod changes are applied by an `apply-mods` job on the `game-backup` queue;
  a change that removes mods or swaps the modpack forces a safety backup
  (`isDestructiveChange`), whatever the client asked.
- "Manual" mods become an **On disk** list of the files in `mods.directories`:
  file names cannot be reliably matched to catalogue projects, so DeployKit
  does not guess which ones it installed.
- Steam Workshop items keep downloading while disabled (`TMOD_AUTODOWNLOAD`
  lists all, `TMOD_ENABLEDMODS` only the enabled ones).

## Out of scope

Scheduled auto-updates, Valheim (Thunderstore/BepInEx) and CS2
(Metamod/CounterStrikeSharp) mods, editing mod configs beyond the Files tab,
export/import of mod lists.

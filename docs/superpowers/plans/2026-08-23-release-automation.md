# Release Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada merge a `master` alimente un PR de release generado por un bot, y que mergear ese PR publique tag + GitHub Release con un CHANGELOG derivado de los commits.

**Architecture:** `googleapis/release-please-action@v4` corre en push a `master`. Lee `release-please-config.json` (política) y `.release-please-manifest.json` (estado), y mantiene abierto un PR `chore(master): release X.Y.Z`. Un componente único en la raíz propaga una sola versión a los cuatro `package.json` y a la constante que la web muestra en Ajustes. Un workflow aparte valida que el título de cada PR sea Conventional Commit, porque con squash-merge ese título *es* el commit que el bot leerá.

**Tech Stack:** GitHub Actions, `googleapis/release-please-action@v4`, `amannn/action-semantic-pull-request@v5`, Conventional Commits, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-23-release-automation-design.md`

## Global Constraints

- Versión actual en todo el monorepo: **`0.1.0`**. La primera release esperada es **`0.2.0`**.
- `bootstrap-sha` exacto: **`0f37e682d8c9dd3d13eb23ea25b9eee5922b2eb8`** (commit inicial `v0.1.0`).
- Rama por defecto: **`master`** (no `main`). Todo `on: push: branches:` y todo texto generado debe decir `master`.
- Estrategia semver: `bump-minor-pre-major: true`, `bump-patch-for-minor-pre-major: false`.
- Tags **sin** prefijo de componente: `v0.2.0`, no `deploykit-v0.2.0` → requiere `include-component-in-tag: false`.
- Repositorio: `deploykithq/deploykit`.
- **No se publica ninguna imagen Docker** en este trabajo (decisión explícita del spec).
- El árbol de trabajo tiene una refactorización de frontend en curso **sin relacionar** con esto. No añadir esos archivos a ningún commit ni intentar arreglarlos.
- **Los commits se dejan preparados pero NO se ejecutan hasta que el usuario lo pida** (preferencia permanente del usuario). Los pasos "Commit" quedan documentados para cuando dé la orden.
- **Huella en el repositorio: exactamente 4 archivos nuevos y 3 modificados.** Los scripts de verificación son desechables y viven en el scratchpad, no en el repo — el alcance aprobado no incluye añadir `scripts/`.
- Entorno verificado: no hay parser YAML en `node_modules` y `npx --package=yaml` no resuelve el módulo. **PyYAML 6.0.3 sí está disponible** (`python -c "import yaml"`), así que la verificación de YAML se hace con Python.

**Scratchpad de esta sesión** (`$SCRATCH` en los comandos):
`C:\Users\shakar\AppData\Local\Temp\claude\d--Apps-projects-deploykit\e4246ef6-10fb-47e7-8c65-a2b6a341c396\scratchpad`

---

### Task 1: Configuración de release-please y propagación de versión

Define la política de release y garantiza que un bump alcance a los cuatro paquetes y a la UI. Un revisor puede aceptar o rechazar esta tarea sin ver todavía ningún workflow.

**Files:**
- Create: `release-please-config.json`
- Create: `.release-please-manifest.json`
- Modify: `apps/web/src/features/settings/infrastructure/ui/constants/settings.constants.ts:2`
- Test: `$SCRATCH/check-release-config.mjs` (verificador desechable, fuera del repo)

**Interfaces:**
- Consumes: nada (primera tarea).
- Produces: `release-please-config.json` con un único componente en la clave `"."`, y `.release-please-manifest.json` con la clave `"."` → `"0.1.0"`. La Task 2 pasa ambas rutas a la acción vía `config-file` / `manifest-file`.

- [ ] **Step 1: Escribir el verificador que falla**

Crear `$SCRATCH/check-release-config.mjs`. Se ejecuta desde la raíz del repo. Comprueba las cuatro cosas que pueden romperse en silencio: que los JSON parsean, que solo se usan claves reales del schema de release-please, que cada `extra-files` apunta a un archivo existente, y que la versión declarada aparece de verdad en la posición indicada de cada archivo.

```js
#!/usr/bin/env node
// Verifica release-please-config.json / .release-please-manifest.json sin llamar a la red.
// Uso, desde la raíz del repo: node "$SCRATCH/check-release-config.mjs"
import { readFileSync, existsSync } from "node:fs";

const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

// Claves aceptadas por el schema oficial de release-please (schemas/config.json).
const ROOT_KEYS = new Set([
  "$schema", "bootstrap-sha", "last-release-sha", "packages", "plugins",
  "separate-pull-requests", "group-pull-request-title-pattern", "tag-separator",
  "always-link-local", "sequential-calls",
]);
const PKG_KEYS = new Set([
  "release-type", "package-name", "component", "changelog-path", "changelog-sections",
  "changelog-host", "changelog-type", "bump-minor-pre-major", "bump-patch-for-minor-pre-major",
  "versioning", "prerelease-type", "prerelease", "draft", "draft-pull-request",
  "include-component-in-tag", "include-v-in-tag", "include-v-in-release-name",
  "extra-files", "exclude-paths", "skip-github-release", "skip-changelog",
  "pull-request-title-pattern", "pull-request-header", "pull-request-footer",
  "extra-label", "always-update", "initial-version", "version-file", "release-as",
  "tag-separator", "date-format", "component-no-space", "force-tag-creation",
]);

const config = JSON.parse(readFileSync("release-please-config.json", "utf8"));
const manifest = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"));

for (const k of Object.keys(config)) check(ROOT_KEYS.has(k), `clave raíz desconocida: ${k}`);

const pkg = config.packages?.["."];
check(!!pkg, 'falta el componente raíz packages["."]');
for (const k of Object.keys(pkg ?? {})) check(PKG_KEYS.has(k), `clave de paquete desconocida: ${k}`);

check(pkg?.["include-component-in-tag"] === false, "include-component-in-tag debe ser false para tags vX.Y.Z");
check(pkg?.["bump-minor-pre-major"] === true, "bump-minor-pre-major debe ser true");
check(pkg?.["bump-patch-for-minor-pre-major"] === false, "bump-patch-for-minor-pre-major debe ser false");
check(/^[0-9a-f]{40}$/.test(config["bootstrap-sha"] ?? ""), "bootstrap-sha debe ser un SHA completo de 40 chars");

const version = manifest["."];
check(!!version, 'el manifest debe tener la clave "."');

// Cada extra-file existe y contiene la versión donde se dice que está.
for (const f of pkg?.["extra-files"] ?? []) {
  const path = typeof f === "string" ? f : f.path;
  check(existsSync(path), `extra-file inexistente: ${path}`);
  if (!existsSync(path)) continue;
  const raw = readFileSync(path, "utf8");
  if (f.type === "json") {
    check(f.jsonpath === "$.version", `jsonpath inesperado en ${path}: ${f.jsonpath}`);
    check(JSON.parse(raw).version === version, `${path} tiene version distinta de ${version}`);
  } else if (f.type === "generic") {
    const line = raw.split("\n").find((l) => l.includes("x-release-please-version"));
    check(!!line, `${path} no tiene la anotación x-release-please-version`);
    check(!!line?.includes(version), `la línea anotada de ${path} no contiene ${version}`);
  }
}

// La raíz la bumpea el propio release-type node, no extra-files.
check(JSON.parse(readFileSync("package.json", "utf8")).version === version,
  `package.json raíz debe estar en ${version}`);

if (errors.length) { console.error("FAIL\n" + errors.map((e) => " - " + e).join("\n")); process.exit(1); }
console.log(`OK — release-please configurado, versión ${version}`);
```

- [ ] **Step 2: Ejecutarlo para verificar que falla**

Run: `node "$SCRATCH/check-release-config.mjs"`
Expected: FAIL — `ENOENT: no such file or directory, open 'release-please-config.json'`

- [ ] **Step 3: Escribir `.release-please-manifest.json`**

```json
{
  ".": "0.1.0"
}
```

- [ ] **Step 4: Escribir `release-please-config.json`**

`bootstrap-sha` acota el escaneo al historial posterior al commit inicial. `changelog-sections` sustituye por completo a las secciones por defecto, así que los tipos ocultos hay que listarlos explícitamente.

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "bootstrap-sha": "0f37e682d8c9dd3d13eb23ea25b9eee5922b2eb8",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "deploykit",
      "changelog-path": "CHANGELOG.md",
      "include-component-in-tag": false,
      "bump-minor-pre-major": true,
      "bump-patch-for-minor-pre-major": false,
      "changelog-sections": [
        { "type": "feat", "section": "Features" },
        { "type": "fix", "section": "Bug Fixes" },
        { "type": "perf", "section": "Performance Improvements" },
        { "type": "refactor", "section": "Refactors" },
        { "type": "docs", "section": "Documentation" },
        { "type": "build", "section": "Build System", "hidden": true },
        { "type": "ci", "section": "Continuous Integration", "hidden": true },
        { "type": "chore", "section": "Miscellaneous", "hidden": true },
        { "type": "test", "section": "Tests", "hidden": true },
        { "type": "style", "section": "Styles", "hidden": true }
      ],
      "extra-files": [
        { "type": "json", "path": "apps/api/package.json", "jsonpath": "$.version" },
        { "type": "json", "path": "apps/web/package.json", "jsonpath": "$.version" },
        { "type": "json", "path": "packages/shared/package.json", "jsonpath": "$.version" },
        { "type": "generic", "path": "apps/web/src/features/settings/infrastructure/ui/constants/settings.constants.ts" }
      ]
    }
  }
}
```

- [ ] **Step 5: Anotar la versión de la UI**

En `apps/web/src/features/settings/infrastructure/ui/constants/settings.constants.ts`, línea 2. El updater `generic` busca el marcador en un comentario de la misma línea y sustituye la versión que encuentre en ella.

Antes:
```ts
const APP_INFO = [
  { label: "Version", value: "0.1.0" },
```

Después:
```ts
const APP_INFO = [
  { label: "Version", value: "0.1.0" }, // x-release-please-version
```

- [ ] **Step 6: Ejecutar el verificador y comprobar que pasa**

Run: `node "$SCRATCH/check-release-config.mjs"`
Expected: PASS — `OK — release-please configurado, versión 0.1.0`

- [ ] **Step 7: Comprobar que el cambio en la UI no rompe el type-check**

Run: `pnpm --filter @deploykit/web exec tsc --noEmit`
Expected: sin errores nuevos en `settings.constants.ts`. El árbol tiene una refactorización de frontend en curso; si aparecen errores, confirmar que ninguno apunta a ese archivo antes de continuar.

- [ ] **Step 8: Commit** *(solo cuando el usuario lo pida)*

```bash
git add release-please-config.json .release-please-manifest.json apps/web/src/features/settings/infrastructure/ui/constants/settings.constants.ts
git commit -m "ci: configure release-please for unified monorepo versioning"
```

---

### Task 2: Workflow de release

Conecta la configuración de la Task 1 a GitHub Actions. Rechazable por separado: la config puede ser correcta y el disparo estar mal.

**Files:**
- Create: `.github/workflows/release.yml`
- Test: `$SCRATCH/check-workflows.py` (verificador desechable, fuera del repo)

**Interfaces:**
- Consumes: `release-please-config.json` y `.release-please-manifest.json` de la Task 1.
- Produces: job `release-please` con `id: release`. Sus outputs (`release_created`, `tag_name`, `version`) quedan disponibles para futuros jobs — por ejemplo el publicado de imagen que el spec deja fuera de alcance.

- [ ] **Step 1: Escribir el verificador que falla**

Crear `$SCRATCH/check-workflows.py`. Se escribe en Python porque es el único parser YAML disponible en este entorno (PyYAML 6.0.3). Comprueba que cada workflow parsea y que declara lo que hace falta para que el release funcione.

Ojo con `on:`: PyYAML sigue YAML 1.1, donde `on` sin comillas es el booleano `True`, así que la clave hay que buscarla en ambas formas.

```python
#!/usr/bin/env python
"""Verifica los workflows de release. Ejecutar desde la raíz del repo:
   python "$SCRATCH/check-workflows.py"
"""
import sys, os, yaml

errors = []
def check(cond, msg):
    if not cond:
        errors.append(msg)

def load(path):
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)

def triggers(wf):
    # 'on' sin comillas es True en YAML 1.1.
    return wf.get("on", wf.get(True))

def steps_of(wf):
    return [s for job in wf.get("jobs", {}).values() for s in job.get("steps", [])]

def step_using(wf, prefix):
    return next((s for s in steps_of(wf) if str(s.get("uses", "")).startswith(prefix)), None)

RELEASE = ".github/workflows/release.yml"
check(os.path.exists(RELEASE), f"falta {RELEASE}")
if os.path.exists(RELEASE):
    wf = load(RELEASE)
    on = triggers(wf) or {}
    check("master" in (on.get("push", {}).get("branches") or []),
          "release.yml debe dispararse en push a master")
    perms = wf.get("permissions") or {}
    check(perms.get("contents") == "write", "release.yml necesita permissions.contents: write")
    check(perms.get("pull-requests") == "write", "release.yml necesita permissions.pull-requests: write")

    rp = step_using(wf, "googleapis/release-please-action@")
    check(rp is not None, "release.yml debe usar googleapis/release-please-action")
    if rp:
        with_ = rp.get("with") or {}
        check(with_.get("config-file") == "release-please-config.json", "config-file mal apuntado")
        check(with_.get("manifest-file") == ".release-please-manifest.json", "manifest-file mal apuntado")
        check(rp.get("id") == "release", "el step de release-please debe llevar id: release")

TITLE = ".github/workflows/pr-title.yml"
if os.path.exists(TITLE):
    wf = load(TITLE)
    on = triggers(wf) or {}
    check("edited" in ((on.get("pull_request") or {}).get("types") or []),
          "pr-title.yml debe re-ejecutarse al editar el título (types incluye 'edited')")
    check(step_using(wf, "amannn/action-semantic-pull-request@") is not None,
          "pr-title.yml debe usar amannn/action-semantic-pull-request")
    types = (step_using(wf, "amannn/action-semantic-pull-request@") or {}).get("with", {}).get("types", "")
    for t in ("feat", "fix", "perf", "refactor", "docs", "chore"):
        check(t in types, f"pr-title.yml no acepta el tipo '{t}'")
else:
    print("nota: pr-title.yml todavía no existe (llega en la Task 3)")

if errors:
    print("FAIL\n" + "\n".join(" - " + e for e in errors), file=sys.stderr)
    sys.exit(1)
print("OK — workflows válidos")
```

- [ ] **Step 2: Ejecutarlo para verificar que falla**

Run: `python "$SCRATCH/check-workflows.py"`
Expected: FAIL — `falta .github/workflows/release.yml`

- [ ] **Step 3: Escribir el workflow**

`concurrency` sin cancelación evita que dos pushes seguidos abran PRs de release en conflicto. `issues: write` lo pide la acción para poder etiquetar.

```yaml
name: Release

on:
  push:
    branches: [master]

permissions:
  contents: write
  pull-requests: write
  issues: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    name: Release PR / GitHub Release
    runs-on: ubuntu-latest
    steps:
      - name: Run release-please
        id: release
        uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
```

- [ ] **Step 4: Ejecutar el verificador y comprobar que pasa**

Run: `python "$SCRATCH/check-workflows.py"`
Expected: PASS — `OK — workflows válidos`

- [ ] **Step 5: Commit** *(solo cuando el usuario lo pida)*

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow driven by release-please"
```

---

### Task 3: Guardarraíl de títulos de PR y documentación

Sin esto el changelog es aproximado: con squash-merge, un título no conventional borra el cambio del changelog sin error visible. Ya pasó con `4cfd2a3` y `6da7df7`.

**Files:**
- Create: `.github/workflows/pr-title.yml`
- Modify: `CONTRIBUTING.md` (sección nueva tras "Commit Messages", que hoy vive en la línea 38)
- Modify: `.github/PULL_REQUEST_TEMPLATE.md`
- Test: `$SCRATCH/check-workflows.py` (ya existe desde la Task 2; sus comprobaciones de `pr-title.yml` pasan de inactivas a activas)

**Interfaces:**
- Consumes: `$SCRATCH/check-workflows.py` de la Task 2, que ya contiene las aserciones sobre `pr-title.yml` bajo `if os.path.exists(TITLE)`.
- Produces: nada que consuman tareas posteriores.

- [ ] **Step 1: Ejecutar el verificador y ver que las comprobaciones de pr-title están inactivas**

Run: `python "$SCRATCH/check-workflows.py"`
Expected: PASS, pero sin validar nada de `pr-title.yml` porque el archivo no existe todavía. Esto confirma que el paso siguiente activa comprobaciones nuevas.

- [ ] **Step 2: Escribir el workflow de validación de título**

Se usa `pull_request` (no `pull_request_target`) con permiso de solo lectura: la acción únicamente lee el título del payload, así que no hace falta un token con escritura y se evita exponerlo a PRs de forks. `types` incluye `edited` para que corregir el título vuelva a ejecutar la comprobación sin re-pushear código.

```yaml
name: PR Title

on:
  pull_request:
    types: [opened, edited, reopened, synchronize]

permissions:
  pull-requests: read

jobs:
  conventional-title:
    name: Conventional Commit title
    runs-on: ubuntu-latest
    steps:
      - name: Validate PR title
        uses: amannn/action-semantic-pull-request@v5
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          types: |
            feat
            fix
            perf
            refactor
            docs
            test
            build
            ci
            chore
            style
            revert
```

- [ ] **Step 3: Ejecutar el verificador y comprobar que pasa con las comprobaciones nuevas activas**

Run: `python "$SCRATCH/check-workflows.py"`
Expected: PASS — `OK — workflows válidos`, ahora habiendo validado también `pr-title.yml`.

- [ ] **Step 4: Documentar el proceso de release en CONTRIBUTING.md**

Añadir esta sección justo después del bloque "Commit Messages" existente (línea 38 y siguientes), antes de la sección que le sigue:

```markdown
### Why the commit message matters

Pull requests are squash-merged, so **your PR title becomes the commit message** on
`master`. That commit is what generates the changelog — a title that isn't a Conventional
Commit is silently left out of the release notes. A CI check validates the title; fix the
title in the PR and it re-runs on its own.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please).

1. Merging a `feat:` or `fix:` PR into `master` makes the bot open (or update) a pull
   request titled `chore(master): release X.Y.Z`, containing the generated `CHANGELOG.md`
   and the version bump applied across the workspace.
2. That PR stays open and keeps absorbing new commits until a maintainer merges it.
   Nothing is published before that.
3. Merging it tags `vX.Y.Z` and publishes the GitHub Release.

While the version is below `1.0.0`, `feat:` bumps the minor and `fix:` bumps the patch;
breaking changes bump the minor rather than jumping to `1.0.0`. To cut `1.0.0`
deliberately, add `Release-As: 1.0.0` to a commit body.

Do not edit `CHANGELOG.md` or the `version` fields by hand — they are generated.

**Maintainer setup (one time):** in *Settings → Actions → General → Workflow permissions*,
enable *"Allow GitHub Actions to create and approve pull requests"*. Without it the bot
cannot open the release PR and the workflow fails.
```

- [ ] **Step 5: Recordar la convención en la plantilla de PR**

Añadir al principio de `.github/PULL_REQUEST_TEMPLATE.md`, antes del contenido actual:

```markdown
<!--
The PR title becomes the squash-merge commit message and feeds the changelog.
Use a Conventional Commit title, e.g. "feat: add Bitbucket webhook support".
-->
```

- [ ] **Step 6: Commit** *(solo cuando el usuario lo pida)*

```bash
git add .github/workflows/pr-title.yml CONTRIBUTING.md .github/PULL_REQUEST_TEMPLATE.md
git commit -m "ci: validate PR titles and document the release process"
```

---

### Task 4: Simulación del primer release

Comprobar qué versión y qué changelog saldrían **antes** de que nada llegue a `master`. Es el único paso que ejerce release-please de verdad.

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Ejecutar los dos verificadores juntos**

Run: `node "$SCRATCH/check-release-config.mjs" && python "$SCRATCH/check-workflows.py"`
Expected: ambos PASS.

- [ ] **Step 2: Intentar un dry-run real de release-please**

Necesita un token de GitHub con permiso de lectura del repo. Si hay uno disponible en el entorno (`GITHUB_TOKEN` o `GH_TOKEN`):

```bash
npx --yes release-please@17 release-pr \
  --repo-url=deploykithq/deploykit \
  --target-branch=master \
  --config-file=release-please-config.json \
  --manifest-file=.release-please-manifest.json \
  --token="$GITHUB_TOKEN" \
  --dry-run
```

Expected: la salida anuncia un release PR para la versión **0.2.0** e incluye entre las
entradas del changelog `feat: persistent logs`, `feat: added historical observability`,
`fix: deploy races volume loss` y `fix: auto-map image-declared VOLUMEs to stable named volumes`.

Si **no** hay token disponible, no inventar el resultado: registrar que este paso queda
sin ejecutar y que la verificación real es el primer PR que abra el bot, que es
reversible cerrándolo sin mergear.

- [ ] **Step 3: Comprobar que la versión declarada sigue siendo coherente**

Run: `git grep -n "\"version\": \"0.1.0\"" -- package.json apps packages`
Expected: exactamente cuatro coincidencias (raíz, api, web, shared). Ninguna se toca a
mano: las bumpea el bot.

- [ ] **Step 4: Resumen final al usuario**

Reportar: qué archivos se crearon, qué versión saldría en la primera release, qué dos
commits quedan fuera del changelog por no ser conventional, y el ajuste manual que hay
que activar en *Settings → Actions*.

---

## Notas de ejecución

- **No ejecutar `pnpm db:generate`** en ningún momento (las migraciones de este repo son manuales).
- Si `pnpm lint` falla, comparar contra el estado previo antes de atribuirlo a este trabajo: el árbol tiene una refactorización de frontend en curso sin relación con el release.
- El primer PR que abra el bot **incluirá todo el historial desde el commit inicial**. Es lo buscado: la 0.2.0 documenta el trabajo real acumulado desde la 0.1.0.

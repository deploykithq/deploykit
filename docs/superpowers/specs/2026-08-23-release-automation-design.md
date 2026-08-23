# Release automation con changelog automático

**Fecha:** 2026-08-23
**Estado:** aprobado
**Alcance:** CI/CD del repositorio. No toca código de aplicación salvo una anotación de una línea.

## Problema

DeployKit no tiene ningún flujo de release: cero tags, cero GitHub Releases, ningún
`CHANGELOG.md`, y `0.1.0` hardcodeado en cuatro `package.json` más la pantalla de
ajustes de la web. Para un PaaS self-hosted eso significa que nadie —ni un usuario que
va a actualizar su instalación, ni un contribuidor— puede saber qué cambió entre dos
puntos del historial.

El repositorio ya documenta [Conventional Commits](../../../CONTRIBUTING.md) y los
commits recientes lo respetan, así que el historial ya contiene la información que hace
falta para generar un changelog. Solo falta consumirla.

## Decisiones tomadas

| Decisión | Elección | Descartado |
|---|---|---|
| Disparo del release | **release-please**: PR de release con gate humano | semantic-release (publica en cada push), tag manual |
| Artefactos | **Solo GitHub Release** (tag + notas) | Publicar imagen en GHCR |
| Versionado | **Versión única** para todo el monorepo | Solo raíz, o versión independiente por paquete |

Razón del gate humano: el mantenedor decide *cuándo* se publica y puede agrupar varios
merges en una release, pero no tiene que redactar *qué* va dentro — eso se deriva de los
commits.

Razón de la versión única: los cuatro paquetes son `private`, no se publican en npm y se
despliegan como una sola imagen Docker. Versionarlos por separado sería inventar una
frontera que no existe.

## Arquitectura

### Componentes

```
.github/workflows/release.yml     Disparo: push a master -> release-please-action@v4
release-please-config.json        Política: qué se bumpea, cómo se calcula la versión,
                                  qué secciones tiene el changelog
.release-please-manifest.json     Estado: última versión publicada por componente
CHANGELOG.md                      Generado; no se edita a mano fuera del PR de release
```

Cada archivo tiene una responsabilidad y se puede entender por separado: el workflow
define *cuándo*, la config define *qué*, el manifest define *desde dónde*.

### Flujo de datos

1. Se mergea a `master` un PR con título Conventional Commit (squash-merge → el título
   del PR se convierte en el mensaje del commit).
2. `release.yml` dispara release-please, que lee los commits desde la última versión del
   manifest.
3. Si hay al menos un commit que afecte a la versión, abre o **actualiza** un PR
   `chore(master): release X.Y.Z` con el `CHANGELOG.md` redactado y todas las versiones
   bumpeadas. Mientras no se mergee, ese PR sigue absorbiendo commits nuevos.
4. Al mergear ese PR, la siguiente ejecución crea el tag `vX.Y.Z` y la GitHub Release
   con las notas del changelog, y escribe la nueva versión en el manifest.

No hay estado fuera del repositorio: el manifest y los tags son la única fuente de verdad.

### Propagación de la versión

Un solo componente en la raíz (`"."`) con `release-type: node`, que bumpea
`package.json`, más `extra-files`:

| Archivo | Mecanismo |
|---|---|
| `apps/api/package.json` | `type: json`, `jsonpath: $.version` |
| `apps/web/package.json` | `type: json`, `jsonpath: $.version` |
| `packages/shared/package.json` | `type: json`, `jsonpath: $.version` |
| `apps/web/src/features/settings/infrastructure/ui/constants/settings.constants.ts` | `type: generic` + anotación `x-release-please-version` |

El último es la versión que la web muestra en Ajustes. Estaba hardcodeada; sin incluirla
aquí, la UI empezaría a mentir en la primera release. Es la única línea de código de
aplicación que toca este trabajo.

### Estrategia semver en 0.x

```
bump-minor-pre-major: true
bump-patch-for-minor-pre-major: false
```

- `feat:` → minor (`0.1.0` → `0.2.0`)
- `fix:`, `perf:` → patch (`0.1.0` → `0.1.1`)
- Breaking change → minor mientras la versión sea < 1.0.0, **sin** saltar a `1.0.0` por
  accidente. El salto a 1.0.0 se hace a propósito con `Release-As: 1.0.0` en el cuerpo
  de un commit.

### Secciones del changelog

Visibles: `feat` (Features), `fix` (Bug Fixes), `perf` (Performance Improvements),
`refactor` (Refactors), `docs` (Documentation).
Ocultas: `chore`, `ci`, `build`, `test`, `style`.

### Arranque

El repositorio no tiene tags, así que release-please no puede localizar una release
anterior y por defecto recorrería todo el historial.

- `.release-please-manifest.json` = `{".": "0.1.0"}` — declara 0.1.0 como última
  publicada.
- `bootstrap-sha` = `0f37e68` (commit inicial, `v0.1.0`) — acota el escaneo a todo lo
  posterior a ese punto.

Resultado: la primera release será `0.2.0` y su changelog documentará el trabajo real
acumulado (security hardening, templates/onboarding/autoscaling, observabilidad
histórica, logs persistentes, fixes de volúmenes y de migraciones).

Tres commits quedarán fuera por no ser Conventional Commits y release-please los ignora
en silencio (comprobado clasificando el historial con las mismas reglas):

- `4cfd2a3 Security hardening (#1)`
- `6da7df7 feature: added start command field for nixpack auto detec` (usa `feature:`,
  que no es un tipo válido)
- `d348dd8 update install.sh with the org name for repo`

También se descarta `b347f33 Merge branch 'master'...`, que es un merge commit y no
aporta contenido al changelog.

Se pueden añadir a mano al `CHANGELOG.md` dentro del PR de release antes de mergearlo.

### Guardarraíl: validación del título de PR

Como el repositorio usa squash-merge, el título del PR **es** el commit que verá
release-please. Un título no conventional no produce un error: produce un cambio que
desaparece del changelog sin avisar. Ya ha ocurrido dos veces (los dos commits de
arriba).

Por eso se añade un job que valida el título de cada PR contra los tipos permitidos.
Es lo que convierte el changelog en fiable en lugar de aproximado.

Se activa además `validateSingleCommit`: cuando un PR tiene un solo commit, GitHub
propone ese mensaje —no el título del PR— al hacer squash. Es exactamente cómo entró
`6da7df7 feature: ...`, así que el mensaje del commit también tiene que sostenerse.

Versiones de las acciones fijadas por major, comprobadas contra la API de GitHub en el
momento de escribir esto: `googleapis/release-please-action@v5` (v5.0.0, 2026-04-22) y
`amannn/action-semantic-pull-request@v6` (v6.1.1). En ambos casos el salto de major solo
cambia el runtime a Node 24; los inputs usados aquí son idénticos a los del major anterior.

## Manejo de errores

| Fallo | Síntoma | Respuesta |
|---|---|---|
| Falta el permiso de crear PRs en Settings | El workflow falla con `GitHub Actions is not permitted to create or approve pull requests` | Requisito manual documentado en CONTRIBUTING; hay que activarlo una vez |
| Ningún commit relevante desde la última release | No se abre PR, el workflow termina en verde | Comportamiento correcto, no es un error |
| Título de PR no conventional | El job de validación falla y bloquea el merge | El autor corrige el título; no hace falta re-pushear código |
| Versión calculada incorrecta | PR de release con la versión equivocada | Se cierra el PR sin mergear y se corrige con `Release-As:` en un commit |

## Requisitos operativos (fuera del repositorio)

1. **Settings → Actions → General → Workflow permissions →** activar *"Allow GitHub
   Actions to create and approve pull requests"*. Sin esto el bot no puede abrir el PR.
2. El workflow declara `permissions: contents: write, pull-requests: write, issues: write`.
3. Con el `GITHUB_TOKEN` por defecto, el PR de release **no dispara** `ci.yml` — es una
   limitación de GitHub, no un fallo de configuración. Se acepta: ese PR solo modifica
   `CHANGELOG.md` y números de versión. Si en el futuro se quiere CI también ahí, hay que
   crear un PAT y pasarlo como `token:` a la acción.

## Verificación

Un workflow de release no se puede ejecutar de verdad sin publicar, así que la
verificación es por capas:

1. `release-please-config.json` y `.release-please-manifest.json` parsean como JSON y la
   config valida contra el schema oficial (`$schema` declarado en el archivo).
2. Los dos workflows YAML parsean y sus claves (`on`, `permissions`, `jobs`) son válidas.
3. Los `path` de todos los `extra-files` existen en el repositorio y contienen la versión
   en la ubicación indicada (jsonpath o anotación).
4. `pnpm lint && pnpm build` siguen pasando tras la anotación en `settings.constants.ts`.
5. La prueba real es el primer PR que abra el bot. Es reversible por diseño: se revisa y,
   si algo no cuadra, se cierra sin mergear y no se publica nada.

## Fuera de alcance

- Publicación de imagen Docker en GHCR (decisión explícita; se puede añadir después
  colgando un job de `steps.release.outputs.release_created`).
- Versionado independiente por paquete.
- Releases de prueba / canales prerelease.
- Firma de artefactos y SBOM.

import { fetchJson, ModSourceError } from "./http";

import type { ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";
import type { ModKindT } from "@deploykit/shared";

/** CurseForge (curseforge.com): needs the instance's API key for every call. */

const API = "https://api.curseforge.com/v1";
const MINECRAFT = 432;
const CLASS: Record<ModKindT, number> = { mod: 6, plugin: 5, modpack: 4471 };
const LOADER_TYPE: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const KNOWN_LOADERS = new Set(Object.keys(LOADER_TYPE));
const PAGE = 20;
const URL_REGEX =
  /^https:\/\/(?:www\.)?curseforge\.com\/minecraft\/(?:mc-mods|modpacks|bukkit-plugins)\/([a-z0-9-]{1,100})(?:\/.*)?$/;
const SLUG_REGEX = /^[a-z0-9-]{1,100}$/;
const NUMERIC_REGEX = /^\d{1,10}$/;

const keyHeaders = (apiKey: string | null) => {
  if (!apiKey) {
    throw new ModSourceError(
      "BAD_REQUEST",
      "CurseForge needs an API key: an admin can add one in Settings",
    );
  }
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
    ...(blocked
      ? { reason: "Its author forbids third-party distribution, so the server cannot download it" }
      : {}),
  };
};

const loaderTypeFor = (kind: ModKindT | undefined, loaders: string[] | null | undefined) =>
  kind === "mod" ? loaders?.map((l) => LOADER_TYPE[l]).find(Boolean) : undefined;

const RELEASE_TYPE: Record<number, ModVersionI["type"]> = { 1: "release", 2: "beta", 3: "alpha" };

const curseforge: ModSourceAdapterI = {
  id: "curseforge",

  capabilities: (ctx) =>
    ctx.apiKey
      ? { search: true, install: true }
      : {
          search: false,
          install: false,
          reason: "An admin must add a CurseForge API key in Settings",
        },

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    if (fromUrl) return fromUrl[1]!;
    if (/^https?:/i.test(trimmed)) return null;
    return NUMERIC_REGEX.test(trimmed) || SLUG_REGEX.test(trimmed) ? trimmed : null;
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
    const loaderType = loaderTypeFor(filter.kind, filter.loaders);
    if (loaderType) params.set("modLoaderType", String(loaderType));
    const data = await fetchJson<any>(`${API}/mods/search?${params}`, {
      headers: keyHeaders(ctx.apiKey),
      cacheSec: 300,
      what: "CurseForge",
    });
    return {
      hits: (data.data ?? []).map(summary),
      // CurseForge refuses index + pageSize beyond 10 000.
      total: Math.min(data.pagination?.totalCount ?? 0, 10_000),
      offset,
      limit: PAGE,
    };
  },

  async project(ref, ctx) {
    const headers = keyHeaders(ctx.apiKey);
    if (NUMERIC_REGEX.test(ref)) {
      const data = await fetchJson<any>(`${API}/mods/${ref}`, {
        headers,
        cacheSec: 300,
        what: "CurseForge",
      });
      return summary(data.data);
    }
    if (!SLUG_REGEX.test(ref)) throw new ModSourceError("BAD_REQUEST", "Not a CurseForge project");
    const params = new URLSearchParams({ gameId: String(MINECRAFT), slug: ref, pageSize: "1" });
    const data = await fetchJson<any>(`${API}/mods/search?${params}`, {
      headers,
      cacheSec: 300,
      what: "CurseForge",
    });
    const hit = data.data?.[0];
    if (!hit) throw new ModSourceError("NOT_FOUND", "Not found on CurseForge");
    return summary(hit);
  },

  async versions(projectId, filter, ctx) {
    if (!NUMERIC_REGEX.test(projectId)) {
      throw new ModSourceError("BAD_REQUEST", "Not a CurseForge project");
    }
    const params = new URLSearchParams({ pageSize: "50" });
    if (filter?.gameVersion) params.set("gameVersion", filter.gameVersion);
    const loaderType = loaderTypeFor(filter?.kind, filter?.loaders);
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
          loaders: (f.gameVersions ?? [])
            .map((g: string) => g.toLowerCase())
            .filter((g: string) => KNOWN_LOADERS.has(g)),
          publishedAt: f.fileDate,
          type: RELEASE_TYPE[f.releaseType] ?? "release",
        }),
      )
      .sort((a: ModVersionI, b: ModVersionI) => b.publishedAt.localeCompare(a.publishedAt));
  },

  async validateKey(key) {
    await fetchJson(`${API}/games/${MINECRAFT}`, {
      headers: { "x-api-key": key },
      what: "CurseForge",
    });
  },
};

export { curseforge };

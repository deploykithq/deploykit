import { fetchJson, ModSourceError } from "./http";

import type { ModFilterI, ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";
import type { ModKindT } from "@deploykit/shared";

/** Modrinth (modrinth.com): public API, no key; asks for an identifying User-Agent. */

const API = "https://api.modrinth.com/v2";
const MODRINTH_USER_AGENT = `deploykit/${process.env.npm_package_version ?? "dev"} (github.com/deploykithq/deploykit)`;
const headers = { "user-agent": MODRINTH_USER_AGENT };
const PAGE = 20;
const ID_REGEX = /^[A-Za-z0-9_.-]{1,64}$/;
const URL_REGEX =
  /^https:\/\/(?:www\.)?modrinth\.com\/(?:mod|plugin|modpack|datapack)\/([A-Za-z0-9_.-]{1,64})(?:\/.*)?$/;

const toKind = (projectType: string): ModKindT =>
  projectType === "modpack" ? "modpack" : projectType === "plugin" ? "plugin" : "mod";

const summary = (p: any, kindHint?: ModKindT): ModSummaryI => {
  const kind = kindHint ?? toKind(p.project_type);
  // A client-only project (or pack) does nothing on a server.
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
    url: `https://modrinth.com/${kind === "modpack" ? "modpack" : "mod"}/${p.slug ?? p.project_id ?? p.id}`,
    kind,
    installable: !clientOnly,
    ...(clientOnly ? { reason: "Client-side only: it does nothing on a server" } : {}),
  };
};

const facetsFor = (filter: ModFilterI): string[][] => {
  const facets: string[][] = [];
  if (filter.kind === "modpack") facets.push(["project_type:modpack"]);
  else if (filter.kind === "plugin") facets.push(["project_type:mod", "project_type:plugin"]);
  else facets.push(["project_type:mod"]);
  if (filter.loaders?.length) facets.push(filter.loaders.map((l) => `categories:${l}`));
  if (filter.gameVersion) facets.push([`versions:${filter.gameVersion}`]);
  facets.push(["server_side:required", "server_side:optional"]);
  return facets;
};

const modrinth: ModSourceAdapterI = {
  id: "modrinth",

  capabilities: () => ({ search: true, install: true }),

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    // A leading dot is never an id, and "." / ".." would walk the API path.
    const valid = (id: string) => (id.startsWith(".") ? null : id);
    if (fromUrl) return valid(fromUrl[1]!);
    if (/^https?:/i.test(trimmed)) return null;
    return ID_REGEX.test(trimmed) ? valid(trimmed) : null;
  },

  async search(query, filter, offset) {
    const params = new URLSearchParams({
      query,
      limit: String(PAGE),
      offset: String(offset),
      index: query ? "relevance" : "downloads",
      facets: JSON.stringify(facetsFor(filter)),
    });
    const data = await fetchJson<any>(`${API}/search?${params}`, {
      headers,
      cacheSec: 300,
      what: "Modrinth",
    });
    return {
      hits: (data.hits ?? []).map((h: any) =>
        summary(h, filter.kind === "plugin" ? "plugin" : undefined),
      ),
      total: data.total_hits ?? 0,
      offset: data.offset ?? offset,
      limit: data.limit ?? PAGE,
    };
  },

  async project(ref) {
    if (!ID_REGEX.test(ref)) throw new ModSourceError("BAD_REQUEST", "Not a Modrinth project");
    const p = await fetchJson<any>(`${API}/project/${encodeURIComponent(ref)}`, {
      headers,
      cacheSec: 300,
      what: "Modrinth",
    });
    return summary(p);
  },

  async versions(projectId, filter) {
    if (!ID_REGEX.test(projectId)) {
      throw new ModSourceError("BAD_REQUEST", "Not a Modrinth project");
    }
    const params = new URLSearchParams();
    if (filter?.loaders?.length) params.set("loaders", JSON.stringify(filter.loaders));
    if (filter?.gameVersion) params.set("game_versions", JSON.stringify([filter.gameVersion]));
    const query = params.toString();
    const list = await fetchJson<any[]>(
      `${API}/project/${encodeURIComponent(projectId)}/version${query ? `?${query}` : ""}`,
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

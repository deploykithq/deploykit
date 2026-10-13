import { fetchJson, ModSourceError } from "./http";

import type { ModSourceAdapterI, ModSummaryI, ModVersionI } from "./types";

/**
 * The Steam Workshop. Looking an item up needs no key, so a pasted link
 * always works; searching needs a Steam Web API key. The Workshop serves
 * only an item's latest upload, so nothing here can be pinned.
 */

const API = "https://api.steampowered.com";
const PAGE = 20;
const URL_REGEX =
  /^https:\/\/steamcommunity\.com\/(?:sharedfiles|workshop)\/filedetails\/\?(?:.*&)?id=(\d{1,20})(?:&.*)?$/;
const ID_REGEX = /^\d{1,20}$/;

const summary = (d: any): ModSummaryI => ({
  source: "steam-workshop",
  projectId: String(d.publishedfileid),
  slug: null,
  name: d.title,
  summary: String(d.description ?? d.file_description ?? "").slice(0, 300),
  iconUrl: d.preview_url || null,
  author: null,
  downloads: d.subscriptions ?? 0,
  url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${d.publishedfileid}`,
  kind: "mod",
  installable: true,
});

const details = async (id: string, appId: number | undefined) => {
  if (!ID_REGEX.test(id)) throw new ModSourceError("BAD_REQUEST", "Not a Workshop item id");
  const body = new URLSearchParams({ itemcount: "1", "publishedfileids[0]": id }).toString();
  const data = await fetchJson<any>(`${API}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cacheSec: 300,
    what: "the Steam Workshop",
  });
  const item = data.response?.publishedfiledetails?.[0];
  if (!item || item.result !== 1) {
    throw new ModSourceError("NOT_FOUND", "Workshop item not found (or not public)");
  }
  const app = item.consumer_app_id ?? item.creator_app_id;
  if (appId !== undefined && app !== appId) {
    throw new ModSourceError(
      "BAD_REQUEST",
      `That Workshop item belongs to another game, not app ${appId}`,
    );
  }
  return item;
};

const steamWorkshop: ModSourceAdapterI = {
  id: "steam-workshop",

  capabilities: (ctx) =>
    ctx.apiKey
      ? { search: true, install: true }
      : {
          search: false,
          install: true,
          reason:
            "Searching needs a Steam Web API key (Settings). You can still paste a Workshop link.",
        },

  parseRef(input) {
    const trimmed = input.trim();
    const fromUrl = URL_REGEX.exec(trimmed);
    if (fromUrl) return fromUrl[1]!;
    return ID_REGEX.test(trimmed) ? trimmed : null;
  },

  async search(query, _filter, offset, ctx) {
    if (!ctx.apiKey) {
      throw new ModSourceError("BAD_REQUEST", "Searching the Workshop needs a Steam Web API key");
    }
    const params = new URLSearchParams({
      key: ctx.apiKey,
      appid: String(ctx.appId),
      search_text: query,
      // 12 = ranked by text search, 3 = trending
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
    const version: ModVersionI = {
      id: String(item.time_updated ?? 0),
      label: `Updated ${updated.toISOString().slice(0, 10)}`,
      gameVersions: [],
      loaders: [],
      publishedAt: updated.toISOString(),
      type: "release",
    };
    return [version];
  },

  async validateKey(key) {
    const params = new URLSearchParams({
      key,
      appid: "1281930",
      numperpage: "1",
      query_type: "3",
    });
    await fetchJson(`${API}/IPublishedFileService/QueryFiles/v1/?${params}`, { what: "Steam" });
  },
};

export { steamWorkshop };

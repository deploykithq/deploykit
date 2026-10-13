import { getSetting } from "../instance-settings";

import { curseforge } from "./curseforge";
import { modrinth } from "./modrinth";
import { steamWorkshop } from "./steam";

import type { GameModKeyT, GameModSourceT, ModSourceIdT } from "@deploykit/shared";
import type { ModSourceAdapterI, ModSourceContextI } from "./types";

/** The mod catalogues, by source id, and the keys each one reads. */

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

export { adapterFor, contextFor, validateModKey };
export { ModSourceError } from "./http";
export { resolveVersionAlias } from "./modrinth";
export type * from "./types";

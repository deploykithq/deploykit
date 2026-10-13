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
  const row = await db.query.instanceSettings.findFirst({
    where: eq(instanceSettings.key, key),
  });
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
  return value
    ? { configured: true, last4: value.slice(-4) }
    : { configured: false, last4: null };
};

export { getSetting, setSetting, settingStatus, clearSettingsCache };

import { eq } from "drizzle-orm";

import { docker } from "../lib/docker";
import { db } from "../db/index";
import { applications, databases } from "../db/schema/index";
import { redis } from "../lib/redis";
import { DISK_KEY, DISK_TTL_SEC } from "../services/metrics";

/**
 * Disk usage collector.
 *
 * A container's size on disk is its writable layer plus whatever its volumes
 * hold. Both are expensive for the daemon to compute (on overlay2 it's a real
 * `du`), so this runs on its own 5-minute cadence instead of riding along with
 * the 30s stats tick, and gets everything from a single `docker.df()` call
 * rather than one `inspect({size:true})` per container.
 */

const TICK_INTERVAL_MS = 5 * 60_000;
const LOCK_KEY = "metrics:disk:lock";
const LOCK_TTL_SEC = 240; // < tick interval, so a crashed tick self-heals

interface DfMountI {
  Type?: string;
  Name?: string;
}

interface DfContainerI {
  Id: string;
  SizeRw?: number;
  Mounts?: DfMountI[];
}

interface DfVolumeI {
  Name: string;
  UsageData?: { Size?: number };
}

interface DfResponseI {
  Containers?: DfContainerI[];
  Volumes?: DfVolumeI[];
}

/**
 * Total bytes per container, keyed by both the full id and its 12-char short
 * form so callers can look up whichever they stored.
 *
 * A volume mounted into two containers is counted for both — the number answers
 * "how much disk does this service touch", not "how much would freeing it save".
 */
export function computeDiskUsage(df: DfResponseI): Map<string, number> {
  const volumeSizes = new Map<string, number>();
  for (const v of df.Volumes ?? []) {
    // Docker reports -1 when it hasn't computed the size.
    const size = v.UsageData?.Size ?? -1;
    volumeSizes.set(v.Name, size > 0 ? size : 0);
  }

  const byContainer = new Map<string, number>();
  for (const c of df.Containers ?? []) {
    let total = c.SizeRw ?? 0;
    for (const m of c.Mounts ?? []) {
      if (m.Type === "volume" && m.Name) {
        total += volumeSizes.get(m.Name) ?? 0;
      }
    }
    byContainer.set(c.Id, total);
    byContainer.set(c.Id.slice(0, 12), total);
  }

  return byContainer;
}

function lookup(byContainer: Map<string, number>, containerId: string): number {
  return (
    byContainer.get(containerId) ??
    byContainer.get(containerId.slice(0, 12)) ??
    0
  );
}

async function tick(): Promise<void> {
  // Guards against overlapping ticks when the daemon is slow, not against
  // re-running: the lock is released as soon as this tick finishes.
  const acquired = await redis.set(LOCK_KEY, "1", "EX", LOCK_TTL_SEC, "NX");
  if (acquired !== "OK") return;

  try {
    const [apps, dbs] = await Promise.all([
      db.query.applications.findMany({
        where: eq(applications.status, "running"),
        columns: { id: true, containerId: true },
      }),
      db.query.databases.findMany({
        where: eq(databases.status, "running"),
        columns: { id: true, containerId: true },
      }),
    ]);

    const services = [...apps, ...dbs].filter((s) => s.containerId);
    if (services.length === 0) return;

    const df = (await docker.df()) as DfResponseI;
    const byContainer = computeDiskUsage(df);

    const pipeline = redis.pipeline();
    for (const s of services) {
      const bytes = lookup(byContainer, s.containerId!);
      pipeline.set(DISK_KEY(s.id), String(bytes), "EX", DISK_TTL_SEC);
    }
    await pipeline.exec();
  } catch (err: any) {
    // Keep the previous cached values until their TTL expires; never let this
    // take down the CPU/memory collection, which runs on a separate tick.
    console.error("[disk-scheduler] tick error:", err.message);
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }
}

export function startDiskScheduler(): NodeJS.Timeout {
  // Offset from the metrics scheduler's first tick so they don't both hammer
  // the daemon on boot.
  setTimeout(() => tick(), 20_000);

  const interval = setInterval(() => tick(), TICK_INTERVAL_MS);
  console.log(
    `[disk-scheduler] Started (docker.df every ${TICK_INTERVAL_MS / 60_000}m)`,
  );
  return interval;
}

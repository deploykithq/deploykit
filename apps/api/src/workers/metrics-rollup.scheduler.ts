import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { applications, databases, metricSamples } from "../db/schema/index";
import { drainPending, type MetricSample } from "../services/metrics";
import { redis } from "../lib/redis";

/**
 * Downsampling scheduler for long-term metric history.
 *
 * The metrics scheduler buffers every 30s sample in Redis (metrics:pending:*).
 * Once a minute this drains those buffers and writes one durable "1m" row per
 * service, then (at most once an hour) compacts old "1m" rows into "1h" rows
 * and prunes anything past its retention window.
 */

const TICK_INTERVAL_MS = 60_000;
const RAW_RETENTION_HOURS = Number(process.env.METRICS_RAW_RETENTION_HOURS) || 48;
const HISTORY_RETENTION_DAYS = Number(process.env.METRICS_HISTORY_RETENTION_DAYS) || 90;
const COMPACT_LOCK_KEY = "metrics:rollup:compact:lock";

interface Aggregate {
  bucket: Date;
  cpuAvg: number;
  cpuMax: number;
  memAvg: number;
  memMax: number;
  memUsed: number;
  netRx: number;
  netTx: number;
  samples: number;
}

function minuteBucket(ts: number): number {
  return Math.floor(ts / 60_000) * 60_000;
}

// Group drained samples by their minute and aggregate each group. Samples
// drained in one tick can straddle a minute boundary, so we may emit >1 group.
function aggregateByMinute(samples: MetricSample[]): Aggregate[] {
  const groups = new Map<number, MetricSample[]>();
  for (const s of samples) {
    const key = minuteBucket(s.ts);
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }

  const out: Aggregate[] = [];
  for (const [bucketMs, list] of groups) {
    const n = list.length;
    let cpuSum = 0,
      cpuMax = 0,
      memSum = 0,
      memMax = 0,
      memUsedSum = 0;
    // net counters are cumulative — keep the latest sample's value
    const last = list.reduce((a, b) => (b.ts > a.ts ? b : a), list[0]!);
    for (const s of list) {
      cpuSum += s.cpu;
      if (s.cpu > cpuMax) cpuMax = s.cpu;
      memSum += s.memPercent;
      if (s.memPercent > memMax) memMax = s.memPercent;
      memUsedSum += s.memUsed;
    }
    out.push({
      bucket: new Date(bucketMs),
      cpuAvg: cpuSum / n,
      cpuMax,
      memAvg: memSum / n,
      memMax,
      memUsed: Math.round(memUsedSum / n),
      netRx: last.netRx,
      netTx: last.netTx,
      samples: n,
    });
  }
  return out;
}

async function rollupService(
  serviceId: string,
  serviceType: "application" | "database",
): Promise<void> {
  const samples = await drainPending(serviceId);
  if (samples.length === 0) return;

  for (const agg of aggregateByMinute(samples)) {
    await db
      .insert(metricSamples)
      .values({
        serviceId,
        serviceType,
        resolution: "1m",
        bucket: agg.bucket,
        cpuAvg: agg.cpuAvg,
        cpuMax: agg.cpuMax,
        memAvg: agg.memAvg,
        memMax: agg.memMax,
        memUsed: agg.memUsed,
        netRx: agg.netRx,
        netTx: agg.netTx,
        samples: agg.samples,
      })
      // A bucket may already exist if a tick re-processes a boundary minute;
      // merge with a sample-weighted average so aggregates stay correct.
      .onConflictDoUpdate({
        target: [
          metricSamples.serviceId,
          metricSamples.resolution,
          metricSamples.bucket,
        ],
        set: {
          cpuAvg: sql`(${metricSamples.cpuAvg} * ${metricSamples.samples} + ${agg.cpuAvg} * ${agg.samples}) / (${metricSamples.samples} + ${agg.samples})`,
          cpuMax: sql`greatest(${metricSamples.cpuMax}, ${agg.cpuMax})`,
          memAvg: sql`(${metricSamples.memAvg} * ${metricSamples.samples} + ${agg.memAvg} * ${agg.samples}) / (${metricSamples.samples} + ${agg.samples})`,
          memMax: sql`greatest(${metricSamples.memMax}, ${agg.memMax})`,
          memUsed: sql`((${metricSamples.memUsed} * ${metricSamples.samples} + ${agg.memUsed} * ${agg.samples}) / (${metricSamples.samples} + ${agg.samples}))::bigint`,
          netRx: sql`greatest(${metricSamples.netRx}, ${agg.netRx})`,
          netTx: sql`greatest(${metricSamples.netTx}, ${agg.netTx})`,
          samples: sql`${metricSamples.samples} + ${agg.samples}`,
        },
      });
  }
}

// Compact "1m" rows older than the raw window into "1h" rows, then prune both
// tiers past their retention. Gated to ~once an hour via a Redis NX lock so it
// runs at most once even across restarts/multiple processes.
async function compactAndPrune(): Promise<void> {
  const acquired = await redis.set(COMPACT_LOCK_KEY, "1", "EX", 3600, "NX");
  if (acquired !== "OK") return;

  await db.execute(sql`
    INSERT INTO metric_samples
      (service_id, service_type, resolution, bucket,
       cpu_avg, cpu_max, mem_avg, mem_max, mem_used, net_rx, net_tx, samples)
    SELECT service_id, service_type, '1h', date_trunc('hour', bucket),
           avg(cpu_avg), max(cpu_max), avg(mem_avg), max(mem_max),
           avg(mem_used)::bigint, max(net_rx), max(net_tx), sum(samples)
    FROM metric_samples
    WHERE resolution = '1m'
      AND bucket < now() - make_interval(hours => ${RAW_RETENTION_HOURS})
    GROUP BY service_id, service_type, date_trunc('hour', bucket)
    ON CONFLICT (service_id, resolution, bucket) DO NOTHING
  `);

  await db.execute(sql`
    DELETE FROM metric_samples
    WHERE resolution = '1m'
      AND bucket < now() - make_interval(hours => ${RAW_RETENTION_HOURS})
  `);

  await db.execute(sql`
    DELETE FROM metric_samples
    WHERE resolution = '1h'
      AND bucket < now() - make_interval(days => ${HISTORY_RETENTION_DAYS})
  `);
}

async function tick(): Promise<void> {
  try {
    const [apps, dbs] = await Promise.all([
      db.query.applications.findMany({
        where: eq(applications.status, "running"),
        columns: { id: true },
      }),
      db.query.databases.findMany({
        where: eq(databases.status, "running"),
        columns: { id: true },
      }),
    ]);

    const tasks: Promise<void>[] = [
      ...apps.map((a) => rollupService(a.id, "application")),
      ...dbs.map((d) => rollupService(d.id, "database")),
    ];
    await Promise.allSettled(tasks);

    await compactAndPrune();
  } catch (err: any) {
    console.error("[metrics-rollup] tick error:", err.message);
  }
}

export function startMetricsRollupScheduler(): NodeJS.Timeout {
  // Offset from the 30s metrics tick so a full minute of samples is buffered.
  setTimeout(() => tick(), 35_000);

  const interval = setInterval(() => tick(), TICK_INTERVAL_MS);
  console.log(
    `[metrics-rollup] Started (rollup every ${TICK_INTERVAL_MS / 1000}s, raw ${RAW_RETENTION_HOURS}h, history ${HISTORY_RETENTION_DAYS}d)`,
  );
  return interval;
}

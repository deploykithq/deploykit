import { redis } from "../lib/redis";

export interface MetricSample {
  ts: number; // unix ms
  cpu: number; // percent 0-100
  memPercent: number; // percent 0-100
  memUsed: number; // bytes
  memTotal: number; // bytes
  netRx: number; // bytes total (cumulative)
  netTx: number; // bytes total (cumulative)
  diskUsed: number; // bytes (writable layer + volumes); 0 until the disk scheduler has run
}

export interface CurrentMetrics extends MetricSample {
  serviceId: string;
  serviceType: "application" | "database";
  serviceName: string;
}

const RING_KEY = (id: string) => `metrics:ring:${id}`;
const CURRENT_KEY = (id: string) => `metrics:current:${id}`;
const PENDING_KEY = (id: string) => `metrics:pending:${id}`;
const RING_SIZE = 60; // 60 samples × 30s = 30 min of history
const TTL_SEC = 60 * 60; // expire after 1h of inactivity
const PENDING_TTL_SEC = 5 * 60; // safety expiry; drained every 60s by the rollup scheduler
const PENDING_MAX = 240; // cap unbounded growth if the rollup scheduler stalls

// Disk usage is sampled on its own slower cadence by the disk scheduler
// (docker.df() is expensive), so it lives in its own key and the 30s metrics
// tick just stamps the last known value onto each sample.
const DISK_KEY = (id: string) => `metrics:disk:${id}`;
const DISK_TTL_SEC = 15 * 60; // three disk ticks of slack

/** Last known disk usage in bytes for each service; 0 when never sampled. */
export async function getDiskUsage(
  serviceIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (serviceIds.length === 0) return out;

  const raw = await redis.mget(serviceIds.map(DISK_KEY));
  serviceIds.forEach((id, i) => {
    out.set(id, Number(raw[i]) || 0);
  });
  return out;
}

export { DISK_KEY, DISK_TTL_SEC };

export async function storeSample(
  serviceId: string,
  sample: MetricSample,
): Promise<void> {
  const ringKey = RING_KEY(serviceId);
  const currentKey = CURRENT_KEY(serviceId);

  const pipeline = redis.pipeline();
  pipeline.rpush(ringKey, JSON.stringify(sample));
  pipeline.ltrim(ringKey, -RING_SIZE, -1); // keep last N samples
  pipeline.expire(ringKey, TTL_SEC);
  pipeline.set(currentKey, JSON.stringify(sample), "EX", TTL_SEC);
  await pipeline.exec();
}

export async function getHistory(serviceId: string): Promise<MetricSample[]> {
  const raw = await redis.lrange(RING_KEY(serviceId), 0, -1);
  return raw.map((s) => JSON.parse(s) as MetricSample);
}

export async function getCurrent(
  serviceId: string,
): Promise<MetricSample | null> {
  const raw = await redis.get(CURRENT_KEY(serviceId));
  return raw ? (JSON.parse(raw) as MetricSample) : null;
}

// Pending buffer: each 30s sample is appended here and later drained (once a
// minute) by the rollup scheduler, which aggregates it into a durable 1m row.
// Kept separate from the live ring so draining never disturbs the live view.
export async function pushPending(
  serviceId: string,
  sample: MetricSample,
): Promise<void> {
  const key = PENDING_KEY(serviceId);
  const pipeline = redis.pipeline();
  pipeline.rpush(key, JSON.stringify(sample));
  pipeline.ltrim(key, -PENDING_MAX, -1);
  pipeline.expire(key, PENDING_TTL_SEC);
  await pipeline.exec();
}

// Atomically read + clear the pending buffer for a service.
export async function drainPending(serviceId: string): Promise<MetricSample[]> {
  const key = PENDING_KEY(serviceId);
  const results = await redis.multi().lrange(key, 0, -1).del(key).exec();
  const raw = (results?.[0]?.[1] as string[] | undefined) ?? [];
  return raw.map((s) => JSON.parse(s) as MetricSample);
}

export interface DockerStatsRaw {
  cpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
    online_cpus: number;
  };
  precpu_stats: {
    cpu_usage: { total_usage: number };
    system_cpu_usage: number;
  };
  memory_stats: { usage: number; limit: number; stats?: { cache?: number } };
  networks?: Record<string, { rx_bytes: number; tx_bytes: number }>;
}

export function parseDockerStats(
  raw: DockerStatsRaw,
): Omit<MetricSample, "ts" | "diskUsed"> {
  const cpuDelta =
    raw.cpu_stats.cpu_usage.total_usage -
    raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
  const cpus = raw.cpu_stats.online_cpus || 1;
  const cpu =
    systemDelta > 0
      ? Math.round((cpuDelta / systemDelta) * cpus * 100 * 100) / 100
      : 0;

  const memUsed = raw.memory_stats.usage - (raw.memory_stats.stats?.cache ?? 0);
  const memTotal = raw.memory_stats.limit;
  const memPercent =
    memTotal > 0 ? Math.round((memUsed / memTotal) * 10000) / 100 : 0;

  let netRx = 0;
  let netTx = 0;
  if (raw.networks) {
    for (const net of Object.values(raw.networks)) {
      netRx += net.rx_bytes ?? 0;
      netTx += net.tx_bytes ?? 0;
    }
  }

  return { cpu, memPercent, memUsed, memTotal, netRx, netTx };
}

import { formatBytes } from "@lib/utils";

import type {
  ChartPointI,
  TimeseriesPointI,
  TrendRangeT,
} from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

/**
 * netRx/netTx are cumulative byte counters, so plotting them raw draws a ramp
 * that can only climb — it says nothing about traffic. Convert each pair of
 * consecutive points into a rate instead.
 *
 * Recreating a container resets the counter, which would read as a huge
 * negative delta, so negatives clamp to 0. The first point has no predecessor
 * and carries null; Recharts skips null points.
 */
const toChartPoints = (raw: TimeseriesPointI[]): ChartPointI[] =>
  raw.map((p, i) => {
    const prev = i > 0 ? raw[i - 1] : undefined;
    const seconds = prev ? (p.ts - prev.ts) / 1000 : 0;
    const rate = (current: number, before: number) =>
      seconds > 0 ? Math.max(0, current - before) / seconds : 0;

    return {
      ts: p.ts,
      cpu: p.cpu,
      cpuMax: p.cpuMax,
      memUsed: p.memUsed,
      memPercent: p.mem,
      disk: p.disk,
      rxPerSec: prev ? rate(p.netRx, prev.netRx) : null,
      txPerSec: prev ? rate(p.netTx, prev.netTx) : null,
    };
  });

const formatPercent = (value: number): string => `${value.toFixed(1)}%`;

/** Sin decimales: en un eje "25%" se lee mejor que "25.0%". */
const formatPercentAxis = (value: number): string => `${Math.round(value)}%`;

const formatRate = (bytesPerSecond: number): string =>
  `${formatBytes(bytesPerSecond)}/s`;

/**
 * Shorter than `formatBytes` for axis ticks: one decimal only below 10, so
 * labels stay on one line ("572 MB", not a wrapped "572.2 MB").
 */
const formatBytesAxis = (bytes: number): string => {
  if (bytes <= 0) return "0";

  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    units.length - 1,
  );
  const value = bytes / Math.pow(k, i);

  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
};

const formatRateAxis = (bytesPerSecond: number): string =>
  `${formatBytesAxis(bytesPerSecond)}/s`;

const formatTimeTick = (ts: number, range: TrendRangeT): string => {
  const d = new Date(ts);
  if (range === "7d" || range === "30d") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
};

export {
  toChartPoints,
  formatPercent,
  formatPercentAxis,
  formatBytesAxis,
  formatRate,
  formatRateAxis,
  formatTimeTick,
};

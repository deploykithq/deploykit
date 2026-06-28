import { memo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { trpc } from "@lib/trpc";

const RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

const CPU_COLOR = "#378ADD";
const MEM_COLOR = "#1D9E75";

interface MetricsTrendChartPropsI {
  serviceId: string;
}

function formatTick(ts: number, range: Range): string {
  const d = new Date(ts);
  if (range === "7d" || range === "30d") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const MetricsTrendChart: React.FC<MetricsTrendChartPropsI> = memo(
  function MetricsTrendChart({ serviceId }) {
    const [range, setRange] = useState<Range>("24h");

    const { data, isLoading } = trpc.metrics.timeseries.useQuery(
      { serviceId, range },
      { refetchInterval: 30_000 },
    );

    const points = data?.points ?? [];

    return (
      <div className="bg-surface-1 border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-text-secondary">
            Usage history
          </h3>
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  r === range
                    ? "bg-accent text-white"
                    : "text-text-muted hover:bg-surface-2"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-text-muted py-12 text-center">
            Loading history…
          </p>
        ) : points.length < 2 ? (
          <p className="text-sm text-text-muted py-12 text-center">
            Not enough history yet for this range. Metrics are recorded every
            minute while the service is running.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={points}
              margin={{ top: 4, right: 8, left: -16, bottom: 0 }}
            >
              <defs>
                <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CPU_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CPU_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MEM_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={MEM_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                className="text-border"
                vertical={false}
              />
              <XAxis
                dataKey="ts"
                tickFormatter={(ts) => formatTick(ts as number, range)}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-text-muted"
                minTickGap={32}
              />
              <YAxis
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11 }}
                stroke="currentColor"
                className="text-text-muted"
                width={44}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-surface-1, #0d1117)",
                  border: "1px solid var(--color-border, #30363d)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(ts) =>
                  new Date(ts as number).toLocaleString()
                }
                formatter={(value, name) => [
                  `${(value as number).toFixed(1)}%`,
                  name === "cpu" ? "CPU" : "Memory",
                ]}
              />
              <Area
                type="monotone"
                dataKey="cpu"
                stroke={CPU_COLOR}
                fill="url(#cpuFill)"
                strokeWidth={1.5}
                isAnimationActive={false}
                dot={false}
              />
              <Area
                type="monotone"
                dataKey="mem"
                stroke={MEM_COLOR}
                fill="url(#memFill)"
                strokeWidth={1.5}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        <div className="flex items-center gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: CPU_COLOR }}
            />
            CPU
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm"
              style={{ background: MEM_COLOR }}
            />
            Memory
          </span>
          {data?.resolution && (
            <span className="ml-auto">
              {data.resolution === "1m" ? "1-minute" : "1-hour"} resolution
            </span>
          )}
        </div>
      </div>
    );
  },
);

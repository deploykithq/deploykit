import { memo, useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { ChartTooltip } from "@metrics/infrastructure/ui/components/ChartTooltip";

import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_HEIGHT,
} from "@metrics/infrastructure/ui/constants/metrics.constants";

import { formatTimeTick } from "@metrics/infrastructure/ui/utils/chart.utils";

import type { MetricChartPropsI } from "@metrics/infrastructure/ui/interfaces/metrics.interfaces";

/**
 * One area chart, one Y axis, in whatever unit `formatValue` speaks. It doesn't
 * know which metric it is drawing — the panel decides that.
 */
export const MetricChart: React.FC<MetricChartPropsI> = memo(
  function MetricChart({
    data,
    series,
    formatValue,
    formatAxis,
    range,
    domain,
  }) {
    // useId() returns something like ":r3:" — the colons are illegal inside a
    // url(#…) reference, so strip them before building gradient ids.
    const uid = useId().replace(/:/g, "");

    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            {series.filter((s) => s.fill !== false).map((s) => (
              <linearGradient
                key={s.key}
                id={`${uid}-${s.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          <CartesianGrid
            stroke={CHART_GRID_COLOR}
            strokeDasharray="3 3"
            vertical={false}
          />

          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(ts) => formatTimeTick(ts as number, range)}
            tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }}
            stroke={CHART_GRID_COLOR}
            minTickGap={40}
          />

          <YAxis
            domain={domain ?? [0, "auto"]}
            tickFormatter={(value) => (formatAxis ?? formatValue)(value as number)}
            tick={{ fontSize: 11, fill: CHART_AXIS_COLOR }}
            stroke={CHART_GRID_COLOR}
            width={64}
          />

          <Tooltip
            cursor={{
              stroke: CHART_AXIS_COLOR,
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            content={
              <ChartTooltip series={series} formatValue={formatValue} />
            }
          />

          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.strokeWidth ?? 2}
              fill={s.fill === false ? "none" : `url(#${uid}-${s.key})`}
              fillOpacity={s.fill === false ? 0 : (s.fillOpacity ?? 1)}
              isAnimationActive={false}
              dot={false}
              connectNulls={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    );
  },
);

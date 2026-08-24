const METRIC_OPTIONS = [
  { value: "cpu", label: "CPU %" },
  { value: "memory", label: "Memory %" },
  { value: "net_rx", label: "Net RX (bytes)" },
  { value: "net_tx", label: "Net TX (bytes)" },
];

const METRIC_LABELS: Record<string, string> = Object.fromEntries(
  METRIC_OPTIONS.map((o) => [o.value, o.label]),
);

const OPERATOR_OPTIONS = [
  { value: "gt", label: "Greater than" },
  { value: "lt", label: "Less than" },
];

const CHANNEL_OPTIONS = [
  { value: "ui", label: "In-app" },
  { value: "slack", label: "Slack" },
  { value: "webhook", label: "Webhook" },
];

const CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  CHANNEL_OPTIONS.map((o) => [o.value, o.label]),
);

const SERVICE_TYPE_OPTIONS = [
  { value: "application", label: "Application" },
  { value: "database", label: "Database" },
];

const TREND_RANGES = ["1h", "6h", "24h", "7d", "30d"] as const;

// Categorical slots 1-5 of the dark chart theme. Validated as a set against
// the #12121a card surface: lightness band, chroma floor, adjacent-pair CVD
// separation (worst ΔE 8.4), normal-vision floor (ΔE 19.3) and ≥3:1 contrast
// all pass. Don't substitute individual hexes without re-validating the set.
const CPU_COLOR = "#3987e5";
const MEM_COLOR = "#d95926";
const DISK_COLOR = "#199e70";
const NET_RX_COLOR = "#c98500";
const NET_TX_COLOR = "#d55181";

// Recessive chart furniture: --color-border for the grid, --color-text-secondary
// for tick labels (--color-text-muted doesn't clear contrast on surface-1).
const CHART_GRID_COLOR = "#2a2a3a";
const CHART_AXIS_COLOR = "#8888a0";

/** Plot height, shared by the chart and by the empty/loading placeholders so
 *  the grid doesn't jump when a card has no data for the selected range. */
const CHART_HEIGHT = 180;

/** Cada cuánto se refrescan métricas, eventos y estadísticas de alertas. */
const METRICS_REFETCH_MS = 30_000;

export {
  METRIC_OPTIONS,
  METRIC_LABELS,
  OPERATOR_OPTIONS,
  CHANNEL_OPTIONS,
  CHANNEL_LABELS,
  SERVICE_TYPE_OPTIONS,
  TREND_RANGES,
  CPU_COLOR,
  MEM_COLOR,
  DISK_COLOR,
  NET_RX_COLOR,
  NET_TX_COLOR,
  CHART_GRID_COLOR,
  CHART_AXIS_COLOR,
  CHART_HEIGHT,
  METRICS_REFETCH_MS,
};

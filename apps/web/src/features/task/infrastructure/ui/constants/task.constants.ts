const CRON_PRESETS = [
  { value: "", label: "No schedule (run manually)" },
  { value: "* * * * *", label: "Every minute" },
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "0 * * * *", label: "Hourly" },
  { value: "0 2 * * *", label: "Daily at 2:00" },
  { value: "0 0 * * 0", label: "Weekly (Sunday midnight)" },
];

/** Marca del select que revela el campo de cron libre. */
const CRON_CUSTOM = "__custom__";

const STATUS_STYLES: Record<string, string> = {
  running: "text-blue-400",
  success: "text-green-400",
  failed: "text-red-400",
  timed_out: "text-amber-400",
  skipped: "text-text-secondary",
};

/** Sondeo del historial mientras hay una ejecución en marcha. */
const RUNS_REFETCH_MS = 3000;

/** Timeout por defecto de un comando suelto, en segundos. */
const ADHOC_TIMEOUT_DEFAULT = 300;

export {
  CRON_PRESETS,
  CRON_CUSTOM,
  STATUS_STYLES,
  RUNS_REFETCH_MS,
  ADHOC_TIMEOUT_DEFAULT,
};

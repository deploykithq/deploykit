import type { LogLevelT } from "../interfaces/LogSearchPanelI";

const LOG_LEVELS: LogLevelT[] = ["error", "warn", "info", "debug", "fatal"];

const LOG_LEVEL_COLORS: Record<LogLevelT, string> = {
  error: "text-danger",
  fatal: "text-danger",
  warn: "text-warning",
  info: "text-info",
  debug: "text-text-muted",
};

const LOG_LEVEL_FALLBACK = "text-text-secondary";

/** Milisegundos de espera antes de disparar la búsqueda por texto libre. */
const SEARCH_DEBOUNCE_MS = 350;

/** Cada cuánto se refresca la lista de logs. */
const SEARCH_REFETCH_MS = 30_000;

export {
  LOG_LEVELS,
  LOG_LEVEL_COLORS,
  LOG_LEVEL_FALLBACK,
  SEARCH_DEBOUNCE_MS,
  SEARCH_REFETCH_MS,
};

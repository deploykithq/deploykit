const STATUS_DOT_COLORS: Record<string, string> = {
  running: "bg-success",
  success: "bg-success",
  connected: "bg-success",
  building: "bg-warning",
  deploying: "bg-warning",
  queued: "bg-warning",
  stopped: "bg-text-muted",
  idle: "bg-text-muted",
  disconnected: "bg-text-muted",
  error: "bg-danger",
  failed: "bg-danger",
};

const STATUS_DOT_FALLBACK = "bg-text-muted";

/** Estados en curso: el punto late para indicar actividad. */
const ACTIVE_STATUSES = ["running", "building", "deploying", "queued"];

export { STATUS_DOT_COLORS, STATUS_DOT_FALLBACK, ACTIVE_STATUSES };

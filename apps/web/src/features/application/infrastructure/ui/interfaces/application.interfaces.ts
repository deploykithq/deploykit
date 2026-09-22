type TabT =
  | "general"
  | "env"
  | "domains"
  | "deployments"
  | "logs"
  | "terminal"
  | "monitoring"
  | "security"
  | "tasks"
  | "previews";

type LogModeT = "live" | "history";

export type { TabT, LogModeT };

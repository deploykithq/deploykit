type TabT =
  | "general"
  | "env"
  | "domains"
  | "deployments"
  | "logs"
  | "terminal"
  | "monitoring"
  | "security"
  | "previews";

type LogModeT = "live" | "history";

export type { TabT, LogModeT };
